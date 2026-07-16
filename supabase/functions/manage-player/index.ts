import { withSupabase } from 'npm:@supabase/server@^1'
import { resolveEnv } from 'npm:@supabase/server@^1/core'
import { createClient } from 'npm:@supabase/supabase-js@^2'

import {
  createManagePlayerHandler,
  type ManagedPlayerRecord,
  type PlayerAdminAction,
  type PlayerAdminAudit,
  type PlayerAdminStep,
} from '../_shared/manage-player-handler.ts'

type SupabaseLike = {
  from(table: string): any
  auth: {
    admin: {
      updateUserById(userId: string, input: Record<string, unknown>): Promise<{ error: unknown }>
      signOut(accessToken: string, scope: 'global'): Promise<{ error: unknown }>
      deleteUser(userId: string): Promise<{ error: unknown }>
    }
  }
}

const PROFILE_COLUMNS = [
  'user_id',
  'display_name',
  'status',
  'credential_version',
  'force_pin_change',
  'created_at',
].join(',')

const AUDIT_COLUMNS = [
  'actor_user_id',
  'target_user_id',
  'action',
  'request_id',
  'request_fingerprint',
  'outcome',
  'step',
].join(',')

function environmentValue(name: string): string | null {
  const value = Deno.env.get(name)
  return value && value.length > 0 ? value : null
}

async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function passwordClient() {
  const resolved = resolveEnv()
  const data = resolved.data
  const secretKey = data?.secretKeys.default
  if (resolved.error || !data || typeof secretKey !== 'string' || secretKey.length === 0) {
    throw new Error('manage_player_environment_unavailable')
  }
  return createClient(data.url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function auditShape(row: Record<string, unknown>): PlayerAdminAudit {
  return {
    actorUserId: row.actor_user_id as string,
    targetUserId: row.target_user_id as string,
    action: row.action as PlayerAdminAction,
    requestId: row.request_id as string,
    requestFingerprint: row.request_fingerprint as string,
    outcome: row.outcome as PlayerAdminAudit['outcome'],
    step: row.step as PlayerAdminStep,
  }
}

function auditMatches(
  audit: PlayerAdminAudit,
  input: {
    actorUserId: string
    targetUserId: string
    action: PlayerAdminAction
    requestId: string
    requestFingerprint: string
  },
): boolean {
  return audit.actorUserId === input.actorUserId
    && audit.targetUserId === input.targetUserId
    && audit.action === input.action
    && audit.requestId === input.requestId
    && audit.requestFingerprint === input.requestFingerprint
}

async function aliasFor(admin: SupabaseLike, userId: string): Promise<string> {
  const result = await admin.from('player_auth_aliases')
    .select('auth_email')
    .eq('user_id', userId)
    .maybeSingle()
  if (result.error || typeof result.data?.auth_email !== 'string') {
    throw new Error('managed_player_alias_unavailable')
  }
  return result.data.auth_email
}

async function playerFor(admin: SupabaseLike, userId: string): Promise<ManagedPlayerRecord | null> {
  const result = await admin.from('player_profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle()
  if (result.error) throw new Error('managed_player_lookup_failed')
  if (!result.data) return null
  return {
    userId: result.data.user_id,
    displayName: result.data.display_name,
    status: result.data.status,
    forcePinChange: result.data.force_pin_change,
    credentialVersion: result.data.credential_version,
    authEmail: await aliasFor(admin, userId),
    createdAt: result.data.created_at,
    lastSyncAt: null,
  }
}

async function updatedPlayer(
  admin: SupabaseLike,
  userId: string,
  values: Record<string, unknown>,
  expectedVersion?: number,
): Promise<ManagedPlayerRecord> {
  let query = admin.from('player_profiles')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (expectedVersion !== undefined) query = query.eq('credential_version', expectedVersion)
  const result = await query.select(PROFILE_COLUMNS).maybeSingle()
  if (result.error || !result.data) throw new Error('managed_player_update_failed')
  return {
    userId: result.data.user_id,
    displayName: result.data.display_name,
    status: result.data.status,
    forcePinChange: result.data.force_pin_change,
    credentialVersion: result.data.credential_version,
    authEmail: await aliasFor(admin, userId),
    createdAt: result.data.created_at,
    lastSyncAt: null,
  }
}

export default {
  fetch: withSupabase(
    { auth: 'user' },
    async (request, context) => {
      const admin = context.supabaseAdmin as unknown as SupabaseLike
      const callerId = context.userClaims?.id ?? null
      return createManagePlayerHandler({
        async currentUser() {
          return typeof callerId === 'string' ? { userId: callerId } : null
        },
        async isActiveOwner(userId) {
          const result = await context.supabase.from('admin_users')
            .select('user_id,role,active')
            .eq('user_id', userId)
            .maybeSingle()
          return !result.error
            && result.data?.user_id === userId
            && result.data.role === 'owner'
            && result.data.active === true
        },
        async listPlayers() {
          const result = await admin.from('player_profiles')
            .select(PROFILE_COLUMNS)
            .order('created_at', { ascending: false })
          if (result.error || !Array.isArray(result.data)) {
            throw new Error('managed_player_list_failed')
          }
          return result.data.map((row: Record<string, any>) => ({
            userId: row.user_id,
            displayName: row.display_name,
            status: row.status,
            forcePinChange: row.force_pin_change,
            credentialVersion: row.credential_version,
            authEmail: '',
            createdAt: row.created_at,
            lastSyncAt: null,
          }))
        },
        getPlayer: (userId) => playerFor(admin, userId),
        async fingerprint(value) {
          const pepper = environmentValue('PLAYER_ADMIN_REQUEST_PEPPER')
          if (!pepper) throw new Error('manage_player_fingerprint_unavailable')
          return hmacSha256(pepper, value)
        },
        async beginAudit(input) {
          const lookup = async () => {
            const result = await admin.from('admin_audit_logs')
              .select(AUDIT_COLUMNS)
              .eq('request_id', input.requestId)
              .maybeSingle()
            if (result.error) throw new Error('manage_player_audit_lookup_failed')
            return result.data ? auditShape(result.data) : null
          }

          const existing = await lookup()
          if (existing) {
            return auditMatches(existing, input)
              ? { ok: true as const, created: false, audit: existing }
              : { ok: false as const, code: 'request_conflict' as const }
          }

          const inserted = await admin.from('admin_audit_logs').insert({
            actor_user_id: input.actorUserId,
            target_user_id: input.targetUserId,
            action: input.action,
            request_id: input.requestId,
            request_fingerprint: input.requestFingerprint,
            outcome: 'started',
            step: 'requested',
          }).select(AUDIT_COLUMNS).maybeSingle()
          if (inserted.error || !inserted.data) {
            const raced = await lookup()
            if (!raced) throw new Error('manage_player_audit_create_failed')
            return auditMatches(raced, input)
              ? { ok: true as const, created: false, audit: raced }
              : { ok: false as const, code: 'request_conflict' as const }
          }
          return { ok: true as const, created: true, audit: auditShape(inserted.data) }
        },
        async updateAudit(requestId, update) {
          const result = await admin.from('admin_audit_logs')
            .update({
              outcome: update.outcome,
              step: update.step,
              updated_at: new Date().toISOString(),
              ...(update.completedAt ? { completed_at: update.completedAt } : {}),
            })
            .eq('request_id', requestId)
            .select('request_id')
            .maybeSingle()
          if (result.error || result.data?.request_id !== requestId) {
            throw new Error('manage_player_audit_update_failed')
          }
        },
        async invalidateCredential(userId) {
          const current = await playerFor(admin, userId)
          if (!current) throw new Error('managed_player_missing')
          return updatedPlayer(admin, userId, {
            credential_version: current.credentialVersion + 1,
            force_pin_change: true,
          }, current.credentialVersion)
        },
        async updateAuthPassword(userId, pin) {
          const result = await admin.auth.admin.updateUserById(userId, { password: pin })
          if (result.error) throw new Error('managed_player_password_failed')
        },
        async signIn(authEmail, pin) {
          const result = await passwordClient().auth.signInWithPassword({
            email: authEmail,
            password: pin,
          })
          if (result.error || !result.data.session?.access_token) {
            throw new Error('managed_player_temporary_session_failed')
          }
          return { accessToken: result.data.session.access_token }
        },
        async globalSignOut(accessToken) {
          const result = await admin.auth.admin.signOut(accessToken, 'global')
          if (result.error) throw new Error('managed_player_signout_failed')
        },
        activateAfterReset: (userId) => updatedPlayer(admin, userId, {
          status: 'active',
          force_pin_change: true,
        }),
        async deactivatePlayer(userId) {
          const current = await playerFor(admin, userId)
          if (!current) throw new Error('managed_player_missing')
          return updatedPlayer(admin, userId, {
            status: 'inactive',
            credential_version: current.credentialVersion + 1,
            force_pin_change: false,
          }, current.credentialVersion)
        },
        async deleteAuthUser(userId) {
          const result = await admin.auth.admin.deleteUser(userId)
          if (result.error) throw new Error('managed_player_delete_failed')
        },
        nowIso: () => new Date().toISOString(),
      })(request)
    },
  ),
}
