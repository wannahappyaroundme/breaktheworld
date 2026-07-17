import { describe, expect, it, vi } from 'vitest'

import {
  AdminApi,
  LOGIN_MESSAGE,
  SESSION_MESSAGE,
  validateQuestInput,
  type AdminClient,
  type AdminQuestInput,
} from './api'
import type { ManagedPlayer } from '../player/admin-contract'

type Response = { data: unknown; error: { code?: string; message: string } | null; status?: number }

function client(options: {
  responses?: Response[]
  authUser?: { id: string; email?: string } | null
  sessionUser?: { id: string; email?: string } | null
  signInError?: boolean
  signOutFailure?: 'returned' | 'thrown'
  functionResponse?: Response | ((request: unknown) => Response)
} = {}) {
  const calls: string[] = []
  const responses = [...(options.responses ?? [])]
  const response = () => responses.shift() ?? { data: null, error: null, status: 200 }

  const query = (table: string) => {
    let current = response()
    const builder = {
      select(columns: string) { calls.push(`${table}:select:${columns}`); return builder },
      insert(value: unknown) { calls.push(`${table}:insert:${JSON.stringify(value)}`); return builder },
      update(value: unknown) { calls.push(`${table}:update:${JSON.stringify(value)}`); return builder },
      delete() { calls.push(`${table}:delete`); return builder },
      eq(column: string, value: unknown) { calls.push(`${table}:eq:${column}:${String(value)}`); return builder },
      order(column: string, value: unknown) { calls.push(`${table}:order:${column}:${JSON.stringify(value)}`); return builder },
      maybeSingle() { calls.push(`${table}:maybeSingle`); return Promise.resolve(current) },
      single() { calls.push(`${table}:single`); return Promise.resolve(current) },
      then(resolve: (value: Response) => void) { resolve(current) },
      setResponse(next: Response) { current = next },
    }
    return builder
  }

  const signOut = vi.fn(async () => {
    if (options.signOutFailure === 'thrown') throw new Error('network unavailable')
    return {
      error: options.signOutFailure === 'returned'
        ? { code: 'request_failed', message: 'raw logout detail' }
        : null,
    }
  })
  const fake = {
    auth: {
      signInWithPassword: vi.fn(async ({ email }: { email: string; password: string }) => ({
        data: { user: options.signInError ? null : (options.authUser ?? { id: 'caller', email }) },
        error: options.signInError ? { code: 'invalid_credentials', message: 'bad' } : null,
      })),
      signOut,
      getSession: vi.fn(async () => ({
        data: { session: options.sessionUser === null ? null : { user: options.sessionUser ?? { id: 'caller', email: 'owner@example.test' } } },
        error: null,
      })),
    },
    from(table: string) { calls.push(`from:${table}`); return query(table) },
    functions: {
      invoke: vi.fn(async (name: string, request: unknown) => {
        calls.push(`function:${name}:${JSON.stringify(request)}`)
        return typeof options.functionResponse === 'function'
          ? options.functionResponse(request)
          : options.functionResponse ?? { data: null, error: null, status: 200 }
      }),
    },
  }
  return { api: new AdminApi(fake as unknown as AdminClient), fake, calls, signOut }
}

const validQuest: AdminQuestInput = {
  id: 'targets_4',
  copy: '타겟 4개 부수기',
  eventType: 'TARGET_DESTROYED',
  target: 4,
  activeFrom: '2026-07-16T00:00:00.000Z',
  activeTo: '2026-07-17T00:00:00.000Z',
  enabled: true,
  version: 1,
}

const PLAYER_ID = '20000000-0000-4000-8000-000000000001'
const managedPlayer: ManagedPlayer = {
  userId: PLAYER_ID,
  displayName: '예진',
  status: 'active',
  forcePinChange: false,
  createdAt: '2026-07-16T00:00:00.000Z',
  lastSyncAt: null,
}

describe('AdminApi authentication', () => {
  it('normalizes the email and returns an active operator session', async () => {
    const { api, fake } = client({
      responses: [{ data: { user_id: 'caller', role: 'operator', active: true }, error: null }],
    })

    await expect(api.signIn('  owner@example.test  ', 'not-shared')).resolves.toEqual({
      ok: true,
      data: { userId: 'caller', email: 'owner@example.test', role: 'operator' },
    })
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'owner@example.test',
      password: 'not-shared',
    })
  })

  it.each([
    ['wrong credentials', { signInError: true }],
    ['missing role', { responses: [{ data: null, error: null }] }],
    ['inactive role', { responses: [{ data: { user_id: 'caller', role: 'owner', active: false }, error: null }] }],
  ])('uses one positive login message for %s and clears partial sessions', async (_label, options) => {
    const { api, signOut } = client(options)
    const result = await api.signIn('person@example.test', 'not-shared')

    expect(result).toEqual({ ok: false, error: { kind: 'login', message: LOGIN_MESSAGE } })
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('restores a session only after checking the active admin row with explicit columns', async () => {
    const { api, calls } = client({ responses: [{ data: { user_id: 'caller', role: 'operator', active: true }, error: null }] })

    await expect(api.restoreSession()).resolves.toEqual({
      ok: true,
      data: { userId: 'caller', email: 'owner@example.test', role: 'operator' },
    })
    expect(calls).toContain('admin_users:select:user_id,role,active')
  })

  it('returns the session next-action message and signs out when restored access was removed', async () => {
    const { api, signOut } = client({ responses: [{ data: null, error: null }] })
    await expect(api.restoreSession()).resolves.toEqual({
      ok: false,
      error: { kind: 'session', message: SESSION_MESSAGE },
    })
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('signs out through the normalized API boundary', async () => {
    const { api, signOut } = client()

    await expect(api.signOut()).resolves.toEqual({ ok: true, data: null })

    expect(signOut).toHaveBeenCalledOnce()
  })

  it.each(['returned', 'thrown'] as const)(
    'keeps logout failure visible when Supabase reports a %s error',
    async (signOutFailure) => {
      const { api } = client({ signOutFailure })

      await expect(api.signOut()).resolves.toEqual({
        ok: false,
        error: {
          kind: 'request',
          message: '연결을 확인한 뒤 로그아웃을 다시 눌러 주세요.',
        },
      })
    },
  )
})

describe('quest validation', () => {
  it('normalizes valid date input for storage', () => {
    expect(validateQuestInput(validQuest)).toEqual({
      ok: true,
      data: expect.objectContaining({
        id: 'targets_4',
        active_from: '2026-07-16T00:00:00.000Z',
        active_to: '2026-07-17T00:00:00.000Z',
      }),
    })
  })

  it.each([
    ['unsafe id', { id: 'Bad ID' }],
    ['short copy', { copy: '가' }],
    ['long copy', { copy: '가'.repeat(61) }],
    ['em dash', { copy: '타겟—부수기' }],
    ['unknown event', { eventType: 'UNKNOWN' }],
    ['low target', { target: 0 }],
    ['high target', { target: 101 }],
    ['fraction target', { target: 1.5 }],
    ['impossible date', { activeFrom: '2026-02-30T00:00:00Z' }],
    ['reverse dates', { activeFrom: validQuest.activeTo, activeTo: validQuest.activeFrom }],
  ])('rejects %s before a request', (_label, override) => {
    expect(validateQuestInput({ ...validQuest, ...override } as AdminQuestInput)).toMatchObject({
      ok: false,
      error: { kind: 'validation' },
    })
  })
})

describe('AdminApi operations', () => {
  it('uses explicit quest columns and maps rows', async () => {
    const { api, calls } = client({ responses: [{ data: [{
      id: 'targets_4', copy: '타겟 4개 부수기', event_type: 'TARGET_DESTROYED', target: 4,
      active_from: null, active_to: null, enabled: true, version: 1, updated_at: '2026-07-16T00:00:00Z',
    }], error: null }] })

    await expect(api.listQuests()).resolves.toMatchObject({ ok: true, data: [{ eventType: 'TARGET_DESTROYED' }] })
    expect(calls.some((call) => call.includes('select:*'))).toBe(false)
    expect(calls).toContain('quest_catalog:select:id,copy,event_type,target,active_from,active_to,enabled,version,updated_at')
  })

  it('validates before create and isolates optional mutation feedback', async () => {
    const feedback = vi.fn(async () => { throw new Error('optional feedback unavailable') })
    const { api, calls } = client({ responses: [{ data: {
      id: 'targets_4', copy: validQuest.copy, event_type: validQuest.eventType, target: 4,
      active_from: validQuest.activeFrom, active_to: validQuest.activeTo, enabled: true, version: 1,
      updated_at: '2026-07-16T00:00:00Z',
    }, error: null }] })
    api.setMutationFeedback(feedback)

    await expect(api.createQuest(validQuest)).resolves.toMatchObject({ ok: true })
    expect(calls).toContain(`quest_catalog:insert:${JSON.stringify({
      id: validQuest.id, copy: validQuest.copy, event_type: validQuest.eventType, target: 4,
      active_from: validQuest.activeFrom, active_to: validQuest.activeTo, enabled: true, version: 1,
    })}`)
    expect(feedback).toHaveBeenCalledWith('quest-created')
  })

  it('maps a database request error to one safe shape', async () => {
    const { api } = client({ responses: [{ data: null, error: { code: '42501', message: 'raw table detail' }, status: 403 }] })
    await expect(api.listFlags()).resolves.toEqual({
      ok: false,
      error: { kind: 'request', message: '저장된 내용을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
    })
  })

  it('normalizes every quest CRUD mutation error without leaking database details', async () => {
    const databaseError = { data: null, error: { code: '42501', message: 'raw table detail' }, status: 403 }
    const { api } = client({ responses: [databaseError, databaseError, databaseError, databaseError] })
    const results = [
      await api.createQuest(validQuest),
      await api.updateQuest(validQuest.id, validQuest),
      await api.setQuestEnabled(validQuest.id, false),
      await api.deleteQuest(validQuest.id),
    ]

    for (const result of results) {
      expect(result).toEqual({
        ok: false,
        error: { kind: 'request', message: '변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' },
      })
    }
  })

  it('updates only the three approved feature switches', async () => {
    const { api, calls } = client({ responses: [{ data: { key: 'analytics_enabled', enabled: true, updated_at: '2026-07-16T00:00:00Z' }, error: null }] })
    await expect(api.setFlag('analytics_enabled', true)).resolves.toMatchObject({ ok: true })
    expect(calls).toContain('feature_flags:update:{"enabled":true}')
    expect(calls).toContain('feature_flags:select:key,enabled,updated_at')
    await expect(api.setFlag('other_enabled' as 'analytics_enabled', true)).resolves.toMatchObject({ ok: false, error: { kind: 'validation' } })
  })

  it('maps daily aggregates into operator metrics without exposing raw event names', async () => {
    const rows = [
      { day_key: '2026-07-16', event_type: 'visit', weapon_id: null, event_count: 12, value_sum: 12, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'charge_release', weapon_id: null, event_count: 8, value_sum: 8, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'charge_cancel', weapon_id: null, event_count: 2, value_sum: 2, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'weapon_use', weapon_id: 'cat', event_count: 3, value_sum: 3, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'target_finish_actions', weapon_id: null, event_count: 2, value_sum: 5, average_value: 2.5 },
      { day_key: '2026-07-16', event_type: 'weapon_use', weapon_id: 'hammer', event_count: 9, value_sum: 9, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'achievement_hub_opened', weapon_id: null, dimension: 'hud', event_count: 4, value_sum: 4, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'achievement_unlocked', weapon_id: null, dimension: 'first_hit', event_count: 2, value_sum: 100, average_value: 50 },
      { day_key: '2026-07-16', event_type: 'level_reached', weapon_id: null, dimension: 'level_7', event_count: 1, value_sum: 7, average_value: 7 },
      { day_key: '2026-07-16', event_type: 'cosmetic_selected', weapon_id: null, dimension: 'electric_night', event_count: 3, value_sum: 3, average_value: 1 },
      { day_key: '2026-07-16', event_type: 'profile_step_viewed', weapon_id: null, dimension: 'pin', event_count: 5, value_sum: 5, average_value: 1 },
      { day_key: '2026-07-15', event_type: 'visit', weapon_id: null, event_count: 100, value_sum: 100, average_value: 1 },
      { day_key: '2026-07-15', event_type: 'weapon_use', weapon_id: 'cat', event_count: 30, value_sum: 30, average_value: 1 },
    ]
    const { api, calls } = client({ responses: [{ data: rows, error: null }] })

    await expect(api.loadDailyMetrics()).resolves.toMatchObject({
      ok: true,
      data: {
        visits: 12,
        chargeCompletionRate: 80,
        characterUses: [{ weaponId: 'cat', count: 3 }],
        averageFinishActions: 2.5,
        achievementHubOpens: 4,
        achievementsUnlocked: 2,
        highestLevelReached: 7,
        cosmeticSelections: 3,
        profileSteps: [
          { step: 'choice', count: 0 },
          { step: 'id', count: 0 },
          { step: 'pin', count: 5 },
          { step: 'complete', count: 0 },
        ],
      },
    })
    expect(calls).toContain('analytics_daily:select:day_key,event_type,weapon_id,dimension,event_count,value_sum,average_value')
  })

  it('defaults missing progression dimensions without inventing a level', async () => {
    const { api } = client({ responses: [{ data: [{
      day_key: '2026-07-16', event_type: 'visit', weapon_id: null,
      event_count: '1', value_sum: '1', average_value: null,
    }], error: null }] })

    await expect(api.loadDailyMetrics()).resolves.toMatchObject({
      ok: true,
      data: {
        achievementHubOpens: 0,
        achievementsUnlocked: 0,
        highestLevelReached: null,
        cosmeticSelections: 0,
        profileSteps: [
          { step: 'choice', count: 0 },
          { step: 'id', count: 0 },
          { step: 'pin', count: 0 },
          { step: 'complete', count: 0 },
        ],
      },
    })
  })

  it('uses the authenticated owner function for account list and status changes', async () => {
    const admin = { id: 'target', email: 'operator@example.test', role: 'operator', active: true }
    const { api, calls } = client({ functionResponse: (request) => (
      JSON.stringify(request).includes('set-active')
        ? { data: { admin: { ...admin, active: false } }, error: null }
        : { data: { admins: [admin] }, error: null }
    ) })

    await expect(api.listAdmins()).resolves.toMatchObject({ ok: true, data: [{ id: 'target', role: 'operator' }] })
    await expect(api.setAdminActive('target', false)).resolves.toMatchObject({ ok: true })
    expect(calls).toContain('function:manage-admin:{"body":{"action":"list"}}')
    expect(calls).toContain('function:manage-admin:{"body":{"action":"set-active","userId":"target","active":false}}')
  })
})

describe('AdminApi player accounts', () => {
  it('lists only strictly validated public player fields', async () => {
    const { api, fake } = client({
      functionResponse: { data: { players: [managedPlayer] }, error: null },
    })

    await expect(api.listPlayers()).resolves.toEqual({ ok: true, data: [managedPlayer] })
    expect(fake.functions.invoke).toHaveBeenCalledWith('manage-player', {
      body: { action: 'list' },
    })
  })

  it.each([
    ['extra internal email', { ...managedPlayer, authEmail: 'private@players.invalid' }],
    ['invalid status', { ...managedPlayer, status: 'blocked' }],
    ['invalid created date', { ...managedPlayer, createdAt: 'not-a-date' }],
    ['invalid sync date', { ...managedPlayer, lastSyncAt: '2026-02-30T00:00:00Z' }],
  ])('rejects malformed player responses: %s', async (_label, player) => {
    const { api } = client({
      functionResponse: { data: { players: [player] }, error: null },
    })

    await expect(api.listPlayers()).resolves.toEqual({
      ok: false,
      error: { kind: 'request', message: '저장된 내용을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.' },
    })
  })

  it('deactivates through one request ID and reports feedback only after success', async () => {
    const feedback = vi.fn()
    const { api, fake } = client({
      functionResponse: { data: { player: { ...managedPlayer, status: 'inactive' } }, error: null },
    })
    api.setMutationFeedback(feedback)

    await expect(api.deactivatePlayer(PLAYER_ID)).resolves.toEqual({
      ok: true,
      data: { ...managedPlayer, status: 'inactive' },
    })
    expect(fake.functions.invoke).toHaveBeenCalledWith('manage-player', {
      body: {
        action: 'deactivate',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        userId: PLAYER_ID,
      },
    })
    expect(feedback).toHaveBeenCalledWith('player-deactivated')
  })

  it.each([
    ['five digits', '24550', '24550', 'PIN은 숫자 6자리로 입력해 주세요.'],
    ['mismatch', '024550', '024551', 'PIN을 같은 숫자 6자리로 다시 입력해 주세요.'],
  ])('validates reset PIN before invoking: %s', async (_label, pin, confirmation, message) => {
    const { api, fake } = client()

    await expect(api.resetPlayerPin(PLAYER_ID, pin, confirmation)).resolves.toEqual({
      ok: false,
      error: { kind: 'validation', message },
    })
    expect(fake.functions.invoke).not.toHaveBeenCalled()
  })

  it('resets a PIN without accepting internal fields in the response', async () => {
    const changed = { ...managedPlayer, forcePinChange: true }
    const { api, fake } = client({
      functionResponse: { data: { player: changed }, error: null },
    })

    await expect(api.resetPlayerPin(PLAYER_ID, '024550', '024550')).resolves.toEqual({
      ok: true,
      data: changed,
    })
    expect(fake.functions.invoke).toHaveBeenCalledWith('manage-player', {
      body: {
        action: 'reset-pin',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        userId: PLAYER_ID,
        pin: '024550',
        pinConfirmation: '024550',
      },
    })
  })

  it('validates exact delete confirmation before invoking', async () => {
    const { api, fake } = client()

    await expect(api.deletePlayer(PLAYER_ID, '예진', '다른이름')).resolves.toEqual({
      ok: false,
      error: { kind: 'validation', message: '삭제할 프로필 ID를 똑같이 입력해 주세요.' },
    })
    expect(fake.functions.invoke).not.toHaveBeenCalled()
  })

  it('deletes only after a strict success payload', async () => {
    const feedback = vi.fn()
    const { api, fake } = client({
      functionResponse: { data: { deleted: true }, error: null },
    })
    api.setMutationFeedback(feedback)

    await expect(api.deletePlayer(PLAYER_ID, '예진', '예진')).resolves.toEqual({ ok: true, data: null })
    expect(fake.functions.invoke).toHaveBeenCalledWith('manage-player', {
      body: {
        action: 'delete',
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        userId: PLAYER_ID,
        confirmation: '예진',
      },
    })
    expect(feedback).toHaveBeenCalledWith('player-deleted')
  })

  it.each([
    ['function error', { data: null, error: { message: 'private function error' } }],
    ['malformed mutation', { data: { player: { ...managedPlayer, credentialVersion: 2 } }, error: null }],
    ['false deletion', { data: { deleted: false }, error: null }],
  ])('normalizes player mutation failures: %s', async (_label, functionResponse) => {
    const { api } = client({ functionResponse })
    const result = _label === 'false deletion'
      ? await api.deletePlayer(PLAYER_ID, '예진', '예진')
      : await api.deactivatePlayer(PLAYER_ID)

    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', message: '변경 내용을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' },
    })
  })
})
