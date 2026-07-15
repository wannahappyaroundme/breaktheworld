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
  private evicted = new Set<Effect>()

  get activeCount(): number {
    const collections = [this.below, this.above, this.pendingBelow, this.pendingAbove]
    return collections.reduce(
      (count, collection) =>
        count + collection.reduce((sum, effect) => sum + (this.evicted.has(effect) ? 0 : 1), 0),
      0
    )
  }

  has(effect: Effect): boolean {
    return (
      !this.evicted.has(effect) &&
      (this.below.includes(effect) ||
        this.above.includes(effect) ||
        this.pendingBelow.includes(effect) ||
        this.pendingAbove.includes(effect))
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
        if (effect.priority === 'essential' || this.evicted.has(effect)) continue
        const order = this.insertionOrder.get(effect) ?? Number.NEGATIVE_INFINITY
        if (order > newestOrder) {
          newestCollection = collection
          newestIndex = index
          newestOrder = order
        }
      }
    }

    if (!newestCollection || newestIndex < 0) return false
    const effect = newestCollection[newestIndex]
    this.evicted.add(effect)
    if (!this.updating) {
      this.compactEvictions()
      this.evicted.clear()
    }
    return true
  }

  private compactEvictions(): void {
    const retained = (effect: Effect) => !this.evicted.has(effect)
    this.below = this.below.filter(retained)
    this.above = this.above.filter(retained)
    this.pendingBelow = this.pendingBelow.filter(retained)
    this.pendingAbove = this.pendingAbove.filter(retained)
  }

  update(dtSec: number): void {
    this.updating = true
    try {
      const updateEffect = (effect: Effect) => {
        if (this.evicted.has(effect)) return false
        return effect.update(dtSec) && !this.evicted.has(effect)
      }
      this.below = this.below.filter(updateEffect)
      this.above = this.above.filter(updateEffect)
    } finally {
      this.updating = false
      this.compactEvictions()
      this.below.push(...this.pendingBelow)
      this.above.push(...this.pendingAbove)
      this.pendingBelow = []
      this.pendingAbove = []
      this.evicted.clear()
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
    this.evicted.clear()
  }
}
