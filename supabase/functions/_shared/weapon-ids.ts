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

const APPROVED_SET: ReadonlySet<string> = new Set(APPROVED_ANALYTICS_WEAPON_IDS)

export function isApprovedAnalyticsWeaponId(value: string): boolean {
  return APPROVED_SET.has(value)
}
