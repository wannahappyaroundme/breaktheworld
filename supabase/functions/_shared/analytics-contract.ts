import { isApprovedAnalyticsWeaponId } from './weapon-ids.ts'

export interface AnalyticsPayload {
  eventType:
    | 'visit'
    | 'first_hit'
    | 'first_destroy'
    | 'weapon_use'
    | 'target_finish_actions'
    | 'charge_release'
    | 'charge_cancel'
    | 'quest_complete'
    | 'share_complete'
  dayKey: string
  installHash: string
  weaponId: string | null
  value: number
}

export type AnalyticsBatchValidation =
  | { ok: true; items: AnalyticsPayload[] }
  | { ok: false }

const EVENT_TYPES = new Set<AnalyticsPayload['eventType']>([
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
const WEAPON_EVENTS = new Set<AnalyticsPayload['eventType']>([
  'first_hit',
  'first_destroy',
  'weapon_use',
  'target_finish_actions',
  'charge_release',
  'charge_cancel',
])
const EXACT_KEYS = ['dayKey', 'eventType', 'installHash', 'value', 'weaponId']
const HASH = /^[a-f0-9]{64}$/

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

function normalizeItem(value: unknown): AnalyticsPayload | null {
  if (!isPlainRecord(value)) return null
  if (Object.keys(value).sort().join(',') !== EXACT_KEYS.join(',')) return null
  if (typeof value.eventType !== 'string' || !EVENT_TYPES.has(value.eventType as AnalyticsPayload['eventType'])) {
    return null
  }
  const eventType = value.eventType as AnalyticsPayload['eventType']
  if (!isRealDate(value.dayKey)) return null
  if (typeof value.installHash !== 'string' || !HASH.test(value.installHash)) return null
  const expectsWeapon = WEAPON_EVENTS.has(eventType)
  if (expectsWeapon) {
    if (typeof value.weaponId !== 'string' || !isApprovedAnalyticsWeaponId(value.weaponId)) return null
  } else if (value.weaponId !== null) {
    return null
  }
  if (!Number.isSafeInteger(value.value)) return null
  if (eventType === 'target_finish_actions') {
    if ((value.value as number) < 1 || (value.value as number) > 3) return null
  } else if (value.value !== 1) {
    return null
  }
  return {
    eventType,
    dayKey: value.dayKey,
    installHash: value.installHash,
    weaponId: value.weaponId as string | null,
    value: value.value as number,
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
