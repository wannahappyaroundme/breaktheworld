import type { Weapon } from './weapon'
import { elementalWeapons } from './elemental'
import { characterWeapons } from './characters'

/** Full ordered roster: 12 elemental + 9 character = 21 weapons. */
export const weapons: Weapon[] = [...elementalWeapons, ...characterWeapons]

export const defaultWeaponId = 'hammer'

export function findWeapon(id: string): Weapon {
  return weapons.find((w) => w.id === id) ?? weapons[0]
}
