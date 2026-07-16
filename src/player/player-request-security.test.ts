import { describe, expect, it, vi } from 'vitest'

import {
  verifyCurrentPlayer,
  type PlayerRequestSecurityClients,
} from '../../supabase/functions/_shared/player-request-security.ts'

const USER_ID = '20000000-0000-4000-8000-000000000001'

interface SecurityOptions {
  claims?: Record<string, unknown> | null
  claimsError?: unknown
  row?: Record<string, unknown> | null
  rowError?: unknown
}

function clients(options: SecurityOptions = {}) {
  const calls: string[] = []
  const claims = options.claims === undefined
    ? {
        sub: USER_ID,
        account_kind: 'player',
        player_status: 'active',
        credential_version: 2,
      }
    : options.claims
  const row = options.row === undefined
    ? {
        user_id: USER_ID,
        display_name: '예진',
        status: 'active',
        credential_version: 2,
        force_pin_change: false,
      }
    : options.row
  const query = {
    select(columns: string) { calls.push(`select:${columns}`); return query },
    eq(column: string, value: string) { calls.push(`eq:${column}:${value}`); return query },
    maybeSingle: vi.fn(async () => ({ data: row, error: options.rowError ?? null })),
  }
  const value: PlayerRequestSecurityClients = {
    claimsClient: {
      auth: {
        getClaims: vi.fn(async (token: string) => {
          calls.push(`claims:${token}`)
          return {
            data: claims ? { claims } : null,
            error: options.claimsError ?? null,
          }
        }),
      },
    },
    serviceClient: {
      from: vi.fn((table: string) => {
        calls.push(`from:${table}`)
        return query
      }),
    },
  }
  return { clients: value, calls, query }
}

function request(authorization?: string): Request {
  return new Request('http://local/player-session', {
    headers: authorization ? { authorization } : undefined,
  })
}

describe('current player verification', () => {
  it('keeps the public Auth broker open to publishable-key validation and enables the token hook', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
    const hook = config.split('[auth.hook.custom_access_token]')[1]?.split(/^\[/m)[0] ?? ''
    const playerAuth = config.split('[functions.player-auth]')[1]?.split(/^\[/m)[0] ?? ''

    expect(hook).toMatch(/^enabled = true$/m)
    expect(hook).toMatch(/^uri = "pg-functions:\/\/postgres\/public\/player_access_token_hook"$/m)
    expect(playerAuth).toMatch(/^verify_jwt = false$/m)
  })

  it.each([
    ['missing header', undefined],
    ['wrong scheme', 'Basic token'],
    ['empty token', 'Bearer '],
    ['extra token segment', 'Bearer token extra'],
  ])('rejects %s before calling Auth', async (_label, authorization) => {
    const setup = clients()
    const result = await verifyCurrentPlayer(request(authorization), setup.clients)

    expect(result).toEqual({ ok: false, status: 401, code: 'authentication_required' })
    expect(setup.clients.claimsClient.auth.getClaims).not.toHaveBeenCalled()
  })

  it('rejects a token that Supabase cannot verify', async () => {
    const setup = clients({ claims: null, claimsError: { name: 'AuthInvalidJwtError' } })
    const result = await verifyCurrentPlayer(request('Bearer invalid'), setup.clients)

    expect(result).toEqual({ ok: false, status: 401, code: 'authentication_required' })
    expect(setup.clients.serviceClient.from).not.toHaveBeenCalled()
  })

  it.each([
    ['admin token', { sub: USER_ID, account_kind: 'admin', credential_version: 2, player_status: 'active' }],
    ['missing subject', { account_kind: 'player', credential_version: 2, player_status: 'active' }],
    ['wrong version type', { sub: USER_ID, account_kind: 'player', credential_version: '2', player_status: 'active' }],
    ['inactive claim', { sub: USER_ID, account_kind: 'player', credential_version: 2, player_status: 'inactive' }],
  ])('rejects verified non-current player claims: %s', async (_label, claims) => {
    const setup = clients({ claims })
    const result = await verifyCurrentPlayer(request('Bearer verified'), setup.clients)

    expect(result).toEqual({ ok: false, status: 403, code: 'session_expired' })
    expect(setup.clients.serviceClient.from).not.toHaveBeenCalled()
  })

  it.each([
    ['missing player row', null],
    ['inactive current player', {
      user_id: USER_ID, display_name: '예진', status: 'inactive', credential_version: 2, force_pin_change: false,
    }],
    ['different player row', {
      user_id: '20000000-0000-4000-8000-000000000002', display_name: '예진', status: 'active', credential_version: 2, force_pin_change: false,
    }],
  ])('rejects %s after verified claims', async (_label, row) => {
    const setup = clients({ row })
    const result = await verifyCurrentPlayer(request('Bearer verified'), setup.clients)

    expect(result).toEqual({ ok: false, status: 403, code: 'session_expired' })
  })

  it('rejects an old access token immediately after credential version increases', async () => {
    const setup = clients({ row: {
      user_id: USER_ID,
      display_name: '예진',
      status: 'active',
      credential_version: 3,
      force_pin_change: true,
    } })
    const result = await verifyCurrentPlayer(request('Bearer old-access-token'), setup.clients)

    expect(result).toEqual({ ok: false, status: 403, code: 'session_expired' })
  })

  it('returns only the current public profile after all checks pass', async () => {
    const setup = clients()
    const result = await verifyCurrentPlayer(request('Bearer verified-access-token'), setup.clients)

    expect(result).toEqual({
      ok: true,
      player: {
        userId: USER_ID,
        displayName: '예진',
        credentialVersion: 2,
        forcePinChange: false,
      },
    })
    expect(setup.calls).toEqual([
      'claims:verified-access-token',
      'from:player_profiles',
      'select:user_id,display_name,status,credential_version,force_pin_change',
      `eq:user_id:${USER_ID}`,
    ])
  })

  it('surfaces a database outage for the outer safe error boundary', async () => {
    const setup = clients({ rowError: { message: 'private database error' } })

    await expect(verifyCurrentPlayer(request('Bearer verified'), setup.clients))
      .rejects.toThrow('player_verification_unavailable')
  })
})
