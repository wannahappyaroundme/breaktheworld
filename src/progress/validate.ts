import { isCharacterWeaponId } from './events'
import { createDefaultProgress } from './defaults'
import {
  ACHIEVEMENTS,
  BUILT_IN_CATALOG,
  createQuestDefinition,
  findBuiltInQuest,
  isSafeQuestId,
  isSafeQuestCopy,
  availableFrameIds,
  availableThemeIds,
  levelProgress,
  questSnapshot,
  totalAchievementXp,
  type QuestCatalogSnapshot,
} from './catalog'
import type {
  ProfileFrameId,
  ProgressStateV1,
  RecordBookThemeId,
} from './types'

const TITLES: ReadonlySet<string> = new Set(ACHIEVEMENTS.map((achievement) => achievement.name))
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function counter(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function boolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function sortedKnownIds(value: unknown, knownIds: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
    .sort((left, right) => left.localeCompare(right))
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_TIMESTAMP.exec(value)
  if (!match) return false

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return false
  if (hour > 23 || minute > 59 || second > 59) return false

  if (offsetHourText !== undefined && offsetMinuteText !== undefined) {
    const offsetHour = Number(offsetHourText)
    const offsetMinute = Number(offsetMinuteText)
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return false
  }
  return Number.isFinite(Date.parse(value))
}

function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function parseLifetime(
  state: ProgressStateV1,
  value: unknown,
  knownWeaponIds: ReadonlySet<string>
): void {
  const input = record(value)
  if (!input) return
  state.lifetime.validHits = counter(input.validHits) ?? state.lifetime.validHits
  state.lifetime.chargedFinishers = counter(input.chargedFinishers) ?? state.lifetime.chargedFinishers
  state.lifetime.totalTargets = counter(input.totalTargets) ?? state.lifetime.totalTargets
  state.lifetime.bestCombo = counter(input.bestCombo) ?? state.lifetime.bestCombo
  state.lifetime.stamps = counter(input.stamps) ?? state.lifetime.stamps
  state.lifetime.distinctWeaponIds = sortedKnownIds(input.distinctWeaponIds, knownWeaponIds)
}

function parseByWeapon(
  state: ProgressStateV1,
  value: unknown,
  knownWeaponIds: readonly string[],
  knownMoveIds: ReadonlySet<string>
): void {
  const input = record(value)
  if (!input) return
  for (const weaponId of knownWeaponIds) {
    const progress = record(input[weaponId])
    if (!progress) continue
    state.byWeapon[weaponId] = {
      uses: counter(progress.uses) ?? 0,
      finishes: counter(progress.finishes) ?? 0,
      seenMoves: sortedKnownIds(progress.seenMoves, knownMoveIds),
    }
  }
}

function parseByTarget(state: ProgressStateV1, value: unknown): void {
  const input = record(value)
  if (!input) return
  for (const targetId of ['word', 'earth', 'city'] as const) {
    const progress = record(input[targetId])
    if (!progress) continue
    state.byTarget[targetId].destroys = counter(progress.destroys) ?? 0
  }
}

function parseAchievements(state: ProgressStateV1, value: unknown): void {
  const input = record(value)
  if (!input) return
  for (const { id } of ACHIEVEMENTS) {
    const achievement = record(input[id])
    if (!achievement || !isIsoTimestamp(achievement.unlockedAt)) continue
    state.achievements[id] = {
      unlockedAt: achievement.unlockedAt,
      seen: boolean(achievement.seen) ?? false,
    }
  }
}

function parseDaily(
  state: ProgressStateV1,
  value: unknown,
  knownWeaponIds: ReadonlySet<string>,
  catalog: QuestCatalogSnapshot
): void {
  const input = record(value)
  if (!input || typeof input.questId !== 'string') return
  if (!isSafeQuestId(input.questId)) return
  if (!isDayKey(input.dayKey)) return

  const builtInQuest = findBuiltInQuest(input.questId)
  const storedTarget = counter(input.target)
  const hasValidStoredTarget = (
    storedTarget !== null
    && storedTarget >= 1
    && storedTarget <= 100
  )
  if (!builtInQuest && !hasValidStoredTarget) return

  state.daily.questId = input.questId
  state.daily.dayKey = input.dayKey
  state.daily.target = hasValidStoredTarget
    ? storedTarget!
    : builtInQuest!.target

  const rawSnapshot = record(input.quest)
  let storedQuest: ReturnType<typeof createQuestDefinition> | undefined
  if (
    rawSnapshot
    && isSafeQuestCopy(rawSnapshot.copy)
    && (
      rawSnapshot.event === 'CHARGE_RELEASED'
      || rawSnapshot.event === 'WEAPON_USED'
      || rawSnapshot.event === 'TARGET_DESTROYED'
    )
    && (rawSnapshot.distinct === null || rawSnapshot.distinct === 'weaponId')
  ) {
    try {
      const candidate = createQuestDefinition({
        id: input.questId,
        copy: rawSnapshot.copy,
        event: rawSnapshot.event,
        target: state.daily.target,
      })
      if ((candidate.distinct ?? null) === rawSnapshot.distinct) storedQuest = candidate
    } catch {
      // A malformed optional snapshot does not discard otherwise valid history.
    }
  }
  const quest = builtInQuest
    ?? storedQuest
    ?? catalog.quests.find((candidate) => candidate.id === input.questId)
  if (storedQuest) state.daily.quest = questSnapshot(builtInQuest ?? storedQuest)

  const storedProgress = counter(input.progress) ?? 0
  const validCompletedAt = isIsoTimestamp(input.completedAt) ? input.completedAt : null
  const storedStampAwarded = boolean(input.stampAwarded) === true
  const acceptedCharacterIds = new Set(
    [...knownWeaponIds].filter((weaponId) => isCharacterWeaponId(weaponId))
  )

  if (quest?.distinct === 'weaponId') {
    state.daily.distinctIds = sortedKnownIds(input.distinctIds, acceptedCharacterIds)
    state.daily.progress = Math.min(state.daily.distinctIds.length, state.daily.target)
  } else {
    state.daily.distinctIds = quest === undefined
      ? sortedKnownIds(input.distinctIds, acceptedCharacterIds)
      : []
    state.daily.progress = Math.min(storedProgress, state.daily.target)
  }

  const distinctEvidenceComplete = quest?.distinct !== 'weaponId'
    || state.daily.distinctIds.length >= state.daily.target
  const isConsistentCompletion = hasValidStoredTarget
    && storedProgress === state.daily.target
    && validCompletedAt !== null
    && storedStampAwarded
    && distinctEvidenceComplete
  state.daily.completedAt = isConsistentCompletion ? validCompletedAt : null
  state.daily.stampAwarded = isConsistentCompletion
}

function parseProfile(state: ProgressStateV1, value: unknown): void {
  const input = record(value)
  if (!input) return

  if (input.selectedTitle === null) state.profile.selectedTitle = null
  else if (typeof input.selectedTitle === 'string' && TITLES.has(input.selectedTitle)) {
    state.profile.selectedTitle = input.selectedTitle
  }

  const skins = record(input.skins)
  if (skins?.cinnamoroll === 'default' || skins?.cinnamoroll === 'classic') {
    state.profile.skins.cinnamoroll = skins.cinnamoroll
  }
  if (skins?.ditto === 'default' || skins?.ditto === 'classic') {
    state.profile.skins.ditto = skins.ditto
  }

  const level = levelProgress(totalAchievementXp(state)).level
  const frames = new Set<string>(availableFrameIds(level))
  if (typeof input.frameId === 'string' && frames.has(input.frameId)) {
    state.profile.frameId = input.frameId as ProfileFrameId
  }
  const themes = new Set<string>(availableThemeIds(level))
  if (typeof input.recordBookThemeId === 'string' && themes.has(input.recordBookThemeId)) {
    state.profile.recordBookThemeId = input.recordBookThemeId as RecordBookThemeId
  }

  if (input.strongInput === 'hold' || input.strongInput === 'doubleTap') {
    state.profile.strongInput = input.strongInput
  }
  state.profile.reducedMotion = boolean(input.reducedMotion) ?? state.profile.reducedMotion
  state.profile.haptics = boolean(input.haptics) ?? state.profile.haptics
}

/** Recovers valid progress while retaining bounded data-only custom daily quests. */
export function parseProgress(
  raw: unknown,
  knownWeaponIds: readonly string[],
  knownMoveIds: readonly string[],
  catalog: QuestCatalogSnapshot = BUILT_IN_CATALOG
): ProgressStateV1 {
  const input = record(raw)
  if (!input) return createDefaultProgress('')

  const installSeed = string(input.installSeed) ?? ''
  const state = createDefaultProgress(installSeed)
  state.catalogVersion = counter(input.catalogVersion) ?? state.catalogVersion

  const weaponIds = new Set(knownWeaponIds)
  const moveIds = new Set(knownMoveIds)
  parseLifetime(state, input.lifetime, weaponIds)
  parseByWeapon(state, input.byWeapon, knownWeaponIds, moveIds)
  parseByTarget(state, input.byTarget)
  parseAchievements(state, input.achievements)
  parseDaily(state, input.daily, weaponIds, catalog)
  parseProfile(state, input.profile)
  return state
}
