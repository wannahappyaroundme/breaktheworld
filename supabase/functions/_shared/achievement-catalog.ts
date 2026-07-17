import { CHARACTER_WEAPON_IDS } from './weapon-ids.ts'

export type AchievementTier = 'easy' | 'normal' | 'hard' | 'master'
export type AchievementCategory = 'destruction' | 'skill' | 'exploration' | 'journey'

export type AchievementCondition =
  | {
    kind: 'lifetime'
    field: 'validHits' | 'chargedFinishers' | 'totalTargets' | 'bestCombo' | 'stamps'
    target: number
  }
  | { kind: 'maxWeapon'; field: 'uses' | 'finishes'; target: number }
  | { kind: 'movePairs'; target: number }
  | { kind: 'distinctWeapons'; target: number }
  | { kind: 'distinctFinishers'; target: number }
  | { kind: 'distinctCharacters'; target: number }
  | { kind: 'worldTargets'; target: 3 }
  | { kind: 'allTargets'; targetEach: number }
  | { kind: 'weaponsAtUses'; weaponCount: number; usesEach: number }

export interface AchievementDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: AchievementCategory
  readonly tier: AchievementTier
  readonly xp: 50 | 100 | 200 | 400
  readonly icon: string
  readonly target: number
  readonly condition: AchievementCondition
  readonly titleReward: boolean
}

export interface AchievementProgressSource {
  lifetime: {
    validHits: number
    chargedFinishers: number
    totalTargets: number
    bestCombo: number
    stamps: number
    distinctWeaponIds: string[]
  }
  byWeapon: Record<string, { uses: number; finishes: number; seenMoves: string[] }>
  byTarget: {
    word: { destroys: number }
    earth: { destroys: number }
    city: { destroys: number }
  }
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
}

export const ACHIEVEMENT_CATALOG_VERSION = 2

export const TIER_XP = Object.freeze({
  easy: 50,
  normal: 100,
  hard: 200,
  master: 400,
} as const)

export const LEVEL_THRESHOLDS = Object.freeze([
  0, 50, 100, 200, 300, 450, 600, 800, 1_000, 1_250,
  1_500, 1_800, 2_100, 2_450, 2_800, 3_200, 3_600, 4_000, 4_400, 4_700,
] as const)

function defineAchievement<const Definition extends AchievementDefinition>(
  definition: Definition
): Readonly<Definition> {
  Object.freeze(definition.condition)
  return Object.freeze(definition)
}

export const ACHIEVEMENT_CATALOG = Object.freeze([
  defineAchievement({
    id: 'first_hit',
    name: '첫 금',
    description: '유효 공격 1회',
    category: 'destruction',
    tier: 'easy',
    xp: 50,
    icon: '✨',
    target: 1,
    condition: { kind: 'lifetime', field: 'validHits', target: 1 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'first_destroy',
    name: '첫 와장창',
    description: '타겟 1개 파괴',
    category: 'destruction',
    tier: 'easy',
    xp: 50,
    icon: '💥',
    target: 1,
    condition: { kind: 'lifetime', field: 'totalTargets', target: 1 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'hits_100',
    name: '손맛이 온다',
    description: '유효 공격 누적 100회',
    category: 'destruction',
    tier: 'normal',
    xp: 100,
    icon: '👊',
    target: 100,
    condition: { kind: 'lifetime', field: 'validHits', target: 100 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'hits_1000',
    name: '산산조각',
    description: '유효 공격 누적 1,000회',
    category: 'destruction',
    tier: 'hard',
    xp: 200,
    icon: '🧩',
    target: 1_000,
    condition: { kind: 'lifetime', field: 'validHits', target: 1_000 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'destroys_25',
    name: '파괴가 취미',
    description: '타겟 누적 25개 파괴',
    category: 'destruction',
    tier: 'normal',
    xp: 100,
    icon: '🔨',
    target: 25,
    condition: { kind: 'lifetime', field: 'totalTargets', target: 25 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'destroys_100',
    name: '와장창 백 번',
    description: '타겟 누적 100개 파괴',
    category: 'destruction',
    tier: 'hard',
    xp: 200,
    icon: '💯',
    target: 100,
    condition: { kind: 'lifetime', field: 'totalTargets', target: 100 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'favorite_weapon_50',
    name: '단짝 무기',
    description: '한 무기를 50회 이상 사용',
    category: 'destruction',
    tier: 'hard',
    xp: 200,
    icon: '🤝',
    target: 50,
    condition: { kind: 'maxWeapon', field: 'uses', target: 50 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'favorite_finisher_50',
    name: '최애의 한 방',
    description: '한 무기로 타겟 50개 마무리',
    category: 'destruction',
    tier: 'master',
    xp: 400,
    icon: '🎯',
    target: 50,
    condition: { kind: 'maxWeapon', field: 'finishes', target: 50 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'charge_1',
    name: '처음 꾹',
    description: '최대 충전 강타 1회',
    category: 'skill',
    tier: 'easy',
    xp: 50,
    icon: '⚡',
    target: 1,
    condition: { kind: 'lifetime', field: 'chargedFinishers', target: 1 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'charge_master',
    name: '꾹 와장창 장인',
    description: '최대 충전 강타 누적 10회',
    category: 'skill',
    tier: 'normal',
    xp: 100,
    icon: '🔋',
    target: 10,
    condition: { kind: 'lifetime', field: 'chargedFinishers', target: 10 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'charge_50',
    name: '충전 달인',
    description: '최대 충전 강타 누적 50회',
    category: 'skill',
    tier: 'hard',
    xp: 200,
    icon: '🌩️',
    target: 50,
    condition: { kind: 'lifetime', field: 'chargedFinishers', target: 50 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'combo_10',
    name: '연속 출발',
    description: '최고 연속 10 달성',
    category: 'skill',
    tier: 'easy',
    xp: 50,
    icon: '🔗',
    target: 10,
    condition: { kind: 'lifetime', field: 'bestCombo', target: 10 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'combo_50',
    name: '콤보 폭주',
    description: '최고 연속 50 달성',
    category: 'skill',
    tier: 'normal',
    xp: 100,
    icon: '🔥',
    target: 50,
    condition: { kind: 'lifetime', field: 'bestCombo', target: 50 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'combo_100',
    name: '끊기지 않는 손',
    description: '최고 연속 100 달성',
    category: 'skill',
    tier: 'hard',
    xp: 200,
    icon: '♾️',
    target: 100,
    condition: { kind: 'lifetime', field: 'bestCombo', target: 100 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'moves_3',
    name: '기술 발견',
    description: '서로 다른 무기·기술 조합 3개 발견',
    category: 'skill',
    tier: 'easy',
    xp: 50,
    icon: '🧪',
    target: 3,
    condition: { kind: 'movePairs', target: 3 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'moves_30',
    name: '기술 박사',
    description: '서로 다른 무기·기술 조합 30개 발견',
    category: 'skill',
    tier: 'master',
    xp: 400,
    icon: '🎓',
    target: 30,
    condition: { kind: 'movePairs', target: 30 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'weapons_3',
    name: '세 가지 손맛',
    description: '서로 다른 무기 3종 사용',
    category: 'exploration',
    tier: 'easy',
    xp: 50,
    icon: '🧰',
    target: 3,
    condition: { kind: 'distinctWeapons', target: 3 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'variety_10',
    name: '골고루 파괴',
    description: '서로 다른 무기 10종 사용',
    category: 'exploration',
    tier: 'normal',
    xp: 100,
    icon: '🎒',
    target: 10,
    condition: { kind: 'distinctWeapons', target: 10 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'weapons_21',
    name: '무기 도감 완성',
    description: '모든 무기 21종 사용',
    category: 'exploration',
    tier: 'hard',
    xp: 200,
    icon: '📚',
    target: 21,
    condition: { kind: 'distinctWeapons', target: 21 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'finisher_1',
    name: '첫 마무리',
    description: '무기 1종으로 타겟 마무리',
    category: 'exploration',
    tier: 'easy',
    xp: 50,
    icon: '🏁',
    target: 1,
    condition: { kind: 'distinctFinishers', target: 1 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'finishers_7',
    name: '마무리 수집가',
    description: '서로 다른 무기 7종으로 타겟 마무리',
    category: 'exploration',
    tier: 'normal',
    xp: 100,
    icon: '🎖️',
    target: 7,
    condition: { kind: 'distinctFinishers', target: 7 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'finishers_21',
    name: '모든 손의 마무리',
    description: '모든 무기 21종으로 타겟 마무리',
    category: 'exploration',
    tier: 'master',
    xp: 400,
    icon: '🏆',
    target: 21,
    condition: { kind: 'distinctFinishers', target: 21 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'character_1',
    name: '캐릭터 첫 만남',
    description: '캐릭터 무기 1종 사용',
    category: 'exploration',
    tier: 'easy',
    xp: 50,
    icon: '👋',
    target: 1,
    condition: { kind: 'distinctCharacters', target: 1 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'characters_9',
    name: '아홉 친구',
    description: '캐릭터 무기 9종 모두 사용',
    category: 'exploration',
    tier: 'normal',
    xp: 100,
    icon: '🎉',
    target: 9,
    condition: { kind: 'distinctCharacters', target: 9 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'world_cycle',
    name: '세상 한 바퀴',
    description: '세상·지구·도시를 각각 1회 파괴',
    category: 'journey',
    tier: 'easy',
    xp: 50,
    icon: '🌍',
    target: 3,
    condition: { kind: 'worldTargets', target: 3 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'stamp_1',
    name: '첫 도장',
    description: '오늘의 도전 도장 1개 획득',
    category: 'journey',
    tier: 'easy',
    xp: 50,
    icon: '⭐',
    target: 1,
    condition: { kind: 'lifetime', field: 'stamps', target: 1 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'stamps_7',
    name: '도장 수집가',
    description: '오늘의 도전 도장 누적 7개',
    category: 'journey',
    tier: 'normal',
    xp: 100,
    icon: '📒',
    target: 7,
    condition: { kind: 'lifetime', field: 'stamps', target: 7 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'weapons_5x3',
    name: '손에 익는 중',
    description: '서로 다른 무기 5종을 각각 3회 이상 사용',
    category: 'journey',
    tier: 'normal',
    xp: 100,
    icon: '🖐️',
    target: 5,
    condition: { kind: 'weaponsAtUses', weaponCount: 5, usesEach: 3 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'world_10_each',
    name: '세 세계 단골',
    description: '세상·지구·도시를 각각 10회 파괴',
    category: 'journey',
    tier: 'normal',
    xp: 100,
    icon: '🗺️',
    target: 10,
    condition: { kind: 'allTargets', targetEach: 10 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'weapons_15x10',
    name: '파괴 연습장',
    description: '서로 다른 무기 15종을 각각 10회 이상 사용',
    category: 'journey',
    tier: 'hard',
    xp: 200,
    icon: '🏋️',
    target: 15,
    condition: { kind: 'weaponsAtUses', weaponCount: 15, usesEach: 10 },
    titleReward: false,
  }),
  defineAchievement({
    id: 'world_50_each',
    name: '세계 순환 전문가',
    description: '세상·지구·도시를 각각 50회 파괴',
    category: 'journey',
    tier: 'hard',
    xp: 200,
    icon: '🌐',
    target: 50,
    condition: { kind: 'allTargets', targetEach: 50 },
    titleReward: true,
  }),
  defineAchievement({
    id: 'weapons_21x25',
    name: '모든 무기의 달인',
    description: '모든 무기 21종을 각각 25회 이상 사용',
    category: 'journey',
    tier: 'master',
    xp: 400,
    icon: '👑',
    target: 21,
    condition: { kind: 'weaponsAtUses', weaponCount: 21, usesEach: 25 },
    titleReward: true,
  }),
] as const)

export type AchievementId = (typeof ACHIEVEMENT_CATALOG)[number]['id']

export function achievementProgress(
  definition: AchievementDefinition,
  state: AchievementProgressSource
): number {
  const condition = definition.condition
  switch (condition.kind) {
    case 'lifetime':
      return Math.min(state.lifetime[condition.field], condition.target)
    case 'maxWeapon':
      return Math.min(
        Math.max(0, ...Object.values(state.byWeapon).map((item) => item[condition.field])),
        condition.target
      )
    case 'movePairs':
      return Math.min(
        Object.values(state.byWeapon).reduce(
          (sum, item) => sum + new Set(item.seenMoves).size,
          0
        ),
        condition.target
      )
    case 'distinctWeapons':
      return Math.min(new Set(state.lifetime.distinctWeaponIds).size, condition.target)
    case 'distinctFinishers':
      return Math.min(
        Object.values(state.byWeapon).filter(({ finishes }) => finishes > 0).length,
        condition.target
      )
    case 'distinctCharacters':
      return Math.min(
        CHARACTER_WEAPON_IDS.filter((id) => (state.byWeapon[id]?.uses ?? 0) > 0).length,
        condition.target
      )
    case 'worldTargets':
      return (['word', 'earth', 'city'] as const)
        .filter((id) => state.byTarget[id].destroys > 0).length
    case 'allTargets':
      return Math.min(
        ...(['word', 'earth', 'city'] as const).map((id) => state.byTarget[id].destroys),
        condition.targetEach
      )
    case 'weaponsAtUses':
      return Math.min(
        Object.values(state.byWeapon).filter(({ uses }) => uses >= condition.usesEach).length,
        condition.weaponCount
      )
  }
}

export function achievementReached(
  definition: AchievementDefinition,
  state: AchievementProgressSource
): boolean {
  return achievementProgress(definition, state) >= definition.target
}

export function totalAchievementXp(
  state: Pick<AchievementProgressSource, 'achievements'>
): number {
  const unlocked = new Set(Object.keys(state.achievements))
  return ACHIEVEMENT_CATALOG.reduce(
    (sum, item) => sum + (unlocked.has(item.id) ? item.xp : 0),
    0
  )
}

export function levelProgress(xp: number): {
  level: number
  xp: number
  current: number
  next: number
  progress: number
} {
  const safeXp = Number.isSafeInteger(xp) && xp > 0 ? Math.min(xp, 4_700) : 0
  let index = 0
  for (let candidate = 1; candidate < LEVEL_THRESHOLDS.length; candidate += 1) {
    if (LEVEL_THRESHOLDS[candidate] > safeXp) break
    index = candidate
  }
  const level = Math.max(1, index + 1)
  const current = LEVEL_THRESHOLDS[level - 1]
  const next = LEVEL_THRESHOLDS[level] ?? current
  return {
    level,
    xp: safeXp,
    current,
    next,
    progress: next === current ? 1 : (safeXp - current) / (next - current),
  }
}

const FRAME_UNLOCKS = Object.freeze([
  { id: 'default', level: 1 },
  { id: 'first_crack', level: 5 },
  { id: 'electric_night', level: 10 },
  { id: 'coral_burst', level: 15 },
  { id: 'legend_crown', level: 20 },
] as const)

const THEME_UNLOCKS = Object.freeze([
  { id: 'default', level: 1 },
  { id: 'electric_night', level: 10 },
  { id: 'coral_burst', level: 15 },
  { id: 'legend_crown', level: 20 },
] as const)

function boundedLevel(level: number): number {
  if (!Number.isSafeInteger(level)) return 1
  return Math.min(20, Math.max(1, level))
}

export function availableFrameIds(level: number): Array<(typeof FRAME_UNLOCKS)[number]['id']> {
  const safeLevel = boundedLevel(level)
  return FRAME_UNLOCKS.filter((item) => item.level <= safeLevel).map(({ id }) => id)
}

export function availableThemeIds(level: number): Array<(typeof THEME_UNLOCKS)[number]['id']> {
  const safeLevel = boundedLevel(level)
  return THEME_UNLOCKS.filter((item) => item.level <= safeLevel).map(({ id }) => id)
}
