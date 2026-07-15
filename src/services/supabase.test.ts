import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

describe('getSupabase', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.createClient.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns null without complete public settings', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '')

    const { getSupabase } = await import('./supabase')

    expect(getSupabase()).toBeNull()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('creates one persistent browser client only when first requested', async () => {
    const client = { kind: 'supabase-client' }
    mocks.createClient.mockReturnValue(client)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')

    const { getSupabase } = await import('./supabase')

    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(getSupabase()).toBe(client)
    expect(getSupabase()).toBe(client)
    expect(mocks.createClient).toHaveBeenCalledTimes(1)
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      },
    )
  })
})
