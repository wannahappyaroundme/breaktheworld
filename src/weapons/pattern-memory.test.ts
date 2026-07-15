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
  ])('normalizes and recalls a %s pattern around the current tap', (kind, pattern) => {
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

  it.each<[string, DamagePattern]>([
    ['circle', { kind: 'circle', x: 70, y: 80, radius: 25 }],
    ['line', { kind: 'line', x1: 30, y1: 45, x2: 90, y2: 85, width: 12 }],
    ['ellipse', { kind: 'ellipse', x: 65, y: 75, rx: 35, ry: 20, rotation: 0.25 }],
    ['multi', { kind: 'multi', points: [{ x: 35, y: 50 }, { x: 80, y: 90 }], radius: 10 }],
  ])('translates every recalled %s locus by the current tap delta', (_kind, pattern) => {
    const memory = new ElementalPatternMemory()
    memory.remember(pattern, { x: 50, y: 60, radius: 100 })
    const base = memory.copy({
      x: 50,
      y: 60,
      targetX: 195,
      targetY: 400,
      targetRadius: 100,
      seed: 91,
    })
    const moved = memory.copy({
      x: 300,
      y: 600,
      targetX: 195,
      targetY: 400,
      targetRadius: 100,
      seed: 91,
    })

    const loci = (value: DamagePattern) => {
      switch (value.kind) {
        case 'circle':
        case 'ellipse':
          return [{ x: value.x, y: value.y }]
        case 'line':
          return [{ x: value.x1, y: value.y1 }, { x: value.x2, y: value.y2 }]
        case 'multi':
          return value.points
      }
    }
    const before = loci(base)
    const after = loci(moved)
    expect(after).toHaveLength(before.length)
    for (let index = 0; index < before.length; index++) {
      expect(after[index].x - before[index].x).toBeCloseTo(250)
      expect(after[index].y - before[index].y).toBeCloseTo(540)
    }
    if (base.kind === 'circle' && moved.kind === 'circle') {
      expect(moved.radius).toBeCloseTo(base.radius)
    } else if (base.kind === 'line' && moved.kind === 'line') {
      expect(moved.width).toBeCloseTo(base.width)
      expect(moved.x2 - moved.x1).toBeCloseTo(base.x2 - base.x1)
      expect(moved.y2 - moved.y1).toBeCloseTo(base.y2 - base.y1)
    } else if (base.kind === 'ellipse' && moved.kind === 'ellipse') {
      expect(moved.rx).toBeCloseTo(base.rx)
      expect(moved.ry).toBeCloseTo(base.ry)
      expect(moved.rotation).toBeCloseTo(base.rotation)
    } else if (base.kind === 'multi' && moved.kind === 'multi') {
      expect(moved.radius).toBeCloseTo(base.radius)
    }
  })
})
