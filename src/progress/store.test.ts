import { describe, expect, it, vi } from 'vitest'
import { createDefaultProgress } from './defaults'
import { reduceProgress } from './reducer'
import { ProgressStore, PROGRESS_STORAGE_KEY, type CheckpointReason, type StorageAdapter } from './store'
import { parseProgress } from './validate'

const KNOWN_WEAPONS = ['hammer', 'fire', 'cinnamoroll', 'ditto', 'dragonball'] as const
const KNOWN_MOVES = ['bonk', 'flame', 'cloudBounce'] as const

class FakeStorage implements StorageAdapter {
  readonly operations: string[] = []
  getCalls = 0
  setCalls = 0
  removeCalls = 0
  throwOnGet = false
  throwOnSet = false
  throwOnRemove = false
  private values = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    this.values = new Map(Object.entries(initial))
  }

  getItem(key: string): string | null {
    this.getCalls += 1
    this.operations.push(`get:${key}`)
    if (this.throwOnGet) throw new Error('get blocked')
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.setCalls += 1
    this.operations.push(`set:${key}`)
    if (this.throwOnSet) throw new Error('set blocked')
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.removeCalls += 1
    this.operations.push(`remove:${key}`)
    if (this.throwOnRemove) throw new Error('remove blocked')
    this.values.delete(key)
  }

  peek(key: string): string | null {
    return this.values.get(key) ?? null
  }
}

function options(onMemoryFallback: () => void = vi.fn()) {
  return {
    knownWeaponIds: KNOWN_WEAPONS,
    knownMoveIds: KNOWN_MOVES,
    createInstallSeed: () => 'fixed-install-seed',
    onMemoryFallback,
  }
}

describe('parseProgress', () => {
  it('recovers valid fields independently and drops invalid counters and unknown IDs', () => {
    const parsed = parseProgress({
      schemaVersion: 99,
      catalogVersion: 7,
      installSeed: 'saved-seed',
      lifetime: {
        validHits: 8,
        chargedFinishers: -1,
        totalTargets: Number.POSITIVE_INFINITY,
        bestCombo: 12.5,
        stamps: 2,
        distinctWeaponIds: ['fire', 'unknown', 'hammer', 'fire', 9],
      },
      byWeapon: {
        hammer: { uses: 3, finishes: -1, seenMoves: ['bonk', 'unknown', 'bonk'] },
        unknown: { uses: 99, finishes: 99, seenMoves: ['bonk'] },
      },
      byTarget: {
        word: { destroys: 4 },
        earth: { destroys: -1 },
        city: { destroys: Number.NaN },
      },
      achievements: {
        first_destroy: { unlockedAt: '2026-07-16T01:02:03.000Z', seen: true },
        charge_master: { unlockedAt: 'not-a-date', seen: true },
        unknown: { unlockedAt: '2026-07-16T01:02:03.000Z', seen: true },
      },
      daily: {
        dayKey: '2026-07-16',
        questId: 'characters_3',
        target: 3,
        progress: 2,
        distinctIds: ['hammer', 'ditto', 'unknown', 'cinnamoroll', 'ditto'],
        completedAt: null,
        stampAwarded: false,
      },
      profile: {
        selectedTitle: '첫 와장창',
        skins: { cinnamoroll: 'classic', ditto: 'invalid', unknown: 'classic' },
        strongInput: 'doubleTap',
        reducedMotion: true,
        haptics: 'yes',
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed).toMatchObject({
      schemaVersion: 1,
      catalogVersion: 7,
      installSeed: 'saved-seed',
      lifetime: {
        validHits: 8,
        chargedFinishers: 0,
        totalTargets: 0,
        bestCombo: 0,
        stamps: 2,
        distinctWeaponIds: ['fire', 'hammer'],
      },
      byWeapon: {
        hammer: { uses: 3, finishes: 0, seenMoves: ['bonk'] },
      },
      byTarget: {
        word: { destroys: 4 },
        earth: { destroys: 0 },
        city: { destroys: 0 },
      },
      achievements: {
        first_destroy: { unlockedAt: '2026-07-16T01:02:03.000Z', seen: true },
      },
      daily: {
        dayKey: '2026-07-16',
        questId: 'characters_3',
        target: 3,
        progress: 2,
        distinctIds: ['cinnamoroll', 'ditto'],
        completedAt: null,
        stampAwarded: false,
      },
      profile: {
        selectedTitle: '첫 와장창',
        skins: { cinnamoroll: 'classic' },
        strongInput: 'doubleTap',
        reducedMotion: true,
        haptics: true,
      },
    })
    expect(Object.keys(parsed.byWeapon)).toEqual(['hammer'])
    expect(Object.keys(parsed.achievements)).toEqual(['first_destroy'])
  })

  it('accepts exact nonnegative safe integers and rejects numeric lookalikes', () => {
    const parsed = parseProgress({
      installSeed: 'seed',
      lifetime: {
        validHits: Number.MAX_SAFE_INTEGER,
        chargedFinishers: 0,
        totalTargets: '3',
        bestCombo: new Number(4),
        stamps: 1.1,
        distinctWeaponIds: [],
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.lifetime).toMatchObject({
      validHits: Number.MAX_SAFE_INTEGER,
      chargedFinishers: 0,
      totalTargets: 0,
      bestCombo: 0,
      stamps: 0,
    })
  })

  it('accepts ISO timestamps and rejects loose date strings', () => {
    const parsed = parseProgress({
      installSeed: 'seed',
      achievements: {
        first_destroy: { unlockedAt: '2026-07-16T10:11:12+09:00', seen: false },
        charge_master: { unlockedAt: 'July 16, 2026', seen: true },
        variety_10: { unlockedAt: '2026-02-30T10:11:12.000Z', seen: true },
      },
      daily: {
        dayKey: '2026-07-16',
        questId: 'targets_3',
        target: 3,
        progress: 3,
        distinctIds: ['word'],
        completedAt: '2026-07-16T01:11:12.000Z',
        stampAwarded: true,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.achievements).toEqual({
      first_destroy: { unlockedAt: '2026-07-16T10:11:12+09:00', seen: false },
    })
    expect(parsed.daily.completedAt).toBe('2026-07-16T01:11:12.000Z')
    expect(parsed.daily.distinctIds).toEqual([])
  })

  it('resets only the daily challenge when its ID is unknown', () => {
    const parsed = parseProgress({
      installSeed: 'seed',
      lifetime: { validHits: 7 },
      daily: {
        dayKey: '2026-07-16',
        questId: 'mystery',
        target: 9,
        progress: 7,
        distinctIds: ['cinnamoroll'],
        completedAt: '2026-07-16T00:00:00.000Z',
        stampAwarded: true,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.lifetime.validHits).toBe(7)
    expect(parsed.daily).toEqual(createDefaultProgress('seed').daily)
  })

  it('derives unfinished character progress only from filtered valid character IDs', () => {
    const parsed = parseProgress({
      installSeed: 'seed',
      daily: {
        dayKey: '2026-07-16',
        questId: 'characters_3',
        target: 3,
        progress: 3,
        distinctIds: ['hammer', 'fire', 'unknown'],
        completedAt: null,
        stampAwarded: false,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.daily.progress).toBe(0)
    expect(parsed.daily.distinctIds).toEqual([])
    expect(parsed.daily.completedAt).toBeNull()
    expect(parsed.daily.stampAwarded).toBe(false)
  })

  it('unlocks a contradictory partial completion so the reducer can progress it again', () => {
    const parsed = parseProgress({
      installSeed: 'seed',
      lifetime: { validHits: 7, totalTargets: 4 },
      daily: {
        dayKey: '2026-07-16',
        questId: 'targets_3',
        target: 3,
        progress: 1,
        distinctIds: [],
        completedAt: '2026-07-16T01:02:03.000Z',
        stampAwarded: false,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.lifetime.validHits).toBe(7)
    expect(parsed.lifetime.totalTargets).toBe(4)
    expect(parsed.daily).toMatchObject({
      progress: 1,
      target: 3,
      completedAt: null,
      stampAwarded: false,
    })

    const advanced = reduceProgress(parsed, {
      type: 'TARGET_DESTROYED',
      source: 'user',
      actionId: 1,
      targetRunId: 1,
      weaponId: 'hammer',
      targetId: 'word',
      golden: false,
    })
    expect(advanced.daily.progress).toBe(2)
    expect(advanced.daily.completedAt).toBeNull()
  })

  it('clears a ghost stamp and allows a target-progress state to complete again', () => {
    const parsed = parseProgress({
      installSeed: 'seed',
      lifetime: { stamps: 4 },
      daily: {
        dayKey: '2026-07-16',
        questId: 'targets_3',
        target: 3,
        progress: 3,
        distinctIds: [],
        completedAt: null,
        stampAwarded: true,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.daily.completedAt).toBeNull()
    expect(parsed.daily.stampAwarded).toBe(false)
    expect(parsed.lifetime.stamps).toBe(4)

    const completed = reduceProgress(parsed, {
      type: 'TARGET_DESTROYED',
      source: 'user',
      actionId: 2,
      targetRunId: 1,
      weaponId: 'hammer',
      targetId: 'city',
      golden: false,
    })
    expect(completed.daily.completedAt).not.toBeNull()
    expect(completed.daily.stampAwarded).toBe(true)
    expect(completed.lifetime.stamps).toBe(5)
  })

  it('preserves only a fully consistent completed daily state', () => {
    const completedAt = '2026-07-16T01:02:03.000Z'
    const parsed = parseProgress({
      installSeed: 'seed',
      daily: {
        dayKey: '2026-07-16',
        questId: 'targets_3',
        target: 3,
        progress: 3,
        distinctIds: [],
        completedAt,
        stampAwarded: true,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)

    expect(parsed.daily).toMatchObject({
      target: 3,
      progress: 3,
      completedAt,
      stampAwarded: true,
    })
  })

  it('repairs a zero target from the built-in quest policy and resets an invalid day', () => {
    const repairedTarget = parseProgress({
      installSeed: 'seed',
      daily: {
        dayKey: '2026-07-16',
        questId: 'charged_finisher_2',
        target: 0,
        progress: 2,
        distinctIds: [],
        completedAt: '2026-07-16T01:02:03.000Z',
        stampAwarded: true,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)
    expect(repairedTarget.daily.target).toBe(2)
    expect(repairedTarget.daily.completedAt).toBeNull()
    expect(repairedTarget.daily.stampAwarded).toBe(false)

    const invalidDay = parseProgress({
      installSeed: 'seed',
      lifetime: { validHits: 9 },
      daily: {
        dayKey: '2026-02-30',
        questId: 'targets_3',
        target: 3,
        progress: 2,
        distinctIds: [],
        completedAt: null,
        stampAwarded: false,
      },
    }, KNOWN_WEAPONS, KNOWN_MOVES)
    expect(invalidDay.lifetime.validHits).toBe(9)
    expect(invalidDay.daily).toEqual(createDefaultProgress('seed').daily)
  })

  it('starts from deterministic defaults for non-object input', () => {
    expect(parseProgress(null, KNOWN_WEAPONS, KNOWN_MOVES)).toEqual(createDefaultProgress(''))
    expect(parseProgress(['bad'], KNOWN_WEAPONS, KNOWN_MOVES)).toEqual(createDefaultProgress(''))
  })
})

describe('ProgressStore load and migration', () => {
  it('creates and persists a deterministic new-install state', () => {
    const storage = new FakeStorage()
    const store = new ProgressStore(storage, options())

    const loaded = store.load()

    expect(loaded.mode).toBe('persistent')
    expect(loaded.state).toEqual(createDefaultProgress('fixed-install-seed'))
    expect(JSON.parse(storage.peek(PROGRESS_STORAGE_KEY)!)).toEqual(loaded.state)
    expect(storage.setCalls).toBe(1)
  })

  it('loads and validates an existing state without overwriting it', () => {
    const saved = createDefaultProgress('saved-seed')
    saved.lifetime.bestCombo = 24
    saved.byWeapon.hammer = { uses: 3, finishes: 1, seenMoves: ['bonk'] }
    const storage = new FakeStorage({ [PROGRESS_STORAGE_KEY]: JSON.stringify(saved) })

    const loaded = new ProgressStore(storage, options()).load()

    expect(loaded.mode).toBe('persistent')
    expect(loaded.state.lifetime.bestCombo).toBe(24)
    expect(loaded.state.byWeapon.hammer).toEqual({ uses: 3, finishes: 1, seenMoves: ['bonk'] })
    expect(storage.setCalls).toBe(0)
  })

  it('recovers malformed JSON to a persisted default instead of crashing', () => {
    const storage = new FakeStorage({ [PROGRESS_STORAGE_KEY]: '{not-json' })

    const loaded = new ProgressStore(storage, options()).load()

    expect(loaded.mode).toBe('persistent')
    expect(loaded.state).toEqual(createDefaultProgress('fixed-install-seed'))
    expect(JSON.parse(storage.peek(PROGRESS_STORAGE_KEY)!)).toEqual(loaded.state)
  })

  it('migrates valid legacy records only when the new key is absent', () => {
    const storage = new FakeStorage({
      'btw.bestCombo': '42',
      'btw.totalTargets': '19',
    })

    const loaded = new ProgressStore(storage, options()).load()

    expect(loaded.mode).toBe('persistent')
    expect(loaded.state.lifetime.bestCombo).toBe(42)
    expect(loaded.state.lifetime.totalTargets).toBe(19)
    expect(storage.peek(PROGRESS_STORAGE_KEY)).not.toBeNull()
    expect(storage.peek('btw.bestCombo')).toBeNull()
    expect(storage.peek('btw.totalTargets')).toBeNull()
    expect(storage.operations.indexOf(`set:${PROGRESS_STORAGE_KEY}`)).toBeLessThan(
      storage.operations.indexOf('remove:btw.bestCombo')
    )
  })

  it('does not read or remove legacy values when a new state exists', () => {
    const saved = createDefaultProgress('saved-seed')
    saved.lifetime.bestCombo = 5
    const storage = new FakeStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify(saved),
      'btw.bestCombo': '42',
      'btw.totalTargets': '19',
    })

    const loaded = new ProgressStore(storage, options()).load()

    expect(loaded.state.lifetime.bestCombo).toBe(5)
    expect(storage.peek('btw.bestCombo')).toBe('42')
    expect(storage.peek('btw.totalTargets')).toBe('19')
    expect(storage.operations).not.toContain('get:btw.bestCombo')
  })

  it('leaves invalid legacy values untouched', () => {
    const storage = new FakeStorage({
      'btw.bestCombo': '-1',
      'btw.totalTargets': '3.5',
    })

    const loaded = new ProgressStore(storage, options()).load()

    expect(loaded.state.lifetime.bestCombo).toBe(0)
    expect(loaded.state.lifetime.totalTargets).toBe(0)
    expect(storage.peek('btw.bestCombo')).toBe('-1')
    expect(storage.peek('btw.totalTargets')).toBe('3.5')
  })

  it('keeps legacy values and enters memory mode when the new write fails', () => {
    const notice = vi.fn()
    const storage = new FakeStorage({
      'btw.bestCombo': '42',
      'btw.totalTargets': '19',
    })
    storage.throwOnSet = true
    const store = new ProgressStore(storage, options(notice))

    const loaded = store.load()

    expect(loaded.mode).toBe('memory')
    expect(loaded.state.lifetime.bestCombo).toBe(42)
    expect(storage.peek('btw.bestCombo')).toBe('42')
    expect(storage.peek('btw.totalTargets')).toBe('19')
    expect(storage.removeCalls).toBe(0)
    expect(notice).toHaveBeenCalledTimes(1)
  })

  it('falls back to memory once when storage reads are blocked', () => {
    const notice = vi.fn()
    const storage = new FakeStorage()
    storage.throwOnGet = true
    const store = new ProgressStore(storage, options(notice))

    const first = store.load()
    const second = store.load()

    expect(first.mode).toBe('memory')
    expect(second.mode).toBe('memory')
    expect(second.state).toBe(first.state)
    expect(storage.getCalls).toBe(1)
    expect(storage.setCalls).toBe(0)
    expect(notice).toHaveBeenCalledTimes(1)
  })

  it('keeps gameplay in memory mode even if the fallback notice throws', () => {
    const storage = new FakeStorage()
    storage.throwOnGet = true
    const store = new ProgressStore(storage, options(() => {
      throw new Error('notice renderer unavailable')
    }))

    expect(store.load()).toMatchObject({ mode: 'memory' })
    expect(store.load()).toMatchObject({ mode: 'memory' })
  })

  it('keeps the durable new state when legacy cleanup is blocked', () => {
    const storage = new FakeStorage({ 'btw.bestCombo': '7' })
    storage.throwOnRemove = true

    const loaded = new ProgressStore(storage, options()).load()

    expect(loaded.mode).toBe('persistent')
    expect(loaded.state.lifetime.bestCombo).toBe(7)
    expect(storage.peek(PROGRESS_STORAGE_KEY)).not.toBeNull()
    expect(storage.peek('btw.bestCombo')).toBe('7')
  })
})

describe('ProgressStore checkpoints', () => {
  it.each<CheckpointReason>([
    'actionEnd',
    'targetDestroy',
    'unlock',
    'setting',
    'pagehide',
  ])('persists the %s checkpoint', (reason) => {
    const storage = new FakeStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify(createDefaultProgress('seed')),
    })
    const store = new ProgressStore(storage, options())
    const state = store.load().state
    state.lifetime.validHits = 2

    expect(store.save(state, reason)).toEqual({ ok: true })
    expect(JSON.parse(storage.peek(PROGRESS_STORAGE_KEY)!)).toEqual(state)
  })

  it('switches to memory mode on first save failure and never retries storage writes', () => {
    const notice = vi.fn()
    const storage = new FakeStorage({
      [PROGRESS_STORAGE_KEY]: JSON.stringify(createDefaultProgress('seed')),
    })
    const store = new ProgressStore(storage, options(notice))
    const state = store.load().state
    storage.throwOnSet = true

    expect(store.save(state, 'actionEnd')).toEqual({ ok: false, mode: 'memory' })
    const callsAfterFailure = storage.setCalls
    const next = { ...state, lifetime: { ...state.lifetime, validHits: 9 } }
    expect(store.save(next, 'pagehide')).toEqual({ ok: false, mode: 'memory' })
    expect(store.load()).toEqual({ state: next, mode: 'memory' })
    expect(storage.setCalls).toBe(callsAfterFailure)
    expect(notice).toHaveBeenCalledTimes(1)
  })

  it('does not retry writes after a new-install persistence failure', () => {
    const storage = new FakeStorage()
    storage.throwOnSet = true
    const store = new ProgressStore(storage, options())
    const loaded = store.load()
    const setCalls = storage.setCalls

    expect(store.save(loaded.state, 'pagehide')).toEqual({ ok: false, mode: 'memory' })
    expect(storage.setCalls).toBe(setCalls)
  })
})
