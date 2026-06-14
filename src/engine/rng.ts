import { TAU } from './math'

/** Deterministic, seedable PRNG (mulberry32). */
export class Rng {
  private s: number

  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0
  }

  /** float in [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** float in [lo,hi) */
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo)
  }

  /** int in [lo,hi] inclusive */
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1))
  }

  /** -spread..+spread */
  spread(spread: number): number {
    return this.range(-spread, spread)
  }

  bool(p = 0.5): boolean {
    return this.next() < p
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }

  angle(): number {
    return this.next() * TAU
  }
}

/** Shared non-deterministic instance for in-game randomness. */
export const rng = new Rng((Math.random() * 0xffffffff) >>> 0)
