import { isApprovedAnalyticsWeaponId } from './weapon-ids.ts'
import {
  ACHIEVEMENT_CATALOG,
  availableFrameIds,
  availableThemeIds,
} from './achievement-catalog.ts'

type LegacyAnalyticsEventType =
  | 'visit'
  | 'first_hit'
  | 'first_destroy'
  | 'weapon_use'
  | 'target_finish_actions'
  | 'charge_release'
  | 'charge_cancel'
  | 'quest_complete'
  | 'share_complete'

type ProgressAnalyticsEventType =
  | 'achievement_hub_opened'
  | 'achievement_unlocked'
  | 'level_reached'
  | 'cosmetic_selected'
  | 'profile_step_viewed'

export type AnalyticsEventType = LegacyAnalyticsEventType | ProgressAnalyticsEventType

export interface AnalyticsPayload {
  eventType: AnalyticsEventType
  dayKey: string
  installHash: string
  weaponId: string | null
  value: number
  dimension: string | null
}

export type AnalyticsBatchValidation =
  | { ok: true; items: AnalyticsPayload[] }
  | { ok: false }

const LEGACY_EVENT_TYPES = new Set<AnalyticsEventType>([
  'visit',
  'first_hit',
  'first_destroy',
  'weapon_use',
  'target_finish_actions',
  'charge_release',
  'charge_cancel',
  'quest_complete',
  'share_complete',
])
const EVENT_TYPES = new Set<AnalyticsEventType>([
  ...LEGACY_EVENT_TYPES,
  'achievement_hub_opened',
  'achievement_unlocked',
  'level_reached',
  'cosmetic_selected',
  'profile_step_viewed',
])
const WEAPON_EVENTS = new Set<AnalyticsEventType>([
  'first_hit',
  'first_destroy',
  'weapon_use',
  'target_finish_actions',
  'charge_release',
  'charge_cancel',
])
const LEGACY_EXACT_KEYS = ['dayKey', 'eventType', 'installHash', 'value', 'weaponId']
const DIMENSION_EXACT_KEYS = ['dayKey', 'dimension', 'eventType', 'installHash', 'value', 'weaponId']
const HASH = /^[a-f0-9]{64}$/
const ACHIEVEMENT_XP = new Map<string, number>(
  ACHIEVEMENT_CATALOG.map(({ id, xp }) => [id, xp])
)
const COSMETIC_IDS = new Set<string>([
  ...availableFrameIds(20),
  ...availableThemeIds(20),
])
const HUB_LOCATIONS = new Set(['hud', 'notice', 'profile'])
const PROFILE_STEPS = new Set(['choice', 'id', 'pin', 'complete'])

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === expected.join(',')
}

function validProgressDimension(
  eventType: ProgressAnalyticsEventType,
  dimension: string,
  value: number
): boolean {
  switch (eventType) {
    case 'achievement_hub_opened':
      return HUB_LOCATIONS.has(dimension) && value === 1
    case 'achievement_unlocked':
      return ACHIEVEMENT_XP.get(dimension) === value
    case 'level_reached':
      return value >= 2 && value <= 20 && dimension === `level_${value}`
    case 'cosmetic_selected':
      return COSMETIC_IDS.has(dimension) && value === 1
    case 'profile_step_viewed':
      return PROFILE_STEPS.has(dimension) && value === 1
  }
}

function normalizeItem(value: unknown): AnalyticsPayload | null {
  if (!isPlainRecord(value)) return null
  if (typeof value.eventType !== 'string' || !EVENT_TYPES.has(value.eventType as AnalyticsEventType)) {
    return null
  }
  const eventType = value.eventType as AnalyticsEventType
  const legacy = LEGACY_EVENT_TYPES.has(eventType)
  if (
    !hasExactKeys(value, DIMENSION_EXACT_KEYS)
    && !(legacy && hasExactKeys(value, LEGACY_EXACT_KEYS))
  ) return null
  if (!isRealDate(value.dayKey)) return null
  if (typeof value.installHash !== 'string' || !HASH.test(value.installHash)) return null
  if (!Number.isSafeInteger(value.value)) return null

  if (legacy) {
    if ('dimension' in value && value.dimension !== null) return null
    if (WEAPON_EVENTS.has(eventType)) {
      if (typeof value.weaponId !== 'string' || !isApprovedAnalyticsWeaponId(value.weaponId)) return null
    } else if (value.weaponId !== null) {
      return null
    }
    if (eventType === 'target_finish_actions') {
      if ((value.value as number) < 1 || (value.value as number) > 3) return null
    } else if (value.value !== 1) {
      return null
    }
  } else {
    if (value.weaponId !== null || typeof value.dimension !== 'string') return null
    if (!validProgressDimension(
      eventType as ProgressAnalyticsEventType,
      value.dimension,
      value.value as number
    )) return null
  }

  return {
    eventType,
    dayKey: value.dayKey,
    installHash: value.installHash,
    weaponId: value.weaponId as string | null,
    value: value.value as number,
    dimension: legacy ? null : value.dimension as string,
  }
}

export function validateAnalyticsBatch(input: unknown): AnalyticsBatchValidation {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) return { ok: false }
  const items: AnalyticsPayload[] = []
  for (const value of input) {
    const item = normalizeItem(value)
    if (!item) return { ok: false }
    if (items.length > 0 && item.installHash !== items[0].installHash) return { ok: false }
    items.push(item)
  }
  return { ok: true, items }
}
