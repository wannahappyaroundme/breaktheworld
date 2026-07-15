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
    quick: vi.fn(),
    drag: vi.fn(),
    charged: vi.fn(),
    ...overrides,
  }
}

function harness(strongInput: 'hold' | 'doubleTap' = 'hold') {
  let target = makeTarget()
  let targetRunId = 7
  let now = 1_000
  let seed = 99
  const settled = vi.fn()
  const damaged = vi.fn()
  const controller = new ActionController({
    getTarget: () => target,
    getTargetRunId: () => targetRunId,
    now: () => now,
    nextSeed: () => seed,
    strongInput,
    onSettled: settled,
    onDamage: damaged,
  })

  return {
    controller,
    settled,
    damaged,
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

function completeTap(
  h: ReturnType<typeof harness>,
  weapon: Weapon,
  world: World,
  id: number,
  x: number,
  y: number
) {
  h.controller.handle({ type: 'press', id, x, y }, weapon, world)
  return h.controller.handle({ type: 'tap', id, x, y }, weapon, world)
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

  it('reports only the first successful damage result from a multi-request finisher action', () => {
    const h = harness()
    const world = makeWorld(h.target)
    const weapon = makeWeapon({
      quick: (_world, action) => {
        action.damage(damageRequest(h.target))
        action.damage({ ...damageRequest(h.target), finish: true })
      },
    })

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, weapon, world)

    expect(h.damaged).toHaveBeenCalledTimes(1)
    expect(h.damaged).toHaveBeenCalledWith(expect.objectContaining({
      weaponId: weapon.id,
      kind: 'quick',
      damage: expect.objectContaining({ detached: 5 }),
    }))
  })

  it.each<CancelReason>([
    'next',
    'reset',
    'visibility',
    'weaponChange',
    'targetDestroyed',
  ])('does not report delayed damage after %s cancellation', (reason) => {
    const h = harness()
    const world = makeWorld(h.target)
    const weapon = makeWeapon({
      mode: 'cinematic',
      quick: (_world, action) => {
        let elapsed = 0
        world.effects.add({
          update(dt) {
            elapsed += dt
            if (elapsed < 0.4) return true
            action.damage(damageRequest(h.target))
            return false
          },
          draw() {},
        })
      },
    })

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.cancel(reason)
    world.effects.update(1)

    expect(h.damaged).not.toHaveBeenCalled()
  })

  it('reports one delayed successful damage after settlement', () => {
    const h = harness()
    const world = makeWorld(h.target)
    const weapon = makeWeapon({
      mode: 'cinematic',
      quick: (_world, action) => {
        world.effects.add({
          update() {
            action.damage(damageRequest(h.target))
            return false
          },
          draw() {},
        })
      },
    })

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, weapon, world)
    expect(h.settled).toHaveBeenCalledTimes(1)
    expect(h.damaged).not.toHaveBeenCalled()

    world.effects.update(1)
    expect(h.damaged).toHaveBeenCalledTimes(1)
  })
})

describe('ActionController gesture settlement', () => {
  it('runs a checked system quick action through the same damage guard', () => {
    const h = harness()
    const world = makeWorld(h.target)
    const quick = vi.fn((_world: World, action: Parameters<Weapon['quick']>[1]) =>
      action.damage(damageRequest(h.target))
    )
    const weapon = makeWeapon({ quick })

    expect(h.controller.runSystemQuick(weapon, world, 25, 35)).toMatchObject({
      kind: 'quick',
      weaponId: weapon.id,
    })
    expect(quick).toHaveBeenCalledTimes(1)
    expect(h.damaged).toHaveBeenCalledTimes(1)
    expect(h.damaged).toHaveBeenCalledWith(
      expect.objectContaining({ damage: expect.objectContaining({ detached: 5 }) })
    )
  })

  it('keeps two delayed point system actions valid on the same target run', () => {
    const h = harness()
    const world = makeWorld(h.target)
    const quick = vi.fn((_world: World, action: Parameters<Weapon['quick']>[1]) => {
      world.effects.add({
        update() {
          action.damage(damageRequest(h.target))
          return false
        },
        draw() {},
      })
    })
    const weapon = makeWeapon({ quick })

    h.controller.runSystemQuick(weapon, world, 20, 30)
    h.controller.runSystemQuick(weapon, world, 40, 50)
    expect(h.damaged).not.toHaveBeenCalled()

    world.effects.update(1)

    expect(quick).toHaveBeenCalledTimes(2)
    expect(h.damaged).toHaveBeenCalledTimes(2)
    expect(h.target.attachedCount).toBe(10)
  })

  it.each(['replacement', 'cancel'] as const)(
    'invalidates pending point system actions after %s',
    (invalidation) => {
      const h = harness()
      const world = makeWorld(h.target)
      const results: Array<ReturnType<Parameters<Weapon['quick']>[1]['damage']>> = []
      const weapon = makeWeapon({
        quick: (_world, action) => {
          world.effects.add({
            update() {
              results.push(action.damage(damageRequest(h.target)))
              return false
            },
            draw() {},
          })
        },
      })

      h.controller.runSystemQuick(weapon, world, 20, 30)
      h.controller.runSystemQuick(weapon, world, 40, 50)
      if (invalidation === 'replacement') h.targetRunId++
      else h.controller.cancel('system')
      world.effects.update(1)

      expect(h.damaged).not.toHaveBeenCalled()
      expect(h.target.attachedCount).toBe(20)
      expect(results).toEqual([null, null])
    }
  )

  it('keeps cinematic system actions one at a time through recovery', () => {
    const h = harness()
    const world = makeWorld(h.target)
    const quick = vi.fn()
    const weapon = makeWeapon({ mode: 'cinematic', quick })

    expect(h.controller.runSystemQuick(weapon, world, 20, 30)).not.toBeNull()
    expect(h.controller.runSystemQuick(weapon, world, 40, 50)).toBeNull()
    expect(quick).toHaveBeenCalledTimes(1)

    h.now += 1_401
    expect(h.controller.runSystemQuick(weapon, world, 60, 70)).not.toBeNull()
    expect(quick).toHaveBeenCalledTimes(2)
  })

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
    expect(weapon.quick).toHaveBeenCalledTimes(1)
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

    expect(weapon.quick).toHaveBeenCalledTimes(1)

    h.now += 1_401
    h.controller.update(h.now)
    h.controller.handle({ type: 'press', id: 3, x: 50, y: 60 }, weapon, world)
    h.controller.handle({ type: 'tap', id: 3, x: 50, y: 60 }, weapon, world)

    expect(weapon.quick).toHaveBeenCalledTimes(2)
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

  it('uses the weapon accent for the charge ring', () => {
    const h = harness()
    const weapon = makeWeapon({ accentColor: '#ff5a3c' })
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'chargeStart', id: 1, x: 10, y: 20 }, weapon, world)

    expect(h.controller.chargeState?.color).toBe('#ff5a3c')
  })

  it('falls back to a stable id-derived charge-ring accent', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'chargeStart', id: 1, x: 10, y: 20 }, weapon, world)

    expect(h.controller.chargeState?.color).toBe('hsl(105 82% 62%)')
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
    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(weapon.charged).toHaveBeenCalledTimes(1)
  })

  it('rejects a superseded secondary tap without disturbing the fresh primary action', () => {
    const h = harness()
    const supersededWeapon = makeWeapon({ id: 'superseded' })
    const freshWeapon = makeWeapon({ id: 'fresh' })
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, supersededWeapon, world)
    h.controller.handle({ type: 'press', id: 2, x: 30, y: 40 }, supersededWeapon, world)
    h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, supersededWeapon, world)
    expect(supersededWeapon.quick).toHaveBeenCalledTimes(1)

    h.controller.handle({ type: 'press', id: 3, x: 50, y: 60 }, freshWeapon, world)

    expect(
      h.controller.handle({ type: 'tap', id: 2, x: 30, y: 40 }, freshWeapon, world)
    ).toBeNull()
    expect(supersededWeapon.quick).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(1)
    expect(h.controller.state).toBe('pressed')

    expect(
      h.controller.handle({ type: 'tap', id: 3, x: 50, y: 60 }, freshWeapon, world)
    ).toMatchObject({ kind: 'quick', weaponId: 'fresh' })
    expect(freshWeapon.quick).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(2)
  })

  it('dispatches only the matching required handler for settled gestures', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle({ type: 'cancel', id: 1 }, weapon, world)
    expect(weapon.quick).not.toHaveBeenCalled()
    expect(weapon.drag).not.toHaveBeenCalled()
    expect(weapon.charged).not.toHaveBeenCalled()

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

    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(weapon.drag).toHaveBeenCalledTimes(1)
    expect(weapon.charged).toHaveBeenCalledTimes(1)
  })

  it('passes the settled action to the matching handler', () => {
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
  })
})

describe('ActionController double-tap strong input', () => {
  it('keeps hold mode as the immediate zero-delay default', () => {
    const h = harness()
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    expect(completeTap(h, weapon, world, 1, 10, 20)).toMatchObject({ kind: 'quick' })
    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(1)
  })

  it('settles one pending quick exactly at the 280ms timeout', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    expect(completeTap(h, weapon, world, 1, 10, 20)).toBeNull()
    expect(weapon.quick).not.toHaveBeenCalled()

    h.now = 1_279
    h.controller.update(h.now)
    expect(weapon.quick).not.toHaveBeenCalled()
    h.now = 1_280
    h.controller.update(h.now)
    h.controller.update(h.now)

    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(weapon.charged).not.toHaveBeenCalled()
    expect(h.settled).toHaveBeenCalledTimes(1)
    expect(h.controller.comboGraceUntil).toBe(1_480)
  })

  it.each(['point', 'cinematic'] as const)(
    'turns a second %s tap at 279ms and 31px into one max charged action',
    (mode) => {
      const h = harness('doubleTap')
      const weapon = makeWeapon({ mode })
      const world = makeWorld(h.target)
      completeTap(h, weapon, world, 1, 10, 20)

      h.now = 1_279
      const result = completeTap(h, weapon, world, 2, 41, 20)

      expect(result).toMatchObject({ kind: 'charged', charge: 1 })
      expect(weapon.quick).not.toHaveBeenCalled()
      expect(weapon.charged).toHaveBeenCalledTimes(1)
      expect(h.settled).toHaveBeenCalledTimes(1)
      expect(h.controller.state).toBe(mode === 'cinematic' ? 'cinematic' : 'recovery')
    }
  )

  it('treats exactly 280ms as two deterministic pending quick taps', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    h.now = 1_280
    expect(completeTap(h, weapon, world, 2, 10, 20)).toBeNull()
    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(weapon.charged).not.toHaveBeenCalled()

    h.now = 1_559
    h.controller.update(h.now)
    expect(weapon.quick).toHaveBeenCalledTimes(1)
    h.now = 1_560
    h.controller.update(h.now)
    expect(weapon.quick).toHaveBeenCalledTimes(2)
    expect(h.settled).toHaveBeenCalledTimes(2)
  })

  it('treats exactly 32px as first quick plus a new pending tap', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    h.now = 1_279
    expect(completeTap(h, weapon, world, 2, 42, 20)).toBeNull()
    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(weapon.charged).not.toHaveBeenCalled()

    h.now = 1_558
    h.controller.update(h.now)
    expect(weapon.quick).toHaveBeenCalledTimes(1)
    h.now = 1_559
    h.controller.update(h.now)
    expect(weapon.quick).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['exactly 280ms', 1_280, 10],
    ['exactly 32px', 1_279, 42],
  ] as const)(
    'settles the first cinematic quick and ignores the boundary tap during lock at %s',
    (_boundary, boundaryTime, secondX) => {
      const h = harness('doubleTap')
      const weapon = makeWeapon({ mode: 'cinematic' })
      const world = makeWorld(h.target)
      completeTap(h, weapon, world, 1, 10, 20)

      h.now = boundaryTime
      expect(completeTap(h, weapon, world, 2, secondX, 20)).toBeNull()
      expect(weapon.quick).toHaveBeenCalledTimes(1)
      expect(weapon.charged).not.toHaveBeenCalled()

      h.now = boundaryTime + 1_400
      h.controller.update(h.now)
      expect(completeTap(h, weapon, world, 3, 10, 20)).toBeNull()
      h.now += 280
      h.controller.update(h.now)
      expect(weapon.quick).toHaveBeenCalledTimes(2)
    }
  )

  it('ignores duplicate release and settles the pending quick once', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    expect(h.controller.handle({ type: 'tap', id: 1, x: 10, y: 20 }, weapon, world)).toBeNull()
    h.now = 1_280
    h.controller.update(h.now)

    expect(weapon.quick).toHaveBeenCalledTimes(1)
    expect(h.settled).toHaveBeenCalledTimes(1)
  })

  it.each<CancelReason>([
    'next',
    'reset',
    'visibility',
    'weaponChange',
    'targetDestroyed',
    'settingsMode',
    'gesture',
  ])('cancels pending damage and combo grace for %s', (reason) => {
    const h = harness('doubleTap')
    const quick = vi.fn((_world: World, action: Parameters<Weapon['quick']>[1]) =>
      action.damage(damageRequest(h.target))
    )
    const weapon = makeWeapon({ quick })
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    h.controller.cancel(reason)
    h.now = 2_000
    h.controller.update(h.now)

    expect(quick).not.toHaveBeenCalled()
    expect(h.damaged).not.toHaveBeenCalled()
    expect(h.target.attachedCount).toBe(20)
    expect(h.controller.state).toBe('idle')
    expect(h.controller.hasComboGrace(h.now)).toBe(false)
  })

  it('cancels the pending tap without damage when the next gesture becomes a drag', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    h.now = 1_100
    h.controller.handle({ type: 'press', id: 2, x: 30, y: 20 }, weapon, world)
    h.controller.handle({ type: 'dragStart', id: 2, x: 46, y: 20 }, weapon, world)
    h.now = 2_000
    h.controller.update(h.now)

    expect(weapon.quick).not.toHaveBeenCalled()
    expect(weapon.charged).not.toHaveBeenCalled()
    expect(weapon.drag).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending tap when the target run is replaced', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    h.targetRunId += 1
    h.now = 1_280
    h.controller.update(h.now)

    expect(weapon.quick).not.toHaveBeenCalled()
    expect(weapon.charged).not.toHaveBeenCalled()
    expect(h.controller.state).toBe('idle')
  })

  it('cancels pending damage when the strong-input setting changes at runtime', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)
    completeTap(h, weapon, world, 1, 10, 20)

    h.controller.setStrongInput('hold')
    h.now = 2_000
    h.controller.update(h.now)
    expect(weapon.quick).not.toHaveBeenCalled()

    expect(completeTap(h, weapon, world, 2, 10, 20)).toMatchObject({ kind: 'quick' })
    expect(weapon.quick).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending tap before a cinematic system action locks the controller', () => {
    const h = harness('doubleTap')
    const pendingWeapon = makeWeapon({ id: 'pending' })
    const cinematic = makeWeapon({ id: 'cinematic', mode: 'cinematic' })
    const world = makeWorld(h.target)
    completeTap(h, pendingWeapon, world, 1, 10, 20)

    expect(h.controller.runSystemQuick(cinematic, world, 40, 50)).toMatchObject({
      kind: 'quick',
      weaponId: 'cinematic',
    })
    h.now = 2_000
    h.controller.update(h.now)

    expect(pendingWeapon.quick).not.toHaveBeenCalled()
    expect(cinematic.quick).toHaveBeenCalledTimes(1)
  })

  it('uses double-tap instead of hold charge while that setting is active', () => {
    const h = harness('doubleTap')
    const weapon = makeWeapon()
    const world = makeWorld(h.target)

    h.controller.handle({ type: 'press', id: 1, x: 10, y: 20 }, weapon, world)
    h.now = 1_450
    h.controller.handle({ type: 'chargeStart', id: 1, x: 10, y: 20 }, weapon, world)
    h.controller.handle(
      { type: 'chargeRelease', id: 1, x: 10, y: 20, charge: 0.8 },
      weapon,
      world
    )
    expect(weapon.charged).not.toHaveBeenCalled()

    h.now = 1_730
    h.controller.update(h.now)
    expect(weapon.quick).toHaveBeenCalledTimes(1)
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
