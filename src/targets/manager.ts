import type { Target } from './target'

export type TargetFactory = (w: number, h: number) => Target

export interface TargetManagerOpts {
  factories: TargetFactory[]
  swapDelaySec?: number
  onDestroyed?: (t: Target) => void
  onSpawn?: (t: Target) => void
}

/** Cycles through targets, swapping to the next a beat after one is destroyed. */
export class TargetManager {
  current: Target
  private i = 0
  private factories: TargetFactory[]
  private swapDelay: number
  private onDestroyed?: (t: Target) => void
  private onSpawn?: (t: Target) => void
  private swapping = false
  private timer = 0
  private runId = 1

  constructor(opts: TargetManagerOpts, w: number, h: number) {
    this.factories = opts.factories
    this.swapDelay = opts.swapDelaySec ?? 0.9
    this.onDestroyed = opts.onDestroyed
    this.onSpawn = opts.onSpawn
    // first target appears in place; subsequent ones drop from the sky
    this.current = this.factories[0](w, h)
    this.current.reposition(w, h)
    this.onSpawn?.(this.current)
  }

  update(dtSec: number, w: number, h: number): void {
    this.current.update(dtSec, w, h)
    if (!this.swapping && this.current.isDestroyed) {
      this.swapping = true
      this.timer = this.swapDelay
      // blow off any stragglers for a clean finish
      this.current.detachAll(this.current.cx, this.current.cy, 50, 'fall')
      this.onDestroyed?.(this.current)
    }
    if (this.swapping) {
      this.timer -= dtSec
      if (this.timer <= 0) this.advance(w, h)
    }
  }

  private advance(w: number, h: number): void {
    const nextIndex = (this.i + 1) % this.factories.length
    const next = this.factories[nextIndex](w, h)
    next.reposition(w, h)
    next.dropIn()
    this.i = nextIndex
    this.current = next
    this.runId++
    this.swapping = false
    this.onSpawn?.(this.current)
  }

  /** "next" button — finish current immediately and move on */
  skip(_w: number, _h: number): void {
    if (this.swapping) return
    this.current.detachAll(this.current.cx, this.current.cy, 70, 'fall')
    this.swapping = true
    this.timer = 0.35
  }

  /** "reset" button — back to first target fresh */
  reset(w: number, h: number): void {
    this.i = -1
    this.swapping = false
    this.timer = 0
    this.advance(w, h)
  }

  get swapIndex(): number {
    return this.i
  }

  get targetRunId(): number {
    return this.runId
  }
}
