/** Ordered character weapon IDs. Keep this module data-only so progress can import it safely. */
export const CHARACTER_IDS = [
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

export type CharacterId = (typeof CHARACTER_IDS)[number]

export function isCharacterId(value: string): value is CharacterId {
  return (CHARACTER_IDS as readonly string[]).includes(value)
}
