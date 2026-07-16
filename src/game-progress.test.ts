import { describe, expect, it, vi } from 'vitest'
import { createDefaultProgress } from './progress/defaults'
import type { GameEvent } from './progress/events'
import {
  ProgressStore,
  type CheckpointReason,
  type ProgressLoadResult,
} from './progress/store'
import type { ProgressStateV1 } from './progress/types'
import {
  BUILT_IN_QUESTS,
  createQuestDefinition,
  type QuestCatalogSnapshot,
} from './progress/catalog'
import { kstDayKey } from './progress/day'
import { parseProgress } from './progress/validate'
import { makeRecordBookView } from './progress/view-model'
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
import { GameAnalyticsBridge, type GameAnalyticsSink } from './analytics/game-bridge'

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
  deferDailyAssignment?: boolean
  onDailyQuestTransition?: (previous: string | null, next: string | null) => void
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
    deferDailyAssignment: options.deferDailyAssignment,
    onDailyQuestTransition: options.onDailyQuestTransition,
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

  it('keeps lifetime and settings while gamification is disabled without daily, stamps, achievements, or notices', () => {
    const { progress, store, notify } = coordinator()
    const initialDaily = structuredClone(progress.state.daily)

    const result = progress.dispatch(actionEvents(), 'targetDestroy', {
      gamificationEnabled: false,
    })
    progress.dispatch([{
      type: 'SETTING_CHANGED',
      key: 'haptics',
      value: false,
    }], 'setting', { gamificationEnabled: false })

    expect(result.accepted).toBe(4)
    expect(progress.state.lifetime).toMatchObject({
      validHits: 1,
      totalTargets: 1,
      bestCombo: 1,
      stamps: 0,
    })
    expect(progress.state.byWeapon.hammer).toMatchObject({ uses: 1, finishes: 1 })
    expect(progress.state.profile.haptics).toBe(false)
    expect(progress.state.daily).toEqual(initialDaily)
    expect(progress.state.achievements).toEqual({})
    expect(notify).not.toHaveBeenCalled()
    expect(store.saves.map((save) => save.reason)).toEqual(['targetDestroy', 'setting'])
  })

  it('does not unlock already-qualified records from a setting-only checkpoint while gamification is disabled', () => {
    const state = createDefaultProgress('seed')
    state.lifetime.totalTargets = 1
    const { progress, store, notify } = coordinator({ state })
    const initialDaily = structuredClone(progress.state.daily)

    progress.dispatch([{
      type: 'SETTING_CHANGED',
      key: 'reducedMotion',
      value: true,
    }], 'setting', { gamificationEnabled: false })

    expect(progress.state.profile.reducedMotion).toBe(true)
    expect(progress.state.achievements.first_destroy).toBeUndefined()
    expect(progress.state.daily).toEqual(initialDaily)
    expect(notify).not.toHaveBeenCalled()
    expect(store.saves).toHaveLength(1)
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

  it('assigns a truly unassigned day once from the resolved remote catalog', () => {
    const remoteCatalog: QuestCatalogSnapshot = {
      version: 7,
      quests: [{
        ...targetsCatalog.quests[0],
        id: 'remote_targets',
        copy: '오늘은 타겟 7개 와장창',
        target: 7,
      }],
    }
    const { progress, store } = coordinator({ deferDailyAssignment: true })

    expect(progress.state.daily.questId).toBe('')
    expect(progress.setCatalog(remoteCatalog)).toBe(true)
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(true)
    expect(progress.state.daily).toMatchObject({
      dayKey: '2026-07-17', questId: 'remote_targets', target: 7,
    })
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(false)
    expect(store.saves.map((save) => save.reason)).toEqual(['dailyRollover'])
  })

  it('never replaces a persisted same-day assignment when remote data resolves', () => {
    const state = createDefaultProgress('seed')
    state.daily = {
      dayKey: '2026-07-17', questId: 'targets_3', target: 3, progress: 2,
      distinctIds: [], completedAt: null, stampAwarded: false,
    }
    const remoteCatalog: QuestCatalogSnapshot = {
      version: 7,
      quests: [{ ...targetsCatalog.quests[0], id: 'remote_targets', target: 7 }],
    }
    const { progress, store } = coordinator({ state, deferDailyAssignment: true })

    expect(progress.setCatalog(remoteCatalog)).toBe(true)
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(false)
    expect(progress.state.daily).toEqual(state.daily)
    expect(store.saves).toHaveLength(0)
  })

  it('restores an orphaned remote assignment with its exact stored semantics until rollover', () => {
    const orphan = createQuestDefinition({
      id: 'remote_characters_2',
      copy: '캐릭터 두 종류 만나기',
      event: 'WEAPON_USED',
      target: 2,
    })
    const assigned = coordinator({
      catalog: { version: 6, quests: [orphan] },
    }).progress.state
    const restored = parseProgress(
      JSON.parse(JSON.stringify(assigned)) as unknown,
      KNOWN_WEAPON_IDS,
      KNOWN_MOVE_IDS
    )
    const { progress } = coordinator({
      state: restored,
      catalog: targetsCatalog,
      deferDailyAssignment: true,
    })

    expect(progress.state.daily.quest).toEqual({
      copy: '캐릭터 두 종류 만나기',
      event: 'WEAPON_USED',
      distinct: 'weaponId',
    })
    expect(progress.setCatalog(targetsCatalog)).toBe(true)
    expect(makeRecordBookView(progress.state, progress.questCatalog).daily.copy)
      .toBe('캐릭터 두 종류 만나기')
    progress.dispatch([
      {
        type: 'ATTACK_RESOLVED', source: 'user', actionId: 71, targetRunId: 9,
        weaponId: 'cinnamoroll', moveId: 'cloudBounce', detached: 3,
      },
      {
        type: 'WEAPON_USED', source: 'user', actionId: 71, targetRunId: 9,
        weaponId: 'cinnamoroll',
      },
    ], 'actionEnd')
    expect(progress.state.daily).toMatchObject({
      questId: 'remote_characters_2', target: 2, progress: 1,
      distinctIds: ['cinnamoroll'],
    })

    expect(progress.ensureDailyQuest('2026-07-18')).toBe(true)
    expect(progress.state.daily.questId).toBe('targets_3')
  })

  it('replays bounded pre-catalog evidence into the resolved daily without duplicate side effects', () => {
    const track = vi.fn()
    const notify = vi.fn()
    const onDailyQuestTransition = vi.fn()
    const { progress, store } = coordinator({
      deferDailyAssignment: true,
      analytics: { track },
      notify,
      onDailyQuestTransition,
    })

    progress.dispatch(actionEvents(81, 10), 'targetDestroy')
    const trackedBeforeResolution = track.mock.calls.length
    expect(progress.state.daily.questId).toBe('')
    expect(progress.state.lifetime).toMatchObject({ validHits: 1, totalTargets: 1 })
    expect(store.saves.map((save) => save.reason)).toEqual(['targetDestroy'])

    expect(progress.setCatalog(targetsCatalog)).toBe(true)
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(true)
    expect(progress.state.daily).toMatchObject({ questId: 'targets_3', progress: 1 })
    expect(progress.state.lifetime).toMatchObject({ validHits: 1, totalTargets: 1 })
    expect(progress.state.byWeapon.hammer).toMatchObject({ uses: 1, finishes: 1 })
    expect(track).toHaveBeenCalledTimes(trackedBeforeResolution)
    expect(store.saves.map((save) => save.reason))
      .toEqual(['targetDestroy', 'dailyRollover'])
    expect(notify.mock.calls.filter(([notice]) => notice.kind === 'quest')).toHaveLength(1)
    expect(onDailyQuestTransition).not.toHaveBeenCalled()

    expect(progress.ensureDailyQuest('2026-07-17')).toBe(false)
    expect(track).toHaveBeenCalledTimes(trackedBeforeResolution)
    expect(store.saves).toHaveLength(2)
    expect(notify.mock.calls.filter(([notice]) => notice.kind === 'quest')).toHaveLength(1)
  })

  it('discards pre-catalog daily evidence when resolved gamification is closed', () => {
    const notify = vi.fn()
    const onDailyQuestTransition = vi.fn()
    const { progress } = coordinator({
      deferDailyAssignment: true,
      notify,
      onDailyQuestTransition,
    })
    progress.dispatch(actionEvents(91, 11), 'targetDestroy', { gamificationEnabled: false })
    progress.setCatalog(targetsCatalog)

    expect(progress.ensureDailyQuest('2026-07-17', { gamificationEnabled: false })).toBe(true)
    expect(progress.state.daily).toMatchObject({ questId: 'targets_3', progress: 0 })
    expect(notify.mock.calls.filter(([notice]) => notice.kind === 'quest')).toHaveLength(0)
    expect(onDailyQuestTransition).not.toHaveBeenCalled()
  })

  it('emits quest-complete analytics once when buffered evidence completes the resolved quest', () => {
    const target: GameAnalyticsSink = {
      track: vi.fn(),
      setEnabled: vi.fn(),
      trackChargeRelease: vi.fn(),
      trackChargeCancel: vi.fn(),
      trackQuestComplete: vi.fn(),
      flushOnPageHide: vi.fn(),
    }
    const analytics = new GameAnalyticsBridge(true)
    analytics.attach(target)
    const oneTargetCatalog: QuestCatalogSnapshot = {
      version: 9,
      quests: [createQuestDefinition({
        id: 'remote_target_1',
        copy: '타겟 하나 부수기',
        event: 'TARGET_DESTROYED',
        target: 1,
      })],
    }
    const { progress } = coordinator({
      deferDailyAssignment: true,
      analytics,
      onDailyQuestTransition: (previous, next) => {
        analytics.trackQuestTransition(previous, next, 'user', true)
      },
    })

    progress.dispatch(actionEvents(101, 12), 'targetDestroy')
    progress.setCatalog(oneTargetCatalog)
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(true)
    expect(progress.state.daily.completedAt).not.toBeNull()
    expect(target.trackQuestComplete).toHaveBeenCalledOnce()

    expect(progress.ensureDailyQuest('2026-07-17')).toBe(false)
    progress.setCatalog(oneTargetCatalog)
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(false)
    expect(target.trackQuestComplete).toHaveBeenCalledOnce()
  })

  it('does not emit completion analytics for an already completed persisted quest', () => {
    const state = coordinator().progress.state
    state.daily = {
      ...state.daily,
      progress: state.daily.target,
      completedAt: '2026-07-17T00:00:00.000Z',
      stampAwarded: true,
    }
    const onDailyQuestTransition = vi.fn()
    const { progress } = coordinator({ state, onDailyQuestTransition })

    progress.setCatalog(targetsCatalog)
    expect(progress.ensureDailyQuest('2026-07-17')).toBe(false)
    expect(onDailyQuestTransition).not.toHaveBeenCalled()
  })

  it('rolls an open session at the KST 04:00 boundary before the next event exactly once', () => {
    const remoteCatalog: QuestCatalogSnapshot = {
      version: 7,
      quests: [{ ...targetsCatalog.quests[0], id: 'remote_targets', target: 7 }],
    }
    const { progress, store } = coordinator()
    progress.setCatalog(remoteCatalog)

    expect(progress.ensureDailyQuest(kstDayKey(new Date('2026-07-17T18:59:59Z')))).toBe(false)
    expect(progress.ensureDailyQuest(kstDayKey(new Date('2026-07-17T19:00:00Z')))).toBe(true)
    progress.dispatch([actionEvents(8, 4)[2]], 'targetDestroy')
    expect(progress.state.daily).toMatchObject({
      dayKey: '2026-07-18', questId: 'remote_targets', progress: 1,
    })
    expect(progress.ensureDailyQuest('2026-07-18')).toBe(false)
    expect(store.saves.map((save) => save.reason)).toEqual(['dailyRollover', 'targetDestroy'])
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
    const track = vi.fn()
    const { progress, store } = coordinator({ analytics: { track } })
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
    expect(store.saves).toHaveLength(0)
    scheduled[0]()

    expect(store.saves.map((save) => save.reason)).toEqual(['targetDestroy'])
    expect(progress.state.lifetime.bestCombo).toBe(14)
    expect(progress.state.lifetime.totalTargets).toBe(1)
    expect(progress.state.byWeapon.cinnamoroll.uses).toBe(1)
    expect(track.mock.calls.flatMap(([event]) => event.type).filter((type) => type === 'WEAPON_USED'))
      .toHaveLength(1)
  })

  it('does not count a settled action that never produces checked positive damage', () => {
    const track = vi.fn()
    const { progress, store } = coordinator({ analytics: { track } })
    const bridge = new GameplayProgressBridge({
      dispatch: (events, reason) => progress.dispatch(events, reason),
      getSource: () => 'user',
      onDamageFeedback: () => 0,
      onUserDestroyed: vi.fn(),
    })

    bridge.onSettled(settlement)

    expect(progress.state.byWeapon.cinnamoroll).toBeUndefined()
    expect(progress.state.lifetime.distinctWeaponIds).toEqual([])
    expect(store.saves).toHaveLength(0)
    expect(track).not.toHaveBeenCalled()
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

  it('emits partial charge progress only after checked positive damage', () => {
    const dispatch = vi.fn()
    const scheduled: Array<() => void> = []
    const bridge = new GameplayProgressBridge({
      dispatch,
      getSource: () => 'user',
      onDamageFeedback: () => 0,
      onUserDestroyed: vi.fn(),
      schedule: (run) => scheduled.push(run),
    })
    bridge.onSettled({ ...settlement, kind: 'charged', charge: 0.6 })
    expect(dispatch).not.toHaveBeenCalled()
    bridge.onDamage({ ...damage, kind: 'charged', charge: 0.6 })
    scheduled[0]()

    expect(dispatch.mock.calls[0][0]).toEqual([
      {
        type: 'ATTACK_RESOLVED', source: 'user', actionId: 21, targetRunId: 8,
        weaponId: 'cinnamoroll', moveId: 'cloudBounce', detached: 5,
      },
      { type: 'COMBO_CHANGED', source: 'user', value: 0 },
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

    expect(dispatch).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)
    scheduled[0]()
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(
      1,
      [attack, combo, destroyed, used],
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

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenNthCalledWith(1, [attack, used], 'actionEnd')
  })

  it('does not lose destroy attribution when an injected scheduler runs synchronously', () => {
    const dispatch = vi.fn()
    const batcher = new ActionCheckpointBatcher({
      dispatch,
      schedule: (run) => run(),
    })

    batcher.recordSettlement(identity, [used])
    batcher.recordImpact(identity, [attack, combo])
    batcher.recordDestroy(identity, destroyed)

    expect(dispatch.mock.calls.flatMap(([events]) => events)).toContainEqual(destroyed)
    expect(dispatch.mock.calls.some(([, reason]) => reason === 'targetDestroy')).toBe(true)
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
