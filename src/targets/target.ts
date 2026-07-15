import type { DamageRequest, DamageResult } from '../combat/damage'

export type DetachMode = 'fall' | 'dissolve' | 'squash'

export interface Target {
  readonly name: string
  /** screen-space center of the target */
  readonly cx: number
  readonly cy: number
  /** approximate radius for camera centering / aiming */
  readonly radius: number

  update(dtSec: number, w: number, h: number): void
  draw(ctx: CanvasRenderingContext2D): void

  readonly initialFragmentCount: number
  applyDamage(request: DamageRequest): DamageResult

  /** Detach fragments within `radius` of (x,y). Returns how many came loose. */
  takeDamage(x: number, y: number, radius: number, force: number, mode?: DetachMode): number
  /** Detach every remaining fragment (cinematic finishers). */
  detachAll(x: number, y: number, force: number, mode?: DetachMode): number
  /** Detach a random fraction (e.g. Thanos = 0.5). */
  detachFraction(frac: number, mode?: DetachMode): number

  readonly attachedCount: number
  readonly isDestroyed: boolean

  reposition(w: number, h: number): void
  /** play the sky-fall entrance animation */
  dropIn(): void

  /** rare bonus target — glowing gold aura + jackpot on destroy */
  readonly isGolden: boolean
  setGolden(on: boolean): void
}
