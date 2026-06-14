import type { Effect } from './types'

/** Holds and ticks transient visual effects (fireballs, rings, beams…). */
export class Effects {
  private below: Effect[] = [] // drawn under the target
  private above: Effect[] = [] // drawn over the target

  add(e: Effect): void {
    if ((e.z ?? 0) < 0) this.below.push(e)
    else this.above.push(e)
  }

  update(dtSec: number): void {
    this.below = this.below.filter((e) => e.update(dtSec))
    this.above = this.above.filter((e) => e.update(dtSec))
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
  }
}
