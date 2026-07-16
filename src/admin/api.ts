import type { SupabaseClient } from '@supabase/supabase-js'
import { isCharacterId } from '../weapons/character-ids'

export const LOGIN_MESSAGE = '로그인 정보를 다시 확인해 주세요.'
export const SESSION_MESSAGE = '로그인 시간이 끝났어요. 다시 로그인해 주세요.'
const REQUEST_MESSAGE = '저장된 내용을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
const SAVE_MESSAGE = '변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.'
const SIGN_OUT_MESSAGE = '연결을 확인한 뒤 로그아웃을 다시 눌러 주세요.'

export type AdminClient = Pick<SupabaseClient, 'auth' | 'from' | 'functions'>
export type AdminRole = 'owner' | 'operator'
export type QuestEventType = 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED'
export type FeatureFlagKey = 'gamification_enabled' | 'character_variants_enabled' | 'analytics_enabled'
export type ApiErrorKind = 'login' | 'session' | 'validation' | 'request'
export type ApiResult<T> = { ok: true; data: T } | {
  ok: false
  error: { kind: ApiErrorKind; message: string }
}

export interface AdminSession {
  userId: string
  email: string
  role: AdminRole
}

export interface AdminQuestInput {
  id: string
  copy: string
  eventType: QuestEventType
  target: number
  activeFrom: string | null
  activeTo: string | null
  enabled: boolean
  version: number
}

export interface AdminQuest extends AdminQuestInput {
  updatedAt: string
}

interface QuestRow {
  id: string
  copy: string
  event_type: QuestEventType
  target: number
  active_from: string | null
  active_to: string | null
  enabled: boolean
  version: number
  updated_at: string
}

export interface FeatureFlag {
  key: FeatureFlagKey
  enabled: boolean
  updatedAt: string
}

interface AnalyticsRow {
  day_key: string
  event_type: string
  weapon_id: string | null
  event_count: number | string
  value_sum: number | string
  average_value: number | string | null
}

export interface DailyMetrics {
  visits: number
  firstValidAttacks: number
  firstDestroys: number
  chargeCompletionRate: number
  questsCompleted: number
  sharesCompleted: number
  characterUses: Array<{ weaponId: string; count: number }>
  averageFinishActions: number | null
}

export interface ManagedAdmin {
  id: string
  email: string
  role: AdminRole
  active: boolean
}

type MutationFeedback = (event: string) => void | Promise<void>

const QUEST_COLUMNS = 'id,copy,event_type,target,active_from,active_to,enabled,version,updated_at'
const FLAG_COLUMNS = 'key,enabled,updated_at'
const METRIC_COLUMNS = 'day_key,event_type,weapon_id,event_count,value_sum,average_value'
const EVENT_TYPES: readonly QuestEventType[] = ['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED']
const FLAG_KEYS: readonly FeatureFlagKey[] = [
  'gamification_enabled',
  'character_variants_enabled',
  'analytics_enabled',
]

function failure(kind: ApiErrorKind, message: string): ApiResult<never> {
  return { ok: false, error: { kind, message } }
}

function isValidIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = Number(match[8] ?? 0)
  const offsetMinute = Number(match[9] ?? 0)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59 && offsetHour <= 23 && offsetMinute <= 59
}

function validQuestId(value: string): boolean {
  return /^[a-z0-9_]{3,64}$/.test(value)
}

export function validateQuestInput(input: AdminQuestInput): ApiResult<Omit<QuestRow, 'updated_at'>> {
  if (!validQuestId(input.id)) return failure('validation', '도전 구분 이름은 영문 소문자, 숫자, 밑줄로 3자 이상 입력해 주세요.')
  const copyLength = Array.from(input.copy.trim()).length
  const includesEmDash = Array.from(input.copy).some((character) => character.codePointAt(0) === 0x2014)
  if (copyLength < 2 || copyLength > 60 || includesEmDash) {
    return failure('validation', '도전 문구는 2자에서 60자로 입력해 주세요.')
  }
  if (!EVENT_TYPES.includes(input.eventType)) return failure('validation', '도전 기준을 다시 선택해 주세요.')
  if (!Number.isSafeInteger(input.target) || input.target < 1 || input.target > 100) {
    return failure('validation', '목표 횟수는 1에서 100 사이의 정수로 입력해 주세요.')
  }
  if (!Number.isSafeInteger(input.version) || input.version < 1) {
    return failure('validation', '변경 번호는 1 이상의 정수로 입력해 주세요.')
  }
  if (input.activeFrom !== null && !isValidIsoDate(input.activeFrom)) {
    return failure('validation', '시작 날짜를 다시 확인해 주세요.')
  }
  if (input.activeTo !== null && !isValidIsoDate(input.activeTo)) {
    return failure('validation', '종료 날짜를 다시 확인해 주세요.')
  }
  if (input.activeFrom !== null && input.activeTo !== null
    && Date.parse(input.activeTo) <= Date.parse(input.activeFrom)) {
    return failure('validation', '종료 날짜는 시작 날짜보다 뒤로 정해 주세요.')
  }
  return {
    ok: true,
    data: {
      id: input.id,
      copy: input.copy.trim(),
      event_type: input.eventType,
      target: input.target,
      active_from: input.activeFrom,
      active_to: input.activeTo,
      enabled: input.enabled,
      version: input.version,
    },
  }
}

function mapQuest(row: QuestRow): AdminQuest {
  return {
    id: row.id,
    copy: row.copy,
    eventType: row.event_type,
    target: Number(row.target),
    activeFrom: row.active_from,
    activeTo: row.active_to,
    enabled: row.enabled,
    version: Number(row.version),
    updatedAt: row.updated_at,
  }
}

function finite(value: number | string | null): number {
  const result = Number(value ?? 0)
  return Number.isFinite(result) ? result : 0
}

export class AdminApi {
  private mutationFeedback: MutationFeedback | null = null

  constructor(private readonly client: AdminClient) {}

  setMutationFeedback(feedback: MutationFeedback | null): void {
    this.mutationFeedback = feedback
  }

  async signIn(email: string, password: string): Promise<ApiResult<AdminSession>> {
    const signed = await this.client.auth.signInWithPassword({ email: email.trim(), password })
    if (signed.error || !signed.data.user) {
      await this.clearSession()
      return failure('login', LOGIN_MESSAGE)
    }
    const verified = await this.verifyAdmin(signed.data.user.id, signed.data.user.email ?? email.trim())
    if (!verified.ok) {
      await this.clearSession()
      return failure('login', LOGIN_MESSAGE)
    }
    return verified
  }

  async restoreSession(): Promise<ApiResult<AdminSession | null>> {
    const session = await this.client.auth.getSession()
    const user = session.data.session?.user
    if (session.error || !user) return { ok: true, data: null }
    const verified = await this.verifyAdmin(user.id, user.email ?? '')
    if (!verified.ok) {
      await this.clearSession()
      return failure('session', SESSION_MESSAGE)
    }
    return verified
  }

  async signOut(): Promise<ApiResult<null>> {
    try {
      const result = await this.client.auth.signOut()
      if (result.error) return failure('request', SIGN_OUT_MESSAGE)
      return { ok: true, data: null }
    } catch {
      return failure('request', SIGN_OUT_MESSAGE)
    }
  }

  async listQuests(): Promise<ApiResult<AdminQuest[]>> {
    const result = await this.client.from('quest_catalog').select(QUEST_COLUMNS).order('updated_at', { ascending: false })
    if (result.error || !Array.isArray(result.data)) return failure('request', REQUEST_MESSAGE)
    return { ok: true, data: (result.data as QuestRow[]).map(mapQuest) }
  }

  async createQuest(input: AdminQuestInput): Promise<ApiResult<AdminQuest>> {
    const validated = validateQuestInput(input)
    if (!validated.ok) return validated
    const result = await this.client.from('quest_catalog').insert(validated.data).select(QUEST_COLUMNS).single()
    if (result.error || !result.data) return failure('request', SAVE_MESSAGE)
    this.feedback('quest-created')
    return { ok: true, data: mapQuest(result.data as QuestRow) }
  }

  async updateQuest(id: string, input: AdminQuestInput): Promise<ApiResult<AdminQuest>> {
    if (id !== input.id) return failure('validation', '도전 구분 이름은 만든 뒤 그대로 사용해 주세요.')
    const validated = validateQuestInput(input)
    if (!validated.ok) return validated
    const { id: _id, ...changes } = validated.data
    const result = await this.client.from('quest_catalog').update(changes).eq('id', id).select(QUEST_COLUMNS).single()
    if (result.error || !result.data) return failure('request', SAVE_MESSAGE)
    this.feedback('quest-updated')
    return { ok: true, data: mapQuest(result.data as QuestRow) }
  }

  async deleteQuest(id: string): Promise<ApiResult<null>> {
    if (!validQuestId(id)) return failure('validation', '삭제할 도전을 다시 선택해 주세요.')
    const result = await this.client.from('quest_catalog').delete().eq('id', id)
    if (result.error) return failure('request', SAVE_MESSAGE)
    this.feedback('quest-deleted')
    return { ok: true, data: null }
  }

  async setQuestEnabled(id: string, enabled: boolean): Promise<ApiResult<AdminQuest>> {
    if (!validQuestId(id)) return failure('validation', '변경할 도전을 다시 선택해 주세요.')
    const result = await this.client.from('quest_catalog').update({ enabled }).eq('id', id).select(QUEST_COLUMNS).single()
    if (result.error || !result.data) return failure('request', SAVE_MESSAGE)
    this.feedback('quest-toggled')
    return { ok: true, data: mapQuest(result.data as QuestRow) }
  }

  async listFlags(): Promise<ApiResult<FeatureFlag[]>> {
    const result = await this.client.from('feature_flags').select(FLAG_COLUMNS).order('key', { ascending: true })
    if (result.error || !Array.isArray(result.data)) return failure('request', REQUEST_MESSAGE)
    const flags = (result.data as Array<{ key: FeatureFlagKey; enabled: boolean; updated_at: string }>).filter(
      (row) => FLAG_KEYS.includes(row.key),
    ).map((row) => ({ key: row.key, enabled: row.enabled, updatedAt: row.updated_at }))
    return { ok: true, data: flags }
  }

  async setFlag(key: FeatureFlagKey, enabled: boolean): Promise<ApiResult<FeatureFlag>> {
    if (!FLAG_KEYS.includes(key)) return failure('validation', '변경할 기능을 다시 선택해 주세요.')
    const result = await this.client.from('feature_flags').update({ enabled }).eq('key', key).select(FLAG_COLUMNS).single()
    if (result.error || !result.data) return failure('request', SAVE_MESSAGE)
    this.feedback('flag-updated')
    const row = result.data as { key: FeatureFlagKey; enabled: boolean; updated_at: string }
    return { ok: true, data: { key: row.key, enabled: row.enabled, updatedAt: row.updated_at } }
  }

  async loadDailyMetrics(): Promise<ApiResult<DailyMetrics>> {
    const result = await this.client.from('analytics_daily').select(METRIC_COLUMNS).order('day_key', { ascending: false })
    if (result.error || !Array.isArray(result.data)) return failure('request', REQUEST_MESSAGE)
    const allRows = result.data as AnalyticsRow[]
    const latestDay = allRows.reduce<string | null>((latest, row) => (
      latest === null || row.day_key > latest ? row.day_key : latest
    ), null)
    const rows = latestDay === null ? [] : allRows.filter((row) => row.day_key === latestDay)
    const count = (event: string) => rows.filter((row) => row.event_type === event)
      .reduce((sum, row) => sum + finite(row.event_count), 0)
    const releases = count('charge_release')
    const cancels = count('charge_cancel')
    const finishRows = rows.filter((row) => row.event_type === 'target_finish_actions')
    const finishCount = finishRows.reduce((sum, row) => sum + finite(row.event_count), 0)
    const finishValue = finishRows.reduce((sum, row) => sum + finite(row.value_sum), 0)
    const characterUses = rows.filter((row) => row.event_type === 'weapon_use' && row.weapon_id && isCharacterId(row.weapon_id))
      .reduce<Map<string, number>>((map, row) => {
        map.set(row.weapon_id!, (map.get(row.weapon_id!) ?? 0) + finite(row.event_count))
        return map
      }, new Map())
    return {
      ok: true,
      data: {
        visits: count('visit'),
        firstValidAttacks: count('first_hit'),
        firstDestroys: count('first_destroy'),
        chargeCompletionRate: releases + cancels === 0 ? 0 : Math.round((releases / (releases + cancels)) * 100),
        questsCompleted: count('quest_complete'),
        sharesCompleted: count('share_complete'),
        characterUses: [...characterUses].map(([weaponId, uses]) => ({ weaponId, count: uses }))
          .sort((a, b) => b.count - a.count || a.weaponId.localeCompare(b.weaponId)),
        averageFinishActions: finishCount === 0 ? null : Math.round((finishValue / finishCount) * 10) / 10,
      },
    }
  }

  async listAdmins(): Promise<ApiResult<ManagedAdmin[]>> {
    const result = await this.client.functions.invoke('manage-admin', { body: { action: 'list' } })
    if (result.error || !isAdminListPayload(result.data)) return failure('request', REQUEST_MESSAGE)
    return { ok: true, data: result.data.admins }
  }

  async setAdminActive(userId: string, active: boolean): Promise<ApiResult<ManagedAdmin>> {
    if (typeof userId !== 'string' || userId.length < 1 || typeof active !== 'boolean') {
      return failure('validation', '변경할 운영자 계정을 다시 선택해 주세요.')
    }
    const result = await this.client.functions.invoke('manage-admin', {
      body: { action: 'set-active', userId, active },
    })
    if (result.error || !isAdminPayload(result.data)) return failure('request', SAVE_MESSAGE)
    this.feedback('admin-updated')
    return { ok: true, data: result.data.admin }
  }

  private async verifyAdmin(userId: string, email: string): Promise<ApiResult<AdminSession>> {
    const result = await this.client.from('admin_users').select('user_id,role,active')
      .eq('user_id', userId).maybeSingle()
    const row = result.data as { user_id?: unknown; role?: unknown; active?: unknown } | null
    if (result.error || !row || row.user_id !== userId || !['owner', 'operator'].includes(String(row.role)) || row.active !== true) {
      return failure('login', LOGIN_MESSAGE)
    }
    return { ok: true, data: { userId, email, role: row.role as AdminRole } }
  }

  private async clearSession(): Promise<void> {
    try { await this.client.auth.signOut() } catch { /* Clearing is best effort. */ }
  }

  private feedback(event: string): void {
    if (!this.mutationFeedback) return
    try {
      const result = this.mutationFeedback(event)
      if (result instanceof Promise) void result.catch(() => undefined)
    } catch {
      // Optional feedback never changes the primary operation result.
    }
  }
}

function isAdmin(value: unknown): value is ManagedAdmin {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join(',') === 'active,email,id,role'
    && typeof row.id === 'string' && typeof row.email === 'string'
    && ['owner', 'operator'].includes(String(row.role)) && typeof row.active === 'boolean'
}

function isAdminListPayload(value: unknown): value is { admins: ManagedAdmin[] } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && Array.isArray((value as { admins?: unknown }).admins)
    && (value as { admins: unknown[] }).admins.every(isAdmin)
}

function isAdminPayload(value: unknown): value is { admin: ManagedAdmin } {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && isAdmin((value as { admin?: unknown }).admin)
}
