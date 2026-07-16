import { isUuid } from './player-contract.ts'

export interface VerifiedPlayer {
  userId: string
  displayName: string
  credentialVersion: number
  forcePinChange: boolean
}

export type PlayerVerification =
  | { ok: true; player: VerifiedPlayer }
  | { ok: false; status: 401 | 403; code: 'authentication_required' | 'session_expired' }

interface ClaimsClient {
  auth: {
    getClaims(token: string): Promise<{
      data: { claims: Record<string, unknown> } | null
      error: unknown
    }>
  }
}

interface PlayerProfileRow {
  user_id: string
  display_name: string
  status: 'active' | 'inactive'
  credential_version: number
  force_pin_change: boolean
}

interface QueryResult<T> {
  data: T
  error: unknown
}

interface PlayerProfileQuery {
  select(columns: string): PlayerProfileQuery
  eq(column: string, value: string): PlayerProfileQuery
  maybeSingle(): Promise<QueryResult<PlayerProfileRow | null>>
}

interface ServiceClient {
  from(table: string): unknown
}

export interface PlayerRequestSecurityClients {
  claimsClient: ClaimsClient
  serviceClient: ServiceClient
}

const AUTHENTICATION_REQUIRED: PlayerVerification = {
  ok: false,
  status: 401,
  code: 'authentication_required',
}

const SESSION_EXPIRED: PlayerVerification = {
  ok: false,
  status: 403,
  code: 'session_expired',
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)
  return match?.[1] ?? null
}

function currentPlayerClaim(claims: Record<string, unknown>): {
  userId: string
  credentialVersion: number
} | null {
  if (
    !isUuid(claims.sub)
    || claims.account_kind !== 'player'
    || claims.player_status !== 'active'
    || !Number.isSafeInteger(claims.credential_version)
    || (claims.credential_version as number) < 1
  ) return null
  return {
    userId: claims.sub,
    credentialVersion: claims.credential_version as number,
  }
}

function isCurrentRow(value: PlayerProfileRow | null, userId: string): value is PlayerProfileRow {
  return !!value
    && value.user_id === userId
    && typeof value.display_name === 'string'
    && value.display_name.length > 0
    && value.status === 'active'
    && Number.isSafeInteger(value.credential_version)
    && value.credential_version >= 1
    && typeof value.force_pin_change === 'boolean'
}

export async function verifyCurrentPlayer(
  request: Request,
  clients: PlayerRequestSecurityClients,
): Promise<PlayerVerification> {
  const token = bearerToken(request)
  if (!token) return AUTHENTICATION_REQUIRED

  const verified = await clients.claimsClient.auth.getClaims(token)
  if (verified.error || !verified.data) return AUTHENTICATION_REQUIRED
  const claim = currentPlayerClaim(verified.data.claims)
  if (!claim) return SESSION_EXPIRED

  const result = await (clients.serviceClient.from('player_profiles') as PlayerProfileQuery)
    .select('user_id,display_name,status,credential_version,force_pin_change')
    .eq('user_id', claim.userId)
    .maybeSingle()
  if (result.error) throw new Error('player_verification_unavailable')
  if (
    !isCurrentRow(result.data, claim.userId)
    || result.data.credential_version !== claim.credentialVersion
  ) return SESSION_EXPIRED

  return {
    ok: true,
    player: {
      userId: result.data.user_id,
      displayName: result.data.display_name,
      credentialVersion: result.data.credential_version,
      forcePinChange: result.data.force_pin_change,
    },
  }
}
