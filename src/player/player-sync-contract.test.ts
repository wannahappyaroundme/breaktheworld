import { describe, expect, it } from 'vitest'
import { ACHIEVEMENTS } from '../progress/catalog'
import { createDefaultProgress } from '../progress/defaults'
import type { ProgressStateV1 } from '../progress/types'
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_PUBLISHED_AT,
} from '../../supabase/functions/_shared/achievement-catalog'
import {
  applyPendingPlayerOperation,
  applyPlayerOperation,
  diffPlayerProgress,
  parseSyncBatch,
  type AcceptedPlayerProgressOperationV1,
  type PlayerProgressOperationV1,
  type SyncProgressState,
} from '../../supabase/functions/_shared/player-sync-contract'

const OPERATION_ID = '11111111-1111-4111-8111-111111111111'
const DEVICE_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-07-16T12:00:00.000Z'
const SERVER_NOW = '2026-07-18T12:00:00.000Z'

function zero(seed = '33333333-3333-4333-8333-333333333333'): SyncProgressState {
  return createDefaultProgress(seed)
}

function operation(
  delta: Partial<PlayerProgressOperationV1['delta']> = {},
  overrides: Partial<PlayerProgressOperationV1> = {}
): PlayerProgressOperationV1 {
  return {
    operationId: OPERATION_ID,
    operationVersion: 1,
    deviceId: DEVICE_ID,
    clientSeq: 1,
    createdAt: NOW,
    playDayKey: '2026-07-16',
    dailyQuest: null,
    delta: {
      validHits: 0,
      chargedFinishers: 0,
      totalTargets: 0,
      bestCombo: 0,
      addDistinctWeaponIds: [],
      byWeapon: {},
      byTarget: { word: 0, earth: 0, city: 0 },
      achievements: {},
      settings: {},
      ...delta,
    },
    ...overrides,
  }
}

function accepted(
  delta: Partial<PlayerProgressOperationV1['delta']> = {},
  overrides: Partial<AcceptedPlayerProgressOperationV1> = {}
): AcceptedPlayerProgressOperationV1 {
  return {
    ...operation(delta, overrides),
    acceptedOrder: 1,
    acceptedAt: NOW,
    ...overrides,
  }
}

function assignedDaily(event: 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED') {
  return {
    dayKey: '2026-07-16',
    questId: event === 'WEAPON_USED' ? 'characters_3' : 'targets_3',
    quest: {
      copy: event === 'WEAPON_USED' ? '캐릭터 3종 만나기' : '타겟 3개 부수기',
      event,
      distinct: event === 'WEAPON_USED' ? 'weaponId' as const : null,
    },
    target: 3,
    progress: 0,
    distinctIds: [],
    completedAt: null,
    stampAwarded: false,
  }
}

describe('player sync contract', () => {
  it('parses exact operation keys and bounded batches', () => {
    const parsed = parseSyncBatch([operation({ validHits: 1 })])
    expect(parsed).toHaveLength(1)
    expect(parsed[0].delta.validHits).toBe(1)

    expect(() => parseSyncBatch([{ ...operation(), extra: true }])).toThrow('invalid_sync_batch')
    expect(() => parseSyncBatch([operation({}, { operationId: 'not-a-uuid' })])).toThrow('invalid_sync_batch')
    expect(() => parseSyncBatch([operation({}, { clientSeq: 0 })])).toThrow('invalid_sync_batch')
    expect(() => parseSyncBatch([operation({ validHits: -1 })])).toThrow('invalid_sync_batch')
    expect(() => parseSyncBatch([operation({ totalTargets: 1001 })])).toThrow('invalid_sync_batch')
    expect(() => parseSyncBatch(Array.from({ length: 101 }, (_, index) => operation({}, {
      operationId: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
      clientSeq: index + 1,
    })))).toThrow('invalid_sync_batch')
  })

  it('rejects unknown catalog IDs and oversized operation content', () => {
    expect(() => parseSyncBatch([operation({ addDistinctWeaponIds: ['unknown'] })])).toThrow()
    expect(() => parseSyncBatch([operation({
      byWeapon: { hammer: { uses: 1, finishes: 0, addSeenMoves: ['unknown'] } },
    })])).toThrow()
    expect(() => parseSyncBatch([operation({
      achievements: { unknown: { unlockedAt: NOW, seen: false } },
    })])).toThrow()
    expect(() => parseSyncBatch([operation({
      settings: { unknown: true } as never,
    })])).toThrow()
    expect(() => parseSyncBatch([operation({}, {
      dailyQuest: {
        id: 'targets_3',
        copy: `타${'겟'.repeat(33_000)}`,
        event: 'TARGET_DESTROYED',
        distinct: null,
        target: 3,
      },
    })])).toThrow()
  })

  it('diffs monotonic progress without uploading seed or derived stamps', () => {
    const previous = zero('guest-seed-never-uploaded')
    const next: ProgressStateV1 = structuredClone(previous)
    next.installSeed = 'player-local-seed'
    next.lifetime.validHits = 2
    next.lifetime.stamps = 9
    next.lifetime.distinctWeaponIds = ['hammer']
    next.byWeapon.hammer = { uses: 1, finishes: 0, seenMoves: ['tap'] }
    next.byTarget.word.destroys = 1
    next.profile.reducedMotion = true

    const draft = diffPlayerProgress(previous, next, { nowIso: NOW })
    expect(draft).toEqual(expect.objectContaining({
      createdAt: NOW,
      delta: expect.objectContaining({
        validHits: 2,
        addDistinctWeaponIds: ['hammer'],
        settings: { reducedMotion: true },
      }),
    }))
    expect(JSON.stringify(draft)).not.toContain('guest-seed-never-uploaded')
    expect(JSON.stringify(draft)).not.toContain('player-local-seed')
    expect(JSON.stringify(draft)).not.toContain('"stamps"')
    expect(diffPlayerProgress(next, structuredClone(next), { nowIso: NOW })).toBeNull()
  })

  it('rejects counter decreases instead of emitting negative corrections', () => {
    const previous = zero()
    previous.lifetime.validHits = 2
    const next = structuredClone(previous)
    next.lifetime.validHits = 1
    expect(() => diffPlayerProgress(previous, next, { nowIso: NOW })).toThrow('progress_decreased')
  })

  it('sums counters, maximizes best combo, unions sets, and isolates settings', () => {
    const left = accepted({
      validHits: 2,
      bestCombo: 8,
      addDistinctWeaponIds: ['hammer'],
      settings: { reducedMotion: true },
    })
    const right = accepted({
      validHits: 3,
      bestCombo: 5,
      addDistinctWeaponIds: ['cat'],
      settings: { haptics: false },
    }, {
      operationId: '44444444-4444-4444-8444-444444444444',
      acceptedOrder: 2,
    })
    const merged = [right, left]
      .sort((a, b) => a.acceptedOrder - b.acceptedOrder)
      .reduce((state, item) => applyPlayerOperation(state, item), zero())

    expect(merged.lifetime.validHits).toBe(5)
    expect(merged.lifetime.bestCombo).toBe(8)
    expect(merged.lifetime.distinctWeaponIds).toEqual(['cat', 'hammer'])
    expect(merged.profile.reducedMotion).toBe(true)
    expect(merged.profile.haptics).toBe(false)
  })

  it('ignores forged unlock timestamps and seen claims for achievements the server cannot reach', () => {
    const next = applyPlayerOperation(zero(), accepted({
      achievements: {
        weapons_21x25: { unlockedAt: '2000-01-01T00:00:00.000Z', seen: true },
      },
    }, { acceptedAt: SERVER_NOW }))
    expect(next.achievements.weapons_21x25).toBeUndefined()
  })

  it('uses trusted accepted time after counters satisfy a condition and only then merges seen', () => {
    const reached = applyPlayerOperation(zero(), accepted({ validHits: 1 }, {
      acceptedAt: SERVER_NOW,
    }))
    expect(reached.achievements.first_hit).toEqual({ unlockedAt: SERVER_NOW, seen: false })

    const seen = applyPlayerOperation(reached, accepted({
      achievements: {
        first_hit: { unlockedAt: '2000-01-01T00:00:00.000Z', seen: true },
      },
    }, {
      operationId: '55555555-5555-4555-8555-555555555555',
      acceptedOrder: 2,
      acceptedAt: '2026-07-18T12:01:00.000Z',
    }))
    expect(seen.achievements.first_hit).toEqual({ unlockedAt: SERVER_NOW, seen: true })
  })

  it('uses created time for optimistic reachability without trusting the claimed timestamp', () => {
    const next = applyPendingPlayerOperation(zero(), operation({
      validHits: 1,
      achievements: {
        first_hit: { unlockedAt: '2000-01-01T00:00:00.000Z', seen: true },
      },
    }, { createdAt: SERVER_NOW }))
    expect(next.achievements.first_hit).toEqual({ unlockedAt: SERVER_NOW, seen: true })
  })

  it('accepts every catalog achievement in operation version one and rejects a 33rd ID', () => {
    const achievements = Object.fromEntries(ACHIEVEMENT_CATALOG.map(({ id }) => [id, {
      unlockedAt: NOW,
      seen: false,
    }]))
    expect(parseSyncBatch([operation({ achievements })])[0].operationVersion).toBe(1)
    expect(() => parseSyncBatch([operation({ achievements: {
      ...achievements,
      forged_33rd: { unlockedAt: NOW, seen: false },
    } })])).toThrow('invalid_sync_batch')
  })

  it('authorizes exact cosmetic selections from the server-derived level', () => {
    const levelFive = zero()
    levelFive.lifetime.validHits = 100
    levelFive.lifetime.chargedFinishers = 10
    levelFive.profile.frameId = 'first_crack'

    const locked = applyPlayerOperation(levelFive, accepted({
      settings: { frameId: 'legend_crown', recordBookThemeId: 'legend_crown' },
    }, { acceptedAt: SERVER_NOW }))
    expect(locked.profile.frameId).toBe('first_crack')
    expect(locked.profile.recordBookThemeId).toBe('default')

    expect(() => parseSyncBatch([operation({
      settings: { frameId: 'unknown_frame' } as never,
    })])).toThrow('invalid_sync_batch')
    expect(() => parseSyncBatch([operation({
      settings: { selectedTitle: '첫 금' },
    })])).toThrow('invalid_sync_batch')
    expect(parseSyncBatch([operation({
      settings: { selectedTitle: '첫 와장창' },
    })])[0].delta.settings.selectedTitle).toBe('첫 와장창')
  })

  it('uses only the explicit server assignment for daily evidence and completes once', () => {
    const clientLie = {
      id: 'characters_3',
      copy: '캐릭터 3종 만나기',
      event: 'WEAPON_USED' as const,
      distinct: 'weaponId' as const,
      target: 1,
    }
    const op = accepted({ byTarget: { word: 1, earth: 1, city: 1 } }, { dailyQuest: clientLie })
    const once = applyPlayerOperation(zero(), op, assignedDaily('TARGET_DESTROYED'))
    const replayedFromSameBase = applyPlayerOperation(zero(), op, assignedDaily('TARGET_DESTROYED'))
    expect(once.daily.questId).toBe('targets_3')
    expect(once.daily.progress).toBe(3)
    expect(once.daily.completedAt).toBe(NOW)
    expect(once.daily.stampAwarded).toBe(true)
    expect(replayedFromSameBase).toEqual(once)
  })

  it('keeps pending daily progress provisional without awarding a stamp', () => {
    const visible = zero()
    visible.daily = assignedDaily('TARGET_DESTROYED')
    const next = applyPendingPlayerOperation(visible, operation({
      byTarget: { word: 1, earth: 1, city: 1 },
    }))
    expect(next.daily.progress).toBe(3)
    expect(next.daily.completedAt).toBeNull()
    expect(next.daily.stampAwarded).toBe(false)
  })

  it('uses one dependency-free achievement catalog across server and client modules', () => {
    expect(ACHIEVEMENTS.map(({ next, ...definition }) => definition)).toEqual(ACHIEVEMENT_CATALOG)
  })

  it('uses the publication epoch when existing counters are catalog-backfilled', () => {
    const old = zero()
    old.lifetime.validHits = 1_000
    const next = applyPlayerOperation(old, accepted({}, { acceptedAt: SERVER_NOW }))
    expect(next.achievements.hits_1000?.unlockedAt).toBe(ACHIEVEMENT_CATALOG_PUBLISHED_AT)
  })
})
