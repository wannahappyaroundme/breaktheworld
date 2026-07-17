export const CHARACTER_WEAPON_IDS = Object.freeze([
  'cinnamoroll',
  'thanos',
  'ironman',
  'hulk',
  'godzilla',
  'dragonball',
  'cat',
  'ditto',
  'pooh',
] as const)

export const APPROVED_ANALYTICS_WEAPON_IDS = Object.freeze([
  'hammer',
  'fist',
  'glass',
  'laser',
  'meteor',
  'missile',
  'bomb',
  'lightning',
  'flame',
  'tornado',
  'freeze',
  'blackhole',
  ...CHARACTER_WEAPON_IDS,
] as const)

const APPROVED_SET: ReadonlySet<string> = new Set(APPROVED_ANALYTICS_WEAPON_IDS)

export function isApprovedAnalyticsWeaponId(value: string): boolean {
  return APPROVED_SET.has(value)
}
