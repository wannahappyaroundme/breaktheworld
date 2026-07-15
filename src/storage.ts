export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Access can itself throw in privacy modes, so keep the getter inside the boundary. */
export function getBrowserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readStoredNumber(
  key: string,
  fallback = 0,
  storage: StorageLike | null = getBrowserStorage()
): number {
  try {
    const raw = storage?.getItem(key)
    if (raw === null || raw === undefined) return fallback
    const value = Number(raw)
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
  } catch {
    return fallback
  }
}

export function writeStoredNumber(
  key: string,
  value: number,
  storage: StorageLike | null = getBrowserStorage()
): boolean {
  if (!storage || !Number.isFinite(value) || value < 0) return false
  try {
    storage.setItem(key, String(Math.floor(value)))
    return true
  } catch {
    return false
  }
}
