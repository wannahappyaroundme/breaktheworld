import type { Effect } from './types'

const MAX_ACTIVE_EFFECTS = 24

/** Holds and ticks transient visual effects (fireballs, rings, beams…). */
export class Effects {
  private below: Effect[] = [] // drawn under the target
  private above: Effect[] = [] // drawn over the target
  private pendingBelow: Effect[] = []
  private pendingAbove: Effect[] = []
  private updating = false
  private insertionOrder = new WeakMap<Effect, number>()
  private nextInsertionOrder = 0

  get activeCount(): number {
    return (
      this.below.length +
      this.above.length +
      this.pendingBelow.length +
      this.pendingAbove.length
    )
  }

  has(effect: Effect): boolean {
    return (
      this.below.includes(effect) ||
      this.above.includes(effect) ||
      this.pendingBelow.includes(effect) ||
      this.pendingAbove.includes(effect)
    )
  }

  add(e: Effect): boolean {
    // Particles have their own pool. Preserve every effect already on screen and
    // let essential actors replace only the newest garnish at saturation.
    if (this.activeCount >= MAX_ACTIVE_EFFECTS) {
      if (e.priority !== 'essential' || !this.evictNewestGarnish()) return false
    }
    this.insertionOrder.set(e, ++this.nextInsertionOrder)
    if ((e.z ?? 0) < 0) {
      const destination = this.updating ? this.pendingBelow : this.below
      destination.push(e)
    } else {
      const destination = this.updating ? this.pendingAbove : this.above
      destination.push(e)
    }
    return true
  }

  private evictNewestGarnish(): boolean {
    const collections = [this.below, this.above, this.pendingBelow, this.pendingAbove]
    let newestCollection: Effect[] | null = null
    let newestIndex = -1
    let newestOrder = Number.NEGATIVE_INFINITY

    for (const collection of collections) {
      for (let index = 0; index < collection.length; index++) {
        const effect = collection[index]
        if (effect.priority === 'essential') continue
        const order = this.insertionOrder.get(effect) ?? Number.NEGATIVE_INFINITY
        if (order > newestOrder) {
          newestCollection = collection
          newestIndex = index
          newestOrder = order
        }
      }
    }

    if (!newestCollection || newestIndex < 0) return false
    newestCollection.splice(newestIndex, 1)
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
    this.insertionOrder = new WeakMap()
    this.nextInsertionOrder = 0
  }
}
