import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest'
import { clamp, lerp } from './math'
import { Rng } from './rng'
import { GameLoop } from './loop'
import { TargetManager } from '../targets/manager'
import type { Target } from '../targets/target'
import { Breakable } from '../targets/breakable'
import type { DamageRequest, DamageResult } from '../combat/damage'

beforeAll(() => {
  vi.stubGlobal('document', {
    hidden: false,
    addEventListener() {},
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`)
      const context = {
        save() {},
        restore() {},
        translate() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        clip() {},
        drawImage() {},
        stroke() {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4)
          for (let i = 3; i < data.length; i += 4) data[i] = 255
          return { data }
        },
      }
      return {
        width: 0,
        height: 0,
        getContext: () => context,
      }
    },
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

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

function makeBreakable(fragments: number, seed = 17): Breakable {
  const target = new Breakable({
    name: 'test',
    spriteW: 100,
    spriteH: 100,
    fragments,
    seed,
    draw: () => {},
  })
  target.reposition(200, 200)
  return target
}

function damageRequest(target: Breakable, overrides: Partial<DamageRequest> = {}): DamageRequest {
  return {
    pattern: { kind: 'circle', x: target.cx, y: target.cy, radius: 200 },
    minRatio: 0.25,
    maxRatio: 0.5,
    force: 50,
    mode: 'fall',
    seed: 99,
    finish: false,
    ...overrides,
  }
}

describe('Breakable damage', () => {
  it('produces the same damage sequence for the same seed', () => {
    const a = makeBreakable(24)
    const b = makeBreakable(24)

    expect(a.applyDamage(damageRequest(a))).toEqual(b.applyDamage(damageRequest(b)))

    const nextA = damageRequest(a, {
      pattern: { kind: 'line', x1: a.cx, y1: a.cy - 60, x2: a.cx, y2: a.cy + 60, width: 12 },
      minRatio: 0.05,
      maxRatio: 0.5,
      seed: 1234,
    })
    const nextB = damageRequest(b, {
      pattern: { kind: 'line', x1: b.cx, y1: b.cy - 60, x2: b.cx, y2: b.cy + 60, width: 12 },
      minRatio: 0.05,
      maxRatio: 0.5,
      seed: 1234,
    })
    expect(a.applyDamage(nextA)).toEqual(b.applyDamage(nextB))
  })

  it('detaches at least one fragment even when the pattern misses', () => {
    const target = makeBreakable(1)
    const result = target.applyDamage(
      damageRequest(target, {
        pattern: { kind: 'circle', x: -1000, y: -1000, radius: 1 },
        minRatio: 0.01,
        maxRatio: 0.01,
      })
    )

    expect(result.detached).toBe(1)
    expect(result.remaining).toBe(0)
  })

  it('never exceeds the maximum initial-fragment budget', () => {
    const target = makeBreakable(20)
    const result = target.applyDamage(damageRequest(target, { minRatio: 0.35, maxRatio: 0.5 }))

    expect(result.detached).toBeGreaterThanOrEqual(7)
    expect(result.detached).toBeLessThanOrEqual(10)
    expect(result.initial).toBe(20)
    expect(result.before - result.detached).toBe(result.remaining)
  })

  it('selects fragments with ellipse and line patterns', () => {
    const ellipseTarget = makeBreakable(40)
    const ellipse = ellipseTarget.applyDamage(
      damageRequest(ellipseTarget, {
        pattern: {
          kind: 'ellipse',
          x: ellipseTarget.cx,
          y: ellipseTarget.cy,
          rx: 48,
          ry: 18,
          rotation: Math.PI / 6,
        },
        minRatio: 0.025,
        maxRatio: 1,
      })
    )

    const lineTarget = makeBreakable(40)
    const line = lineTarget.applyDamage(
      damageRequest(lineTarget, {
        pattern: {
          kind: 'line',
          x1: lineTarget.cx - 60,
          y1: lineTarget.cy,
          x2: lineTarget.cx + 60,
          y2: lineTarget.cy,
          width: 14,
        },
        minRatio: 0.025,
        maxRatio: 1,
      })
    )

    expect(ellipse.detached).toBeGreaterThan(1)
    expect(ellipse.detached).toBeLessThan(ellipse.initial)
    expect(line.detached).toBeGreaterThan(1)
    expect(line.detached).toBeLessThan(line.initial)
  })

  it('detaches every remaining fragment when finish is requested', () => {
    const target = makeBreakable(20)
    target.applyDamage(damageRequest(target, { minRatio: 0.25, maxRatio: 0.25 }))
    const before = target.attachedCount

    const result = target.applyDamage(damageRequest(target, { finish: true }))

    expect(result).toEqual({
      detached: before,
      before,
      remaining: 0,
      initial: 20,
      destroyed: true,
    })
    expect(target.attachedCount).toBe(0)
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
  initialFragmentCount = 1
  private alive = true
  destroyAllCalled = 0
  constructor(public id: number) {}
  update(): void {}
  draw(): void {}
  applyDamage(): DamageResult {
    const remaining = this.attachedCount
    return { detached: 0, before: remaining, remaining, initial: 1, destroyed: this.isDestroyed }
  }
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
  dropIn(): void {}
  isGolden = false
  setGolden(): void {}
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
