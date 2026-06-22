import { Rng } from '../engine/rng'
import { dist, easeOutBounce, TAU } from '../engine/math'
import { shatter, polyCentroid, type Pt } from './shatter'
import type { Target, DetachMode } from './target'

export interface BreakableOptions {
  name: string
  spriteW: number
  spriteH: number
  fragments: number
  /** paint the art into an offscreen ctx filling (0,0)-(spriteW,spriteH) */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  /** vertical center as a fraction of screen height (default 0.46) */
  centerYFrac?: number
  seed?: number
}

interface Fragment {
  canvas: HTMLCanvasElement
  bx: number
  by: number
  bw: number
  bh: number
  cxLocal: number
  cyLocal: number
  attached: boolean
  // detached physics (absolute coords, fragment center)
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vrot: number
  gravity: number
  alpha: number
  mode: DetachMode
  dead: boolean
}

export class Breakable implements Target {
  readonly name: string
  readonly spriteW: number
  readonly spriteH: number
  private master: HTMLCanvasElement
  private frags: Fragment[] = []
  private attached: Fragment[] = []
  private detached: Fragment[] = []
  private total: number
  private originX = 0
  private originY = 0
  private centerYFrac: number
  // sky-fall entrance
  private dropY = 0
  private dropFrom = 0
  private dropT = 0
  private dropDur = 0.62
  private dropping = false
  // golden bonus target
  private golden = false
  private gt = 0

  constructor(opts: BreakableOptions) {
    this.name = opts.name
    this.spriteW = opts.spriteW
    this.spriteH = opts.spriteH
    this.centerYFrac = opts.centerYFrac ?? 0.46
    const rng = new Rng(opts.seed ?? ((Math.random() * 0xffffffff) >>> 0))

    // 1) render art to master sprite
    this.master = makeCanvas(opts.spriteW, opts.spriteH)
    const mctx = this.master.getContext('2d')!
    opts.draw(mctx, opts.spriteW, opts.spriteH)

    // 2) read alpha for masking
    const img = mctx.getImageData(0, 0, opts.spriteW, opts.spriteH).data

    // 3) shatter rectangle into convex shards, keep ones overlapping the art
    const polys = shatter(opts.spriteW, opts.spriteH, opts.fragments, rng)
    for (const poly of polys) {
      const c = polyCentroid(poly)
      if (!insideArt(img, opts.spriteW, opts.spriteH, c.x, c.y)) continue
      this.frags.push(this.buildFragment(poly, c))
    }
    if (this.frags.length === 0) {
      // fallback: keep all polys (shouldn't happen, but never be empty)
      for (const poly of polys) this.frags.push(this.buildFragment(poly, polyCentroid(poly)))
    }
    this.attached = this.frags.slice()
    this.total = this.frags.length
  }

  private buildFragment(poly: Pt[], c: Pt): Fragment {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const p of poly) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const bw = Math.max(1, Math.ceil(maxX - minX))
    const bh = Math.max(1, Math.ceil(maxY - minY))
    const canvas = makeCanvas(bw, bh)
    const ctx = canvas.getContext('2d')!
    ctx.save()
    ctx.translate(-minX, -minY)
    ctx.beginPath()
    ctx.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(this.master, 0, 0)
    // dark doodle crack edge
    ctx.lineWidth = 1.6
    ctx.strokeStyle = 'rgba(25,22,34,0.45)'
    ctx.stroke()
    ctx.restore()
    return {
      canvas,
      bx: minX,
      by: minY,
      bw,
      bh,
      cxLocal: c.x,
      cyLocal: c.y,
      attached: true,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      rot: 0,
      vrot: 0,
      gravity: 0,
      alpha: 1,
      mode: 'fall',
      dead: false,
    }
  }

  reposition(w: number, h: number): void {
    this.originX = Math.round(w / 2 - this.spriteW / 2)
    this.originY = Math.round(h * this.centerYFrac - this.spriteH / 2)
  }

  /** Animate the target dropping in from above the screen with a bounce. */
  dropIn(): void {
    this.dropping = true
    this.dropT = 0
    this.dropFrom = -(this.originY + this.spriteH + 80)
    this.dropY = this.dropFrom
  }

  get isGolden(): boolean {
    return this.golden
  }
  setGolden(on: boolean): void {
    this.golden = on
  }

  get cx(): number {
    return this.originX + this.spriteW / 2
  }
  get cy(): number {
    return this.originY + this.spriteH / 2
  }
  get radius(): number {
    return Math.min(this.spriteW, this.spriteH) / 2
  }
  get attachedCount(): number {
    return this.attached.length
  }
  get isDestroyed(): boolean {
    return this.attached.length <= Math.floor(this.total * 0.04)
  }

  private detach(f: Fragment, ix: number, iy: number, force: number, mode: DetachMode) {
    f.attached = false
    f.mode = mode
    f.x = this.originX + f.cxLocal
    f.y = this.originY + f.cyLocal
    f.rot = 0
    f.alpha = 1
    const ang = Math.atan2(f.y - iy, f.x - ix) + (Math.random() - 0.5) * 0.8
    const d = Math.max(20, dist(f.x, f.y, ix, iy))
    const sp = (force * (180 + 14000 / d)) / 100
    if (mode === 'dissolve') {
      f.vx = (Math.random() - 0.5) * 40
      f.vy = -Math.random() * 30 - 10
      f.vrot = (Math.random() - 0.5) * 3
      f.gravity = -10
    } else if (mode === 'squash') {
      f.vx = Math.cos(ang) * sp * 1.4
      f.vy = Math.abs(Math.sin(ang)) * 120 + 80
      f.vrot = (Math.random() - 0.5) * 18
      f.gravity = 1600
    } else {
      f.vx = Math.cos(ang) * sp
      f.vy = Math.sin(ang) * sp - Math.random() * 180
      f.vrot = (Math.random() - 0.5) * 16
      f.gravity = 1400
    }
    this.detached.push(f)
  }

  takeDamage(x: number, y: number, radius: number, force: number, mode: DetachMode = 'fall'): number {
    let n = 0
    const survivors: Fragment[] = []
    for (const f of this.attached) {
      const ax = this.originX + f.cxLocal
      const ay = this.originY + f.cyLocal
      if (dist(ax, ay, x, y) <= radius) {
        this.detach(f, x, y, force, mode)
        n++
      } else {
        survivors.push(f)
      }
    }
    this.attached = survivors
    return n
  }

  detachAll(x: number, y: number, force: number, mode: DetachMode = 'fall'): number {
    const n = this.attached.length
    const list = this.attached
    this.attached = []
    for (const f of list) this.detach(f, x, y, force, mode)
    return n
  }

  detachFraction(frac: number, mode: DetachMode = 'dissolve'): number {
    const list = this.attached.slice()
    // shuffle
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
    const k = Math.floor(list.length * frac)
    const chosen = new Set(list.slice(0, k))
    const survivors: Fragment[] = []
    for (const f of this.attached) {
      if (chosen.has(f)) this.detach(f, this.cx, this.cy, 60, mode)
      else survivors.push(f)
    }
    this.attached = survivors
    return k
  }

  update(dtSec: number, _w: number, h: number): void {
    if (this.golden) this.gt += dtSec
    if (this.dropping) {
      this.dropT += dtSec
      const p = this.dropT / this.dropDur
      this.dropY = this.dropFrom * (1 - easeOutBounce(p))
      if (p >= 1) {
        this.dropY = 0
        this.dropping = false
      }
    }
    if (this.detached.length === 0) return
    for (const f of this.detached) {
      if (f.mode === 'dissolve') {
        f.alpha -= dtSec / 0.7
        f.y += f.vy * dtSec
        f.x += f.vx * dtSec
        f.vy += f.gravity * dtSec
        f.rot += f.vrot * dtSec
        if (f.alpha <= 0) f.dead = true
      } else {
        f.vy += f.gravity * dtSec
        f.x += f.vx * dtSec
        f.y += f.vy * dtSec
        f.rot += f.vrot * dtSec
        if (f.y > h + 140) f.dead = true
      }
    }
    this.detached = this.detached.filter((f) => !f.dead)
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // golden aura behind the body
    if (this.golden && this.attached.length > 0) {
      const cx = this.cx
      const cy = this.cy
      const R = this.radius
      ctx.save()
      if (this.dropY !== 0) ctx.translate(0, this.dropY)
      ctx.globalCompositeOperation = 'lighter'
      const pulse = 0.5 + 0.5 * Math.sin(this.gt * 4)
      const g = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R * 1.55)
      g.addColorStop(0, 'rgba(255,210,63,0)')
      g.addColorStop(0.62, `rgba(255,210,63,${0.16 + 0.14 * pulse})`)
      g.addColorStop(1, 'rgba(255,210,63,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.55, 0, TAU)
      ctx.fill()
      ctx.fillStyle = '#fff7d6'
      for (let i = 0; i < 6; i++) {
        const a = this.gt * 1.4 + (i * TAU) / 6
        const sx = cx + Math.cos(a) * R * 1.2
        const sy = cy + Math.sin(a) * R * 1.2
        ctx.beginPath()
        ctx.arc(sx, sy, 3 + 2 * pulse, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    }
    // attached body (with sky-fall offset)
    ctx.save()
    if (this.dropY !== 0) ctx.translate(0, this.dropY)
    if (this.detached.length === 0 && this.attached.length === this.total) {
      ctx.drawImage(this.master, this.originX, this.originY)
    } else {
      for (const f of this.attached) {
        ctx.drawImage(f.canvas, this.originX + f.bx, this.originY + f.by)
      }
    }
    ctx.restore()
    // detached shards (own physics, no drop offset)
    for (const f of this.detached) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, f.alpha))
      ctx.translate(f.x, f.y)
      ctx.rotate(f.rot)
      ctx.drawImage(f.canvas, -f.bw / 2, -f.bh / 2)
      ctx.restore()
    }
  }

  /** centroids of currently attached fragments (for effects that need targets) */
  sampleAttached(n: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = []
    if (this.attached.length === 0) return out
    for (let i = 0; i < n; i++) {
      const f = this.attached[Math.floor(Math.random() * this.attached.length)]
      out.push({ x: this.originX + f.cxLocal, y: this.originY + f.cyLocal })
    }
    return out
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

function insideArt(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): boolean {
  const px = Math.max(0, Math.min(w - 1, Math.round(x)))
  const py = Math.max(0, Math.min(h - 1, Math.round(y)))
  return data[(py * w + px) * 4 + 3] > 24
}
