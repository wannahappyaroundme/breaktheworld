export interface Vec2 {
  x: number
  y: number
}

export const TAU = Math.PI * 2

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

export function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax)
}

/** Smoothstep easing in [0,1]. */
export function smoothstep(t: number): number {
  t = clamp(t, 0, 1)
  return t * t * (3 - 2 * t)
}

export function easeOutCubic(t: number): number {
  const p = 1 - clamp(t, 0, 1)
  return 1 - p * p * p
}

export function easeInCubic(t: number): number {
  t = clamp(t, 0, 1)
  return t * t * t
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  const p = clamp(t, 0, 1) - 1
  return 1 + c3 * p * p * p + c1 * p * p
}
