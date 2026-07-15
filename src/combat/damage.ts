import { clamp } from '../engine/math'

export type DamagePattern =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number; rotation: number }
  | { kind: 'multi'; points: { x: number; y: number }[]; radius: number }

export interface DamageRequest {
  pattern: DamagePattern
  minRatio: number
  maxRatio: number
  force: number
  mode: 'fall' | 'dissolve' | 'squash'
  seed: number
  finish: boolean
}

export interface DamageResult {
  detached: number
  before: number
  remaining: number
  initial: number
  destroyed: boolean
}

interface Point {
  x: number
  y: number
}

export function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y)

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
  const t = clamp(projection, 0, 1)
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy))
}

export function matchesPattern(point: Point, pattern: DamagePattern): boolean {
  if (pattern.kind === 'circle') {
    return Math.hypot(point.x - pattern.x, point.y - pattern.y) <= pattern.radius
  }

  if (pattern.kind === 'line') {
    return (
      pointToSegmentDistance(
        point,
        { x: pattern.x1, y: pattern.y1 },
        { x: pattern.x2, y: pattern.y2 }
      ) <=
      pattern.width / 2
    )
  }

  if (pattern.kind === 'ellipse') {
    const dx = point.x - pattern.x
    const dy = point.y - pattern.y
    const cos = Math.cos(pattern.rotation)
    const sin = Math.sin(pattern.rotation)
    const x = dx * cos + dy * sin
    const y = -dx * sin + dy * cos
    return (x * x) / (pattern.rx * pattern.rx) + (y * y) / (pattern.ry * pattern.ry) <= 1
  }

  return pattern.points.some((center) => Math.hypot(point.x - center.x, point.y - center.y) <= pattern.radius)
}

export function damageBudget(initial: number, remaining: number, minRatio: number, maxRatio: number) {
  const min = clamp(Math.round(initial * minRatio), 1, remaining)
  const max = clamp(Math.round(initial * maxRatio), min, remaining)
  return { min, max }
}
