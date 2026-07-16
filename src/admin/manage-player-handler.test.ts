import { describe, expect, it, vi } from 'vitest'

import {
  createManagePlayerHandler,
  type ManagePlayerDependencies,
  type ManagedPlayerRecord,
} from '../../supabase/functions/_shared/manage-player-handler.ts'

const ACTOR_ID = '10000000-0000-4000-8000-000000000001'
const USER_ID = '20000000-0000-4000-8000-000000000001'
const REQUEST_ID = '30000000-0000-4000-8000-000000000001'

const PLAYER: ManagedPlayerRecord = {
  userId: USER_ID,
  displayName: '예진',
  status: 'active',
  forcePinChange: false,
  credentialVersion: 1,
  authEmail: '40000000-0000-4000-8000-000000000001@players.invalid',
  createdAt: '2026-07-16T00:00:00.000Z',
  lastSyncAt: null,
}

type AuditStep = 'requested' | 'credential_invalidated' | 'password_changed' | 'sessions_revoked' | 'completed'

interface DependencyOptions {
  caller?: { userId: string } | null
  owner?: boolean
  target?: ManagedPlayerRecord | null
  auditStep?: AuditStep
  auditCreated?: boolean
  auditConflict?: boolean
  failAt?: 'invalidate' | 'password' | 'sign-in' | 'signout' | 'activate' | 'deactivate' | 'delete'
}

function dependency(options: DependencyOptions = {}) {
  const calls: string[] = []
  const auditCalls: Array<Record<string, unknown>> = []
  let target = options.target === undefined ? { ...PLAYER } : options.target ? { ...options.target } : null
  const dependencies: ManagePlayerDependencies = {
    currentUser: vi.fn(async () => options.caller === undefined ? { userId: ACTOR_ID } : options.caller),
    isActiveOwner: vi.fn(async () => options.owner ?? true),
    listPlayers: vi.fn(async () => target ? [target] : []),
    getPlayer: vi.fn(async () => target),
    fingerprint: vi.fn(async () => 'f'.repeat(64)),
    beginAudit: vi.fn(async (input) => {
      auditCalls.push({ ...input })
      if (options.auditConflict) return { ok: false as const, code: 'request_conflict' as const }
      return {
        ok: true as const,
        created: options.auditCreated ?? options.auditStep === undefined,
        audit: {
          actorUserId: ACTOR_ID,
          targetUserId: USER_ID,
          action: input.action,
          requestId: REQUEST_ID,
          requestFingerprint: input.requestFingerprint,
          outcome: options.auditStep ? 'failed' as const : 'started' as const,
          step: options.auditStep ?? 'requested',
        },
      }
    }),
    updateAudit: vi.fn(async (_requestId, update) => {
      auditCalls.push({ requestId: REQUEST_ID, ...update })
    }),
    invalidateCredential: vi.fn(async () => {
      calls.push('invalidate')
      if (options.failAt === 'invalidate') throw new Error('private invalidation failure')
      if (!target) throw new Error('private missing player')
      target = { ...target, credentialVersion: target.credentialVersion + 1, forcePinChange: true }
      return target
    }),
    updateAuthPassword: vi.fn(async () => {
      calls.push('password')
      if (options.failAt === 'password') throw new Error('private password failure')
    }),
    signIn: vi.fn(async () => {
      calls.push('sign-in')
      if (options.failAt === 'sign-in') throw new Error('private login failure')
      return { accessToken: 'temporary-access-token' }
    }),
    globalSignOut: vi.fn(async () => {
      calls.push('signout')
      if (options.failAt === 'signout') throw new Error('private signout failure')
    }),
    activateAfterReset: vi.fn(async () => {
      calls.push('activate')
      if (options.failAt === 'activate') throw new Error('private activate failure')
      if (!target) throw new Error('private missing player')
      target = { ...target, status: 'active', forcePinChange: true }
      return target
    }),
    deactivatePlayer: vi.fn(async () => {
      calls.push('deactivate')
      if (options.failAt === 'deactivate') throw new Error('private deactivate failure')
      if (!target) throw new Error('private missing player')
      target = {
        ...target,
        status: 'inactive',
        credentialVersion: target.credentialVersion + 1,
        forcePinChange: false,
      }
      return target
    }),
    deleteAuthUser: vi.fn(async () => {
      calls.push('delete')
      if (options.failAt === 'delete') throw new Error('private delete failure')
      target = null
    }),
    nowIso: () => '2026-07-16T01:00:00.000Z',
  }
  return { dependencies, calls, auditCalls, target: () => target }
}

function request(body: unknown, method = 'POST'): Request {
  return new Request('http://local/manage-player', {
    method,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

describe('manage player handler', () => {
  it('keeps the owner function behind platform JWT verification', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
    const section = config.split('[functions.manage-player]')[1]?.split(/^\[/m)[0] ?? ''
    expect(section).toMatch(/^verify_jwt = true$/m)
  })

  it('rejects non-POST requests', async () => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request(null, 'GET'))
    expect(response.status).toBe(405)
    expect(await body(response)).toEqual({ code: 'method_not_allowed' })
  })

  it.each([
    ['missing user', { caller: null }, 401, 'authentication_required'],
    ['non-owner', { owner: false }, 403, 'owner_required'],
  ])('rejects %s before privileged work', async (_label, options, status, code) => {
    const setup = dependency(options)
    const response = await createManagePlayerHandler(setup.dependencies)(request({ action: 'list' }))
    expect(response.status).toBe(status)
    expect(await body(response)).toEqual({ code })
    expect(setup.dependencies.listPlayers).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown action', { action: 'activate', userId: USER_ID }],
    ['extra list key', { action: 'list', email: 'x' }],
    ['invalid UUID', { action: 'deactivate', requestId: 'bad', userId: USER_ID }],
    ['short PIN', { action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID, pin: '2455', pinConfirmation: '2455' }],
    ['mismatched PIN', { action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID, pin: '024550', pinConfirmation: '024551' }],
    ['missing delete confirmation', { action: 'delete', requestId: REQUEST_ID, userId: USER_ID }],
  ])('rejects malformed input: %s', async (_label, input) => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request(input))
    expect(response.status).toBe(400)
    expect(await body(response)).toEqual({ code: 'invalid_request' })
  })

  it('lists only the public operator fields', async () => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request({ action: 'list' }))
    const payload = await body(response)

    expect(response.status).toBe(200)
    expect(payload).toEqual({ players: [{
      userId: USER_ID,
      displayName: '예진',
      status: 'active',
      forcePinChange: false,
      createdAt: '2026-07-16T00:00:00.000Z',
      lastSyncAt: null,
    }] })
    expect(JSON.stringify(payload)).not.toContain('@players.invalid')
    expect(JSON.stringify(payload)).not.toContain('credentialVersion')
  })

  it('runs the complete reset saga and leaves the player ready to choose a new PIN', async () => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID,
      pin: '024550', pinConfirmation: '024550',
    }))

    expect(response.status).toBe(200)
    expect(setup.calls).toEqual(['invalidate', 'password', 'sign-in', 'signout', 'activate'])
    expect(setup.dependencies.updateAuthPassword).toHaveBeenCalledWith(USER_ID, '024550')
    expect(setup.dependencies.signIn).toHaveBeenCalledWith(PLAYER.authEmail, '024550')
    expect(setup.dependencies.globalSignOut).toHaveBeenCalledWith('temporary-access-token')
    expect(await body(response)).toEqual({ player: {
      userId: USER_ID,
      displayName: '예진',
      status: 'active',
      forcePinChange: true,
      createdAt: '2026-07-16T00:00:00.000Z',
      lastSyncAt: null,
    } })
    expect(setup.auditCalls[setup.auditCalls.length - 1]).toEqual({
      requestId: REQUEST_ID,
      outcome: 'completed',
      step: 'completed',
      completedAt: '2026-07-16T01:00:00.000Z',
    })
    expect(JSON.stringify(setup.auditCalls)).not.toContain('024550')
    expect(JSON.stringify(setup.auditCalls)).not.toContain('예진')
    expect(JSON.stringify(setup.auditCalls)).not.toContain('@players.invalid')
  })

  it('resumes a matching reset request from its last completed step', async () => {
    const setup = dependency({ auditStep: 'password_changed' })
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID,
      pin: '024550', pinConfirmation: '024550',
    }))

    expect(response.status).toBe(200)
    expect(setup.calls).toEqual(['sign-in', 'signout', 'activate'])
  })

  it('rejects request-ID reuse with a different target, action, or secret input', async () => {
    const setup = dependency({ auditConflict: true })
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID,
      pin: '024550', pinConfirmation: '024550',
    }))

    expect(response.status).toBe(409)
    expect(await body(response)).toEqual({ code: 'request_conflict' })
    expect(setup.calls).toEqual([])
  })

  it.each(['password', 'signout', 'activate'] as const)(
    'marks a reset failure at %s without reporting success',
    async (failAt) => {
      const setup = dependency({ failAt })
      const response = await createManagePlayerHandler(setup.dependencies)(request({
        action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID,
        pin: '024550', pinConfirmation: '024550',
      }))

      expect(response.status).toBe(503)
      expect(await body(response)).toEqual({ code: 'service_unavailable' })
      expect(setup.auditCalls[setup.auditCalls.length - 1]).toEqual(expect.objectContaining({
        requestId: REQUEST_ID,
        outcome: 'failed',
      }))
    },
  )

  it('reactivates an inactive player only through a completed PIN reset', async () => {
    const setup = dependency({ target: { ...PLAYER, status: 'inactive' } })
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'reset-pin', requestId: REQUEST_ID, userId: USER_ID,
      pin: '024550', pinConfirmation: '024550',
    }))

    expect(response.status).toBe(200)
    expect((await body(response)).player).toEqual(expect.objectContaining({ status: 'active' }))
  })

  it('deactivates a player and increments their credential version', async () => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'deactivate', requestId: REQUEST_ID, userId: USER_ID,
    }))

    expect(response.status).toBe(200)
    expect((await body(response)).player).toEqual(expect.objectContaining({ status: 'inactive' }))
    expect(setup.target()?.credentialVersion).toBe(2)
    expect(setup.auditCalls[setup.auditCalls.length - 1]).toEqual(expect.objectContaining({ outcome: 'completed', step: 'completed' }))
  })

  it('requires the exact profile ID before deleting an Auth user', async () => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'delete', requestId: REQUEST_ID, userId: USER_ID, confirmation: '다른이름',
    }))

    expect(response.status).toBe(409)
    expect(await body(response)).toEqual({ code: 'confirmation_mismatch' })
    expect(setup.dependencies.deleteAuthUser).not.toHaveBeenCalled()
  })

  it('deletes the Auth user and returns no private player data', async () => {
    const setup = dependency()
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'delete', requestId: REQUEST_ID, userId: USER_ID, confirmation: '예진',
    }))

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ deleted: true })
    expect(setup.target()).toBeNull()
    expect(JSON.stringify(setup.auditCalls)).not.toContain('예진')
  })

  it('finishes a matching delete retry after Auth cascade removed the profile', async () => {
    const setup = dependency({ target: null, auditStep: 'requested', auditCreated: false })
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'delete', requestId: REQUEST_ID, userId: USER_ID, confirmation: '예진',
    }))

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ deleted: true })
    expect(setup.dependencies.deleteAuthUser).not.toHaveBeenCalled()
    expect(setup.auditCalls[setup.auditCalls.length - 1]).toEqual(expect.objectContaining({
      outcome: 'completed', step: 'completed',
    }))
  })

  it('does not report a never-existing player as a successful new deletion', async () => {
    const setup = dependency({ target: null, auditCreated: true })
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'delete', requestId: REQUEST_ID, userId: USER_ID, confirmation: '예진',
    }))

    expect(response.status).toBe(404)
    expect(await body(response)).toEqual({ code: 'player_not_found' })
  })

  it('returns a safe failure when Auth deletion does not cascade', async () => {
    const setup = dependency({ failAt: 'delete' })
    const response = await createManagePlayerHandler(setup.dependencies)(request({
      action: 'delete', requestId: REQUEST_ID, userId: USER_ID, confirmation: '예진',
    }))

    expect(response.status).toBe(503)
    expect(await body(response)).toEqual({ code: 'service_unavailable' })
    expect(setup.target()).not.toBeNull()
  })
})
