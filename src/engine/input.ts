export interface PointerHit {
  x: number
  y: number
  /** 'down' = fresh tap/touch, 'drag' = moved while held */
  phase: 'down' | 'drag'
  /** identifies the finger so weapons can track strokes */
  id: number
}

export type HitHandler = (hit: PointerHit) => void

/**
 * Touch-first input. Maps tap / swipe / multi-touch to PointerHit events.
 * Also supports mouse so it can be tested in a desktop browser, but the
 * design target is mobile.
 */
export class Input {
  private el: HTMLElement
  private onHit: HitHandler
  private active = new Map<number, { x: number; y: number }>()

  constructor(el: HTMLElement, onHit: HitHandler) {
    this.el = el
    this.onHit = onHit
    this.attach()
  }

  private emit(id: number, x: number, y: number, phase: 'down' | 'drag') {
    this.onHit({ id, x, y, phase })
  }

  private attach() {
    const opts: AddEventListenerOptions = { passive: false }

    this.el.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault()
        for (const t of Array.from(e.changedTouches)) {
          this.active.set(t.identifier, { x: t.clientX, y: t.clientY })
          this.emit(t.identifier, t.clientX, t.clientY, 'down')
        }
      },
      opts
    )

    this.el.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault()
        for (const t of Array.from(e.changedTouches)) {
          const prev = this.active.get(t.identifier)
          // throttle by distance so a stroke spawns hits along its path
          if (prev && Math.hypot(t.clientX - prev.x, t.clientY - prev.y) < 14) continue
          this.active.set(t.identifier, { x: t.clientX, y: t.clientY })
          this.emit(t.identifier, t.clientX, t.clientY, 'drag')
        }
      },
      opts
    )

    const end = (e: TouchEvent) => {
      e.preventDefault()
      for (const t of Array.from(e.changedTouches)) this.active.delete(t.identifier)
    }
    this.el.addEventListener('touchend', end, opts)
    this.el.addEventListener('touchcancel', end, opts)

    // --- mouse fallback (desktop testing only) ---
    let mouseDown = false
    let lastX = 0
    let lastY = 0
    this.el.addEventListener('mousedown', (e) => {
      mouseDown = true
      lastX = e.clientX
      lastY = e.clientY
      this.emit(-1, e.clientX, e.clientY, 'down')
    })
    this.el.addEventListener('mousemove', (e) => {
      if (!mouseDown) return
      if (Math.hypot(e.clientX - lastX, e.clientY - lastY) < 14) return
      lastX = e.clientX
      lastY = e.clientY
      this.emit(-1, e.clientX, e.clientY, 'drag')
    })
    window.addEventListener('mouseup', () => {
      mouseDown = false
    })
  }
}
