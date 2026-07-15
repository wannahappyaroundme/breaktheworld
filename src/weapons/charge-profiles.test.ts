import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ActionController } from '../combat/action-controller'
import { damageBudget, type DamageRequest, type DamageResult } from '../combat/damage'
import { Camera } from '../engine/camera'
import { Particles } from '../engine/particles'
import { Audio } from '../engine/audio'
import { Effects } from '../effects/manager'
import type { Effect } from '../effects/types'
import { Breakable } from '../targets/breakable'
import type { Target } from '../targets/target'
import { elementalWeapons } from './elemental'
import { ELEMENTAL_CHARGE } from './charge-profiles'
import type { WeaponAction, World } from './weapon'

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

const EXPECTED_CHARGE = {
  hammer: { color: '#ffd23f', maxRadiusScale: 1.5, maxDamageRatio: 0.62 },
  fist: { color: '#ffb27a', maxRadiusScale: 1.5, maxDamageRatio: 0.65 },
  glass: { color: '#bfe6ff', maxRadiusScale: 1.6, maxDamageRatio: 0.58 },
  laser: { color: '#ff4d6d', maxRadiusScale: 1.45, maxDamageRatio: 0.58 },
  meteor: { color: '#ffae3b', maxRadiusScale: 1.55, maxDamageRatio: 0.68 },
  missile: { color: '#ff5a3c', maxRadiusScale: 1.5, maxDamageRatio: 0.66 },
  bomb: { color: '#ffd9a0', maxRadiusScale: 1.6, maxDamageRatio: 0.7 },
  lightning: { color: '#bfe3ff', maxRadiusScale: 1.5, maxDamageRatio: 0.62 },
  flame: { color: '#ff7a2f', maxRadiusScale: 1.45, maxDamageRatio: 0.56 },
  tornado: { color: '#d8e8ef', maxRadiusScale: 1.6, maxDamageRatio: 0.6 },
  freeze: { color: '#cdebff', maxRadiusScale: 1.5, maxDamageRatio: 0.6 },
  blackhole: { color: '#b06bff', maxRadiusScale: 1.6, maxDamageRatio: 0.7 },
} as const

function makeTarget(initial = 100): Target {
  return {
    name: 'test-target',
    cx: 195,
    cy: 400,
    radius: 120,
    initialFragmentCount: initial,
    attachedCount: initial,
    isDestroyed: false,
    isGolden: false,
    update: vi.fn(),
    draw: vi.fn(),
    applyDamage: vi.fn(),
    takeDamage: vi.fn(),
    detachAll: vi.fn(),
    detachFraction: vi.fn(),
    reposition: vi.fn(),
    dropIn: vi.fn(),
    setGolden: vi.fn(),
  }
}

function makeHarness(initial = 100) {
  const target = makeTarget(initial)
  const effects = new Effects()
  const requests: Omit<DamageRequest, 'seed'>[] = []
  const damage = vi.fn((request: Omit<DamageRequest, 'seed'>): DamageResult => {
    requests.push(request)
    const detached = Math.max(1, Math.min(initial - 1, Math.round(initial * request.maxRatio)))
    return {
      detached,
      before: initial,
      remaining: initial - detached,
      initial,
      destroyed: false,
    }
  })
  const world: World = {
    target,
    particles: new Particles(500),
    effects,
    camera: new Camera(),
    audio: new Audio(),
    w: 390,
    h: 844,
  }
  const action: WeaponAction = {
    actionId: 1,
    targetRunId: 1,
    x: target.cx,
    y: target.cy,
    charge: 1,
    seed: 0x12345678,
    damage,
  }
  return { target, effects, requests, damage, world, action }
}

function finishDelayedEffects(effects: Effects): void {
  effects.update(3)
}

function makeBreakable(fragmentCount: number, seed = 17): Breakable {
  const target = new Breakable({
    name: 'elemental-real-target',
    spriteW: 100,
    spriteH: 100,
    fragments: fragmentCount,
    seed,
    draw: () => {},
  })
  target.reposition(390, 844)
  return target
}

function makeRealWorld(target: Breakable): World {
  return {
    target,
    particles: new Particles(500),
    effects: new Effects(),
    camera: new Camera(),
    audio: new Audio(),
    w: 390,
    h: 844,
  }
}

function makeRealAction(target: Breakable, charge: number, seed = 0x12345678): WeaponAction {
  return {
    actionId: 1,
    targetRunId: 1,
    x: target.cx,
    y: target.cy,
    charge,
    seed,
    damage: (request) => target.applyDamage({ ...request, seed }),
  }
}

describe('elemental charge profiles', () => {
  it('defines the exact safe charged profile for all 12 elemental weapons', () => {
    expect(ELEMENTAL_CHARGE).toEqual(EXPECTED_CHARGE)
    expect(Object.keys(ELEMENTAL_CHARGE)).toHaveLength(12)
    for (const profile of Object.values(ELEMENTAL_CHARGE)) {
      expect(profile.maxRadiusScale).toBeGreaterThanOrEqual(1.4)
      expect(profile.maxRadiusScale).toBeLessThanOrEqual(1.6)
      expect(profile.maxDamageRatio).toBeGreaterThanOrEqual(0.55)
      expect(profile.maxDamageRatio).toBeLessThanOrEqual(0.7)
    }
  })

  it('gives every elemental weapon quick, drag, and charged behavior', () => {
    expect(elementalWeapons.map((weapon) => weapon.id)).toEqual(Object.keys(EXPECTED_CHARGE))
    for (const weapon of elementalWeapons) {
      expect(weapon.quick, `${weapon.id} quick`).toBeTypeOf('function')
      expect(weapon.drag, `${weapon.id} drag`).toBeTypeOf('function')
      expect(weapon.charged, `${weapon.id} charged`).toBeTypeOf('function')
      expect(weapon.accentColor, `${weapon.id} accent`).toBe(
        ELEMENTAL_CHARGE[weapon.id as keyof typeof ELEMENTAL_CHARGE].color
      )
    }
  })

  it.each(['quick', 'drag'] as const)('%s attacks use checked local damage budgets', (kind) => {
    for (const weapon of elementalWeapons) {
      const h = makeHarness()
      weapon[kind]!(h.world, h.action)
      finishDelayedEffects(h.effects)

      expect(h.damage, `${weapon.id} ${kind}`).toHaveBeenCalled()
      for (const request of h.requests) {
        expect(request.finish).toBe(false)
        expect(request.maxRatio).toBeLessThanOrEqual(kind === 'quick' ? 0.35 : 0.18)
        expect(request.minRatio).toBeGreaterThan(0)
      }
      const totalMaxRatio = h.requests.reduce((sum, request) => sum + request.maxRatio, 0)
      expect(totalMaxRatio, `${weapon.id} ${kind} total`).toBeLessThanOrEqual(
        kind === 'quick' ? 0.35 : 0.18
      )
      expect(h.target.takeDamage).not.toHaveBeenCalled()
      expect(h.target.detachAll).not.toHaveBeenCalled()
    }
  })

  it('scales charged damage to the exact profile ceiling without finishing a fresh target', () => {
    for (const weapon of elementalWeapons) {
      const h = makeHarness()
      weapon.charged!(h.world, h.action)
      finishDelayedEffects(h.effects)

      expect(h.damage, weapon.id).toHaveBeenCalled()
      const totalMaxRatio = h.requests.reduce((sum, request) => sum + request.maxRatio, 0)
      expect(totalMaxRatio, weapon.id).toBeLessThanOrEqual(ELEMENTAL_CHARGE[weapon.id as keyof typeof ELEMENTAL_CHARGE].maxDamageRatio)
      expect(h.requests.every((request) => request.finish === false)).toBe(true)
    }
  })

  it('caps charged damage so a fresh target with two fragments keeps one', () => {
    for (const weapon of elementalWeapons) {
      const h = makeHarness(2)
      weapon.charged!(h.world, h.action)
      finishDelayedEffects(h.effects)

      const totalMaxRatio = h.requests.reduce((sum, request) => sum + request.maxRatio, 0)
      expect(totalMaxRatio, weapon.id).toBeLessThanOrEqual(0.5)
      expect(h.requests.every((request) => request.finish === false)).toBe(true)
    }
  })

  it.each(['meteor', 'missile'] as const)('%s applies damage only when its projectile impacts', (id) => {
    const weapon = elementalWeapons.find((candidate) => candidate.id === id)!
    const h = makeHarness()

    weapon.charged!(h.world, h.action)
    expect(h.damage).not.toHaveBeenCalled()

    finishDelayedEffects(h.effects)
    expect(h.damage).toHaveBeenCalledTimes(1)
  })

  it.each([3, 4, 5])(
    'keeps missile quick and charged damage inside one integer action budget at %i fragments',
    (requestedFragments) => {
      const missile = elementalWeapons.find((weapon) => weapon.id === 'missile')!
      for (const kind of ['quick', 'charged'] as const) {
        const target = makeBreakable(requestedFragments)
        const initial = target.initialFragmentCount
        const world = makeRealWorld(target)
        const action = makeRealAction(target, kind === 'charged' ? 1 : 0)

        missile[kind]!(world, action)
        finishDelayedEffects(world.effects)

        const declaredMax = kind === 'charged' ? ELEMENTAL_CHARGE.missile.maxDamageRatio : 0.32
        const maxDetached = damageBudget(initial, initial, 0, declaredMax).max
        expect(initial - target.attachedCount, `${kind} at ${initial}`).toBeLessThanOrEqual(
          maxDetached
        )
        expect(target.attachedCount, `${kind} survivor at ${initial}`).toBeGreaterThanOrEqual(1)
      }
    }
  )

  it('derives the same missile trajectory damage pattern from the same action seed', () => {
    const missile = elementalWeapons.find((weapon) => weapon.id === 'missile')!
    const patternsFor = (seed: number) => {
      const h = makeHarness()
      h.action.seed = seed
      missile.charged!(h.world, h.action)
      finishDelayedEffects(h.effects)
      return h.requests.map((request) => request.pattern)
    }

    const first = patternsFor(1234)
    const repeated = patternsFor(1234)
    const different = patternsFor(5678)

    expect(first).toEqual(repeated)
    expect(first).not.toEqual(different)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ kind: 'multi' })
  })

  it.each([
    { id: 'meteor', invalidation: 'cancel' },
    { id: 'missile', invalidation: 'targetRun' },
  ] as const)(
    'blocks delayed $id damage after $invalidation invalidation',
    ({ id, invalidation }) => {
      const target = makeBreakable(20)
      const initial = target.attachedCount
      const world = makeRealWorld(target)
      let targetRunId = 7
      const controller = new ActionController({
        getTarget: () => target,
        getTargetRunId: () => targetRunId,
      })
      const weapon = elementalWeapons.find((candidate) => candidate.id === id)!
      const action = controller.start({
        weapon,
        targetRunId,
        x: target.cx,
        y: target.cy,
        seed: 99,
      })
      action.charge = 1

      weapon.charged!(world, action)
      expect(target.attachedCount).toBe(initial)
      if (invalidation === 'cancel') controller.cancel('system')
      else targetRunId++

      finishDelayedEffects(world.effects)
      expect(target.attachedCount).toBe(initial)
    }
  )

  it('uses bounded ellipse dissolve damage for black hole and never detaches a fresh target', () => {
    const blackHole = elementalWeapons.find((weapon) => weapon.id === 'blackhole')!
    const h = makeHarness()

    blackHole.charged!(h.world, h.action)

    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]).toMatchObject({
      pattern: { kind: 'ellipse' },
      mode: 'dissolve',
      finish: false,
    })
    expect(h.target.detachAll).not.toHaveBeenCalled()
  })
})

describe('Effects budget', () => {
  it('keeps at most 24 active non-particle effects and skips the newest overflow effect', () => {
    const effects = new Effects()
    const update = vi.fn(() => true)
    const effect = (): Effect => ({ update, draw: vi.fn() })

    for (let i = 0; i < 25; i++) effects.add(effect())

    expect(effects.activeCount).toBe(24)
    effects.update(0.016)
    expect(update).toHaveBeenCalledTimes(24)
  })
})
