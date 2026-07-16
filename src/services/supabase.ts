import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { readPublicEnv } from '../env'

export const PUBLIC_SUPABASE_STORAGE_KEY = 'btw.public.auth.v1'
export const PLAYER_SUPABASE_STORAGE_KEY = 'btw.player.auth.v1'
const PLAYER_PKCE_STORAGE_KEY = `${PLAYER_SUPABASE_STORAGE_KEY}-code-verifier`

let publicClient: SupabaseClient | null | undefined
let playerClient: SupabaseClient | null | undefined
let adminClient: SupabaseClient | null | undefined

function settings(): { url: string; publishableKey: string } | null {
  const env = readPublicEnv(import.meta.env)
  return env.mode === 'remote' ? env : null
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

const playerStorage = {
  getItem(key: string): string | null {
    try { return browserStorage()?.getItem(key) ?? null } catch { return null }
  },
  setItem(key: string, value: string): void {
    const storage = browserStorage()
    if (!storage) throw new Error('player_session_storage_unavailable')
    storage.setItem(key, value)
  },
  removeItem(key: string): void {
    const storage = browserStorage()
    if (!storage) throw new Error('player_session_storage_unavailable')
    storage.removeItem(key)
  },
}

export function getPublicSupabase(): SupabaseClient | null {
  if (publicClient !== undefined) return publicClient
  const env = settings()
  if (!env) return (publicClient = null)
  publicClient = createClient(env.url, env.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: PUBLIC_SUPABASE_STORAGE_KEY,
    },
  })
  return publicClient
}

export function getPlayerSupabase(): SupabaseClient | null {
  if (playerClient !== undefined) return playerClient
  const env = settings()
  if (!env) return (playerClient = null)
  playerClient = createClient(env.url, env.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: PLAYER_SUPABASE_STORAGE_KEY,
      storage: playerStorage,
    },
  })
  return playerClient
}

export function getAdminSupabase(): SupabaseClient | null {
  if (adminClient !== undefined) return adminClient
  const env = settings()
  if (!env) return (adminClient = null)
  adminClient = createClient(env.url, env.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return adminClient
}

export function clearPlayerSupabaseSession(): boolean {
  const storage = browserStorage()
  if (!storage) return false
  try {
    storage.removeItem(PLAYER_SUPABASE_STORAGE_KEY)
    storage.removeItem(PLAYER_PKCE_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** Kept until game boot is switched to the explicit public client. */
export const getSupabase = getPublicSupabase
