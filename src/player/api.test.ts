import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PLAYER_PRIVACY_VERSION } from '../../supabase/functions/_shared/player-contract'
import { PlayerApi, createPlayerSyncTransport, type PlayerClient } from './api'

const PROFILE = {
  userId: '10000000-0000-4000-8000-000000000001',
  displayName: '예진',
  forcePinChange: false,
  credentialVersion: 1,
}

const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1_800_000_000,
  profile: PROFILE,
}

function setup() {
  const client = {
    functions: { invoke: vi.fn() },
    auth: {
      setSession: vi.fn(async (): Promise<{
        data: { session: object | null }
        error: Error | null
      }> => ({ data: { session: {} }, error: null })),
      getSession: vi.fn(async (): Promise<{
        data: { session: { access_token: string } | null }
        error: Error | null
      }> => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: {} }, error: null })),
      stopAutoRefresh: vi.fn(),
    },
  }
  const clearPlayerSession = vi.fn(() => true)
  return {
    client,
    clearPlayerSession,
    api: new PlayerApi(client as unknown as PlayerClient, clearPlayerSession),
  }
}

describe('PlayerApi', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('checks profile-name availability with an exact response', async () => {
    const { api, client } = setup()
    client.functions.invoke.mockResolvedValue({ data: { available: true }, error: null })

    await expect(api.checkName('예진')).resolves.toEqual({ ok: true, data: true })
    expect(client.functions.invoke).toHaveBeenCalledWith('player-auth', {
      body: { action: 'check-name', profileName: '예진' },
    })

    client.functions.invoke.mockResolvedValue({ data: { available: true, extra: true }, error: null })
    await expect(api.checkName('예진')).resolves.toMatchObject({
      ok: false,
      error: { code: 'service_unavailable' },
    })
  })

  it('creates a profile, stores only its session, and returns no tokens', async () => {
    const { api, client } = setup()
    client.functions.invoke.mockResolvedValue({ data: SESSION, error: null })

    const result = await api.create({
      requestId: '20000000-0000-4000-8000-000000000001',
      profileName: '예진',
      pin: '024550',
      pinConfirmation: '024550',
      over14: true,
    })

    expect(client.functions.invoke).toHaveBeenCalledWith('player-auth', { body: {
      action: 'create',
      requestId: '20000000-0000-4000-8000-000000000001',
      profileName: '예진',
      pin: '024550',
      pinConfirmation: '024550',
      privacyVersion: PLAYER_PRIVACY_VERSION,
      over14: true,
    } })
    expect(client.auth.setSession).toHaveBeenCalledWith({
      access_token: 'access', refresh_token: 'refresh',
    })
    expect(result).toEqual({ ok: true, data: PROFILE })
    expect(JSON.stringify(result)).not.toContain('access')
  })

  it('logs in with the generic credential message and preserves rate limiting', async () => {
    const { api, client } = setup()
    client.functions.invoke.mockResolvedValueOnce({ data: SESSION, error: null })
    await expect(api.login('예진', '024550')).resolves.toEqual({ ok: true, data: PROFILE })

    client.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ code: 'login_failed' }), { status: 401 }) },
    })
    await expect(api.login('없는ID', '024550')).resolves.toEqual({
      ok: false,
      error: { code: 'login_failed', message: 'ID 또는 PIN을 다시 확인해 주세요.' },
    })

    client.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ code: 'rate_limited', retryAfterSeconds: 31 }), { status: 429 }) },
    })
    await expect(api.login('예진', '024550')).resolves.toEqual({
      ok: false,
      error: { code: 'rate_limited', message: '잠시 뒤 다시 시도해 주세요.', retryAfterSeconds: 31 },
    })
  })

  it('rejects malformed session payloads and setSession failures', async () => {
    const { api, client } = setup()
    client.functions.invoke.mockResolvedValueOnce({ data: { ...SESSION, extra: true }, error: null })
    await expect(api.login('예진', '024550')).resolves.toMatchObject({
      ok: false, error: { code: 'login_failed' },
    })

    client.functions.invoke.mockResolvedValueOnce({ data: SESSION, error: null })
    client.auth.setSession.mockResolvedValueOnce({ data: { session: null }, error: new Error('blocked') })
    await expect(api.login('예진', '024550')).resolves.toMatchObject({
      ok: false, error: { code: 'service_unavailable' },
    })
  })

  it('restores a valid player session and clears an expired one locally', async () => {
    const { api, client, clearPlayerSession } = setup()
    client.auth.getSession.mockResolvedValue({
      data: { session: { access_token: 'stored' } }, error: null,
    })
    client.functions.invoke.mockResolvedValueOnce({ data: { profile: PROFILE }, error: null })
    await expect(api.restoreSession()).resolves.toEqual({ ok: true, data: PROFILE })

    client.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ code: 'session_expired' }), { status: 403 }) },
    })
    await expect(api.restoreSession()).resolves.toEqual({ ok: true, data: null })
    expect(clearPlayerSession).toHaveBeenCalledOnce()
  })

  it('changes a forced PIN and replaces the persisted session', async () => {
    const { api, client } = setup()
    client.functions.invoke.mockResolvedValue({
      data: { ...SESSION, profile: { ...PROFILE, credentialVersion: 2 } },
      error: null,
    })

    await expect(api.changePin('246802', '246802')).resolves.toMatchObject({
      ok: true, data: { credentialVersion: 2 },
    })
    expect(client.functions.invoke).toHaveBeenCalledWith('player-auth', {
      body: { action: 'change-pin', pin: '246802', pinConfirmation: '246802' },
    })
    expect(client.auth.setSession).toHaveBeenCalledOnce()
  })

  it('uses local-scope logout and falls back to removing only the player session offline', async () => {
    const { api, client, clearPlayerSession } = setup()
    await expect(api.signOut()).resolves.toEqual({ ok: true, data: null })
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(clearPlayerSession).not.toHaveBeenCalled()

    client.auth.signOut.mockRejectedValueOnce(new Error('offline'))
    await expect(api.signOut()).resolves.toEqual({ ok: true, data: null })
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledOnce()
    expect(clearPlayerSession).toHaveBeenCalledOnce()

    client.auth.signOut.mockRejectedValueOnce(new Error('offline'))
    clearPlayerSession.mockReturnValueOnce(false)
    await expect(api.signOut()).resolves.toEqual({
      ok: false,
      error: { code: 'service_unavailable', message: '이 기기에서 로그아웃을 다시 눌러 주세요.' },
    })
  })

  it('returns offline results without a client and contains thrown function errors', async () => {
    const offline = new PlayerApi(null, () => true)
    await expect(offline.login('예진', '024550')).resolves.toMatchObject({
      ok: false, error: { code: 'offline' },
    })

    const { api, client } = setup()
    client.functions.invoke.mockRejectedValue(new Error('network'))
    await expect(api.checkName('예진')).resolves.toMatchObject({
      ok: false, error: { code: 'service_unavailable' },
    })
  })

  it('maps the authenticated sync function response and database retry time', async () => {
    const { client } = setup()
    const sync = createPlayerSyncTransport(client as unknown as PlayerClient)
    const request = { deviceId: '10000000-0000-4000-8000-000000000002', previousSeq: 0, operations: [], knownRevision: 0 }
    client.functions.invoke.mockResolvedValueOnce({ data: { revision: 1 }, error: null })
    await expect(sync.send(request)).resolves.toEqual({ status: 200, body: { revision: 1 } })
    expect(client.functions.invoke).toHaveBeenCalledWith('player-sync', { body: request })

    client.functions.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ code: 'rate_limited', retryAfterSeconds: 9 }), { status: 429 }) },
    })
    await expect(sync.send(request)).resolves.toEqual({
      status: 429,
      body: { code: 'rate_limited', retryAfterSeconds: 9 },
      retryAfterSeconds: 9,
    })
    await expect(sync.refreshSession()).resolves.toBe(true)
    expect(client.auth.refreshSession).toHaveBeenCalledOnce()
  })
})
