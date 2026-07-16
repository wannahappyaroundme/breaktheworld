import type { SupabaseClient } from '@supabase/supabase-js'

import {
  isUuid,
  normalizeProfileName,
  PLAYER_PRIVACY_VERSION,
} from '../../supabase/functions/_shared/player-contract'
import type { PlayerApiErrorCode, PlayerApiResult, PlayerProfile } from './types'

export type PlayerClient = Pick<SupabaseClient, 'auth' | 'functions'>
export type ClearPlayerSession = () => boolean

interface SessionPayload {
  accessToken: string
  refreshToken: string
  expiresAt: number
  profile: PlayerProfile
}

interface InvokeResult {
  data: unknown
  error: unknown
}

const MESSAGES: Record<PlayerApiErrorCode, string> = {
  offline: '인터넷에 연결되면 로그인할 수 있어요.',
  invalid_request: '입력한 내용을 다시 확인해 주세요.',
  name_taken: '이미 사용 중인 ID예요. 다른 ID를 입력해 주세요.',
  login_failed: 'ID 또는 PIN을 다시 확인해 주세요.',
  rate_limited: '잠시 뒤 다시 시도해 주세요.',
  signup_closed: '프로필 만들기를 다시 열면 바로 시작할 수 있어요.',
  session_expired: '로그인 시간이 끝났어요. 다시 로그인해 주세요.',
  change_not_required: '새 PIN으로 이미 바뀌었어요.',
  service_unavailable: '연결을 확인한 뒤 다시 시도해 주세요.',
}

function fail(
  code: PlayerApiErrorCode,
  message = MESSAGES[code],
  retryAfterSeconds?: number,
): PlayerApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index])
}

function parseProfile(value: unknown): PlayerProfile | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'userId', 'displayName', 'forcePinChange', 'credentialVersion',
  ])) return null
  if (
    !isUuid(value.userId)
    || typeof value.displayName !== 'string'
    || !normalizeProfileName(value.displayName)
    || typeof value.forcePinChange !== 'boolean'
    || !Number.isSafeInteger(value.credentialVersion)
    || Number(value.credentialVersion) < 1
  ) return null
  return {
    userId: value.userId,
    displayName: value.displayName,
    forcePinChange: value.forcePinChange,
    credentialVersion: Number(value.credentialVersion),
  }
}

function parseSessionPayload(value: unknown): SessionPayload | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'accessToken', 'refreshToken', 'expiresAt', 'profile',
  ])) return null
  const profile = parseProfile(value.profile)
  if (
    !profile
    || typeof value.accessToken !== 'string'
    || value.accessToken.length === 0
    || typeof value.refreshToken !== 'string'
    || value.refreshToken.length === 0
    || !Number.isSafeInteger(value.expiresAt)
    || Number(value.expiresAt) < 1
  ) return null
  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    expiresAt: Number(value.expiresAt),
    profile,
  }
}

function knownErrorCode(value: unknown): value is PlayerApiErrorCode {
  return typeof value === 'string' && value in MESSAGES
}

async function readErrorPayload(result: InvokeResult): Promise<{
  code: PlayerApiErrorCode
  retryAfterSeconds?: number
} | null> {
  let payload: unknown = result.data
  const context = isRecord(result.error) ? result.error.context : null
  if (context instanceof Response) {
    try { payload = await context.clone().json() } catch { /* response body is optional */ }
  }
  if (!isRecord(payload) || !knownErrorCode(payload.code)) return null
  const retryAfterSeconds = Number(payload.retryAfterSeconds)
  return {
    code: payload.code,
    ...(Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0
      ? { retryAfterSeconds }
      : {}),
  }
}

async function invokeSafely(
  client: PlayerClient,
  body: Record<string, unknown>,
): Promise<InvokeResult | null> {
  try {
    return await client.functions.invoke('player-auth', { body }) as InvokeResult
  } catch {
    return null
  }
}

export class PlayerApi {
  constructor(
    private readonly client: PlayerClient | null,
    private readonly clearPlayerSession: ClearPlayerSession,
  ) {}

  async checkName(profileName: string): Promise<PlayerApiResult<boolean>> {
    if (!this.client) return fail('offline')
    const result = await invokeSafely(this.client, { action: 'check-name', profileName })
    if (!result || result.error || !isRecord(result.data)
      || !hasExactKeys(result.data, ['available'])
      || typeof result.data.available !== 'boolean') return fail('service_unavailable')
    return { ok: true, data: result.data.available }
  }

  async create(input: {
    requestId: string
    profileName: string
    pin: string
    pinConfirmation: string
    over14: boolean
  }): Promise<PlayerApiResult<PlayerProfile>> {
    return this.createSession({
      action: 'create',
      requestId: input.requestId,
      profileName: input.profileName,
      pin: input.pin,
      pinConfirmation: input.pinConfirmation,
      privacyVersion: PLAYER_PRIVACY_VERSION,
      over14: input.over14,
    }, 'service_unavailable')
  }

  async login(profileName: string, pin: string): Promise<PlayerApiResult<PlayerProfile>> {
    return this.createSession({ action: 'login', profileName, pin }, 'login_failed')
  }

  async changePin(pin: string, pinConfirmation: string): Promise<PlayerApiResult<PlayerProfile>> {
    return this.createSession({ action: 'change-pin', pin, pinConfirmation }, 'service_unavailable')
  }

  async restoreSession(): Promise<PlayerApiResult<PlayerProfile | null>> {
    if (!this.client) return { ok: true, data: null }
    try {
      const stored = await this.client.auth.getSession()
      if (stored.error || !stored.data.session) return { ok: true, data: null }
      const result = await invokeSafely(this.client, { action: 'session' })
      if (result && !result.error && isRecord(result.data)
        && hasExactKeys(result.data, ['profile'])) {
        const profile = parseProfile(result.data.profile)
        if (profile) return { ok: true, data: profile }
      }
      const mapped = result ? await readErrorPayload(result) : null
      if (mapped?.code === 'session_expired' || mapped?.code === 'login_failed') {
        this.client.auth.stopAutoRefresh()
        if (!this.clearPlayerSession()) return fail(
          'service_unavailable',
          '이 기기에서 로그아웃을 다시 눌러 주세요.',
        )
        return { ok: true, data: null }
      }
      return fail('service_unavailable')
    } catch {
      return fail('service_unavailable')
    }
  }

  async signOut(): Promise<PlayerApiResult<null>> {
    if (!this.client) {
      return this.clearPlayerSession()
        ? { ok: true, data: null }
        : fail('service_unavailable', '이 기기에서 로그아웃을 다시 눌러 주세요.')
    }
    try {
      const result = await this.client.auth.signOut({ scope: 'local' })
      if (!result.error) return { ok: true, data: null }
    } catch {
      // Offline logout falls through to local removal.
    }
    try { this.client.auth.stopAutoRefresh() } catch { /* local cleanup continues */ }
    return this.clearPlayerSession()
      ? { ok: true, data: null }
      : fail('service_unavailable', '이 기기에서 로그아웃을 다시 눌러 주세요.')
  }

  private async createSession(
    body: Record<string, unknown>,
    fallback: PlayerApiErrorCode,
  ): Promise<PlayerApiResult<PlayerProfile>> {
    if (!this.client) return fail('offline')
    const result = await invokeSafely(this.client, body)
    if (!result) return fail('service_unavailable')
    if (result.error) {
      const mapped = await readErrorPayload(result)
      if (mapped?.code === 'rate_limited') {
        return fail('rate_limited', MESSAGES.rate_limited, mapped.retryAfterSeconds)
      }
      if (body.action === 'login') return fail('login_failed')
      if (mapped) return fail(mapped.code, MESSAGES[mapped.code], mapped.retryAfterSeconds)
      return fail(fallback)
    }
    const payload = parseSessionPayload(result.data)
    if (!payload) return fail(fallback)
    try {
      const stored = await this.client.auth.setSession({
        access_token: payload.accessToken,
        refresh_token: payload.refreshToken,
      })
      if (stored.error) return fail('service_unavailable')
    } catch {
      return fail('service_unavailable')
    }
    return { ok: true, data: payload.profile }
  }
}
