import type { PlayerVerification } from './player-request-security.ts'
import {
  applyPlayerOperation,
  parseSyncBatch,
  reconcilePlayerAchievements,
  type AcceptedPlayerProgressOperationV1,
  type PlayerProgressOperationV1,
  type SyncProgressState,
} from './player-sync-contract.ts'
import { isUuid } from './player-contract.ts'
import {
  ACHIEVEMENT_CATALOG,
  availableFrameIds,
  availableThemeIds,
} from './achievement-catalog.ts'

const MAX_BODY_BYTES = 256 * 1024
const MAX_PROJECTION_ATTEMPTS = 3
const MAX_DAILY_AGE_DAYS = 90
const ACHIEVEMENT_IDS = new Set<string>(ACHIEVEMENT_CATALOG.map(({ id }) => id))
const FRAME_IDS = new Set<string>(availableFrameIds(20))
const THEME_IDS = new Set<string>(availableThemeIds(20))

interface ServerQuest {
  id: string
  copy: string
  event: 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED'
  distinct: 'weaponId' | null
  target: number
}

const SERVER_QUESTS: readonly ServerQuest[] = [
  {
    id: 'charged_finisher_2',
    copy: '꾹 와장창 2번',
    event: 'CHARGE_RELEASED',
    distinct: null,
    target: 2,
  },
  {
    id: 'characters_3',
    copy: '캐릭터 3종 만나기',
    event: 'WEAPON_USED',
    distinct: 'weaponId',
    target: 3,
  },
  {
    id: 'targets_3',
    copy: '타겟 3개 부수기',
    event: 'TARGET_DESTROYED',
    distinct: null,
    target: 3,
  },
]

export interface PlayerSyncRequest {
  deviceId: string
  previousSeq: number
  operations: PlayerProgressOperationV1[]
  knownRevision: number
}

export interface PlayerSyncResponse {
  userId: string
  deviceId: string
  acknowledgedThrough: number
  revision: number
  state: SyncProgressState
  serverTime: string
}

export interface PlayerSyncProgressRow {
  userId: string
  accountSeed: string
  revision: number
  state: unknown
  lastOperationId: number
}

export interface PlayerSyncDailyRow {
  state: SyncProgressState['daily']
  revision: number
  lastOperationId: number
}

export interface PlayerSyncDependencies {
  verifyCurrentPlayer(request: Request): Promise<PlayerVerification>
  consume(userId: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  isWriteEnabled(): Promise<boolean>
  acknowledgedThrough(userId: string, deviceId: string): Promise<number>
  acceptedOperationId(userId: string, deviceId: string, sequence: number): Promise<string | null>
  accept(
    userId: string,
    deviceId: string,
    previousSeq: number,
    operations: PlayerProgressOperationV1[],
  ): Promise<{ acknowledgedThrough: number; maxOperationId: number }>
  loadProgress(userId: string): Promise<PlayerSyncProgressRow>
  loadOperationsAfter(userId: string, operationId: number): Promise<AcceptedPlayerProgressOperationV1[]>
  ensureDailyAssignment(userId: string, dayKey: string, quest: ServerQuest): Promise<PlayerSyncDailyRow>
  compareAndSwapDaily(
    userId: string,
    dayKey: string,
    expectedRevision: number,
    state: SyncProgressState['daily'],
    lastOperationId: number,
  ): Promise<boolean>
  recordDailyCompletion(
    userId: string,
    dayKey: string,
    questId: string,
    completedAt: string,
  ): Promise<number>
  countDailyCompletions(userId: string): Promise<number>
  compareAndSwapProgress(
    userId: string,
    expectedRevision: number,
    state: SyncProgressState,
    lastOperationId: number,
  ): Promise<boolean>
  currentKstDayKey(): string
  nowIso(): string
  log?(event: {
    operationCount: '0' | '1-10' | '11-50' | '51-100'
    status: string
    retryCount: number
    duration: '<100ms' | '100-499ms' | '500-1999ms' | '2000ms+'
    exceptionClass?: string
  }): void
}

export class PlayerSyncSequenceGapError extends Error {
  constructor(readonly expectedPreviousSeq: number) {
    super('sequence_gap')
    this.name = 'PlayerSyncSequenceGapError'
  }
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

function safeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function validCounter(value: unknown): value is number {
  return safeNonnegativeInteger(value)
}

function validIso(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value))
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 64
    && value.every((item) => typeof item === 'string')
}

function validDaily(value: unknown): value is SyncProgressState['daily'] {
  if (!isRecord(value)) return false
  if (
    typeof value.dayKey !== 'string'
    || typeof value.questId !== 'string'
    || !validCounter(value.target)
    || !validCounter(value.progress)
    || !validStringArray(value.distinctIds)
    || (value.completedAt !== null && typeof value.completedAt !== 'string')
    || typeof value.stampAwarded !== 'boolean'
  ) return false
  if (value.quest !== undefined) {
    if (!isRecord(value.quest)) return false
    if (
      typeof value.quest.copy !== 'string'
      || !['CHARGE_RELEASED', 'WEAPON_USED', 'TARGET_DESTROYED'].includes(String(value.quest.event))
      || (value.quest.distinct !== null && value.quest.distinct !== 'weaponId')
    ) return false
  }
  return value.progress <= value.target || value.target === 0
}

function parseProgressState(value: unknown): SyncProgressState | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (!safeNonnegativeInteger(value.catalogVersion) || typeof value.installSeed !== 'string') return null
  if (!isRecord(value.lifetime) || !hasExactKeys(value.lifetime, [
    'validHits',
    'chargedFinishers',
    'totalTargets',
    'bestCombo',
    'stamps',
    'distinctWeaponIds',
  ])) return null
  if (
    !validCounter(value.lifetime.validHits)
    || !validCounter(value.lifetime.chargedFinishers)
    || !validCounter(value.lifetime.totalTargets)
    || !validCounter(value.lifetime.bestCombo)
    || !validCounter(value.lifetime.stamps)
    || !validStringArray(value.lifetime.distinctWeaponIds)
  ) return null
  if (!isRecord(value.byWeapon) || Object.keys(value.byWeapon).length > 21) return null
  for (const progress of Object.values(value.byWeapon)) {
    if (!isRecord(progress) || !hasExactKeys(progress, ['uses', 'finishes', 'seenMoves'])) return null
    if (!validCounter(progress.uses) || !validCounter(progress.finishes) || !validStringArray(progress.seenMoves)) {
      return null
    }
  }
  if (!isRecord(value.byTarget) || !hasExactKeys(value.byTarget, ['word', 'earth', 'city'])) return null
  for (const targetId of ['word', 'earth', 'city'] as const) {
    const target = value.byTarget[targetId]
    if (!isRecord(target) || !hasExactKeys(target, ['destroys']) || !validCounter(target.destroys)) return null
  }
  if (
    !isRecord(value.achievements)
    || Object.keys(value.achievements).length > ACHIEVEMENT_CATALOG.length
    || Object.keys(value.achievements).some((id) => !ACHIEVEMENT_IDS.has(id))
  ) return null
  for (const achievement of Object.values(value.achievements)) {
    if (!isRecord(achievement) || !hasExactKeys(achievement, ['unlockedAt', 'seen'])) return null
    if (!validIso(achievement.unlockedAt) || typeof achievement.seen !== 'boolean') return null
  }
  if (!validDaily(value.daily)) return null
  if (!isRecord(value.profile)) return null
  const profile = value.profile
  const requiredProfileKeys = [
    'selectedTitle',
    'skins',
    'strongInput',
    'reducedMotion',
    'haptics',
  ] as const
  const allowedProfileKeys = new Set([
    ...requiredProfileKeys,
    'frameId',
    'recordBookThemeId',
  ])
  if (
    requiredProfileKeys.some((key) => !(key in profile))
    || Object.keys(profile).some((key) => !allowedProfileKeys.has(key))
  ) return null
  if (
    (profile.selectedTitle !== null && typeof profile.selectedTitle !== 'string')
    || !isRecord(profile.skins)
    || ('frameId' in profile && (
      typeof profile.frameId !== 'string' || !FRAME_IDS.has(profile.frameId)
    ))
    || ('recordBookThemeId' in profile && (
      typeof profile.recordBookThemeId !== 'string'
      || !THEME_IDS.has(profile.recordBookThemeId)
    ))
    || (profile.strongInput !== 'hold' && profile.strongInput !== 'doubleTap')
    || typeof profile.reducedMotion !== 'boolean'
    || typeof profile.haptics !== 'boolean'
  ) return null
  const normalized = structuredClone(value) as unknown as SyncProgressState
  normalized.profile.frameId = 'frameId' in profile
    ? profile.frameId as SyncProgressState['profile']['frameId']
    : 'default'
  normalized.profile.recordBookThemeId = 'recordBookThemeId' in profile
    ? profile.recordBookThemeId as SyncProgressState['profile']['recordBookThemeId']
    : 'default'
  return normalized
}

async function requestJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function parseRequest(value: unknown): PlayerSyncRequest | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'deviceId',
    'previousSeq',
    'operations',
    'knownRevision',
  ])) return null
  if (
    !isUuid(value.deviceId)
    || !safeNonnegativeInteger(value.previousSeq)
    || !safeNonnegativeInteger(value.knownRevision)
  ) return null
  let operations: PlayerProgressOperationV1[]
  try {
    operations = parseSyncBatch(value.operations)
  } catch {
    return null
  }
  for (let index = 0; index < operations.length; index += 1) {
    if (
      operations[index].deviceId !== value.deviceId
      || operations[index].clientSeq !== value.previousSeq + index + 1
    ) return null
  }
  return {
    deviceId: value.deviceId,
    previousSeq: value.previousSeq,
    operations,
    knownRevision: value.knownRevision,
  }
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function json(status: number, value: object): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function deterministicQuest(seed: string, dayKey: string): ServerQuest {
  let hash = 0x811c9dc5
  const source = `${seed}:${dayKey}`
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return SERVER_QUESTS[(hash >>> 0) % SERVER_QUESTS.length]
}

function dayAge(current: string, candidate: string): number | null {
  const currentTime = Date.parse(`${current}T00:00:00.000Z`)
  const candidateTime = Date.parse(`${candidate}T00:00:00.000Z`)
  if (!Number.isFinite(currentTime) || !Number.isFinite(candidateTime)) return null
  const age = (currentTime - candidateTime) / 86_400_000
  return Number.isInteger(age) ? age : null
}

function isAllowedDailyDay(current: string, candidate: string): boolean {
  const age = dayAge(current, candidate)
  return age !== null && age >= 0 && age <= MAX_DAILY_AGE_DAYS
}

function sameDailyState(
  left: SyncProgressState['daily'],
  right: SyncProgressState['daily'],
): boolean {
  return left.dayKey === right.dayKey
    && left.questId === right.questId
    && left.target === right.target
    && left.progress === right.progress
    && left.completedAt === right.completedAt
    && left.stampAwarded === right.stampAwarded
    && left.distinctIds.length === right.distinctIds.length
    && left.distinctIds.every((id, index) => id === right.distinctIds[index])
    && left.quest?.copy === right.quest?.copy
    && left.quest?.event === right.quest?.event
    && left.quest?.distinct === right.quest?.distinct
}

function sameReconciledProjection(
  left: SyncProgressState,
  right: SyncProgressState,
): boolean {
  const leftIds = Object.keys(left.achievements).sort()
  const rightIds = Object.keys(right.achievements).sort()
  return leftIds.length === rightIds.length
    && leftIds.every((id, index) => {
      const leftValue = left.achievements[id]
      const rightValue = right.achievements[rightIds[index]]
      return id === rightIds[index]
        && leftValue.unlockedAt === rightValue.unlockedAt
        && leftValue.seen === rightValue.seen
    })
    && left.profile.selectedTitle === right.profile.selectedTitle
    && left.profile.frameId === right.profile.frameId
    && left.profile.recordBookThemeId === right.profile.recordBookThemeId
}

function operationBucket(count: number): '0' | '1-10' | '11-50' | '51-100' {
  if (count === 0) return '0'
  if (count <= 10) return '1-10'
  if (count <= 50) return '11-50'
  return '51-100'
}

function durationBucket(milliseconds: number): '<100ms' | '100-499ms' | '500-1999ms' | '2000ms+' {
  if (milliseconds < 100) return '<100ms'
  if (milliseconds < 500) return '100-499ms'
  if (milliseconds < 2000) return '500-1999ms'
  return '2000ms+'
}

async function currentResponse(
  dependencies: PlayerSyncDependencies,
  userId: string,
  deviceId: string,
  acknowledgedThrough: number,
): Promise<Response> {
  const row = await dependencies.loadProgress(userId)
  const parsed = parseProgressState(row.state)
  const state = parsed ? reconcilePlayerAchievements(parsed) : null
  if (!state || row.userId !== userId || !safeNonnegativeInteger(row.revision)) {
    throw new Error('projection_parse_failed')
  }
  return json(200, {
    userId,
    deviceId,
    acknowledgedThrough,
    revision: row.revision,
    state,
    serverTime: dependencies.nowIso(),
  } satisfies PlayerSyncResponse)
}

async function filterAcceptedPrefix(
  dependencies: PlayerSyncDependencies,
  userId: string,
  input: PlayerSyncRequest,
  serverThrough: number,
): Promise<{ previousSeq: number; operations: PlayerProgressOperationV1[] } | null> {
  if (input.previousSeq > serverThrough) return null
  if (input.previousSeq === serverThrough) {
    return { previousSeq: serverThrough, operations: input.operations }
  }

  const acceptedCount = serverThrough - input.previousSeq
  if (input.operations.length < acceptedCount) return null
  for (let index = 0; index < acceptedCount; index += 1) {
    const operation = input.operations[index]
    const storedId = await dependencies.acceptedOperationId(
      userId,
      input.deviceId,
      operation.clientSeq,
    )
    if (storedId !== operation.operationId) return null
  }
  return {
    previousSeq: serverThrough,
    operations: input.operations.slice(acceptedCount),
  }
}

async function projectOperations(
  dependencies: PlayerSyncDependencies,
  userId: string,
): Promise<{ revision: number; state: SyncProgressState; retryCount: number } | null> {
  const currentDayKey = dependencies.currentKstDayKey()
  for (let attempt = 0; attempt < MAX_PROJECTION_ATTEMPTS; attempt += 1) {
    const progressRow = await dependencies.loadProgress(userId)
    const parsed = parseProgressState(progressRow.state)
    if (
      !parsed
      || progressRow.userId !== userId
      || !safeNonnegativeInteger(progressRow.revision)
      || !safeNonnegativeInteger(progressRow.lastOperationId)
    ) throw new Error('projection_parse_failed')
    const state = reconcilePlayerAchievements(parsed)
    const reconciliationChanged = !sameReconciledProjection(parsed, state)

    const operations = await dependencies.loadOperationsAfter(userId, progressRow.lastOperationId)
    if (operations.length === 0) {
      const assignment = await dependencies.ensureDailyAssignment(
        userId,
        currentDayKey,
        deterministicQuest(progressRow.accountSeed, currentDayKey),
      )
      if (!reconciliationChanged && sameDailyState(state.daily, assignment.state)) {
        return { revision: progressRow.revision, state, retryCount: attempt }
      }
      const hydrated = { ...state, daily: structuredClone(assignment.state) }
      const swapped = await dependencies.compareAndSwapProgress(
        userId,
        progressRow.revision,
        hydrated,
        progressRow.lastOperationId,
      )
      if (!swapped) continue
      return { revision: progressRow.revision + 1, state: hydrated, retryCount: attempt }
    }
    const sorted = [...operations].sort((left, right) => left.acceptedOrder - right.acceptedOrder)
    const dayKeys = [...new Set(sorted.map((operation) => operation.playDayKey))]
      .filter((dayKey) => isAllowedDailyDay(currentDayKey, dayKey))
      .sort()
    const resolvedDaily = new Map<string, SyncProgressState['daily']>()
    let dailyConflict = false

    for (const dayKey of dayKeys) {
      const assignment = await dependencies.ensureDailyAssignment(
        userId,
        dayKey,
        deterministicQuest(progressRow.accountSeed, dayKey),
      )
      const dailyOperations = (await dependencies.loadOperationsAfter(userId, assignment.lastOperationId))
        .filter((operation) => operation.playDayKey === dayKey)
        .sort((left, right) => left.acceptedOrder - right.acceptedOrder)
      if (dailyOperations.length === 0) {
        resolvedDaily.set(dayKey, assignment.state)
        continue
      }

      let dailyState: SyncProgressState = { ...structuredClone(state), daily: structuredClone(assignment.state) }
      for (const operation of dailyOperations) {
        dailyState = applyPlayerOperation(dailyState, operation, assignment.state)
      }
      const nextDaily = dailyState.daily
      const lastOperationId = dailyOperations[dailyOperations.length - 1].acceptedOrder
      const swapped = await dependencies.compareAndSwapDaily(
        userId,
        dayKey,
        assignment.revision,
        nextDaily,
        lastOperationId,
      )
      if (!swapped) {
        dailyConflict = true
        break
      }
      if (assignment.state.completedAt === null && nextDaily.completedAt !== null) {
        await dependencies.recordDailyCompletion(
          userId,
          dayKey,
          nextDaily.questId,
          nextDaily.completedAt,
        )
      }
      resolvedDaily.set(dayKey, nextDaily)
    }
    if (dailyConflict) continue

    let nextState = state
    nextState.lifetime.stamps = await dependencies.countDailyCompletions(userId)
    nextState = reconcilePlayerAchievements(
      nextState,
      sorted[sorted.length - 1].acceptedAt,
    )
    for (const operation of sorted) nextState = applyPlayerOperation(nextState, operation)

    let currentDaily = resolvedDaily.get(currentDayKey)
    if (!currentDaily) {
      const assignment = await dependencies.ensureDailyAssignment(
        userId,
        currentDayKey,
        deterministicQuest(progressRow.accountSeed, currentDayKey),
      )
      currentDaily = assignment.state
    }
    nextState.daily = structuredClone(currentDaily)

    const lastOperationId = sorted[sorted.length - 1].acceptedOrder
    const swapped = await dependencies.compareAndSwapProgress(
      userId,
      progressRow.revision,
      nextState,
      lastOperationId,
    )
    if (!swapped) continue
    return { revision: progressRow.revision + 1, state: nextState, retryCount: attempt }
  }
  return null
}

export function createPlayerSyncHandler(dependencies: PlayerSyncDependencies) {
  return async (request: Request): Promise<Response> => {
    const startedAt = Date.now()
    let operationCount = 0
    let retryCount = 0
    let status = 'service_unavailable'
    let exceptionClass: string | undefined
    try {
      if (request.method !== 'POST') {
        status = 'method_not_allowed'
        return json(405, { code: status })
      }
      const verification = await dependencies.verifyCurrentPlayer(request)
      if (!verification.ok) {
        status = verification.code
        return json(verification.status, { code: verification.code })
      }
      if (verification.player.forcePinChange) {
        status = 'pin_change_required'
        return json(403, { code: status })
      }

      const limit = await dependencies.consume(verification.player.userId)
      if (!limit.allowed) {
        status = 'rate_limited'
        return json(429, { code: status, retryAfterSeconds: limit.retryAfterSeconds })
      }

      const input = parseRequest(await requestJson(request))
      if (!input) {
        status = 'invalid_request'
        return json(400, { code: status })
      }
      operationCount = input.operations.length
      const writesEnabled = await dependencies.isWriteEnabled()
      if (!writesEnabled) {
        if (input.operations.length > 0) {
          status = 'sync_paused'
          return json(503, { code: status })
        }
        const acknowledged = await dependencies.acknowledgedThrough(
          verification.player.userId,
          input.deviceId,
        )
        status = 'ok'
        return await currentResponse(
          dependencies,
          verification.player.userId,
          input.deviceId,
          acknowledged,
        )
      }

      const serverThrough = await dependencies.acknowledgedThrough(
        verification.player.userId,
        input.deviceId,
      )
      const filtered = await filterAcceptedPrefix(
        dependencies,
        verification.player.userId,
        input,
        serverThrough,
      )
      if (!filtered) {
        status = 'sequence_gap'
        return json(409, { code: status, expectedPreviousSeq: serverThrough })
      }

      let acknowledgedThrough = serverThrough
      if (filtered.operations.length > 0) {
        try {
          const accepted = await dependencies.accept(
            verification.player.userId,
            input.deviceId,
            filtered.previousSeq,
            filtered.operations,
          )
          acknowledgedThrough = accepted.acknowledgedThrough
        } catch (error) {
          if (error instanceof PlayerSyncSequenceGapError) {
            status = 'sequence_gap'
            return json(409, { code: status, expectedPreviousSeq: error.expectedPreviousSeq })
          }
          throw error
        }
      }

      const projected = await projectOperations(dependencies, verification.player.userId)
      if (!projected) {
        status = 'sync_busy'
        retryCount = MAX_PROJECTION_ATTEMPTS
        return json(503, { code: status })
      }
      retryCount = projected.retryCount
      status = 'ok'
      return json(200, {
        userId: verification.player.userId,
        deviceId: input.deviceId,
        acknowledgedThrough,
        revision: projected.revision,
        state: projected.state,
        serverTime: dependencies.nowIso(),
      } satisfies PlayerSyncResponse)
    } catch (error) {
      exceptionClass = error instanceof Error ? error.name : 'UnknownError'
      status = 'service_unavailable'
      return json(503, { code: status })
    } finally {
      try {
        dependencies.log?.({
          operationCount: operationBucket(operationCount),
          status,
          retryCount,
          duration: durationBucket(Date.now() - startedAt),
          ...(exceptionClass ? { exceptionClass } : {}),
        })
      } catch {
        // Logging is isolated from the sync response and carries no profile or operation content.
      }
    }
  }
}
