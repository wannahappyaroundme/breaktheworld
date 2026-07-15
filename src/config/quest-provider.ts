import type { SupabaseClient } from '@supabase/supabase-js'

import {
  BUILT_IN_CATALOG,
  createQuestDefinition,
  isSafeQuestId,
  type QuestCatalogProvider,
  type QuestCatalogSnapshot,
  type QuestEventType,
} from '../progress/catalog'
import { BUILT_IN_FLAGS, type FeatureFlags } from './feature-flags'

export const REMOTE_CONFIG_CACHE_KEY = 'btw.remoteConfig.v1'
export const REMOTE_CONFIG_TTL_MS = 86_400_000

export interface RemoteQuestRow {
  id: string
  copy: string
  event_type: string
  target: number
  active_from: string | null
  active_to: string | null
  enabled: boolean
  version: number
}

export interface RemoteFlagRow {
  key: string
  enabled: boolean
  updated_at: string
}

export interface RemoteConfigPayload {
  quests: RemoteQuestRow[]
  flags: RemoteFlagRow[]
}

export type RemoteConfigReader = (signal: AbortSignal) => Promise<RemoteConfigPayload>

export type RemoteConfigClient = Pick<SupabaseClient, 'from'>

export interface RemoteConfigStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class RemoteConfigError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

export interface RemoteConfigResult {
  catalog: QuestCatalogSnapshot
  flags: FeatureFlags
  source: 'remote' | 'cache' | 'builtIn'
}

interface CachedRemoteConfig {
  fetchedAt: number
  payload: RemoteConfigPayload
}

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const
const REMOTE_TIMEOUT_MS = 8_000
const QUEST_KEYS = [
  'id',
  'copy',
  'event_type',
  'target',
  'active_from',
  'active_to',
  'enabled',
  'version',
] as const
const FLAG_KEYS = ['key', 'enabled', 'updated_at'] as const
const FLAG_NAMES = Object.keys(BUILT_IN_FLAGS) as Array<keyof FeatureFlags>
const EVENT_TYPES: readonly QuestEventType[] = [
  'CHARGE_RELEASED',
  'WEAPON_USED',
  'TARGET_DESTROYED',
]
const EM_DASH_CODE_POINT = 0x2014

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  return keys.length === expected.length
    && keys.every((key, index) => key === [...expected].sort()[index])
}

function isIsoDate(value: unknown): value is string {
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
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= daysInMonth[month - 1]
    && hour <= 23
    && minute <= 59
    && second <= 59
    && offsetHour <= 23
    && offsetMinute <= 59
}

function includesEmDash(value: string): boolean {
  return Array.from(value).some((character) => character.codePointAt(0) === EM_DASH_CODE_POINT)
}

function validatePayload(payload: unknown, now: number): RemoteConfigResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  if (!hasExactKeys(payload, ['quests', 'flags'])) return null
  const candidate = payload as Partial<RemoteConfigPayload>
  if (!Array.isArray(candidate.quests) || !Array.isArray(candidate.flags)) return null

  const questIds = new Set<string>()
  const activeQuests = []
  let version = 0
  for (const row of candidate.quests) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !hasExactKeys(row, QUEST_KEYS)) {
      return null
    }
    const quest = row as RemoteQuestRow
    const copyLength = typeof quest.copy === 'string' ? Array.from(quest.copy).length : 0
    if (
      typeof quest.id !== 'string'
      || !isSafeQuestId(quest.id)
      || questIds.has(quest.id)
      || typeof quest.copy !== 'string'
      || copyLength < 2
      || copyLength > 60
      || !/[가-힣]/.test(quest.copy)
      || includesEmDash(quest.copy)
      || !EVENT_TYPES.includes(quest.event_type as QuestEventType)
      || !Number.isSafeInteger(quest.target)
      || quest.target < 1
      || quest.target > 100
      || (quest.active_from !== null && !isIsoDate(quest.active_from))
      || (quest.active_to !== null && !isIsoDate(quest.active_to))
      || typeof quest.enabled !== 'boolean'
      || !quest.enabled
      || !Number.isSafeInteger(quest.version)
      || quest.version < 1
    ) return null
    const start = quest.active_from === null ? null : Date.parse(quest.active_from)
    const end = quest.active_to === null ? null : Date.parse(quest.active_to)
    if (start !== null && end !== null && end <= start) return null
    questIds.add(quest.id)
    version = Math.max(version, quest.version)
    if ((start === null || start <= now) && (end === null || end > now)) {
      try {
        activeQuests.push(createQuestDefinition({
          id: quest.id,
          copy: quest.copy,
          event: quest.event_type as QuestEventType,
          target: quest.target,
        }))
      } catch {
        return null
      }
    }
  }
  const flags = {} as FeatureFlags
  const seenFlags = new Set<string>()
  for (const row of candidate.flags) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !hasExactKeys(row, FLAG_KEYS)) {
      return null
    }
    const flag = row as RemoteFlagRow
    if (
      typeof flag.key !== 'string'
      || !FLAG_NAMES.includes(flag.key as keyof FeatureFlags)
      || seenFlags.has(flag.key)
      || typeof flag.enabled !== 'boolean'
      || !isIsoDate(flag.updated_at)
    ) return null
    seenFlags.add(flag.key)
    flags[flag.key as keyof FeatureFlags] = flag.enabled
  }
  if (seenFlags.size !== FLAG_NAMES.length) return null

  return {
    catalog: activeQuests.length > 0
      ? { version, quests: activeQuests }
      : BUILT_IN_CATALOG,
    flags,
    source: 'remote',
  }
}

export function createSupabaseRemoteConfigReader(client: RemoteConfigClient): RemoteConfigReader {
  return async (signal) => {
    const questsRequest = client
      .from('quest_catalog')
      .select('id,copy,event_type,target,active_from,active_to,enabled,version')
      .eq('enabled', true)
      .abortSignal(signal)
    const flagsRequest = client
      .from('feature_flags')
      .select('key,enabled,updated_at')
      .abortSignal(signal)
    const [quests, flags] = await Promise.all([questsRequest, flagsRequest])
    const failures = [quests, flags].filter((result) => result.error !== null)
    const failed = failures.find((result) => [400, 401, 403].includes(result.status))
      ?? failures[0]
    if (failed) throw new RemoteConfigError(failed.error?.message ?? 'Remote config read failed', failed.status)
    return {
      quests: quests.data as RemoteQuestRow[],
      flags: flags.data as RemoteFlagRow[],
    }
  }
}

export class RemoteQuestConfigProvider implements QuestCatalogProvider {
  private readonly reader: RemoteConfigReader | null
  private readonly storage: RemoteConfigStorage
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: {
    reader: RemoteConfigReader | null
    storage: RemoteConfigStorage
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  }) {
    this.reader = options.reader
    this.storage = options.storage
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async loadConfig(): Promise<RemoteConfigResult> {
    if (!this.reader) return this.builtIn()

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        const payload = await this.readRemote()
        const validated = validatePayload(payload, this.now())
        if (!validated) break
        this.writeCache({ fetchedAt: this.now(), payload })
        return validated
      } catch (error) {
        if (!this.shouldRetry(error) || attempt === RETRY_DELAYS_MS.length) break
        await this.sleep(RETRY_DELAYS_MS[attempt])
      }
    }

    return this.readCache() ?? this.builtIn()
  }

  async loadCatalog(): Promise<QuestCatalogSnapshot | null> {
    return (await this.loadConfig()).catalog
  }

  private shouldRetry(error: unknown): boolean {
    const status = error instanceof RemoteConfigError ? error.status : undefined
    return status === undefined || status === 0 || status >= 500
  }

  private async readRemote(): Promise<RemoteConfigPayload> {
    const controller = new AbortController()
    let timeout: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort()
        reject(new RemoteConfigError('Remote config timed out'))
      }, REMOTE_TIMEOUT_MS)
    })
    try {
      return await Promise.race([this.reader!(controller.signal), timedOut])
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  private readCache(): RemoteConfigResult | null {
    try {
      const raw = this.storage.getItem(REMOTE_CONFIG_CACHE_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<CachedRemoteConfig>
      if (
        !Number.isFinite(parsed.fetchedAt)
        || typeof parsed.fetchedAt !== 'number'
        || parsed.fetchedAt > this.now()
        || this.now() - parsed.fetchedAt > REMOTE_CONFIG_TTL_MS
      ) return null
      const validated = validatePayload(parsed.payload, this.now())
      return validated ? { ...validated, source: 'cache' } : null
    } catch {
      return null
    }
  }

  private writeCache(value: CachedRemoteConfig): void {
    try {
      this.storage.setItem(REMOTE_CONFIG_CACHE_KEY, JSON.stringify(value))
    } catch {
      // The last-good cache is optional; remote configuration remains usable.
    }
  }

  private builtIn(): RemoteConfigResult {
    return { catalog: BUILT_IN_CATALOG, flags: BUILT_IN_FLAGS, source: 'builtIn' }
  }
}
