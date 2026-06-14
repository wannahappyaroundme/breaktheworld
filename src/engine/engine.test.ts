import { describe, it, expect, vi } from 'vitest'
import { clamp, lerp } from './math'
import { Rng } from './rng'
import { GameLoop } from './loop'
import { TargetManager } from '../targets/manager'
import type { Target } from '../targets/target'

describe('math', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-1, 0, 3)).toBe(0)
    expect(clamp(2, 0, 3)).toBe(2)
  })
  it('lerps', () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
  })
})

describe('Rng', () => {
  it('is deterministic and in range', () => {
    const a = new Rng(42)
    const b = new Rng(42)
    for (let i = 0; i < 100; i++) {
      const v = a.next()
      expect(v).toBe(b.next())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
  it('int respects inclusive bounds', () => {
    const r = new Rng(1)
    for (let i = 0; i < 200; i++) {
      const v = r.int(2, 5)
      expect(v).toBeGreaterThanOrEqual(2)
      expect(v).toBeLessThanOrEqual(5)
    }
  })
})

describe('GameLoop', () => {
  it('clamps dt to maxDt and calls tick', () => {
    const tick = vi.fn()
    const loop = new GameLoop(tick, 50)
    loop.step(1000) // dt = 1000 -> clamped to 50
    loop.step(2000) // dt = 1000 -> clamped to 50
    expect(tick).toHaveBeenCalledTimes(2)
    expect(tick.mock.calls[0][0]).toBe(50)
    expect(tick.mock.calls[1][0]).toBe(50)
  })
})

// DOM-free stub target for manager logic
class StubTarget implements Target {
  name = 'stub'
  cx = 0
  cy = 0
  radius = 10
  private alive = true
  destroyAllCalled = 0
  constructor(public id: number) {}
  update(): void {}
  draw(): void {}
  takeDamage(): number {
    return 0
  }
  detachAll(): number {
    this.destroyAllCalled++
    return 0
  }
  detachFraction(): number {
    return 0
  }
  reposition(): void {}
  get attachedCount() {
    return this.alive ? 1 : 0
  }
  get isDestroyed() {
    return !this.alive
  }
  kill() {
    this.alive = false
  }
}

describe('TargetManager', () => {
  it('cycles to the next target after destruction + delay', () => {
    const made: StubTarget[] = []
    let n = 0
    const mgr = new TargetManager(
      {
        factories: [() => mk(), () => mk(), () => mk()],
        swapDelaySec: 0.5,
      },
      100,
      100
    )
    function mk() {
      const t = new StubTarget(n++)
      made.push(t)
      return t
    }
    const first = mgr.current as StubTarget
    first.kill()
    mgr.update(0.1, 100, 100) // detects destroyed, starts swap
    expect(first.destroyAllCalled).toBe(1)
    expect(mgr.current).toBe(first) // still swapping
    mgr.update(0.5, 100, 100) // timer elapses -> advance
    expect(mgr.current).not.toBe(first)
    expect(mgr.swapIndex).toBe(1)
  })
})
