import { describe, expect, it } from 'vitest'

import { readPublicEnv } from './env'

const OFFLINE_ENV = {
  mode: 'offline',
  url: null,
  publishableKey: null,
} as const

describe('readPublicEnv', () => {
  it('stays offline when public settings are absent', () => {
    expect(readPublicEnv({})).toEqual(OFFLINE_ENV)
  })

  it('stays offline when only one public setting is present', () => {
    expect(readPublicEnv({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toEqual(
      OFFLINE_ENV,
    )
    expect(readPublicEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' })).toEqual(
      OFFLINE_ENV,
    )
  })

  it('stays offline for malformed and unsafe URLs', () => {
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: 'not a url',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }),
    ).toEqual(OFFLINE_ENV)
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: 'javascript:alert(1)',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }),
    ).toEqual(OFFLINE_ENV)
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: 'http://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }),
    ).toEqual(OFFLINE_ENV)
  })

  it.each(['sb_secret_test', 'service_role_test', 'eyJhbGciOiJIUzI1NiJ9.test.signature'])(
    'stays offline when the browser key is not a publishable key: %s',
    (publishableKey) => {
      expect(
        readPublicEnv({
          VITE_SUPABASE_URL: 'https://example.supabase.co',
          VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey,
        }),
      ).toEqual(OFFLINE_ENV)
    },
  )

  it('accepts an HTTPS remote endpoint and trims both public values', () => {
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: ' https://example.supabase.co/path ',
        VITE_SUPABASE_PUBLISHABLE_KEY: ' sb_publishable_test ',
      }),
    ).toEqual({
      mode: 'remote',
      url: 'https://example.supabase.co/path',
      publishableKey: 'sb_publishable_test',
    })
  })

  it.each(['127.0.0.1', 'localhost'])(
    'accepts a local HTTP endpoint on %s for local Supabase',
    (hostname) => {
      expect(
        readPublicEnv({
          VITE_SUPABASE_URL: `http://${hostname}:54321`,
          VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
        }),
      ).toEqual({
        mode: 'remote',
        url: `http://${hostname}:54321`,
        publishableKey: 'sb_publishable_test',
      })
    },
  )

  it('keeps non-loopback HTTP hosts offline even when the name contains localhost', () => {
    expect(
      readPublicEnv({
        VITE_SUPABASE_URL: 'http://localhost.example.com:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }),
    ).toEqual(OFFLINE_ENV)
  })
})
