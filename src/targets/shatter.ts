import type { Rng } from '../engine/rng'

export interface Pt {
  x: number
  y: number
}

export function polyArea(p: Pt[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length
    a += p[i].x * p[j].y - p[j].x * p[i].y
  }
  return Math.abs(a) / 2
}

export function polyCentroid(p: Pt[]): Pt {
  let x = 0
  let y = 0
  for (const v of p) {
    x += v.x
    y += v.y
  }
  return { x: x / p.length, y: y / p.length }
}

/**
 * Split a convex polygon by an infinite line defined by a point P and a
 * normal n. Returns the two halves [positive-side, negative-side].
 */
function splitByLine(poly: Pt[], px: number, py: number, nx: number, ny: number): [Pt[], Pt[]] {
  const pos: Pt[] = []
  const neg: Pt[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const da = (a.x - px) * nx + (a.y - py) * ny
    const db = (b.x - px) * nx + (b.y - py) * ny
    if (da >= 0) pos.push(a)
    else neg.push(a)
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db)
      const ix = a.x + t * (b.x - a.x)
      const iy = a.y + t * (b.y - a.y)
      pos.push({ x: ix, y: iy })
      neg.push({ x: ix, y: iy })
    }
  }
  return [pos, neg]
}

/**
 * Break a w×h rectangle into ~count convex shards by repeatedly cutting the
 * largest piece with a random line near its centroid. Pieces tile the
 * rectangle exactly (no gaps), which makes reassembly seamless.
 */
export function shatter(w: number, h: number, count: number, rng: Rng): Pt[][] {
  let polys: Pt[][] = [
    [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  ]
  let guard = 0
  const maxGuard = count * 10
  while (polys.length < count && guard < maxGuard) {
    guard++
    // pick the largest current piece
    let bi = 0
    let ba = -1
    for (let i = 0; i < polys.length; i++) {
      const a = polyArea(polys[i])
      if (a > ba) {
        ba = a
        bi = i
      }
    }
    const poly = polys[bi]
    const c = polyCentroid(poly)
    const ang = rng.angle()
    const nx = -Math.sin(ang)
    const ny = Math.cos(ang)
    const jit = Math.sqrt(ba) * 0.16
    const jx = c.x + rng.spread(jit)
    const jy = c.y + rng.spread(jit)
    const [p1, p2] = splitByLine(poly, jx, jy, nx, ny)
    if (p1.length >= 3 && p2.length >= 3 && polyArea(p1) > 6 && polyArea(p2) > 6) {
      polys.splice(bi, 1, p1, p2)
    }
  }
  return polys
}
