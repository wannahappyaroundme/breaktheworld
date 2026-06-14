import { rng } from './rng'

/**
 * Juice layer: screen shake, full-screen color flash, and a zoom "punch".
 * Weapons call shake()/flash()/punch(); the camera decays them over time.
 * Render order: camera.begin(ctx) -> draw world -> camera.end(ctx) -> camera.overlay(ctx).
 */
export class Camera {
  private shakeMag = 0
  private zoom = 0 // extra scale, decays to 0
  private flashColor = '#fff'
  private flashAlpha = 0
  private cx = 0
  private cy = 0

  setCenter(cx: number, cy: number) {
    this.cx = cx
    this.cy = cy
  }

  shake(mag: number) {
    this.shakeMag = Math.max(this.shakeMag, mag)
  }

  punch(amount: number) {
    this.zoom = Math.max(this.zoom, amount)
  }

  flash(color: string, alpha: number) {
    this.flashColor = color
    this.flashAlpha = Math.max(this.flashAlpha, alpha)
  }

  update(dtMs: number) {
    const k = dtMs / 1000
    this.shakeMag *= Math.pow(0.0025, k) // fast decay
    if (this.shakeMag < 0.2) this.shakeMag = 0
    this.zoom *= Math.pow(0.0008, k)
    if (this.zoom < 0.001) this.zoom = 0
    this.flashAlpha *= Math.pow(0.0004, k)
    if (this.flashAlpha < 0.01) this.flashAlpha = 0
  }

  begin(ctx: CanvasRenderingContext2D) {
    ctx.save()
    const ox = rng.spread(this.shakeMag)
    const oy = rng.spread(this.shakeMag)
    const s = 1 + this.zoom
    ctx.translate(this.cx, this.cy)
    ctx.scale(s, s)
    ctx.translate(-this.cx + ox, -this.cy + oy)
  }

  end(ctx: CanvasRenderingContext2D) {
    ctx.restore()
  }

  overlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
    if (this.flashAlpha <= 0) return
    ctx.save()
    ctx.globalAlpha = Math.min(1, this.flashAlpha)
    ctx.fillStyle = this.flashColor
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
}
