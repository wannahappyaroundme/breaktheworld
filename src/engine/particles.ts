import { rng } from './rng'
import { TAU } from './math'

export type ParticleKind = 'spark' | 'fire' | 'dust' | 'smoke' | 'ash' | 'shard' | 'glass'

export interface ParticleOpts {
  x: number
  y: number
  vx: number
  vy: number
  life: number // seconds
  size: number
  color: string
  kind: ParticleKind
  gravity?: number
  drag?: number
  rot?: number
  vrot?: number
}

interface Particle extends Required<ParticleOpts> {
  age: number
  active: boolean
}

/** Pooled, capped particle system. Update in seconds, draw to ctx. */
export class Particles {
  private pool: Particle[] = []
  private cap: number

  constructor(cap = 1400) {
    this.cap = cap
  }

  get count(): number {
    let n = 0
    for (const p of this.pool) if (p.active) n++
    return n
  }

  spawn(o: ParticleOpts): void {
    let p = this.pool.find((q) => !q.active)
    if (!p) {
      if (this.pool.length >= this.cap) return
      p = {} as Particle
      this.pool.push(p)
    }
    p.x = o.x
    p.y = o.y
    p.vx = o.vx
    p.vy = o.vy
    p.life = o.life
    p.size = o.size
    p.color = o.color
    p.kind = o.kind
    p.gravity = o.gravity ?? 0
    p.drag = o.drag ?? 0
    p.rot = o.rot ?? 0
    p.vrot = o.vrot ?? 0
    p.age = 0
    p.active = true
  }

  /** Convenience: burst of sparks/fire from a point. */
  burst(
    x: number,
    y: number,
    count: number,
    kind: ParticleKind,
    opts: {
      speed?: [number, number]
      life?: [number, number]
      size?: [number, number]
      colors?: string[]
      gravity?: number
      drag?: number
      spread?: number // angle range (radians), default full circle
      dir?: number // base direction
    } = {}
  ): void {
    const speed = opts.speed ?? [60, 320]
    const life = opts.life ?? [0.3, 0.9]
    const size = opts.size ?? [1.5, 4]
    const colors = opts.colors ?? ['#fff']
    const spread = opts.spread ?? TAU
    const dir = opts.dir ?? 0
    for (let i = 0; i < count; i++) {
      const a = dir + rng.spread(spread / 2)
      const sp = rng.range(speed[0], speed[1])
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rng.range(life[0], life[1]),
        size: rng.range(size[0], size[1]),
        color: rng.pick(colors),
        kind,
        gravity: opts.gravity ?? 0,
        drag: opts.drag ?? 1.2,
        rot: rng.angle(),
        vrot: rng.spread(8),
      })
    }
  }

  update(dtSec: number, w: number, h: number): void {
    for (const p of this.pool) {
      if (!p.active) continue
      p.age += dtSec
      if (p.age >= p.life) {
        p.active = false
        continue
      }
      p.vy += p.gravity * dtSec
      if (p.drag) {
        const f = Math.exp(-p.drag * dtSec)
        p.vx *= f
        p.vy *= f
      }
      p.x += p.vx * dtSec
      p.y += p.vy * dtSec
      p.rot += p.vrot * dtSec
      // cull when well off screen
      if (p.y > h + 80 || p.x < -120 || p.x > w + 120) p.active = false
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    // additive pass (sparks + fire) for glow
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (const p of this.pool) {
      if (!p.active) continue
      if (p.kind !== 'spark' && p.kind !== 'fire') continue
      const t = 1 - p.age / p.life
      ctx.globalAlpha = t
      ctx.fillStyle = p.color
      const r = p.size * (p.kind === 'fire' ? 0.4 + t : 1)
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(0.4, r), 0, TAU)
      ctx.fill()
    }
    ctx.restore()

    // normal pass (smoke, dust, ash, shards, glass)
    ctx.save()
    for (const p of this.pool) {
      if (!p.active) continue
      const t = 1 - p.age / p.life
      switch (p.kind) {
        case 'smoke': {
          ctx.globalAlpha = 0.32 * t
          ctx.fillStyle = p.color
          const r = p.size * (1.6 - t)
          ctx.beginPath()
          ctx.arc(p.x, p.y, r, 0, TAU)
          ctx.fill()
          break
        }
        case 'dust': {
          ctx.globalAlpha = 0.5 * t
          ctx.fillStyle = p.color
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.size * (1.2 - 0.4 * t), 0, TAU)
          ctx.fill()
          break
        }
        case 'ash': {
          ctx.globalAlpha = 0.85 * t
          ctx.fillStyle = p.color
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7)
          ctx.restore()
          break
        }
        case 'shard':
        case 'glass': {
          ctx.globalAlpha = Math.min(1, t * 1.6)
          ctx.fillStyle = p.color
          ctx.strokeStyle = 'rgba(0,0,0,0.35)'
          ctx.lineWidth = 1
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.rot)
          const s = p.size
          ctx.beginPath()
          if (p.kind === 'glass') {
            ctx.moveTo(0, -s)
            ctx.lineTo(s * 0.7, s)
            ctx.lineTo(-s * 0.5, s * 0.6)
          } else {
            ctx.moveTo(-s, -s * 0.7)
            ctx.lineTo(s, -s)
            ctx.lineTo(s * 0.8, s)
            ctx.lineTo(-s * 0.6, s * 0.8)
          }
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
          ctx.restore()
          break
        }
      }
    }
    ctx.restore()
  }

  clear(): void {
    for (const p of this.pool) p.active = false
  }
}
