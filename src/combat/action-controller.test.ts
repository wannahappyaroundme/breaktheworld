import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Audio } from '../engine/audio'
import { Camera } from '../engine/camera'
import { Particles } from '../engine/particles'
import { Effects } from '../effects/manager'
import { Breakable } from '../targets/breakable'
import type { World, Weapon } from '../weapons/weapon'
import type { DamageRequest } from './damage'
import { ActionController, type CancelReason } from './action-controller'
import { ChargeVisual, type ChargeDrawState } from './charge-visual'

const createElement = vi.fn((tag: string) => {
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
  return { width: 0, height: 0, getContext: () => context }
})

beforeAll(() => {
  vi.stubGlobal('document', { createElement })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

function makeTarget(): Breakable {
  const target = new Breakable({
    name: 'controller-test',
    spriteW: 100,
    spriteH: 100,
    fragments: 20,
    seed: 17,
    draw: () => {},
  })
  target.reposition(200, 200)
  return target
}

function damageRequest(target: Breakable): Omit<DamageRequest, 'seed'> {
  return {
    pattern: { kind: 'circle', x: target.cx, y: target.cy, radius: 200 },
    minRatio: 0.25,
    maxRatio: 0.25,
    force: 50,
    mode: 'fall',
    finish: false,
  }
}

function makeWorld(target: Breakable): World {
  return {
    target,
    particles: new Particles(20),
    effects: new Effects(),
    camera: new Camera(),
    audio: new Audio(),
    w: 390,
    h: 844,
  }
}

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'test-weapon',
    name: '테스트 무기',
    icon: '🔨',
    mode: 'point',
    apply: vi.fn(),
    ...overrides,
  }
}

function harness() {
  let target = makeTarget()
  let targetRunId = 7
  let now = 1_000
  let seed = 99
  const settled = vi.fn()
  const warn = vi.fn()
  const controller = new ActionController({
    getTarget: () => target,
    getTargetRunId: () => targetRunId,
    now: () => now,
    nextSeed: () => seed,
    onSettled: settled,
    warn,
  })

  return {
    controller,
    settled,
    warn,
    get target() {
      return target
    },
    set target(next: Breakable) {
      target = next
    },
    get targetRunId() {
      return targetRunId
    },
    set targetRunId(next: number) {
      targetRunId = next
    },
    get now() {
      return now
    },
    set now(next: number) {
      now = next
    },
    set seed(next: number) {
      seed = next
    },
  }
}

describe('ActionController damage guard', () => {
  it('returns null when the target run changes before damage', () => {
    const h = harness()
    const weapon = makeWeapon()
    const applyDamage = vi.spyOn(h.target, 'applyDamage')
    const action = h.controller.start({
      weapon,
      targetRunId: h.targetRunId,
      x: 10,
      y: 20,
      seed: 99,
    })

    h.targetRunId = 8

    expect(action.damage(damageRequest(h.target))).toBeNull()
    expect(applyDamage).not.toHaveBeenCalled()
  })

  it('returns null when a newer action supersedes the action id', () => {
    const h = harness()
    const weapon = makeWeapon()
    const first = h.controller.start({ weapon, targetRunId: 7, x: 10, y: 20, seed: 1 })
    const second = h.controller.start({ weapon, targetRunId: 7, x: 30, y: 40, seed: 2 })

    expect(first.damage(damageRequest(h.target))).toBeNull()
    expect(second.damage(damageRequest(h.target))).toMatchObject({ detached: 5 })
  })

  it.each<CancelReason>([
    'next',
    'reset',
    'visibility',
    'weaponChange',
    'targetDestroyed',
  ])('invalidates checked damage when cancelled for %s', (reason) => {
    const h = harness()
    const action = h.controller.start({
      weapon: makeWeapon(),
      targetRunId: 7,
      x: 10,
      y: 20,
      seed: 99,
    })

    h.controller.cancel(reason)

    expect(action.damage(damageRequest(h.target))).toBeNull()
  })
})

describe('ActionController gesture settlement', () => {
  it('settles a tap once and ignores a duplicate release', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    expect(h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)).toBeNull()
    expect(h.controller.handle({ type: 'tap', id: 1, x: 11, y: 21 }, weapon, world)).toMatchObject({
      kind: 'quick',
      weaponId: weapon.id,
    })
    expect(h.controller.handle({ type: 'tap', id: 1, x: 11, y: 21 }, weapon, world)).toBeNull()
    expect(weapon.apply).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(1)
  })

  it('runs only one cinematic until the controller leaves cinematic recovery', () => {
    const h = harness()
    const weapon = makeWeapon({ mode: 'cinematic' })
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'press', id: 2, x: 30, y: 40 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 2, x: 30, y: 40 }, weapon, world)

    expect(weapon.apply).toHaveBeenCalledTimes(1)

    h.now += 1_401
    h.controller.update(h.now)
    h.controller.handle({ type: 'press', id: 3, x: 50, y: 60 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 3, x: 50, y: 60 }, weapon, world)

    expect(weapon.apply).toHaveBeenCalledTimes(2)
  })

  it('keeps combo grace while pressed and charging, then for 200ms after release', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    expect(h.controller.comboGraceUntil).toBe(Number.POSITIVE_INFINITY)

    h.now = 1_450
    h.controller.handle({ type: 'chargeStart', id: 1, x: 10, y: 20 }, weapon, world)
    expect(h.controller.comboGraceUntil).toBe(Number.POSITIVE_INFINITY)

    h.now = 1_700
    h.controller.handle(
      { type: 'chargeRelease', id: 1, x: 10, y: 20, charge: 0.5 },
      weapon,
      world
    )
    expect(h.controller.comboGraceUntil).toBe(1_900)
    expect(h.controller.hasComboGrace(1_899)).toBe(true)
    expect(h.controller.hasComboGrace(1_901)).toBe(false)
  })

  it('settles a secondary tap without cancelling the primary charge', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'chargeStart', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'press', id: 2, x: 30, y: 40 }, weapon, world)
    expect(h.controller.handle({ type: 'tap', id: 2, x: 30, y: 40 }, weapon, world)).toMatchObject({
      kind: 'quick',
    })
    expect(h.controller.state).toBe('charging')
    expect(h.controller.comboGraceUntil).toBe(Number.POSITIVE_INFINITY)

    expect(h.controller.handle(
      { type: 'chargeRelease', id: 1, x: 10, y: 20, charge: 0.5 },
      weapon,
      world
    )).toMatchObject({ kind: 'charged' })
    expect(weapon.apply).toHaveBeenCalledTimes(2)
  })

  it('rejects a superseded secondary tap without disturbing the fresh primary action', () => {
    const h = harness()
    const supersededWeapon = makeWeapon({ id: 'superseded' })
    const freshWeapon = makeWeapon({ id: 'fresh' })
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, supersededWeapon, world)
    h.controller.handle({ type: 'press', id: 2, x: 30, y: 40 }, supersededWeapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, supersededWeapon, world)
    expect(supersededWeapon.apply).toHaveBeenCalledTimes(1)

    h.controller.handle({ type: 'press', id: 3, x: 50, y: 60 }, freshWeapon, world)

    expect(
      h.controller.handle({ type: 'tap', id: 2, x: 30, y: 40 }, freshWeapon, world)
    ).toBeNull()
    expect(supersededWeapon.apply).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(1)
    expect(h.warn).not.toHaveBeenCalled()
    expect(h.controller.state).toBe('pressed')

    expect(
      h.controller.handle({ type: 'tap', id: 3, x: 50, y: 60 }, freshWeapon, world)
    ).toMatchObject({ kind: 'quick', weaponId: 'fresh' })
    expect(freshWeapon.apply).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(2)
  })

  it('invokes the legacy bridge only for settled tap, drag, and charged release', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'cancel', id: 1 }, weapon, world)
    expect(weapon.apply).not.toHaveBeenCalled()

    h.controller.handle({ type: 'press', id: 2, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 2, x: 10, y: 20 }, weapon, world)

    h.controller.handle({ type: 'press', id: 3, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'dragStart', id: 3, x: 30, y: 20 }, weapon, world)
    h.controller.handle({ type: 'cancel', id: 3 }, weapon, world)

    h.controller.handle({ type: 'press', id: 4, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'chargeStart', id: 4, x: 10, y: 20 }, weapon, world)
    h.controller.handle(
      { type: 'chargeRelease', id: 4, x: 10, y: 20, charge: 0.75 },
      weapon,
      world
    )

    expect(weapon.apply).toHaveBeenCalledTimes(3)
  })

  it('prefers the matching action handler over the legacy bridge', () => {
    const h = harness()
    const quick = vi.fn()
    const weapon = makeWeapon({ quick })
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 11, y: 21 }, weapon, world)

    expect(quick).toHaveBeenCalledWith(
      world,
      expect.objectContaining({ x: 11, y: 21, charge: 0, seed: 99 })
    )
    expect(weapon.apply).not.toHaveBeenCalled()
  })

  it('settles safely and emits one development warning when no handler exists', () => {
    const h = harness()
    const weapon = makeWeapon({ apply: undefined })
    const world = makeWorld(h.target)

    for (const id of [1, 2]) {
      h.controller.handle({ type: 'press', id, x: 10, y: 20 }, weapon, world)
      expect(h.controller.handle({ type: 'tap', id, x: 10, y: 20 }, weapon, world)).toMatchObject({
        kind: 'quick',
      })
    }

    expect(h.warn).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(2)
  })
})

describe('ChargeVisual', () => {
  it('draws one 3px accent ring and a max-charge tick without DOM allocation', () => {
    createElement.mockClear()
    const arcs: number[] = []
    const strokes: number[] = []
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: (_x: number, _y: number, radius: number) => arcs.push(radius),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: () => strokes.push(1),
      lineWidth: 0,
      strokeStyle: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D
    const state: ChargeDrawState = {
      x: 100,
      y: 120,
      charge: 1,
      color: '#ff4d6d',
      maxed: true,
      nowMs: 1_000,
    }

    new ChargeVisual(false).draw(ctx, state)

    expect(arcs).toHaveLength(1)
    expect(strokes).toHaveLength(2)
    expect(ctx.lineWidth).toBe(3)
    expect(ctx.strokeStyle).toBe('#ff4d6d')
    expect(createElement).not.toHaveBeenCalled()
  })

  it('disables pulsing and target scaling when reduced motion is enabled', () => {
    const radii: number[] = []
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      arc(_x: number, _y: number, radius: number) {
        radii.push(radius)
      },
      moveTo() {},
      lineTo() {},
      stroke() {},
      lineWidth: 0,
      strokeStyle: '',
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D
    const state: ChargeDrawState = {
      x: 100,
      y: 120,
      charge: 0.5,
      color: '#ffd23f',
      maxed: false,
      nowMs: 0,
    }
    const reduced = new ChargeVisual(true)

    reduced.draw(ctx, state)
    state.nowMs = 300
    reduced.draw(ctx, state)

    expect(radii[0]).toBe(radii[1])
    expect(reduced.targetScale(state)).toBe(1)
    expect(new ChargeVisual(false).targetScale(state)).toBeGreaterThan(1)
  })
})
