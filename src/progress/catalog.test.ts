import { describe, expect, it, vi } from 'vitest'
import { CHARACTER_IDS, isCharacterId } from '../weapons/character-ids'
import { createCharacterWeapons } from '../weapons/characters'
import { createDefaultProgress } from './defaults'
import { isCharacterWeaponId, type GameEvent } from './events'
import { kstDayKey } from './day'
import { reduceProgress } from './reducer'
import {
  ACHIEVEMENT_CATALOG_VERSION,
  ACHIEVEMENTS,
  BUILT_IN_CATALOG,
  BUILT_IN_QUESTS,
  achievementProgress,
  achievementReached,
  assignDailyQuest,
  availableFrameIds,
  availableThemeIds,
  createQuestDefinition,
  dailyNoticeTransitions,
  levelProgress,
  resolveQuestCatalog,
  totalAchievementXp,
  unlockAchievements,
  type QuestCatalogSnapshot,
} from './catalog'
import { parseProgress } from './validate'
import { makeRecordBookView } from './view-model'
import type { ProgressStateV1 } from './types'

const charge = (source: 'user' | 'demo' | 'system', value: number): GameEvent => ({
  type: 'CHARGE_RELEASED',
  source,
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
  charge: value,
})

const use = (
  source: 'user' | 'demo' | 'system',
  weaponId: string
): Extract<GameEvent, { type: 'WEAPON_USED' }> => ({
  type: 'WEAPON_USED',
  source,
  actionId: 1,
  targetRunId: 1,
  weaponId,
})

const destroy = (
  source: 'user' | 'demo' | 'system'
): Extract<GameEvent, { type: 'TARGET_DESTROYED' }> => ({
  type: 'TARGET_DESTROYED',
  source,
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
  targetId: 'word',
  golden: false,
})

function daily(
  state: ProgressStateV1,
  overrides: Partial<ProgressStateV1['daily']>
): ProgressStateV1 {
  return { ...state, daily: { ...state.daily, ...overrides } }
}

function assertPlainData(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  const prototype = Object.getPrototypeOf(value)
  expect(prototype === Object.prototype || prototype === Array.prototype).toBe(true)
  for (const child of Object.values(value as Record<string, unknown>)) assertPlainData(child)
}

describe('KST 04:00 day key', () => {
  it.each([
    ['2026-07-15T18:59:59Z', '2026-07-15'],
    ['2026-07-15T19:00:00Z', '2026-07-16'],
    ['2026-01-31T18:59:59Z', '2026-01-31'],
    ['2026-01-31T19:00:00Z', '2026-02-01'],
    ['2026-12-31T18:59:59Z', '2026-12-31'],
    ['2026-12-31T19:00:00Z', '2027-01-01'],
  ])('maps %s to %s', (instant, expected) => {
    expect(kstDayKey(new Date(instant))).toBe(expected)
  })

  it('is independent of input offset and host-local date getters', () => {
    const localYear = vi.spyOn(Date.prototype, 'getFullYear').mockImplementation(() => {
      throw new Error('host timezone getter used')
    })
    const instant = new Date('2026-07-15T14:59:59-04:00')

    try {
      expect(kstDayKey(instant)).toBe('2026-07-15')
      expect(kstDayKey(instant)).toBe(kstDayKey(new Date('2026-07-15T18:59:59Z')))
    } finally {
      localYear.mockRestore()
    }
  })
})

describe('canonical character IDs', () => {
  it('matches the actual ordered character weapon factory', () => {
    expect(createCharacterWeapons().map((weapon) => weapon.id)).toEqual(CHARACTER_IDS)
    expect(CHARACTER_IDS).toHaveLength(9)
    for (const id of CHARACTER_IDS) {
      expect(isCharacterId(id)).toBe(true)
      expect(isCharacterWeaponId(id)).toBe(true)
    }
    expect(isCharacterId('hammer')).toBe(false)
    expect(isCharacterWeaponId('hammer')).toBe(false)
  })
})

describe('quest catalog', () => {
  it('contains exactly the three approved quests in order', () => {
    expect(BUILT_IN_QUESTS.map((quest) => ({
      id: quest.id,
      copy: quest.copy,
      event: quest.event,
      target: quest.target,
      distinct: quest.distinct,
    }))).toEqual([
      {
        id: 'charged_finisher_2',
        copy: '꾹 와장창 2번',
        event: 'CHARGE_RELEASED',
        target: 2,
        distinct: undefined,
      },
      {
        id: 'characters_3',
        copy: '캐릭터 3종 만나기',
        event: 'WEAPON_USED',
        target: 3,
        distinct: 'weaponId',
      },
      {
        id: 'targets_3',
        copy: '타겟 3개 부수기',
        event: 'TARGET_DESTROYED',
        target: 3,
        distinct: undefined,
      },
    ])
    expect(BUILT_IN_CATALOG).toMatchObject({ version: 1, quests: BUILT_IN_QUESTS })
  })

  it('accepts only the approved user outcomes', () => {
    const [chargedQuest, characterQuest, targetQuest] = BUILT_IN_QUESTS

    expect(chargedQuest.accepts(charge('user', 1))).toBe(true)
    expect(chargedQuest.accepts(charge('user', 0.999))).toBe(false)
    expect(chargedQuest.accepts(charge('demo', 1))).toBe(false)
    expect(characterQuest.accepts(use('user', 'cinnamoroll'))).toBe(true)
    expect(characterQuest.accepts(use('user', 'hammer'))).toBe(false)
    expect(characterQuest.accepts(use('system', 'ditto'))).toBe(false)
    expect(targetQuest.accepts(destroy('user'))).toBe(true)
    expect(targetQuest.accepts(destroy('demo'))).toBe(false)
  })

  it('uses the catalog target as the validation fallback for all three quests', () => {
    for (const quest of BUILT_IN_QUESTS) {
      const parsed = parseProgress({
        installSeed: 'seed',
        daily: {
          dayKey: '2026-07-16',
          questId: quest.id,
          target: 0,
          progress: 0,
          distinctIds: [],
          completedAt: null,
          stampAwarded: false,
        },
      }, CHARACTER_IDS, [])
      expect(parsed.daily.target).toBe(quest.target)
    }
  })

  it('returns a typed remote catalog and falls back on absence or failure', async () => {
    const remote: QuestCatalogSnapshot = {
      version: 8,
      quests: [BUILT_IN_QUESTS[2]],
    }
    await expect(resolveQuestCatalog({ loadCatalog: async () => remote })).resolves.toBe(remote)
    await expect(resolveQuestCatalog({ loadCatalog: async () => null })).resolves.toBe(BUILT_IN_CATALOG)
    await expect(resolveQuestCatalog({
      loadCatalog: async () => { throw new Error('offline') },
    })).resolves.toBe(BUILT_IN_CATALOG)
    await expect(resolveQuestCatalog({
      loadCatalog: async () => ({
        version: 9,
        quests: [{ ...BUILT_IN_QUESTS[0], target: 0 }],
      }),
    })).resolves.toBe(BUILT_IN_CATALOG)

    const invalidCatalogs = [
      { version: 9, quests: [] },
      { version: 0, quests: [BUILT_IN_QUESTS[0]] },
      { version: 9, quests: [BUILT_IN_QUESTS[0], BUILT_IN_QUESTS[0]] },
      { version: 9, quests: [{ ...BUILT_IN_QUESTS[0], event: 'TICK' }] },
      { version: 9, quests: [{ ...BUILT_IN_QUESTS[0], distinct: 'targetId' }] },
      {
        version: 9,
        quests: [{
          id: 'custom_charge_2',
          copy: '꾹 와장창 2번',
          event: 'CHARGE_RELEASED',
          target: 2,
          distinct: undefined,
        }],
      },
    ]
    for (const catalog of invalidCatalogs) {
      await expect(resolveQuestCatalog({
        loadCatalog: async () => catalog as unknown as QuestCatalogSnapshot,
      })).resolves.toBe(BUILT_IN_CATALOG)
    }
  })
})

describe('custom daily quest reconnect', () => {
  it('keeps a valid 60-character Unicode snapshot across reload', () => {
    const copy = `가${'🙂'.repeat(59)}`
    const custom = createQuestDefinition({
      id: 'custom_unicode_2', copy, event: 'TARGET_DESTROYED', target: 2,
    })
    const assigned = assignDailyQuest(
      createDefaultProgress('unicode-seed'),
      '2026-07-17',
      { version: 8, quests: [custom] }
    )

    const restored = parseProgress(
      JSON.parse(JSON.stringify(assigned)) as unknown,
      ['hammer'],
      []
    )

    expect(restored.daily.quest?.copy).toBe(copy)
  })

  it('uses a local fixed predicate for custom definitions and never remote function code', () => {
    const custom = createQuestDefinition({
      id: 'custom_targets_2',
      copy: '타겟 2개 부수기',
      event: 'TARGET_DESTROYED',
      target: 2,
      accepts: () => true,
    } as Parameters<typeof createQuestDefinition>[0] & { accepts: () => boolean })

    expect(custom.distinct).toBeUndefined()
    expect(custom.accepts(destroy('user'))).toBe(true)
    expect(custom.accepts(destroy('demo'))).toBe(false)
    expect(custom.accepts(use('user', 'cinnamoroll'))).toBe(false)
  })

  it('assigns, serializes, restores, fixes same-day assignment, and completes a custom quest', () => {
    const custom = createQuestDefinition({
      id: 'custom_targets_2',
      copy: '타겟 2개 부수기',
      event: 'TARGET_DESTROYED',
      target: 2,
    })
    const customCatalog: QuestCatalogSnapshot = { version: 4, quests: [custom] }
    const assigned = assignDailyQuest(createDefaultProgress('install-custom'), '2026-07-17', customCatalog)
    expect(assigned.daily).toMatchObject({
      questId: 'custom_targets_2',
      target: 2,
      progress: 0,
    })

    const restored = parseProgress(
      JSON.parse(JSON.stringify(assigned)) as unknown,
      ['hammer'],
      [],
      customCatalog
    )
    expect(restored.daily).toEqual(assigned.daily)
    expect(assignDailyQuest(restored, '2026-07-17', BUILT_IN_CATALOG)).toBe(restored)

    const changedTargetCatalog: QuestCatalogSnapshot = {
      version: 5,
      quests: [createQuestDefinition({
        id: 'custom_targets_2',
        copy: '타겟 5개 부수기',
        event: 'TARGET_DESTROYED',
        target: 5,
      })],
    }
    const demo = reduceProgress(restored, {
      ...destroy('demo'),
      actionId: 1,
      targetRunId: 1,
    }, changedTargetCatalog)
    expect(demo).toBe(restored)
    const wrongEvent = reduceProgress(restored, {
      ...use('user', 'cinnamoroll'),
      actionId: 2,
      targetRunId: 1,
    }, changedTargetCatalog)
    expect(wrongEvent.daily.progress).toBe(0)

    const once = reduceProgress(wrongEvent, {
      ...destroy('user'),
      actionId: 3,
      targetRunId: 1,
    }, changedTargetCatalog)
    expect(once.daily.progress).toBe(1)
    const complete = reduceProgress(once, {
      ...destroy('user'),
      actionId: 4,
      targetRunId: 1,
    }, changedTargetCatalog)
    expect(complete.daily).toMatchObject({
      progress: 2,
      target: 2,
      stampAwarded: true,
    })
    expect(complete.daily.completedAt).not.toBeNull()
    expect(complete.lifetime.stamps).toBe(1)
  })

  it('preserves safe unknown custom progress and resets invalid custom IDs or targets', () => {
    const rawDaily = {
      dayKey: '2026-07-17',
      questId: 'custom_safe_4',
      target: 4,
      progress: 2,
      distinctIds: ['hammer'],
      completedAt: null,
      stampAwarded: false,
    }
    const safe = parseProgress({
      installSeed: 'seed',
      lifetime: { validHits: 8 },
      daily: rawDaily,
    }, ['hammer'], [])
    expect(safe.daily).toEqual({ ...rawDaily, distinctIds: [] })
    expect(safe.lifetime.validHits).toBe(8)

    const completedDaily = {
      ...rawDaily,
      progress: 4,
      completedAt: '2026-07-17T00:00:00.000Z',
      stampAwarded: true,
    }
    expect(parseProgress({ installSeed: 'seed', daily: completedDaily }, ['hammer'], []).daily)
      .toEqual({ ...completedDaily, distinctIds: [] })

    for (const dailyInput of [
      { ...rawDaily, questId: 'Bad-ID' },
      { ...rawDaily, questId: 'ab' },
      { ...rawDaily, target: 101 },
      { ...rawDaily, target: 0 },
    ]) {
      const parsed = parseProgress({ installSeed: 'seed', daily: dailyInput }, ['hammer'], [])
      expect(parsed.daily).toEqual(createDefaultProgress('seed').daily)
    }
  })
})

describe('daily assignment and notices', () => {
  it('keeps a stored same-day quest despite catalog reorder and version change', () => {
    const state = daily(createDefaultProgress('install-a'), {
      dayKey: '2026-07-16',
      questId: 'targets_3',
      target: 3,
      progress: 2,
      distinctIds: [],
    })
    const reordered: QuestCatalogSnapshot = {
      version: 9,
      quests: [...BUILT_IN_QUESTS].reverse(),
    }

    expect(assignDailyQuest(state, '2026-07-16', reordered)).toBe(state)
  })

  it('assigns a new day deterministically and clears every old daily field', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be used')
    })
    const previous = daily(createDefaultProgress('install-a'), {
      dayKey: '2026-07-16',
      questId: 'targets_3',
      target: 3,
      progress: 3,
      distinctIds: ['old'],
      completedAt: '2026-07-16T00:00:00.000Z',
      stampAwarded: true,
    })

    try {
      const first = assignDailyQuest(previous, '2026-07-17', BUILT_IN_CATALOG)
      const again = assignDailyQuest(previous, '2026-07-17', BUILT_IN_CATALOG)
      expect(again).toEqual(first)
      expect(first).not.toBe(previous)
      expect(first.catalogVersion).toBe(BUILT_IN_CATALOG.version)
      expect(first.daily).toEqual({
        dayKey: '2026-07-17',
        questId: expect.any(String),
        quest: expect.objectContaining({
          copy: expect.any(String),
          event: expect.stringMatching(/^(CHARGE_RELEASED|WEAPON_USED|TARGET_DESTROYED)$/),
        }),
        target: expect.any(Number),
        progress: 0,
        distinctIds: [],
        completedAt: null,
        stampAwarded: false,
      })
      expect(BUILT_IN_QUESTS.some((quest) => (
        quest.id === first.daily.questId && quest.target === first.daily.target
      ))).toBe(true)
      expect(previous.daily.completedAt).not.toBeNull()
    } finally {
      random.mockRestore()
    }
  })

  it('emits only first, first-half crossing, and completion transitions', () => {
    const base = daily(createDefaultProgress('seed'), {
      dayKey: '2026-07-16',
      questId: 'targets_3',
      target: 3,
      progress: 0,
    }).daily
    const first = { ...base, progress: 1 }
    const half = { ...base, progress: 2 }
    const complete = {
      ...base,
      progress: 3,
      completedAt: '2026-07-16T00:00:00.000Z',
      stampAwarded: true,
    }

    expect(dailyNoticeTransitions(base, first)).toEqual(['first'])
    expect(dailyNoticeTransitions(first, half)).toEqual(['half'])
    expect(dailyNoticeTransitions(half, complete)).toEqual(['complete'])
    expect(dailyNoticeTransitions(complete, complete)).toEqual([])
    expect(dailyNoticeTransitions(half, half)).toEqual([])
    expect(dailyNoticeTransitions({ ...half, dayKey: '2026-07-15' }, complete)).toEqual([])
    const targetTwo = { ...base, target: 2, progress: 0 }
    const targetTwoFirst = { ...targetTwo, progress: 1 }
    const targetTwoComplete = {
      ...targetTwo,
      progress: 2,
      completedAt: '2026-07-16T00:00:00.000Z',
      stampAwarded: true,
    }
    expect(dailyNoticeTransitions(targetTwo, targetTwoFirst)).toEqual(['first'])
    expect(dailyNoticeTransitions(targetTwoFirst, targetTwoComplete)).toEqual(['complete'])
    expect(dailyNoticeTransitions(targetTwo, targetTwoComplete)).toEqual(['complete'])
    expect(dailyNoticeTransitions(
      { ...complete, completedAt: null, stampAwarded: false },
      complete
    )).toEqual(['complete'])
  })
})

describe('permanent achievements', () => {
  const countByTier = () => ACHIEVEMENTS.reduce<Record<string, number>>((counts, item) => {
    counts[item.tier] = (counts[item.tier] ?? 0) + 1
    return counts
  }, {})

  const pickAchievementNames = (ids: readonly string[]) => ids.map((id) => (
    ACHIEVEMENTS.find((item) => item.id === id)?.name
  ))

  it('defines the approved immutable achievement and XP contract', () => {
    expect(ACHIEVEMENT_CATALOG_VERSION).toBe(2)
    expect(ACHIEVEMENTS).toHaveLength(32)
    expect(new Set(ACHIEVEMENTS.map(({ id }) => id)).size).toBe(32)
    expect(countByTier()).toEqual({
      easy: 10,
      normal: 10,
      hard: 8,
      master: 4,
    })
    expect(ACHIEVEMENTS.reduce((sum, item) => sum + item.xp, 0)).toBe(4_700)
    expect(ACHIEVEMENTS.filter(({ titleReward }) => titleReward).map(({ name }) => name)).toEqual([
      '산산조각',
      '최애의 한 방',
      '끊기지 않는 손',
      '기술 박사',
      '무기 도감 완성',
      '모든 손의 마무리',
      '세계 순환 전문가',
      '모든 무기의 달인',
    ])
    expect(Object.isFrozen(ACHIEVEMENTS)).toBe(true)
    for (const item of ACHIEVEMENTS) {
      expect(Object.isFrozen(item)).toBe(true)
      expect(Object.isFrozen(item.condition)).toBe(true)
    }
  })

  it('keeps every legacy achievement identity and title', () => {
    expect(pickAchievementNames([
      'first_destroy', 'charge_master', 'variety_10', 'world_cycle', 'combo_50',
    ])).toEqual([
      '첫 와장창', '꾹 와장창 장인', '골고루 파괴', '세상 한 바퀴', '콤보 폭주',
    ])
  })

  it('evaluates every structural condition and bounds displayed progress', () => {
    const state = createDefaultProgress('seed')
    state.lifetime.validHits = 2_000
    state.lifetime.totalTargets = 200
    state.lifetime.chargedFinishers = 60
    state.lifetime.bestCombo = 120
    state.lifetime.stamps = 8
    state.lifetime.distinctWeaponIds = [
      'hammer', 'fist', 'glass', 'laser', 'meteor', 'missile', 'bomb',
      'lightning', 'flame', 'tornado', 'freeze', 'blackhole', 'cinnamoroll',
      'thanos', 'ironman', 'hulk', 'godzilla', 'dragonball', 'cat', 'ditto', 'pooh',
      'hammer',
    ]
    for (const id of state.lifetime.distinctWeaponIds) {
      state.byWeapon[id] = { uses: 25, finishes: 1, seenMoves: ['quick', 'drag'] }
    }
    state.byWeapon.hammer = { ...state.byWeapon.hammer, uses: 55, finishes: 55 }
    state.byTarget.word.destroys = 60
    state.byTarget.earth.destroys = 55
    state.byTarget.city.destroys = 50

    for (const achievement of ACHIEVEMENTS) {
      expect(achievementProgress(achievement, state)).toBe(achievement.target)
      expect(achievementReached(achievement, state)).toBe(true)
    }

    const result = unlockAchievements(state, '2026-07-16T01:02:03.000Z')
    expect(result.unlockedIds).toEqual(ACHIEVEMENTS.map((achievement) => achievement.id))
    expect(Object.keys(result.state.achievements)).toEqual(result.unlockedIds)
    expect(result.state.lifetime.stamps).toBe(8)
    expect(state.achievements).toEqual({})
  })

  it('derives XP and level only from recognized unlocked achievement IDs', () => {
    const state = createDefaultProgress('seed')
    state.achievements = {
      first_hit: { unlockedAt: '2026-07-16T00:00:00.000Z', seen: true },
      hits_1000: { unlockedAt: '2026-07-16T00:00:01.000Z', seen: false },
      unknown: { unlockedAt: '2026-07-16T00:00:02.000Z', seen: false },
    }
    state.lifetime.stamps = 999

    expect(totalAchievementXp(state)).toBe(250)
    expect(levelProgress(totalAchievementXp(state))).toEqual({
      level: 4,
      xp: 250,
      current: 200,
      next: 300,
      progress: 0.5,
    })
    expect(levelProgress(-1)).toEqual({ level: 1, xp: 0, current: 0, next: 50, progress: 0 })
    expect(levelProgress(Number.NaN)).toEqual({ level: 1, xp: 0, current: 0, next: 50, progress: 0 })
    expect(levelProgress(4_700)).toEqual({
      level: 20,
      xp: 4_700,
      current: 4_700,
      next: 4_700,
      progress: 1,
    })
    expect(levelProgress(9_999)).toEqual(levelProgress(4_700))
  })

  it('exposes only cosmetics earned at the supplied bounded level', () => {
    expect(availableFrameIds(1)).toEqual(['default'])
    expect(availableFrameIds(5)).toEqual(['default', 'first_crack'])
    expect(availableFrameIds(10)).toEqual(['default', 'first_crack', 'electric_night'])
    expect(availableFrameIds(15)).toEqual([
      'default', 'first_crack', 'electric_night', 'coral_burst',
    ])
    expect(availableFrameIds(20)).toEqual([
      'default', 'first_crack', 'electric_night', 'coral_burst', 'legend_crown',
    ])
    expect(availableFrameIds(99)).toEqual(availableFrameIds(20))
    expect(availableFrameIds(Number.NaN)).toEqual(['default'])

    expect(availableThemeIds(1)).toEqual(['default'])
    expect(availableThemeIds(10)).toEqual(['default', 'electric_night'])
    expect(availableThemeIds(15)).toEqual(['default', 'electric_night', 'coral_burst'])
    expect(availableThemeIds(20)).toEqual([
      'default', 'electric_night', 'coral_burst', 'legend_crown',
    ])
    expect(availableThemeIds(99)).toEqual(availableThemeIds(20))
    expect(availableThemeIds(Number.NaN)).toEqual(['default'])
  })
})

describe('record-book view model', () => {
  it('returns stable ordered plain Korean display data without mutation or DOM values', () => {
    const state = daily(createDefaultProgress('seed'), {
      dayKey: '2026-07-16',
      questId: 'targets_3',
      target: 3,
      progress: 1,
    })
    state.lifetime.bestCombo = 27
    state.lifetime.totalTargets = 12
    state.lifetime.chargedFinishers = 4
    state.lifetime.distinctWeaponIds = ['fire', 'hammer']
    state.achievements.first_destroy = {
      unlockedAt: '2026-07-16T01:02:03.000Z',
      seen: false,
    }
    state.profile.selectedTitle = '첫 와장창'
    state.profile.skins = { cinnamoroll: 'classic', ditto: 'default' }
    const before = JSON.stringify(state)

    const view = makeRecordBookView(state, BUILT_IN_CATALOG)

    expect(view.daily).toEqual({
      heading: '오늘의 도전',
      copy: '타겟 3개 부수기',
      progress: 1,
      target: 3,
      progressText: '1 / 3',
      complete: false,
    })
    expect(view.achievements.heading).toBe('부순 기록')
    expect(view.achievements.items.map((item) => item.id)).toEqual(
      ACHIEVEMENTS.map((achievement) => achievement.id)
    )
    expect(view.achievements.items.find(({ id }) => id === 'first_destroy')).toMatchObject({
      name: '첫 와장창',
      complete: true,
      seen: false,
      selectableTitle: '첫 와장창',
    })
    expect(view.achievements.items.find(({ id }) => id === 'first_hit')?.selectableTitle).toBeNull()
    expect(view.skins).toEqual({
      heading: '캐릭터 모습',
      items: [
        {
          id: 'cinnamoroll',
          name: '시나모롤',
          choices: [
            { id: 'default', label: '기본', selected: false },
            { id: 'classic', label: '클래식', selected: true },
          ],
        },
        {
          id: 'ditto',
          name: '메타몽',
          choices: [
            { id: 'default', label: '기본', selected: true },
            { id: 'classic', label: '클래식', selected: false },
          ],
        },
      ],
    })
    expect(view.stats).toEqual({
      heading: '내 기록',
      items: [
        { label: '최고 연속', value: '27' },
        { label: '누적 파괴', value: '12' },
        { label: '충전 강타', value: '4' },
        { label: '사용한 무기', value: '2종' },
      ],
    })
    expect(view.selectedTitle).toBe('첫 와장창')
    expect(JSON.stringify(view)).not.toContain('—')
    expect(JSON.stringify(state)).toBe(before)
    expect(makeRecordBookView(state, BUILT_IN_CATALOG)).toEqual(view)
    assertPlainData(view)

    const lockedTitle = {
      ...state,
      profile: { ...state.profile, selectedTitle: '꾹 와장창 장인' },
    }
    expect(makeRecordBookView(lockedTitle, BUILT_IN_CATALOG).selectedTitle).toBeNull()
  })
})
