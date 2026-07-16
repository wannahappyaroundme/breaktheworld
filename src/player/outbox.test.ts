import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'

import { createDefaultProgress } from '../progress/defaults'
import {
  PlayerOutbox,
  type OutboxAdapter,
  type SnapshotRow,
} from './outbox'
import type { PlayerProgressDraftV1 } from '../../supabase/functions/_shared/player-sync-contract'

const USER_A = '81000000-0000-4000-8000-000000000001'
const USER_B = '81000000-0000-4000-8000-000000000002'
const DEVICE_ID = '82000000-0000-4000-8000-000000000001'
const OPERATION_IDS = Array.from({ length: 160 }, (_, index) => (
  `${String(index + 1).padStart(8, '0')}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
))

function draft(hits = 1): PlayerProgressDraftV1 {
  return {
    createdAt: '2026-07-16T12:00:00.000Z',
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

function snapshot(userId = USER_A, revision = 1): SnapshotRow {
  return {
    userId,
    revision,
    state: createDefaultProgress('83000000-0000-4000-8000-000000000001'),
    savedAt: '2026-07-16T12:10:00.000Z',
  }
}

function ids() {
  let index = 0
  return () => OPERATION_IDS[index++]
}

async function persistent(factory: IDBFactory, randomUuid = ids()): Promise<OutboxAdapter> {
  const opened = await PlayerOutbox.open({ indexedDB: factory, randomUuid })
  expect(opened.mode).toBe('persistent')
  return opened.outbox
}

describe('player outbox', () => {
  it('creates the versioned database and keeps one stable device ID after reopen', async () => {
    const factory = new IDBFactory()
    const first = await persistent(factory, () => DEVICE_ID)
    const firstLoad = await first.load(USER_A)
    expect(firstLoad.meta).toEqual({
      userId: USER_A,
      deviceId: DEVICE_ID,
      nextSeq: 1,
      acknowledgedThrough: 0,
    })

    const second = await persistent(factory, () => '82000000-0000-4000-8000-000000000099')
    expect((await second.load(USER_A)).meta.deviceId).toBe(DEVICE_ID)
  })

  it('allocates unique contiguous sequences for 50 rapid concurrent checkpoints', async () => {
    const outbox = await persistent(new IDBFactory())
    const rows = await Promise.all(Array.from({ length: 50 }, () => outbox.appendDraft(USER_A, draft())))
    expect(rows.map((row) => row.clientSeq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    expect(new Set(rows.map((row) => row.operationId)).size).toBe(50)
    expect((await outbox.load(USER_A)).meta.nextSeq).toBe(51)
  })

  it('preserves sequence continuity and operations across a database reopen', async () => {
    const factory = new IDBFactory()
    const first = await persistent(factory)
    await first.appendDraft(USER_A, draft(1))
    const second = await persistent(factory, () => OPERATION_IDS[10])
    const appended = await second.appendDraft(USER_A, draft(2))
    expect(appended.clientSeq).toBe(2)
    expect((await second.load(USER_A)).operations.map((row) => row.delta.validHits)).toEqual([1, 2])
  })

  it('isolates operations, metadata, and snapshots by immutable player UUID', async () => {
    const outbox = await persistent(new IDBFactory())
    await outbox.appendDraft(USER_A, draft(1))
    await outbox.appendDraft(USER_B, draft(2))
    await outbox.acknowledge(USER_A, 1, snapshot(USER_A))

    const first = await outbox.load(USER_A)
    const second = await outbox.load(USER_B)
    expect(first.operations).toHaveLength(0)
    expect(first.snapshot?.userId).toBe(USER_A)
    expect(second.operations).toHaveLength(1)
    expect(second.snapshot).toBeNull()
    expect(second.meta.acknowledgedThrough).toBe(0)
  })

  it('rolls back both metadata and operation when an IndexedDB append transaction aborts', async () => {
    const factory = new IDBFactory()
    let calls = 0
    const opened = await PlayerOutbox.open({
      indexedDB: factory,
      randomUuid: () => {
        calls += 1
        return calls === 1 ? 'invalid-operation-id' : OPERATION_IDS[0]
      },
    })
    const memoryRow = await opened.outbox.appendDraft(USER_A, draft())
    expect(opened.outbox.mode).toBe('memory')
    expect(memoryRow.clientSeq).toBe(1)

    const reopened = await persistent(factory, () => OPERATION_IDS[1])
    const durableRow = await reopened.appendDraft(USER_A, draft())
    expect(durableRow.clientSeq).toBe(1)
    expect((await reopened.load(USER_A)).operations).toHaveLength(1)
  })

  it('returns a bounded batch of at most 100 operations and 256KB', async () => {
    const outbox = await persistent(new IDBFactory())
    await Promise.all(Array.from({ length: 120 }, () => outbox.appendDraft(USER_A, draft())))
    const batch = await outbox.nextBatch(USER_A)
    expect(batch).toHaveLength(100)
    expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThanOrEqual(256 * 1024)
  })

  it('acknowledges rows and snapshot atomically without decreasing revision', async () => {
    const outbox = await persistent(new IDBFactory())
    await outbox.appendDraft(USER_A, draft(1))
    await outbox.appendDraft(USER_A, draft(2))
    await outbox.acknowledge(USER_A, 1, snapshot(USER_A, 2))
    const loaded = await outbox.load(USER_A)
    expect(loaded.operations.map((row) => row.clientSeq)).toEqual([2])
    expect(loaded.snapshot?.revision).toBe(2)
    expect(loaded.meta.acknowledgedThrough).toBe(1)
    await expect(outbox.acknowledge(USER_A, 2, snapshot(USER_A, 1))).rejects.toThrow('snapshot_revision_decreased')
    expect((await outbox.load(USER_A)).operations.map((row) => row.clientSeq)).toEqual([2])
  })

  it('repairs a sequence gap in one transaction and creates at most one recovery operation', async () => {
    const outbox = await persistent(new IDBFactory())
    await outbox.appendDraft(USER_A, draft(1))
    await outbox.appendDraft(USER_A, draft(2))
    const recovery = await outbox.repairGap(USER_A, 5, snapshot(USER_A, 4), draft(3))
    const loaded = await outbox.load(USER_A)
    expect(recovery?.clientSeq).toBe(6)
    expect(loaded.meta).toEqual(expect.objectContaining({ acknowledgedThrough: 5, nextSeq: 7 }))
    expect(loaded.operations.map((row) => row.clientSeq)).toEqual([6])
    expect(loaded.snapshot?.revision).toBe(4)
  })

  it('falls back once to honest in-memory storage when IndexedDB cannot open', async () => {
    const onMemoryFallback = vi.fn()
    const brokenFactory = {
      open: () => { throw new DOMException('quota', 'QuotaExceededError') },
    } as unknown as IDBFactory
    const opened = await PlayerOutbox.open({
      indexedDB: brokenFactory,
      onMemoryFallback,
      randomUuid: ids(),
    })
    expect(opened.mode).toBe('memory')
    await opened.outbox.appendDraft(USER_A, draft())
    expect((await opened.outbox.load(USER_A)).operations).toHaveLength(1)
    expect(onMemoryFallback).toHaveBeenCalledTimes(1)
  })

  it('clears only the explicitly deleted profile cache', async () => {
    const outbox = await persistent(new IDBFactory())
    await outbox.appendDraft(USER_A, draft(1))
    await outbox.appendDraft(USER_B, draft(2))
    await outbox.clearProfile(USER_A)
    expect((await outbox.load(USER_A)).operations).toHaveLength(0)
    expect((await outbox.load(USER_B)).operations).toHaveLength(1)
  })
})
