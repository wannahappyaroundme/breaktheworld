import type { GameEvent } from './events'
import { isCharacterWeaponId } from './events'
import type { ProgressStateV1 } from './types'

export type BuiltInQuestId = 'charged_finisher_2' | 'characters_3' | 'targets_3'
export type QuestEventType = 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED'

export interface QuestDefinition {
  readonly id: string
  readonly copy: string
  readonly event: QuestEventType
  readonly target: number
  readonly distinct: 'weaponId' | undefined
  readonly accepts: (event: GameEvent) => boolean
}

export interface QuestCatalogSnapshot {
  readonly version: number
  readonly quests: readonly QuestDefinition[]
}

export interface QuestCatalogProvider {
  loadCatalog(): Promise<QuestCatalogSnapshot | null>
}

export const BUILT_IN_QUESTS = [
  {
    id: 'charged_finisher_2',
    copy: '꾹 와장창 2번',
    event: 'CHARGE_RELEASED',
    target: 2,
    distinct: undefined,
    accepts: (event: GameEvent) => (
      event.type === 'CHARGE_RELEASED' && event.source === 'user' && event.charge === 1
    ),
  },
  {
    id: 'characters_3',
    copy: '캐릭터 3종 만나기',
    event: 'WEAPON_USED',
    target: 3,
    distinct: 'weaponId',
    accepts: (event: GameEvent) => (
      event.type === 'WEAPON_USED'
      && event.source === 'user'
      && isCharacterWeaponId(event.weaponId)
    ),
  },
  {
    id: 'targets_3',
    copy: '타겟 3개 부수기',
    event: 'TARGET_DESTROYED',
    target: 3,
    distinct: undefined,
    accepts: (event: GameEvent) => event.type === 'TARGET_DESTROYED' && event.source === 'user',
  },
] as const satisfies readonly QuestDefinition[]

export const BUILT_IN_CATALOG: QuestCatalogSnapshot = {
  version: 1,
  quests: BUILT_IN_QUESTS,
}

function isUsableCatalog(catalog: QuestCatalogSnapshot): boolean {
  if (!Number.isSafeInteger(catalog.version) || catalog.version <= 0 || catalog.quests.length === 0) {
    return false
  }
  const ids = new Set<string>()
  for (const quest of catalog.quests) {
    if (
      typeof quest.id !== 'string'
      || quest.id === ''
      || ids.has(quest.id)
      || typeof quest.copy !== 'string'
      || quest.copy === ''
      || !['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED'].includes(quest.event)
      || !Number.isSafeInteger(quest.target)
      || quest.target <= 0
      || (quest.distinct !== undefined && quest.distinct !== 'weaponId')
      || typeof quest.accepts !== 'function'
    ) {
      return false
    }
    ids.add(quest.id)
  }
  return true
}

export function findBuiltInQuest(id: string): (typeof BUILT_IN_QUESTS)[number] | undefined {
  return BUILT_IN_QUESTS.find((quest) => quest.id === id)
}

export async function resolveQuestCatalog(
  provider?: QuestCatalogProvider
): Promise<QuestCatalogSnapshot> {
  if (!provider) return BUILT_IN_CATALOG
  try {
    const catalog = await provider.loadCatalog()
    if (catalog && isUsableCatalog(catalog)) return catalog
  } catch {
    // Remote configuration is optional; the built-in catalog keeps play available.
  }
  return BUILT_IN_CATALOG
}

function deterministicIndex(seed: string, dayKey: string, length: number): number {
  let hash = 0x811c9dc5
  const source = `${seed}:${dayKey}`
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % length
}

/** Keeps a stored same-day quest or assigns one deterministic quest for a new day. */
export function assignDailyQuest(
  state: ProgressStateV1,
  dayKey: string,
  catalog: QuestCatalogSnapshot = BUILT_IN_CATALOG
): ProgressStateV1 {
  if (state.daily.dayKey === dayKey && state.daily.questId !== '') return state

  const usableCatalog = catalog.quests.length > 0 ? catalog : BUILT_IN_CATALOG
  const quest = usableCatalog.quests[
    deterministicIndex(state.installSeed, dayKey, usableCatalog.quests.length)
  ]
  return {
    ...state,
    catalogVersion: usableCatalog.version,
    daily: {
      dayKey,
      questId: quest.id,
      target: quest.target,
      progress: 0,
      distinctIds: [],
      completedAt: null,
      stampAwarded: false,
    },
  }
}

export type DailyNoticeTransition = 'first' | 'half' | 'complete'

/** Returns milestone crossings only; unchanged/reloaded daily state emits nothing. */
export function dailyNoticeTransitions(
  previous: ProgressStateV1['daily'],
  next: ProgressStateV1['daily']
): DailyNoticeTransition[] {
  if (
    previous.dayKey !== next.dayKey
    || previous.questId !== next.questId
  ) {
    return []
  }

  const transitions: DailyNoticeTransition[] = []
  const progressIncreased = next.progress > previous.progress
  if (progressIncreased && previous.progress === 0) transitions.push('first')
  if (
    progressIncreased
    && next.target > 0
    && previous.progress * 2 < next.target
    && next.progress * 2 >= next.target
  ) {
    transitions.push('half')
  }
  const wasComplete = previous.completedAt !== null && previous.stampAwarded
  const isComplete = next.completedAt !== null && next.stampAwarded
  if (!wasComplete && isComplete) transitions.push('complete')
  return transitions
}

export type AchievementId =
  | 'first_destroy'
  | 'charge_master'
  | 'variety_10'
  | 'world_cycle'
  | 'combo_50'

export type AchievementCondition =
  | 'totalTargets'
  | 'chargedFinishers'
  | 'distinctWeapons'
  | 'worldTargets'
  | 'bestCombo'

export interface AchievementDefinition {
  readonly id: AchievementId
  readonly name: string
  readonly target: number
  readonly condition: AchievementCondition
  readonly next: string
}

export const ACHIEVEMENTS = [
  {
    id: 'first_destroy',
    name: '첫 와장창',
    target: 1,
    condition: 'totalTargets',
    next: '타겟 1개 부수기',
  },
  {
    id: 'charge_master',
    name: '꾹 와장창 장인',
    target: 10,
    condition: 'chargedFinishers',
    next: '꾹 와장창 10번 하기',
  },
  {
    id: 'variety_10',
    name: '골고루 파괴',
    target: 10,
    condition: 'distinctWeapons',
    next: '서로 다른 무기 10종 사용하기',
  },
  {
    id: 'world_cycle',
    name: '세상 한 바퀴',
    target: 3,
    condition: 'worldTargets',
    next: '세상, 지구, 도시를 각각 부수기',
  },
  {
    id: 'combo_50',
    name: '콤보 폭주',
    target: 50,
    condition: 'bestCombo',
    next: '최고 연속 50 만들기',
  },
] as const satisfies readonly AchievementDefinition[]

export function achievementProgress(
  definition: AchievementDefinition,
  state: ProgressStateV1
): number {
  switch (definition.condition) {
    case 'totalTargets':
      return Math.min(state.lifetime.totalTargets, definition.target)
    case 'chargedFinishers':
      return Math.min(state.lifetime.chargedFinishers, definition.target)
    case 'distinctWeapons':
      return Math.min(new Set(state.lifetime.distinctWeaponIds).size, definition.target)
    case 'worldTargets':
      return (['word', 'earth', 'city'] as const)
        .filter((targetId) => state.byTarget[targetId].destroys > 0).length
    case 'bestCombo':
      return Math.min(state.lifetime.bestCombo, definition.target)
  }
}

export interface AchievementUnlockResult {
  state: ProgressStateV1
  unlockedIds: AchievementId[]
}

/** Adds permanent achievement records without changing the daily-stamp counter. */
export function unlockAchievements(
  state: ProgressStateV1,
  unlockedAt: string
): AchievementUnlockResult {
  const unlockedIds = ACHIEVEMENTS
    .filter((achievement) => (
      state.achievements[achievement.id] === undefined
      && achievementProgress(achievement, state) >= achievement.target
    ))
    .map((achievement) => achievement.id)
  if (unlockedIds.length === 0) return { state, unlockedIds }

  const achievements = { ...state.achievements }
  for (const id of unlockedIds) achievements[id] = { unlockedAt, seen: false }
  return {
    state: { ...state, achievements },
    unlockedIds,
  }
}
