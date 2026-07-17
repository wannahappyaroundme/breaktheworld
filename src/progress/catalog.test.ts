import { describe, expect, it, vi } from 'vitest'
import { CHARACTER_IDS, isCharacterId } from '../weapons/character-ids'
import { createCharacterWeapons } from '../weapons/characters'
import { createDefaultProgress } from './defaults'
import { isCharacterWeaponId, type GameEvent } from './events'
import { kstDayKey } from './day'
import { reduceProgress } from './reducer'
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_PUBLISHED_AT,
  ACHIEVEMENT_CATALOG_VERSION,
  ACHIEVEMENTS,
  BUILT_IN_CATALOG,
  BUILT_IN_QUESTS,
  LEVEL_THRESHOLDS,
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

const EXPECTED_ACHIEVEMENT_CATALOG = [
  [
    'first_hit', '첫 금', '유효 공격 1회', 'destruction', 'easy', 50, '✨', 1,
    { kind: 'lifetime', field: 'validHits', target: 1 }, false,
  ],
  [
    'first_destroy', '첫 와장창', '타겟 1개 파괴', 'destruction', 'easy', 50, '💥', 1,
    { kind: 'lifetime', field: 'totalTargets', target: 1 }, false,
  ],
  [
    'hits_100', '손맛이 온다', '유효 공격 누적 100회', 'destruction', 'normal', 100, '👊', 100,
    { kind: 'lifetime', field: 'validHits', target: 100 }, false,
  ],
  [
    'hits_1000', '산산조각', '유효 공격 누적 1,000회', 'destruction', 'hard', 200, '🧩', 1_000,
    { kind: 'lifetime', field: 'validHits', target: 1_000 }, true,
  ],
  [
    'destroys_25', '파괴가 취미', '타겟 누적 25개 파괴', 'destruction', 'normal', 100, '🔨', 25,
    { kind: 'lifetime', field: 'totalTargets', target: 25 }, false,
  ],
  [
    'destroys_100', '와장창 백 번', '타겟 누적 100개 파괴', 'destruction', 'hard', 200, '💯', 100,
    { kind: 'lifetime', field: 'totalTargets', target: 100 }, false,
  ],
  [
    'favorite_weapon_50', '단짝 무기', '한 무기를 50회 이상 사용', 'destruction', 'hard', 200, '🤝', 50,
    { kind: 'maxWeapon', field: 'uses', target: 50 }, false,
  ],
  [
    'favorite_finisher_50', '최애의 한 방', '한 무기로 타겟 50개 마무리', 'destruction', 'master', 400, '🎯', 50,
    { kind: 'maxWeapon', field: 'finishes', target: 50 }, true,
  ],
  [
    'charge_1', '처음 꾹', '최대 충전 강타 1회', 'skill', 'easy', 50, '⚡', 1,
    { kind: 'lifetime', field: 'chargedFinishers', target: 1 }, false,
  ],
  [
    'charge_master', '꾹 와장창 장인', '최대 충전 강타 누적 10회', 'skill', 'normal', 100, '🔋', 10,
    { kind: 'lifetime', field: 'chargedFinishers', target: 10 }, false,
  ],
  [
    'charge_50', '충전 달인', '최대 충전 강타 누적 50회', 'skill', 'hard', 200, '🌩️', 50,
    { kind: 'lifetime', field: 'chargedFinishers', target: 50 }, false,
  ],
  [
    'combo_10', '연속 출발', '최고 연속 10 달성', 'skill', 'easy', 50, '🔗', 10,
    { kind: 'lifetime', field: 'bestCombo', target: 10 }, false,
  ],
  [
    'combo_50', '콤보 폭주', '최고 연속 50 달성', 'skill', 'normal', 100, '🔥', 50,
    { kind: 'lifetime', field: 'bestCombo', target: 50 }, false,
  ],
  [
    'combo_100', '끊기지 않는 손', '최고 연속 100 달성', 'skill', 'hard', 200, '♾️', 100,
    { kind: 'lifetime', field: 'bestCombo', target: 100 }, true,
  ],
  [
    'moves_3', '기술 발견', '서로 다른 무기·기술 조합 3개 발견', 'skill', 'easy', 50, '🧪', 3,
    { kind: 'movePairs', target: 3 }, false,
  ],
  [
    'moves_30', '기술 박사', '서로 다른 무기·기술 조합 30개 발견', 'skill', 'master', 400, '🎓', 30,
    { kind: 'movePairs', target: 30 }, true,
  ],
  [
    'weapons_3', '세 가지 손맛', '서로 다른 무기 3종 사용', 'exploration', 'easy', 50, '🧰', 3,
    { kind: 'distinctWeapons', target: 3 }, false,
  ],
  [
    'variety_10', '골고루 파괴', '서로 다른 무기 10종 사용', 'exploration', 'normal', 100, '🎒', 10,
    { kind: 'distinctWeapons', target: 10 }, false,
  ],
  [
    'weapons_21', '무기 도감 완성', '모든 무기 21종 사용', 'exploration', 'hard', 200, '📚', 21,
    { kind: 'distinctWeapons', target: 21 }, true,
  ],
  [
    'finisher_1', '첫 마무리', '무기 1종으로 타겟 마무리', 'exploration', 'easy', 50, '🏁', 1,
    { kind: 'distinctFinishers', target: 1 }, false,
  ],
  [
    'finishers_7', '마무리 수집가', '서로 다른 무기 7종으로 타겟 마무리', 'exploration', 'normal', 100, '🎖️', 7,
    { kind: 'distinctFinishers', target: 7 }, false,
  ],
  [
    'finishers_21', '모든 손의 마무리', '모든 무기 21종으로 타겟 마무리', 'exploration', 'master', 400, '🏆', 21,
    { kind: 'distinctFinishers', target: 21 }, true,
  ],
  [
    'character_1', '캐릭터 첫 만남', '캐릭터 무기 1종 사용', 'exploration', 'easy', 50, '👋', 1,
    { kind: 'distinctCharacters', target: 1 }, false,
  ],
  [
    'characters_9', '아홉 친구', '캐릭터 무기 9종 모두 사용', 'exploration', 'normal', 100, '🎉', 9,
    { kind: 'distinctCharacters', target: 9 }, false,
  ],
  [
    'world_cycle', '세상 한 바퀴', '세상·지구·도시를 각각 1회 파괴', 'journey', 'easy', 50, '🌍', 3,
    { kind: 'worldTargets', target: 3 }, false,
  ],
  [
    'stamp_1', '첫 도장', '오늘의 도전 도장 1개 획득', 'journey', 'easy', 50, '⭐', 1,
    { kind: 'lifetime', field: 'stamps', target: 1 }, false,
  ],
  [
    'stamps_7', '도장 수집가', '오늘의 도전 도장 누적 7개', 'journey', 'normal', 100, '📒', 7,
    { kind: 'lifetime', field: 'stamps', target: 7 }, false,
  ],
  [
    'weapons_5x3', '손에 익는 중', '서로 다른 무기 5종을 각각 3회 이상 사용', 'journey', 'normal', 100, '🖐️', 5,
    { kind: 'weaponsAtUses', weaponCount: 5, usesEach: 3 }, false,
  ],
  [
    'world_10_each', '세 세계 단골', '세상·지구·도시를 각각 10회 파괴', 'journey', 'normal', 100, '🗺️', 10,
    { kind: 'allTargets', targetEach: 10 }, false,
  ],
  [
    'weapons_15x10', '파괴 연습장', '서로 다른 무기 15종을 각각 10회 이상 사용', 'journey', 'hard', 200, '🏋️', 15,
    { kind: 'weaponsAtUses', weaponCount: 15, usesEach: 10 }, false,
  ],
  [
    'world_50_each', '세계 순환 전문가', '세상·지구·도시를 각각 50회 파괴', 'journey', 'hard', 200, '🌐', 50,
    { kind: 'allTargets', targetEach: 50 }, true,
  ],
  [
    'weapons_21x25', '모든 무기의 달인', '모든 무기 21종을 각각 25회 이상 사용', 'journey', 'master', 400, '👑', 21,
    { kind: 'weaponsAtUses', weaponCount: 21, usesEach: 25 }, true,
  ],
] as const

describe('permanent achievements', () => {
  const countByTier = () => ACHIEVEMENTS.reduce<Record<string, number>>((counts, item) => {
    counts[item.tier] = (counts[item.tier] ?? 0) + 1
    return counts
  }, {})

  const pickAchievementNames = (ids: readonly string[]) => ids.map((id) => (
    ACHIEVEMENTS.find((item) => item.id === id)?.name
  ))

  const findAchievement = (id: string) => {
    const definition = ACHIEVEMENT_CATALOG.find((item) => item.id === id)
    if (!definition) throw new Error(`Unknown achievement: ${id}`)
    return definition
  }

  const expectBoundary = (
    id: string,
    below: ProgressStateV1,
    at: ProgressStateV1
  ) => {
    const definition = findAchievement(id)
    expect(achievementProgress(definition, below)).toBe(definition.target - 1)
    expect(achievementReached(definition, below)).toBe(false)
    expect(achievementProgress(definition, at)).toBe(definition.target)
    expect(achievementReached(definition, at)).toBe(true)
  }

  it('locks every public achievement field to the approved golden catalog', () => {
    const expected = EXPECTED_ACHIEVEMENT_CATALOG.map(([
      id, name, description, category, tier, xp, icon, target, condition, titleReward,
    ]) => ({ id, name, description, category, tier, xp, icon, target, condition, titleReward }))

    expect(ACHIEVEMENT_CATALOG).toEqual(expected)
  })

  it('defines the approved immutable achievement and XP contract', () => {
    expect(ACHIEVEMENT_CATALOG_VERSION).toBe(2)
    expect(ACHIEVEMENT_CATALOG_PUBLISHED_AT).toBe('2026-07-17T00:00:00.000Z')
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
    expect(Object.isFrozen(ACHIEVEMENT_CATALOG)).toBe(true)
    for (const item of ACHIEVEMENT_CATALOG) {
      expect(Object.isFrozen(item)).toBe(true)
      expect(Object.isFrozen(item.condition)).toBe(true)
    }
    expect(Object.isFrozen(ACHIEVEMENTS)).toBe(true)
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

  it('uses the exact lifetime counter at the below and reached boundaries', () => {
    const cases = [
      ['first_hit', 'validHits', 0, 1],
      ['first_destroy', 'totalTargets', 0, 1],
      ['charge_1', 'chargedFinishers', 0, 1],
      ['combo_10', 'bestCombo', 9, 10],
      ['stamp_1', 'stamps', 0, 1],
    ] as const

    for (const [id, field, belowValue, atValue] of cases) {
      const below = createDefaultProgress(`below-${id}`)
      const at = createDefaultProgress(`at-${id}`)
      below.lifetime[field] = belowValue
      at.lifetime[field] = atValue
      expectBoundary(id, below, at)
    }
  })

  it('uses per-weapon maxima instead of unrelated lifetime counters', () => {
    const cases = [
      ['favorite_weapon_50', 'uses'],
      ['favorite_finisher_50', 'finishes'],
    ] as const

    for (const [id, field] of cases) {
      const below = createDefaultProgress(`below-${id}`)
      const at = createDefaultProgress(`at-${id}`)
      below.lifetime.validHits = 10_000
      below.lifetime.totalTargets = 10_000
      at.lifetime.validHits = 10_000
      at.lifetime.totalTargets = 10_000
      below.byWeapon.hammer = { uses: 0, finishes: 0, seenMoves: [] }
      at.byWeapon.hammer = { uses: 0, finishes: 0, seenMoves: [] }
      below.byWeapon.hammer[field] = 49
      at.byWeapon.hammer[field] = 50
      expectBoundary(id, below, at)
    }
  })

  it('counts unique move pairs and distinct weapon, finisher, and character families', () => {
    const movesBelow = createDefaultProgress('moves-below')
    movesBelow.byWeapon.hammer = { uses: 0, finishes: 0, seenMoves: ['quick', 'quick', 'drag'] }
    const movesAt = structuredClone(movesBelow)
    movesAt.byWeapon.laser = { uses: 0, finishes: 0, seenMoves: ['quick'] }
    expectBoundary('moves_3', movesBelow, movesAt)

    const weaponsBelow = createDefaultProgress('weapons-below')
    weaponsBelow.lifetime.distinctWeaponIds = ['hammer', 'hammer', 'laser']
    const weaponsAt = structuredClone(weaponsBelow)
    weaponsAt.lifetime.distinctWeaponIds.push('glass')
    expectBoundary('weapons_3', weaponsBelow, weaponsAt)

    const finishersBelow = createDefaultProgress('finishers-below')
    finishersBelow.byWeapon.hammer = { uses: 50, finishes: 0, seenMoves: [] }
    const finishersAt = structuredClone(finishersBelow)
    finishersAt.byWeapon.hammer.finishes = 1
    expectBoundary('finisher_1', finishersBelow, finishersAt)

    const charactersBelow = createDefaultProgress('characters-below')
    charactersBelow.byWeapon.hammer = { uses: 50, finishes: 0, seenMoves: [] }
    const charactersAt = structuredClone(charactersBelow)
    charactersAt.byWeapon.cinnamoroll = { uses: 1, finishes: 0, seenMoves: [] }
    expectBoundary('character_1', charactersBelow, charactersAt)
  })

  it('requires every world target and the exact weapon-use threshold families', () => {
    const worldBelow = createDefaultProgress('world-below')
    worldBelow.byTarget.word.destroys = 1
    worldBelow.byTarget.earth.destroys = 1
    const worldAt = structuredClone(worldBelow)
    worldAt.byTarget.city.destroys = 1
    expectBoundary('world_cycle', worldBelow, worldAt)

    const allTargetsBelow = createDefaultProgress('all-targets-below')
    allTargetsBelow.byTarget.word.destroys = 10
    allTargetsBelow.byTarget.earth.destroys = 10
    allTargetsBelow.byTarget.city.destroys = 9
    const allTargetsAt = structuredClone(allTargetsBelow)
    allTargetsAt.byTarget.city.destroys = 10
    expectBoundary('world_10_each', allTargetsBelow, allTargetsAt)

    const weaponsAtUsesBelow = createDefaultProgress('weapons-at-uses-below')
    for (const id of ['hammer', 'fist', 'glass', 'laser']) {
      weaponsAtUsesBelow.byWeapon[id] = { uses: 3, finishes: 0, seenMoves: [] }
    }
    weaponsAtUsesBelow.byWeapon.meteor = { uses: 2, finishes: 0, seenMoves: [] }
    const weaponsAtUsesAt = structuredClone(weaponsAtUsesBelow)
    weaponsAtUsesAt.byWeapon.meteor.uses = 3
    expectBoundary('weapons_5x3', weaponsAtUsesBelow, weaponsAtUsesAt)
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
    expect(LEVEL_THRESHOLDS).toEqual([
      0, 50, 100, 200, 300, 450, 600, 800, 1_000, 1_250,
      1_500, 1_800, 2_100, 2_450, 2_800, 3_200, 3_600, 4_000, 4_400, 4_700,
    ])
    expect(Object.isFrozen(LEVEL_THRESHOLDS)).toBe(true)

    const rewardCases = [
      [1, ['default'], ['default']],
      [4, ['default'], ['default']],
      [5, ['default', 'first_crack'], ['default']],
      [9, ['default', 'first_crack'], ['default']],
      [10, ['default', 'first_crack', 'electric_night'], ['default', 'electric_night']],
      [14, ['default', 'first_crack', 'electric_night'], ['default', 'electric_night']],
      [15, ['default', 'first_crack', 'electric_night', 'coral_burst'], ['default', 'electric_night', 'coral_burst']],
      [19, ['default', 'first_crack', 'electric_night', 'coral_burst'], ['default', 'electric_night', 'coral_burst']],
      [20, ['default', 'first_crack', 'electric_night', 'coral_burst', 'legend_crown'], ['default', 'electric_night', 'coral_burst', 'legend_crown']],
    ] as const

    for (const [level, frames, themes] of rewardCases) {
      expect(availableFrameIds(level)).toEqual(frames)
      expect(availableThemeIds(level)).toEqual(themes)
    }
    expect(availableFrameIds(99)).toEqual(availableFrameIds(20))
    expect(availableFrameIds(Number.NaN)).toEqual(['default'])
    expect(availableThemeIds(99)).toEqual(availableThemeIds(20))
    expect(availableThemeIds(Number.NaN)).toEqual(['default'])
  })
})

describe('record-book view model', () => {
  it('shows exact progression, completion, nearest goals, and recent backfill', () => {
    const state = createDefaultProgress('hub-summary')
    state.lifetime.validHits = 100
    state.lifetime.totalTargets = 25
    state.achievements = {
      first_hit: { unlockedAt: ACHIEVEMENT_CATALOG_PUBLISHED_AT, seen: false },
      hits_100: { unlockedAt: ACHIEVEMENT_CATALOG_PUBLISHED_AT, seen: false },
      destroys_25: { unlockedAt: ACHIEVEMENT_CATALOG_PUBLISHED_AT, seen: false },
    }

    const view = makeRecordBookView(state, BUILT_IN_CATALOG)

    expect(view.summary).toMatchObject({
      level: 4,
      xp: 250,
      currentLevelXp: 200,
      nextLevelXp: 300,
      completed: 3,
      total: 32,
      completionText: '3 / 32, 9%',
    })
    expect(view.summary.nearest).toHaveLength(3)
    expect(view.summary.nearest.every(({ complete }) => !complete)).toBe(true)
    expect(view.summary.nearest.map(({ ratio }) => ratio)).toEqual(
      [...view.summary.nearest.map(({ ratio }) => ratio)].sort((left, right) => right - left)
    )
    expect(view.summary.recent).toEqual({
      count: 3,
      xp: 250,
      copy: '지난 기록으로 업적 3개를 찾았어요, 경험치 +250',
    })
    expect(view.achievements.items).toHaveLength(32)
    expect(view.achievements.items[0]).toMatchObject({
      id: 'first_hit',
      tierLabel: '쉬움',
      description: '유효 공격 1회',
      xp: 50,
      progressText: '1 / 1, 100%',
      category: 'destruction',
      categoryLabel: '파괴 기록',
      titleReward: false,
    })
  })

  it('exposes every cosmetic reward with its lock requirement and safe selected state', () => {
    const state = createDefaultProgress('hub-cosmetics')
    state.achievements.first_hit = {
      unlockedAt: ACHIEVEMENT_CATALOG_PUBLISHED_AT,
      seen: true,
    }

    const view = makeRecordBookView(state, BUILT_IN_CATALOG)

    expect(view.cosmetics.titles).toHaveLength(8)
    expect(view.cosmetics.frames).toHaveLength(5)
    expect(view.cosmetics.themes).toHaveLength(4)
    expect(view.cosmetics.skins).toHaveLength(2)
    expect(view.cosmetics.frames.find(({ id }) => id === 'first_crack')).toMatchObject({
      unlocked: false,
      requirement: '레벨 5가 되면 고를 수 있어요',
    })
    expect(view.cosmetics.themes.find(({ id }) => id === 'electric_night')).toMatchObject({
      unlocked: false,
      requirement: '레벨 10이 되면 고를 수 있어요',
    })
    expect(view.cosmetics.titles.find(({ id }) => id === 'moves_30')?.requirement)
      .toBe("'기술 박사' 업적을 완료하면 고를 수 있어요")
    expect(view.profile).toEqual({
      selectedTitle: null,
      frameId: 'default',
      recordBookThemeId: 'default',
    })
  })

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
    expect(view.achievements.heading).toBe('업적')
    expect(view.achievements.items.map((item) => item.id)).toEqual(
      ACHIEVEMENTS.map((achievement) => achievement.id)
    )
    expect(view.achievements.items.find(({ id }) => id === 'first_destroy')).toMatchObject({
      name: '첫 와장창',
      complete: true,
      seen: false,
      description: '타겟 1개 파괴',
      tierLabel: '쉬움',
      progressText: '1 / 1, 100%',
    })
    expect(view.cosmetics.skins).toEqual([
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
      ])
    expect(view.stats).toEqual({
      heading: '내 기록',
      items: [
        { label: '최고 연속', value: '27' },
        { label: '누적 파괴', value: '12' },
        { label: '충전 강타', value: '4' },
        { label: '사용한 무기', value: '2종' },
      ],
    })
    expect(view.profile.selectedTitle).toBe('첫 와장창')
    expect(JSON.stringify(view)).not.toContain('—')
    expect(JSON.stringify(state)).toBe(before)
    expect(makeRecordBookView(state, BUILT_IN_CATALOG)).toEqual(view)
    assertPlainData(view)

    const lockedTitle = {
      ...state,
      profile: { ...state.profile, selectedTitle: '꾹 와장창 장인' },
    }
    expect(makeRecordBookView(lockedTitle, BUILT_IN_CATALOG).profile.selectedTitle).toBeNull()
  })
})
