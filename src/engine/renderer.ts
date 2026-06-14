/**
 * Owns the main canvas + 2D context. Handles HiDPI scaling and resize so the
 * rest of the game works in CSS pixels and always renders crisply.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  width = 0
  height = 0
  dpr = 1

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) throw new Error('2D canvas not supported')
    this.ctx = ctx
    this.resize()
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120))
  }

  resize(): void {
    // cap DPR for perf on high-density phones
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5)
    this.width = window.innerWidth
    this.height = window.innerHeight
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
    this.canvas.style.width = this.width + 'px'
    this.canvas.style.height = this.height + 'px'
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.width, this.height)
  }

  get cx(): number {
    return this.width / 2
  }
  get cy(): number {
    return this.height / 2
  }
}
