import { afterEach, describe, expect, it, vi } from 'vitest'
import { Camera } from '../engine/camera'
import { Particles } from '../engine/particles'
import { Audio } from '../engine/audio'
import { Effects } from '../effects/manager'
import { ActionController } from '../combat/action-controller'
import type { DamageRequest, DamageResult } from '../combat/damage'
import type { Target } from '../targets/target'
import type { WeaponAction, World } from './weapon'
import {
  CHARACTER_MOVE_IDS,
  CHARACTER_MOVE_SETS,
  pickQuickMove,
  type CharacterMove,
} from './character-catalog'
import { runCharacterMove } from './character-runtime'
import { characterWeapons } from './characters'
import {
  CHARACTER_SKINS,
  preloadAssets,
  resolveCharacterSkinAsset,
  type CharacterSkinGetter,
} from '../art/assets'
import { elementalPatternMemory } from './pattern-memory'
import { createWeaponRoster } from './registry'

afterEach(() => {
  vi.unstubAllGlobals()
})

const EXPECTED_IDS = {
  cinnamoroll: ['cloudBounce', 'earSweep', 'skyPress'],
  thanos: ['gemRicochet', 'gravityGrip', 'fateSnap'],
  ironman: ['palmRepulsor', 'chestBeam', 'repulsorBarrage'],
  hulk: ['fistPound', 'groundStomp', 'thunderSmash'],
  godzilla: ['tailSweep', 'footStomp', 'atomicBreath'],
  dragonball: ['kiVolley', 'instantStrike', 'megaBeam'],
  cat: ['pawTaps', 'tailSweep', 'buttSlam'],
  ditto: ['blobPunch', 'stretchRoller', 'copySmash'],
  pooh: ['honeySplash', 'bellyPush', 'honeyBomb'],
} as const

function targetStub(initial = 40): Target {
  return {
    name: 'character-test',
    cx: 195,
    cy: 390,
    radius: 120,
    initialFragmentCount: initial,
    attachedCount: initial,
    isDestroyed: false,
    isGolden: false,
    update() {},
    draw() {},
    applyDamage: vi.fn(),
    takeDamage: vi.fn(),
    detachAll: vi.fn(),
    detachFraction: vi.fn(),
    reposition: vi.fn(),
    dropIn: vi.fn(),
    setGolden: vi.fn(),
  }
}

function makeWorld(initial = 40): World {
  return {
    target: targetStub(initial),
    particles: new Particles(600),
    effects: new Effects(),
    camera: new Camera(),
    audio: new Audio(),
    w: 390,
    h: 844,
  }
}

interface DamageHarness {
  action: WeaponAction
  requests: Omit<DamageRequest, 'seed'>[]
  results: DamageResult[]
  remaining: () => number
}

function damageHarness(initial: number, targetRunId: number, seed: number): DamageHarness {
  let remaining = initial
  const requests: Omit<DamageRequest, 'seed'>[] = []
  const results: DamageResult[] = []
  const action: WeaponAction = {
    actionId: targetRunId,
    targetRunId,
    x: 190,
    y: 390,
    charge: 1,
    seed,
    damage(request) {
      requests.push(request)
      const before = remaining
      const detached = request.finish
        ? remaining
        : Math.min(remaining, Math.max(1, Math.round(initial * request.maxRatio)))
      remaining -= detached
      const result = {
        detached,
        before,
        remaining,
        initial,
        destroyed: remaining === 0,
      }
      results.push(result)
      return result
    },
  }
  return { action, requests, results, remaining: () => remaining }
}

function settle(world: World): void {
  world.effects.update(2)
}

function run(
  move: CharacterMove,
  characterId: keyof typeof CHARACTER_MOVE_SETS,
  initial: number,
  targetRunId: number,
  seed: number
) {
  const world = makeWorld(initial)
  const damage = damageHarness(initial, targetRunId, seed)
  runCharacterMove(world, damage.action, CHARACTER_MOVE_SETS[characterId], move, () => {})
  settle(world)
  return { ...damage, world }
}

describe('character move catalog', () => {
  it('defines the exact nine characters and exact 27 approved move ids', () => {
    expect(CHARACTER_MOVE_IDS).toEqual(EXPECTED_IDS)
    expect(Object.keys(CHARACTER_MOVE_SETS)).toEqual(Object.keys(EXPECTED_IDS))
    expect(characterWeapons.map((weapon) => weapon.id)).toEqual(Object.keys(EXPECTED_IDS))

    for (const [id, expected] of Object.entries(EXPECTED_IDS)) {
      const set = CHARACTER_MOVE_SETS[id as keyof typeof CHARACTER_MOVE_SETS]
      expect([...set.quick.map((move) => move.id), set.charged.id], id).toEqual(expected)
    }
  })

  it('provides complete Korean, damage, pattern, timing, telegraph, audio, and emoji metadata', () => {
    for (const set of Object.values(CHARACTER_MOVE_SETS)) {
      expect(set.name).toMatch(/[가-힣]/)
      expect(set.icon.length).toBeGreaterThan(0)
      expect(set.accentColor).toMatch(/^#/)

      for (const move of [...set.quick, set.charged]) {
        expect(move.name).toMatch(/[가-힣]/)
        expect(move.telegraphColor).toMatch(/^#/)
        expect(['fall', 'dissolve', 'squash']).toContain(move.detachMode)
        expect(move.sfx.length).toBeGreaterThan(0)
        expect(move.emojis.length).toBeGreaterThan(0)
        expect(move.buildPattern({
          x: 190,
          y: 390,
          targetX: 195,
          targetY: 390,
          targetRadius: 120,
          w: 390,
          h: 844,
          seed: 17,
        })).toHaveProperty('kind')
      }

      for (const move of set.quick) {
        expect(move.damage.min).toBeGreaterThanOrEqual(0.35)
        expect(move.damage.max).toBeLessThanOrEqual(0.5)
        expect(move.damage.min).toBeLessThanOrEqual(move.damage.max)
        expect(move.duration).toBeGreaterThanOrEqual(0.55)
        expect(move.duration).toBeLessThanOrEqual(0.85)
      }
      expect(set.charged.damage.min).toBeGreaterThanOrEqual(0.55)
      expect(set.charged.damage.max).toBeLessThanOrEqual(0.8)
      expect(set.charged.duration).toBeGreaterThanOrEqual(0.85)
      expect(set.charged.duration).toBeLessThanOrEqual(1.2)
    }
  })

  it('selects quick moves deterministically without three identical results', () => {
    for (const set of Object.values(CHARACTER_MOVE_SETS)) {
      expect(pickQuickMove(set, 1234, []).id).toBe(pickQuickMove(set, 1234, []).id)

      const history: string[] = []
      for (let i = 0; i < 100; i++) {
        history.push(pickQuickMove(set, 1234 + i, history.slice(-2)).id)
      }
      for (let i = 2; i < history.length; i++) {
        expect(new Set(history.slice(i - 2, i + 1)).size, `${set.id} at ${i}`).toBeGreaterThan(1)
      }
      expect(set.charged.id).toBe(EXPECTED_IDS[set.id][2])
    }
  })

  it('keeps the previous Cinnamoroll and Ditto art in an ordered skin catalog', () => {
    expect(CHARACTER_SKINS.cinnamoroll).toEqual([
      { id: 'default', name: '기본', asset: 'cinnamoroll' },
      { id: 'classic', name: '클래식', asset: 'cinnamorollOld' },
    ])
    expect(CHARACTER_SKINS.ditto).toEqual([
      { id: 'default', name: '기본', asset: 'ditto' },
      { id: 'classic', name: '클래식', asset: 'dittoOld' },
    ])
  })

  it('resolves a Game-supplied skin getter and safely falls back to default', () => {
    const classic: CharacterSkinGetter = vi.fn(() => 'classic')
    const invalid: CharacterSkinGetter = vi.fn(() => 'unknown')

    expect(resolveCharacterSkinAsset('cinnamoroll', classic)).toBe('cinnamorollOld')
    expect(classic).toHaveBeenCalledWith('cinnamoroll')
    expect(resolveCharacterSkinAsset('ditto', invalid)).toBe('ditto')
  })

  it('reads a changed skin getter at character draw time after roster creation', async () => {
    class FakeImage {
      naturalWidth = 100
      naturalHeight = 100
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      private value = ''

      get src(): string {
        return this.value
      }

      set src(value: string) {
        this.value = value
        this.onload?.()
      }
    }
    vi.stubGlobal('Image', FakeImage)
    await preloadAssets('/skin-test/')

    let selected = 'default'
    const roster = createWeaponRoster(() => selected)
    expect(roster).toHaveLength(21)
    const weapon = roster.find((candidate) => candidate.id === 'cinnamoroll')!
    const world = makeWorld(40)
    const drawImage = vi.fn()
    const ctx = {
      save() {},
      restore() {},
      beginPath() {},
      ellipse() {},
      fill() {},
      translate() {},
      rotate() {},
      scale() {},
      drawImage,
      globalAlpha: 1,
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D

    weapon.quick(world, damageHarness(40, 120_001, 1).action)
    world.effects.drawAbove(ctx)
    const defaultImage = drawImage.mock.calls[drawImage.mock.calls.length - 1][0] as FakeImage
    expect(defaultImage.src).toContain('/assets/cinnamoroll.png')

    selected = 'classic'
    drawImage.mockClear()
    weapon.quick(world, damageHarness(40, 120_002, 2).action)
    world.effects.drawAbove(ctx)
    const classicImage = drawImage.mock.calls[drawImage.mock.calls.length - 1][0] as FakeImage
    expect(classicImage.src).toContain('/assets/cinnamoroll-old.png')
  })

  it('builds copySmash from the last successful elemental pattern', () => {
    elementalPatternMemory.remember(
      { kind: 'line', x1: 80, y1: 200, x2: 120, y2: 260, width: 12 },
      { x: 100, y: 230, radius: 50 }
    )
    const pattern = CHARACTER_MOVE_SETS.ditto.charged.buildPattern({
      x: 190,
      y: 390,
      targetX: 195,
      targetY: 390,
      targetRadius: 120,
      w: 390,
      h: 844,
      seed: 19,
    })

    expect(pattern.kind).toBe('line')
  })
})

describe('character runtime damage invariants', () => {
  it('finishes one fragment on the first valid action and never finishes a fresh nontrivial charged target', () => {
    let runId = 10_000
    for (const set of Object.values(CHARACTER_MOVE_SETS)) {
      const single = run(set.quick[0], set.id, 1, runId++, 1)
      expect(single.remaining(), set.id).toBe(0)

      for (const initial of [2, 3, 10, 40, 80]) {
        const charged = run(set.charged, set.id, initial, runId++, 2)
        expect(charged.remaining(), `${set.id} at ${initial}`).toBeGreaterThanOrEqual(1)
        expect(charged.requests[0].finish).toBe(false)
        expect(charged.requests[0].maxRatio).toBeLessThanOrEqual(set.charged.damage.max)
      }
    }
  })

  it('finishes all fragment samples within three valid actions across 100 seeds', () => {
    let runId = 20_000
    for (const set of Object.values(CHARACTER_MOVE_SETS)) {
      for (const initial of [1, 2, 3, 10, 40, 80]) {
        for (let seed = 0; seed < 100; seed++) {
          for (const opening of ['quick', 'charged'] as const) {
            const world = makeWorld(initial)
            const damage = damageHarness(initial, runId++, seed)
            const history: string[] = []
            for (let actionIndex = 0; actionIndex < 3 && damage.remaining() > 0; actionIndex++) {
              damage.action.seed = seed + actionIndex
              const move = actionIndex === 0 && opening === 'charged'
                ? set.charged
                : pickQuickMove(set, damage.action.seed, history.slice(-2))
              if (move.kind === 'quick') history.push(move.id)
              const beforeRequestCount = damage.requests.length
              const beforeResultCount = damage.results.length
              runCharacterMove(world, damage.action, set, move, () => {})
              settle(world)
              const label = `${set.id}/${initial}/${seed}/${opening}/${actionIndex}`
              const actionRequests = damage.requests.slice(beforeRequestCount)
              const actionResults = damage.results.slice(beforeResultCount)
              expect(actionRequests.length, label).toBeGreaterThan(0)
              expect(actionRequests[0].finish).toBe(false)
              expect(actionRequests[0].minRatio).toBeGreaterThan(0)
              expect(actionRequests[0].maxRatio).toBeLessThanOrEqual(move.damage.max)
              expect(actionResults[0].detached, label).toBeGreaterThan(0)
              if (actionIndex === 0 && opening === 'charged' && initial >= 2) {
                expect(actionResults[0].remaining, label).toBeGreaterThanOrEqual(1)
                expect(actionRequests).toHaveLength(1)
              }
            }
            expect(damage.remaining(), `${set.id}/${initial}/${seed}/${opening}`).toBe(0)
          }
        }
      }
    }
  })

  it('executes the impact recipe for every catalog move', () => {
    let runId = 80_000
    for (const set of Object.values(CHARACTER_MOVE_SETS)) {
      for (const move of [...set.quick, set.charged]) {
        const damage = run(move, set.id, 40, runId++, 44)
        expect(damage.requests.length, `${set.id}/${move.id}`).toBeGreaterThan(0)
        expect(damage.results[0].detached, `${set.id}/${move.id}`).toBeGreaterThan(0)
      }
    }
  })

  it('keeps impact effects added during the actor update for the next draw', () => {
    const set = CHARACTER_MOVE_SETS.ironman
    const world = makeWorld(40)
    const damage = damageHarness(40, 89_000, 31)
    runCharacterMove(world, damage.action, set, set.quick[0], () => {})

    world.effects.update(0.4)

    expect(damage.requests).toHaveLength(1)
    expect(world.effects.activeCount).toBeGreaterThan(1)
  })

  it('lets a settled cinematic quick action reach its delayed checked impact', () => {
    const world = makeWorld(40)
    const applyDamage = vi.fn((): DamageResult => ({
      detached: 16,
      before: 40,
      remaining: 24,
      initial: 40,
      destroyed: false,
    }))
    world.target.applyDamage = applyDamage
    const onDamage = vi.fn()
    const controller = new ActionController({
      getTarget: () => world.target,
      getTargetRunId: () => 700,
      nextSeed: () => 99,
      now: () => 1_000,
      onDamage,
    })
    const weapon = characterWeapons[0]

    controller.handle({ type: 'press', id: 1, x: 190, y: 390 }, weapon, world)
    controller.handle({ type: 'tap', id: 1, x: 190, y: 390 }, weapon, world)
    expect(applyDamage).not.toHaveBeenCalled()

    settle(world)
    expect(applyDamage).toHaveBeenCalledTimes(1)
    expect(onDamage).toHaveBeenCalledTimes(1)
  })

  it.each(['next', 'reset', 'visibility', 'weaponChange', 'targetDestroyed'] as const)(
    'does not report delayed character damage after %s cancellation',
    (reason) => {
      const world = makeWorld(40)
      const onDamage = vi.fn()
      const controller = new ActionController({
        getTarget: () => world.target,
        getTargetRunId: () => 710,
        nextSeed: () => 101,
        now: () => 1_000,
        onDamage,
      })
      const weapon = characterWeapons[0]

      controller.handle({ type: 'press', id: 1, x: 190, y: 390 }, weapon, world)
      controller.handle({ type: 'tap', id: 1, x: 190, y: 390 }, weapon, world)
      controller.cancel(reason)
      settle(world)

      expect(onDamage).not.toHaveBeenCalled()
    }
  )

  it('uses checked action damage at delayed impact without reading a later world target', () => {
    const set = CHARACTER_MOVE_SETS.ironman
    const world = makeWorld(40)
    const damage = damageHarness(40, 91_001, 12)
    runCharacterMove(world, damage.action, set, set.quick[0], () => {})
    expect(damage.requests).toHaveLength(0)

    Object.defineProperty(world, 'target', {
      get() {
        throw new Error('late target access')
      },
    })
    expect(() => settle(world)).not.toThrow()
    expect(damage.requests.length).toBeGreaterThan(0)
  })

  it('keeps only one active character actor while move recipes change', () => {
    const world = makeWorld(40)
    let actionId = 100_000
    for (const set of Object.values(CHARACTER_MOVE_SETS)) {
      for (const move of [...set.quick, set.charged]) {
        const damage = damageHarness(40, actionId++, actionId)
        runCharacterMove(world, damage.action, set, move, () => {})
        expect(world.effects.activeCount).toBe(1)
      }
    }
  })

  it('registers the reusable actor again after effects are cleared', () => {
    const set = CHARACTER_MOVE_SETS.cinnamoroll
    const world = makeWorld(40)
    const first = damageHarness(40, 110_001, 1)
    runCharacterMove(world, first.action, set, set.quick[0], () => {})

    world.effects.clear()

    const second = damageHarness(40, 110_002, 2)
    runCharacterMove(world, second.action, set, set.quick[1], () => {})
    expect(second.requests).toHaveLength(0)
    settle(world)
    expect(second.requests).toHaveLength(1)
  })

  it('keeps a saturated character actor delayed by evicting a garnish', () => {
    const set = CHARACTER_MOVE_SETS.ironman
    const world = makeWorld(40)
    for (let i = 0; i < 24; i++) {
      world.effects.add({ update: () => true, draw() {} })
    }
    const damage = damageHarness(40, 120_001, 9)

    runCharacterMove(world, damage.action, set, set.quick[0], () => {})

    expect(world.effects.activeCount).toBe(24)
    expect(damage.requests).toHaveLength(0)
    world.effects.update(0.2)
    expect(damage.requests).toHaveLength(0)
    world.effects.update(0.2)
    expect(damage.requests).toHaveLength(1)
  })
})
