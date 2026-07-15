import { clamp } from '../engine/math'
import { Rng } from '../engine/rng'
import {
  explosion,
  shockwave,
  crack,
  beam,
  projectile,
  speedLines,
  lightning,
  blackhole,
  frostRing,
  tornado,
} from '../effects/primitives'
import type { DamagePattern, DamageResult } from '../combat/damage'
import { ELEMENTAL_CHARGE, type ElementalWeaponId } from './charge-profiles'
import type { Weapon, WeaponAction, World } from './weapon'
import * as fx from './fx'

const EARTH = ['#7cc95a', '#4aa6e0', '#b07b4f', '#5fab3c', '#3b89c4']

type AttackKind = 'quick' | 'drag' | 'charged'
type RatioRange = readonly [min: number, max: number]

const LOCAL_DAMAGE: Record<
  ElementalWeaponId,
  { quick: RatioRange; drag: RatioRange }
> = {
  hammer: { quick: [0.2, 0.27], drag: [0.07, 0.11] },
  fist: { quick: [0.24, 0.32], drag: [0.09, 0.14] },
  glass: { quick: [0.2, 0.25], drag: [0.06, 0.1] },
  laser: { quick: [0.2, 0.25], drag: [0.08, 0.12] },
  meteor: { quick: [0.24, 0.34], drag: [0.08, 0.13] },
  missile: { quick: [0.22, 0.32], drag: [0.07, 0.12] },
  bomb: { quick: [0.25, 0.35], drag: [0.09, 0.15] },
  lightning: { quick: [0.22, 0.3], drag: [0.08, 0.13] },
  flame: { quick: [0.2, 0.24], drag: [0.06, 0.1] },
  tornado: { quick: [0.22, 0.29], drag: [0.08, 0.12] },
  freeze: { quick: [0.21, 0.28], drag: [0.07, 0.11] },
  blackhole: { quick: [0.24, 0.34], drag: [0.09, 0.14] },
}

function chargeAmount(action: WeaponAction): number {
  return clamp(action.charge, 0, 1)
}

function visualScale(id: ElementalWeaponId, kind: AttackKind, action: WeaponAction): number {
  if (kind === 'drag') return 0.72
  if (kind === 'quick') return 1
  return 1 + (ELEMENTAL_CHARGE[id].maxRadiusScale - 1) * chargeAmount(action)
}

function particleScale(
  id: ElementalWeaponId,
  kind: AttackKind,
  action: WeaponAction
): number {
  if (kind === 'drag') return 0.55
  if (kind === 'quick') return 1
  return visualScale(id, kind, action)
}

function damageRatios(
  id: ElementalWeaponId,
  kind: AttackKind,
  action: WeaponAction
): { min: number; max: number } {
  if (kind !== 'charged') {
    const [min, max] = LOCAL_DAMAGE[id][kind]
    return { min, max }
  }

  const quickMax = LOCAL_DAMAGE[id].quick[1]
  const max = quickMax + (ELEMENTAL_CHARGE[id].maxDamageRatio - quickMax) * chargeAmount(action)
  return { min: max * 0.82, max }
}

function checkedDamage(
  world: World,
  action: WeaponAction,
  pattern: DamagePattern,
  ratios: { min: number; max: number },
  force: number,
  mode: 'fall' | 'dissolve' | 'squash'
): DamageResult | null {
  let max = ratios.max
  let min = ratios.min
  const initial = world.target.initialFragmentCount
  if (initial >= 2 && world.target.attachedCount === initial) {
    max = Math.min(max, (initial - 1) / initial)
    min = Math.min(min, max)
  }

  return action.damage({
    pattern,
    minRatio: min,
    maxRatio: max,
    force,
    mode,
    finish: false,
  })
}

function seedForLegacy(id: string, x: number, y: number, fragments: number): number {
  let seed = 0x811c9dc5
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 0x01000193)
  seed = Math.imul(seed ^ Math.round(x), 0x01000193)
  seed = Math.imul(seed ^ Math.round(y), 0x01000193)
  return (seed ^ fragments) >>> 0
}

function legacyAction(id: string, world: World, x: number, y: number): WeaponAction {
  const seed = seedForLegacy(id, x, y, world.target.attachedCount)
  return {
    actionId: 0,
    targetRunId: 0,
    x,
    y,
    charge: 0,
    seed,
    damage: (request) => world.target.applyDamage({ ...request, seed }),
  }
}

function addProjectile(world: World, effect: ReturnType<typeof projectile>, onSkipped: () => void): void {
  if (!world.effects.add(effect)) onSkipped()
}

function attackHammer(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('hammer', kind, action)
  const particles = particleScale('hammer', kind, action)
  checkedDamage(
    world,
    action,
    { kind: 'circle', x: action.x, y: action.y, radius: 72 * scale },
    damageRatios('hammer', kind, action),
    55 + 28 * chargeAmount(action),
    'fall'
  )
  world.effects.add(crack(action.x, action.y, { branches: fx.scaledCount(6, scale, 10), len: 96 * scale }))
  world.effects.add(speedLines(action.x, action.y, { count: fx.scaledCount(8, scale, 14), r0: 8, r1: 80 * scale }))
  fx.debris(world.particles, action.x, action.y, fx.scaledCount(14, particles), EARTH)
  fx.dust(world.particles, action.x, action.y, fx.scaledCount(8, particles))
  world.camera.shake(kind === 'drag' ? 5 : 11 * scale)
  world.camera.punch(kind === 'charged' ? 0.035 : 0.02)
  world.audio.play('thud')
}

function attackFist(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('fist', kind, action)
  const particles = particleScale('fist', kind, action)
  checkedDamage(
    world,
    action,
    { kind: 'ellipse', x: action.x, y: action.y, rx: 104 * scale, ry: 72 * scale, rotation: -0.18 },
    damageRatios('fist', kind, action),
    72 + 30 * chargeAmount(action),
    'squash'
  )
  world.effects.add(shockwave(action.x, action.y, 130 * scale, { color: '#ffffff', width: 12 * scale }))
  world.effects.add(crack(action.x, action.y, { branches: fx.scaledCount(8, scale, 12), len: 120 * scale }))
  world.effects.add(speedLines(action.x, action.y, { count: fx.scaledCount(12, scale, 18), r0: 14, r1: 120 * scale }))
  fx.debris(world.particles, action.x, action.y, fx.scaledCount(22, particles), EARTH)
  fx.dust(world.particles, action.x, action.y, fx.scaledCount(12, particles))
  world.camera.shake(kind === 'drag' ? 7 : 17 * scale)
  world.camera.punch(kind === 'charged' ? 0.05 : 0.035)
  world.audio.play('thud')
}

function attackGlass(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('glass', kind, action)
  const particles = particleScale('glass', kind, action)
  const patternRng = new Rng(action.seed ^ 0x61a55)
  const points = Array.from({ length: kind === 'charged' ? 4 : 2 }, () => ({
    x: action.x + patternRng.spread(34 * scale),
    y: action.y + patternRng.spread(28 * scale),
  }))
  checkedDamage(
    world,
    action,
    { kind: 'multi', points, radius: 36 * scale },
    damageRatios('glass', kind, action),
    48 + 18 * chargeAmount(action),
    'fall'
  )
  world.effects.add(crack(action.x, action.y, { branches: fx.scaledCount(7, scale, 12), len: 80 * scale, color: '#bfe6ff', dur: 0.6 }))
  fx.glassBits(world.particles, action.x, action.y, fx.scaledCount(18, particles))
  fx.sparks(world.particles, action.x, action.y, fx.scaledCount(6, particles), ['#ffffff', '#dff3ff'])
  world.camera.shake(kind === 'drag' ? 4 : 7 * scale)
  world.audio.play('glass')
}

function attackLaser(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('laser', kind, action)
  const particles = particleScale('laser', kind, action)
  world.effects.add(beam(action.x, 0, action.x, action.y, { color: '#ff4d6d', core: '#ffffff', width: 14 * scale, dur: 0.28 + chargeAmount(action) * 0.12 }))
  checkedDamage(
    world,
    action,
    { kind: 'line', x1: action.x, y1: action.y - 150 * scale, x2: action.x, y2: action.y + 42 * scale, width: 50 * scale },
    damageRatios('laser', kind, action),
    44 + 24 * chargeAmount(action),
    'dissolve'
  )
  fx.sparks(world.particles, action.x, action.y, fx.scaledCount(14, particles), ['#ff4d6d', '#ffd23f', '#ffffff'])
  fx.fireBits(world.particles, action.x, action.y, fx.scaledCount(6, particles))
  world.camera.shake(kind === 'drag' ? 3 : 6 * scale)
  world.camera.flash('#ff4d6d', kind === 'charged' ? 0.22 : 0.12)
  world.audio.play('zap')
}

function attackMeteor(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('meteor', kind, action)
  const particles = particleScale('meteor', kind, action)
  const visualRng = new Rng(action.seed ^ 0x4d371e)
  const startX = action.x + visualRng.spread(120 * scale)
  const ratios = damageRatios('meteor', kind, action)
  const impact = () => {
    checkedDamage(
      world,
      action,
      { kind: 'circle', x: action.x, y: action.y, radius: 118 * scale },
      ratios,
      85 + 30 * chargeAmount(action),
      'fall'
    )
    world.effects.add(explosion(action.x, action.y, 170 * scale))
    world.effects.add(shockwave(action.x, action.y, 200 * scale, { color: '#ffcaa0', width: 14 * scale }))
    fx.debris(world.particles, action.x, action.y, fx.scaledCount(28, particles), EARTH)
    fx.fireBits(world.particles, action.x, action.y, fx.scaledCount(20, particles))
    fx.smoke(world.particles, action.x, action.y, fx.scaledCount(10, particles))
    fx.dust(world.particles, action.x, action.y, fx.scaledCount(14, particles))
    world.camera.shake(kind === 'drag' ? 9 : 26 * scale)
    world.camera.punch(kind === 'charged' ? 0.07 : 0.05)
    world.camera.flash('#ffd9a0', kind === 'charged' ? 0.4 : 0.3)
    world.audio.play(kind === 'charged' ? 'bigboom' : 'boom')
  }
  if (kind === 'drag') {
    impact()
    return
  }
  addProjectile(
    world,
    projectile(startX, -90, action.x, action.y, {
      dur: Math.max(0.24, 0.42 - chargeAmount(action) * 0.08),
      color: '#ffae3b',
      headR: 16 * scale,
      onImpact: impact,
    }),
    impact
  )
  world.audio.play('whoosh')
}

function attackMissile(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('missile', kind, action)
  const particles = particleScale('missile', kind, action)
  const visualRng = new Rng(action.seed ^ 0x115511e)
  const desired = kind === 'drag' ? 1 : kind === 'quick' ? 2 : 4
  const count = Math.min(desired, Math.max(1, world.target.attachedCount - 1))
  const totalRatios = damageRatios('missile', kind, action)
  const targets = Array.from({ length: count }, (_unused, index) => ({
    x: action.x + visualRng.spread(90 * scale),
    y: action.y + visualRng.spread(60 * scale),
    startXOffset: visualRng.spread(40),
    index,
  }))
  let impactsRemaining = count
  let damageSettled = false

  const settleVolleyDamage = () => {
    if (damageSettled) return
    damageSettled = true
    checkedDamage(
      world,
      action,
      {
        kind: 'multi',
        points: targets.map((target) => ({ x: target.x, y: target.y })),
        radius: 70 * scale,
      },
      totalRatios,
      60 + 24 * chargeAmount(action),
      'fall'
    )
  }

  for (const target of targets) {
    const impact = () => {
      world.effects.add(explosion(target.x, target.y, 90 * scale))
      fx.debris(world.particles, target.x, target.y, fx.scaledCount(12, particles), EARTH)
      fx.fireBits(world.particles, target.x, target.y, fx.scaledCount(10, particles))
      fx.smoke(world.particles, target.x, target.y, fx.scaledCount(5, particles))
      world.camera.shake(kind === 'drag' ? 5 : 14 * scale)
      world.audio.play('boom')
      impactsRemaining--
      if (impactsRemaining === 0) settleVolleyDamage()
    }
    if (kind === 'drag') {
      impact()
      continue
    }
    addProjectile(
      world,
      projectile(target.x + target.startXOffset, -100 - target.index * 30, target.x, target.y, {
        dur: 0.38 + target.index * 0.07,
        color: '#ff5a3c',
        headR: 9 * scale,
        onImpact: impact,
      }),
      impact
    )
  }
  world.audio.play('whoosh')
}

function attackBomb(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('bomb', kind, action)
  const particles = particleScale('bomb', kind, action)
  checkedDamage(
    world,
    action,
    { kind: 'circle', x: action.x, y: action.y, radius: 150 * scale },
    damageRatios('bomb', kind, action),
    95 + 38 * chargeAmount(action),
    'fall'
  )
  world.effects.add(explosion(action.x, action.y, 210 * scale, { dur: 0.6 }))
  world.effects.add(shockwave(action.x, action.y, 240 * scale, { color: '#ffd9a0', width: 16 * scale }))
  fx.debris(world.particles, action.x, action.y, fx.scaledCount(34, particles), EARTH)
  fx.fireBits(world.particles, action.x, action.y, fx.scaledCount(26, particles))
  fx.smoke(world.particles, action.x, action.y, fx.scaledCount(14, particles))
  fx.dust(world.particles, action.x, action.y, fx.scaledCount(16, particles))
  world.camera.shake(kind === 'drag' ? 10 : 30 * scale)
  world.camera.punch(kind === 'charged' ? 0.08 : 0.06)
  world.camera.flash('#fff1c0', kind === 'charged' ? 0.5 : 0.4)
  world.audio.play('bigboom')
}

function attackLightning(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('lightning', kind, action)
  const particles = particleScale('lightning', kind, action)
  world.effects.add(lightning(action.x, 0, action.x, action.y, { dur: 0.28 + chargeAmount(action) * 0.1 }))
  checkedDamage(
    world,
    action,
    { kind: 'line', x1: action.x, y1: action.y - 170 * scale, x2: action.x, y2: action.y + 55 * scale, width: 84 * scale },
    damageRatios('lightning', kind, action),
    70 + 28 * chargeAmount(action),
    'dissolve'
  )
  world.effects.add(crack(action.x, action.y, { branches: fx.scaledCount(5, scale, 9), len: 80 * scale, color: '#bfe3ff', dur: 0.5 }))
  fx.sparks(world.particles, action.x, action.y, fx.scaledCount(20, particles), ['#bfe3ff', '#ffffff', '#9fd0ff'])
  fx.debris(world.particles, action.x, action.y, fx.scaledCount(12, particles), EARTH)
  world.camera.shake(kind === 'drag' ? 6 : 16 * scale)
  world.camera.flash('#dff0ff', kind === 'charged' ? 0.45 : 0.35)
  world.audio.play('zap')
}

function attackFlame(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('flame', kind, action)
  const particles = particleScale('flame', kind, action)
  checkedDamage(
    world,
    action,
    { kind: 'circle', x: action.x, y: action.y, radius: 56 * scale },
    damageRatios('flame', kind, action),
    36 + 20 * chargeAmount(action),
    'dissolve'
  )
  fx.fireBits(world.particles, action.x, action.y, fx.scaledCount(16, particles))
  fx.ash(world.particles, action.x, action.y, fx.scaledCount(8, particles))
  fx.smoke(world.particles, action.x, action.y, fx.scaledCount(6, particles))
  world.effects.add(explosion(action.x, action.y, 70 * scale, { dur: 0.3, hot: '#ffd23f', cool: '#ff4d2f' }))
  world.camera.shake(kind === 'drag' ? 3 : 5 * scale)
  world.audio.play('sizzle')
}

function attackTornado(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('tornado', kind, action)
  const particles = particleScale('tornado', kind, action)
  const top = Math.max(40, action.y - 220 * scale)
  world.effects.add(tornado(action.x, top, action.y + 80 * scale, { dur: 1.1 }))
  checkedDamage(
    world,
    action,
    { kind: 'ellipse', x: action.x, y: world.target.cy, rx: 65 * scale, ry: 170 * scale, rotation: 0 },
    damageRatios('tornado', kind, action),
    55 + 28 * chargeAmount(action),
    'fall'
  )
  fx.dust(world.particles, action.x, action.y, fx.scaledCount(18, particles))
  fx.debris(world.particles, action.x, action.y, fx.scaledCount(16, particles), EARTH)
  world.camera.shake(kind === 'drag' ? 5 : 12 * scale)
  world.audio.play('whoosh')
}

function attackFreeze(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('freeze', kind, action)
  const particles = particleScale('freeze', kind, action)
  world.effects.add(frostRing(action.x, action.y, 110 * scale))
  checkedDamage(
    world,
    action,
    { kind: 'circle', x: action.x, y: action.y, radius: 92 * scale },
    damageRatios('freeze', kind, action),
    62 + 22 * chargeAmount(action),
    'dissolve'
  )
  fx.glassBits(world.particles, action.x, action.y, fx.scaledCount(16, particles))
  fx.sparks(world.particles, action.x, action.y, fx.scaledCount(8, particles), ['#cdebff', '#ffffff', '#eaf7ff'])
  world.camera.shake(kind === 'drag' ? 4 : 9 * scale)
  world.camera.flash('#dff2ff', kind === 'charged' ? 0.28 : 0.18)
  world.audio.play('freeze')
  world.audio.play('glass')
}

function attackBlackHole(world: World, action: WeaponAction, kind: AttackKind): void {
  const scale = visualScale('blackhole', kind, action)
  const particles = particleScale('blackhole', kind, action)
  world.effects.add(blackhole(action.x, action.y, 180 * scale, { dur: 1.5 }))
  checkedDamage(
    world,
    action,
    { kind: 'ellipse', x: action.x, y: action.y, rx: 180 * scale, ry: 112 * scale, rotation: 0.18 },
    damageRatios('blackhole', kind, action),
    8 + 10 * chargeAmount(action),
    'dissolve'
  )

  const visualRng = new Rng(action.seed ^ 0xb1ac40)
  const count = fx.scaledCount(44, particles, 70)
  for (let i = 0; i < count; i++) {
    const angle = visualRng.angle()
    const distance = visualRng.range(120, 340) * scale
    const speed = visualRng.range(160, 380)
    world.particles.spawn({
      x: action.x + Math.cos(angle) * distance,
      y: action.y + Math.sin(angle) * distance,
      vx: -Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      life: distance / speed,
      size: visualRng.range(1.5, 3.5),
      color: visualRng.pick(['#b06bff', '#7fd0ff', '#ffffff', '#c9a3e8']),
      kind: 'spark',
      drag: 0.2,
    })
  }
  world.camera.shake(kind === 'drag' ? 5 : 10 * scale)
  world.audio.play('whoosh')
  world.audio.play('boom')
}

const ATTACKS: Record<
  ElementalWeaponId,
  (world: World, action: WeaponAction, kind: AttackKind) => void
> = {
  hammer: attackHammer,
  fist: attackFist,
  glass: attackGlass,
  laser: attackLaser,
  meteor: attackMeteor,
  missile: attackMissile,
  bomb: attackBomb,
  lightning: attackLightning,
  flame: attackFlame,
  tornado: attackTornado,
  freeze: attackFreeze,
  blackhole: attackBlackHole,
}

function makeElemental(
  id: ElementalWeaponId,
  name: string,
  icon: string,
  mode: Weapon['mode'] = 'point'
): Weapon {
  const attack = ATTACKS[id]
  const weapon: Weapon = {
    id,
    name,
    icon,
    accentColor: ELEMENTAL_CHARGE[id].color,
    mode,
    quick: (world, action) => attack(world, action, 'quick'),
    drag: (world, action) => attack(world, action, 'drag'),
    charged: (world, action) => attack(world, action, 'charged'),
  }
  weapon.apply = (world, x, y) => attack(world, legacyAction(id, world, x, y), 'quick')
  return weapon
}

export const elementalWeapons: Weapon[] = [
  makeElemental('hammer', '망치', '🔨'),
  makeElemental('fist', '주먹', '👊'),
  makeElemental('glass', '유리', '🧊'),
  makeElemental('laser', '레이저', '🔪'),
  makeElemental('meteor', '운석', '☄️'),
  makeElemental('missile', '미사일', '🚀'),
  makeElemental('bomb', '대폭발', '💣'),
  makeElemental('lightning', '번개', '⚡'),
  makeElemental('flame', '화염', '🔥'),
  makeElemental('tornado', '토네이도', '🌪️'),
  makeElemental('freeze', '빙결', '❄️'),
  makeElemental('blackhole', '블랙홀', '🕳️', 'cinematic'),
]
