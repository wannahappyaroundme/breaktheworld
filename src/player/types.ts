export interface PlayerProfile {
  userId: string
  displayName: string
  forcePinChange: boolean
  credentialVersion: number
}

export type PlayerProgressScope =
  | { kind: 'guest' }
  | { kind: 'player'; profile: PlayerProfile }

export type PlayerApiErrorCode =
  | 'offline'
  | 'invalid_request'
  | 'name_taken'
  | 'login_failed'
  | 'rate_limited'
  | 'signup_closed'
  | 'session_expired'
  | 'change_not_required'
  | 'service_unavailable'

export type PlayerApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false
      error: {
        code: PlayerApiErrorCode
        message: string
        retryAfterSeconds?: number
      }
    }
