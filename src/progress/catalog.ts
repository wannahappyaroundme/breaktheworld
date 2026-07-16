import type { GameEvent } from './events'
import { isCharacterWeaponId } from './events'
import type { DailyQuestSnapshot, ProgressStateV1 } from './types'

export type BuiltInQuestId = 'charged_finisher_2' | 'characters_3' | 'targets_3'
export type QuestEventType = 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED'

const SAFE_QUEST_ID = /^[a-z0-9_]{3,64}$/
const QUEST_TARGET_MAX = 100

/** Data-only shape accepted from remote configuration. Executable predicates are never remote data. */
export interface QuestDefinitionInput {
  readonly id: string
  readonly copy: string
  readonly event: QuestEventType
  readonly target: number
}

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
  /**
   * Implementations must validate remote enum rows and map each row through
   * createQuestDefinition. Never deserialize, evaluate, or forward remote code.
   */
  loadCatalog(): Promise<QuestCatalogSnapshot | null>
}

export function questSnapshot(definition: QuestDefinition): DailyQuestSnapshot {
  return {
    copy: definition.copy,
    event: definition.event,
    distinct: definition.distinct ?? null,
  }
}

export function isSafeQuestCopy(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const length = Array.from(value).length
  const hasEmDash = Array.from(value).some((character) => character.codePointAt(0) === 0x2014)
  return length >= 2 && length <= 60 && /[가-힣]/.test(value) && !hasEmDash
}

export function questFromSnapshot(
  daily: ProgressStateV1['daily']
): QuestDefinition | undefined {
  const snapshot = daily.quest
  if (
    !snapshot
    || !isSafeQuestCopy(snapshot.copy)
    || !['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED'].includes(snapshot.event)
    || (snapshot.distinct !== null && snapshot.distinct !== 'weaponId')
  ) {
    return undefined
  }
  try {
    const definition = createQuestDefinition({
      id: daily.questId,
      copy: snapshot.copy,
      event: snapshot.event,
      target: daily.target,
    })
    return (definition.distinct ?? null) === snapshot.distinct ? definition : undefined
  } catch {
    return undefined
  }
}

export function isSafeQuestId(id: string): boolean {
  return SAFE_QUEST_ID.test(id)
}

export function createQuestDefinition(input: QuestDefinitionInput): QuestDefinition {
  if (
    !isSafeQuestId(input.id)
    || !isSafeQuestCopy(input.copy)
    || !Number.isSafeInteger(input.target)
    || input.target < 1
    || input.target > QUEST_TARGET_MAX
  ) {
    throw new TypeError('Invalid quest definition')
  }

  switch (input.event) {
    case 'CHARGE_RELEASED':
      return {
        ...input,
        distinct: undefined,
        accepts: (event: GameEvent) => (
          event.type === 'CHARGE_RELEASED' && event.source === 'user' && event.charge === 1
        ),
      }
    case 'WEAPON_USED':
      return {
        ...input,
        distinct: 'weaponId',
        accepts: (event: GameEvent) => (
          event.type === 'WEAPON_USED'
          && event.source === 'user'
          && isCharacterWeaponId(event.weaponId)
        ),
      }
    case 'TARGET_DESTROYED':
      return {
        ...input,
        distinct: undefined,
        accepts: (event: GameEvent) => (
          event.type === 'TARGET_DESTROYED' && event.source === 'user'
        ),
      }
    default:
      throw new TypeError('Invalid quest event type')
  }
}

export const BUILT_IN_QUESTS: readonly QuestDefinition[] = [
  createQuestDefinition({
    id: 'charged_finisher_2',
    copy: '꾹 와장창 2번',
    event: 'CHARGE_RELEASED',
    target: 2,
  }),
  createQuestDefinition({
    id: 'characters_3',
    copy: '캐릭터 3종 만나기',
    event: 'WEAPON_USED',
    target: 3,
  }),
  createQuestDefinition({
    id: 'targets_3',
    copy: '타겟 3개 부수기',
    event: 'TARGET_DESTROYED',
    target: 3,
  }),
]

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
      || !isSafeQuestId(quest.id)
      || ids.has(quest.id)
      || typeof quest.copy !== 'string'
      || quest.copy.trim() === ''
      || !['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED'].includes(quest.event)
      || !Number.isSafeInteger(quest.target)
      || quest.target <= 0
      || quest.target > QUEST_TARGET_MAX
      || (quest.distinct !== undefined && quest.distinct !== 'weaponId')
      || (quest.event === 'WEAPON_USED') !== (quest.distinct === 'weaponId')
      || typeof quest.accepts !== 'function'
    ) {
      return false
    }
    ids.add(quest.id)
  }
  return true
}

export function findBuiltInQuest(id: string): QuestDefinition | undefined {
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
      quest: questSnapshot(quest),
      target: quest.target,
      progress: 0,
      distinctIds: [],
      completedAt: null,
      stampAwarded: false,
    },
  }
}

export type DailyNoticeTransition = 'first' | 'half' | 'complete'

/** Returns at most one milestone, prioritizing completion over first and half. */
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

  const wasComplete = previous.completedAt !== null && previous.stampAwarded
  const isComplete = next.completedAt !== null && next.stampAwarded
  if (!wasComplete && isComplete) return ['complete']
  if (next.progress <= previous.progress) return []
  if (previous.progress === 0) return ['first']
  if (
    next.target > 0
    && previous.progress * 2 < next.target
    && next.progress * 2 >= next.target
  ) {
    return ['half']
  }
  return []
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
