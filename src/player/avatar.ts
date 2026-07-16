export interface ProfileAvatar {
  initial: string
  color: string
}

const PROFILE_AVATAR_COLORS = [
  '#3156a3',
  '#8452a5',
  '#bc5b76',
  '#b56a2d',
  '#257a73',
  '#5f6f2e',
] as const

export function profileAvatar(userId: string, displayName: string): ProfileAvatar {
  let hash = 2_166_136_261
  for (const character of userId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619)
  }
  return {
    initial: Array.from(displayName)[0] ?? '?',
    color: PROFILE_AVATAR_COLORS[(hash >>> 0) % PROFILE_AVATAR_COLORS.length],
  }
}
