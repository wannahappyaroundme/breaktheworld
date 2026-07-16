import type { QuestCatalogSnapshot } from '../progress/catalog'
import type { GameEvent } from '../progress/events'

export const BUILT_IN_FLAGS = {
  gamification_enabled: true,
  character_variants_enabled: true,
  analytics_enabled: false,
  player_profiles_ui: false,
  player_signup: false,
  player_sync_writes: false,
} as const

export type FeatureFlags = {
  -readonly [Key in keyof typeof BUILT_IN_FLAGS]: boolean
}

export type AnalyticsDisabledHook = () => void | Promise<void>

function runAnalyticsDisabledHook(hook: AnalyticsDisabledHook | undefined): void {
  if (!hook) return
  try {
    const pending = hook()
    if (pending && typeof pending.then === 'function') void pending.catch(() => undefined)
  } catch {
    // Analytics is optional and cannot interrupt configuration or gameplay.
  }
}

export class AnalyticsDisabledBoundary {
  private hook: AnalyticsDisabledHook | undefined
  private analyticsEnabled: boolean

  constructor(analyticsEnabled: boolean) {
    this.analyticsEnabled = analyticsEnabled
  }

  setHook(hook: AnalyticsDisabledHook): void {
    this.hook = hook
    if (!this.analyticsEnabled) runAnalyticsDisabledHook(hook)
  }

  setEnabled(enabled: boolean): void {
    this.analyticsEnabled = enabled
    if (!enabled) runAnalyticsDisabledHook(this.hook)
  }
}

export interface FeatureFlagHooks {
  onAnalyticsDisabled?: AnalyticsDisabledHook
}

export class DeferredFeatureFlags {
  active: FeatureFlags
  private pending: FeatureFlags | null = null

  constructor(initial: FeatureFlags) {
    this.active = { ...initial }
  }

  get hasPending(): boolean {
    return this.pending !== null
  }

  stage(next: FeatureFlags): void {
    this.pending = { ...next }
  }

  settle(hooks: FeatureFlagHooks = {}): FeatureFlags {
    const pending = this.pending
    if (!pending) return this.active
    this.pending = null
    this.active = pending
    if (!pending.analytics_enabled) runAnalyticsDisabledHook(hooks.onAnalyticsDisabled)
    return this.active
  }
}

export interface RemoteConfigActivation {
  catalog: QuestCatalogSnapshot
  flags: FeatureFlags
}

export interface RemoteConfigApplyHooks {
  applyCatalog: (catalog: QuestCatalogSnapshot) => void
  onFlagsApplied: (flags: FeatureFlags) => void
}

/** DOM-free action boundary shared by remote boot, settings, and delayed impacts. */
export class RemoteConfigOrchestrator {
  private readonly flags = new DeferredFeatureFlags(BUILT_IN_FLAGS)
  private readonly analytics = new AnalyticsDisabledBoundary(false)
  private pendingCatalog: QuestCatalogSnapshot | null = null
  private readonly actionGamification = new Map<string, boolean>()
  private readonly actionOrder: string[] = []

  get active(): FeatureFlags {
    return this.flags.active
  }

  setAnalyticsDisabledHook(hook: AnalyticsDisabledHook): void {
    this.analytics.setHook(hook)
  }

  stage(config: RemoteConfigActivation): void {
    this.pendingCatalog = config.catalog
    this.flags.stage(config.flags)
  }

  rememberAction(actionId: number, targetRunId: number): void {
    const key = `${actionId}:${targetRunId}`
    if (!this.actionGamification.has(key)) this.actionOrder.push(key)
    this.actionGamification.set(key, this.flags.active.gamification_enabled)
    while (this.actionOrder.length > 128) {
      const expired = this.actionOrder.shift()
      if (expired) this.actionGamification.delete(expired)
    }
  }

  gamificationFor(events: readonly GameEvent[]): boolean {
    for (const event of events) {
      if ('actionId' in event && 'targetRunId' in event) {
        return this.actionGamification.get(`${event.actionId}:${event.targetRunId}`)
          ?? this.flags.active.gamification_enabled
      }
    }
    return this.flags.active.gamification_enabled
  }

  applyIfSettled(hasUnsettledAction: boolean, hooks: RemoteConfigApplyHooks): boolean {
    if (hasUnsettledAction || (!this.pendingCatalog && !this.flags.hasPending)) return false
    const catalog = this.pendingCatalog
    this.pendingCatalog = null
    if (catalog) {
      try {
        hooks.applyCatalog(catalog)
      } catch {
        // A bad optional runtime adapter cannot interrupt the current game.
      }
    }
    const next = this.flags.hasPending ? this.flags.settle() : this.flags.active
    this.analytics.setEnabled(next.analytics_enabled)
    try {
      hooks.onFlagsApplied(next)
    } catch {
      // Visual refresh is optional; the validated flag state remains authoritative.
    }
    return true
  }
}
