import type { DamagePattern } from '../combat/damage'
import type { Sfx } from '../engine/audio'
import { Rng } from '../engine/rng'
import type { AssetName } from '../art/assets'
import { copyLastElementalPattern } from './pattern-memory'
import type { CharacterId } from './character-ids'

export type { CharacterId } from './character-ids'

export const CHARACTER_MOVE_IDS = {
  cinnamoroll: ['cloudBounce', 'earSweep', 'skyPress'],
  thanos: ['gemRicochet', 'gravityGrip', 'fateSnap'],
  ironman: ['palmRepulsor', 'chestBeam', 'repulsorBarrage'],
  hulk: ['fistPound', 'groundStomp', 'thunderSmash'],
  godzilla: ['tailSweep', 'footStomp', 'atomicBreath'],
  dragonball: ['kiVolley', 'instantStrike', 'megaBeam'],
  cat: ['pawTaps', 'tailSweep', 'buttSlam'],
  ditto: ['blobPunch', 'stretchRoller', 'copySmash'],
  pooh: ['honeySplash', 'bellyPush', 'honeyBomb'],
} as const satisfies Record<CharacterId, readonly [string, string, string]>

export type CharacterMoveId = (typeof CHARACTER_MOVE_IDS)[CharacterId][number]

export interface CharacterPatternContext {
  x: number
  y: number
  targetX: number
  targetY: number
  targetRadius: number
  w: number
  h: number
  seed: number
}

export type CharacterVisual =
  | 'bounce'
  | 'sweep'
  | 'press'
  | 'ricochet'
  | 'grip'
  | 'snap'
  | 'blast'
  | 'cut'
  | 'barrage'
  | 'pound'
  | 'stomp'
  | 'smash'
  | 'tail'
  | 'footprint'
  | 'breath'
  | 'volley'
  | 'teleport'
  | 'megaBeam'
  | 'paws'
  | 'catTail'
  | 'buttSlam'
  | 'blob'
  | 'roller'
  | 'copy'
  | 'honey'
  | 'belly'
  | 'honeyBomb'

export interface CharacterMove {
  id: CharacterMoveId
  name: string
  kind: 'quick' | 'charged'
  damage: { min: number; max: number }
  buildPattern: (context: CharacterPatternContext) => DamagePattern
  telegraphColor: string
  detachMode: 'fall' | 'dissolve' | 'squash'
  sfx: Sfx
  emojis: readonly string[]
  duration: number
  impactAt: number
  visual: CharacterVisual
}

export interface CharacterMoveSet {
  id: CharacterId
  name: string
  icon: string
  accentColor: string
  asset: AssetName
  quick: readonly [CharacterMove, CharacterMove]
  charged: CharacterMove
}

type MoveOptions = Omit<CharacterMove, 'kind'>

function quick(options: MoveOptions): CharacterMove {
  return { ...options, kind: 'quick' }
}

function charged(options: MoveOptions): CharacterMove {
  return { ...options, kind: 'charged' }
}

function points(
  context: CharacterPatternContext,
  count: number,
  spreadX: number,
  spreadY: number,
  radius: number,
  salt: number
): DamagePattern {
  const rng = new Rng(context.seed ^ salt)
  return {
    kind: 'multi',
    points: Array.from({ length: count }, () => ({
      x: context.x + rng.spread(spreadX),
      y: context.y + rng.spread(spreadY),
    })),
    radius,
  }
}

function horizontal(context: CharacterPatternContext, width: number, tilt = 0): DamagePattern {
  const dx = context.targetRadius * 1.25
  const dy = dx * Math.sin(tilt)
  return {
    kind: 'line',
    x1: context.targetX - dx,
    y1: context.y - dy,
    x2: context.targetX + dx,
    y2: context.y + dy,
    width,
  }
}

function vertical(context: CharacterPatternContext, width: number): DamagePattern {
  return {
    kind: 'line',
    x1: context.x,
    y1: context.targetY - context.targetRadius * 1.4,
    x2: context.x,
    y2: context.targetY + context.targetRadius * 1.4,
    width,
  }
}

function diagonal(context: CharacterPatternContext, width: number, reverse = false): DamagePattern {
  const r = context.targetRadius * 1.35
  return {
    kind: 'line',
    x1: context.targetX - r,
    y1: context.targetY + (reverse ? -r : r),
    x2: context.targetX + r,
    y2: context.targetY + (reverse ? r : -r),
    width,
  }
}

export const CHARACTER_MOVE_SETS: Record<CharacterId, CharacterMoveSet> = {
  cinnamoroll: {
    id: 'cinnamoroll',
    name: '시나모롤',
    icon: '☁️',
    accentColor: '#72c8f4',
    asset: 'cinnamoroll',
    quick: [
      quick({
        id: 'cloudBounce', name: '구름콩콩', damage: { min: 0.35, max: 0.44 },
        buildPattern: (c) => ({ kind: 'circle', x: c.x, y: c.y, radius: c.targetRadius * 0.58 }),
        telegraphColor: '#bcecff', detachMode: 'squash', sfx: 'thud', emojis: ['☁️', '💙', '🐾'],
        duration: 0.68, impactAt: 0.48, visual: 'bounce',
      }),
      quick({
        id: 'earSweep', name: '긴귀 휩쓸기', damage: { min: 0.4, max: 0.5 },
        buildPattern: (c) => horizontal(c, c.targetRadius * 0.52, new Rng(c.seed).spread(0.12)),
        telegraphColor: '#dff7ff', detachMode: 'fall', sfx: 'whoosh', emojis: ['☁️', '〰️', '💙'],
        duration: 0.76, impactAt: 0.5, visual: 'sweep',
      }),
    ],
    charged: charged({
      id: 'skyPress', name: '하늘폭신 프레스', damage: { min: 0.62, max: 0.76 },
      buildPattern: (c) => ({ kind: 'ellipse', x: c.targetX, y: c.targetY, rx: c.targetRadius * 1.05, ry: c.targetRadius * 0.72, rotation: 0 }),
      telegraphColor: '#8ddcff', detachMode: 'squash', sfx: 'bigboom', emojis: ['☁️', '💙', '✨'],
      duration: 1.05, impactAt: 0.48, visual: 'press',
    }),
  },
  thanos: {
    id: 'thanos', name: '타노스', icon: '🫰', accentColor: '#9b6cd6', asset: 'thanos',
    quick: [
      quick({
        id: 'gemRicochet', name: '보석 튕김', damage: { min: 0.35, max: 0.45 },
        buildPattern: (c) => points(c, 4, c.targetRadius * 0.7, c.targetRadius * 0.7, c.targetRadius * 0.22, 0x6e6d),
        telegraphColor: '#ffd23f', detachMode: 'dissolve', sfx: 'zap', emojis: ['💎', '✨', '💜'],
        duration: 0.74, impactAt: 0.52, visual: 'ricochet',
      }),
      quick({
        id: 'gravityGrip', name: '중력 움켜쥠', damage: { min: 0.4, max: 0.48 },
        buildPattern: (c) => ({ kind: 'ellipse', x: c.targetX, y: c.targetY, rx: c.targetRadius, ry: c.targetRadius * 0.78, rotation: 0 }),
        telegraphColor: '#b894e8', detachMode: 'dissolve', sfx: 'goo', emojis: ['🌀', '✊', '💜'],
        duration: 0.82, impactAt: 0.58, visual: 'grip',
      }),
    ],
    charged: charged({
      id: 'fateSnap', name: '운명의 스냅', damage: { min: 0.65, max: 0.78 },
      buildPattern: (c) => ({ kind: 'ellipse', x: c.targetX, y: c.targetY, rx: c.targetRadius * 1.1, ry: c.targetRadius, rotation: 0 }),
      telegraphColor: '#e3c6ff', detachMode: 'dissolve', sfx: 'snap', emojis: ['🫰', '💜', '✨'],
      duration: 1.12, impactAt: 0.52, visual: 'snap',
    }),
  },
  ironman: {
    id: 'ironman', name: '아이언맨', icon: '🦾', accentColor: '#e23b3b', asset: 'ironman',
    quick: [
      quick({
        id: 'palmRepulsor', name: '손바닥 리펄서', damage: { min: 0.36, max: 0.45 },
        buildPattern: (c) => ({ kind: 'circle', x: c.x, y: c.y, radius: c.targetRadius * 0.55 }),
        telegraphColor: '#bff0ff', detachMode: 'fall', sfx: 'zap', emojis: ['❤️', '💛', '⚡'],
        duration: 0.66, impactAt: 0.48, visual: 'blast',
      }),
      quick({
        id: 'chestBeam', name: '가슴빔 절단', damage: { min: 0.4, max: 0.49 },
        buildPattern: (c) => diagonal(c, c.targetRadius * 0.34, new Rng(c.seed).bool()),
        telegraphColor: '#dffaff', detachMode: 'dissolve', sfx: 'energy', emojis: ['🦾', '⚡', '✨'],
        duration: 0.78, impactAt: 0.55, visual: 'cut',
      }),
    ],
    charged: charged({
      id: 'repulsorBarrage', name: '연속 리펄서 폭격', damage: { min: 0.64, max: 0.78 },
      buildPattern: (c) => points(c, 6, c.targetRadius * 0.78, c.targetRadius * 0.72, c.targetRadius * 0.26, 0x1f0a),
      telegraphColor: '#bff0ff', detachMode: 'fall', sfx: 'bigboom', emojis: ['❤️', '💛', '⚡'],
      duration: 1.08, impactAt: 0.6, visual: 'barrage',
    }),
  },
  hulk: {
    id: 'hulk', name: '헐크', icon: '🟢', accentColor: '#6fcf5b', asset: 'hulk',
    quick: [
      quick({
        id: 'fistPound', name: '주먹 쿵', damage: { min: 0.38, max: 0.48 },
        buildPattern: (c) => ({ kind: 'circle', x: c.x, y: c.y, radius: c.targetRadius * 0.62 }),
        telegraphColor: '#cdf5b0', detachMode: 'squash', sfx: 'thud', emojis: ['💚', '💪', '💥'],
        duration: 0.67, impactAt: 0.5, visual: 'pound',
      }),
      quick({
        id: 'groundStomp', name: '지각 발구르기', damage: { min: 0.4, max: 0.5 },
        buildPattern: (c) => horizontal({ ...c, y: c.targetY + c.targetRadius * 0.48 }, c.targetRadius * 0.5),
        telegraphColor: '#9fe37d', detachMode: 'fall', sfx: 'boom', emojis: ['🟢', '🪨', '💥'],
        duration: 0.8, impactAt: 0.58, visual: 'stomp',
      }),
    ],
    charged: charged({
      id: 'thunderSmash', name: '천둥 스매시', damage: { min: 0.68, max: 0.8 },
      buildPattern: (c) => ({ kind: 'circle', x: c.targetX, y: c.targetY, radius: c.targetRadius * 1.05 }),
      telegraphColor: '#d7ffbe', detachMode: 'squash', sfx: 'bigboom', emojis: ['💚', '⚡', '💥'],
      duration: 1.1, impactAt: 0.55, visual: 'smash',
    }),
  },
  godzilla: {
    id: 'godzilla', name: '고질라', icon: '🦖', accentColor: '#79d8a7', asset: 'godzilla',
    quick: [
      quick({
        id: 'tailSweep', name: '꼬리 휩쓸기', damage: { min: 0.38, max: 0.48 },
        buildPattern: (c) => horizontal(c, c.targetRadius * 0.48, new Rng(c.seed).spread(0.18)),
        telegraphColor: '#a0e8bd', detachMode: 'fall', sfx: 'whoosh', emojis: ['🦖', '〰️', '💥'],
        duration: 0.78, impactAt: 0.56, visual: 'tail',
      }),
      quick({
        id: 'footStomp', name: '발자국 짓밟기', damage: { min: 0.4, max: 0.5 },
        buildPattern: (c) => {
          const side = new Rng(c.seed).bool() ? -0.42 : 0.42
          return { kind: 'ellipse', x: c.targetX + c.targetRadius * side, y: c.targetY, rx: c.targetRadius * 0.52, ry: c.targetRadius * 0.75, rotation: side * 0.2 }
        },
        telegraphColor: '#79d8a7', detachMode: 'squash', sfx: 'thud', emojis: ['🐾', '🦖', '💢'],
        duration: 0.82, impactAt: 0.6, visual: 'footprint',
      }),
    ],
    charged: charged({
      id: 'atomicBreath', name: '원자 숨결', damage: { min: 0.66, max: 0.79 },
      buildPattern: (c) => diagonal(c, c.targetRadius * 0.48, false),
      telegraphColor: '#9b6cff', detachMode: 'dissolve', sfx: 'energy', emojis: ['🦖', '🔥', '💥'],
      duration: 1.12, impactAt: 0.62, visual: 'breath',
    }),
  },
  dragonball: {
    id: 'dragonball', name: '에너지파', icon: '🐉', accentColor: '#5aaef8', asset: 'dragonball',
    quick: [
      quick({
        id: 'kiVolley', name: '기탄 연사', damage: { min: 0.36, max: 0.46 },
        buildPattern: (c) => points(c, 5, c.targetRadius * 0.72, c.targetRadius * 0.68, c.targetRadius * 0.2, 0x8171),
        telegraphColor: '#8fd0ff', detachMode: 'fall', sfx: 'zap', emojis: ['⚡', '💙', '✨'],
        duration: 0.76, impactAt: 0.58, visual: 'volley',
      }),
      quick({
        id: 'instantStrike', name: '순간이동 타격', damage: { min: 0.4, max: 0.5 },
        buildPattern: (c) => points(c, 3, c.targetRadius * 0.82, c.targetRadius * 0.75, c.targetRadius * 0.28, 0x7e1e),
        telegraphColor: '#dff0ff', detachMode: 'squash', sfx: 'thud', emojis: ['💨', '👊', '⚡'],
        duration: 0.72, impactAt: 0.52, visual: 'teleport',
      }),
    ],
    charged: charged({
      id: 'megaBeam', name: '초에너지파', damage: { min: 0.67, max: 0.79 },
      buildPattern: (c) => horizontal(c, c.targetRadius * 0.58),
      telegraphColor: '#8fd0ff', detachMode: 'dissolve', sfx: 'bigboom', emojis: ['⚡', '💙', '✨'],
      duration: 1.16, impactAt: 0.64, visual: 'megaBeam',
    }),
  },
  cat: {
    id: 'cat', name: '고양이', icon: '🐱', accentColor: '#ff9bae', asset: 'cat',
    quick: [
      quick({
        id: 'pawTaps', name: '앞발 툭툭', damage: { min: 0.35, max: 0.44 },
        buildPattern: (c) => points(c, 3, c.targetRadius * 0.56, c.targetRadius * 0.5, c.targetRadius * 0.27, 0xca7),
        telegraphColor: '#ffccd5', detachMode: 'fall', sfx: 'squash', emojis: ['🐾', '😼', '💢'],
        duration: 0.65, impactAt: 0.48, visual: 'paws',
      }),
      quick({
        id: 'tailSweep', name: '꼬리 싹쓸이', damage: { min: 0.4, max: 0.49 },
        buildPattern: (c) => ({ kind: 'ellipse', x: c.targetX, y: c.targetY, rx: c.targetRadius * 1.05, ry: c.targetRadius * 0.35, rotation: new Rng(c.seed).spread(0.2) }),
        telegraphColor: '#ffb3c0', detachMode: 'fall', sfx: 'whoosh', emojis: ['🐈', '〰️', '✨'],
        duration: 0.75, impactAt: 0.55, visual: 'catTail',
      }),
    ],
    charged: charged({
      id: 'buttSlam', name: '궁디 쿵', damage: { min: 0.63, max: 0.76 },
      buildPattern: (c) => ({ kind: 'circle', x: c.targetX, y: c.targetY, radius: c.targetRadius }),
      telegraphColor: '#ff9bae', detachMode: 'squash', sfx: 'squash', emojis: ['🐾', '😼', '💥'],
      duration: 0.98, impactAt: 0.5, visual: 'buttSlam',
    }),
  },
  ditto: {
    id: 'ditto', name: '메타몽', icon: '🟣', accentColor: '#a979cf', asset: 'ditto',
    quick: [
      quick({
        id: 'blobPunch', name: '말랑 펀치', damage: { min: 0.37, max: 0.46 },
        buildPattern: (c) => ({ kind: 'circle', x: c.x, y: c.y, radius: c.targetRadius * 0.6 }),
        telegraphColor: '#d6b8ef', detachMode: 'squash', sfx: 'goo', emojis: ['🟣', '💜', '✨'],
        duration: 0.68, impactAt: 0.5, visual: 'blob',
      }),
      quick({
        id: 'stretchRoller', name: '쭉쭉 롤러', damage: { min: 0.4, max: 0.5 },
        buildPattern: (c) => new Rng(c.seed).bool() ? horizontal(c, c.targetRadius * 0.5) : vertical(c, c.targetRadius * 0.5),
        telegraphColor: '#c9a3e8', detachMode: 'squash', sfx: 'squash', emojis: ['🟣', '↔️', '💜'],
        duration: 0.8, impactAt: 0.58, visual: 'roller',
      }),
    ],
    charged: charged({
      id: 'copySmash', name: '만능변신 강타', damage: { min: 0.62, max: 0.75 },
      buildPattern: (c) => copyLastElementalPattern(c),
      telegraphColor: '#b88bd9', detachMode: 'squash', sfx: 'bigboom', emojis: ['🟣', '🔨', '✨'],
      duration: 1.04, impactAt: 0.54, visual: 'copy',
    }),
  },
  pooh: {
    id: 'pooh', name: '곰돌이 푸', icon: '🍯', accentColor: '#ffb43a', asset: 'pooh',
    quick: [
      quick({
        id: 'honeySplash', name: '꿀단지 철퍽', damage: { min: 0.36, max: 0.46 },
        buildPattern: (c) => points(c, 4, c.targetRadius * 0.62, c.targetRadius * 0.58, c.targetRadius * 0.26, 0x400e7),
        telegraphColor: '#ffce4a', detachMode: 'fall', sfx: 'goo', emojis: ['🍯', '🐝', '💛'],
        duration: 0.73, impactAt: 0.53, visual: 'honey',
      }),
      quick({
        id: 'bellyPush', name: '배통통 밀기', damage: { min: 0.4, max: 0.49 },
        buildPattern: (c) => horizontal(c, c.targetRadius * 0.56, new Rng(c.seed).bool() ? 0.08 : -0.08),
        telegraphColor: '#ffdf80', detachMode: 'squash', sfx: 'squash', emojis: ['🍯', '💛', '💨'],
        duration: 0.78, impactAt: 0.56, visual: 'belly',
      }),
    ],
    charged: charged({
      id: 'honeyBomb', name: '꿀폭탄 깔아뭉개기', damage: { min: 0.64, max: 0.77 },
      buildPattern: (c) => ({ kind: 'ellipse', x: c.targetX, y: c.targetY, rx: c.targetRadius * 1.04, ry: c.targetRadius * 0.9, rotation: 0 }),
      telegraphColor: '#ffc451', detachMode: 'squash', sfx: 'bigboom', emojis: ['🍯', '🐝', '💥'],
      duration: 1.08, impactAt: 0.53, visual: 'honeyBomb',
    }),
  },
}

export function pickQuickMove(
  set: CharacterMoveSet,
  seed: number,
  history: readonly string[]
): CharacterMove {
  const selected = set.quick[new Rng(seed).int(0, 1)]
  const lastTwo = history.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((id) => id === selected.id)) {
    return set.quick[0].id === selected.id ? set.quick[1] : set.quick[0]
  }
  return selected
}
