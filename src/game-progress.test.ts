import { describe, expect, it, vi } from 'vitest'
import { createDefaultProgress } from './progress/defaults'
import type { GameEvent } from './progress/events'
import {
  ProgressStore,
  type CheckpointReason,
  type ProgressLoadResult,
} from './progress/store'
import type { ProgressStateV1 } from './progress/types'
import { BUILT_IN_QUESTS, type QuestCatalogSnapshot } from './progress/catalog'
import { CHARACTER_MOVE_IDS } from './weapons/character-catalog'
import {
  ActionCheckpointBatcher,
  GameplayProgressBridge,
  GameProgressCoordinator,
  KNOWN_MOVE_IDS,
  KNOWN_WEAPON_IDS,
  TargetDestroyAttribution,
  createLazyStorageAdapter,
  createMemoryFallbackHandler,
  progressTargetId,
  type ProgressAnalyticsSink,
  type ProgressPersistence,
} from './game-progress'
import type {
  ActionDamageResolution,
  ActionResolution,
} from './combat/action-controller'

class FakeStore implements ProgressPersistence {
  readonly saves: Array<{ state: ProgressStateV1; reason: CheckpointReason }> = []

  constructor(private readonly initial: ProgressStateV1) {}

  load(): ProgressLoadResult {
    return { state: this.initial, mode: 'persistent' }
  }

  save(state: ProgressStateV1, reason: CheckpointReason) {
    this.saves.push({ state, reason })
    return { ok: true } as const
  }
}

const targetsCatalog: QuestCatalogSnapshot = {
  version: 1,
  quests: [BUILT_IN_QUESTS.find((quest) => quest.id === 'targets_3')!],
}

function coordinator(options: {
  state?: ProgressStateV1
  catalog?: QuestCatalogSnapshot
  notify?: ReturnType<typeof vi.fn>
  analytics?: ProgressAnalyticsSink
} = {}) {
  const store = new FakeStore(options.state ?? createDefaultProgress('seed'))
  const notify = options.notify ?? vi.fn()
  const progress = new GameProgressCoordinator({
    store,
    catalog: options.catalog ?? targetsCatalog,
    dayKey: '2026-07-17',
    nowIso: () => '2026-07-17T03:00:00.000Z',
    notify,
    analytics: options.analytics,
    knownWeaponIds: KNOWN_WEAPON_IDS,
    knownMoveIds: KNOWN_MOVE_IDS,
  })
  return { progress, store, notify }
}

function actionEvents(actionId = 1, targetRunId = 1): GameEvent[] {
  return [
    {
      type: 'ATTACK_RESOLVED', source: 'user', actionId, targetRunId,
      weaponId: 'hammer', moveId: 'quick', detached: 5,
    },
    { type: 'COMBO_CHANGED', source: 'user', value: 1 },
    {
      type: 'TARGET_DESTROYED', source: 'user', actionId, targetRunId,
      weaponId: 'hammer', targetId: 'word', golden: false,
    },
    { type: 'WEAPON_USED', source: 'user', actionId, targetRunId, weaponId: 'hammer' },
  ]
}

describe('GameProgressCoordinator', () => {
  it('loads one KST daily challenge and checkpoints a destroy batch exactly once', () => {
    const { progress, store, notify } = coordinator()

    const result = progress.dispatch(actionEvents(), 'targetDestroy')

    expect(result.accepted).toBe(4)
    expect(progress.state.daily).toMatchObject({
      dayKey: '2026-07-17', questId: 'targets_3', progress: 1, target: 3,
    })
    expect(progress.state.lifetime).toMatchObject({ validHits: 1, totalTargets: 1, bestCombo: 1 })
    expect(progress.state.byWeapon.hammer).toMatchObject({ uses: 1, finishes: 1 })
    expect(progress.state.achievements.first_destroy).toMatchObject({ seen: false })
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].reason).toBe('targetDestroy')
    expect(notify.mock.calls.map(([notice]) => notice.kind)).toEqual(['achievement', 'quest'])
  })

  it('rejects duplicate settlement ids without double progress, analytics, or checkpoint', () => {
    const track = vi.fn()
    const { progress, store } = coordinator({ analytics: { track } })
    const events = actionEvents().filter((event) => event.type !== 'COMBO_CHANGED')

    progress.dispatch(events, 'targetDestroy')
    const saveCount = store.saves.length
    const analyticsCount = track.mock.calls.length
    progress.dispatch(events, 'targetDestroy')

    expect(progress.state.lifetime.totalTargets).toBe(1)
    expect(progress.state.byWeapon.hammer.uses).toBe(1)
    expect(store.saves).toHaveLength(saveCount)
    expect(track).toHaveBeenCalledTimes(analyticsCount)
  })

  it('ignores demo and system outcomes for progress, notices, saves, and analytics', () => {
    const track = vi.fn()
    const { progress, store, notify } = coordinator({ analytics: { track } })
    const demo = actionEvents().map((event): GameEvent => (
      event.type === 'SETTING_CHANGED' ? event : { ...event, source: 'demo' }
    ))

    expect(progress.dispatch(demo, 'targetDestroy').accepted).toBe(0)
    expect(progress.state.lifetime.totalTargets).toBe(0)
    expect(progress.state.lifetime.validHits).toBe(0)
    expect(store.saves).toHaveLength(0)
    expect(notify).not.toHaveBeenCalled()
    expect(track).not.toHaveBeenCalled()
  })

  it('isolates analytics for partial charge, FEVER, and successful share events', async () => {
    const tracked: string[] = []
    const analytics: ProgressAnalyticsSink = {
      track(event) {
        tracked.push(event.type)
        if (event.type === 'FEVER_STARTED') throw new Error('offline')
        if (event.type === 'SHARE_COMPLETED') return Promise.reject(new Error('offline'))
      },
    }
    const { progress } = coordinator({ analytics })

    expect(() => progress.dispatch([
      {
        type: 'CHARGE_RELEASED', source: 'user', actionId: 7, targetRunId: 2,
        weaponId: 'hammer', charge: 0.6,
      },
      { type: 'FEVER_STARTED', source: 'user', combo: 30 },
      { type: 'SHARE_COMPLETED', source: 'user' },
    ])).not.toThrow()
    await Promise.resolve()

    expect(progress.state.lifetime.chargedFinishers).toBe(0)
    expect(tracked).toEqual(['CHARGE_RELEASED', 'FEVER_STARTED', 'SHARE_COMPLETED'])
  })

  it('accepts only unlocked titles and catalog skin choices, then marks records seen', () => {
    const state = createDefaultProgress('seed')
    state.achievements.first_destroy = {
      unlockedAt: '2026-07-17T03:00:00.000Z',
      seen: false,
    }
    const { progress, store } = coordinator({ state })

    expect(progress.selectTitle('꾹 와장창 장인')).toBe(false)
    expect(progress.selectTitle('첫 와장창')).toBe(true)
    expect(progress.selectSkin('cinnamoroll', 'classic')).toBe(true)
    expect(progress.selectSkin('ditto', 'corrupt')).toBe(false)
    expect(progress.markAchievementsSeen()).toBe(true)

    expect(progress.state.profile.selectedTitle).toBe('첫 와장창')
    expect(progress.state.profile.skins.cinnamoroll).toBe('classic')
    expect(progress.state.achievements.first_destroy.seen).toBe(true)
    expect(store.saves.map((save) => save.reason)).toEqual(['setting', 'setting', 'unlock'])
  })

  it('checkpoints pagehide without producing an analytics event', () => {
    const track = vi.fn()
    const { progress, store } = coordinator({ analytics: { track } })

    progress.checkpoint('pagehide')

    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].reason).toBe('pagehide')
    expect(track).not.toHaveBeenCalled()
  })

  it('adopts a later validated catalog without rerolling the same-day quest', () => {
    const { progress } = coordinator()
    const assignedQuest = progress.state.daily.questId
    const updatedCatalog: QuestCatalogSnapshot = {
      version: 2,
      quests: [{
        ...targetsCatalog.quests[0],
        copy: '오늘은 타겟 3개 와장창',
      }],
    }

    expect(progress.setCatalog(updatedCatalog)).toBe(true)
    expect(progress.state.daily.questId).toBe(assignedQuest)
    expect(progress.questCatalog.version).toBe(2)
    progress.dispatch([actionEvents()[2]], 'targetDestroy')
    expect(progress.state.daily.progress).toBe(1)
  })

  it.each(['constructor', 'toString', '__proto__', 'unknown'])(
    'rejects unknown skin character key %s without throwing',
    (characterId) => {
      const { progress } = coordinator()
      expect(() => progress.selectSkin(characterId, 'classic')).not.toThrow()
      expect(progress.selectSkin(characterId, 'classic')).toBe(false)
    }
  )

  it('normalizes replacement catalogs and rejects unsafe or contradictory rows', () => {
    const { progress } = coordinator()
    const valid = targetsCatalog.quests[0]
    const malicious: QuestCatalogSnapshot = {
      version: 2,
      quests: [{ ...valid, accepts: () => { throw new Error('remote code') } }],
    }

    expect(progress.setCatalog(malicious)).toBe(true)
    expect(() => progress.dispatch([actionEvents()[2]], 'targetDestroy')).not.toThrow()
    expect(progress.state.daily.progress).toBe(1)

    for (const quests of [
      [valid, valid],
      [{ ...valid, id: 'Bad-ID' }],
      [{ ...valid, target: 101 }],
      [{ ...valid, distinct: 'weaponId' as const }],
    ]) {
      expect(progress.setCatalog({ version: 3, quests })).toBe(false)
    }
  })

  it('boots in memory and notifies once when the localStorage getter itself is blocked', () => {
    const fallback = vi.fn()
    const store = new ProgressStore(createLazyStorageAdapter(() => {
      throw new DOMException('blocked', 'SecurityError')
    }), {
      knownWeaponIds: KNOWN_WEAPON_IDS,
      knownMoveIds: KNOWN_MOVE_IDS,
      onMemoryFallback: fallback,
    })

    const progress = new GameProgressCoordinator({
      store,
      catalog: targetsCatalog,
      dayKey: '2026-07-17',
      nowIso: () => '2026-07-17T03:00:00.000Z',
      notify: vi.fn(),
    })
    progress.checkpoint('pagehide')
    progress.checkpoint('pagehide')

    expect(progress.state.installSeed).not.toBe('')
    expect(fallback).toHaveBeenCalledOnce()
  })
})

describe('GameplayProgressBridge', () => {
  const damage: ActionDamageResolution = {
    actionId: 21,
    targetRunId: 8,
    weaponId: 'cinnamoroll',
    kind: 'quick',
    moveId: 'cloudBounce',
    charge: 0,
    damage: { detached: 5, before: 5, remaining: 0, initial: 40, destroyed: true },
  }
  const settlement: ActionResolution = {
    actionId: 21,
    targetRunId: 8,
    weaponId: 'cinnamoroll',
    kind: 'quick',
    moveId: 'cloudBounce',
    charge: 0,
  }

  it('builds truthful point events and one destroy checkpoint in callback order', () => {
    const dispatch = vi.fn()
    const attributed = vi.fn(() => 14)
    const bridge = new GameplayProgressBridge({
      dispatch,
      getSource: () => 'user',
      onDamageFeedback: () => 9,
      onUserDestroyed: attributed,
    })

    bridge.onDamage(damage)
    bridge.onDestroyed(damage, 'word', true)
    bridge.onSettled(settlement)

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0]).toEqual([[
      {
        type: 'ATTACK_RESOLVED', source: 'user', actionId: 21, targetRunId: 8,
        weaponId: 'cinnamoroll', moveId: 'cloudBounce', detached: 5,
      },
      { type: 'COMBO_CHANGED', source: 'user', value: 9 },
      {
        type: 'TARGET_DESTROYED', source: 'user', actionId: 21, targetRunId: 8,
        weaponId: 'cinnamoroll', targetId: 'word', golden: true,
      },
      { type: 'COMBO_CHANGED', source: 'user', value: 14 },
      {
        type: 'WEAPON_USED', source: 'user', actionId: 21, targetRunId: 8,
        weaponId: 'cinnamoroll',
      },
    ], 'targetDestroy'])
    expect(attributed).toHaveBeenCalledWith(8, true)
  })

  it('saves a synchronous golden destroy and its bonus combo exactly once', () => {
    const { progress, store } = coordinator()
    const bridge = new GameplayProgressBridge({
      dispatch: (events, reason) => progress.dispatch(events, reason),
      getSource: () => 'user',
      onDamageFeedback: () => 9,
      onUserDestroyed: () => 14,
    })

    bridge.onDamage(damage)
    bridge.onDestroyed(damage, 'word', true)
    bridge.onSettled(settlement)

    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].reason).toBe('targetDestroy')
    expect(progress.state.lifetime.bestCombo).toBe(14)
    expect(progress.state.lifetime.totalTargets).toBe(1)
  })

  it('saves one settlement then one delayed golden impact, never a third checkpoint', () => {
    const { progress, store } = coordinator()
    const scheduled: Array<() => void> = []
    const bridge = new GameplayProgressBridge({
      dispatch: (events, reason) => progress.dispatch(events, reason),
      getSource: () => 'user',
      onDamageFeedback: () => 9,
      onUserDestroyed: () => 14,
      schedule: (run) => scheduled.push(run),
    })

    bridge.onSettled(settlement)
    bridge.onDamage(damage)
    bridge.onDestroyed(damage, 'word', true)
    expect(store.saves.map((save) => save.reason)).toEqual(['actionEnd'])
    scheduled[0]()

    expect(store.saves.map((save) => save.reason)).toEqual(['actionEnd', 'targetDestroy'])
    expect(progress.state.lifetime.bestCombo).toBe(14)
    expect(progress.state.lifetime.totalTargets).toBe(1)
  })

  it('routes demo callbacks as non-progressing events through the real coordinator', () => {
    const { progress, store } = coordinator()
    const bridge = new GameplayProgressBridge({
      dispatch: (events, reason) => progress.dispatch(events, reason),
      getSource: () => 'demo',
      onDamageFeedback: () => 2,
      onUserDestroyed: vi.fn(),
    })

    bridge.onDamage(damage)
    bridge.onDestroyed(damage, 'word', false)
    bridge.onSettled(settlement)

    expect(progress.state.lifetime.validHits).toBe(0)
    expect(progress.state.lifetime.totalTargets).toBe(0)
    expect(store.saves).toHaveLength(0)
  })

  it('emits partial charged settlement while leaving target mapping data-only', () => {
    const dispatch = vi.fn()
    const bridge = new GameplayProgressBridge({
      dispatch,
      getSource: () => 'user',
      onDamageFeedback: () => 0,
      onUserDestroyed: vi.fn(),
    })
    bridge.onSettled({ ...settlement, kind: 'charged', charge: 0.6 })

    expect(dispatch.mock.calls[0][0]).toEqual([
      {
        type: 'WEAPON_USED', source: 'user', actionId: 21, targetRunId: 8,
        weaponId: 'cinnamoroll',
      },
      {
        type: 'CHARGE_RELEASED', source: 'user', actionId: 21, targetRunId: 8,
        weaponId: 'cinnamoroll', charge: 0.6,
      },
    ])
    expect(progressTargetId('세상')).toBe('word')
    expect(progressTargetId('지구')).toBe('earth')
    expect(progressTargetId('도시')).toBe('city')
  })
})

describe('TargetDestroyAttribution', () => {
  it('keeps at most one run and clears cancelled/reset attribution', () => {
    const attribution = new TargetDestroyAttribution()
    attribution.record(4)
    attribution.clear()
    expect(attribution.consume(4)).toBe(false)

    attribution.record(4)
    attribution.record(5)
    expect(attribution.pendingRunId).toBe(5)
    expect(attribution.consume(4)).toBe(false)
    expect(attribution.consume(5)).toBe(true)
    expect(attribution.pendingRunId).toBeNull()
  })
})

describe('ActionCheckpointBatcher', () => {
  const identity = { actionId: 11, targetRunId: 4 }
  const attack = actionEvents()[0]
  const combo = actionEvents()[1]
  const destroyed = actionEvents()[2]
  const used = actionEvents()[3]

  it('batches synchronous point damage, destroy, and settlement into one checkpoint', () => {
    const dispatch = vi.fn()
    const batcher = new ActionCheckpointBatcher({ dispatch })

    batcher.recordImpact(identity, [attack, combo])
    batcher.recordDestroy(identity, destroyed)
    batcher.recordSettlement(identity, [used])

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch).toHaveBeenCalledWith([attack, combo, destroyed, used], 'targetDestroy')
  })

  it('checkpoints character settlement first and one delayed impact batch later', () => {
    const dispatch = vi.fn()
    const scheduled: Array<() => void> = []
    const batcher = new ActionCheckpointBatcher({
      dispatch,
      schedule: (run) => scheduled.push(run),
    })

    batcher.recordSettlement(identity, [used])
    batcher.recordImpact(identity, [attack, combo])
    batcher.recordDestroy(identity, destroyed)

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, [used], 'actionEnd')
    expect(scheduled).toHaveLength(1)
    scheduled[0]()
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(
      2,
      [attack, combo, destroyed],
      'targetDestroy'
    )
  })

  it('ignores duplicate settlement and destroy callbacks for the same action', () => {
    const dispatch = vi.fn()
    const batcher = new ActionCheckpointBatcher({ dispatch })

    batcher.recordImpact(identity, [attack])
    batcher.recordDestroy(identity, destroyed)
    batcher.recordDestroy(identity, destroyed)
    batcher.recordSettlement(identity, [used])
    batcher.recordSettlement(identity, [used])

    expect(dispatch).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0][0]).toEqual([attack, destroyed, used])
  })

  it('flushes delayed impacts immediately when an injected scheduler throws', () => {
    const dispatch = vi.fn()
    const batcher = new ActionCheckpointBatcher({
      dispatch,
      schedule: () => { throw new Error('scheduler unavailable') },
    })

    batcher.recordSettlement(identity, [used])
    expect(() => batcher.recordImpact(identity, [attack])).not.toThrow()

    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(2, [attack], 'actionEnd')
  })
})

describe('progress runtime catalogs and fallback copy', () => {
  it('supplies all 21 weapons, stable elemental moves, and the actual 27 character moves', () => {
    expect(KNOWN_WEAPON_IDS).toHaveLength(21)
    expect(KNOWN_MOVE_IDS).toEqual(expect.arrayContaining(['quick', 'drag', 'charged']))
    for (const ids of Object.values(CHARACTER_MOVE_IDS)) {
      expect(KNOWN_MOVE_IDS).toEqual(expect.arrayContaining([...ids]))
    }
  })

  it('shows the positive memory-mode notice once per session', () => {
    const notify = vi.fn()
    const handleFallback = createMemoryFallbackHandler(notify)

    handleFallback()
    handleFallback()

    expect(notify).toHaveBeenCalledOnce()
    const noticeText = notify.mock.calls[0][0].text as string
    expect(noticeText).toContain('계속 이어져요')
    expect(noticeText).not.toContain('실패')
    expect(noticeText).not.toContain('—')
  })
})
