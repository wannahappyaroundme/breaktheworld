import { describe, expect, it, vi } from 'vitest'

import {
  createPlayerAuthHandler,
  type PlayerAuthDependencies,
  type PlayerProfileRow,
} from '../../supabase/functions/_shared/player-auth-handler.ts'

const USER_ID = '20000000-0000-4000-8000-000000000001'
const REQUEST_ID = '30000000-0000-4000-8000-000000000001'
const ALIAS_ID = '40000000-0000-4000-8000-000000000001'

const ACTIVE_PROFILE: PlayerProfileRow & { auth_email: string } = {
  user_id: USER_ID,
  display_name: 'Yejin',
  name_key: 'yejin',
  status: 'active',
  credential_version: 1,
  force_pin_change: false,
  signup_request_id: REQUEST_ID,
  auth_email: `${ALIAS_ID}@players.invalid`,
}

const SESSION = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: 1_800_000_000,
}

interface DependencyOptions {
  profile?: (PlayerProfileRow & { auth_email: string }) | null
  requestProfile?: (PlayerProfileRow & { auth_email: string }) | null
  signupOpen?: boolean
  deniedAction?: 'check_name' | 'signup' | 'login_name' | 'login_requester'
  createResult?: 'created' | 'duplicate_name'
  signInFails?: boolean
  forcedPinChange?: boolean
  changeFailureAt?: 'password' | 'bump' | 'signout' | 'clear'
  throwAt?: 'requester' | 'find' | 'create-auth' | 'create-profile' | 'sign-in'
}

function dependency(options: DependencyOptions = {}) {
  const calls: string[] = []
  const profile = options.profile === undefined ? ACTIVE_PROFILE : options.profile
  const requestProfile = options.requestProfile ?? null
  const dependencies: PlayerAuthDependencies = {
    requester: vi.fn(async () => {
      calls.push('requester')
      if (options.throwAt === 'requester') throw new Error('private requester failure')
      return { forwardedFor: '192.0.2.1', fingerprintHash: 'a'.repeat(64) }
    }),
    isFlagEnabled: vi.fn(async () => options.signupOpen ?? true),
    consume: vi.fn(async (action, _subjectHash, limit, seconds) => {
      calls.push(`consume:${action}:${limit}:${seconds}`)
      return action === options.deniedAction
        ? { allowed: false, retryAfterSeconds: 37 }
        : { allowed: true, retryAfterSeconds: 0 }
    }),
    findByNameKey: vi.fn(async () => {
      calls.push('find-name')
      if (options.throwAt === 'find') throw new Error('private database failure')
      return profile
    }),
    findByRequestId: vi.fn(async () => requestProfile),
    createAuthUser: vi.fn(async () => {
      calls.push('create-auth')
      if (options.throwAt === 'create-auth') throw new Error('private auth failure')
      return { id: USER_ID }
    }),
    createProfile: vi.fn(async () => {
      calls.push('create-profile')
      if (options.throwAt === 'create-profile') throw new Error('private insert failure')
      return options.createResult ?? 'created'
    }),
    deleteAuthUser: vi.fn(async () => { calls.push('delete-auth') }),
    signIn: vi.fn(async (_email, _pin, forwardedFor) => {
      calls.push(`sign-in:${forwardedFor}`)
      if (options.throwAt === 'sign-in') throw new Error('private sign-in failure')
      return options.signInFails ? null : SESSION
    }),
    verifyCurrentPlayer: vi.fn(async () => {
      calls.push('verify-current')
      return {
        ok: true as const,
        player: {
          userId: USER_ID,
          displayName: 'Yejin',
          credentialVersion: 1,
          forcePinChange: options.forcedPinChange ?? false,
        },
      }
    }),
    findAliasByUserId: vi.fn(async () => {
      calls.push('find-alias')
      return `${ALIAS_ID}@players.invalid`
    }),
    updateAuthPassword: vi.fn(async (userId: string) => {
      calls.push(`update-password:${userId}`)
      if (options.changeFailureAt === 'password') throw new Error('private password failure')
    }),
    bumpCredentialVersion: vi.fn(async (_userId: string, expectedVersion: number) => {
      calls.push(`bump-version:${expectedVersion}`)
      if (options.changeFailureAt === 'bump') throw new Error('private version failure')
      return {
        userId: USER_ID,
        displayName: 'Yejin',
        credentialVersion: expectedVersion + 1,
        forcePinChange: true,
      }
    }),
    globalSignOut: vi.fn(async () => {
      calls.push('global-signout')
      if (options.changeFailureAt === 'signout') throw new Error('private signout failure')
    }),
    clearForcedPinChange: vi.fn(async (_userId: string, expectedVersion: number) => {
      calls.push(`clear-force:${expectedVersion}`)
      if (options.changeFailureAt === 'clear') throw new Error('private profile failure')
      return {
        userId: USER_ID,
        displayName: 'Yejin',
        credentialVersion: expectedVersion,
        forcePinChange: false,
      }
    }),
    nowIso: () => '2026-07-16T00:00:00.000Z',
    randomUuid: () => ALIAS_ID,
  }
  return { dependencies, calls }
}

function request(body: unknown, method = 'POST'): Request {
  return new Request('http://local/player-auth', {
    method,
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

describe('player auth handler', () => {
  it('returns JSON without caching and rejects non-POST requests', async () => {
    const { dependencies } = dependency()
    const response = await createPlayerAuthHandler(dependencies)(request(null, 'GET'))

    expect(response.status).toBe(405)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await body(response)).toEqual({ code: 'method_not_allowed' })
  })

  it.each([
    ['invalid JSON', '{'],
    ['unknown key', { action: 'login', profileName: 'Yejin', pin: '024550', email: 'x' }],
    ['bad name', { action: 'check-name', profileName: '예 진' }],
    ['bad PIN', { action: 'login', profileName: 'Yejin', pin: '24550' }],
  ])('rejects malformed input: %s', async (_label, input) => {
    const { dependencies } = dependency()
    const rawRequest = typeof input === 'string'
      ? new Request('http://local/player-auth', { method: 'POST', body: input })
      : request(input)
    const response = await createPlayerAuthHandler(dependencies)(rawRequest)

    expect(response.status).toBe(400)
    expect(await body(response)).toEqual({ code: 'invalid_request' })
  })

  it.each([
    [null, true],
    [ACTIVE_PROFILE, false],
  ])('checks a normalized name with the requester limit', async (profile, available) => {
    const { dependencies, calls } = dependency({ profile })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'check-name', profileName: 'Yejin',
    }))

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({ available })
    expect(calls).toContain('consume:check_name:30:60')
    expect(dependencies.findByNameKey).toHaveBeenCalledWith('yejin')
  })

  it('returns the database retry time when a limiter is exhausted', async () => {
    const { dependencies } = dependency({ deniedAction: 'check_name' })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'check-name', profileName: 'Yejin',
    }))

    expect(response.status).toBe(429)
    expect(await body(response)).toEqual({ code: 'rate_limited', retryAfterSeconds: 37 })
    expect(dependencies.findByNameKey).not.toHaveBeenCalled()
  })

  it('keeps profile creation closed behind the player signup flag', async () => {
    const { dependencies } = dependency({ signupOpen: false, profile: null })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'create', requestId: REQUEST_ID, profileName: 'Yejin',
      pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true,
    }))

    expect(response.status).toBe(503)
    expect(await body(response)).toEqual({ code: 'signup_closed' })
    expect(dependencies.createAuthUser).not.toHaveBeenCalled()
  })

  it('creates an Auth user and private profile, then returns only the public session', async () => {
    const { dependencies, calls } = dependency({ profile: null })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'create', requestId: REQUEST_ID, profileName: 'Yejin',
      pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true,
    }))

    expect(response.status).toBe(201)
    const payload = await body(response)
    expect(payload).toEqual({
      accessToken: SESSION.access_token,
      refreshToken: SESSION.refresh_token,
      expiresAt: SESSION.expires_at,
      profile: {
        userId: USER_ID,
        displayName: 'Yejin',
        forcePinChange: false,
        credentialVersion: 1,
      },
    })
    expect(calls).toContain('consume:signup:5:3600')
    expect(dependencies.createAuthUser).toHaveBeenCalledWith(`${ALIAS_ID}@players.invalid`, '024550')
    expect(dependencies.createProfile).toHaveBeenCalledWith(expect.objectContaining({
      user_id: USER_ID,
      display_name: 'Yejin',
      name_key: 'yejin',
      auth_email: `${ALIAS_ID}@players.invalid`,
      privacy_version: 1,
      over_14_confirmed_at: '2026-07-16T00:00:00.000Z',
      signup_request_id: REQUEST_ID,
    }))
    expect(JSON.stringify(payload)).not.toContain('@players.invalid')
    expect(JSON.stringify(payload)).not.toContain('024550')
  })

  it('rejects a known duplicate before creating an Auth user', async () => {
    const { dependencies } = dependency()
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'create', requestId: REQUEST_ID, profileName: 'Yejin',
      pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true,
    }))

    expect(response.status).toBe(409)
    expect(await body(response)).toEqual({ code: 'name_taken' })
    expect(dependencies.createAuthUser).not.toHaveBeenCalled()
  })

  it('deletes the new Auth user when the database wins a duplicate race', async () => {
    const { dependencies, calls } = dependency({ profile: null, createResult: 'duplicate_name' })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'create', requestId: REQUEST_ID, profileName: 'Yejin',
      pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true,
    }))

    expect(response.status).toBe(409)
    expect(await body(response)).toEqual({ code: 'name_taken' })
    expect(calls).toContain('delete-auth')
  })

  it('cleans up an orphan Auth user after a profile insert failure', async () => {
    const { dependencies, calls } = dependency({ profile: null, throwAt: 'create-profile' })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'create', requestId: REQUEST_ID, profileName: 'Yejin',
      pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true,
    }))

    expect(response.status).toBe(503)
    expect(await body(response)).toEqual({ code: 'service_unavailable' })
    expect(calls).toContain('delete-auth')
  })

  it('resumes the same signup request without creating a second Auth user', async () => {
    const { dependencies } = dependency({ profile: null, requestProfile: ACTIVE_PROFILE })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'create', requestId: REQUEST_ID, profileName: 'Yejin',
      pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true,
    }))

    expect(response.status).toBe(200)
    expect((await body(response)).profile).toEqual(expect.objectContaining({ userId: USER_ID }))
    expect(dependencies.createAuthUser).not.toHaveBeenCalled()
  })

  it('returns a generic login failure for missing, inactive, and wrong-PIN profiles', async () => {
    for (const options of [
      { profile: null },
      { profile: { ...ACTIVE_PROFILE, status: 'inactive' as const } },
      { signInFails: true },
    ]) {
      const { dependencies } = dependency(options)
      const response = await createPlayerAuthHandler(dependencies)(request({
        action: 'login', profileName: 'Yejin', pin: '024550',
      }))
      expect(response.status).toBe(401)
      expect(await body(response)).toEqual({ code: 'login_failed' })
    }
  })

  it('consumes both login buckets before Auth and returns a public session', async () => {
    const { dependencies, calls } = dependency()
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'login', profileName: 'Yejin', pin: '024550',
    }))

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual(expect.objectContaining({
      accessToken: SESSION.access_token,
      profile: expect.objectContaining({ displayName: 'Yejin' }),
    }))
    expect(calls).toContain('consume:login_requester:20:3600')
    expect(calls).toContain('consume:login_name:5:900')
    expect(calls).toContain('sign-in:192.0.2.1')
  })

  it('restores only the current public player profile', async () => {
    const { dependencies } = dependency()
    const response = await createPlayerAuthHandler(dependencies)(request({ action: 'session' }))

    expect(response.status).toBe(200)
    expect(await body(response)).toEqual({
      profile: {
        userId: USER_ID,
        displayName: 'Yejin',
        forcePinChange: false,
        credentialVersion: 1,
      },
    })
  })

  it('requires an owner-reset profile before changing the temporary PIN', async () => {
    const { dependencies } = dependency({ forcedPinChange: false })
    const response = await createPlayerAuthHandler(dependencies)(new Request('http://local/player-auth', {
      method: 'POST',
      headers: { authorization: 'Bearer current-access-token' },
      body: JSON.stringify({ action: 'change-pin', pin: '246802', pinConfirmation: '246802' }),
    }))

    expect(response.status).toBe(409)
    expect(await body(response)).toEqual({ code: 'change_not_required' })
    expect(dependencies.updateAuthPassword).not.toHaveBeenCalled()
  })

  it('changes a forced PIN, invalidates every old session, and returns the replacement session', async () => {
    const { dependencies, calls } = dependency({ forcedPinChange: true })
    const response = await createPlayerAuthHandler(dependencies)(new Request('http://local/player-auth', {
      method: 'POST',
      headers: { authorization: 'Bearer current-access-token' },
      body: JSON.stringify({ action: 'change-pin', pin: '246802', pinConfirmation: '246802' }),
    }))

    expect(response.status).toBe(200)
    const payload = await body(response)
    expect(payload).toEqual({
      accessToken: SESSION.access_token,
      refreshToken: SESSION.refresh_token,
      expiresAt: SESSION.expires_at,
      profile: {
        userId: USER_ID,
        displayName: 'Yejin',
        forcePinChange: false,
        credentialVersion: 2,
      },
    })
    expect(calls).toEqual([
      'verify-current',
      'find-alias',
      'bump-version:1',
      `update-password:${USER_ID}`,
      'requester',
      'sign-in:192.0.2.1',
      'global-signout',
      'clear-force:2',
      'sign-in:192.0.2.1',
    ])
    expect(dependencies.updateAuthPassword).toHaveBeenCalledWith(USER_ID, '246802')
    expect(dependencies.globalSignOut).toHaveBeenCalledWith(SESSION.access_token)
    expect(dependencies.signIn).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(payload)).not.toContain('@players.invalid')
    expect(JSON.stringify(payload)).not.toContain('246802')
  })

  it.each(['password', 'bump', 'signout', 'clear'] as const)(
    'returns a safe retryable failure when PIN change stops at %s',
    async (changeFailureAt) => {
      const { dependencies } = dependency({ forcedPinChange: true, changeFailureAt })
      const response = await createPlayerAuthHandler(dependencies)(new Request('http://local/player-auth', {
        method: 'POST',
        headers: { authorization: 'Bearer current-access-token' },
        body: JSON.stringify({ action: 'change-pin', pin: '246802', pinConfirmation: '246802' }),
      }))

      expect(response.status).toBe(503)
      expect(await body(response)).toEqual({ code: 'service_unavailable' })
    },
  )

  it('never returns dependency errors or credential values', async () => {
    const { dependencies } = dependency({ throwAt: 'sign-in' })
    const response = await createPlayerAuthHandler(dependencies)(request({
      action: 'login', profileName: 'Yejin', pin: '024550',
    }))
    const serialized = JSON.stringify(await body(response))

    expect(response.status).toBe(503)
    expect(serialized).toBe('{"code":"service_unavailable"}')
    expect(serialized).not.toContain('Yejin')
    expect(serialized).not.toContain('024550')
    expect(serialized).not.toContain('private sign-in failure')
  })
})
