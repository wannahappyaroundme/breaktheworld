import { describe, expect, it } from 'vitest'
import { matchesPattern, damageBudget } from './damage'

describe('damage patterns', () => {
  it('matches circles, lines, ellipses, and multi-point clusters', () => {
    expect(matchesPattern({ x: 5, y: 0 }, { kind: 'circle', x: 0, y: 0, radius: 6 })).toBe(true)
    expect(matchesPattern({ x: 5, y: 3 }, { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, width: 4 })).toBe(false)
    expect(matchesPattern({ x: 7, y: 2 }, { kind: 'ellipse', x: 0, y: 0, rx: 10, ry: 3, rotation: 0 })).toBe(true)
    expect(matchesPattern({ x: 20, y: 20 }, { kind: 'multi', points: [{ x: 20, y: 20 }], radius: 2 })).toBe(true)
  })

  it('uses the initial fragment count and always returns a usable budget', () => {
    expect(damageBudget(40, 40, 0.35, 0.5)).toEqual({ min: 14, max: 20 })
    expect(damageBudget(1, 1, 0.35, 0.5)).toEqual({ min: 1, max: 1 })
  })
})
