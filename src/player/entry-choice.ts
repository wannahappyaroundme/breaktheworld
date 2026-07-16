export const PLAYER_ENTRY_CHOICE_KEY = 'btw.profileEntry.v1'

export type PlayerRestoreOutcome = 'player' | 'force' | 'guest' | 'error'
export type PlayerEntryDecision = PlayerRestoreOutcome | 'choose' | 'fallback-guest'

export function decidePlayerEntry(input: {
  restore: PlayerRestoreOutcome
  profilesEnabled: boolean
  guestRemembered: boolean
}): PlayerEntryDecision {
  if (input.restore === 'player' || input.restore === 'force') return input.restore
  if (!input.profilesEnabled) return 'fallback-guest'
  return input.guestRemembered ? 'guest' : 'choose'
}

type EntryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export class PlayerEntryChoiceStore {
  private memoryGuest = false

  constructor(private readonly storage: EntryStorage) {}

  isGuestRemembered(): boolean {
    if (this.memoryGuest) return true
    try {
      return this.storage.getItem(PLAYER_ENTRY_CHOICE_KEY) === 'guest'
    } catch {
      return false
    }
  }

  rememberGuest(): boolean {
    this.memoryGuest = true
    try {
      this.storage.setItem(PLAYER_ENTRY_CHOICE_KEY, 'guest')
      return true
    } catch {
      return false
    }
  }

  clear(): void {
    this.memoryGuest = false
    try {
      this.storage.removeItem(PLAYER_ENTRY_CHOICE_KEY)
    } catch {
      // This preference is optional. Account and progress storage remain untouched.
    }
  }
}

export async function withEntryTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const fallbackResult = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    timeout = setTimeout(() => resolve({ value: fallback, timedOut: true }), timeoutMs)
  })
  try {
    return await Promise.race([
      pending.then((value) => ({ value, timedOut: false })),
      fallbackResult,
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
