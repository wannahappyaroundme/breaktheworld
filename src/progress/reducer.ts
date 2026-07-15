import { BUILT_IN_CATALOG, type QuestCatalogSnapshot } from './catalog'
import { isCharacterWeaponId, type GameEvent } from './events'
import type { ProgressStateV1, WeaponProgress } from './types'

const MAX_COUNTER = Number.MAX_SAFE_INTEGER
const RECENT_EVENT_LIMIT = 64
const RECENT_EVENT_KEYS: unique symbol = Symbol('recentProgressEventKeys')

type RuntimeProgressState = ProgressStateV1 & {
  [RECENT_EVENT_KEYS]?: readonly string[]
}

function safeCounter(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.floor(value), MAX_COUNTER)
}

function increment(value: number): number {
  return Math.min(safeCounter(value) + 1, MAX_COUNTER)
}

function clampCharge(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), 1)
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function sortedIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function normalizeWeapon(progress: WeaponProgress): WeaponProgress {
  return {
    uses: safeCounter(progress.uses),
    finishes: safeCounter(progress.finishes),
    seenMoves: sortedIds(progress.seenMoves),
  }
}

function normalizedCopy(state: ProgressStateV1): ProgressStateV1 {
  const byWeapon = Object.fromEntries(
    Object.entries(state.byWeapon).map(([id, progress]) => [id, normalizeWeapon(progress)])
  )

  return {
    ...state,
    lifetime: {
      validHits: safeCounter(state.lifetime.validHits),
      chargedFinishers: safeCounter(state.lifetime.chargedFinishers),
      totalTargets: safeCounter(state.lifetime.totalTargets),
      bestCombo: safeCounter(state.lifetime.bestCombo),
      stamps: safeCounter(state.lifetime.stamps),
      distinctWeaponIds: sortedIds(state.lifetime.distinctWeaponIds),
    },
    byWeapon,
    byTarget: {
      word: { destroys: safeCounter(state.byTarget.word.destroys) },
      earth: { destroys: safeCounter(state.byTarget.earth.destroys) },
      city: { destroys: safeCounter(state.byTarget.city.destroys) },
    },
    achievements: { ...state.achievements },
    daily: {
      ...state.daily,
      target: safeCounter(state.daily.target),
      progress: safeCounter(state.daily.progress),
      distinctIds: sortedIds(state.daily.distinctIds),
    },
    profile: {
      ...state.profile,
      skins: { ...state.profile.skins },
    },
  }
}

function currentWeapon(state: ProgressStateV1, weaponId: string): WeaponProgress {
  return state.byWeapon[weaponId] ?? { uses: 0, finishes: 0, seenMoves: [] }
}

function settlementKey(event: GameEvent): string | null {
  switch (event.type) {
    case 'ATTACK_RESOLVED':
    case 'CHARGE_RELEASED':
    case 'TARGET_DESTROYED':
    case 'WEAPON_USED':
      return `${event.actionId}:${event.targetRunId}:${event.type}`
    default:
      return null
  }
}

function hasValidSettlementIdentity(event: GameEvent): boolean {
  switch (event.type) {
    case 'ATTACK_RESOLVED':
    case 'CHARGE_RELEASED':
    case 'TARGET_DESTROYED':
    case 'WEAPON_USED':
      return isPositiveSafeInteger(event.actionId) && isPositiveSafeInteger(event.targetRunId)
    default:
      return true
  }
}

function recentKeys(state: ProgressStateV1): readonly string[] {
  return (state as RuntimeProgressState)[RECENT_EVENT_KEYS] ?? []
}

function attachRecentKeys(
  state: ProgressStateV1,
  previousKeys: readonly string[],
  nextKey: string | null
): void {
  if (previousKeys.length === 0 && nextKey === null) return
  const keys = nextKey === null
    ? [...previousKeys]
    : [...previousKeys, nextKey].slice(-RECENT_EVENT_LIMIT)
  Object.defineProperty(state, RECENT_EVENT_KEYS, {
    value: keys,
    enumerable: false,
    configurable: false,
    writable: false,
  })
}

function completionTimestamp(dayKey: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dayKey) ? dayKey : '1970-01-01'
  return `${date}T00:00:00.000Z`
}

function normalizeDistinctDailyEvidence(
  daily: ProgressStateV1['daily']
): void {
  daily.distinctIds = sortedIds(daily.distinctIds.filter(isCharacterWeaponId))
  daily.progress = Math.min(daily.distinctIds.length, daily.target)
  const completionHasEvidence = (
    daily.progress >= daily.target
    && daily.completedAt !== null
    && daily.stampAwarded
  )
  if (completionHasEvidence) return
  daily.completedAt = null
  daily.stampAwarded = false
}

function advanceDaily(
  state: ProgressStateV1,
  event: GameEvent,
  catalog: QuestCatalogSnapshot
): void {
  const daily = state.daily
  if (daily.target === 0) return

  const definition = catalog.quests.find((quest) => quest.id === daily.questId)
  if (!definition) return
  if (definition.distinct === 'weaponId') normalizeDistinctDailyEvidence(daily)
  if (daily.completedAt !== null) return
  const normalizedEvent: GameEvent = event.type === 'CHARGE_RELEASED'
    ? { ...event, charge: clampCharge(event.charge) }
    : event
  try {
    if (!definition.accepts(normalizedEvent)) return
  } catch {
    return
  }

  if (definition.distinct === 'weaponId') {
    if (event.type !== 'WEAPON_USED') return
    daily.distinctIds = sortedIds([...daily.distinctIds, event.weaponId])
    daily.progress = Math.min(
      Math.max(daily.progress, daily.distinctIds.length),
      daily.target
    )
  } else {
    daily.progress = Math.min(increment(daily.progress), daily.target)
  }
  if (daily.progress < daily.target) return

  daily.completedAt = completionTimestamp(daily.dayKey)
  if (daily.stampAwarded) return
  daily.stampAwarded = true
  state.lifetime.stamps = increment(state.lifetime.stamps)
}

function hasUserSource(event: GameEvent): event is Exclude<GameEvent, { type: 'SETTING_CHANGED' }> {
  return event.type !== 'SETTING_CHANGED'
}

/** Reduces validated game outcomes without storage, clock, or DOM access. */
export function reduceProgress(
  state: ProgressStateV1,
  event: GameEvent,
  catalog: QuestCatalogSnapshot = BUILT_IN_CATALOG
): ProgressStateV1 {
  if (hasUserSource(event) && event.source !== 'user') return state
  if (!hasValidSettlementIdentity(event)) return state
  if (event.type === 'ATTACK_RESOLVED' && (!Number.isFinite(event.detached) || event.detached <= 0)) {
    return state
  }
  if (event.type === 'CHARGE_RELEASED' && clampCharge(event.charge) < 1) return state
  if (event.type === 'FEVER_STARTED' || event.type === 'SHARE_COMPLETED') return state

  const key = settlementKey(event)
  const keys = recentKeys(state)
  if (key !== null && keys.includes(key)) return state

  const next = normalizedCopy(state)
  switch (event.type) {
    case 'ATTACK_RESOLVED': {
      const weapon = currentWeapon(next, event.weaponId)
      next.lifetime.validHits = increment(next.lifetime.validHits)
      next.byWeapon[event.weaponId] = {
        ...weapon,
        seenMoves: sortedIds([...weapon.seenMoves, event.moveId]),
      }
      break
    }
    case 'CHARGE_RELEASED':
      next.lifetime.chargedFinishers = increment(next.lifetime.chargedFinishers)
      break
    case 'TARGET_DESTROYED': {
      const weapon = currentWeapon(next, event.weaponId)
      next.lifetime.totalTargets = increment(next.lifetime.totalTargets)
      next.byWeapon[event.weaponId] = { ...weapon, finishes: increment(weapon.finishes) }
      next.byTarget[event.targetId] = { destroys: increment(next.byTarget[event.targetId].destroys) }
      break
    }
    case 'WEAPON_USED': {
      const weapon = currentWeapon(next, event.weaponId)
      next.byWeapon[event.weaponId] = { ...weapon, uses: increment(weapon.uses) }
      next.lifetime.distinctWeaponIds = sortedIds([
        ...next.lifetime.distinctWeaponIds,
        event.weaponId,
      ])
      break
    }
    case 'COMBO_CHANGED':
      next.lifetime.bestCombo = Math.max(next.lifetime.bestCombo, safeCounter(event.value))
      break
    case 'SETTING_CHANGED':
      if (event.key === 'strongInput') next.profile.strongInput = event.value
      else if (event.key === 'reducedMotion') next.profile.reducedMotion = event.value
      else next.profile.haptics = event.value
      break
  }

  advanceDaily(next, event, catalog)
  attachRecentKeys(next, keys, key)
  return next
}
