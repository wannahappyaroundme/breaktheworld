import {
  normalizeProfileName,
  validatePinPair,
} from '../../supabase/functions/_shared/player-contract'
import { BUILT_IN_FLAGS, type FeatureFlags } from '../config/feature-flags'
import type { PlayerApi } from './api'
import type { SyncStatus } from './sync-client'
import {
  PLAYER_PRIVACY_NOTICE,
  playerSignupEnabled,
  type PlayerPrivacyNotice,
} from './privacy'
import type {
  PlayerApiResult,
  PlayerProfile,
  PlayerProgressScope,
  ProfileCardView,
} from './types'

export type PlayerAccountSnapshot =
  | { kind: 'restoring'; card: ProfileCardView }
  | { kind: 'guest'; card: ProfileCardView; signupEnabled: boolean }
  | {
      kind: 'player'
      profile: PlayerProfile
      card: ProfileCardView
      forcePinChange: boolean
    }

export interface PlayerNameCheck {
  raw: string
  normalizedKey: string | null
  status: 'idle' | 'checking' | 'available' | 'taken' | 'error'
}

type PlayerApiPort = Pick<
  PlayerApi,
  'restoreSession' | 'checkName' | 'create' | 'login' | 'changePin' | 'signOut'
>

export interface PlayerAccountControllerOptions {
  api: PlayerApiPort
  onSnapshot(snapshot: PlayerAccountSnapshot): void
  onScope(scope: PlayerProgressScope, generation: number): void
  flags?: FeatureFlags
  privacyNotice?: PlayerPrivacyNotice
  createRequestId?: () => string
  beforeLogout?: () => Promise<number>
}

function invalidInput(message = '입력한 내용을 다시 확인해 주세요.'): PlayerApiResult<never> {
  return { ok: false, error: { code: 'invalid_request', message } }
}

function signupClosed(): PlayerApiResult<never> {
  return {
    ok: false,
    error: {
      code: 'signup_closed',
      message: '프로필 만들기를 다시 열면 바로 시작할 수 있어요.',
    },
  }
}

function defaultRequestId(): string {
  const value = globalThis.crypto?.randomUUID?.()
  if (!value) throw new Error('request_id_unavailable')
  return value
}

export class PlayerAccountController {
  private readonly api: PlayerApiPort
  private readonly onSnapshot: PlayerAccountControllerOptions['onSnapshot']
  private readonly onScope: PlayerAccountControllerOptions['onScope']
  private readonly createRequestId: () => string
  private readonly beforeLogout?: () => Promise<number>
  private flags: FeatureFlags
  private privacyNotice: PlayerPrivacyNotice
  private generation = 0
  private current: PlayerAccountSnapshot
  private duplicate: PlayerNameCheck = { raw: '', normalizedKey: null, status: 'idle' }

  constructor(options: PlayerAccountControllerOptions) {
    this.api = options.api
    this.onSnapshot = options.onSnapshot
    this.onScope = options.onScope
    this.createRequestId = options.createRequestId ?? defaultRequestId
    this.beforeLogout = options.beforeLogout
    this.flags = { ...(options.flags ?? BUILT_IN_FLAGS) }
    this.privacyNotice = options.privacyNotice ?? PLAYER_PRIVACY_NOTICE
    this.current = this.guestSnapshot()
    this.emit()
  }

  get snapshot(): PlayerAccountSnapshot {
    return this.current
  }

  get sessionGeneration(): number {
    return this.generation
  }

  get nameCheck(): PlayerNameCheck {
    return { ...this.duplicate }
  }

  async start(): Promise<void> {
    const generation = this.nextGeneration()
    this.current = { kind: 'restoring', card: this.guestCard('프로필을 확인하는 중이에요') }
    this.emit()
    const result = await this.api.restoreSession()
    if (!this.isCurrent(generation)) return
    if (!result.ok || result.data === null) {
      this.current = this.guestSnapshot()
      this.emit()
      return
    }
    this.applyPlayer(result.data, generation)
  }

  setFeatureFlags(flags: FeatureFlags, notice: PlayerPrivacyNotice = this.privacyNotice): void {
    this.flags = { ...flags }
    this.privacyNotice = notice
    if (this.current.kind === 'player') {
      this.current = this.playerSnapshot(this.current.profile)
    } else if (this.current.kind === 'restoring') {
      this.current = { kind: 'restoring', card: this.guestCard('프로필을 확인하는 중이에요') }
    } else {
      this.current = this.guestSnapshot()
    }
    this.emit()
  }

  editProfileName(raw: string): void {
    const normalized = normalizeProfileName(raw)
    this.duplicate = {
      raw,
      normalizedKey: normalized?.nameKey ?? null,
      status: 'idle',
    }
    this.emit()
  }

  async checkName(): Promise<PlayerApiResult<boolean>> {
    const normalized = normalizeProfileName(this.duplicate.raw)
    if (!normalized) return invalidInput('ID는 한글, 영문, 숫자로 2자에서 12자로 입력해 주세요.')
    const raw = this.duplicate.raw
    const key = normalized.nameKey
    this.duplicate = { raw, normalizedKey: key, status: 'checking' }
    this.emit()
    const result = await this.api.checkName(raw)
    if (this.duplicate.raw !== raw || this.duplicate.normalizedKey !== key) return result
    this.duplicate = {
      raw,
      normalizedKey: key,
      status: result.ok ? (result.data ? 'available' : 'taken') : 'error',
    }
    this.emit()
    return result
  }

  async create(
    profileName: string,
    pin: string,
    pinConfirmation: string,
    over14: boolean,
  ): Promise<PlayerApiResult<PlayerProfile>> {
    if (!playerSignupEnabled(this.flags, this.privacyNotice)) return signupClosed()
    const normalized = normalizeProfileName(profileName)
    if (
      !normalized
      || this.duplicate.status !== 'available'
      || this.duplicate.normalizedKey !== normalized.nameKey
      || this.duplicate.raw !== profileName
    ) return invalidInput('현재 ID의 중복 확인을 먼저 눌러 주세요.')
    const checkedPin = validatePinPair(pin, pinConfirmation)
    if (!checkedPin.ok || over14 !== true) return invalidInput()
    const generation = this.nextGeneration()
    let requestId: string
    try { requestId = this.createRequestId() } catch { return invalidInput() }
    const result = await this.api.create({
      requestId,
      profileName,
      pin: checkedPin.pin,
      pinConfirmation: checkedPin.pin,
      over14: true,
    })
    if (result.ok && this.isCurrent(generation)) this.applyPlayer(result.data, generation)
    return result
  }

  async login(profileName: string, pin: string): Promise<PlayerApiResult<PlayerProfile>> {
    const generation = this.nextGeneration()
    const result = await this.api.login(profileName, pin)
    if (result.ok && this.isCurrent(generation)) this.applyPlayer(result.data, generation)
    return result
  }

  async changePin(pin: string, pinConfirmation: string): Promise<PlayerApiResult<PlayerProfile>> {
    const checkedPin = validatePinPair(pin, pinConfirmation)
    if (!checkedPin.ok) return invalidInput('PIN을 같은 숫자 6자리로 다시 입력해 주세요.')
    const generation = this.nextGeneration()
    const result = await this.api.changePin(checkedPin.pin, checkedPin.pin)
    if (result.ok && this.isCurrent(generation)) this.applyPlayer(result.data, generation)
    return result
  }

  setSyncStatus(status: SyncStatus): void {
    if (this.current.kind !== 'player' || this.current.card.kind !== 'player') return
    const sync = status.kind === 'auth-expired' ? 'auth-expired' : status.kind
    this.current = {
      ...this.current,
      card: {
        ...this.current.card,
        sync,
        lastSavedAt: status.kind === 'saved'
          ? status.lastSavedAt
          : this.current.card.lastSavedAt,
      },
    }
    this.emit()
  }

  async logout(strategy: 'flush' | 'keep-local' = 'flush'): Promise<PlayerApiResult<null>> {
    const previous = this.current
    if (strategy === 'flush' && previous.kind === 'player' && this.beforeLogout) {
      try {
        const pending = await this.beforeLogout()
        if (pending > 0) {
          return {
            ok: false,
            error: { code: 'pending_sync', message: '저장할 기록이 이 기기에 남아 있어요.' },
          }
        }
      } catch {
        return {
          ok: false,
          error: { code: 'service_unavailable', message: '기록 저장을 다시 확인해 주세요.' },
        }
      }
    }
    const generation = this.nextGeneration()
    const result = await this.api.signOut()
    if (!this.isCurrent(generation)) return result
    if (!result.ok) {
      this.current = previous
      this.emit()
      return result
    }
    this.current = this.guestSnapshot()
    this.duplicate = { raw: '', normalizedKey: null, status: 'idle' }
    this.emit()
    this.onScope({ kind: 'guest' }, generation)
    return result
  }

  private nextGeneration(): number {
    this.generation += 1
    return this.generation
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation
  }

  private applyPlayer(profile: PlayerProfile, generation: number): void {
    this.current = this.playerSnapshot(profile)
    this.emit()
    if (!profile.forcePinChange) this.onScope({ kind: 'player', profile }, generation)
  }

  private playerSnapshot(profile: PlayerProfile): PlayerAccountSnapshot {
    return {
      kind: 'player',
      profile,
      forcePinChange: profile.forcePinChange,
      card: {
        visible: true,
        kind: 'player',
        displayName: profile.displayName,
        userId: profile.userId,
        sync: 'saved',
        lastSavedAt: null,
      },
    }
  }

  private guestSnapshot(): PlayerAccountSnapshot {
    return {
      kind: 'guest',
      card: this.guestCard('프로필로 로그인하면 여러 기기에서 기록을 이어갈 수 있어요'),
      signupEnabled: playerSignupEnabled(this.flags, this.privacyNotice),
    }
  }

  private guestCard(detail: string): ProfileCardView {
    return this.flags.player_profiles_ui
      ? { visible: true, kind: 'guest', title: '게스트로 즐기는 중', detail }
      : { visible: false, kind: 'hidden' }
  }

  private emit(): void {
    this.onSnapshot(this.current)
  }
}
