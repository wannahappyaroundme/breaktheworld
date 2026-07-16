import { isUuid } from './player-contract.ts'
import { APPROVED_ANALYTICS_WEAPON_IDS } from './weapon-ids.ts'

const MAX_BATCH_OPERATIONS = 100
const MAX_BATCH_BYTES = 256 * 1024
const MAX_OPERATION_BYTES = 32 * 1024
const MAX_DELTA = 1_000
const MAX_BEST_COMBO = 1_000_000
const MAX_IDS = 64
const MAX_WEAPONS = 21
const MAX_ACHIEVEMENTS = 5
const MAX_SAFE_COUNTER = Number.MAX_SAFE_INTEGER
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const QUEST_ID = /^[a-z0-9_]{3,64}$/

const KNOWN_WEAPON_IDS = new Set<string>(APPROVED_ANALYTICS_WEAPON_IDS)
const CHARACTER_IDS = new Set<string>([
  'cinnamoroll',
  'thanos',
  'ironman',
  'hulk',
  'godzilla',
  'dragonball',
  'cat',
  'ditto',
  'pooh',
])
const KNOWN_MOVE_IDS = new Set<string>([
  'quick',
  'drag',
  'charged',
  'cloudBounce',
  'earSweep',
  'skyPress',
  'gemRicochet',
  'gravityGrip',
  'fateSnap',
  'palmRepulsor',
  'chestBeam',
  'repulsorBarrage',
  'fistPound',
  'groundStomp',
  'thunderSmash',
  'tailSweep',
  'footStomp',
  'atomicBreath',
  'kiVolley',
  'instantStrike',
  'megaBeam',
  'pawTaps',
  'buttSlam',
  'blobPunch',
  'stretchRoller',
  'copySmash',
  'honeySplash',
  'bellyPush',
  'honeyBomb',
])

export const PLAYER_SYNC_ACHIEVEMENTS = Object.freeze([
  { id: 'first_destroy', title: '첫 와장창', target: 1, condition: 'totalTargets' },
  { id: 'charge_master', title: '꾹 와장창 장인', target: 10, condition: 'chargedFinishers' },
  { id: 'variety_10', title: '골고루 파괴', target: 10, condition: 'distinctWeapons' },
  { id: 'world_cycle', title: '세상 한 바퀴', target: 3, condition: 'worldTargets' },
  { id: 'combo_50', title: '콤보 폭주', target: 50, condition: 'bestCombo' },
] as const)

type AchievementId = (typeof PLAYER_SYNC_ACHIEVEMENTS)[number]['id']
type QuestEvent = 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED'
type StrongInput = 'hold' | 'doubleTap'

export interface SyncProgressState {
  schemaVersion: 1
  catalogVersion: number
  installSeed: string
  lifetime: {
    validHits: number
    chargedFinishers: number
    totalTargets: number
    bestCombo: number
    stamps: number
    distinctWeaponIds: string[]
  }
  byWeapon: Record<string, { uses: number; finishes: number; seenMoves: string[] }>
  byTarget: { word: { destroys: number }; earth: { destroys: number }; city: { destroys: number } }
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
  daily: {
    dayKey: string
    questId: string
    quest?: { copy: string; event: QuestEvent; distinct: 'weaponId' | null }
    target: number
    progress: number
    distinctIds: string[]
    completedAt: string | null
    stampAwarded: boolean
  }
  profile: {
    selectedTitle: string | null
    skins: Record<string, string>
    strongInput: StrongInput
    reducedMotion: boolean
    haptics: boolean
  }
}

export interface PlayerProgressDeltaV1 {
  validHits: number
  chargedFinishers: number
  totalTargets: number
  bestCombo: number
  addDistinctWeaponIds: string[]
  byWeapon: Record<string, { uses: number; finishes: number; addSeenMoves: string[] }>
  byTarget: { word: number; earth: number; city: number }
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
  settings: Partial<{
    selectedTitle: string | null
    cinnamorollSkin: 'default' | 'classic'
    dittoSkin: 'default' | 'classic'
    strongInput: StrongInput
    reducedMotion: boolean
    haptics: boolean
  }>
}

export interface PlayerProgressDraftV1 {
  createdAt: string
  playDayKey: string
  dailyQuest: {
    id: string
    copy: string
    event: QuestEvent
    distinct: 'weaponId' | null
    target: number
  } | null
  delta: PlayerProgressDeltaV1
}

export interface PlayerProgressOperationV1 extends PlayerProgressDraftV1 {
  operationId: string
  operationVersion: 1
  deviceId: string
  clientSeq: number
}

export type AcceptedPlayerProgressOperationV1 = PlayerProgressOperationV1 & {
  acceptedOrder: number
  acceptedAt: string
}

export interface DiffPlayerProgressContext {
  nowIso: string
  serverMayNotHaveDaily?: boolean
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function isSafeIso(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function isDayKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_KEY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function isBoundedInteger(value: unknown, maximum = MAX_DELTA): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 && value <= maximum
}

function isUniqueKnownIds(
  value: unknown,
  known: ReadonlySet<string>,
  maximum = MAX_IDS
): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => typeof item === 'string' && known.has(item))
    && new Set(value).size === value.length
}

function isSafeQuestCopy(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const length = Array.from(value).length
  return length >= 2 && length <= 60 && /[가-힣]/.test(value) && !value.includes('\u2014')
}

function parseDailyQuest(value: unknown): PlayerProgressDraftV1['dailyQuest'] | undefined {
  if (value === null) return null
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'copy', 'event', 'distinct', 'target'])) {
    return undefined
  }
  if (
    typeof value.id !== 'string'
    || !QUEST_ID.test(value.id)
    || !isSafeQuestCopy(value.copy)
    || !['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED'].includes(String(value.event))
    || !isBoundedInteger(value.target, 100)
    || value.target < 1
  ) {
    return undefined
  }
  const event = value.event as QuestEvent
  const distinct = value.distinct
  if ((event === 'WEAPON_USED' && distinct !== 'weaponId') || (event !== 'WEAPON_USED' && distinct !== null)) {
    return undefined
  }
  return {
    id: value.id,
    copy: value.copy,
    event,
    distinct: distinct as 'weaponId' | null,
    target: value.target,
  }
}

function parseDelta(value: unknown): PlayerProgressDeltaV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'validHits',
    'chargedFinishers',
    'totalTargets',
    'bestCombo',
    'addDistinctWeaponIds',
    'byWeapon',
    'byTarget',
    'achievements',
    'settings',
  ])) return null
  if (
    !isBoundedInteger(value.validHits)
    || !isBoundedInteger(value.chargedFinishers)
    || !isBoundedInteger(value.totalTargets)
    || !isBoundedInteger(value.bestCombo, MAX_BEST_COMBO)
    || !isUniqueKnownIds(value.addDistinctWeaponIds, KNOWN_WEAPON_IDS)
  ) return null

  if (!isRecord(value.byTarget) || !hasExactKeys(value.byTarget, ['word', 'earth', 'city'])) return null
  const byTarget = value.byTarget
  if (!isBoundedInteger(byTarget.word) || !isBoundedInteger(byTarget.earth) || !isBoundedInteger(byTarget.city)) {
    return null
  }

  if (!isRecord(value.byWeapon) || Object.keys(value.byWeapon).length > MAX_WEAPONS) return null
  const parsedByWeapon: PlayerProgressDeltaV1['byWeapon'] = {}
  for (const [weaponId, rawProgress] of Object.entries(value.byWeapon)) {
    if (!KNOWN_WEAPON_IDS.has(weaponId) || !isRecord(rawProgress)) return null
    if (!hasExactKeys(rawProgress, ['uses', 'finishes', 'addSeenMoves'])) return null
    if (
      !isBoundedInteger(rawProgress.uses)
      || !isBoundedInteger(rawProgress.finishes)
      || !isUniqueKnownIds(rawProgress.addSeenMoves, KNOWN_MOVE_IDS)
    ) return null
    parsedByWeapon[weaponId] = {
      uses: rawProgress.uses,
      finishes: rawProgress.finishes,
      addSeenMoves: rawProgress.addSeenMoves,
    }
  }

  const achievementIds = new Set<string>(PLAYER_SYNC_ACHIEVEMENTS.map(({ id }) => id))
  if (!isRecord(value.achievements) || Object.keys(value.achievements).length > MAX_ACHIEVEMENTS) return null
  const achievements: PlayerProgressDeltaV1['achievements'] = {}
  for (const [id, rawAchievement] of Object.entries(value.achievements)) {
    if (!achievementIds.has(id) || !isRecord(rawAchievement)) return null
    if (!hasExactKeys(rawAchievement, ['unlockedAt', 'seen'])) return null
    if (!isSafeIso(rawAchievement.unlockedAt) || typeof rawAchievement.seen !== 'boolean') return null
    achievements[id] = { unlockedAt: rawAchievement.unlockedAt, seen: rawAchievement.seen }
  }

  if (!isRecord(value.settings)) return null
  const allowedSettingKeys = new Set([
    'selectedTitle',
    'cinnamorollSkin',
    'dittoSkin',
    'strongInput',
    'reducedMotion',
    'haptics',
  ])
  if (Object.keys(value.settings).some((key) => !allowedSettingKeys.has(key))) return null
  const settings: PlayerProgressDeltaV1['settings'] = {}
  if ('selectedTitle' in value.settings) {
    const titles = new Set<string>(PLAYER_SYNC_ACHIEVEMENTS.map(({ title }) => title))
    if (value.settings.selectedTitle !== null && (
      typeof value.settings.selectedTitle !== 'string' || !titles.has(value.settings.selectedTitle)
    )) return null
    settings.selectedTitle = value.settings.selectedTitle as string | null
  }
  if ('cinnamorollSkin' in value.settings) {
    if (value.settings.cinnamorollSkin !== 'default' && value.settings.cinnamorollSkin !== 'classic') return null
    settings.cinnamorollSkin = value.settings.cinnamorollSkin
  }
  if ('dittoSkin' in value.settings) {
    if (value.settings.dittoSkin !== 'default' && value.settings.dittoSkin !== 'classic') return null
    settings.dittoSkin = value.settings.dittoSkin
  }
  if ('strongInput' in value.settings) {
    if (value.settings.strongInput !== 'hold' && value.settings.strongInput !== 'doubleTap') return null
    settings.strongInput = value.settings.strongInput
  }
  if ('reducedMotion' in value.settings) {
    if (typeof value.settings.reducedMotion !== 'boolean') return null
    settings.reducedMotion = value.settings.reducedMotion
  }
  if ('haptics' in value.settings) {
    if (typeof value.settings.haptics !== 'boolean') return null
    settings.haptics = value.settings.haptics
  }

  return {
    validHits: value.validHits,
    chargedFinishers: value.chargedFinishers,
    totalTargets: value.totalTargets,
    bestCombo: value.bestCombo,
    addDistinctWeaponIds: value.addDistinctWeaponIds,
    byWeapon: parsedByWeapon,
    byTarget: { word: byTarget.word, earth: byTarget.earth, city: byTarget.city },
    achievements,
    settings,
  }
}

function parseOperation(value: unknown): PlayerProgressOperationV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'operationId',
    'operationVersion',
    'deviceId',
    'clientSeq',
    'createdAt',
    'playDayKey',
    'dailyQuest',
    'delta',
  ])) return null
  if (
    !isUuid(value.operationId)
    || value.operationVersion !== 1
    || !isUuid(value.deviceId)
    || !Number.isSafeInteger(value.clientSeq)
    || typeof value.clientSeq !== 'number'
    || value.clientSeq <= 0
    || !isSafeIso(value.createdAt)
    || !isDayKey(value.playDayKey)
  ) return null
  const dailyQuest = parseDailyQuest(value.dailyQuest)
  const delta = parseDelta(value.delta)
  if (dailyQuest === undefined || delta === null || byteLength(value) > MAX_OPERATION_BYTES) return null
  return {
    operationId: value.operationId,
    operationVersion: 1,
    deviceId: value.deviceId,
    clientSeq: value.clientSeq,
    createdAt: value.createdAt,
    playDayKey: value.playDayKey,
    dailyQuest,
    delta,
  }
}

export function parseSyncBatch(value: unknown): PlayerProgressOperationV1[] {
  if (!Array.isArray(value) || value.length > MAX_BATCH_OPERATIONS || byteLength(value) > MAX_BATCH_BYTES) {
    throw new TypeError('invalid_sync_batch')
  }
  const parsed: PlayerProgressOperationV1[] = []
  for (const item of value) {
    const operation = parseOperation(item)
    if (!operation) throw new TypeError('invalid_sync_batch')
    parsed.push(operation)
  }
  return parsed
}

function sortedUnion(left: readonly string[], right: readonly string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b))
}

function difference(next: readonly string[], previous: readonly string[]): string[] {
  const previousSet = new Set(previous)
  return [...new Set(next.filter((value) => !previousSet.has(value)))].sort((a, b) => a.localeCompare(b))
}

function safeDelta(previous: number, next: number): number {
  if (!Number.isSafeInteger(previous) || !Number.isSafeInteger(next) || next < previous) {
    throw new Error('progress_decreased')
  }
  const delta = next - previous
  if (delta > MAX_DELTA) throw new Error('progress_delta_too_large')
  return delta
}

function dailyQuestSnapshot(state: SyncProgressState): PlayerProgressDraftV1['dailyQuest'] {
  const quest = state.daily.quest
  if (!quest || state.daily.questId === '' || state.daily.target < 1) return null
  return {
    id: state.daily.questId,
    copy: quest.copy,
    event: quest.event,
    distinct: quest.distinct,
    target: state.daily.target,
  }
}

export function diffPlayerProgress(
  previous: SyncProgressState,
  next: SyncProgressState,
  context: DiffPlayerProgressContext
): PlayerProgressDraftV1 | null {
  if (!isSafeIso(context.nowIso)) throw new TypeError('invalid_sync_timestamp')
  const delta: PlayerProgressDeltaV1 = {
    validHits: safeDelta(previous.lifetime.validHits, next.lifetime.validHits),
    chargedFinishers: safeDelta(previous.lifetime.chargedFinishers, next.lifetime.chargedFinishers),
    totalTargets: safeDelta(previous.lifetime.totalTargets, next.lifetime.totalTargets),
    bestCombo: next.lifetime.bestCombo,
    addDistinctWeaponIds: difference(next.lifetime.distinctWeaponIds, previous.lifetime.distinctWeaponIds),
    byWeapon: {},
    byTarget: {
      word: safeDelta(previous.byTarget.word.destroys, next.byTarget.word.destroys),
      earth: safeDelta(previous.byTarget.earth.destroys, next.byTarget.earth.destroys),
      city: safeDelta(previous.byTarget.city.destroys, next.byTarget.city.destroys),
    },
    achievements: {},
    settings: {},
  }
  if (delta.bestCombo < previous.lifetime.bestCombo) throw new Error('progress_decreased')
  if (delta.bestCombo > MAX_BEST_COMBO) throw new Error('progress_delta_too_large')

  for (const weaponId of sortedUnion(Object.keys(previous.byWeapon), Object.keys(next.byWeapon))) {
    if (!KNOWN_WEAPON_IDS.has(weaponId)) continue
    const before = previous.byWeapon[weaponId] ?? { uses: 0, finishes: 0, seenMoves: [] }
    const after = next.byWeapon[weaponId] ?? { uses: 0, finishes: 0, seenMoves: [] }
    const weaponDelta = {
      uses: safeDelta(before.uses, after.uses),
      finishes: safeDelta(before.finishes, after.finishes),
      addSeenMoves: difference(after.seenMoves, before.seenMoves),
    }
    if (weaponDelta.uses > 0 || weaponDelta.finishes > 0 || weaponDelta.addSeenMoves.length > 0) {
      delta.byWeapon[weaponId] = weaponDelta
    }
  }

  for (const { id } of PLAYER_SYNC_ACHIEVEMENTS) {
    const before = previous.achievements[id]
    const after = next.achievements[id]
    if (!after) {
      if (before) throw new Error('progress_decreased')
      continue
    }
    if (!before || after.seen !== before.seen || after.unlockedAt < before.unlockedAt) {
      delta.achievements[id] = { ...after }
    }
  }

  if (previous.profile.selectedTitle !== next.profile.selectedTitle) {
    delta.settings.selectedTitle = next.profile.selectedTitle
  }
  if (previous.profile.skins.cinnamoroll !== next.profile.skins.cinnamoroll) {
    const skin = next.profile.skins.cinnamoroll
    if (skin === 'default' || skin === 'classic') delta.settings.cinnamorollSkin = skin
  }
  if (previous.profile.skins.ditto !== next.profile.skins.ditto) {
    const skin = next.profile.skins.ditto
    if (skin === 'default' || skin === 'classic') delta.settings.dittoSkin = skin
  }
  if (previous.profile.strongInput !== next.profile.strongInput) {
    delta.settings.strongInput = next.profile.strongInput
  }
  if (previous.profile.reducedMotion !== next.profile.reducedMotion) {
    delta.settings.reducedMotion = next.profile.reducedMotion
  }
  if (previous.profile.haptics !== next.profile.haptics) {
    delta.settings.haptics = next.profile.haptics
  }

  const hasChange = delta.validHits > 0
    || delta.chargedFinishers > 0
    || delta.totalTargets > 0
    || delta.bestCombo > previous.lifetime.bestCombo
    || delta.addDistinctWeaponIds.length > 0
    || Object.keys(delta.byWeapon).length > 0
    || Object.values(delta.byTarget).some((value) => value > 0)
    || Object.keys(delta.achievements).length > 0
    || Object.keys(delta.settings).length > 0
  if (!hasChange) return null

  return {
    createdAt: context.nowIso,
    playDayKey: isDayKey(next.daily.dayKey) ? next.daily.dayKey : context.nowIso.slice(0, 10),
    dailyQuest: previous.daily.dayKey !== next.daily.dayKey || context.serverMayNotHaveDaily
      ? dailyQuestSnapshot(next)
      : null,
    delta,
  }
}

function clampedSum(left: number, right: number): number {
  return Math.min(MAX_SAFE_COUNTER, left + right)
}

function mergeAchievement(
  current: { unlockedAt: string; seen: boolean } | undefined,
  incoming: { unlockedAt: string; seen: boolean }
): { unlockedAt: string; seen: boolean } {
  if (!current) return { ...incoming }
  return {
    unlockedAt: current.unlockedAt < incoming.unlockedAt ? current.unlockedAt : incoming.unlockedAt,
    seen: current.seen || incoming.seen,
  }
}

function achievementReached(state: SyncProgressState, id: AchievementId): boolean {
  switch (id) {
    case 'first_destroy': return state.lifetime.totalTargets >= 1
    case 'charge_master': return state.lifetime.chargedFinishers >= 10
    case 'variety_10': return state.lifetime.distinctWeaponIds.length >= 10
    case 'world_cycle': return ['word', 'earth', 'city'].every((id) => state.byTarget[id as keyof SyncProgressState['byTarget']].destroys > 0)
    case 'combo_50': return state.lifetime.bestCombo >= 50
  }
}

function applyAccountDelta(
  input: SyncProgressState,
  operation: PlayerProgressOperationV1,
  trustedAt: string
): SyncProgressState {
  const state = structuredClone(input)
  const { delta } = operation
  state.lifetime.validHits = clampedSum(state.lifetime.validHits, delta.validHits)
  state.lifetime.chargedFinishers = clampedSum(state.lifetime.chargedFinishers, delta.chargedFinishers)
  state.lifetime.totalTargets = clampedSum(state.lifetime.totalTargets, delta.totalTargets)
  state.lifetime.bestCombo = Math.max(state.lifetime.bestCombo, delta.bestCombo)
  state.lifetime.distinctWeaponIds = sortedUnion(state.lifetime.distinctWeaponIds, delta.addDistinctWeaponIds)

  for (const [weaponId, progress] of Object.entries(delta.byWeapon)) {
    const current = state.byWeapon[weaponId] ?? { uses: 0, finishes: 0, seenMoves: [] }
    state.byWeapon[weaponId] = {
      uses: clampedSum(current.uses, progress.uses),
      finishes: clampedSum(current.finishes, progress.finishes),
      seenMoves: sortedUnion(current.seenMoves, progress.addSeenMoves),
    }
  }
  for (const targetId of ['word', 'earth', 'city'] as const) {
    state.byTarget[targetId].destroys = clampedSum(
      state.byTarget[targetId].destroys,
      delta.byTarget[targetId]
    )
  }
  for (const [id, achievement] of Object.entries(delta.achievements)) {
    state.achievements[id] = mergeAchievement(state.achievements[id], achievement)
  }

  for (const definition of PLAYER_SYNC_ACHIEVEMENTS) {
    if (achievementReached(state, definition.id)) {
      state.achievements[definition.id] = mergeAchievement(state.achievements[definition.id], {
        unlockedAt: trustedAt,
        seen: false,
      })
    }
  }

  const settings = delta.settings
  if ('selectedTitle' in settings) {
    if (settings.selectedTitle === null) state.profile.selectedTitle = null
    else {
      const achievement = PLAYER_SYNC_ACHIEVEMENTS.find(({ title }) => title === settings.selectedTitle)
      if (achievement && state.achievements[achievement.id]) state.profile.selectedTitle = settings.selectedTitle
    }
  }
  if (settings.cinnamorollSkin !== undefined) state.profile.skins.cinnamoroll = settings.cinnamorollSkin
  if (settings.dittoSkin !== undefined) state.profile.skins.ditto = settings.dittoSkin
  if (settings.strongInput !== undefined) state.profile.strongInput = settings.strongInput
  if (settings.reducedMotion !== undefined) state.profile.reducedMotion = settings.reducedMotion
  if (settings.haptics !== undefined) state.profile.haptics = settings.haptics
  return state
}

function dailyEvidence(
  daily: SyncProgressState['daily'],
  operation: PlayerProgressOperationV1,
  acceptedAt: string | null
): SyncProgressState['daily'] {
  if (daily.dayKey !== operation.playDayKey || !daily.quest) return daily
  const next = structuredClone(daily)
  switch (daily.quest.event) {
    case 'CHARGE_RELEASED':
      next.progress = Math.min(next.target, clampedSum(next.progress, operation.delta.chargedFinishers))
      break
    case 'TARGET_DESTROYED': {
      const added = operation.delta.byTarget.word
        + operation.delta.byTarget.earth
        + operation.delta.byTarget.city
      next.progress = Math.min(next.target, clampedSum(next.progress, added))
      break
    }
    case 'WEAPON_USED': {
      const characterIds = Object.entries(operation.delta.byWeapon)
        .filter(([id, progress]) => CHARACTER_IDS.has(id) && progress.uses > 0)
        .map(([id]) => id)
      next.distinctIds = sortedUnion(next.distinctIds, characterIds)
      next.progress = Math.min(next.target, next.distinctIds.length)
      break
    }
  }
  if (acceptedAt !== null && next.progress >= next.target && next.completedAt === null) {
    next.completedAt = acceptedAt
    next.stampAwarded = true
  }
  return next
}

/** Applies one database-accepted operation. Database accepted order must be supplied by the caller. */
export function applyPlayerOperation(
  input: SyncProgressState,
  operation: AcceptedPlayerProgressOperationV1,
  serverAssignment?: SyncProgressState['daily'] | null
): SyncProgressState {
  let state = applyAccountDelta(input, operation, operation.acceptedAt)
  if (serverAssignment && serverAssignment.dayKey === operation.playDayKey) {
    const daily = state.daily.dayKey === serverAssignment.dayKey
      && state.daily.questId === serverAssignment.questId
      ? state.daily
      : structuredClone(serverAssignment)
    state = { ...state, daily: dailyEvidence(daily, operation, operation.acceptedAt) }
  }
  return state
}

/** Applies local optimistic evidence without creating server-authoritative completion metadata. */
export function applyPendingPlayerOperation(
  input: SyncProgressState,
  operation: PlayerProgressOperationV1
): SyncProgressState {
  const state = applyAccountDelta(input, operation, operation.createdAt)
  return {
    ...state,
    daily: dailyEvidence(state.daily, operation, null),
  }
}
