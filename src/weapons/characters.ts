import type { Weapon, WeaponAction, World } from './weapon'
import {
  getImage,
  drawImageCentered,
  resolveCharacterSkinAsset,
  type AssetName,
  type CharacterSkinGetter,
} from '../art/assets'
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

function selectedAsset(set: CharacterMoveSet, getSelectedSkin: CharacterSkinGetter): AssetName {
  if (set.id === 'cinnamoroll' || set.id === 'ditto') {
    return resolveCharacterSkinAsset(set.id, getSelectedSkin)
  }
  return set.asset
}

/** Resolve the current skin on every draw and retain the procedural doodle fallback. */
function characterDrawer(
  set: CharacterMoveSet,
  getSelectedSkin: CharacterSkinGetter,
  fallback: CharacterDrawer
): CharacterDrawer {
  return (ctx, cx, cy, size) => {
    const image = getImage(selectedAsset(set, getSelectedSkin))
    if (image) drawImageCentered(ctx, image, cx, cy, size * 1.35)
    else fallback(ctx, cx, cy, size)
  }
}

const thanosFallback: CharacterDrawer = (ctx, cx, cy, size) => {
  drawThanos(ctx, cx - size * 0.12, cy - size * 0.1, size * 0.7)
  drawGauntlet(ctx, cx + size * 0.26, cy + size * 0.2, size * 0.42)
}

const FALLBACK_DRAWERS: Record<CharacterId, CharacterDrawer> = {
  cinnamoroll: drawCinnamoroll,
  thanos: thanosFallback,
  ironman: drawIronman,
  hulk: drawHulk,
  godzilla: drawGodzilla,
  dragonball: drawSaiyan,
  cat: drawCat,
  ditto: drawDitto,
  pooh: drawPooh,
}

const quickHistory = new Map<CharacterId, string[]>()

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

function createCharacterWeapon(
  set: CharacterMoveSet,
  getSelectedSkin: CharacterSkinGetter
): Weapon {
  const drawer = characterDrawer(set, getSelectedSkin, FALLBACK_DRAWERS[set.id])
  return {
    id: set.id,
    name: set.name,
    icon: set.icon,
    accentColor: set.accentColor,
    mode: 'cinematic',
    quick: (world, action) => executeQuick(world, action, set, drawer),
    drag: (world, action) => executeQuick(world, action, set, drawer),
    charged: (world, action) => runCharacterMove(world, action, set, set.charged, drawer),
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

export function createCharacterWeapons(
  getSelectedSkin: CharacterSkinGetter = () => 'default'
): Weapon[] {
  return CHARACTER_ORDER.map((id) => createCharacterWeapon(CHARACTER_MOVE_SETS[id], getSelectedSkin))
}

export const characterWeapons: Weapon[] = createCharacterWeapons()
