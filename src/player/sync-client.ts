import { isUuid } from '../../supabase/functions/_shared/player-contract'
import {
  applyPendingPlayerOperation,
  diffPlayerProgress,
  type PlayerProgressOperationV1,
  type SyncProgressState,
} from '../../supabase/functions/_shared/player-sync-contract'
import { KNOWN_MOVE_IDS, KNOWN_WEAPON_IDS } from '../game-progress'
import { parseProgress } from '../progress/validate'
import type { ProgressStateV1 } from '../progress/types'
import type { OperationRow, PlayerOutbox, SnapshotRow } from './outbox'

const RETRY_DELAYS = [1_000, 2_000, 4_000] as const

export type SyncStatus =
  | { kind: 'saved'; lastSavedAt: string }
  | { kind: 'saving' }
  | { kind: 'offline'; pending: number }
  | { kind: 'retry'; pending: number; message: string }
  | { kind: 'auth-expired'; pending: number }

export interface PlayerSyncTransportResult {
  status: number
  body: unknown
  retryAfterSeconds?: number
}

export interface PlayerSyncTransport {
  send(request: {
    deviceId: string
    previousSeq: number
    operations: PlayerProgressOperationV1[]
    knownRevision: number
  }): Promise<PlayerSyncTransportResult>
  refreshSession(): Promise<boolean>
}

export interface PlayerProjectionInput {
  userId: string
  generation: number
  revision: number
  state: ProgressStateV1
}

export interface PlayerSyncClientOptions {
  userId: string
  generation: number
  outbox: PlayerOutbox
  transport: PlayerSyncTransport
  writesEnabled: () => boolean
  getCurrentState: () => ProgressStateV1
  onProjection: (input: PlayerProjectionInput) => void
  onStatus: (status: SyncStatus) => void
  onDiagnostic?: (diagnostic: 'gap_recovered' | 'gap_unrecoverable' | 'invalid_response') => void
  sleep?: (milliseconds: number) => Promise<void>
  nowIso?: () => string
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

type ParsedResponse = {
  userId: string
  deviceId: string
  acknowledgedThrough: number
  revision: number
  state: SyncProgressState
  serverTime: string
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

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseResponse(value: unknown): ParsedResponse | null {
  if (!isRecord(value) || !hasExactKeys(value, [
    'userId',
    'deviceId',
    'acknowledgedThrough',
    'revision',
    'state',
    'serverTime',
  ])) return null
  if (
    !isUuid(value.userId)
    || !isUuid(value.deviceId)
    || !nonnegativeInteger(value.acknowledgedThrough)
    || !nonnegativeInteger(value.revision)
    || typeof value.serverTime !== 'string'
    || !Number.isFinite(Date.parse(value.serverTime))
    || !isRecord(value.state)
    || value.state.schemaVersion !== 1
    || typeof value.state.installSeed !== 'string'
    || !isRecord(value.state.lifetime)
    || !isRecord(value.state.byWeapon)
    || !isRecord(value.state.byTarget)
    || !isRecord(value.state.achievements)
    || !isRecord(value.state.daily)
    || !isRecord(value.state.profile)
  ) return null
  const state = parseProgress(value.state, KNOWN_WEAPON_IDS, KNOWN_MOVE_IDS)
  if (state.installSeed === '') return null
  return {
    userId: value.userId,
    deviceId: value.deviceId,
    acknowledgedThrough: value.acknowledgedThrough,
    revision: value.revision,
    state,
    serverTime: value.serverTime,
  }
}

function wireOperation(row: OperationRow): PlayerProgressOperationV1 {
  return {
    operationId: row.operationId,
    operationVersion: row.operationVersion,
    deviceId: row.deviceId,
    clientSeq: row.clientSeq,
    createdAt: row.createdAt,
    playDayKey: row.playDayKey,
    dailyQuest: row.dailyQuest,
    delta: row.delta,
  }
}

function errorCode(body: unknown): string | null {
  return isRecord(body) && typeof body.code === 'string' ? body.code : null
}

function expectedPreviousSequence(body: unknown): number | null {
  return isRecord(body) && nonnegativeInteger(body.expectedPreviousSeq)
    ? body.expectedPreviousSeq
    : null
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class PlayerSyncClient {
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly nowIso: () => string
  private readonly setTimer: PlayerSyncClientOptions['setTimer']
  private readonly clearTimer: PlayerSyncClientOptions['clearTimer']
  private active = true
  private lifecycle = 1
  private latestRevision = 0
  private currentSync: Promise<number> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private started = false

  private readonly online = () => { void this.syncNow() }
  private readonly pagehide = () => { void this.syncNow() }
  private readonly visibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') void this.syncNow()
  }

  constructor(private readonly options: PlayerSyncClientOptions) {
    if (!isUuid(options.userId) || !Number.isSafeInteger(options.generation) || options.generation < 1) {
      throw new Error('invalid_player_sync_identity')
    }
    this.sleep = options.sleep ?? defaultSleep
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
    this.setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds))
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer))
  }

  start(): void {
    if (this.started || !this.active) return
    this.started = true
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.online)
      window.addEventListener('pagehide', this.pagehide)
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibility)
    }
    void this.syncNow()
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    this.lifecycle += 1
    if (this.debounceTimer !== null && this.clearTimer) {
      this.clearTimer(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.started && typeof window !== 'undefined') {
      window.removeEventListener('online', this.online)
      window.removeEventListener('pagehide', this.pagehide)
    }
    if (this.started && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibility)
    }
    this.started = false
  }

  notifyOperationAppended(): void {
    if (!this.active) return
    this.options.onStatus({ kind: 'saving' })
    if (this.debounceTimer !== null && this.clearTimer) this.clearTimer(this.debounceTimer)
    if (!this.setTimer) return
    this.debounceTimer = this.setTimer(() => {
      this.debounceTimer = null
      void this.syncNow()
    }, 500)
  }

  retry(): Promise<number> {
    return this.syncNow()
  }

  syncNow(): Promise<number> {
    if (!this.active) return this.pendingCount()
    if (this.currentSync) return this.currentSync
    const lifecycle = this.lifecycle
    const current = this.run(lifecycle).finally(() => {
      if (this.currentSync === current) this.currentSync = null
    })
    this.currentSync = current
    return current
  }

  async flush(timeoutMilliseconds: number): Promise<number> {
    const sync = this.syncNow()
    const timeout = new Promise<number>((resolve) => {
      setTimeout(() => { void this.pendingCount().then(resolve) }, Math.max(0, timeoutMilliseconds))
    })
    return Promise.race([sync, timeout])
  }

  private async run(lifecycle: number): Promise<number> {
    const initial = await this.options.outbox.load(this.options.userId)
    this.latestRevision = Math.max(this.latestRevision, initial.snapshot?.revision ?? 0)
    if (!this.options.writesEnabled()) {
      const pending = initial.operations.length
      this.options.onStatus({ kind: 'offline', pending })
      return pending
    }

    this.options.onStatus({ kind: 'saving' })
    let refreshed = false
    let immediateGapRetries = 0
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      if (!this.isCurrent(lifecycle)) return this.pendingCount()
      let result: PlayerSyncTransportResult
      let request: {
        deviceId: string
        previousSeq: number
        operations: PlayerProgressOperationV1[]
        knownRevision: number
      }
      try {
        request = await this.makeRequest()
        result = await this.options.transport.send(request)
      } catch {
        if (attempt < RETRY_DELAYS.length) {
          await this.sleep(RETRY_DELAYS[attempt])
          continue
        }
        return this.manualRetry('network')
      }
      if (!this.isCurrent(lifecycle)) return this.pendingCount()

      if (result.status === 200) {
        return this.applySuccess(result.body, request, lifecycle)
      }
      if (result.status === 401) {
        if (!refreshed) {
          refreshed = true
          if (await this.options.transport.refreshSession()) {
            attempt -= 1
            continue
          }
        }
        const pending = await this.pendingCount()
        this.options.onStatus({ kind: 'auth-expired', pending })
        return pending
      }
      if (result.status === 409 && errorCode(result.body) === 'sequence_gap') {
        const expected = expectedPreviousSequence(result.body)
        if (expected === null) return this.manualRetry('invalid_gap')
        const resolution = await this.resolveGap(expected, lifecycle)
        if (resolution === 'retry' && immediateGapRetries < 2) {
          immediateGapRetries += 1
          attempt -= 1
          continue
        }
        return this.pendingCount()
      }
      const retryable = result.status === 429 || result.status >= 500
      if (retryable && attempt < RETRY_DELAYS.length) {
        const serverDelay = Math.max(0, result.retryAfterSeconds ?? 0) * 1_000
        await this.sleep(Math.max(RETRY_DELAYS[attempt], serverDelay))
        continue
      }
      return this.manualRetry(errorCode(result.body) ?? `http_${result.status}`)
    }
    return this.manualRetry('retry_exhausted')
  }

  private async makeRequest() {
    const loaded = await this.options.outbox.load(this.options.userId)
    const batch = await this.options.outbox.nextBatch(this.options.userId)
    const previousSeq = batch.length > 0
      ? batch[0].clientSeq - 1
      : loaded.meta.acknowledgedThrough
    return {
      deviceId: loaded.meta.deviceId,
      previousSeq,
      operations: batch.map(wireOperation),
      knownRevision: loaded.snapshot?.revision ?? this.latestRevision,
    }
  }

  private async applySuccess(
    body: unknown,
    request: Awaited<ReturnType<PlayerSyncClient['makeRequest']>>,
    lifecycle: number,
  ): Promise<number> {
    const response = parseResponse(body)
    if (
      !response
      || response.userId !== this.options.userId
      || response.deviceId !== request.deviceId
      || response.revision < request.knownRevision
      || response.revision < this.latestRevision
    ) {
      this.options.onDiagnostic?.('invalid_response')
      return this.manualRetry('invalid_response')
    }
    if (!this.isCurrent(lifecycle)) return this.pendingCount()

    const snapshot: SnapshotRow = {
      userId: this.options.userId,
      revision: response.revision,
      state: response.state,
      savedAt: response.serverTime,
    }
    await this.options.outbox.acknowledge(
      this.options.userId,
      response.acknowledgedThrough,
      snapshot,
    )
    if (!this.isCurrent(lifecycle)) return this.pendingCount()

    const remaining = await this.options.outbox.load(this.options.userId)
    const visible = remaining.operations
      .slice()
      .sort((left, right) => left.clientSeq - right.clientSeq)
      .reduce<SyncProgressState>(
        (state, operation) => applyPendingPlayerOperation(state, operation),
        structuredClone(response.state),
      )
    this.latestRevision = response.revision
    this.options.onProjection({
      userId: this.options.userId,
      generation: this.options.generation,
      revision: response.revision,
      state: visible,
    })
    const pending = remaining.operations.length
    if (pending === 0) this.options.onStatus({ kind: 'saved', lastSavedAt: this.nowIso() })
    else {
      this.options.onStatus({ kind: 'saving' })
      this.notifyOperationAppended()
    }
    return pending
  }

  private async resolveGap(expectedPreviousSeq: number, lifecycle: number): Promise<'retry' | 'repaired'> {
    const loaded = await this.options.outbox.load(this.options.userId)
    if (loaded.operations.some((operation) => operation.clientSeq === expectedPreviousSeq + 1)) {
      return 'retry'
    }
    const pull = await this.options.transport.send({
      deviceId: loaded.meta.deviceId,
      previousSeq: expectedPreviousSeq,
      operations: [],
      knownRevision: loaded.snapshot?.revision ?? this.latestRevision,
    })
    const response = pull.status === 200 ? parseResponse(pull.body) : null
    if (
      !response
      || response.userId !== this.options.userId
      || response.deviceId !== loaded.meta.deviceId
      || !this.isCurrent(lifecycle)
    ) {
      this.options.onDiagnostic?.('gap_unrecoverable')
      return 'repaired'
    }

    let recovery = null
    try {
      recovery = diffPlayerProgress(response.state, this.options.getCurrentState(), {
        nowIso: this.nowIso(),
        serverMayNotHaveDaily: true,
      })
    } catch {
      this.options.onDiagnostic?.('gap_unrecoverable')
    }
    await this.options.outbox.repairGap(this.options.userId, expectedPreviousSeq, {
      userId: this.options.userId,
      revision: response.revision,
      state: response.state,
      savedAt: response.serverTime,
    }, recovery)
    if (!this.isCurrent(lifecycle)) return 'repaired'

    const repaired = await this.options.outbox.load(this.options.userId)
    const visible = repaired.operations.reduce<SyncProgressState>(
      (state, operation) => applyPendingPlayerOperation(state, operation),
      structuredClone(response.state),
    )
    this.latestRevision = Math.max(this.latestRevision, response.revision)
    this.options.onProjection({
      userId: this.options.userId,
      generation: this.options.generation,
      revision: response.revision,
      state: visible,
    })
    this.options.onDiagnostic?.('gap_recovered')
    this.options.onStatus(repaired.operations.length === 0
      ? { kind: 'saved', lastSavedAt: this.nowIso() }
      : { kind: 'saving' })
    return 'repaired'
  }

  private async manualRetry(message: string): Promise<number> {
    const pending = await this.pendingCount()
    this.options.onStatus({ kind: 'retry', pending, message })
    return pending
  }

  private async pendingCount(): Promise<number> {
    return (await this.options.outbox.load(this.options.userId)).operations.length
  }

  private isCurrent(lifecycle: number): boolean {
    return this.active && this.lifecycle === lifecycle
  }
}
