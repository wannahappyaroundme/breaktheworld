import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { readPublicEnv } from '../env'

let client: SupabaseClient | null | undefined

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client

  const env = readPublicEnv(import.meta.env)
  if (env.mode === 'offline') {
    client = null
    return client
  }

  client = createClient(env.url, env.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return client
}
