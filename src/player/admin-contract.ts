import { isUuid, normalizeProfileName } from '../../supabase/functions/_shared/player-contract'

export interface ManagedPlayer {
  userId: string
  displayName: string
  status: 'active' | 'inactive'
  forcePinChange: boolean
  createdAt: string
  lastSyncAt: string | null
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
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
  return month >= 1 && month <= 12
    && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59
    && offsetHour <= 23 && offsetMinute <= 59
}

export function isManagedPlayer(value: unknown): value is ManagedPlayer {
  if (!isRecord(value) || !exactKeys(value, [
    'userId',
    'displayName',
    'status',
    'forcePinChange',
    'createdAt',
    'lastSyncAt',
  ])) return false
  const normalized = normalizeProfileName(value.displayName)
  return isUuid(value.userId)
    && !!normalized
    && normalized.displayName === value.displayName
    && (value.status === 'active' || value.status === 'inactive')
    && typeof value.forcePinChange === 'boolean'
    && isValidIsoDate(value.createdAt)
    && (value.lastSyncAt === null || isValidIsoDate(value.lastSyncAt))
}

export function isManagedPlayerListPayload(value: unknown): value is { players: ManagedPlayer[] } {
  return isRecord(value)
    && exactKeys(value, ['players'])
    && Array.isArray(value.players)
    && value.players.every(isManagedPlayer)
}

export function isManagedPlayerPayload(value: unknown): value is { player: ManagedPlayer } {
  return isRecord(value)
    && exactKeys(value, ['player'])
    && isManagedPlayer(value.player)
}

export function isPlayerDeletedPayload(value: unknown): value is { deleted: true } {
  return isRecord(value)
    && exactKeys(value, ['deleted'])
    && value.deleted === true
}
