import { describe, expect, it, vi } from 'vitest'

import { createDefaultProgress } from '../progress/defaults'
import {
  createPlayerSyncHandler,
  type PlayerSyncDependencies,
  type PlayerSyncProgressRow,
} from '../../supabase/functions/_shared/player-sync-handler.ts'
import type {
  AcceptedPlayerProgressOperationV1,
  PlayerProgressOperationV1,
  SyncProgressState,
} from '../../supabase/functions/_shared/player-sync-contract.ts'

const USER_ID = '71000000-0000-4000-8000-000000000001'
const DEVICE_A = '72000000-0000-4000-8000-000000000001'
const DEVICE_B = '72000000-0000-4000-8000-000000000002'
const OP_A1 = '73000000-0000-4000-8000-000000000001'
const NOW = '2026-07-16T12:00:00.000Z'

function zero(): SyncProgressState {
  return createDefaultProgress('74000000-0000-4000-8000-000000000001')
}

function operation(
  deviceId = DEVICE_A,
  clientSeq = 1,
  operationId = OP_A1,
  delta: Partial<PlayerProgressOperationV1['delta']> = {},
  playDayKey = '2026-07-16'
): PlayerProgressOperationV1 {
  return {
    operationId,
    operationVersion: 1,
    deviceId,
    clientSeq,
    createdAt: NOW,
    playDayKey,
    dailyQuest: {
      id: 'characters_3',
      copy: '캐릭터 3종 만나기',
      event: 'WEAPON_USED',
      distinct: 'weaponId',
      target: 3,
    },
    delta: {
      validHits: 0,
      chargedFinishers: 0,
      totalTargets: 0,
      bestCombo: 0,
      addDistinctWeaponIds: [],
      byWeapon: {},
      byTarget: { word: 0, earth: 0, city: 0 },
      achievements: {},
      settings: {},
      ...delta,
    },
  }
}

interface SetupOptions {
  verification?: Awaited<ReturnType<PlayerSyncDependencies['verifyCurrentPlayer']>>
  writeEnabled?: boolean
  limited?: boolean
  projection?: unknown
  initialAcknowledged?: Record<string, number>
  initialOperations?: AcceptedPlayerProgressOperationV1[]
  casFailures?: number
  dailyCasFailures?: number
}

function setup(options: SetupOptions = {}) {
  const accepted: AcceptedPlayerProgressOperationV1[] = [...(options.initialOperations ?? [])]
  const acknowledged = new Map(Object.entries(options.initialAcknowledged ?? {}))
  const acceptedIds = new Map(accepted.map((item) => [`${item.deviceId}:${item.clientSeq}`, item.operationId]))
  let progress: PlayerSyncProgressRow = {
    userId: USER_ID,
    accountSeed: '74000000-0000-4000-8000-000000000001',
    revision: 0,
    state: options.projection ?? zero(),
    lastOperationId: 0,
  }
  let casFailures = options.casFailures ?? 0
  let dailyCasFailures = options.dailyCasFailures ?? 0
  const dailyRows = new Map<string, {
    state: SyncProgressState['daily']
    revision: number
    lastOperationId: number
  }>()
  let completionCount = 0

  const dependencies: PlayerSyncDependencies = {
    verifyCurrentPlayer: vi.fn(async () => options.verification ?? {
      ok: true as const,
      player: {
        userId: USER_ID,
        displayName: '예진',
        credentialVersion: 1,
        forcePinChange: false,
      },
    }),
    consume: vi.fn(async () => options.limited
      ? { allowed: false, retryAfterSeconds: 11 }
      : { allowed: true, retryAfterSeconds: 0 }),
    isWriteEnabled: vi.fn(async () => options.writeEnabled ?? true),
    acknowledgedThrough: vi.fn(async (_userId, deviceId) => acknowledged.get(deviceId) ?? 0),
    acceptedOperationId: vi.fn(async (_userId, deviceId, sequence) => (
      acceptedIds.get(`${deviceId}:${sequence}`) ?? null
    )),
    accept: vi.fn(async (_userId, deviceId, previousSeq, operations) => {
      let order = accepted.reduce((maximum, item) => Math.max(maximum, item.acceptedOrder), 0)
      for (const item of operations) {
        order += 1
        accepted.push({ ...item, acceptedOrder: order, acceptedAt: NOW })
        acceptedIds.set(`${deviceId}:${item.clientSeq}`, item.operationId)
      }
      const through = operations.length > 0
        ? operations[operations.length - 1].clientSeq
        : previousSeq
      acknowledged.set(deviceId, through)
      return { acknowledgedThrough: through, maxOperationId: order }
    }),
    loadProgress: vi.fn(async () => structuredClone(progress)),
    loadOperationsAfter: vi.fn(async (_userId, after) => (
      structuredClone(accepted.filter((item) => item.acceptedOrder > after))
    )),
    ensureDailyAssignment: vi.fn(async (_userId, dayKey, quest) => {
      const existing = dailyRows.get(dayKey)
      if (existing) return structuredClone(existing)
      const state: SyncProgressState['daily'] = {
        dayKey,
        questId: quest.id,
        quest: { copy: quest.copy, event: quest.event, distinct: quest.distinct },
        target: quest.target,
        progress: 0,
        distinctIds: [],
        completedAt: null,
        stampAwarded: false,
      }
      const created = { state, revision: 0, lastOperationId: 0 }
      dailyRows.set(dayKey, created)
      return structuredClone(created)
    }),
    compareAndSwapDaily: vi.fn(async (_userId, dayKey, expectedRevision, state, lastOperationId) => {
      if (dailyCasFailures > 0) {
        dailyCasFailures -= 1
        return false
      }
      const current = dailyRows.get(dayKey)
      if (!current || current.revision !== expectedRevision) return false
      dailyRows.set(dayKey, { state: structuredClone(state), revision: current.revision + 1, lastOperationId })
      return true
    }),
    recordDailyCompletion: vi.fn(async () => {
      completionCount = Math.max(1, completionCount)
      return completionCount
    }),
    countDailyCompletions: vi.fn(async () => completionCount),
    compareAndSwapProgress: vi.fn(async (_userId, expectedRevision, state, lastOperationId) => {
      if (casFailures > 0) {
        casFailures -= 1
        return false
      }
      if (progress.revision !== expectedRevision) return false
      progress = {
        ...progress,
        revision: progress.revision + 1,
        state: structuredClone(state),
        lastOperationId,
      }
      return true
    }),
    currentKstDayKey: () => '2026-07-16',
    nowIso: () => NOW,
  }
  return { dependencies, accepted, acknowledged, dailyRows, getProgress: () => progress }
}

function request(input: {
  deviceId?: string
  previousSeq?: number
  operations?: PlayerProgressOperationV1[]
  knownRevision?: number
} = {}, method = 'POST'): Request {
  return new Request('http://local/player-sync', {
    method,
    headers: { authorization: 'Bearer player-token' },
    body: method === 'POST' ? JSON.stringify({
      deviceId: input.deviceId ?? DEVICE_A,
      previousSeq: input.previousSeq ?? 0,
      operations: input.operations ?? [],
      knownRevision: input.knownRevision ?? 0,
    }) : undefined,
  })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

describe('player sync handler', () => {
  it('keeps the Edge function behind Supabase JWT verification', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
    const playerSync = config.split('[functions.player-sync]')[1]?.split(/^\[/m)[0] ?? ''
    expect(playerSync).toMatch(/^verify_jwt = true$/m)
  })

  it('requires POST and a current player session without caching responses', async () => {
    const first = setup()
    const wrongMethod = await createPlayerSyncHandler(first.dependencies)(request({}, 'GET'))
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('cache-control')).toBe('no-store')

    const missing = setup({ verification: {
      ok: false as const,
      status: 401,
      code: 'authentication_required',
    } })
    const unauthorized = await createPlayerSyncHandler(missing.dependencies)(request())
    expect(unauthorized.status).toBe(401)
    expect(await json(unauthorized)).toEqual({ code: 'authentication_required' })
  })

  it('rejects forced PIN sessions before reading or accepting operations', async () => {
    const value = setup({ verification: {
      ok: true as const,
      player: {
        userId: USER_ID,
        displayName: '예진',
        credentialVersion: 2,
        forcePinChange: true,
      },
    } })
    const response = await createPlayerSyncHandler(value.dependencies)(request({ operations: [operation()] }))
    expect(response.status).toBe(403)
    expect(await json(response)).toEqual({ code: 'pin_change_required' })
    expect(value.dependencies.accept).not.toHaveBeenCalled()
  })

  it('rate limits before parsing the request body', async () => {
    const value = setup({ limited: true })
    const malformed = new Request('http://local/player-sync', {
      method: 'POST',
      headers: { authorization: 'Bearer player-token' },
      body: '{',
    })
    const response = await createPlayerSyncHandler(value.dependencies)(malformed)
    expect(response.status).toBe(429)
    expect(await json(response)).toEqual({ code: 'rate_limited', retryAfterSeconds: 11 })
  })

  it.each([
    ['unknown key', { deviceId: DEVICE_A, previousSeq: 0, operations: [], knownRevision: 0, extra: true }],
    ['wrong device', { deviceId: DEVICE_B, previousSeq: 0, operations: [operation(DEVICE_A)], knownRevision: 0 }],
    ['wrong sequence', { deviceId: DEVICE_A, previousSeq: 0, operations: [operation(DEVICE_A, 2)], knownRevision: 0 }],
    ['negative revision', { deviceId: DEVICE_A, previousSeq: 0, operations: [], knownRevision: -1 }],
  ])('rejects malformed request: %s', async (_label, body) => {
    const value = setup()
    const response = await createPlayerSyncHandler(value.dependencies)(new Request('http://local/player-sync', {
      method: 'POST',
      headers: { authorization: 'Bearer player-token' },
      body: JSON.stringify(body),
    }))
    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ code: 'invalid_request' })
  })

  it('keeps an empty pull available while sync writes are paused', async () => {
    const value = setup({ writeEnabled: false })
    const pull = await createPlayerSyncHandler(value.dependencies)(request())
    expect(pull.status).toBe(200)
    expect(await json(pull)).toEqual(expect.objectContaining({
      userId: USER_ID,
      deviceId: DEVICE_A,
      acknowledgedThrough: 0,
      revision: 0,
    }))

    const write = await createPlayerSyncHandler(value.dependencies)(request({ operations: [operation()] }))
    expect(write.status).toBe(503)
    expect(await json(write)).toEqual({ code: 'sync_paused' })
    expect(value.dependencies.accept).not.toHaveBeenCalled()
  })

  it('hydrates one deterministic current daily assignment on an open empty pull', async () => {
    const value = setup()
    const response = await createPlayerSyncHandler(value.dependencies)(request())
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload.revision).toBe(1)
    expect((payload.state as SyncProgressState).daily).toEqual(expect.objectContaining({
      dayKey: '2026-07-16',
      questId: expect.stringMatching(/^(charged_finisher_2|characters_3|targets_3)$/),
    }))
  })

  it('filters a matching accepted prefix and sends only the contiguous remainder', async () => {
    const first = { ...operation(), acceptedOrder: 1, acceptedAt: NOW }
    const second = operation(DEVICE_A, 2, '73000000-0000-4000-8000-000000000002', { validHits: 2 })
    const value = setup({ initialAcknowledged: { [DEVICE_A]: 1 }, initialOperations: [first] })
    const response = await createPlayerSyncHandler(value.dependencies)(request({
      previousSeq: 0,
      operations: [operation(), second],
    }))
    expect(response.status).toBe(200)
    expect(value.dependencies.accept).toHaveBeenCalledWith(USER_ID, DEVICE_A, 1, [second])
    expect((await json(response)).acknowledgedThrough).toBe(2)
  })

  it('returns the server boundary for a missing or mismatched sequence', async () => {
    const stored = { ...operation(), acceptedOrder: 1, acceptedAt: NOW }
    const value = setup({ initialAcknowledged: { [DEVICE_A]: 1 }, initialOperations: [stored] })
    const mismatch = operation(DEVICE_A, 1, '73000000-0000-4000-8000-000000000099')
    const response = await createPlayerSyncHandler(value.dependencies)(request({ operations: [mismatch] }))
    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({ code: 'sequence_gap', expectedPreviousSeq: 1 })
  })

  it('projects accepted counters, max values, and isolated settings', async () => {
    const value = setup()
    const response = await createPlayerSyncHandler(value.dependencies)(request({ operations: [operation(
      DEVICE_A,
      1,
      OP_A1,
      {
        validHits: 3,
        bestCombo: 12,
        byWeapon: { cat: { uses: 1, finishes: 0, addSeenMoves: ['pawTaps'] } },
        addDistinctWeaponIds: ['cat'],
        settings: { reducedMotion: true },
      }
    )] }))
    expect(response.status).toBe(200)
    const payload = await json(response)
    expect(payload).toEqual(expect.objectContaining({
      userId: USER_ID,
      deviceId: DEVICE_A,
      acknowledgedThrough: 1,
      revision: 1,
      serverTime: NOW,
    }))
    const state = payload.state as SyncProgressState
    expect(state.lifetime.validHits).toBe(3)
    expect(state.lifetime.bestCombo).toBe(12)
    expect(state.profile.reducedMotion).toBe(true)
    expect(state.profile.haptics).toBe(true)
  })

  it('uses the deterministic server quest instead of a mismatched client snapshot', async () => {
    const value = setup()
    const response = await createPlayerSyncHandler(value.dependencies)(request({ operations: [operation(
      DEVICE_A,
      1,
      OP_A1,
      { byWeapon: { cat: { uses: 1, finishes: 0, addSeenMoves: ['pawTaps'] } } }
    )] }))
    expect(response.status).toBe(200)
    expect(value.dependencies.ensureDailyAssignment).toHaveBeenCalledWith(
      USER_ID,
      '2026-07-16',
      expect.objectContaining({ id: expect.stringMatching(/^(charged_finisher_2|characters_3|targets_3)$/) })
    )
    const assignment = value.dailyRows.get('2026-07-16')
    const payload = await json(response)
    expect(assignment?.state.questId).toBe((payload.state as SyncProgressState).daily.questId)
  })

  it('ignores daily evidence older than 90 KST days while keeping lifetime progress', async () => {
    const value = setup()
    const old = operation(DEVICE_A, 1, OP_A1, { validHits: 2 }, '2026-04-16')
    const response = await createPlayerSyncHandler(value.dependencies)(request({ operations: [old] }))
    expect(response.status).toBe(200)
    const state = (await json(response)).state as SyncProgressState
    expect(state.lifetime.validHits).toBe(2)
    expect(value.dependencies.ensureDailyAssignment).not.toHaveBeenCalledWith(
      USER_ID,
      '2026-04-16',
      expect.anything()
    )
  })

  it('retries projection CAS conflicts at most three times', async () => {
    const recovered = setup({ casFailures: 2 })
    const response = await createPlayerSyncHandler(recovered.dependencies)(request({ operations: [operation()] }))
    expect(response.status).toBe(200)
    expect(recovered.dependencies.compareAndSwapProgress).toHaveBeenCalledTimes(3)

    const busy = setup({ casFailures: 3 })
    const failed = await createPlayerSyncHandler(busy.dependencies)(request({ operations: [operation()] }))
    expect(failed.status).toBe(503)
    expect(await json(failed)).toEqual({ code: 'sync_busy' })
    expect(busy.dependencies.compareAndSwapProgress).toHaveBeenCalledTimes(3)
  })

  it('returns service unavailable and keeps operations when stored projection parsing fails', async () => {
    const value = setup({ projection: { raw: 'private corrupt state' } })
    const response = await createPlayerSyncHandler(value.dependencies)(request({ operations: [operation()] }))
    expect(response.status).toBe(503)
    expect(await json(response)).toEqual({ code: 'service_unavailable' })
    expect(JSON.stringify(await json(new Response(JSON.stringify({ code: 'service_unavailable' }))))).not.toContain('private corrupt state')
  })
})
