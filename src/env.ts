export type PublicEnv =
  | { mode: 'offline'; url: null; publishableKey: null }
  | { mode: 'remote'; url: string; publishableKey: string }

const OFFLINE_ENV: PublicEnv = {
  mode: 'offline',
  url: null,
  publishableKey: null,
}

export function readPublicEnv(env: Record<string, string | undefined>): PublicEnv {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

  if (!url || !publishableKey) return OFFLINE_ENV
  if (!publishableKey.startsWith('sb_publishable_')) return OFFLINE_ENV

  try {
    const parsed = new URL(url)
    const localDev =
      parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)

    if (parsed.protocol !== 'https:' && !localDev) return OFFLINE_ENV
  } catch {
    return OFFLINE_ENV
  }

  return { mode: 'remote', url, publishableKey }
}
