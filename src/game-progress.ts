import { CHARACTER_SKINS } from './art/assets'
import {
  ACHIEVEMENTS,
  assignDailyQuest,
  createQuestDefinition,
  dailyNoticeTransitions,
  unlockAchievements,
  type QuestCatalogSnapshot,
} from './progress/catalog'
import type { EventSource, GameEvent, ProgressTargetId } from './progress/events'
import { reduceProgress } from './progress/reducer'
import type {
  CheckpointReason,
  ProgressLoadResult,
  ProgressSaveResult,
  StorageAdapter,
} from './progress/store'
import type { ProgressStateV1 } from './progress/types'
import type { NotificationInput } from './ui/notification-queue'
import { CHARACTER_MOVE_IDS } from './weapons/character-catalog'
import { CHARACTER_IDS } from './weapons/character-ids'
import { ELEMENTAL_CHARGE } from './weapons/charge-profiles'
import type {
  ActionDamageResolution,
  ActionResolution,
} from './combat/action-controller'

const RECENT_EVENT_LIMIT = 128

export const KNOWN_WEAPON_IDS = [
  ...Object.keys(ELEMENTAL_CHARGE),
  ...CHARACTER_IDS,
] as const

export const KNOWN_MOVE_IDS = [
  'quick',
  'drag',
  'charged',
  ...Object.values(CHARACTER_MOVE_IDS).flat(),
] as const

export interface ProgressPersistence {
  load(): ProgressLoadResult
  save(state: ProgressStateV1, reason: CheckpointReason): ProgressSaveResult
}

export interface ProgressAnalyticsSink {
  track(event: GameEvent): void | Promise<void>
}

export interface GameProgressCoordinatorOptions {
  store: ProgressPersistence
  catalog: QuestCatalogSnapshot
  dayKey: string
  nowIso: () => string
  notify: (notice: NotificationInput) => unknown
  analytics?: ProgressAnalyticsSink
  knownWeaponIds?: readonly string[]
  knownMoveIds?: readonly string[]
}

export interface ProgressDispatchResult {
  accepted: number
  state: ProgressStateV1
}

function isSettlementEvent(event: GameEvent): event is Extract<GameEvent, {
  actionId: number
  targetRunId: number
}> {
  return [
    'ATTACK_RESOLVED',
    'CHARGE_RELEASED',
    'TARGET_DESTROYED',
    'WEAPON_USED',
  ].includes(event.type)
}

function eventKey(event: GameEvent): string | null {
  return isSettlementEvent(event)
    ? `${event.actionId}:${event.targetRunId}:${event.type}`
    : null
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isValidCount(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** Owns the single progress reduction, notification, analytics and checkpoint path. */
export class GameProgressCoordinator {
  private readonly store: ProgressPersistence
  private catalog: QuestCatalogSnapshot
  private readonly nowIso: () => string
  private readonly notify: (notice: NotificationInput) => unknown
  private readonly analytics?: ProgressAnalyticsSink
  private readonly knownWeaponIds: ReadonlySet<string>
  private readonly knownMoveIds: ReadonlySet<string>
  private readonly recentEventKeys: string[] = []
  private readonly recentEventSet = new Set<string>()
  state: ProgressStateV1

  constructor(options: GameProgressCoordinatorOptions) {
    this.store = options.store
    this.catalog = options.catalog
    this.nowIso = options.nowIso
    this.notify = options.notify
    this.analytics = options.analytics
    this.knownWeaponIds = new Set(options.knownWeaponIds ?? KNOWN_WEAPON_IDS)
    this.knownMoveIds = new Set(options.knownMoveIds ?? KNOWN_MOVE_IDS)
    this.state = assignDailyQuest(
      this.store.load().state,
      options.dayKey,
      options.catalog
    )
  }

  get questCatalog(): QuestCatalogSnapshot {
    return this.catalog
  }

  /** Swaps validated remote data while retaining the already assigned same-day quest. */
  setCatalog(catalog: QuestCatalogSnapshot): boolean {
    if (!Number.isSafeInteger(catalog.version) || catalog.version <= 0 || catalog.quests.length === 0) {
      return false
    }
    const ids = new Set<string>()
    const normalized = []
    try {
      for (const quest of catalog.quests) {
        if (ids.has(quest.id)) return false
        ids.add(quest.id)
        const definition = createQuestDefinition({
          id: quest.id,
          copy: quest.copy,
          event: quest.event,
          target: quest.target,
        })
        if (definition.distinct !== quest.distinct) return false
        normalized.push(definition)
      }
    } catch {
      return false
    }
    const assigned = this.catalog.quests.find((quest) => quest.id === this.state.daily.questId)
    const includesAssigned = normalized.some((quest) => quest.id === this.state.daily.questId)
    this.catalog = assigned && !includesAssigned
      ? { version: catalog.version, quests: [...normalized, assigned] }
      : { version: catalog.version, quests: normalized }
    this.state = { ...this.state, catalogVersion: catalog.version }
    return true
  }

  dispatch(
    events: readonly GameEvent[],
    reason?: CheckpointReason
  ): ProgressDispatchResult {
    let accepted = 0
    const notices: NotificationInput[] = []

    for (const event of events) {
      if (!this.accepts(event)) continue
      const key = eventKey(event)
      if (key !== null && this.recentEventSet.has(key)) continue

      const previous = this.state
      let next = reduceProgress(previous, event, this.catalog)
      const unlocked = unlockAchievements(next, this.nowIso())
      next = unlocked.state
      this.state = next
      accepted += 1
      if (key !== null) this.remember(key)

      for (const id of unlocked.unlockedIds) {
        const achievement = ACHIEVEMENTS.find((item) => item.id === id)
        if (!achievement) continue
        notices.push({
          key: `achievement:${id}`,
          kind: 'achievement',
          text: `새 도장: ${achievement.name}`,
        })
      }
      for (const transition of dailyNoticeTransitions(previous.daily, next.daily)) {
        notices.push(this.dailyNotice(transition))
      }
      this.track(event)
    }

    notices
      .sort((left, right) => this.noticeRank(right.kind) - this.noticeRank(left.kind))
      .forEach((notice) => {
        try {
          this.notify(notice)
        } catch {
          // Feedback rendering is optional; progress remains authoritative.
        }
      })

    if (accepted > 0 && reason) this.store.save(this.state, reason)
    return { accepted, state: this.state }
  }

  selectTitle(title: string | null): boolean {
    if (title !== null) {
      const achievement = ACHIEVEMENTS.find((item) => item.name === title)
      if (!achievement || !this.state.achievements[achievement.id]) return false
    }
    if (this.state.profile.selectedTitle === title) return false
    this.state = {
      ...this.state,
      profile: { ...this.state.profile, selectedTitle: title },
    }
    this.store.save(this.state, 'setting')
    return true
  }

  selectSkin(characterId: string, skinId: string): boolean {
    if (!Object.prototype.hasOwnProperty.call(CHARACTER_SKINS, characterId)) return false
    const choices = CHARACTER_SKINS[characterId as keyof typeof CHARACTER_SKINS]
    if (!choices.some((choice) => choice.id === skinId)) return false
    if (this.state.profile.skins[characterId] === skinId) return false
    this.state = {
      ...this.state,
      profile: {
        ...this.state.profile,
        skins: { ...this.state.profile.skins, [characterId]: skinId },
      },
    }
    this.store.save(this.state, 'setting')
    return true
  }

  markAchievementsSeen(): boolean {
    const unseen = Object.entries(this.state.achievements)
      .filter(([, achievement]) => !achievement.seen)
    if (unseen.length === 0) return false
    this.state = {
      ...this.state,
      achievements: Object.fromEntries(
        Object.entries(this.state.achievements).map(([id, achievement]) => [
          id,
          { ...achievement, seen: true },
        ])
      ),
    }
    this.store.save(this.state, 'unlock')
    return true
  }

  checkpoint(reason: CheckpointReason): void {
    this.store.save(this.state, reason)
  }

  private accepts(event: GameEvent): boolean {
    if (event.type !== 'SETTING_CHANGED' && event.source !== 'user') return false

    if (isSettlementEvent(event)) {
      if (!isPositiveSafeInteger(event.actionId) || !isPositiveSafeInteger(event.targetRunId)) {
        return false
      }
      if (!this.knownWeaponIds.has(event.weaponId)) return false
    }

    switch (event.type) {
      case 'ATTACK_RESOLVED':
        return this.knownMoveIds.has(event.moveId)
          && Number.isFinite(event.detached)
          && event.detached > 0
      case 'CHARGE_RELEASED':
        return Number.isFinite(event.charge) && event.charge >= 0 && event.charge <= 1
      case 'TARGET_DESTROYED':
        return ['word', 'earth', 'city'].includes(event.targetId)
      case 'COMBO_CHANGED':
        return isValidCount(event.value)
      case 'FEVER_STARTED':
        return isValidCount(event.combo)
      default:
        return true
    }
  }

  private remember(key: string): void {
    this.recentEventKeys.push(key)
    this.recentEventSet.add(key)
    if (this.recentEventKeys.length <= RECENT_EVENT_LIMIT) return
    const expired = this.recentEventKeys.shift()
    if (expired) this.recentEventSet.delete(expired)
  }

  private track(event: GameEvent): void {
    if (!this.analytics) return
    try {
      const pending = this.analytics.track(event)
      if (pending && typeof pending.then === 'function') void pending.catch(() => undefined)
    } catch {
      // Analytics is isolated from gameplay and persistence.
    }
  }

  private dailyNotice(transition: 'first' | 'half' | 'complete'): NotificationInput {
    const quest = this.catalog.quests.find((item) => item.id === this.state.daily.questId)
    const suffix = transition === 'complete'
      ? '도장 하나를 받았어요!'
      : transition === 'half'
        ? '절반을 채웠어요!'
        : '첫걸음을 채웠어요!'
    return {
      key: `daily:${this.state.daily.dayKey}:${this.state.daily.questId}:${transition}`,
      kind: 'quest',
      text: `${quest?.copy ?? '오늘의 도전'}: ${suffix}`,
    }
  }

  private noticeRank(kind: NotificationInput['kind']): number {
    return kind === 'record' ? 4 : kind === 'achievement' ? 3 : kind === 'quest' ? 2 : 1
  }
}

/** Defers the browser storage getter until ProgressStore's guarded method call. */
export function createLazyStorageAdapter(
  getStorage: () => StorageAdapter = () => window.localStorage
): StorageAdapter {
  return {
    getItem: (key) => getStorage().getItem(key),
    setItem: (key, value) => getStorage().setItem(key, value),
    removeItem: (key) => getStorage().removeItem(key),
  }
}

export interface ActionIdentity {
  actionId: number
  targetRunId: number
}

interface ActionBatch {
  impact: GameEvent[]
  settled: boolean
  destroyed: boolean
  impactScheduled: boolean
}

export interface ActionCheckpointBatcherOptions {
  dispatch: (events: readonly GameEvent[], reason: CheckpointReason) => unknown
  schedule?: (run: () => void) => void
}

/** Coalesces point impacts while preserving delayed character impact checkpoints. */
export class ActionCheckpointBatcher {
  private readonly batches = new Map<string, ActionBatch>()
  private readonly order: string[] = []
  private readonly dispatch: ActionCheckpointBatcherOptions['dispatch']
  private readonly schedule: (run: () => void) => void

  constructor(options: ActionCheckpointBatcherOptions) {
    this.dispatch = options.dispatch
    this.schedule = options.schedule ?? ((run) => queueMicrotask(run))
  }

  recordImpact(identity: ActionIdentity, events: readonly GameEvent[]): void {
    const batch = this.batch(identity)
    if (batch.settled) {
      batch.impact.push(...events)
      this.scheduleImpact(identity, batch)
      return
    }
    batch.impact.push(...events)
  }

  recordDestroy(identity: ActionIdentity, event: GameEvent): void {
    const batch = this.batch(identity)
    if (batch.destroyed) return
    batch.destroyed = true
    batch.impact.push(event)
    if (batch.settled) this.scheduleImpact(identity, batch)
  }

  recordSettlement(identity: ActionIdentity, events: readonly GameEvent[]): void {
    const batch = this.batch(identity)
    if (batch.settled) return
    batch.settled = true
    if (batch.impact.length > 0) {
      this.dispatch([...batch.impact, ...events], batch.destroyed ? 'targetDestroy' : 'actionEnd')
      batch.impact.length = 0
      return
    }
    this.dispatch([...events], 'actionEnd')
  }

  private batch(identity: ActionIdentity): ActionBatch {
    const key = `${identity.actionId}:${identity.targetRunId}`
    const existing = this.batches.get(key)
    if (existing) return existing
    const created = { impact: [], settled: false, destroyed: false, impactScheduled: false }
    this.batches.set(key, created)
    this.order.push(key)
    if (this.order.length > RECENT_EVENT_LIMIT) {
      const expired = this.order.shift()
      if (expired) this.batches.delete(expired)
    }
    return created
  }

  private scheduleImpact(identity: ActionIdentity, batch: ActionBatch): void {
    if (batch.impactScheduled) return
    batch.impactScheduled = true
    const flush = () => {
      batch.impactScheduled = false
      if (batch.impact.length === 0) return
      const events = [...batch.impact]
      batch.impact.length = 0
      this.dispatch(events, batch.destroyed ? 'targetDestroy' : 'actionEnd')
      void identity
    }
    try {
      this.schedule(flush)
    } catch {
      flush()
    }
  }
}

export interface GameplayProgressBridgeOptions {
  dispatch: (events: readonly GameEvent[], reason: CheckpointReason) => unknown
  getSource: () => EventSource
  onDamageFeedback: (resolution: ActionDamageResolution, source: EventSource) => number
  onUserDestroyed: (targetRunId: number, golden: boolean) => number | null | void
  schedule?: (run: () => void) => void
}

/** Converts checked controller callbacks into the canonical progress event stream. */
export class GameplayProgressBridge {
  private readonly batcher: ActionCheckpointBatcher

  constructor(private readonly options: GameplayProgressBridgeOptions) {
    this.batcher = new ActionCheckpointBatcher({
      dispatch: options.dispatch,
      schedule: options.schedule,
    })
  }

  onDamage(resolution: ActionDamageResolution): void {
    const source = this.options.getSource()
    const combo = this.options.onDamageFeedback(resolution, source)
    this.batcher.recordImpact(resolution, [
      {
        type: 'ATTACK_RESOLVED',
        source,
        actionId: resolution.actionId,
        targetRunId: resolution.targetRunId,
        weaponId: resolution.weaponId,
        moveId: resolution.moveId,
        detached: resolution.damage.detached,
      },
      { type: 'COMBO_CHANGED', source, value: combo },
    ])
  }

  onDestroyed(
    resolution: ActionDamageResolution,
    targetId: ProgressTargetId,
    golden: boolean
  ): void {
    const source = this.options.getSource()
    const bonusCombo = source === 'user'
      ? this.options.onUserDestroyed(resolution.targetRunId, golden)
      : null
    this.batcher.recordDestroy(resolution, {
      type: 'TARGET_DESTROYED',
      source,
      actionId: resolution.actionId,
      targetRunId: resolution.targetRunId,
      weaponId: resolution.weaponId,
      targetId,
      golden,
    })
    if (golden && typeof bonusCombo === 'number' && Number.isFinite(bonusCombo)) {
      this.batcher.recordImpact(resolution, [
        { type: 'COMBO_CHANGED', source, value: bonusCombo },
      ])
    }
  }

  onSettled(resolution: ActionResolution): void {
    const source = this.options.getSource()
    const events: GameEvent[] = [{
      type: 'WEAPON_USED',
      source,
      actionId: resolution.actionId,
      targetRunId: resolution.targetRunId,
      weaponId: resolution.weaponId,
    }]
    if (resolution.kind === 'charged') {
      events.push({
        type: 'CHARGE_RELEASED',
        source,
        actionId: resolution.actionId,
        targetRunId: resolution.targetRunId,
        weaponId: resolution.weaponId,
        charge: resolution.charge,
      })
    }
    this.batcher.recordSettlement(resolution, events)
  }
}

/** Bounded checked-destroy attribution for the one current target run. */
export class TargetDestroyAttribution {
  private pending: number | null = null

  get pendingRunId(): number | null {
    return this.pending
  }

  record(targetRunId: number): void {
    this.pending = targetRunId
  }

  consume(targetRunId: number): boolean {
    if (this.pending !== targetRunId) return false
    this.pending = null
    return true
  }

  clear(): void {
    this.pending = null
  }
}

export function progressTargetId(targetName: string): ProgressTargetId {
  if (targetName === '지구') return 'earth'
  if (targetName === '도시') return 'city'
  return 'word'
}

export function createMemoryFallbackHandler(
  notify: (notice: NotificationInput) => unknown
): () => void {
  let shown = false
  return () => {
    if (shown) return
    shown = true
    try {
      notify({
        key: 'progress:memory-mode',
        kind: 'general',
        text: '이 탭을 열어 둔 동안 기록이 계속 이어져요.',
      })
    } catch {
      // The in-memory fallback must stay playable even without a notice renderer.
    }
  }
}
