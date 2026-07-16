import {
  isUuid,
  normalizeProfileName,
  parsePlayerAuthRequest,
  type PlayerSessionPayload,
} from './player-contract.ts'

const MAX_BODY_BYTES = 4_096

export interface PlayerProfileRow {
  user_id: string
  display_name: string
  name_key: string
  status: 'active' | 'inactive'
  credential_version: number
  force_pin_change: boolean
  signup_request_id: string
}

export interface CurrentPlayer {
  userId: string
  displayName: string
  credentialVersion: number
  forcePinChange: boolean
}

export type CurrentPlayerVerification =
  | { ok: true; player: CurrentPlayer }
  | { ok: false; status: 401 | 403; code: 'authentication_required' | 'session_expired' }

interface AuthSession {
  access_token: string
  refresh_token: string
  expires_at: number
}

interface ProfileCreationInput {
  user_id: string
  display_name: string
  name_key: string
  auth_email: string
  privacy_version: 1
  over_14_confirmed_at: string
  signup_request_id: string
}

export interface PlayerAuthDependencies {
  requester(request: Request): Promise<{ forwardedFor: string; fingerprintHash: string }>
  isFlagEnabled(key: 'player_signup'): Promise<boolean>
  consume(
    action: 'check_name' | 'signup' | 'login_name' | 'login_requester',
    subjectHash: string,
    limit: number,
    seconds: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  findByNameKey(nameKey: string): Promise<(PlayerProfileRow & { auth_email: string }) | null>
  findByRequestId(requestId: string): Promise<(PlayerProfileRow & { auth_email: string }) | null>
  createAuthUser(email: string, pin: string): Promise<{ id: string }>
  createProfile(input: ProfileCreationInput): Promise<'created' | 'duplicate_name'>
  deleteAuthUser(userId: string): Promise<void>
  signIn(email: string, pin: string, forwardedFor: string): Promise<AuthSession | null>
  verifyCurrentPlayer(request: Request): Promise<CurrentPlayerVerification>
  nowIso(): string
  randomUuid(): string
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function json(status: number, value: object): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

async function requestBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isAuthSession(value: AuthSession | null): value is AuthSession {
  return !!value
    && typeof value.access_token === 'string'
    && value.access_token.length > 0
    && typeof value.refresh_token === 'string'
    && value.refresh_token.length > 0
    && Number.isSafeInteger(value.expires_at)
    && value.expires_at > 0
}

function publicProfile(profile: PlayerProfileRow): CurrentPlayer {
  return {
    userId: profile.user_id,
    displayName: profile.display_name,
    forcePinChange: profile.force_pin_change,
    credentialVersion: profile.credential_version,
  }
}

function sessionPayload(session: AuthSession, profile: CurrentPlayer): PlayerSessionPayload {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at,
    profile,
  }
}

function rateLimited(retryAfterSeconds: number): Response {
  return json(429, {
    code: 'rate_limited',
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
  })
}

async function safelyDeleteAuthUser(
  dependencies: PlayerAuthDependencies,
  userId: string,
): Promise<void> {
  try {
    await dependencies.deleteAuthUser(userId)
  } catch {
    // A caller retry with the same request ID is safe; never expose cleanup details.
  }
}

async function handleNameCheck(
  dependencies: PlayerAuthDependencies,
  request: Request,
  nameKey: string,
): Promise<Response> {
  const requester = await dependencies.requester(request)
  const limit = await dependencies.consume('check_name', requester.fingerprintHash, 30, 60)
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds)
  const profile = await dependencies.findByNameKey(nameKey)
  return json(200, { available: profile === null })
}

async function handleCreate(
  dependencies: PlayerAuthDependencies,
  request: Request,
  input: {
    requestId: string
    profileName: string
    pin: string
  },
): Promise<Response> {
  if (!await dependencies.isFlagEnabled('player_signup')) {
    return json(503, { code: 'signup_closed' })
  }

  const normalized = normalizeProfileName(input.profileName)
  if (!normalized) return json(400, { code: 'invalid_request' })
  const requester = await dependencies.requester(request)
  const limit = await dependencies.consume('signup', requester.fingerprintHash, 5, 3_600)
  if (!limit.allowed) return rateLimited(limit.retryAfterSeconds)

  const resumed = await dependencies.findByRequestId(input.requestId)
  if (resumed) {
    if (resumed.name_key !== normalized.nameKey) return json(409, { code: 'request_conflict' })
    if (resumed.status !== 'active') return json(401, { code: 'login_failed' })
    const session = await dependencies.signIn(resumed.auth_email, input.pin, requester.forwardedFor)
    return isAuthSession(session)
      ? json(200, sessionPayload(session, publicProfile(resumed)))
      : json(401, { code: 'login_failed' })
  }

  if (await dependencies.findByNameKey(normalized.nameKey)) {
    return json(409, { code: 'name_taken' })
  }

  const aliasId = dependencies.randomUuid()
  if (!isUuid(aliasId)) throw new Error('invalid_generated_uuid')
  const authEmail = `${aliasId.toLowerCase()}@players.invalid`
  const authUser = await dependencies.createAuthUser(authEmail, input.pin)
  if (!isUuid(authUser.id)) throw new Error('invalid_auth_user')

  let result: 'created' | 'duplicate_name'
  try {
    result = await dependencies.createProfile({
      user_id: authUser.id,
      display_name: normalized.displayName,
      name_key: normalized.nameKey,
      auth_email: authEmail,
      privacy_version: 1,
      over_14_confirmed_at: dependencies.nowIso(),
      signup_request_id: input.requestId,
    })
  } catch {
    await safelyDeleteAuthUser(dependencies, authUser.id)
    throw new Error('profile_creation_failed')
  }

  if (result === 'duplicate_name') {
    await safelyDeleteAuthUser(dependencies, authUser.id)
    return json(409, { code: 'name_taken' })
  }

  const session = await dependencies.signIn(authEmail, input.pin, requester.forwardedFor)
  if (!isAuthSession(session)) throw new Error('session_creation_failed')
  return json(201, sessionPayload(session, {
    userId: authUser.id,
    displayName: normalized.displayName,
    forcePinChange: false,
    credentialVersion: 1,
  }))
}

async function handleLogin(
  dependencies: PlayerAuthDependencies,
  request: Request,
  profileName: string,
  pin: string,
): Promise<Response> {
  const normalized = normalizeProfileName(profileName)
  if (!normalized) return json(400, { code: 'invalid_request' })
  const requester = await dependencies.requester(request)
  const nameSubject = await sha256(`${requester.fingerprintHash}:${normalized.nameKey}`)
  const [requesterLimit, nameLimit] = await Promise.all([
    dependencies.consume('login_requester', requester.fingerprintHash, 20, 3_600),
    dependencies.consume('login_name', nameSubject, 5, 900),
  ])
  if (!requesterLimit.allowed || !nameLimit.allowed) {
    return rateLimited(Math.max(
      requesterLimit.allowed ? 0 : requesterLimit.retryAfterSeconds,
      nameLimit.allowed ? 0 : nameLimit.retryAfterSeconds,
    ))
  }

  const profile = await dependencies.findByNameKey(normalized.nameKey)
  if (!profile || profile.status !== 'active') return json(401, { code: 'login_failed' })
  const session = await dependencies.signIn(profile.auth_email, pin, requester.forwardedFor)
  return isAuthSession(session)
    ? json(200, sessionPayload(session, publicProfile(profile)))
    : json(401, { code: 'login_failed' })
}

export function createPlayerAuthHandler(dependencies: PlayerAuthDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { code: 'method_not_allowed' })

    const input = parsePlayerAuthRequest(await requestBody(request))
    if (!input) return json(400, { code: 'invalid_request' })

    try {
      switch (input.action) {
        case 'check-name': {
          const normalized = normalizeProfileName(input.profileName)
          return normalized
            ? await handleNameCheck(dependencies, request, normalized.nameKey)
            : json(400, { code: 'invalid_request' })
        }
        case 'create':
          return await handleCreate(dependencies, request, input)
        case 'login':
          return await handleLogin(dependencies, request, input.profileName, input.pin)
        case 'session': {
          const verification = await dependencies.verifyCurrentPlayer(request)
          return verification.ok
            ? json(200, { profile: verification.player })
            : json(verification.status, { code: verification.code })
        }
        case 'change-pin':
          return json(400, { code: 'invalid_request' })
      }
    } catch {
      return json(503, { code: 'service_unavailable' })
    }
  }
}
