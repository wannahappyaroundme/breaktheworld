import type { Effect } from './types'
import { rgba } from './util'
import { TAU, easeOutCubic, easeInCubic, clamp } from '../engine/math'
import { rng } from '../engine/rng'

/** Expanding fireball (additive). */
export function explosion(
  x: number,
  y: number,
  maxR: number,
  o: { hot?: string; cool?: string; dur?: number } = {}
): Effect {
  const dur = o.dur ?? 0.5
  const hot = o.hot ?? '#fff4b0'
  const cool = o.cool ?? '#ff5a1f'
  let t = 0
  return {
    z: 1,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      const r = Math.max(1, maxR * easeOutCubic(p))
      const a = 1 - p
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, rgba('#ffffff', a))
      g.addColorStop(0.35, rgba(hot, a * 0.9))
      g.addColorStop(0.7, rgba(cool, a * 0.6))
      g.addColorStop(1, rgba(cool, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()
      ctx.restore()
    },
  }
}

/** Expanding ring. */
export function shockwave(
  x: number,
  y: number,
  maxR: number,
  o: { dur?: number; color?: string; width?: number } = {}
): Effect {
  const dur = o.dur ?? 0.45
  const color = o.color ?? '#ffffff'
  const width = o.width ?? 10
  let t = 0
  return {
    z: 1,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      const r = maxR * easeOutCubic(p)
      const a = (1 - p) * 0.85
      ctx.save()
      ctx.strokeStyle = rgba(color, a)
      ctx.lineWidth = Math.max(1, width * (1 - p))
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.stroke()
      ctx.restore()
    },
  }
}

interface Branch {
  pts: { x: number; y: number }[]
}

/** Jagged doodle cracks radiating from a point. */
export function crack(
  x: number,
  y: number,
  o: { branches?: number; len?: number; color?: string; dur?: number; dir?: number; spread?: number } = {}
): Effect {
  const nBranches = o.branches ?? 5
  const len = o.len ?? 90
  const color = o.color ?? '#1b1822'
  const dur = o.dur ?? 0.9
  const grow = 0.18
  const dir = o.dir ?? 0
  const spread = o.spread ?? TAU
  let t = 0
  const branches: Branch[] = []
  for (let i = 0; i < nBranches; i++) {
    const a = o.spread ? dir + rng.spread(spread / 2) : (i / nBranches) * TAU + rng.spread(0.3)
    const segs = 4 + Math.floor(rng.range(0, 3))
    const pts = [{ x, y }]
    let px = x
    let py = y
    let ang = a
    const segLen = len / segs
    for (let s = 0; s < segs; s++) {
      ang += rng.spread(0.5)
      px += Math.cos(ang) * segLen
      py += Math.sin(ang) * segLen
      pts.push({ x: px, y: py })
    }
    branches.push({ pts })
  }
  return {
    z: -1,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const reveal = clamp(t / grow, 0, 1)
      const a = t < grow ? 1 : clamp(1 - (t - grow) / (dur - grow), 0, 1)
      ctx.save()
      ctx.strokeStyle = rgba(color, a)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const b of branches) {
        const n = b.pts.length
        const shown = 1 + (n - 1) * reveal
        ctx.beginPath()
        ctx.moveTo(b.pts[0].x, b.pts[0].y)
        for (let i = 1; i < shown; i++) {
          const idx = Math.min(n - 1, Math.floor(i))
          ctx.lineWidth = clamp(4 * (1 - i / n), 1, 4)
          ctx.lineTo(b.pts[idx].x, b.pts[idx].y)
        }
        ctx.stroke()
      }
      ctx.restore()
    },
  }
}

/** Energy beam from (x1,y1) to (x2,y2). */
export function beam(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: { dur?: number; width?: number; color?: string; core?: string } = {}
): Effect {
  const dur = o.dur ?? 0.35
  const width = o.width ?? 16
  const color = o.color ?? '#7fd0ff'
  const core = o.core ?? '#ffffff'
  let t = 0
  return {
    z: 1,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      const a = p < 0.18 ? p / 0.18 : 1 - (p - 0.18) / (1 - 0.18)
      const flick = 0.85 + Math.sin(t * 60) * 0.15
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      // glow
      ctx.strokeStyle = rgba(color, a * 0.5)
      ctx.lineWidth = width * 2 * flick
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      // core
      ctx.strokeStyle = rgba(core, a)
      ctx.lineWidth = width * 0.5 * flick
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.restore()
    },
  }
}

/** Flying projectile (meteor/missile). Calls onImpact once on arrival. */
export function projectile(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: { dur?: number; color?: string; headR?: number; onImpact?: () => void } = {}
): Effect {
  const dur = o.dur ?? 0.45
  const color = o.color ?? '#ffae3b'
  const headR = o.headR ?? 12
  let t = 0
  let fired = false
  return {
    z: 1,
    update(dt) {
      t += dt
      if (t >= dur) {
        if (!fired) {
          fired = true
          o.onImpact?.()
        }
        return false
      }
      return true
    },
    draw(ctx) {
      const p = easeInCubic(t / dur)
      const x = x1 + (x2 - x1) * p
      const y = y1 + (y2 - y1) * p
      const dx = x2 - x1
      const dy = y2 - y1
      const d = Math.hypot(dx, dy) || 1
      const tx = (dx / d) * 60
      const ty = (dy / d) * 60
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      // trail
      const g = ctx.createLinearGradient(x - tx, y - ty, x, y)
      g.addColorStop(0, rgba(color, 0))
      g.addColorStop(1, rgba(color, 0.9))
      ctx.strokeStyle = g
      ctx.lineWidth = headR
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x - tx, y - ty)
      ctx.lineTo(x, y)
      ctx.stroke()
      // head
      ctx.fillStyle = rgba('#ffffff', 1)
      ctx.beginPath()
      ctx.arc(x, y, headR * 0.7, 0, TAU)
      ctx.fill()
      ctx.restore()
    },
  }
}

/** Doodle speed/impact lines radiating outward (the reference look). */
export function speedLines(
  x: number,
  y: number,
  o: { count?: number; color?: string; dur?: number; r0?: number; r1?: number; dir?: number; spread?: number } = {}
): Effect {
  const count = o.count ?? 12
  const color = o.color ?? '#ffd23f'
  const dur = o.dur ?? 0.4
  const r0 = o.r0 ?? 30
  const r1 = o.r1 ?? 120
  const dir = o.dir ?? 0
  const spread = o.spread ?? TAU
  let t = 0
  const angles: number[] = []
  for (let i = 0; i < count; i++) {
    angles.push(spread >= TAU ? (i / count) * TAU + rng.spread(0.12) : dir + rng.spread(spread / 2))
  }
  return {
    z: 2,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      const a = 1 - p
      const inner = r0 + (r1 - r0) * 0.4 * p
      const outer = r0 + (r1 - r0) * (0.6 + 0.6 * p)
      ctx.save()
      ctx.strokeStyle = rgba(color, a)
      ctx.lineCap = 'round'
      for (const ang of angles) {
        ctx.lineWidth = 3 + 3 * a
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(ang) * inner, y + Math.sin(ang) * inner)
        ctx.lineTo(x + Math.cos(ang) * outer, y + Math.sin(ang) * outer)
        ctx.stroke()
      }
      ctx.restore()
    },
  }
}

/** Jagged lightning bolt from (x1,y1) to (x2,y2). */
export function lightning(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: { color?: string; dur?: number } = {}
): Effect {
  const color = o.color ?? '#bfe3ff'
  const dur = o.dur ?? 0.28
  let t = 0
  const pts: { x: number; y: number }[] = []
  const segs = 9
  for (let i = 0; i <= segs; i++) {
    const f = i / segs
    const jx = i === 0 || i === segs ? 0 : rng.spread(26)
    pts.push({ x: x1 + (x2 - x1) * f + jx, y: y1 + (y2 - y1) * f })
  }
  return {
    z: 2,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const flick = rng.range(0.5, 1)
      const a = (1 - t / dur) * flick
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = rgba(color, a * 0.5)
      ctx.lineWidth = 12
      stroke(ctx, pts)
      ctx.strokeStyle = rgba('#ffffff', a)
      ctx.lineWidth = 4
      stroke(ctx, pts)
      ctx.restore()
    },
  }
}

function stroke(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  ctx.stroke()
}

/** Collapsing black hole with a bright accretion ring. */
export function blackhole(
  x: number,
  y: number,
  maxR: number,
  o: { dur?: number } = {}
): Effect {
  const dur = o.dur ?? 1.4
  let t = 0
  return {
    z: 2,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      // grow fast, collapse at the end
      const env = p < 0.7 ? easeOutCubic(p / 0.7) : 1 - easeInCubic((p - 0.7) / 0.3)
      const r = Math.max(1, maxR * env)
      ctx.save()
      // dark core
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(0.7, 'rgba(10,6,20,0.95)')
      g.addColorStop(1, 'rgba(10,6,20,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()
      // swirling accretion ring
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = rgba('#b06bff', 0.8 * env)
      ctx.lineWidth = 4
      for (let i = 0; i < 3; i++) {
        const rr = r * (0.9 + i * 0.12)
        const off = t * (3 + i)
        ctx.beginPath()
        ctx.arc(x, y, rr, off, off + Math.PI * 1.3)
        ctx.stroke()
      }
      ctx.restore()
    },
  }
}

/** Expanding frosty ring + sparkle. */
export function frostRing(x: number, y: number, maxR: number, o: { dur?: number } = {}): Effect {
  const dur = o.dur ?? 0.5
  let t = 0
  return {
    z: 1,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      const r = maxR * easeOutCubic(p)
      const a = (1 - p) * 0.9
      ctx.save()
      ctx.strokeStyle = rgba('#cdebff', a)
      ctx.lineWidth = 6 * (1 - p) + 1
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.stroke()
      ctx.fillStyle = rgba('#eaf7ff', a * 0.3)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()
      ctx.restore()
    },
  }
}

/** Swirling tornado funnel from topY to bottomY centered on x. */
export function tornado(
  x: number,
  topY: number,
  bottomY: number,
  o: { dur?: number; color?: string } = {}
): Effect {
  const dur = o.dur ?? 1.1
  const color = o.color ?? '#9fb4c9'
  let t = 0
  return {
    z: 2,
    update(dt) {
      t += dt
      return t < dur
    },
    draw(ctx) {
      const p = t / dur
      const a = (p < 0.2 ? p / 0.2 : 1 - (p - 0.2) / 0.8) * 0.85
      ctx.save()
      ctx.globalAlpha = a
      const layers = 9
      for (let i = 0; i < layers; i++) {
        const f = i / (layers - 1)
        const yy = topY + (bottomY - topY) * f
        const rad = 14 + f * 70
        const sway = Math.sin(t * 10 + f * 6) * (10 + f * 18)
        ctx.fillStyle = i % 2 ? color : '#c2d2e0'
        ctx.beginPath()
        ctx.ellipse(x + sway, yy, rad, rad * 0.32, 0, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    },
  }
}
