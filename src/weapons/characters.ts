import type { Target } from '../targets/target'
import type { Weapon, WeaponAction, World } from './weapon'
import { getImage, drawImageCentered, type AssetName } from '../art/assets'
import {
  drawCat,
  drawCinnamoroll,
  drawDitto,
  drawGauntlet,
  drawGodzilla,
  drawHulk,
  drawIronman,
  drawPooh,
  drawSaiyan,
  drawThanos,
} from '../art/characters'
import {
  CHARACTER_MOVE_SETS,
  pickQuickMove,
  type CharacterId,
  type CharacterMoveSet,
} from './character-catalog'
import { runCharacterMove, type CharacterDrawer } from './character-runtime'

/** Use a drop-in sprite when available and retain the procedural doodle fallback. */
function characterDrawer(name: AssetName, fallback: CharacterDrawer): CharacterDrawer {
  return (ctx, cx, cy, size) => {
    const image = getImage(name)
    if (image) drawImageCentered(ctx, image, cx, cy, size * 1.35)
    else fallback(ctx, cx, cy, size)
  }
}

const thanosFallback: CharacterDrawer = (ctx, cx, cy, size) => {
  drawThanos(ctx, cx - size * 0.12, cy - size * 0.1, size * 0.7)
  drawGauntlet(ctx, cx + size * 0.26, cy + size * 0.2, size * 0.42)
}

const DRAWERS: Record<CharacterId, CharacterDrawer> = {
  cinnamoroll: characterDrawer('cinnamoroll', drawCinnamoroll),
  thanos: characterDrawer('thanos', thanosFallback),
  ironman: characterDrawer('ironman', drawIronman),
  hulk: characterDrawer('hulk', drawHulk),
  godzilla: characterDrawer('godzilla', drawGodzilla),
  dragonball: characterDrawer('dragonball', drawSaiyan),
  cat: characterDrawer('cat', drawCat),
  ditto: characterDrawer('ditto', drawDitto),
  pooh: characterDrawer('pooh', drawPooh),
}

const quickHistory = new Map<CharacterId, string[]>()
const legacyTargetRunIds = new WeakMap<Target, number>()
let nextLegacyTargetRunId = 1_000_000

function executeQuick(
  world: World,
  action: WeaponAction,
  set: CharacterMoveSet,
  drawer: CharacterDrawer
): void {
  const history = quickHistory.get(set.id) ?? []
  const move = pickQuickMove(set, action.seed, history.slice(-2))
  history.push(move.id)
  quickHistory.set(set.id, history.slice(-2))
  runCharacterMove(world, action, set, move, drawer)
}

function seedForLegacy(id: string, x: number, y: number, remaining: number): number {
  let seed = 0x811c9dc5
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 0x01000193)
  seed = Math.imul(seed ^ Math.round(x), 0x01000193)
  seed = Math.imul(seed ^ Math.round(y), 0x01000193)
  return (seed ^ remaining) >>> 0
}

function legacyAction(id: string, world: World, x: number, y: number): WeaponAction {
  const target = world.target
  let targetRunId = legacyTargetRunIds.get(target)
  if (targetRunId === undefined) {
    targetRunId = nextLegacyTargetRunId++
    legacyTargetRunIds.set(target, targetRunId)
  }
  const seed = seedForLegacy(id, x, y, target.attachedCount)
  return {
    actionId: 0,
    targetRunId,
    x,
    y,
    charge: 0,
    seed,
    damage: (request) => target.applyDamage({ ...request, seed }),
  }
}

function createCharacterWeapon(set: CharacterMoveSet): Weapon {
  const drawer = DRAWERS[set.id]
  return {
    id: set.id,
    name: set.name,
    icon: set.icon,
    accentColor: set.accentColor,
    mode: 'cinematic',
    quick: (world, action) => executeQuick(world, action, set, drawer),
    drag: (world, action) => executeQuick(world, action, set, drawer),
    charged: (world, action) => runCharacterMove(world, action, set, set.charged, drawer),
    // Kept only for the temporary screenshot/demo bridge. Task 6 removes Weapon.apply.
    apply: (world, x, y) => executeQuick(world, legacyAction(set.id, world, x, y), set, drawer),
  }
}

const CHARACTER_ORDER: readonly CharacterId[] = [
  'cinnamoroll',
  'thanos',
  'ironman',
  'hulk',
  'godzilla',
  'dragonball',
  'cat',
  'ditto',
  'pooh',
]

export const characterWeapons: Weapon[] = CHARACTER_ORDER.map((id) =>
  createCharacterWeapon(CHARACTER_MOVE_SETS[id])
)
