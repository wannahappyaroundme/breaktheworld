import { isUuid } from '../../supabase/functions/_shared/player-contract'
import {
  applyPendingPlayerOperation,
  diffPlayerProgress,
  type SyncProgressState,
} from '../../supabase/functions/_shared/player-sync-contract'
import { createDefaultProgress } from '../progress/defaults'
import type {
  CheckpointReason,
  ProgressLoadResult,
  ProgressSaveResult,
} from '../progress/store'
import type { ProgressStateV1 } from '../progress/types'
import type { OperationRow, OutboxAdapter } from './outbox'

export interface LocalProgressPersistence {
  load(): ProgressLoadResult
  save(state: ProgressStateV1, reason: CheckpointReason): ProgressSaveResult
}

export interface PlayerSyncStoreOptions {
  nowIso?: () => string
  onOperationReady?: (operation: OperationRow) => void
  onMemoryFallback?: () => void
}

export interface PlayerSyncRecovery {
  serverState: SyncProgressState | null
  visibleState: SyncProgressState
  revision: number
  pending: number
}

export class PlayerSyncStore implements LocalProgressPersistence {
  private lastState: ProgressStateV1
  private appendChain: Promise<void> = Promise.resolve()
  private readonly nowIso: () => string

  constructor(
    private readonly userId: string,
    private readonly local: LocalProgressPersistence,
    private readonly outbox: OutboxAdapter,
    private readonly options: PlayerSyncStoreOptions = {},
  ) {
    if (!isUuid(userId)) throw new Error('invalid_player_user_id')
    this.lastState = structuredClone(local.load().state)
    this.nowIso = options.nowIso ?? (() => new Date().toISOString())
  }

  load(): ProgressLoadResult {
    return this.local.load()
  }

  save(state: ProgressStateV1, reason: CheckpointReason): ProgressSaveResult {
    const previous = this.lastState
    const draft = diffPlayerProgress(previous, state, { nowIso: this.nowIso() })
    const saved = this.local.save(state, reason)
    this.lastState = structuredClone(state)
    if (draft) this.enqueue(draft)
    return saved
  }

  async recover(): Promise<PlayerSyncRecovery> {
    await this.whenIdle()
    let loaded = await this.outbox.load(this.userId)
    const localState = this.local.load().state
    const serverState = loaded.snapshot?.state ?? null
    const baseline = serverState
      ? structuredClone(serverState)
      : createDefaultProgress(localState.installSeed)
    let replayed = loaded.operations
      .slice()
      .sort((left, right) => left.clientSeq - right.clientSeq)
      .reduce<SyncProgressState>(
        (state, operation) => applyPendingPlayerOperation(state, operation),
        baseline,
      )

    try {
      const recovery = diffPlayerProgress(replayed, localState, {
        nowIso: this.nowIso(),
        serverMayNotHaveDaily: true,
      })
      if (recovery) {
        const operation = await this.outbox.appendDraft(this.userId, recovery)
        this.options.onOperationReady?.(operation)
        loaded = await this.outbox.load(this.userId)
        replayed = applyPendingPlayerOperation(replayed, operation)
      } else {
        replayed = structuredClone(localState)
      }
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'progress_decreased') throw error
      this.local.save(replayed, 'scopeChange')
    }

    this.lastState = structuredClone(replayed)
    return {
      serverState: serverState ? structuredClone(serverState) : null,
      visibleState: structuredClone(replayed),
      revision: loaded.snapshot?.revision ?? 0,
      pending: loaded.operations.length,
    }
  }

  async whenIdle(): Promise<void> {
    await this.appendChain
  }

  replaceFromSync(state: ProgressStateV1): void {
    this.local.save(state, 'scopeChange')
    this.lastState = structuredClone(state)
  }

  private enqueue(draft: Parameters<OutboxAdapter['appendDraft']>[1]): void {
    this.appendChain = this.appendChain
      .then(async () => {
        const operation = await this.outbox.appendDraft(this.userId, draft)
        this.options.onOperationReady?.(operation)
      })
      .catch(() => {
        try {
          this.options.onMemoryFallback?.()
        } catch {
          // A storage notice cannot interrupt synchronous local progress.
        }
      })
  }
}
