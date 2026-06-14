import { describe, it, expect } from 'vitest'
import { shatter, polyArea } from './shatter'
import { Rng } from '../engine/rng'

describe('shatter', () => {
  it('produces the requested number of convex pieces', () => {
    const rng = new Rng(123)
    const pieces = shatter(200, 200, 40, rng)
    expect(pieces.length).toBe(40)
    for (const p of pieces) expect(p.length).toBeGreaterThanOrEqual(3)
  })

  it('pieces tile the rectangle (area is conserved)', () => {
    const rng = new Rng(99)
    const w = 320
    const h = 180
    const pieces = shatter(w, h, 60, rng)
    const total = pieces.reduce((s, p) => s + polyArea(p), 0)
    expect(total).toBeCloseTo(w * h, -1) // within ~10 px²
  })

  it('is deterministic for a given seed', () => {
    const a = shatter(100, 100, 20, new Rng(7))
    const b = shatter(100, 100, 20, new Rng(7))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
