import { withSupabase } from 'npm:@supabase/server@^1'
import { resolveEnv } from 'npm:@supabase/server@^1/core'
import { createClient } from 'npm:@supabase/supabase-js@^2'

import {
  createPlayerAuthHandler,
  type CurrentPlayer,
  type PlayerProfileRow,
} from '../_shared/player-auth-handler.ts'
import { verifyCurrentPlayer } from '../_shared/player-request-security.ts'

type PrivilegedClient = {
  from(table: string): any
  rpc(name: string, parameters: Record<string, unknown>): Promise<{ data: any; error: unknown }>
  auth: {
    admin: {
      createUser(input: Record<string, unknown>): Promise<{ data: { user: { id: string } | null }; error: unknown }>
      deleteUser(userId: string): Promise<{ error: unknown }>
      updateUserById(userId: string, input: Record<string, unknown>): Promise<{ error: unknown }>
      signOut(accessToken: string, scope: 'global'): Promise<{ error: unknown }>
    }
  }
}

interface ProfileRecord extends PlayerProfileRow {
  created_at?: string
}

const PROFILE_COLUMNS = [
  'user_id',
  'display_name',
  'name_key',
  'status',
  'credential_version',
  'force_pin_change',
  'signup_request_id',
].join(',')

function environmentValue(name: string): string | null {
  const value = Deno.env.get(name)
  return value && value.length > 0 ? value : null
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function requesterIp(request: Request): string {
  const candidate = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ?? ''
  return /^[0-9a-f:.]{3,45}$/i.test(candidate) ? candidate : '0.0.0.0'
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

function profileShape(row: ProfileRecord): PlayerProfileRow {
  return {
    user_id: row.user_id,
    display_name: row.display_name,
    name_key: row.name_key,
    status: row.status,
    credential_version: row.credential_version,
    force_pin_change: row.force_pin_change,
    signup_request_id: row.signup_request_id,
  }
}

function currentShape(row: Record<string, unknown>): CurrentPlayer {
  return {
    userId: row.user_id as string,
    displayName: row.display_name as string,
    credentialVersion: row.credential_version as number,
    forcePinChange: row.force_pin_change as boolean,
  }
}

async function findProfile(
  admin: PrivilegedClient,
  column: 'name_key' | 'signup_request_id',
  value: string,
): Promise<(PlayerProfileRow & { auth_email: string }) | null> {
  const profileResult = await admin.from('player_profiles')
    .select(PROFILE_COLUMNS)
    .eq(column, value)
    .maybeSingle()
  if (profileResult.error) throw new Error('profile_lookup_failed')
  if (!profileResult.data) return null

  const aliasResult = await admin.from('player_auth_aliases')
    .select('auth_email')
    .eq('user_id', profileResult.data.user_id)
    .maybeSingle()
  if (aliasResult.error || typeof aliasResult.data?.auth_email !== 'string') {
    throw new Error('profile_alias_failed')
  }
  return { ...profileShape(profileResult.data), auth_email: aliasResult.data.auth_email }
}

function requireResolvedEnvironment() {
  const resolved = resolveEnv()
  const data = resolved.data
  const secretKey = data?.secretKeys.default
  if (resolved.error || !data || typeof secretKey !== 'string' || secretKey.length === 0) {
    throw new Error('player_auth_environment_unavailable')
  }
  return { url: data.url, secretKey }
}

function createSecretClient(headers: Record<string, string> = {}) {
  const environment = requireResolvedEnvironment()
  return createClient(environment.url, environment.secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers,
    },
  })
}

function createPasswordClient(forwardedFor: string) {
  return createSecretClient({ 'sb-forwarded-for': forwardedFor })
}

export default {
  fetch: withSupabase(
    { auth: 'publishable' },
    async (request, context) => {
      const admin = context.supabaseAdmin as unknown as PrivilegedClient
      return createPlayerAuthHandler({
        async requester(input) {
          const pepper = environmentValue('PLAYER_RATE_LIMIT_PEPPER')
          if (!pepper) throw new Error('player_rate_limit_unavailable')
          const forwardedFor = requesterIp(input)
          return {
            forwardedFor,
            fingerprintHash: await sha256(`${forwardedFor}:${utcDay()}:${pepper}`),
          }
        },
        async isFlagEnabled(key) {
          const result = await context.supabase.from('feature_flags')
            .select('enabled')
            .eq('key', key)
            .maybeSingle()
          if (result.error || typeof result.data?.enabled !== 'boolean') {
            throw new Error('player_flag_unavailable')
          }
          return result.data.enabled
        },
        async consume(action, subjectHash, limit, seconds) {
          const result = await admin.rpc('consume_player_auth_limit', {
            p_action: action,
            p_subject_hash: subjectHash,
            p_limit: limit,
            p_window: `${seconds} seconds`,
          })
          const row = Array.isArray(result.data) ? result.data[0] : result.data
          if (
            result.error
            || typeof row?.allowed !== 'boolean'
            || !Number.isSafeInteger(row?.retry_after_seconds)
          ) throw new Error('player_rate_limit_failed')
          return {
            allowed: row.allowed,
            retryAfterSeconds: row.retry_after_seconds,
          }
        },
        findByNameKey: (nameKey) => findProfile(admin, 'name_key', nameKey),
        findByRequestId: (requestId) => findProfile(admin, 'signup_request_id', requestId),
        async createAuthUser(email, pin) {
          const result = await admin.auth.admin.createUser({
            email,
            password: pin,
            email_confirm: true,
          })
          if (result.error || !result.data.user) throw new Error('player_auth_create_failed')
          return { id: result.data.user.id }
        },
        async createProfile(input) {
          const result = await admin.rpc('create_player_profile', {
            p_user_id: input.user_id,
            p_display_name: input.display_name,
            p_name_key: input.name_key,
            p_auth_email: input.auth_email,
            p_privacy_version: input.privacy_version,
            p_over_14_confirmed_at: input.over_14_confirmed_at,
            p_signup_request_id: input.signup_request_id,
          })
          if (result.error || !['created', 'duplicate_name'].includes(result.data)) {
            throw new Error('player_profile_create_failed')
          }
          return result.data as 'created' | 'duplicate_name'
        },
        async deleteAuthUser(userId) {
          const result = await admin.auth.admin.deleteUser(userId)
          if (result.error) throw new Error('player_auth_cleanup_failed')
        },
        async signIn(email, pin, forwardedFor) {
          const result = await createPasswordClient(forwardedFor).auth.signInWithPassword({
            email,
            password: pin,
          })
          const session = result.data.session
          if (result.error || !session) return null
          return {
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: session.expires_at ?? 0,
          }
        },
        verifyCurrentPlayer: (input) => verifyCurrentPlayer(input, {
          claimsClient: context.supabase as any,
          serviceClient: admin,
        }),
        async findAliasByUserId(userId) {
          const result = await admin.from('player_auth_aliases')
            .select('auth_email')
            .eq('user_id', userId)
            .maybeSingle()
          if (result.error) throw new Error('player_alias_lookup_failed')
          return typeof result.data?.auth_email === 'string' ? result.data.auth_email : null
        },
        async updateAuthPassword(userId, pin) {
          const result = await admin.auth.admin.updateUserById(userId, { password: pin })
          if (result.error) throw new Error('player_password_update_failed')
        },
        async bumpCredentialVersion(userId, expectedVersion) {
          const result = await admin.from('player_profiles')
            .update({
              credential_version: expectedVersion + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .eq('credential_version', expectedVersion)
            .eq('force_pin_change', true)
            .select('user_id,display_name,credential_version,force_pin_change')
            .maybeSingle()
          if (result.error || !result.data) throw new Error('credential_bump_failed')
          return currentShape(result.data)
        },
        async globalSignOut(accessToken) {
          const result = await admin.auth.admin.signOut(accessToken, 'global')
          if (result.error) throw new Error('global_signout_failed')
        },
        async clearForcedPinChange(userId, expectedVersion) {
          const postSignOutAdmin = createSecretClient()
          const result = await postSignOutAdmin.from('player_profiles')
            .update({ force_pin_change: false, updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('credential_version', expectedVersion)
            .eq('force_pin_change', true)
            .select('user_id,display_name,credential_version,force_pin_change')
            .maybeSingle()
          if (result.error || !result.data) throw new Error('pin_change_completion_failed')
          return currentShape(result.data)
        },
        nowIso: () => new Date().toISOString(),
        randomUuid: () => crypto.randomUUID(),
      })(request)
    },
  ),
}
