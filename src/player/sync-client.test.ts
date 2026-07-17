import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProgress } from '../progress/defaults'
import type { PlayerProgressDraftV1 } from '../../supabase/functions/_shared/player-sync-contract'
import { PlayerOutbox } from './outbox'
import {
  PlayerSyncClient,
  type PlayerSyncTransport,
  type SyncStatus,
} from './sync-client'

const USER_ID = 'a1000000-0000-4000-8000-000000000001'
const DEVICE_ID = 'a2000000-0000-4000-8000-000000000001'
const NOW = '2026-07-16T12:00:00.000Z'

function draft(hits = 1): PlayerProgressDraftV1 {
  return {
    createdAt: NOW,
    playDayKey: '2026-07-16',
    dailyQuest: null,
    delta: {
      validHits: hits,
      chargedFinishers: 0,
      totalTargets: 0,
      bestCombo: 0,
      addDistinctWeaponIds: [],
      byWeapon: {},
      byTarget: { word: 0, earth: 0, city: 0 },
      achievements: {},
      settings: {},
    },
  }
}

async function queue() {
  let index = 0
  const ids = [DEVICE_ID, ...Array.from({ length: 20 }, (_, value) => (
    `a3000000-0000-4000-8000-${String(value + 1).padStart(12, '0')}`
  ))]
  return (await PlayerOutbox.open({
    indexedDB: new IDBFactory(),
    randomUuid: () => ids[index++],
  })).outbox
}

function successState(hits: number) {
  const state = createDefaultProgress('server-seed')
  state.lifetime.validHits = hits
  return state
}

function transport(
  send: PlayerSyncTransport['send'],
  refreshSession: PlayerSyncTransport['refreshSession'] = vi.fn(async () => false),
): PlayerSyncTransport {
  return { send: vi.fn(send), refreshSession }
}

async function client(options: {
  outbox: PlayerOutbox
  transport: PlayerSyncTransport
  writesEnabled?: boolean
  currentHits?: number
  sleep?: (milliseconds: number) => Promise<void>
}) {
  const projections: number[] = []
  const statuses: SyncStatus[] = []
  const current = successState(options.currentHits ?? 0)
  const value = new PlayerSyncClient({
    userId: USER_ID,
    generation: 1,
    outbox: options.outbox,
    transport: options.transport,
    writesEnabled: () => options.writesEnabled ?? true,
    getCurrentState: () => structuredClone(current),
    onProjection: (input) => projections.push(input.state.lifetime.validHits),
    onStatus: (status) => statuses.push(status),
    sleep: options.sleep,
    nowIso: () => NOW,
  })
  return { value, projections, statuses }
}

describe('player sync client', () => {
  it('keeps server-authorized cosmetic selections when hydrating a projection', async () => {
    const outbox = await queue()
    const state = successState(100)
    state.lifetime.chargedFinishers = 10
    state.achievements = {
      first_hit: { unlockedAt: NOW, seen: true },
      hits_100: { unlockedAt: NOW, seen: true },
      charge_1: { unlockedAt: NOW, seen: true },
      charge_master: { unlockedAt: NOW, seen: true },
    }
    state.profile.frameId = 'first_crack'
    const api = transport(async (request) => ({
      status: 200,
      body: {
        userId: USER_ID,
        deviceId: request.deviceId,
        acknowledgedThrough: 0,
        revision: 1,
        state,
        serverTime: NOW,
      },
    }))
    const projections: string[] = []
    const value = new PlayerSyncClient({
      userId: USER_ID,
      generation: 1,
      outbox,
      transport: api,
      writesEnabled: () => true,
      getCurrentState: () => structuredClone(state),
      onProjection: (input) => projections.push(input.state.profile.frameId),
      onStatus: vi.fn(),
      nowIso: () => NOW,
    })
    await value.syncNow()
    expect(projections).toEqual(['first_crack'])
  })

  it('acknowledges a batch then rebases remaining optimistic operations', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft(2))
    await outbox.appendDraft(USER_ID, draft(3))
    const api = transport(async (request) => ({
      status: 200,
      body: {
        userId: USER_ID,
        deviceId: request.deviceId,
        acknowledgedThrough: 1,
        revision: 1,
        state: successState(2),
        serverTime: NOW,
      },
    }))
    const setup = await client({ outbox, transport: api })
    await setup.value.syncNow()
    expect(setup.projections).toEqual([5])
    expect((await outbox.load(USER_ID)).operations.map((row) => row.clientSeq)).toEqual([2])
    expect(setup.statuses[setup.statuses.length - 1]?.kind).toBe('saving')
  })

  it('queues locally without a request while sync writes are closed', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft())
    const api = transport(vi.fn())
    const setup = await client({ outbox, transport: api, writesEnabled: false })
    const pending = await setup.value.syncNow()
    expect(pending).toBe(1)
    expect(api.send).not.toHaveBeenCalled()
    expect(setup.statuses[setup.statuses.length - 1]).toEqual({ kind: 'offline', pending: 1 })
  })

  it('retries network and 5xx failures at 1, 2, and 4 seconds', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft())
    const delays: number[] = []
    const api = transport(vi.fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce({ status: 503, body: { code: 'sync_busy' } })
      .mockResolvedValueOnce({ status: 429, body: { code: 'rate_limited' }, retryAfterSeconds: 4 })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          userId: USER_ID,
          deviceId: DEVICE_ID,
          acknowledgedThrough: 1,
          revision: 1,
          state: successState(1),
          serverTime: NOW,
        },
      }))
    const setup = await client({
      outbox,
      transport: api,
      sleep: async (milliseconds) => { delays.push(milliseconds) },
    })
    expect(await setup.value.syncNow()).toBe(0)
    expect(delays).toEqual([1000, 2000, 4000])
    expect(api.send).toHaveBeenCalledTimes(4)
  })

  it.each([400, 403])('does not automatically retry HTTP %s', async (status) => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft())
    const api = transport(async () => ({ status, body: { code: 'invalid_request' } }))
    const setup = await client({ outbox, transport: api, sleep: vi.fn(async () => undefined) })
    expect(await setup.value.syncNow()).toBe(1)
    expect(api.send).toHaveBeenCalledTimes(1)
    expect(setup.statuses[setup.statuses.length - 1]?.kind).toBe('retry')
  })

  it('refreshes once after 401 and keeps the outbox when refresh fails', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft())
    const api = transport(
      async () => ({ status: 401, body: { code: 'authentication_required' } }),
      vi.fn(async () => false),
    )
    const setup = await client({ outbox, transport: api })
    expect(await setup.value.syncNow()).toBe(1)
    expect(api.refreshSession).toHaveBeenCalledTimes(1)
    expect(setup.statuses[setup.statuses.length - 1]).toEqual({ kind: 'auth-expired', pending: 1 })
    expect((await outbox.load(USER_ID)).operations).toHaveLength(1)
  })

  it('resends the exact expected row for a recoverable sequence gap', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft(1))
    await outbox.appendDraft(USER_ID, draft(2))
    const api = transport(vi.fn()
      .mockResolvedValueOnce({ status: 409, body: { code: 'sequence_gap', expectedPreviousSeq: 0 } })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          userId: USER_ID,
          deviceId: DEVICE_ID,
          acknowledgedThrough: 2,
          revision: 1,
          state: successState(3),
          serverTime: NOW,
        },
      }))
    const setup = await client({ outbox, transport: api })
    expect(await setup.value.syncNow()).toBe(0)
    const secondRequest = vi.mocked(api.send).mock.calls[1][0]
    expect(secondRequest.previousSeq).toBe(0)
    expect(secondRequest.operations.map((row) => row.clientSeq)).toEqual([1, 2])
  })

  it('repairs a corrupted local hole from an empty server pull plus one recovery diff', async () => {
    const outbox = await queue()
    await outbox.repairGap(USER_ID, 1, {
      userId: USER_ID,
      revision: 1,
      state: successState(1),
      savedAt: NOW,
    }, draft(1))
    const before = await outbox.load(USER_ID)
    expect(before.operations[0].clientSeq).toBe(2)
    await outbox.repairGap(USER_ID, 0, {
      userId: USER_ID,
      revision: 1,
      state: successState(1),
      savedAt: NOW,
    }, null)
    const api = transport(vi.fn()
      .mockResolvedValueOnce({ status: 409, body: { code: 'sequence_gap', expectedPreviousSeq: 1 } })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          userId: USER_ID,
          deviceId: DEVICE_ID,
          acknowledgedThrough: 1,
          revision: 2,
          state: successState(1),
          serverTime: NOW,
        },
      }))
    const setup = await client({ outbox, transport: api, currentHits: 3 })
    await setup.value.syncNow()
    const repaired = await outbox.load(USER_ID)
    expect(repaired.meta.acknowledgedThrough).toBe(1)
    expect(repaired.operations).toHaveLength(1)
    expect(repaired.operations[0].delta.validHits).toBe(2)
  })

  it('ignores a late response after stop without acknowledging or hydrating', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft())
    let resolveResponse!: (value: Awaited<ReturnType<PlayerSyncTransport['send']>>) => void
    const api = transport(() => new Promise((resolve) => { resolveResponse = resolve }))
    const setup = await client({ outbox, transport: api })
    const pending = setup.value.syncNow()
    await vi.waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
    setup.value.stop()
    resolveResponse({
      status: 200,
      body: {
        userId: USER_ID,
        deviceId: DEVICE_ID,
        acknowledgedThrough: 1,
        revision: 1,
        state: successState(1),
        serverTime: NOW,
      },
    })
    expect(await pending).toBe(1)
    expect(setup.projections).toEqual([])
    expect((await outbox.load(USER_ID)).operations).toHaveLength(1)
  })

  it('flush returns the remaining count for safe logout decisions', async () => {
    const outbox = await queue()
    await outbox.appendDraft(USER_ID, draft())
    const api = transport(async () => ({ status: 503, body: { code: 'sync_busy' } }))
    const setup = await client({
      outbox,
      transport: api,
      sleep: async () => undefined,
    })
    expect(await setup.value.flush(20)).toBe(1)
  })
})
