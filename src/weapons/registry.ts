import type { Weapon } from './weapon'
import { elementalWeapons } from './elemental'
import { createCharacterWeapons } from './characters'
import type { CharacterSkinGetter } from '../art/assets'

/** Full ordered roster: 12 elemental + 9 character = 21 weapons. */
export function createWeaponRoster(getSelectedSkin?: CharacterSkinGetter): Weapon[] {
  return [...elementalWeapons, ...createCharacterWeapons(getSelectedSkin)]
}

export const weapons: Weapon[] = createWeaponRoster()

export const defaultWeaponId = 'hammer'

export function findWeapon(id: string, roster: readonly Weapon[] = weapons): Weapon {
  return roster.find((weapon) => weapon.id === id) ?? roster[0]
}
