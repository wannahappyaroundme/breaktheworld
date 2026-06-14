export type TickFn = (dtMs: number, nowMs: number) => void

/**
 * requestAnimationFrame game loop with a clamped delta time.
 * Pauses automatically when the tab is hidden so we don't get a huge
 * dt spike (and wasted CPU) on resume.
 */
export class GameLoop {
  private running = false
  private last = 0
  private rafId = 0
  private readonly tick: TickFn
  /** raw rAF for tests / custom drivers */
  readonly maxDtMs: number

  constructor(tick: TickFn, maxDtMs = 50) {
    this.tick = tick
    this.maxDtMs = maxDtMs
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stop()
        else this.start()
      })
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.last = now()
    const frame = (t: number) => {
      if (!this.running) return
      this.step(t)
      this.rafId = requestAnimationFrame(frame)
    }
    this.rafId = requestAnimationFrame(frame)
  }

  stop(): void {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
  }

  /** Advance one frame given an absolute timestamp (ms). Exposed for tests. */
  step(t: number): void {
    const dt = Math.min(t - this.last, this.maxDtMs)
    this.last = t
    if (dt > 0) this.tick(dt, t)
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
