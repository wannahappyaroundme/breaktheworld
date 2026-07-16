import { isUuid, validatePinPair } from './player-contract.ts'

const MAX_BODY_BYTES = 4_096

export interface ManagedPlayer {
  userId: string
  displayName: string
  status: 'active' | 'inactive'
  forcePinChange: boolean
  createdAt: string
  lastSyncAt: string | null
}

export interface ManagedPlayerRecord extends ManagedPlayer {
  credentialVersion: number
  authEmail: string
}

export type PlayerAdminAction = 'pin_reset' | 'deactivate' | 'delete'
export type PlayerAdminStep =
  | 'requested'
  | 'credential_invalidated'
  | 'password_changed'
  | 'sessions_revoked'
  | 'completed'

export interface PlayerAdminAudit {
  actorUserId: string
  targetUserId: string
  action: PlayerAdminAction
  requestId: string
  requestFingerprint: string
  outcome: 'started' | 'completed' | 'failed'
  step: PlayerAdminStep
}

interface AuditInput {
  actorUserId: string
  targetUserId: string
  action: PlayerAdminAction
  requestId: string
  requestFingerprint: string
}

interface AuditUpdate {
  outcome: 'started' | 'completed' | 'failed'
  step: PlayerAdminStep
  completedAt?: string
}

export interface ManagePlayerDependencies {
  currentUser(request: Request): Promise<{ userId: string } | null>
  isActiveOwner(userId: string): Promise<boolean>
  listPlayers(): Promise<ManagedPlayerRecord[]>
  getPlayer(userId: string): Promise<ManagedPlayerRecord | null>
  fingerprint(value: string): Promise<string>
  beginAudit(input: AuditInput): Promise<
    | { ok: true; created: boolean; audit: PlayerAdminAudit }
    | { ok: false; code: 'request_conflict' }
  >
  updateAudit(requestId: string, update: AuditUpdate): Promise<void>
  invalidateCredential(userId: string): Promise<ManagedPlayerRecord>
  updateAuthPassword(userId: string, pin: string): Promise<void>
  signIn(authEmail: string, pin: string): Promise<{ accessToken: string }>
  globalSignOut(accessToken: string): Promise<void>
  activateAfterReset(userId: string): Promise<ManagedPlayerRecord>
  deactivatePlayer(userId: string): Promise<ManagedPlayerRecord>
  deleteAuthUser(userId: string): Promise<void>
  nowIso(): string
}

type ManagePlayerRequest =
  | { action: 'list' }
  | { action: 'deactivate'; requestId: string; userId: string }
  | {
      action: 'reset-pin'
      requestId: string
      userId: string
      pin: string
      pinConfirmation: string
    }
  | { action: 'delete'; requestId: string; userId: string; confirmation: string }

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

function json(status: number, value: object): Response {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
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

function parseRequest(value: unknown): ManagePlayerRequest | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null
  switch (value.action) {
    case 'list':
      return exactKeys(value, ['action']) ? { action: 'list' } : null
    case 'deactivate':
      return exactKeys(value, ['action', 'requestId', 'userId'])
        && isUuid(value.requestId)
        && isUuid(value.userId)
        ? { action: 'deactivate', requestId: value.requestId, userId: value.userId }
        : null
    case 'reset-pin': {
      if (!exactKeys(value, ['action', 'requestId', 'userId', 'pin', 'pinConfirmation'])
        || !isUuid(value.requestId)
        || !isUuid(value.userId)) return null
      const pin = validatePinPair(value.pin, value.pinConfirmation)
      return pin.ok
        ? {
            action: 'reset-pin',
            requestId: value.requestId,
            userId: value.userId,
            pin: pin.pin,
            pinConfirmation: pin.pin,
          }
        : null
    }
    case 'delete':
      return exactKeys(value, ['action', 'requestId', 'userId', 'confirmation'])
        && isUuid(value.requestId)
        && isUuid(value.userId)
        && typeof value.confirmation === 'string'
        && value.confirmation.length <= 12
        ? {
            action: 'delete',
            requestId: value.requestId,
            userId: value.userId,
            confirmation: value.confirmation,
          }
        : null
    default:
      return null
  }
}

function publicPlayer(player: ManagedPlayerRecord): ManagedPlayer {
  return {
    userId: player.userId,
    displayName: player.displayName,
    status: player.status,
    forcePinChange: player.forcePinChange,
    createdAt: player.createdAt,
    lastSyncAt: player.lastSyncAt,
  }
}

function stepAtLeast(current: PlayerAdminStep, expected: PlayerAdminStep): boolean {
  const steps: PlayerAdminStep[] = [
    'requested',
    'credential_invalidated',
    'password_changed',
    'sessions_revoked',
    'completed',
  ]
  return steps.indexOf(current) >= steps.indexOf(expected)
}

async function beginMutation(
  dependencies: ManagePlayerDependencies,
  actorUserId: string,
  targetUserId: string,
  action: PlayerAdminAction,
  requestId: string,
  secretInput: string,
): Promise<{ ok: true; created: boolean; audit: PlayerAdminAudit } | { ok: false; response: Response }> {
  const requestFingerprint = await dependencies.fingerprint(JSON.stringify({
    action,
    targetUserId,
    secretInput,
  }))
  const result = await dependencies.beginAudit({
    actorUserId,
    targetUserId,
    action,
    requestId,
    requestFingerprint,
  })
  return result.ok
    ? { ok: true, created: result.created, audit: result.audit }
    : { ok: false, response: json(409, { code: result.code }) }
}

async function safelyMarkFailed(
  dependencies: ManagePlayerDependencies,
  requestId: string,
  step: PlayerAdminStep,
): Promise<void> {
  try {
    await dependencies.updateAudit(requestId, { outcome: 'failed', step })
  } catch {
    // The response remains safely unavailable; a matching request can inspect and retry later.
  }
}

async function handleReset(
  dependencies: ManagePlayerDependencies,
  actorUserId: string,
  input: Extract<ManagePlayerRequest, { action: 'reset-pin' }>,
  initial: ManagedPlayerRecord,
): Promise<Response> {
  const started = await beginMutation(
    dependencies,
    actorUserId,
    input.userId,
    'pin_reset',
    input.requestId,
    input.pin,
  )
  if (!started.ok) return started.response
  if (started.audit.outcome === 'completed' || started.audit.step === 'completed') {
    return json(200, { player: publicPlayer(initial) })
  }

  let step = started.audit.step
  let player = initial
  try {
    if (started.audit.outcome === 'failed') {
      await dependencies.updateAudit(input.requestId, { outcome: 'started', step })
    }
    if (!stepAtLeast(step, 'credential_invalidated')) {
      player = await dependencies.invalidateCredential(input.userId)
      step = 'credential_invalidated'
      await dependencies.updateAudit(input.requestId, { outcome: 'started', step })
    }
    if (!stepAtLeast(step, 'password_changed')) {
      await dependencies.updateAuthPassword(input.userId, input.pin)
      step = 'password_changed'
      await dependencies.updateAudit(input.requestId, { outcome: 'started', step })
    }
    if (!stepAtLeast(step, 'sessions_revoked')) {
      const session = await dependencies.signIn(player.authEmail, input.pin)
      if (!session.accessToken) throw new Error('temporary_session_failed')
      await dependencies.globalSignOut(session.accessToken)
      step = 'sessions_revoked'
      await dependencies.updateAudit(input.requestId, { outcome: 'started', step })
    }
    player = await dependencies.activateAfterReset(input.userId)
    await dependencies.updateAudit(input.requestId, {
      outcome: 'completed',
      step: 'completed',
      completedAt: dependencies.nowIso(),
    })
    return json(200, { player: publicPlayer(player) })
  } catch {
    await safelyMarkFailed(dependencies, input.requestId, step)
    return json(503, { code: 'service_unavailable' })
  }
}

async function handleDeactivate(
  dependencies: ManagePlayerDependencies,
  actorUserId: string,
  input: Extract<ManagePlayerRequest, { action: 'deactivate' }>,
  initial: ManagedPlayerRecord,
): Promise<Response> {
  const started = await beginMutation(
    dependencies,
    actorUserId,
    input.userId,
    'deactivate',
    input.requestId,
    '',
  )
  if (!started.ok) return started.response
  if (started.audit.outcome === 'completed' || started.audit.step === 'completed') {
    return json(200, { player: publicPlayer(initial) })
  }
  try {
    const player = initial.status === 'inactive'
      ? initial
      : await dependencies.deactivatePlayer(input.userId)
    await dependencies.updateAudit(input.requestId, {
      outcome: 'completed',
      step: 'completed',
      completedAt: dependencies.nowIso(),
    })
    return json(200, { player: publicPlayer(player) })
  } catch {
    await safelyMarkFailed(dependencies, input.requestId, 'requested')
    return json(503, { code: 'service_unavailable' })
  }
}

async function handleDelete(
  dependencies: ManagePlayerDependencies,
  actorUserId: string,
  input: Extract<ManagePlayerRequest, { action: 'delete' }>,
): Promise<Response> {
  const started = await beginMutation(
    dependencies,
    actorUserId,
    input.userId,
    'delete',
    input.requestId,
    input.confirmation,
  )
  if (!started.ok) return started.response
  if (started.audit.outcome === 'completed' || started.audit.step === 'completed') {
    return json(200, { deleted: true })
  }
  try {
    const initial = await dependencies.getPlayer(input.userId)
    if (!initial) {
      if (started.created) {
        await safelyMarkFailed(dependencies, input.requestId, 'requested')
        return json(404, { code: 'player_not_found' })
      }
      await dependencies.updateAudit(input.requestId, {
        outcome: 'completed',
        step: 'completed',
        completedAt: dependencies.nowIso(),
      })
      return json(200, { deleted: true })
    }
    if (input.confirmation !== initial.displayName) {
      await safelyMarkFailed(dependencies, input.requestId, 'requested')
      return json(409, { code: 'confirmation_mismatch' })
    }
    await dependencies.deleteAuthUser(input.userId)
    await dependencies.updateAudit(input.requestId, {
      outcome: 'completed',
      step: 'completed',
      completedAt: dependencies.nowIso(),
    })
    return json(200, { deleted: true })
  } catch {
    await safelyMarkFailed(dependencies, input.requestId, 'requested')
    return json(503, { code: 'service_unavailable' })
  }
}

export function createManagePlayerHandler(dependencies: ManagePlayerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json(405, { code: 'method_not_allowed' })
    try {
      const caller = await dependencies.currentUser(request)
      if (!caller) return json(401, { code: 'authentication_required' })
      if (!await dependencies.isActiveOwner(caller.userId)) {
        return json(403, { code: 'owner_required' })
      }

      const input = parseRequest(await requestBody(request))
      if (!input) return json(400, { code: 'invalid_request' })
      if (input.action === 'list') {
        const players = await dependencies.listPlayers()
        return json(200, { players: players.map(publicPlayer) })
      }

      if (input.action === 'delete') {
        return await handleDelete(dependencies, caller.userId, input)
      }

      const player = await dependencies.getPlayer(input.userId)
      if (!player) return json(404, { code: 'player_not_found' })
      switch (input.action) {
        case 'reset-pin':
          return await handleReset(dependencies, caller.userId, input, player)
        case 'deactivate':
          return await handleDeactivate(dependencies, caller.userId, input, player)
      }
    } catch {
      return json(503, { code: 'service_unavailable' })
    }
  }
}
