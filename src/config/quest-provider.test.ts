import { describe, expect, it, vi } from 'vitest'

import { BUILT_IN_CATALOG } from '../progress/catalog'
import {
  BUILT_IN_FLAGS,
  AnalyticsDisabledBoundary,
  DeferredFeatureFlags,
  RemoteConfigOrchestrator,
} from './feature-flags'
import {
  REMOTE_CONFIG_CACHE_KEY,
  REMOTE_CONFIG_TTL_MS,
  RemoteConfigError,
  RemoteQuestConfigProvider,
  createSupabaseRemoteConfigReader,
  type RemoteConfigPayload,
  type RemoteConfigClient,
  type RemoteConfigReader,
  type RemoteConfigStorage,
} from './quest-provider'

const NOW = Date.parse('2026-07-16T12:00:00.000Z')

function payload(overrides: Partial<RemoteConfigPayload> = {}): RemoteConfigPayload {
  return {
    quests: [{
      id: 'remote_targets_4',
      copy: '타겟 4개 부수기',
      event_type: 'TARGET_DESTROYED',
      target: 4,
      active_from: '2026-07-16T00:00:00.000Z',
      active_to: '2026-07-17T00:00:00.000Z',
      enabled: true,
      version: 7,
    }],
    flags: [
      { key: 'gamification_enabled', enabled: false, updated_at: '2026-07-16T00:00:00.000Z' },
      { key: 'character_variants_enabled', enabled: true, updated_at: '2026-07-16T00:00:00.000Z' },
      { key: 'analytics_enabled', enabled: false, updated_at: '2026-07-16T00:00:00.000Z' },
      { key: 'player_profiles_ui', enabled: true, updated_at: '2026-07-16T00:00:00.000Z' },
      { key: 'player_signup', enabled: true, updated_at: '2026-07-16T00:00:00.000Z' },
      { key: 'player_sync_writes', enabled: false, updated_at: '2026-07-16T00:00:00.000Z' },
    ],
    ...overrides,
  }
}

function memoryStorage(initial?: string): RemoteConfigStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(REMOTE_CONFIG_CACHE_KEY, initial)
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

function provider(options: {
  reader?: RemoteConfigReader | null
  storage?: RemoteConfigStorage
  now?: number
  sleep?: (ms: number) => Promise<void>
}) {
  return new RemoteQuestConfigProvider({
    reader: options.reader ?? null,
    storage: options.storage ?? memoryStorage(),
    now: () => options.now ?? NOW,
    sleep: options.sleep,
  })
}

describe('RemoteQuestConfigProvider', () => {
  it('returns built-ins immediately when no remote reader exists', async () => {
    const result = await provider({}).loadConfig()

    expect(result).toEqual({
      catalog: BUILT_IN_CATALOG,
      flags: BUILT_IN_FLAGS,
      source: 'builtIn',
    })
  })

  it('validates a fresh remote response, preserves false flags, and caches the last good payload', async () => {
    const storage = memoryStorage()
    const reader = vi.fn(async () => payload())

    const result = await provider({ reader, storage }).loadConfig()

    expect(reader).toHaveBeenCalledTimes(1)
    expect(result.source).toBe('remote')
    expect(result.catalog.version).toBe(7)
    expect(result.catalog.quests.map((quest) => quest.id)).toEqual(['remote_targets_4'])
    expect(result.flags).toEqual({
      gamification_enabled: false,
      character_variants_enabled: true,
      analytics_enabled: false,
      player_profiles_ui: true,
      player_signup: true,
      player_sync_writes: false,
    })
    expect(JSON.parse(storage.values.get(REMOTE_CONFIG_CACHE_KEY)!)).toMatchObject({
      fetchedAt: NOW,
      payload: payload(),
    })
  })

  it('accepts ISO timestamps with database timezone offsets', async () => {
    const offsetPayload = payload({
      quests: [{
        ...payload().quests[0],
        active_from: '2026-07-16T00:00:00+00:00',
        active_to: '2026-07-17T00:00:00+00:00',
      }],
      flags: payload().flags.map((flag) => ({
        ...flag,
        updated_at: '2026-07-16T00:00:00+00:00',
      })),
    })

    await expect(provider({ reader: async () => offsetPayload }).loadConfig())
      .resolves.toMatchObject({ source: 'remote' })
  })

  it('counts a supplementary emoji as one character in the 60-character copy limit', async () => {
    const sixtyCharacters = `${'가'.repeat(59)}💥`
    const result = await provider({
      reader: async () => payload({
        quests: [{ ...payload().quests[0], copy: sixtyCharacters }],
      }),
    }).loadConfig()

    expect(Array.from(sixtyCharacters)).toHaveLength(60)
    expect(result.source).toBe('remote')
  })

  it('keeps validated remote false flags when every quest is scheduled for later', async () => {
    const scheduled = payload({
      quests: [{
        ...payload().quests[0],
        active_from: '2026-07-20T00:00:00.000Z',
        active_to: '2026-07-21T00:00:00.000Z',
      }],
    })

    const result = await provider({ reader: async () => scheduled }).loadConfig()

    expect(result.source).toBe('remote')
    expect(result.catalog).toBe(BUILT_IN_CATALOG)
    expect(result.flags.gamification_enabled).toBe(false)
  })

  it('uses an unexpired validated cache after remote failure', async () => {
    const cached = JSON.stringify({ fetchedAt: NOW - REMOTE_CONFIG_TTL_MS, payload: payload() })
    const reader = vi.fn(async () => { throw new RemoteConfigError('offline') })

    const result = await provider({ reader, storage: memoryStorage(cached), sleep: async () => {} })
      .loadConfig()

    expect(reader).toHaveBeenCalledTimes(4)
    expect(result.source).toBe('cache')
    expect(result.flags.gamification_enabled).toBe(false)
  })

  it.each([
    ['expired', JSON.stringify({ fetchedAt: NOW - REMOTE_CONFIG_TTL_MS - 1, payload: payload() })],
    ['malformed', '{bad-json'],
  ])('uses built-ins for an %s cache', async (_label, cached) => {
    const result = await provider({
      reader: async () => { throw new RemoteConfigError('offline') },
      storage: memoryStorage(cached),
      sleep: async () => {},
    }).loadConfig()

    expect(result).toEqual({
      catalog: BUILT_IN_CATALOG,
      flags: BUILT_IN_FLAGS,
      source: 'builtIn',
    })
  })

  it.each([400, 401, 403])('does not retry HTTP %i', async (status) => {
    const reader = vi.fn(async () => { throw new RemoteConfigError('denied', status) })
    const sleep = vi.fn(async () => {})

    await provider({ reader, sleep }).loadConfig()

    expect(reader).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it.each([0, 500])(
    'retries transient HTTP status %i three times using 1s, 2s, and 4s delays',
    async (status) => {
    const reader = vi.fn(async () => { throw new RemoteConfigError('transient', status) })
    const delays: number[] = []

    await provider({ reader, sleep: async (ms) => { delays.push(ms) } }).loadConfig()

    expect(reader).toHaveBeenCalledTimes(4)
    expect(delays).toEqual([1_000, 2_000, 4_000])
    }
  )

  it('recovers when a status-0 network result succeeds on the next attempt', async () => {
    const reader = vi.fn<[AbortSignal], ReturnType<RemoteConfigReader>>()
      .mockRejectedValueOnce(new RemoteConfigError('offline', 0))
      .mockResolvedValueOnce(payload())
    const delays: number[] = []

    const result = await provider({
      reader,
      sleep: async (ms) => { delays.push(ms) },
    }).loadConfig()

    expect(result.source).toBe('remote')
    expect(reader).toHaveBeenCalledTimes(2)
    expect(delays).toEqual([1_000])
  })

  it('aborts every stalled attempt after exactly eight seconds then uses cache', async () => {
    vi.useFakeTimers()
    try {
      const aborted: boolean[] = []
      const reader: RemoteConfigReader = (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted.push(signal.aborted)
          reject(new RemoteConfigError('timeout'))
        }, { once: true })
      })
      const cached = JSON.stringify({ fetchedAt: NOW, payload: payload() })
      const pending = provider({
        reader,
        storage: memoryStorage(cached),
        sleep: async () => {},
      }).loadConfig()

      await vi.advanceTimersByTimeAsync(32_000)

      await expect(pending).resolves.toMatchObject({ source: 'cache' })
      expect(aborted).toEqual([true, true, true, true])
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects the entire response when any row is unsafe', async () => {
    const unsafe = payload({
      quests: [
        payload().quests[0],
        { ...payload().quests[0], id: 'other_quest', copy: '나쁜—문구' },
      ],
    })

    const result = await provider({ reader: async () => unsafe, sleep: async () => {} }).loadConfig()

    expect(result.source).toBe('builtIn')
  })

  it.each([
    ['duplicate quest IDs', payload({ quests: [payload().quests[0], payload().quests[0]] })],
    ['unknown flag keys', payload({ flags: [
      ...payload().flags,
      { key: 'surprise_enabled', enabled: true, updated_at: '2026-07-16T00:00:00.000Z' },
    ] })],
    ['missing flag rows', payload({ flags: payload().flags.slice(0, 5) })],
    ['duplicate flag rows', payload({ flags: [...payload().flags, payload().flags[0]] })],
    ['reversed active interval', payload({ quests: [{
      ...payload().quests[0],
      active_from: '2026-07-17T00:00:00.000Z',
      active_to: '2026-07-16T00:00:00.000Z',
    }] })],
    ['impossible calendar date', payload({ quests: [{
      ...payload().quests[0],
      active_from: '2026-02-30T00:00:00Z',
      active_to: null,
    }] })],
    ['non-Korean copy', payload({ quests: [{ ...payload().quests[0], copy: 'break four' }] })],
  ])('atomically rejects %s', async (_label, unsafe) => {
    const result = await provider({ reader: async () => unsafe, sleep: async () => {} }).loadConfig()
    expect(result.source).toBe('builtIn')
  })

  it('rejects a cached legacy three-flag payload instead of guessing player flags', async () => {
    const legacy = payload({ flags: payload().flags.slice(0, 3) })
    const cached = JSON.stringify({ fetchedAt: NOW, payload: legacy })

    const result = await provider({
      reader: async () => { throw new RemoteConfigError('offline') },
      storage: memoryStorage(cached),
      sleep: async () => {},
    }).loadConfig()

    expect(result).toEqual({
      catalog: BUILT_IN_CATALOG,
      flags: BUILT_IN_FLAGS,
      source: 'builtIn',
    })
  })

  it('treats blocked cache reads and writes as optional', async () => {
    const storage: RemoteConfigStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }

    await expect(provider({ reader: async () => payload(), storage }).loadConfig())
      .resolves.toMatchObject({ source: 'remote' })
  })
})

describe('createSupabaseRemoteConfigReader', () => {
  it('selects explicit public columns and fetches quests and flags in parallel', async () => {
    const calls: string[] = []
    let releases = 0
    const query = (table: string, data: unknown[]) => ({
      select(columns: string) {
        calls.push(`${table}:select:${columns}`)
        return this
      },
      eq(column: string, value: boolean) {
        calls.push(`${table}:eq:${column}:${value}`)
        return this
      },
      abortSignal(_signal: AbortSignal) {
        calls.push(`${table}:abort`)
        return new Promise((resolve) => {
          releases += 1
          queueMicrotask(() => resolve({ data, error: null, status: 200 }))
        })
      },
    })
    const client = {
      from(table: string) {
        return table === 'quest_catalog'
          ? query(table, payload().quests)
          : query(table, payload().flags)
      },
    }

    const result = await createSupabaseRemoteConfigReader(
      client as unknown as RemoteConfigClient
    )(new AbortController().signal)

    expect(releases).toBe(2)
    expect(result).toEqual(payload())
    expect(calls).toEqual([
      'quest_catalog:select:id,copy,event_type,target,active_from,active_to,enabled,version',
      'quest_catalog:eq:enabled:true',
      'quest_catalog:abort',
      'feature_flags:select:key,enabled,updated_at',
      'feature_flags:abort',
    ])
  })

  it.each([
    [500, 401, 401],
    [403, 500, 403],
    [0, 401, 401],
    [403, 0, 403],
    [500, 502, 500],
    [null, 500, 500],
    [500, null, 500],
  ])('selects a deterministic HTTP error across parallel results (%s/%s)', async (
    questStatus,
    flagStatus,
    expectedStatus
  ) => {
    const client = {
      from(table: string) {
        const selectedStatus = table === 'quest_catalog' ? questStatus : flagStatus
        const status = selectedStatus ?? 200
        const query = {
          select() { return query },
          eq() { return query },
          abortSignal() {
            return Promise.resolve({
              data: selectedStatus === null
                ? (table === 'quest_catalog' ? payload().quests : payload().flags)
                : null,
              error: selectedStatus === null ? null : { message: `HTTP ${status}` },
              status,
            })
          },
        }
        return query
      },
    }

    await expect(createSupabaseRemoteConfigReader(
      client as unknown as RemoteConfigClient
    )(new AbortController().signal)).rejects.toMatchObject({ status: expectedStatus })
  })
})

describe('DeferredFeatureFlags', () => {
  it('keeps pending flags inactive until the action settles', () => {
    const gate = new DeferredFeatureFlags(BUILT_IN_FLAGS)
    const onAnalyticsDisabled = vi.fn()
    gate.stage({ ...BUILT_IN_FLAGS, analytics_enabled: true })

    expect(gate.hasPending).toBe(true)
    expect(gate.active.analytics_enabled).toBe(false)
    gate.settle({ onAnalyticsDisabled })
    expect(gate.hasPending).toBe(false)
    expect(gate.active.analytics_enabled).toBe(true)

    gate.stage({ ...gate.active, analytics_enabled: false })
    expect(onAnalyticsDisabled).not.toHaveBeenCalled()
    gate.settle({ onAnalyticsDisabled })
    expect(onAnalyticsDisabled).toHaveBeenCalledOnce()
  })

  it('runs the queue-clear hook when a pending configuration keeps analytics disabled', () => {
    const gate = new DeferredFeatureFlags(BUILT_IN_FLAGS)
    const onAnalyticsDisabled = vi.fn()

    gate.stage({ ...BUILT_IN_FLAGS })
    gate.settle({ onAnalyticsDisabled })

    expect(onAnalyticsDisabled).toHaveBeenCalledOnce()
  })

  it('isolates a queue-clear hook error from flag activation', () => {
    const gate = new DeferredFeatureFlags({ ...BUILT_IN_FLAGS, analytics_enabled: true })
    gate.stage(BUILT_IN_FLAGS)

    expect(() => gate.settle({
      onAnalyticsDisabled: () => { throw new Error('queue unavailable') },
    })).not.toThrow()
    expect(gate.active.analytics_enabled).toBe(false)
  })
})

describe('AnalyticsDisabledBoundary', () => {
  it('isolates synchronous throws during initial registration, replacement, and disable calls', () => {
    const boundary = new AnalyticsDisabledBoundary(false)
    const first = vi.fn(() => { throw new Error('first queue unavailable') })
    const second = vi.fn(() => { throw new Error('second queue unavailable') })

    expect(() => boundary.setHook(first)).not.toThrow()
    expect(first).toHaveBeenCalledOnce()
    expect(() => boundary.setHook(second)).not.toThrow()
    expect(second).toHaveBeenCalledOnce()

    boundary.setEnabled(true)
    expect(() => boundary.setEnabled(false)).not.toThrow()
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('observes rejected async hooks without leaking an unhandled rejection', async () => {
    const boundary = new AnalyticsDisabledBoundary(false)
    const asyncHook = vi.fn(async () => { throw new Error('async queue unavailable') })

    expect(() => boundary.setHook(asyncHook)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(asyncHook).toHaveBeenCalledOnce()
  })
})

describe('RemoteConfigOrchestrator', () => {
  it('defers catalog, flags, analytics, and UI until settlement while preserving old action semantics', () => {
    const orchestrator = new RemoteConfigOrchestrator()
    const applyCatalog = vi.fn()
    const onFlagsApplied = vi.fn()
    const clearAnalytics = vi.fn()
    orchestrator.setAnalyticsDisabledHook(clearAnalytics)
    clearAnalytics.mockClear()
    orchestrator.rememberAction(41, 9)
    orchestrator.stage({
      catalog: { version: 7, quests: BUILT_IN_CATALOG.quests },
      flags: {
        ...BUILT_IN_FLAGS,
        gamification_enabled: false,
        character_variants_enabled: false,
      },
    })

    expect(orchestrator.applyIfSettled(true, { applyCatalog, onFlagsApplied })).toBe(false)
    expect(orchestrator.active).toEqual(BUILT_IN_FLAGS)
    expect(applyCatalog).not.toHaveBeenCalled()
    expect(onFlagsApplied).not.toHaveBeenCalled()

    expect(orchestrator.applyIfSettled(false, { applyCatalog, onFlagsApplied })).toBe(true)
    expect(applyCatalog).toHaveBeenCalledOnce()
    expect(onFlagsApplied).toHaveBeenCalledWith(expect.objectContaining({
      gamification_enabled: false,
      character_variants_enabled: false,
    }))
    expect(clearAnalytics).toHaveBeenCalledOnce()
    expect(orchestrator.gamificationFor([{
      type: 'WEAPON_USED', source: 'user', actionId: 41, targetRunId: 9, weaponId: 'hammer',
    }])).toBe(true)
    expect(orchestrator.gamificationFor([{
      type: 'SETTING_CHANGED', key: 'haptics', value: false,
    }])).toBe(false)
  })
})
