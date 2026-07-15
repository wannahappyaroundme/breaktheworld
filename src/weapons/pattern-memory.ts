import type { DamagePattern } from '../combat/damage'
import { Rng } from '../engine/rng'

export interface PatternFrame {
  x: number
  y: number
  radius: number
}

export interface PatternCopyContext {
  x: number
  y: number
  targetX: number
  targetY: number
  targetRadius: number
  seed: number
}

type NormalizedPattern =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number; rotation: number }
  | { kind: 'multi'; points: { x: number; y: number }[]; radius: number }

function normalizedPoint(x: number, y: number, frame: PatternFrame) {
  const radius = Math.max(1, frame.radius)
  return { x: (x - frame.x) / radius, y: (y - frame.y) / radius }
}

function rotatePoint(point: { x: number; y: number }, angle: number) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  }
}

function restoredPoint(
  point: { x: number; y: number },
  context: PatternCopyContext,
  angle: number
) {
  const rotated = rotatePoint(point, angle)
  return {
    x: context.targetX + rotated.x * context.targetRadius,
    y: context.targetY + rotated.y * context.targetRadius,
  }
}

/** Stores one normalized successful elemental pattern, so memory is always bounded. */
export class ElementalPatternMemory {
  private pattern: NormalizedPattern | null = null

  remember(pattern: DamagePattern, frame: PatternFrame): void {
    const radius = Math.max(1, frame.radius)
    switch (pattern.kind) {
      case 'circle': {
        const center = normalizedPoint(pattern.x, pattern.y, frame)
        this.pattern = { kind: 'circle', ...center, radius: pattern.radius / radius }
        return
      }
      case 'line': {
        const start = normalizedPoint(pattern.x1, pattern.y1, frame)
        const end = normalizedPoint(pattern.x2, pattern.y2, frame)
        this.pattern = {
          kind: 'line',
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          width: pattern.width / radius,
        }
        return
      }
      case 'ellipse': {
        const center = normalizedPoint(pattern.x, pattern.y, frame)
        this.pattern = {
          kind: 'ellipse',
          ...center,
          rx: pattern.rx / radius,
          ry: pattern.ry / radius,
          rotation: pattern.rotation,
        }
        return
      }
      case 'multi':
        this.pattern = {
          kind: 'multi',
          points: pattern.points.map((point) => normalizedPoint(point.x, point.y, frame)),
          radius: pattern.radius / radius,
        }
    }
  }

  copy(context: PatternCopyContext): DamagePattern {
    if (!this.pattern) {
      return {
        kind: 'circle',
        x: context.x,
        y: context.y,
        radius: context.targetRadius * 0.58,
      }
    }

    const angle = new Rng(context.seed ^ 0xc0ffee).spread(0.14)
    switch (this.pattern.kind) {
      case 'circle': {
        const center = restoredPoint(this.pattern, context, angle)
        return {
          kind: 'circle',
          ...center,
          radius: this.pattern.radius * context.targetRadius,
        }
      }
      case 'line': {
        const start = restoredPoint({ x: this.pattern.x1, y: this.pattern.y1 }, context, angle)
        const end = restoredPoint({ x: this.pattern.x2, y: this.pattern.y2 }, context, angle)
        return {
          kind: 'line',
          x1: start.x,
          y1: start.y,
          x2: end.x,
          y2: end.y,
          width: this.pattern.width * context.targetRadius,
        }
      }
      case 'ellipse': {
        const center = restoredPoint(this.pattern, context, angle)
        return {
          kind: 'ellipse',
          ...center,
          rx: this.pattern.rx * context.targetRadius,
          ry: this.pattern.ry * context.targetRadius,
          rotation: this.pattern.rotation + angle,
        }
      }
      case 'multi':
        return {
          kind: 'multi',
          points: this.pattern.points.map((point) => restoredPoint(point, context, angle)),
          radius: this.pattern.radius * context.targetRadius,
        }
    }
  }
}

export const elementalPatternMemory = new ElementalPatternMemory()

export function rememberElementalPattern(pattern: DamagePattern, frame: PatternFrame): void {
  elementalPatternMemory.remember(pattern, frame)
}

export function copyLastElementalPattern(context: PatternCopyContext): DamagePattern {
  return elementalPatternMemory.copy(context)
}
