export const PLAYER_PRIVACY_VERSION = 1
export const PROFILE_NAME_PATTERN = /^[가-힣A-Za-z0-9]{2,12}$/u
export const PIN_PATTERN = /^\d{6}$/
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export interface NormalizedProfileName {
  displayName: string
  nameKey: string
}

export type PlayerAuthRequest =
  | { action: 'check-name'; profileName: string }
  | {
      action: 'create'
      requestId: string
      profileName: string
      pin: string
      pinConfirmation: string
      privacyVersion: 1
      over14: true
    }
  | { action: 'login'; profileName: string; pin: string }
  | { action: 'session' }
  | { action: 'change-pin'; pin: string; pinConfirmation: string }

export interface PlayerSessionPayload {
  accessToken: string
  refreshToken: string
  expiresAt: number
  profile: {
    userId: string
    displayName: string
    forcePinChange: boolean
    credentialVersion: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
}

export function normalizeProfileName(raw: unknown): NormalizedProfileName | null {
  if (typeof raw !== 'string') return null
  const displayName = raw.normalize('NFC')
  const length = Array.from(displayName).length
  if (length < 2 || length > 12 || !PROFILE_NAME_PATTERN.test(displayName)) return null
  return {
    displayName,
    nameKey: displayName.replace(/[A-Z]/g, (value) => value.toLowerCase()),
  }
}

export function validatePinPair(pin: unknown, confirmation: unknown):
  | { ok: true; pin: string }
  | { ok: false; code: 'invalid_pin' | 'pin_mismatch' } {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    return { ok: false, code: 'invalid_pin' }
  }
  if (pin !== confirmation) return { ok: false, code: 'pin_mismatch' }
  return { ok: true, pin }
}

export function parsePlayerAuthRequest(value: unknown): PlayerAuthRequest | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null

  switch (value.action) {
    case 'check-name':
      if (!hasExactKeys(value, ['action', 'profileName']) || !normalizeProfileName(value.profileName)) {
        return null
      }
      return { action: value.action, profileName: value.profileName as string }
    case 'create': {
      if (!hasExactKeys(value, [
        'action',
        'requestId',
        'profileName',
        'pin',
        'pinConfirmation',
        'privacyVersion',
        'over14',
      ])) return null
      if (!isUuid(value.requestId) || !normalizeProfileName(value.profileName)) return null
      const pin = validatePinPair(value.pin, value.pinConfirmation)
      if (!pin.ok || value.privacyVersion !== PLAYER_PRIVACY_VERSION || value.over14 !== true) return null
      return {
        action: value.action,
        requestId: value.requestId,
        profileName: value.profileName as string,
        pin: pin.pin,
        pinConfirmation: pin.pin,
        privacyVersion: PLAYER_PRIVACY_VERSION,
        over14: true,
      }
    }
    case 'login':
      if (
        !hasExactKeys(value, ['action', 'profileName', 'pin'])
        || !normalizeProfileName(value.profileName)
        || typeof value.pin !== 'string'
        || !PIN_PATTERN.test(value.pin)
      ) return null
      return { action: value.action, profileName: value.profileName as string, pin: value.pin }
    case 'session':
      return hasExactKeys(value, ['action']) ? { action: value.action } : null
    case 'change-pin': {
      if (!hasExactKeys(value, ['action', 'pin', 'pinConfirmation'])) return null
      const pin = validatePinPair(value.pin, value.pinConfirmation)
      return pin.ok
        ? { action: value.action, pin: pin.pin, pinConfirmation: pin.pin }
        : null
    }
    default:
      return null
  }
}
