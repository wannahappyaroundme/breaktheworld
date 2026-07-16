import { withSupabase } from 'npm:@supabase/server@^1'

import { verifyCurrentPlayer } from '../_shared/player-request-security.ts'
import { parseSyncBatch, type SyncProgressState } from '../_shared/player-sync-contract.ts'
import {
  PlayerSyncSequenceGapError,
  createPlayerSyncHandler,
  type PlayerSyncDailyRow,
} from '../_shared/player-sync-handler.ts'

type SupabaseLike = {
  from(table: string): any
  rpc(name: string, parameters: Record<string, unknown>): Promise<{ data: any; error: any }>
}

function oneRow(data: unknown): Record<string, any> | null {
  if (Array.isArray(data)) return data[0] ?? null
  return data && typeof data === 'object' ? data as Record<string, any> : null
}

function kstDayKey(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

function dailyState(row: Record<string, any>): SyncProgressState['daily'] {
  return {
    dayKey: row.day_key,
    questId: row.quest_id,
    quest: row.quest,
    target: row.target,
    progress: row.progress,
    distinctIds: row.distinct_ids,
    completedAt: row.completed_at,
    stampAwarded: row.stamp_awarded,
  }
}

async function acknowledged(admin: SupabaseLike, userId: string, deviceId: string): Promise<number> {
  const result = await admin.from('player_devices')
    .select('last_client_seq')
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .maybeSingle()
  if (result.error) throw new Error('sync_device_lookup_failed')
  if (!result.data) return 0
  if (!Number.isSafeInteger(result.data.last_client_seq) || result.data.last_client_seq < 0) {
    throw new Error('sync_device_parse_failed')
  }
  return result.data.last_client_seq
}

export default {
  fetch: withSupabase(
    { auth: 'user' },
    async (request, context) => {
      const admin = context.supabaseAdmin as unknown as SupabaseLike
      return createPlayerSyncHandler({
        verifyCurrentPlayer: (input) => verifyCurrentPlayer(input, {
          claimsClient: context.supabase as any,
          serviceClient: admin,
        }),
        async consume(userId) {
          const result = await admin.rpc('consume_player_sync_limit', {
            p_user_id: userId,
            p_limit: 60,
            p_window_seconds: 60,
          })
          const row = oneRow(result.data)
          if (
            result.error
            || typeof row?.allowed !== 'boolean'
            || !Number.isSafeInteger(row.retry_after_seconds)
          ) throw new Error('sync_limit_failed')
          return {
            allowed: row.allowed,
            retryAfterSeconds: row.retry_after_seconds,
          }
        },
        async isWriteEnabled() {
          const result = await context.supabase.from('feature_flags')
            .select('enabled')
            .eq('key', 'player_sync_writes')
            .maybeSingle()
          if (result.error || typeof result.data?.enabled !== 'boolean') {
            throw new Error('sync_flag_unavailable')
          }
          return result.data.enabled
        },
        acknowledgedThrough: (userId, deviceId) => acknowledged(admin, userId, deviceId),
        async acceptedOperationId(userId, deviceId, sequence) {
          const result = await admin.from('player_sync_operations')
            .select('operation_id')
            .eq('user_id', userId)
            .eq('device_id', deviceId)
            .eq('client_seq', sequence)
            .maybeSingle()
          if (result.error) throw new Error('sync_operation_lookup_failed')
          return typeof result.data?.operation_id === 'string' ? result.data.operation_id : null
        },
        async accept(userId, deviceId, previousSeq, operations) {
          const result = await admin.rpc('accept_player_operations', {
            p_user_id: userId,
            p_device_id: deviceId,
            p_expected_previous_seq: previousSeq,
            p_operations: operations,
          })
          if (result.error) {
            if (String(result.error.message ?? '').includes('sequence_gap')) {
              throw new PlayerSyncSequenceGapError(await acknowledged(admin, userId, deviceId))
            }
            throw new Error('sync_accept_failed')
          }
          const row = oneRow(result.data)
          if (
            !row
            || !Number.isSafeInteger(row.last_client_seq)
            || !Number.isSafeInteger(row.max_operation_id)
          ) throw new Error('sync_accept_parse_failed')
          return {
            acknowledgedThrough: row.last_client_seq,
            maxOperationId: row.max_operation_id,
          }
        },
        async loadProgress(userId) {
          const result = await admin.from('player_progress')
            .select('user_id,account_seed,revision,state,last_operation_id')
            .eq('user_id', userId)
            .maybeSingle()
          if (result.error || !result.data) throw new Error('sync_progress_load_failed')
          return {
            userId: result.data.user_id,
            accountSeed: result.data.account_seed,
            revision: result.data.revision,
            state: result.data.state,
            lastOperationId: result.data.last_operation_id,
          }
        },
        async loadOperationsAfter(userId, operationId) {
          const result = await admin.from('player_sync_operations')
            .select('id,payload,accepted_at')
            .eq('user_id', userId)
            .gt('id', operationId)
            .order('id', { ascending: true })
          if (result.error || !Array.isArray(result.data)) {
            throw new Error('sync_operations_load_failed')
          }
          return result.data.map((row: Record<string, any>) => {
            const operation = parseSyncBatch([row.payload])[0]
            if (!Number.isSafeInteger(row.id) || typeof row.accepted_at !== 'string') {
              throw new Error('sync_operation_parse_failed')
            }
            return {
              ...operation,
              acceptedOrder: row.id,
              acceptedAt: row.accepted_at,
            }
          })
        },
        async ensureDailyAssignment(userId, dayKey, quest) {
          const result = await admin.rpc('ensure_player_daily_assignment', {
            p_user_id: userId,
            p_day_key: dayKey,
            p_quest_id: quest.id,
            p_quest: {
              copy: quest.copy,
              event: quest.event,
              distinct: quest.distinct,
            },
            p_target: quest.target,
          })
          const row = oneRow(result.data)
          if (result.error || !row) throw new Error('sync_daily_load_failed')
          return {
            state: dailyState(row),
            revision: row.revision,
            lastOperationId: row.last_operation_id,
          } satisfies PlayerSyncDailyRow
        },
        async compareAndSwapDaily(userId, dayKey, expectedRevision, state, lastOperationId) {
          const result = await admin.rpc('compare_and_swap_player_daily', {
            p_user_id: userId,
            p_day_key: dayKey,
            p_expected_revision: expectedRevision,
            p_state: {
              progress: state.progress,
              distinctIds: state.distinctIds,
              completedAt: state.completedAt,
              stampAwarded: state.stampAwarded,
            },
            p_last_operation_id: lastOperationId,
          })
          if (result.error || typeof result.data !== 'boolean') {
            throw new Error('sync_daily_cas_failed')
          }
          return result.data
        },
        async recordDailyCompletion(userId, dayKey, questId, completedAt) {
          const result = await admin.rpc('record_player_daily_completion', {
            p_user_id: userId,
            p_day_key: dayKey,
            p_quest_id: questId,
            p_completed_at: completedAt,
          })
          if (result.error || !Number.isSafeInteger(result.data)) {
            throw new Error('sync_completion_record_failed')
          }
          return result.data
        },
        async countDailyCompletions(userId) {
          const result = await admin.from('player_daily_completions')
            .select('user_id', { count: 'exact', head: true })
            .eq('user_id', userId)
          if (result.error || !Number.isSafeInteger(result.count)) {
            throw new Error('sync_completion_count_failed')
          }
          return result.count
        },
        async compareAndSwapProgress(userId, expectedRevision, state, lastOperationId) {
          const result = await admin.rpc('compare_and_swap_player_progress', {
            p_user_id: userId,
            p_expected_revision: expectedRevision,
            p_state: state,
            p_last_operation_id: lastOperationId,
          })
          if (result.error || typeof result.data !== 'boolean') {
            throw new Error('sync_progress_cas_failed')
          }
          return result.data
        },
        currentKstDayKey: kstDayKey,
        nowIso: () => new Date().toISOString(),
        log(event) {
          console.info(JSON.stringify({ event: 'player_sync', ...event }))
        },
      })(request)
    },
  ),
}
