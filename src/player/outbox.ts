import { isUuid } from '../../supabase/functions/_shared/player-contract'
import {
  parseSyncBatch,
  type PlayerProgressDraftV1,
  type PlayerProgressOperationV1,
  type SyncProgressState,
} from '../../supabase/functions/_shared/player-sync-contract'

const DATABASE_NAME = 'btw.player.sync.v1'
const DATABASE_VERSION = 1
const MAX_BATCH_OPERATIONS = 100
const MAX_BATCH_BYTES = 256 * 1024

const META_STORE = 'meta'
const SNAPSHOT_STORE = 'snapshots'
const OPERATION_STORE = 'operations'
const USER_INDEX = 'userId'

export type OperationRow = PlayerProgressOperationV1 & { userId: string }
export type SnapshotRow = {
  userId: string
  revision: number
  state: SyncProgressState
  savedAt: string
}
export type MetaRow = {
  userId: string
  deviceId: string
  nextSeq: number
  acknowledgedThrough: number
}

export interface OutboxLoadResult {
  snapshot: SnapshotRow | null
  meta: MetaRow
  operations: OperationRow[]
}

export interface OutboxAdapter {
  load(userId: string): Promise<OutboxLoadResult>
  appendDraft(userId: string, draft: PlayerProgressDraftV1): Promise<OperationRow>
  nextBatch(userId: string): Promise<OperationRow[]>
  acknowledge(userId: string, throughSeq: number, snapshot: SnapshotRow): Promise<void>
  repairGap(
    userId: string,
    serverThroughSeq: number,
    snapshot: SnapshotRow,
    recovery: PlayerProgressDraftV1 | null,
  ): Promise<OperationRow | null>
  clearProfile(userId: string): Promise<void>
}

export interface PlayerOutboxOptions {
  indexedDB?: IDBFactory
  randomUuid?: () => string
  onMemoryFallback?: () => void
}

class OutboxInvariantError extends Error {}

function defaultRandomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  throw new Error('secure_uuid_unavailable')
}

function validUserId(userId: string): void {
  if (!isUuid(userId)) throw new OutboxInvariantError('invalid_player_user_id')
}

function validSequence(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_request_failed'))
  })
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb_transaction_aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb_transaction_failed'))
  })
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'userId' })
      }
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: 'userId' })
      }
      if (!database.objectStoreNames.contains(OPERATION_STORE)) {
        const operations = database.createObjectStore(OPERATION_STORE, {
          keyPath: ['userId', 'clientSeq'],
        })
        operations.createIndex(USER_INDEX, 'userId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_open_failed'))
    request.onblocked = () => reject(new Error('indexeddb_open_blocked'))
  })
}

function operationFromDraft(
  userId: string,
  meta: MetaRow,
  draft: PlayerProgressDraftV1,
  randomUuid: () => string,
): OperationRow {
  const operation: PlayerProgressOperationV1 = {
    ...draft,
    operationId: randomUuid(),
    operationVersion: 1,
    deviceId: meta.deviceId,
    clientSeq: meta.nextSeq,
  }
  try {
    parseSyncBatch([operation])
  } catch {
    throw new Error('invalid_outbox_operation')
  }
  return { userId, ...operation }
}

function newMeta(userId: string, randomUuid: () => string): MetaRow {
  const deviceId = randomUuid()
  if (!isUuid(deviceId)) throw new Error('secure_uuid_unavailable')
  return { userId, deviceId, nextSeq: 1, acknowledgedThrough: 0 }
}

function boundedBatch(operations: readonly OperationRow[]): OperationRow[] {
  const selected: OperationRow[] = []
  for (const operation of operations) {
    if (selected.length >= MAX_BATCH_OPERATIONS) break
    const candidate = [...selected, operation]
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > MAX_BATCH_BYTES) break
    selected.push(operation)
  }
  return selected
}

function deleteUserOperations(
  transaction: IDBTransaction,
  userId: string,
  predicate: (row: OperationRow) => boolean = () => true,
): Promise<void> {
  const index = transaction.objectStore(OPERATION_STORE).index(USER_INDEX)
  return new Promise((resolve, reject) => {
    const request = index.openCursor(userId)
    request.onerror = () => reject(request.error ?? new Error('indexeddb_cursor_failed'))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      const row = cursor.value as OperationRow
      if (predicate(row)) cursor.delete()
      cursor.continue()
    }
  })
}

class IndexedDbAdapter implements OutboxAdapter {
  constructor(
    private readonly database: IDBDatabase,
    private readonly randomUuid: () => string,
  ) {}

  async load(userId: string): Promise<OutboxLoadResult> {
    validUserId(userId)
    const transaction = this.database.transaction(
      [META_STORE, SNAPSHOT_STORE, OPERATION_STORE],
      'readwrite',
    )
    const completed = transactionResult(transaction)
    const metaStore = transaction.objectStore(META_STORE)
    let meta = await requestResult(metaStore.get(userId)) as MetaRow | undefined
    if (!meta) {
      meta = newMeta(userId, this.randomUuid)
      metaStore.put(meta)
    }
    const snapshot = await requestResult(transaction.objectStore(SNAPSHOT_STORE).get(userId)) as SnapshotRow | undefined
    const operations = await requestResult(
      transaction.objectStore(OPERATION_STORE).index(USER_INDEX).getAll(userId),
    ) as OperationRow[]
    await completed
    return {
      snapshot: snapshot ?? null,
      meta: structuredClone(meta),
      operations: operations.sort((left, right) => left.clientSeq - right.clientSeq),
    }
  }

  async appendDraft(userId: string, draft: PlayerProgressDraftV1): Promise<OperationRow> {
    validUserId(userId)
    const transaction = this.database.transaction([META_STORE, OPERATION_STORE], 'readwrite')
    const completed = transactionResult(transaction)
    try {
      const metaStore = transaction.objectStore(META_STORE)
      const meta = (await requestResult(metaStore.get(userId)) as MetaRow | undefined)
        ?? newMeta(userId, this.randomUuid)
      const operation = operationFromDraft(userId, meta, draft, this.randomUuid)
      transaction.objectStore(OPERATION_STORE).add(operation)
      metaStore.put({ ...meta, nextSeq: meta.nextSeq + 1 })
      await completed
      return structuredClone(operation)
    } catch (error) {
      try { transaction.abort() } catch { /* The transaction may already be inactive. */ }
      await completed.catch(() => undefined)
      throw error
    }
  }

  async nextBatch(userId: string): Promise<OperationRow[]> {
    return boundedBatch((await this.load(userId)).operations)
  }

  async acknowledge(userId: string, throughSeq: number, snapshot: SnapshotRow): Promise<void> {
    validUserId(userId)
    if (!validSequence(throughSeq) || snapshot.userId !== userId || !validSequence(snapshot.revision)) {
      throw new OutboxInvariantError('invalid_acknowledgement')
    }
    const transaction = this.database.transaction(
      [META_STORE, SNAPSHOT_STORE, OPERATION_STORE],
      'readwrite',
    )
    const completed = transactionResult(transaction)
    try {
      const metaStore = transaction.objectStore(META_STORE)
      const meta = (await requestResult(metaStore.get(userId)) as MetaRow | undefined)
        ?? newMeta(userId, this.randomUuid)
      const currentSnapshot = await requestResult(
        transaction.objectStore(SNAPSHOT_STORE).get(userId),
      ) as SnapshotRow | undefined
      if (currentSnapshot && snapshot.revision < currentSnapshot.revision) {
        throw new OutboxInvariantError('snapshot_revision_decreased')
      }
      if (throughSeq < meta.acknowledgedThrough) {
        throw new OutboxInvariantError('acknowledgement_decreased')
      }
      await deleteUserOperations(transaction, userId, (row) => row.clientSeq <= throughSeq)
      transaction.objectStore(SNAPSHOT_STORE).put(structuredClone(snapshot))
      metaStore.put({
        ...meta,
        nextSeq: Math.max(meta.nextSeq, throughSeq + 1),
        acknowledgedThrough: throughSeq,
      })
      await completed
    } catch (error) {
      try { transaction.abort() } catch { /* The transaction may already be inactive. */ }
      await completed.catch(() => undefined)
      throw error
    }
  }

  async repairGap(
    userId: string,
    serverThroughSeq: number,
    snapshot: SnapshotRow,
    recovery: PlayerProgressDraftV1 | null,
  ): Promise<OperationRow | null> {
    validUserId(userId)
    if (!validSequence(serverThroughSeq) || snapshot.userId !== userId || !validSequence(snapshot.revision)) {
      throw new OutboxInvariantError('invalid_gap_repair')
    }
    const transaction = this.database.transaction(
      [META_STORE, SNAPSHOT_STORE, OPERATION_STORE],
      'readwrite',
    )
    const completed = transactionResult(transaction)
    try {
      const metaStore = transaction.objectStore(META_STORE)
      const current = (await requestResult(metaStore.get(userId)) as MetaRow | undefined)
        ?? newMeta(userId, this.randomUuid)
      const currentSnapshot = await requestResult(
        transaction.objectStore(SNAPSHOT_STORE).get(userId),
      ) as SnapshotRow | undefined
      if (currentSnapshot && snapshot.revision < currentSnapshot.revision) {
        throw new OutboxInvariantError('snapshot_revision_decreased')
      }
      await deleteUserOperations(transaction, userId)
      transaction.objectStore(SNAPSHOT_STORE).put(structuredClone(snapshot))
      const repairedMeta: MetaRow = {
        ...current,
        acknowledgedThrough: Math.max(current.acknowledgedThrough, serverThroughSeq),
        nextSeq: Math.max(current.acknowledgedThrough, serverThroughSeq) + 1,
      }
      let operation: OperationRow | null = null
      if (recovery) {
        operation = operationFromDraft(userId, repairedMeta, recovery, this.randomUuid)
        transaction.objectStore(OPERATION_STORE).add(operation)
        repairedMeta.nextSeq += 1
      }
      metaStore.put(repairedMeta)
      await completed
      return operation ? structuredClone(operation) : null
    } catch (error) {
      try { transaction.abort() } catch { /* The transaction may already be inactive. */ }
      await completed.catch(() => undefined)
      throw error
    }
  }

  async clearProfile(userId: string): Promise<void> {
    validUserId(userId)
    const transaction = this.database.transaction(
      [META_STORE, SNAPSHOT_STORE, OPERATION_STORE],
      'readwrite',
    )
    const completed = transactionResult(transaction)
    transaction.objectStore(META_STORE).delete(userId)
    transaction.objectStore(SNAPSHOT_STORE).delete(userId)
    await deleteUserOperations(transaction, userId)
    await completed
  }
}

class MemoryAdapter implements OutboxAdapter {
  private readonly values = new Map<string, OutboxLoadResult>()

  constructor(private readonly randomUuid: () => string) {}

  seed(userId: string, value: OutboxLoadResult): void {
    this.values.set(userId, structuredClone(value))
  }

  async load(userId: string): Promise<OutboxLoadResult> {
    validUserId(userId)
    let value = this.values.get(userId)
    if (!value) {
      value = { snapshot: null, meta: newMeta(userId, this.randomUuid), operations: [] }
      this.values.set(userId, value)
    }
    return structuredClone(value)
  }

  async appendDraft(userId: string, draft: PlayerProgressDraftV1): Promise<OperationRow> {
    const value = await this.load(userId)
    const operation = operationFromDraft(userId, value.meta, draft, this.randomUuid)
    value.operations.push(operation)
    value.meta.nextSeq += 1
    this.values.set(userId, value)
    return structuredClone(operation)
  }

  async nextBatch(userId: string): Promise<OperationRow[]> {
    return boundedBatch((await this.load(userId)).operations)
  }

  async acknowledge(userId: string, throughSeq: number, snapshot: SnapshotRow): Promise<void> {
    const value = await this.load(userId)
    if (snapshot.userId !== userId || snapshot.revision < (value.snapshot?.revision ?? 0)) {
      throw new OutboxInvariantError('snapshot_revision_decreased')
    }
    if (throughSeq < value.meta.acknowledgedThrough) {
      throw new OutboxInvariantError('acknowledgement_decreased')
    }
    value.operations = value.operations.filter((row) => row.clientSeq > throughSeq)
    value.snapshot = structuredClone(snapshot)
    value.meta.acknowledgedThrough = throughSeq
    value.meta.nextSeq = Math.max(value.meta.nextSeq, throughSeq + 1)
    this.values.set(userId, value)
  }

  async repairGap(
    userId: string,
    serverThroughSeq: number,
    snapshot: SnapshotRow,
    recovery: PlayerProgressDraftV1 | null,
  ): Promise<OperationRow | null> {
    const value = await this.load(userId)
    if (snapshot.userId !== userId || snapshot.revision < (value.snapshot?.revision ?? 0)) {
      throw new OutboxInvariantError('snapshot_revision_decreased')
    }
    value.operations = []
    value.snapshot = structuredClone(snapshot)
    value.meta.acknowledgedThrough = Math.max(value.meta.acknowledgedThrough, serverThroughSeq)
    value.meta.nextSeq = value.meta.acknowledgedThrough + 1
    let operation: OperationRow | null = null
    if (recovery) {
      operation = operationFromDraft(userId, value.meta, recovery, this.randomUuid)
      value.operations.push(operation)
      value.meta.nextSeq += 1
    }
    this.values.set(userId, value)
    return operation ? structuredClone(operation) : null
  }

  async clearProfile(userId: string): Promise<void> {
    validUserId(userId)
    this.values.delete(userId)
  }
}

export class PlayerOutbox implements OutboxAdapter {
  private adapter: OutboxAdapter
  private readonly cache = new Map<string, OutboxLoadResult>()
  private appendChain: Promise<unknown> = Promise.resolve()
  private fallbackNotified = false
  private _mode: 'persistent' | 'memory'

  private constructor(
    adapter: OutboxAdapter,
    mode: 'persistent' | 'memory',
    private readonly randomUuid: () => string,
    private readonly onMemoryFallback?: () => void,
  ) {
    this.adapter = adapter
    this._mode = mode
  }

  get mode(): 'persistent' | 'memory' {
    return this._mode
  }

  static async open(options: PlayerOutboxOptions = {}): Promise<{
    mode: 'persistent' | 'memory'
    outbox: PlayerOutbox
  }> {
    const randomUuid = options.randomUuid ?? defaultRandomUuid
    const factory = options.indexedDB ?? globalThis.indexedDB
    if (factory) {
      try {
        const adapter = new IndexedDbAdapter(await openDatabase(factory), randomUuid)
        return {
          mode: 'persistent',
          outbox: new PlayerOutbox(adapter, 'persistent', randomUuid, options.onMemoryFallback),
        }
      } catch {
        // The explicit memory mode below keeps the game available without claiming durability.
      }
    }
    const outbox = new PlayerOutbox(
      new MemoryAdapter(randomUuid),
      'memory',
      randomUuid,
      options.onMemoryFallback,
    )
    outbox.notifyFallback()
    return { mode: 'memory', outbox }
  }

  async load(userId: string): Promise<OutboxLoadResult> {
    return this.withFallback(userId, async () => {
      const value = await this.adapter.load(userId)
      this.cache.set(userId, structuredClone(value))
      return value
    })
  }

  appendDraft(userId: string, draft: PlayerProgressDraftV1): Promise<OperationRow> {
    const task = this.appendChain.then(() => this.withFallback(userId, async () => {
      const row = await this.adapter.appendDraft(userId, draft)
      const value = await this.adapter.load(userId)
      this.cache.set(userId, structuredClone(value))
      return row
    }))
    this.appendChain = task.then(() => undefined, () => undefined)
    return task
  }

  async nextBatch(userId: string): Promise<OperationRow[]> {
    return this.withFallback(userId, () => this.adapter.nextBatch(userId))
  }

  async acknowledge(userId: string, throughSeq: number, snapshot: SnapshotRow): Promise<void> {
    return this.withFallback(userId, async () => {
      await this.adapter.acknowledge(userId, throughSeq, snapshot)
      this.cache.set(userId, await this.adapter.load(userId))
    })
  }

  async repairGap(
    userId: string,
    serverThroughSeq: number,
    snapshot: SnapshotRow,
    recovery: PlayerProgressDraftV1 | null,
  ): Promise<OperationRow | null> {
    return this.withFallback(userId, async () => {
      const operation = await this.adapter.repairGap(userId, serverThroughSeq, snapshot, recovery)
      this.cache.set(userId, await this.adapter.load(userId))
      return operation
    })
  }

  async clearProfile(userId: string): Promise<void> {
    return this.withFallback(userId, async () => {
      await this.adapter.clearProfile(userId)
      this.cache.delete(userId)
    })
  }

  private async withFallback<T>(userId: string, action: () => Promise<T>): Promise<T> {
    try {
      return await action()
    } catch (error) {
      if (error instanceof OutboxInvariantError || this._mode === 'memory') throw error
      const memory = new MemoryAdapter(this.randomUuid)
      const cached = this.cache.get(userId)
      if (cached) memory.seed(userId, cached)
      this.adapter = memory
      this._mode = 'memory'
      this.notifyFallback()
      return action()
    }
  }

  private notifyFallback(): void {
    if (this.fallbackNotified) return
    this.fallbackNotified = true
    try {
      this.onMemoryFallback?.()
    } catch {
      // A notice callback cannot break the in-memory storage fallback.
    }
  }
}
