import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

describe('isolated Supabase clients', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.createClient.mockReset()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns null factories without complete public settings', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')
    const service = await import('./supabase')

    expect(service.getPublicSupabase()).toBeNull()
    expect(service.getPlayerSupabase()).toBeNull()
    expect(service.getAdminSupabase()).toBeNull()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('creates three cached clients with separate persistence policies', async () => {
    const clients = [{ kind: 'public' }, { kind: 'player' }, { kind: 'admin' }]
    clients.forEach((client) => mocks.createClient.mockReturnValueOnce(client))
    vi.stubGlobal('localStorage', memoryStorage())
    const service = await import('./supabase')

    expect(service.getPublicSupabase()).toBe(clients[0])
    expect(service.getPlayerSupabase()).toBe(clients[1])
    expect(service.getAdminSupabase()).toBe(clients[2])
    expect(service.getPublicSupabase()).toBe(clients[0])
    expect(mocks.createClient).toHaveBeenCalledTimes(3)

    const publicOptions = mocks.createClient.mock.calls[0][2]
    const playerOptions = mocks.createClient.mock.calls[1][2]
    const adminOptions = mocks.createClient.mock.calls[2][2]
    expect(publicOptions.auth).toMatchObject({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'btw.public.auth.v1',
    })
    expect(playerOptions.auth).toMatchObject({
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'btw.player.auth.v1',
    })
    expect(adminOptions.auth).toEqual({
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    })
  })

  it('clears only the two player session keys', async () => {
    const storage = memoryStorage()
    storage.setItem('btw.player.auth.v1', 'player')
    storage.setItem('btw.player.auth.v1-code-verifier', 'verifier')
    storage.setItem('btw.public.auth.v1', 'public')
    storage.setItem('sb-example-auth-token', 'admin')
    vi.stubGlobal('localStorage', storage)
    const { clearPlayerSupabaseSession } = await import('./supabase')

    expect(clearPlayerSupabaseSession()).toBe(true)
    expect(storage.removeItem.mock.calls.map(([key]) => key)).toEqual([
      'btw.player.auth.v1',
      'btw.player.auth.v1-code-verifier',
    ])
    expect(storage.values.get('btw.public.auth.v1')).toBe('public')
    expect(storage.values.get('sb-example-auth-token')).toBe('admin')
  })

  it('reports a blocked player-session removal without touching other keys', async () => {
    const storage = memoryStorage()
    storage.removeItem.mockImplementationOnce(() => { throw new Error('blocked') })
    vi.stubGlobal('localStorage', storage)
    const { clearPlayerSupabaseSession } = await import('./supabase')

    expect(clearPlayerSupabaseSession()).toBe(false)
    expect(storage.removeItem).toHaveBeenCalledTimes(1)
  })
})
