import type { ProgressStateV1 } from './types'

export function createDefaultProgress(installSeed: string): ProgressStateV1 {
  return {
    schemaVersion: 1,
    catalogVersion: 1,
    installSeed,
    lifetime: {
      validHits: 0,
      chargedFinishers: 0,
      totalTargets: 0,
      bestCombo: 0,
      stamps: 0,
      distinctWeaponIds: [],
    },
    byWeapon: {},
    byTarget: {
      word: { destroys: 0 },
      earth: { destroys: 0 },
      city: { destroys: 0 },
    },
    achievements: {},
    daily: {
      dayKey: '',
      questId: '',
      target: 0,
      progress: 0,
      distinctIds: [],
      completedAt: null,
      stampAwarded: false,
    },
    profile: {
      selectedTitle: null,
      skins: {},
      strongInput: 'hold',
      reducedMotion: false,
      haptics: true,
    },
  }
}
