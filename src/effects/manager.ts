import type { Effect } from './types'

const MAX_ACTIVE_EFFECTS = 24

/** Holds and ticks transient visual effects (fireballs, rings, beams…). */
export class Effects {
  private below: Effect[] = [] // drawn under the target
  private above: Effect[] = [] // drawn over the target
  private pendingBelow: Effect[] = []
  private pendingAbove: Effect[] = []
  private updating = false

  get activeCount(): number {
    return (
      this.below.length +
      this.above.length +
      this.pendingBelow.length +
      this.pendingAbove.length
    )
  }

  add(e: Effect): boolean {
    // Particles have their own pool. Preserve every effect already on screen and
    // drop only the newest overflow garnish, so cinematics are never torn down.
    if (this.activeCount >= MAX_ACTIVE_EFFECTS) return false
    if ((e.z ?? 0) < 0) {
      const destination = this.updating ? this.pendingBelow : this.below
      destination.push(e)
    } else {
      const destination = this.updating ? this.pendingAbove : this.above
      destination.push(e)
    }
    return true
  }

  update(dtSec: number): void {
    this.updating = true
    try {
      this.below = this.below.filter((e) => e.update(dtSec))
      this.above = this.above.filter((e) => e.update(dtSec))
    } finally {
      this.updating = false
      this.below.push(...this.pendingBelow)
      this.above.push(...this.pendingAbove)
      this.pendingBelow = []
      this.pendingAbove = []
    }
  }

  drawBelow(ctx: CanvasRenderingContext2D): void {
    for (const e of this.below) e.draw(ctx)
  }
  drawAbove(ctx: CanvasRenderingContext2D): void {
    for (const e of this.above) e.draw(ctx)
  }

  clear(): void {
    this.below = []
    this.above = []
    this.pendingBelow = []
    this.pendingAbove = []
  }
}
