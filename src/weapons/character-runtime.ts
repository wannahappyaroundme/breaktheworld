import { clamp, easeInCubic, easeOutBack, easeOutCubic } from '../engine/math'
import type { Effect } from '../effects/types'
import {
  beam,
  blackhole,
  crack,
  emojiBurst,
  explosion,
  lightning,
  shockwave,
  speedLines,
} from '../effects/primitives'
import type { DamagePattern, DamageResult } from '../combat/damage'
import type { Effects } from '../effects/manager'
import type { WeaponAction, World } from './weapon'
import type {
  CharacterId,
  CharacterMove,
  CharacterMoveSet,
  CharacterVisual,
} from './character-catalog'
import * as fx from './fx'

export type CharacterDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number
) => void

interface TargetSnapshot {
  x: number
  y: number
  radius: number
  initial: number
  remaining: number
}

interface ActorSequence {
  elapsed: number
  move: CharacterMove
  drawCharacter: CharacterDrawer
  target: TargetSnapshot
  w: number
  h: number
  impact: () => void
  fired: boolean
}

class CharacterActor implements Effect {
  readonly z = 2
  private sequence: ActorSequence | null = null
  active = false

  play(sequence: ActorSequence): void {
    this.sequence = sequence
    this.active = true
  }

  update(dt: number): boolean {
    const sequence = this.sequence
    if (!sequence) return false
    sequence.elapsed += dt
    const progress = sequence.elapsed / sequence.move.duration
    if (!sequence.fired && progress >= sequence.move.impactAt) {
      sequence.fired = true
      sequence.impact()
    }
    if (progress < 1) return true
    this.sequence = null
    this.active = false
    return false
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sequence = this.sequence
    if (!sequence) return
    drawActorSequence(ctx, sequence)
  }
}

const actors = new WeakMap<Effects, CharacterActor>()
const actionCounts = new Map<CharacterId, { targetRunId: number; count: number }>()

function drawActorSequence(ctx: CanvasRenderingContext2D, sequence: ActorSequence): void {
  const { move, target, w, h } = sequence
  const progress = clamp(sequence.elapsed / move.duration, 0, 1)
  const impact = move.impactAt
  const before = clamp(progress / impact, 0, 1)
  const after = clamp((progress - impact) / Math.max(0.01, 1 - impact), 0, 1)
  const size = Math.min(w, h) * (move.kind === 'charged' ? 0.48 : 0.34)

  ctx.save()
  ctx.globalAlpha = progress < impact ? 0.12 + before * 0.22 : (1 - after) * 0.22
  ctx.fillStyle = move.telegraphColor
  ctx.beginPath()
  ctx.ellipse(
    target.x,
    target.y + target.radius * 0.68,
    target.radius * (0.35 + before * 0.62),
    target.radius * 0.2,
    0,
    0,
    Math.PI * 2
  )
  ctx.fill()
  ctx.restore()

  const approach = easeOutCubic(before)
  let x = -size + (target.x + size) * approach
  let y = target.y - target.radius - size * 0.3
  let sx = 1
  let sy = 1
  let rotation = 0
  let actorAlpha = 1

  if (isDropVisual(move.visual)) {
    x = target.x
    y = -size + (target.y + size * 0.25) * easeInCubic(before)
    if (progress >= impact) {
      sx = 1 + Math.sin(after * Math.PI) * 0.28
      sy = 1 - Math.sin(after * Math.PI) * 0.22
    }
  } else if (isSweepVisual(move.visual)) {
    x = -size + (w + size * 2) * approach
    y = target.y - size * 0.2
    rotation = -0.15 + before * 0.3
  } else if (move.visual === 'teleport') {
    x = before < 0.55 ? target.x - target.radius : target.x + target.radius * 0.55
    y = target.y - size * 0.55
    actorAlpha = 0.35 + Math.abs(Math.sin(before * Math.PI * 4)) * 0.65
  } else if (isEnergyVisual(move.visual)) {
    x = w * 0.18
    y = target.y - size * 0.2
    sx = 0.75 + easeOutBack(before) * 0.25
    sy = sx
  }

  ctx.save()
  ctx.globalAlpha *= actorAlpha
  ctx.translate(x, y)
  ctx.rotate(rotation)
  ctx.scale(sx, sy)
  ctx.translate(-x, -y)
  sequence.drawCharacter(ctx, x, y, size)
  ctx.restore()
}

function isDropVisual(visual: CharacterVisual): boolean {
  return ['bounce', 'press', 'pound', 'stomp', 'smash', 'footprint', 'buttSlam', 'copy', 'honeyBomb'].includes(visual)
}

function isSweepVisual(visual: CharacterVisual): boolean {
  return ['sweep', 'tail', 'catTail', 'roller', 'belly'].includes(visual)
}

function isEnergyVisual(visual: CharacterVisual): boolean {
  return ['blast', 'cut', 'barrage', 'breath', 'volley', 'megaBeam'].includes(visual)
}

function patternCenter(pattern: DamagePattern, fallback: TargetSnapshot): { x: number; y: number } {
  if (pattern.kind === 'circle' || pattern.kind === 'ellipse') return { x: pattern.x, y: pattern.y }
  if (pattern.kind === 'line') return { x: (pattern.x1 + pattern.x2) / 2, y: (pattern.y1 + pattern.y2) / 2 }
  if (pattern.points.length === 0) return { x: fallback.x, y: fallback.y }
  return {
    x: pattern.points.reduce((sum, point) => sum + point.x, 0) / pattern.points.length,
    y: pattern.points.reduce((sum, point) => sum + point.y, 0) / pattern.points.length,
  }
}

function addLineEffect(world: World, pattern: DamagePattern, color: string, width = 18): void {
  if (pattern.kind !== 'line') return
  world.effects.add(beam(pattern.x1, pattern.y1, pattern.x2, pattern.y2, {
    color,
    core: '#ffffff',
    width,
    dur: 0.4,
  }))
}

function addMultiBursts(world: World, pattern: DamagePattern, color: string): void {
  if (pattern.kind !== 'multi') return
  for (const point of pattern.points.slice(0, 6)) {
    world.effects.add(explosion(point.x, point.y, pattern.radius * 1.35, { hot: '#ffffff', cool: color, dur: 0.35 }))
  }
}

function addImpactVisual(
  world: World,
  move: CharacterMove,
  pattern: DamagePattern,
  target: TargetSnapshot,
  result: DamageResult | null
): void {
  const center = patternCenter(pattern, target)
  const strong = move.kind === 'charged'
  const radius = target.radius * (strong ? 1.55 : 1.05)

  switch (move.visual) {
    case 'bounce':
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#dff7ff', width: 10 }))
      fx.dust(world.particles, center.x, center.y, 12)
      break
    case 'sweep':
      addLineEffect(world, pattern, '#dff7ff', 15)
      world.effects.add(speedLines(center.x, center.y, { count: 10, color: '#bcecff', r0: 20, r1: radius }))
      break
    case 'press':
      world.effects.add(shockwave(center.x, center.y, radius * 1.2, { color: '#ffffff', width: 14 }))
      world.effects.add(speedLines(center.x, center.y, { count: 16, color: '#8ddcff', r0: 28, r1: radius * 1.2 }))
      break
    case 'ricochet':
      addMultiBursts(world, pattern, '#ffd23f')
      fx.sparks(world.particles, center.x, center.y, 18, ['#ffd23f', '#9b6cd6', '#ffffff'])
      break
    case 'grip':
      world.effects.add(blackhole(center.x, center.y, target.radius * 0.7, { dur: 0.55 }))
      fx.ash(world.particles, center.x, center.y, 20)
      break
    case 'snap':
      world.effects.add(speedLines(center.x, center.y, { count: 15, color: '#e3c6ff', r0: 16, r1: radius }))
      fx.ash(world.particles, center.x, center.y, 34)
      world.camera.flash('#e3c6ff', 0.3)
      break
    case 'blast':
      world.effects.add(explosion(center.x, center.y, radius, { hot: '#ffffff', cool: '#62c8ff' }))
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#bff0ff' }))
      break
    case 'cut':
      addLineEffect(world, pattern, '#bff0ff', 16)
      fx.sparks(world.particles, center.x, center.y, 20, ['#bff0ff', '#ffffff', '#ffd23f'])
      break
    case 'barrage':
      addMultiBursts(world, pattern, '#62c8ff')
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#bff0ff', width: 12 }))
      break
    case 'pound':
      world.effects.add(crack(center.x, center.y, { branches: 7, len: radius * 0.75 }))
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#cdf5b0' }))
      break
    case 'stomp':
      addLineEffect(world, pattern, '#9fe37d', 20)
      fx.debris(world.particles, center.x, center.y, 24, ['#7cc95a', '#b07b4f', '#5fab3c'])
      break
    case 'smash':
      world.effects.add(crack(center.x, center.y, { branches: 10, len: radius }))
      world.effects.add(lightning(center.x, center.y - radius, center.x, center.y, { color: '#d7ffbe' }))
      world.effects.add(shockwave(center.x, center.y, radius * 1.15, { color: '#cdf5b0', width: 15 }))
      break
    case 'tail':
      addLineEffect(world, pattern, '#79d8a7', 18)
      world.effects.add(speedLines(center.x, center.y, { count: 14, color: '#a0e8bd', r0: 20, r1: radius }))
      break
    case 'footprint':
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#79d8a7', width: 13 }))
      fx.dust(world.particles, center.x, center.y, 22)
      break
    case 'breath':
      addLineEffect(world, pattern, '#9b6cff', 24)
      world.effects.add(explosion(center.x, center.y, radius, { hot: '#eaff7a', cool: '#6b3bff' }))
      fx.fireBits(world.particles, center.x, center.y, 22)
      break
    case 'volley':
      addMultiBursts(world, pattern, '#5aaef8')
      fx.sparks(world.particles, center.x, center.y, 18, ['#8fd0ff', '#ffffff'])
      break
    case 'teleport':
      addMultiBursts(world, pattern, '#8fd0ff')
      world.effects.add(speedLines(center.x, center.y, { count: 12, color: '#dff0ff', r0: 12, r1: radius }))
      break
    case 'megaBeam':
      addLineEffect(world, pattern, '#8fd0ff', 34)
      world.effects.add(shockwave(center.x, center.y, radius * 1.15, { color: '#dff0ff', width: 14 }))
      break
    case 'paws':
      addMultiBursts(world, pattern, '#ff9bae')
      fx.dust(world.particles, center.x, center.y, 10)
      break
    case 'catTail':
      world.effects.add(speedLines(center.x, center.y, { count: 11, color: '#ffb3c0', r0: 18, r1: radius }))
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#ffccd5', width: 8 }))
      break
    case 'buttSlam':
      world.effects.add(shockwave(center.x, center.y, radius * 1.15, { color: '#ffccd5', width: 15 }))
      fx.dust(world.particles, center.x, center.y, 20)
      break
    case 'blob':
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#d6b8ef', width: 11 }))
      fx.sparks(world.particles, center.x, center.y, 12, ['#c9a3e8', '#ffffff'])
      break
    case 'roller':
      addLineEffect(world, pattern, '#c9a3e8', 22)
      world.effects.add(speedLines(center.x, center.y, { count: 10, color: '#d6b8ef', r0: 18, r1: radius }))
      break
    case 'copy':
      world.effects.add(explosion(center.x, center.y, radius, { hot: '#ffffff', cool: '#a979cf' }))
      world.effects.add(crack(center.x, center.y, { branches: 8, len: radius * 0.8, color: '#6b3b7a' }))
      break
    case 'honey':
      addMultiBursts(world, pattern, '#ffb43a')
      world.particles.burst(center.x, center.y, 18, 'dust', {
        speed: [40, 210], life: [0.5, 1.1], size: [6, 13],
        colors: ['#ffb43a', '#ffce4a', '#ffdf80'], gravity: 500, drag: 0.7,
      })
      break
    case 'belly':
      addLineEffect(world, pattern, '#ffdf80', 22)
      world.effects.add(shockwave(center.x, center.y, radius, { color: '#ffce4a', width: 10 }))
      break
    case 'honeyBomb':
      world.effects.add(explosion(center.x, center.y, radius, { hot: '#fff4b0', cool: '#ffb43a' }))
      world.effects.add(shockwave(center.x, center.y, radius * 1.2, { color: '#ffdf80', width: 15 }))
      world.particles.burst(center.x, center.y, 28, 'dust', {
        speed: [70, 280], life: [0.6, 1.3], size: [6, 15],
        colors: ['#ffb43a', '#ffce4a', '#ffdf80'], gravity: 650, drag: 0.6,
      })
      break
  }

  world.effects.add(emojiBurst(center.x, center.y, [...move.emojis], {
    count: strong ? 9 : 6,
    size: strong ? 50 : 40,
  }))
  world.camera.shake(strong ? 25 : 12)
  if (strong) world.camera.punch(0.05)
  world.audio.play(move.sfx)

  if (result?.destroyed && strong) world.camera.flash(move.telegraphColor, 0.24)
}

function cappedRatios(move: CharacterMove, action: WeaponAction, target: TargetSnapshot) {
  const chargedScale = move.kind === 'charged' ? clamp(action.charge, 0, 1) : 1
  let max = move.kind === 'charged'
    ? move.damage.min + (move.damage.max - move.damage.min) * chargedScale
    : move.damage.max
  let min = move.damage.min

  if (target.initial >= 2 && target.remaining === target.initial) {
    max = Math.min(max, (target.initial - 1) / target.initial)
    min = Math.min(min, max)
  }
  return { min, max }
}

function recordValidAction(characterId: CharacterId, targetRunId: number): number {
  const current = actionCounts.get(characterId)
  const count = current?.targetRunId === targetRunId ? current.count + 1 : 1
  actionCounts.set(characterId, { targetRunId, count })
  return count
}

function clearFinishedAction(characterId: CharacterId, targetRunId: number): void {
  if (actionCounts.get(characterId)?.targetRunId === targetRunId) actionCounts.delete(characterId)
}

/** Runs one catalog move through a single reusable actor and checked damage closure. */
export function runCharacterMove(
  world: World,
  action: WeaponAction,
  set: CharacterMoveSet,
  move: CharacterMove,
  drawCharacter: CharacterDrawer
): void {
  const target: TargetSnapshot = {
    x: world.target.cx,
    y: world.target.cy,
    radius: world.target.radius,
    initial: world.target.initialFragmentCount,
    remaining: world.target.attachedCount,
  }
  const pattern = move.buildPattern({
    x: action.x,
    y: action.y,
    targetX: target.x,
    targetY: target.y,
    targetRadius: target.radius,
    w: world.w,
    h: world.h,
    seed: action.seed,
  })
  const ratios = cappedRatios(move, action, target)

  const impact = () => {
    const result = action.damage({
      pattern,
      minRatio: ratios.min,
      maxRatio: ratios.max,
      force: move.kind === 'charged' ? 96 : 68,
      mode: move.detachMode,
      finish: false,
    })

    let finalResult = result
    if (result && result.detached > 0) {
      const validActions = recordValidAction(set.id, action.targetRunId)
      const wasFreshNontrivial = result.before === result.initial && result.initial >= 2
      const shouldFinish =
        result.remaining > 0 &&
        ((!wasFreshNontrivial && result.remaining / result.initial <= 0.2) || validActions >= 3)

      if (shouldFinish) {
        finalResult = action.damage({
          pattern,
          minRatio: 1,
          maxRatio: 1,
          force: 110,
          mode: move.detachMode,
          finish: true,
        }) ?? result
      }
      if (finalResult?.destroyed || finalResult?.remaining === 0) {
        clearFinishedAction(set.id, action.targetRunId)
      }
    }

    addImpactVisual(world, move, pattern, target, finalResult)
  }

  let actor = actors.get(world.effects)
  if (!actor) {
    actor = new CharacterActor()
    actors.set(world.effects, actor)
  }
  const needsAdd = !actor.active
  actor.play({
    elapsed: 0,
    move,
    drawCharacter,
    target,
    w: world.w,
    h: world.h,
    impact,
    fired: false,
  })

  if (needsAdd) {
    if (!world.effects.add(actor)) {
      actor.active = false
      impact()
    }
  }
  world.audio.play('whoosh')
}
