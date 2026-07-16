import type { ProgressTargetId } from './events'

export interface WeaponProgress {
  uses: number
  finishes: number
  seenMoves: string[]
}

export interface DailyQuestSnapshot {
  copy: string
  event: 'CHARGE_RELEASED' | 'WEAPON_USED' | 'TARGET_DESTROYED'
  distinct: 'weaponId' | null
}

export interface ProgressStateV1 {
  schemaVersion: 1
  catalogVersion: number
  installSeed: string
  lifetime: {
    validHits: number
    chargedFinishers: number
    totalTargets: number
    bestCombo: number
    stamps: number
    distinctWeaponIds: string[]
  }
  byWeapon: Record<string, WeaponProgress>
  byTarget: Record<ProgressTargetId, { destroys: number }>
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
  daily: {
    dayKey: string
    questId: string
    quest?: DailyQuestSnapshot
    target: number
    progress: number
    distinctIds: string[]
    completedAt: string | null
    stampAwarded: boolean
  }
  profile: {
    selectedTitle: string | null
    skins: Record<string, string>
    strongInput: 'hold' | 'doubleTap'
    reducedMotion: boolean
    haptics: boolean
  }
}
