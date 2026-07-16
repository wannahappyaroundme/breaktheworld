import { isUuid } from '../../supabase/functions/_shared/player-contract'
import { createDefaultProgress } from './defaults'
import type { ProgressStateV1 } from './types'
import { parseProgress } from './validate'

export const PROGRESS_STORAGE_KEY = 'btw.progress.v1'
const LEGACY_BEST_COMBO_KEY = 'btw.bestCombo'
const LEGACY_TOTAL_TARGETS_KEY = 'btw.totalTargets'

export type CheckpointReason =
  | 'actionEnd'
  | 'targetDestroy'
  | 'dailyRollover'
  | 'unlock'
  | 'setting'
  | 'pagehide'
export type ProgressStorageMode = 'persistent' | 'memory'

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ProgressStoreOptions {
  storageKey?: string
  migrateLegacy?: boolean
  knownWeaponIds?: readonly string[]
  knownMoveIds?: readonly string[]
  createInstallSeed?: () => string
  onMemoryFallback?: () => void
}

export type ProgressScopeKey =
  | { kind: 'guest' }
  | { kind: 'player'; userId: string }

export function progressStorageKey(scope: ProgressScopeKey): string {
  if (scope.kind === 'guest') return PROGRESS_STORAGE_KEY
  if (!isUuid(scope.userId)) throw new Error('invalid player user id')
  return `btw.player.${scope.userId}.progress.v1`
}

export interface ProgressLoadResult {
  state: ProgressStateV1
  mode: ProgressStorageMode
}

export type ProgressSaveResult = { ok: true } | { ok: false; mode: 'memory' }

function defaultInstallSeed(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `local-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

function legacyCounter(value: string | null): number | null {
  if (value === null || !/^[1-9]\d*$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export class ProgressStore {
  private readonly knownWeaponIds: readonly string[]
  private readonly knownMoveIds: readonly string[]
  private readonly createInstallSeed: () => string
  private readonly onMemoryFallback?: () => void
  private readonly storageKey: string
  private readonly migrateLegacy: boolean
  private mode: ProgressStorageMode = 'persistent'
  private memoryState: ProgressStateV1 | null = null
  private fallbackNotified = false

  constructor(
    private readonly storage: StorageAdapter,
    options: ProgressStoreOptions = {}
  ) {
    this.knownWeaponIds = options.knownWeaponIds ?? []
    this.knownMoveIds = options.knownMoveIds ?? []
    this.createInstallSeed = options.createInstallSeed ?? defaultInstallSeed
    this.onMemoryFallback = options.onMemoryFallback
    this.storageKey = options.storageKey ?? PROGRESS_STORAGE_KEY
    this.migrateLegacy = options.migrateLegacy ?? (options.storageKey === undefined)
  }

  load(): ProgressLoadResult {
    if (this.mode === 'memory') {
      const state = this.memoryState ?? this.newState()
      this.memoryState = state
      return { state, mode: 'memory' }
    }

    let stored: string | null
    try {
      stored = this.storage.getItem(this.storageKey)
    } catch {
      return this.enterMemory(this.newState())
    }

    if (stored !== null) return this.loadCurrent(stored)
    return this.loadNewOrLegacy()
  }

  save(state: ProgressStateV1, reason: CheckpointReason): ProgressSaveResult {
    void reason
    if (this.mode === 'memory') {
      this.memoryState = state
      return { ok: false, mode: 'memory' }
    }

    try {
      this.storage.setItem(this.storageKey, JSON.stringify(state))
      return { ok: true }
    } catch {
      this.enterMemory(state)
      return { ok: false, mode: 'memory' }
    }
  }

  private loadCurrent(stored: string): ProgressLoadResult {
    let raw: unknown
    try {
      raw = JSON.parse(stored) as unknown
    } catch {
      return this.persistInitial(this.newState(), [])
    }

    const state = parseProgress(raw, this.knownWeaponIds, this.knownMoveIds)
    if (state.installSeed === '') {
      state.installSeed = this.createInstallSeed()
      return this.persistInitial(state, [])
    }
    return { state, mode: 'persistent' }
  }

  private loadNewOrLegacy(): ProgressLoadResult {
    if (!this.migrateLegacy) return this.persistInitial(this.newState(), [])

    let bestRaw: string | null
    let totalRaw: string | null
    try {
      bestRaw = this.storage.getItem(LEGACY_BEST_COMBO_KEY)
      totalRaw = this.storage.getItem(LEGACY_TOTAL_TARGETS_KEY)
    } catch {
      return this.enterMemory(this.newState())
    }

    const state = this.newState()
    const bestCombo = legacyCounter(bestRaw)
    const totalTargets = legacyCounter(totalRaw)
    const migratedKeys: string[] = []
    if (bestCombo !== null) {
      state.lifetime.bestCombo = bestCombo
      migratedKeys.push(LEGACY_BEST_COMBO_KEY)
    }
    if (totalTargets !== null) {
      state.lifetime.totalTargets = totalTargets
      migratedKeys.push(LEGACY_TOTAL_TARGETS_KEY)
    }
    return this.persistInitial(state, migratedKeys)
  }

  private persistInitial(state: ProgressStateV1, migratedKeys: readonly string[]): ProgressLoadResult {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(state))
    } catch {
      return this.enterMemory(state)
    }

    for (const key of migratedKeys) {
      try {
        this.storage.removeItem(key)
      } catch {
        // The new state is durable; an ignored legacy key is harmless and will not be read again.
      }
    }
    return { state, mode: 'persistent' }
  }

  private newState(): ProgressStateV1 {
    return createDefaultProgress(this.createInstallSeed())
  }

  private enterMemory(state: ProgressStateV1): ProgressLoadResult {
    this.mode = 'memory'
    this.memoryState = state
    if (!this.fallbackNotified) {
      this.fallbackNotified = true
      try {
        this.onMemoryFallback?.()
      } catch {
        // A notice renderer must never interrupt the in-memory gameplay fallback.
      }
    }
    return { state, mode: 'memory' }
  }
}
