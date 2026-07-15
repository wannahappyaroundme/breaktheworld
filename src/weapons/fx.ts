import type { Particles } from '../engine/particles'

/** Shared particle bursts used to garnish weapon impacts. */

/** Keeps charged particle accents proportional without overrunning the pool. */
export function scaledCount(base: number, scale: number, max = 64): number {
  return Math.min(max, Math.max(1, Math.round(base * scale)))
}

export function debris(p: Particles, x: number, y: number, n: number, colors: string[]): void {
  p.burst(x, y, n, 'shard', {
    speed: [120, 460],
    life: [0.5, 1.1],
    size: [3, 7],
    colors,
    gravity: 1400,
    drag: 0.5,
  })
}

export function sparks(p: Particles, x: number, y: number, n: number, colors: string[]): void {
  p.burst(x, y, n, 'spark', { speed: [120, 520], life: [0.2, 0.6], size: [1, 3], colors, drag: 2 })
}

export function smoke(p: Particles, x: number, y: number, n: number): void {
  p.burst(x, y, n, 'smoke', {
    speed: [10, 70],
    life: [0.6, 1.5],
    size: [14, 32],
    colors: ['#cfcfcf', '#b6b6b6', '#9aa0a8'],
    gravity: -30,
    drag: 1,
  })
}

export function dust(p: Particles, x: number, y: number, n: number): void {
  p.burst(x, y, n, 'dust', {
    speed: [20, 130],
    life: [0.5, 1.2],
    size: [6, 14],
    colors: ['#c9a877', '#b9956a', '#d8c3a0'],
    gravity: -20,
    drag: 1.4,
  })
}

export function fireBits(p: Particles, x: number, y: number, n: number): void {
  p.burst(x, y, n, 'fire', {
    speed: [60, 320],
    life: [0.3, 0.8],
    size: [3, 8],
    colors: ['#ffd23f', '#ff7a2f', '#ff4d2f'],
    gravity: -60,
    drag: 1,
  })
}

export function glassBits(p: Particles, x: number, y: number, n: number): void {
  p.burst(x, y, n, 'glass', {
    speed: [150, 540],
    life: [0.5, 1.0],
    size: [3, 7],
    colors: ['#dff3ff', '#bfe6ff', '#ffffff'],
    gravity: 1500,
    drag: 0.5,
  })
}

export function ash(p: Particles, x: number, y: number, n: number): void {
  p.burst(x, y, n, 'ash', {
    speed: [10, 90],
    life: [0.9, 2.0],
    size: [3, 6],
    colors: ['#6b6b6b', '#4d4d4d', '#2e2e2e'],
    gravity: -10,
    drag: 1.2,
  })
}

export function confetti(p: Particles, x: number, y: number, n: number): void {
  p.burst(x, y, n, 'shard', {
    speed: [120, 420],
    life: [0.8, 1.6],
    size: [3, 6],
    colors: ['#ff5a8a', '#ffd23f', '#4aa6e0', '#7cc95a', '#b06bff'],
    gravity: 900,
    drag: 0.4,
  })
}
