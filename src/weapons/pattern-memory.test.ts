import { describe, expect, it } from 'vitest'
import type { DamagePattern } from '../combat/damage'
import { ElementalPatternMemory } from './pattern-memory'

const source = { x: 100, y: 200, radius: 50 }
const destination = {
  x: 330,
  y: 440,
  targetX: 350,
  targetY: 460,
  targetRadius: 100,
  w: 390,
  h: 844,
  seed: 77,
}

describe('ElementalPatternMemory', () => {
  it('falls back to a hammer-like circle when no elemental hit succeeded', () => {
    const memory = new ElementalPatternMemory()

    const fallback = memory.copy(destination)
    expect(fallback).toMatchObject({
      kind: 'circle',
      x: destination.x,
      y: destination.y,
    })
    expect(fallback.kind === 'circle' ? fallback.radius : 0).toBeCloseTo(58)
  })

  it.each<[string, DamagePattern]>([
    ['circle', { kind: 'circle', x: 110, y: 190, radius: 25 }],
    ['line', { kind: 'line', x1: 60, y1: 180, x2: 140, y2: 220, width: 12 }],
    ['ellipse', { kind: 'ellipse', x: 105, y: 210, rx: 35, ry: 20, rotation: 0.25 }],
    ['multi', { kind: 'multi', points: [{ x: 80, y: 190 }, { x: 125, y: 215 }], radius: 10 }],
  ])('normalizes and recalls a %s pattern around the current target', (kind, pattern) => {
    const memory = new ElementalPatternMemory()
    memory.remember(pattern, source)

    const first = memory.copy(destination)
    const repeated = memory.copy(destination)
    const varied = memory.copy({ ...destination, seed: destination.seed + 1 })

    expect(first.kind).toBe(kind)
    expect(first).toEqual(repeated)
    expect(first).not.toEqual(pattern)
    expect(first).not.toEqual(varied)
  })
})
