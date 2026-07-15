export type EventSource = 'user' | 'demo' | 'system'

export type ProgressTargetId = 'word' | 'earth' | 'city'

/** Canonical character classification for progress and quest event consumers. */
export const CHARACTER_WEAPON_IDS = [
  'cinnamoroll',
  'thanos',
  'ironman',
  'hulk',
  'godzilla',
  'dragonball',
  'cat',
  'ditto',
  'pooh',
] as const

export type ProgressCharacterWeaponId = (typeof CHARACTER_WEAPON_IDS)[number]

export function isCharacterWeaponId(weaponId: string): weaponId is ProgressCharacterWeaponId {
  return (CHARACTER_WEAPON_IDS as readonly string[]).includes(weaponId)
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
