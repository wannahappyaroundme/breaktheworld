import { describe, expect, it, vi } from 'vitest'

import { createDefaultProgress } from '../progress/defaults'
import type {
  CheckpointReason,
  ProgressLoadResult,
  ProgressSaveResult,
} from '../progress/store'
import type { ProgressStateV1 } from '../progress/types'
import type { OutboxAdapter, OutboxLoadResult } from './outbox'
import { PlayerSyncStore } from './sync-store'

const USER_ID = '91000000-0000-4000-8000-000000000001'
const DEVICE_ID = '92000000-0000-4000-8000-000000000001'

class LocalStore {
  readonly calls: string[] = []
  constructor(public state = createDefaultProgress('93000000-0000-4000-8000-000000000001')) {}

  load(): ProgressLoadResult {
    return { state: structuredClone(this.state), mode: 'persistent' }
  }

  save(state: ProgressStateV1, reason: CheckpointReason): ProgressSaveResult {
    this.calls.push(`local:${reason}:${state.lifetime.validHits}`)
    this.state = structuredClone(state)
    return { ok: true }
  }
}

function outbox(overrides: Partial<OutboxAdapter> = {}) {
  const value: OutboxLoadResult = {
    snapshot: null,
    meta: { userId: USER_ID, deviceId: DEVICE_ID, nextSeq: 1, acknowledgedThrough: 0 },
    operations: [],
  }
  let sequence = 1
  const adapter: OutboxAdapter = {
    load: vi.fn(async () => structuredClone(value)),
    appendDraft: vi.fn(async (userId, draft) => {
      const row = {
        userId,
        ...draft,
        operationId: `94000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
        operationVersion: 1 as const,
        deviceId: DEVICE_ID,
        clientSeq: sequence++,
      }
      value.operations.push(row)
      value.meta.nextSeq = sequence
      return structuredClone(row)
    }),
    nextBatch: vi.fn(async () => structuredClone(value.operations)),
    acknowledge: vi.fn(async () => undefined),
    repairGap: vi.fn(async () => null),
    clearProfile: vi.fn(async () => undefined),
    ...overrides,
  }
  return { adapter, value }
}

function advanced(state: ProgressStateV1, hits: number): ProgressStateV1 {
  const next = structuredClone(state)
  next.lifetime.validHits = hits
  return next
}

describe('player sync store', () => {
  it('queues exact frame and record-book theme setting changes', async () => {
    const local = new LocalStore()
    const queue = outbox()
    const store = new PlayerSyncStore(USER_ID, local, queue.adapter, {
      nowIso: () => '2026-07-16T12:00:00.000Z',
    })
    const next = structuredClone(local.state)
    next.profile.frameId = 'first_crack'
    next.profile.recordBookThemeId = 'electric_night'
    store.save(next, 'unlock')
    await store.whenIdle()
    expect(queue.adapter.appendDraft).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      delta: expect.objectContaining({
        settings: expect.objectContaining({
          frameId: 'first_crack',
          recordBookThemeId: 'electric_night',
        }),
      }),
    }))
  })

  it('requires an immutable player UUID and cannot be constructed for a guest', () => {
    const local = new LocalStore()
    const queue = outbox()
    expect(() => new PlayerSyncStore('guest', local, queue.adapter)).toThrow('invalid_player_user_id')
  })

  it('saves locally before asynchronously appending one checkpoint operation', async () => {
    const local = new LocalStore()
    const queue = outbox({
      appendDraft: vi.fn(async (userId, draft) => {
        local.calls.push(`outbox:${draft.delta.validHits}`)
        return {
          userId,
          ...draft,
          operationId: '94000000-0000-4000-8000-000000000001',
          operationVersion: 1 as const,
          deviceId: DEVICE_ID,
          clientSeq: 1,
        }
      }),
    })
    const store = new PlayerSyncStore(USER_ID, local, queue.adapter, {
      nowIso: () => '2026-07-16T12:00:00.000Z',
    })
    store.save(advanced(local.state, 2), 'actionEnd')
    await store.whenIdle()
    expect(local.calls).toEqual(['local:actionEnd:2', 'outbox:2'])
  })

  it('does not append an operation for an identical checkpoint', async () => {
    const local = new LocalStore()
    const queue = outbox()
    const store = new PlayerSyncStore(USER_ID, local, queue.adapter)
    store.save(structuredClone(local.state), 'pagehide')
    await store.whenIdle()
    expect(queue.adapter.appendDraft).not.toHaveBeenCalled()
  })

  it('keeps rapid checkpoint operations in save order', async () => {
    const local = new LocalStore()
    const calls: number[] = []
    const queue = outbox({
      appendDraft: vi.fn(async (userId, draft) => {
        calls.push(draft.delta.validHits)
        await Promise.resolve()
        return {
          userId,
          ...draft,
          operationId: `94000000-0000-4000-8000-${String(calls.length).padStart(12, '0')}`,
          operationVersion: 1 as const,
          deviceId: DEVICE_ID,
          clientSeq: calls.length,
        }
      }),
    })
    const store = new PlayerSyncStore(USER_ID, local, queue.adapter)
    store.save(advanced(local.state, 1), 'actionEnd')
    store.save(advanced(local.state, 3), 'targetDestroy')
    store.save(advanced(local.state, 6), 'unlock')
    await store.whenIdle()
    expect(calls).toEqual([1, 2, 3])
  })

  it('surfaces a monotonic decrease without appending a negative correction', () => {
    const local = new LocalStore()
    local.state.lifetime.validHits = 3
    const queue = outbox()
    const store = new PlayerSyncStore(USER_ID, local, queue.adapter)
    expect(() => store.save(advanced(local.state, 2), 'scopeChange')).toThrow('progress_decreased')
    expect(queue.adapter.appendDraft).not.toHaveBeenCalled()
  })

  it('reconstructs one missing bounded diff after a crash between local save and outbox append', async () => {
    const local = new LocalStore()
    local.state.lifetime.validHits = 4
    const queue = outbox()
    const store = new PlayerSyncStore(USER_ID, local, queue.adapter, {
      nowIso: () => '2026-07-16T12:00:00.000Z',
    })
    const recovered = await store.recover()
    expect(queue.adapter.appendDraft).toHaveBeenCalledTimes(1)
    expect(recovered.visibleState.lifetime.validHits).toBe(4)
    expect(recovered.pending).toBe(1)
  })

  it('rebases durable pending operations over the server snapshot', async () => {
    const local = new LocalStore()
    const queue = outbox()
    const server = createDefaultProgress('server-seed')
    server.lifetime.validHits = 5
    queue.value.snapshot = {
      userId: USER_ID,
      revision: 2,
      state: server,
      savedAt: '2026-07-16T12:00:00.000Z',
    }
    await queue.adapter.appendDraft(USER_ID, {
      createdAt: '2026-07-16T12:01:00.000Z',
      playDayKey: '2026-07-16',
      dailyQuest: null,
      delta: {
        validHits: 2,
        chargedFinishers: 0,
        totalTargets: 0,
        bestCombo: 0,
        addDistinctWeaponIds: [],
        byWeapon: {},
        byTarget: { word: 0, earth: 0, city: 0 },
        achievements: {},
        settings: {},
      },
    })
    local.state = advanced(server, 7)
    const recovered = await new PlayerSyncStore(USER_ID, local, queue.adapter).recover()
    expect(recovered.serverState?.lifetime.validHits).toBe(5)
    expect(recovered.visibleState.lifetime.validHits).toBe(7)
    expect(recovered.revision).toBe(2)
  })

  it('keeps server plus pending state when local storage contains a decrease', async () => {
    const local = new LocalStore()
    const queue = outbox()
    const server = createDefaultProgress('server-seed')
    server.lifetime.validHits = 5
    queue.value.snapshot = {
      userId: USER_ID,
      revision: 3,
      state: server,
      savedAt: '2026-07-16T12:00:00.000Z',
    }
    local.state.lifetime.validHits = 2
    const recovered = await new PlayerSyncStore(USER_ID, local, queue.adapter).recover()
    expect(recovered.visibleState.lifetime.validHits).toBe(5)
    expect(local.state.lifetime.validHits).toBe(5)
    expect(queue.adapter.appendDraft).not.toHaveBeenCalled()
  })
})
