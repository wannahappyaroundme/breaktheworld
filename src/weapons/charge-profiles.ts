export const ELEMENTAL_CHARGE = {
  hammer: { color: '#ffd23f', maxRadiusScale: 1.5, maxDamageRatio: 0.62 },
  fist: { color: '#ffb27a', maxRadiusScale: 1.5, maxDamageRatio: 0.65 },
  glass: { color: '#bfe6ff', maxRadiusScale: 1.6, maxDamageRatio: 0.58 },
  laser: { color: '#ff4d6d', maxRadiusScale: 1.45, maxDamageRatio: 0.58 },
  meteor: { color: '#ffae3b', maxRadiusScale: 1.55, maxDamageRatio: 0.68 },
  missile: { color: '#ff5a3c', maxRadiusScale: 1.5, maxDamageRatio: 0.66 },
  bomb: { color: '#ffd9a0', maxRadiusScale: 1.6, maxDamageRatio: 0.7 },
  lightning: { color: '#bfe3ff', maxRadiusScale: 1.5, maxDamageRatio: 0.62 },
  flame: { color: '#ff7a2f', maxRadiusScale: 1.45, maxDamageRatio: 0.56 },
  tornado: { color: '#d8e8ef', maxRadiusScale: 1.6, maxDamageRatio: 0.6 },
  freeze: { color: '#cdebff', maxRadiusScale: 1.5, maxDamageRatio: 0.6 },
  blackhole: { color: '#b06bff', maxRadiusScale: 1.6, maxDamageRatio: 0.7 },
} as const

export type ElementalWeaponId = keyof typeof ELEMENTAL_CHARGE
