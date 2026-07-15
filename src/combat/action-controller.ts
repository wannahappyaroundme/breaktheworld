import type { Target } from '../targets/target'
import type { Weapon, WeaponAction, World } from '../weapons/weapon'
import type { GestureEvent } from './gesture'

const COMBO_GRACE_MS = 200
const CINEMATIC_MS = 1_200

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
  onSettled?: (resolution: ActionResolution) => void
  warn?: (message: string) => void
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
}

function accentColor(weaponId: string): string {
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
  private warnedWeapons = new Set<string>()
  private getTarget: () => Target
  private getTargetRunId: () => number
  private now: () => number
  private nextSeed: () => number
  private onSettled?: (resolution: ActionResolution) => void
  private warn: (message: string) => void

  constructor(options: ActionControllerOptions) {
    this.getTarget = options.getTarget
    this.getTargetRunId = options.getTargetRunId
    this.now = options.now ?? (() => performance.now())
    this.nextSeed = options.nextSeed ?? (() => Math.floor(Math.random() * 0x1_0000_0000))
    this.onSettled = options.onSettled
    this.warn = options.warn ?? console.warn
  }

  get state(): ActionState {
    return this.currentState
  }

  get chargeState(): ChargeState | null {
    return this.currentCharge
  }

  hasComboGrace(nowMs = this.now()): boolean {
    return nowMs <= this.comboGraceUntil
  }

  start(input: StartAction): WeaponAction {
    this.gestures.clear()
    this.pointerId = null
    this.currentCharge = null
    return this.beginAction(input).action
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
        }, world))
        return null

      case 'tap': {
        const gesture = this.gestures.get(event.id)
        if (!gesture) return null
        this.gestures.delete(event.id)
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
        this.currentState = 'charging'
        this.comboGraceUntil = Number.POSITIVE_INFINITY
        this.currentCharge = {
          x: event.x,
          y: event.y,
          charge: 0,
          color: accentColor(gesture.weapon.id),
          maxed: false,
          nowMs,
        }
        return null
      }

      case 'chargeProgress':
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
    this.cinematicUntil = 0
    this.recoveryUntil = 0
    this.comboGraceUntil = nowMs
    this.currentState = 'idle'
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
        return this.getTarget().applyDamage({ ...request, seed: input.seed })
      },
    }
    const active = { action, weapon: input.weapon, world, settled: false }
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
    if (active.action.targetRunId !== this.getTargetRunId()) {
      this.validActionIds.delete(active.action.actionId)
      if (!preserveController) this.cancel('system')
      return null
    }

    active.settled = true
    active.action.x = x
    active.action.y = y
    active.action.charge = charge
    if (!preserveController) {
      this.active = active
      this.currentCharge = null
      if (!keepPointer) this.pointerId = null
    }

    const handler =
      kind === 'quick'
        ? active.weapon.quick
        : kind === 'drag'
          ? active.weapon.drag
          : active.weapon.charged

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

    if (handler) {
      handler(active.world, active.action)
    } else if (active.weapon.apply) {
      active.weapon.apply(active.world, x, y)
    } else if (!this.warnedWeapons.has(active.weapon.id)) {
      this.warnedWeapons.add(active.weapon.id)
      this.warn(`[combat] ${active.weapon.id} has no ${kind} or legacy apply handler`)
    }

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
    return (
      (this.currentState === 'cinematic' && nowMs < this.cinematicUntil) ||
      (this.currentState === 'recovery' &&
        this.active?.weapon.mode === 'cinematic' &&
        nowMs < this.recoveryUntil)
    )
  }
}
