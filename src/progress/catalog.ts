import type { GameEvent } from './events'
import { isCharacterWeaponId } from './events'
import type { DailyQuestSnapshot, ProgressStateV1 } from './types'
import {
  ACHIEVEMENT_CATALOG,
  achievementReached,
} from '../../supabase/functions/_shared/achievement-catalog'

export {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  LEVEL_THRESHOLDS,
  TIER_XP,
  achievementProgress,
  achievementReached,
  availableFrameIds,
  availableThemeIds,
  levelProgress,
  totalAchievementXp,
} from '../../supabase/functions/_shared/achievement-catalog'

export type {
  AchievementCategory,
  AchievementCondition,
  AchievementDefinition,
  AchievementProgressSource,
  AchievementTier,
} from '../../supabase/functions/_shared/achievement-catalog'

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

export type AchievementId = (typeof ACHIEVEMENT_CATALOG)[number]['id']

const LEGACY_NEXT_COPY: Partial<Record<AchievementId, string>> = {
  first_destroy: '타겟 1개 부수기',
  charge_master: '꾹 와장창 10번 하기',
  variety_10: '서로 다른 무기 10종 사용하기',
  world_cycle: '세상, 지구, 도시를 각각 부수기',
  combo_50: '최고 연속 50 만들기',
}

/** Compatibility alias for the current record-book view until it adopts description directly. */
export const ACHIEVEMENTS = Object.freeze(ACHIEVEMENT_CATALOG.map((definition) => Object.freeze({
  ...definition,
  next: LEGACY_NEXT_COPY[definition.id] ?? definition.description,
})))

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
      && achievementReached(achievement, state)
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
