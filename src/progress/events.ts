import { CHARACTER_IDS, isCharacterId, type CharacterId } from '../weapons/character-ids'

export type EventSource = 'user' | 'demo' | 'system'

export type ProgressTargetId = 'word' | 'earth' | 'city'

/** Canonical character classification for progress and quest event consumers. */
export const CHARACTER_WEAPON_IDS = CHARACTER_IDS

export type ProgressCharacterWeaponId = CharacterId

export function isCharacterWeaponId(weaponId: string): weaponId is ProgressCharacterWeaponId {
  return isCharacterId(weaponId)
}

export type GameEvent =
  | {
      type: 'ATTACK_RESOLVED'
      source: EventSource
      actionId: number
      targetRunId: number
      weaponId: string
      moveId: string
      detached: number
    }
  | {
      type: 'CHARGE_RELEASED'
      source: EventSource
      actionId: number
      targetRunId: number
      weaponId: string
      charge: number
    }
  | {
      type: 'TARGET_DESTROYED'
      source: EventSource
      actionId: number
      targetRunId: number
      weaponId: string
      targetId: ProgressTargetId
      golden: boolean
    }
  | {
      type: 'WEAPON_USED'
      source: EventSource
      actionId: number
      targetRunId: number
      weaponId: string
    }
  | { type: 'COMBO_CHANGED'; source: EventSource; value: number }
  | { type: 'FEVER_STARTED'; source: EventSource; combo: number }
  | { type: 'SHARE_COMPLETED'; source: EventSource }
  | { type: 'SETTING_CHANGED'; key: 'strongInput'; value: 'hold' | 'doubleTap' }
  | { type: 'SETTING_CHANGED'; key: 'reducedMotion' | 'haptics'; value: boolean }
