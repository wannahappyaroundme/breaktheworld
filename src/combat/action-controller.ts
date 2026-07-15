import type { Target } from '../targets/target'
import type { Weapon, WeaponAction, World } from '../weapons/weapon'
import type { GestureEvent } from './gesture'
import type { DamageResult } from './damage'

const COMBO_GRACE_MS = 200
const CINEMATIC_MS = 1_200
const DOUBLE_TAP_MS = 280
const DOUBLE_TAP_PX = 32

export type StrongInputMode = 'hold' | 'doubleTap'

export type ActionState =
  | 'idle'
  | 'pressed'
  | 'dragging'
  | 'charging'
  | 'cinematic'
  | 'recovery'

export type CancelReason =
  | 'gesture'
  | 'next'
  | 'reset'
  | 'visibility'
  | 'weaponChange'
  | 'settingsMode'
  | 'targetDestroyed'
  | 'system'

export type ActionKind = 'quick' | 'drag' | 'charged'

export interface ActionResolution {
  actionId: number
  targetRunId: number
  weaponId: string
  kind: ActionKind
  charge: number
}

export interface ActionDamageResolution extends ActionResolution {
  damage: DamageResult
}

export interface ChargeState {
  x: number
  y: number
  charge: number
  color: string
  maxed: boolean
  nowMs: number
}

export interface ActionControllerOptions {
  getTarget: () => Target
  getTargetRunId: () => number
  now?: () => number
  nextSeed?: () => number
  strongInput?: StrongInputMode
  onSettled?: (resolution: ActionResolution) => void
  onDamage?: (resolution: ActionDamageResolution) => void
}

export interface StartAction {
  weapon: Weapon
  targetRunId: number
  x: number
  y: number
  seed: number
}

interface ActiveAction {
  action: WeaponAction
  weapon: Weapon
  world?: World
  settled: boolean
  kind: ActionKind
  damageReported: boolean
}

interface PendingTap {
  active: ActiveAction
  x: number
  y: number
  completedAt: number
  expiresAt: number
}

function fallbackAccentColor(weaponId: string): string {
  let hash = 0
  for (let i = 0; i < weaponId.length; i++) hash = (hash * 31 + weaponId.charCodeAt(i)) | 0
  return `hsl(${Math.abs(hash) % 360} 82% 62%)`
}

/** Owns gesture settlement and invalidates damage from stale or cancelled actions. */
export class ActionController {
  comboGraceUntil = 0
  private currentState: ActionState = 'idle'
  private nextActionId = 0
  private active: ActiveAction | null = null
  private gestures = new Map<number, ActiveAction>()
  private validActionIds = new Set<number>()
  private pointerId: number | null = null
  private cinematicUntil = 0
  private recoveryUntil = 0
  private currentCharge: ChargeState | null = null
  private pendingTap: PendingTap | null = null
  private strongInput: StrongInputMode
  private getTarget: () => Target
  private getTargetRunId: () => number
  private now: () => number
  private nextSeed: () => number
  private onSettled?: (resolution: ActionResolution) => void
  private onDamage?: (resolution: ActionDamageResolution) => void

  constructor(options: ActionControllerOptions) {
    this.getTarget = options.getTarget
    this.getTargetRunId = options.getTargetRunId
    this.now = options.now ?? (() => performance.now())
    this.nextSeed = options.nextSeed ?? (() => Math.floor(Math.random() * 0x1_0000_0000))
    this.strongInput = options.strongInput === 'doubleTap' ? 'doubleTap' : 'hold'
    this.onSettled = options.onSettled
    this.onDamage = options.onDamage
  }

  get state(): ActionState {
    return this.currentState
  }

  get chargeState(): ChargeState | null {
    return this.currentCharge
  }

  get strongInputMode(): StrongInputMode {
    return this.strongInput
  }

  setStrongInput(mode: StrongInputMode): void {
    if (mode === this.strongInput) return
    this.cancel('settingsMode')
    this.strongInput = mode
  }

  hasComboGrace(nowMs = this.now()): boolean {
    return nowMs <= this.comboGraceUntil
  }

  start(input: StartAction): WeaponAction {
    this.discardPendingTap(this.now())
    this.gestures.clear()
    this.pointerId = null
    this.currentCharge = null
    return this.beginAction(input).action
  }

  /** Production demo/system entry point; damage still passes action and target-run guards. */
  runSystemQuick(
    weapon: Weapon,
    world: World,
    x: number,
    y: number
  ): ActionResolution | null {
    const nowMs = this.now()
    this.update(nowMs)
    this.discardPendingTap(nowMs)
    const cinematic = weapon.mode === 'cinematic'
    if (cinematic && this.isCinematicLocked(nowMs)) return null
    const active = this.beginAction(
      {
        weapon,
        targetRunId: this.getTargetRunId(),
        x,
        y,
        seed: this.nextSeed(),
      },
      world,
      'pressed',
      true,
      cinematic
    )
    return this.settle(active, 'quick', x, y, 0, nowMs, false, !cinematic)
  }

  handle(event: GestureEvent, weapon: Weapon, world: World): ActionResolution | null {
    const nowMs = this.now()
    this.update(nowMs)

    switch (event.type) {
      case 'press':
        if (this.isCinematicLocked(nowMs)) return null
        if (this.pointerId !== null) {
          if (weapon.mode === 'cinematic') return null
          const secondary = this.beginAction({
            weapon,
            targetRunId: this.getTargetRunId(),
            x: event.x,
            y: event.y,
            seed: this.nextSeed(),
          }, world, 'pressed', true, false)
          this.gestures.set(event.id, secondary)
          return null
        }
        this.pointerId = event.id
        this.gestures.set(event.id, this.beginAction({
          weapon,
          targetRunId: this.getTargetRunId(),
          x: event.x,
          y: event.y,
          seed: this.nextSeed(),
        }, world, 'pressed', this.strongInput === 'doubleTap' && this.pendingTap !== null))
        return null

      case 'tap': {
        const gesture = this.gestures.get(event.id)
        if (!gesture) return null
        this.gestures.delete(event.id)
        if (this.strongInput === 'doubleTap') {
          return this.completeDoubleTap(gesture, event.x, event.y, nowMs)
        }
        if (event.id !== this.pointerId) {
          return this.settle(
            gesture,
            'quick',
            event.x,
            event.y,
            0,
            nowMs,
            false,
            this.pointerId !== null
          )
        }
        if (this.currentState !== 'pressed') return null
        return this.settle(gesture, 'quick', event.x, event.y, 0, nowMs)
      }

      case 'dragStart':
        if (
          event.id !== this.pointerId ||
          (this.currentState !== 'pressed' && this.currentState !== 'charging')
        ) {
          return null
        }
        this.discardPendingTap(nowMs)
        this.currentState = 'dragging'
        this.currentCharge = null
        return this.settle(
          this.gestures.get(event.id) ?? null,
          'drag',
          event.x,
          event.y,
          0,
          nowMs,
          true
        )

      case 'drag':
        if (event.id !== this.pointerId || this.currentState !== 'dragging') return null
        this.gestures.set(event.id, this.beginAction({
          weapon,
          targetRunId: this.getTargetRunId(),
          x: event.x,
          y: event.y,
          seed: this.nextSeed(),
        }, world, 'dragging'))
        return this.settle(
          this.gestures.get(event.id) ?? null,
          'drag',
          event.x,
          event.y,
          0,
          nowMs,
          true
        )

      case 'chargeStart': {
        const gesture = this.gestures.get(event.id)
        if (event.id !== this.pointerId || this.currentState !== 'pressed' || !gesture) return null
        if (this.strongInput === 'doubleTap') return null
        this.currentState = 'charging'
        this.comboGraceUntil = Number.POSITIVE_INFINITY
        this.currentCharge = {
          x: event.x,
          y: event.y,
          charge: 0,
          color: gesture.weapon.accentColor ?? fallbackAccentColor(gesture.weapon.id),
          maxed: false,
          nowMs,
        }
        return null
      }

      case 'chargeProgress':
        if (this.strongInput === 'doubleTap') return null
        if (event.id !== this.pointerId || this.currentState !== 'charging' || !this.currentCharge) {
          return null
        }
        this.currentCharge.x = event.x
        this.currentCharge.y = event.y
        this.currentCharge.charge = event.charge
        this.currentCharge.maxed = event.charge >= 1
        this.currentCharge.nowMs = nowMs
        return null

      case 'chargeRelease': {
        if (
          event.id !== this.pointerId ||
          (this.currentState !== 'charging' && this.currentState !== 'pressed')
        ) {
          return null
        }
        const gesture = this.gestures.get(event.id) ?? null
        this.gestures.delete(event.id)
        if (this.strongInput === 'doubleTap') {
          if (!gesture) return null
          return this.completeDoubleTap(gesture, event.x, event.y, nowMs)
        }
        return this.settle(gesture, 'charged', event.x, event.y, event.charge, nowMs)
      }

      case 'cancel': {
        if (event.id !== this.pointerId) {
          const gesture = this.gestures.get(event.id)
          if (gesture) this.validActionIds.delete(gesture.action.actionId)
          this.gestures.delete(event.id)
          return null
        }
        this.cancel('gesture')
        return null
      }
    }
  }

  update(nowMs = this.now()): void {
    if (this.pendingTap) {
      if (this.pendingTap.active.action.targetRunId !== this.getTargetRunId()) {
        this.discardPendingTap(nowMs)
      } else if (nowMs >= this.pendingTap.expiresAt) {
        this.settlePendingQuick(nowMs)
      }
    }
    if (this.currentCharge) this.currentCharge.nowMs = nowMs
    if (this.currentState === 'cinematic' && nowMs >= this.cinematicUntil) {
      this.currentState = 'recovery'
      this.recoveryUntil = this.cinematicUntil + COMBO_GRACE_MS
    }
    if (this.currentState === 'recovery' && nowMs >= this.recoveryUntil) {
      this.currentState = 'idle'
    }
  }

  cancel(_reason: CancelReason = 'system'): void {
    const nowMs = this.now()
    this.active = null
    this.gestures.clear()
    this.validActionIds.clear()
    this.pointerId = null
    this.currentCharge = null
    this.pendingTap = null
    this.cinematicUntil = 0
    this.recoveryUntil = 0
    this.comboGraceUntil = nowMs
    this.currentState = 'idle'
  }

  private completeDoubleTap(
    gesture: ActiveAction,
    x: number,
    y: number,
    nowMs: number
  ): ActionResolution | null {
    const previous = this.pendingTap
    if (previous) {
      const elapsed = nowMs - previous.completedAt
      const distance = Math.hypot(x - previous.x, y - previous.y)
      if (elapsed < DOUBLE_TAP_MS && distance < DOUBLE_TAP_PX) {
        this.pendingTap = null
        this.validActionIds.delete(previous.active.action.actionId)
        return this.settle(gesture, 'charged', x, y, 1, nowMs)
      }

      this.settlePendingQuick(nowMs)
      if (this.isCinematicLocked(nowMs) || !this.validActionIds.has(gesture.action.actionId)) {
        this.validActionIds.delete(gesture.action.actionId)
        this.gestures.delete(this.pointerId ?? -1)
        this.pointerId = null
        return null
      }
    }

    this.queuePendingTap(gesture, x, y, nowMs)
    return null
  }

  private queuePendingTap(gesture: ActiveAction, x: number, y: number, nowMs: number): void {
    if (!gesture.world || gesture.settled || !this.validActionIds.has(gesture.action.actionId)) return
    this.pendingTap = {
      active: gesture,
      x,
      y,
      completedAt: nowMs,
      expiresAt: nowMs + DOUBLE_TAP_MS,
    }
    this.active = gesture
    this.pointerId = null
    this.currentCharge = null
    this.currentState = 'recovery'
    this.recoveryUntil = nowMs + DOUBLE_TAP_MS
    this.comboGraceUntil = nowMs + DOUBLE_TAP_MS
  }

  private settlePendingQuick(nowMs: number): ActionResolution | null {
    const pending = this.pendingTap
    if (!pending) return null
    this.pendingTap = null

    const preserveController = this.pointerId !== null && pending.active.weapon.mode !== 'cinematic'
    if (this.pointerId !== null && pending.active.weapon.mode === 'cinematic') {
      const pendingId = pending.active.action.actionId
      for (const active of this.gestures.values()) {
        if (active !== pending.active) this.validActionIds.delete(active.action.actionId)
      }
      this.gestures.clear()
      this.pointerId = null
      this.currentCharge = null
      this.validActionIds.add(pendingId)
    }
    return this.settle(
      pending.active,
      'quick',
      pending.x,
      pending.y,
      0,
      nowMs,
      false,
      preserveController
    )
  }

  private discardPendingTap(nowMs: number): void {
    const pending = this.pendingTap
    if (!pending) return
    this.pendingTap = null
    this.validActionIds.delete(pending.active.action.actionId)
    if (this.active === pending.active && this.pointerId === null) this.active = null
    if (this.pointerId !== null) return
    this.currentState = 'idle'
    this.recoveryUntil = 0
    this.comboGraceUntil = nowMs
  }

  private beginAction(
    input: StartAction,
    world?: World,
    state: ActionState = 'pressed',
    preserveExisting = false,
    updateController = true
  ): ActiveAction {
    const actionId = ++this.nextActionId
    if (!preserveExisting) this.validActionIds.clear()
    this.validActionIds.add(actionId)
    let active: ActiveAction
    const action: WeaponAction = {
      actionId,
      targetRunId: input.targetRunId,
      x: input.x,
      y: input.y,
      charge: 0,
      seed: input.seed,
      damage: (request) => {
        if (!this.validActionIds.has(actionId)) return null
        if (this.getTargetRunId() !== input.targetRunId) return null
        const result = this.getTarget().applyDamage({ ...request, seed: input.seed })
        if (result.detached > 0 && !active.damageReported) {
          active.damageReported = true
          this.onDamage?.({
            actionId,
            targetRunId: input.targetRunId,
            weaponId: input.weapon.id,
            kind: active.kind,
            charge: action.charge,
            damage: result,
          })
        }
        return result
      },
    }
    active = {
      action,
      weapon: input.weapon,
      world,
      settled: false,
      kind: 'quick',
      damageReported: false,
    }
    if (updateController) {
      this.active = active
      this.currentState = state
      this.comboGraceUntil = Number.POSITIVE_INFINITY
    }
    return active
  }

  private settle(
    active: ActiveAction | null,
    kind: ActionKind,
    x: number,
    y: number,
    charge: number,
    nowMs: number,
    keepPointer = false,
    preserveController = false
  ): ActionResolution | null {
    if (!active || active.settled || !active.world) return null
    if (!this.validActionIds.has(active.action.actionId)) {
      this.validActionIds.delete(active.action.actionId)
      return null
    }
    if (active.action.targetRunId !== this.getTargetRunId()) {
      this.validActionIds.delete(active.action.actionId)
      if (!preserveController) this.cancel('system')
      return null
    }

    active.settled = true
    active.action.x = x
    active.action.y = y
    active.action.charge = charge
    active.kind = kind
    if (!preserveController) {
      this.active = active
      this.currentCharge = null
      if (!keepPointer) this.pointerId = null
    }

    if (!preserveController) {
      if (active.weapon.mode === 'cinematic') {
        this.currentState = 'cinematic'
        this.cinematicUntil = nowMs + CINEMATIC_MS
        this.recoveryUntil = this.cinematicUntil + COMBO_GRACE_MS
        this.pointerId = null
      } else if (kind !== 'drag') {
        this.currentState = 'recovery'
        this.recoveryUntil = nowMs + COMBO_GRACE_MS
      }
      this.comboGraceUntil = nowMs + COMBO_GRACE_MS
    }

    if (kind === 'quick') active.weapon.quick(active.world, active.action)
    else if (kind === 'drag') active.weapon.drag(active.world, active.action)
    else active.weapon.charged(active.world, active.action)

    const resolution: ActionResolution = {
      actionId: active.action.actionId,
      targetRunId: active.action.targetRunId,
      weaponId: active.weapon.id,
      kind,
      charge,
    }
    this.onSettled?.(resolution)
    return resolution
  }

  private isCinematicLocked(nowMs: number): boolean {
    if (this.pendingTap) return false
    return (
      (this.currentState === 'cinematic' && nowMs < this.cinematicUntil) ||
      (this.currentState === 'recovery' &&
        this.active?.weapon.mode === 'cinematic' &&
        nowMs < this.recoveryUntil)
    )
  }
}
