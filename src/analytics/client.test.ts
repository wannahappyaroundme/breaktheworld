import { describe, expect, it, vi, type Mock } from 'vitest'

import type { GameEvent } from '../progress/events'
import {
  AnalyticsClient,
  createSupabaseAnalyticsTransport,
  type AnalyticsPayload,
  type AnalyticsSupabaseClient,
} from './client'

const DAY = new Date('2026-07-16T12:00:00.000Z')
const RAW_SEED = 'local-private-install-seed'

function attack(overrides: Partial<Extract<GameEvent, { type: 'ATTACK_RESOLVED' }>> = {}): GameEvent {
  return {
    type: 'ATTACK_RESOLVED',
    source: 'user',
    actionId: 1,
    targetRunId: 1,
    weaponId: 'hammer',
    moveId: 'quick',
    detached: 4,
    ...overrides,
  }
}

function used(overrides: Partial<Extract<GameEvent, { type: 'WEAPON_USED' }>> = {}): GameEvent {
  return {
    type: 'WEAPON_USED',
    source: 'user',
    actionId: 1,
    targetRunId: 1,
    weaponId: 'hammer',
    ...overrides,
  }
}

function destroyed(overrides: Partial<Extract<GameEvent, { type: 'TARGET_DESTROYED' }>> = {}): GameEvent {
  return {
    type: 'TARGET_DESTROYED',
    source: 'user',
    actionId: 1,
    targetRunId: 1,
    weaponId: 'hammer',
    targetId: 'word',
    golden: false,
    ...overrides,
  }
}

function charge(overrides: Partial<Extract<GameEvent, { type: 'CHARGE_RELEASED' }>> = {}): GameEvent {
  return {
    type: 'CHARGE_RELEASED',
    source: 'user',
    actionId: 1,
    targetRunId: 1,
    weaponId: 'hammer',
    charge: 1,
    ...overrides,
  }
}

function harness(options: {
  enabled?: boolean
  invoke?: Mock<any[], any>
  sleep?: (ms: number) => Promise<void>
  schedule?: (run: () => void, ms: number) => unknown
  initialValidHits?: number
  initialTargets?: number
} = {}) {
  const invoke = options.invoke ?? vi.fn(async () => ({ status: 200 }))
  const supabase: AnalyticsSupabaseClient = {
    functions: {
      invoke: async (name, input) => invoke(name, input),
    },
  }
  return {
    invoke,
    create: () => AnalyticsClient.create({
      installSeed: RAW_SEED,
      supabase,
      enabled: options.enabled ?? true,
      now: () => DAY,
      sleep: options.sleep ?? (async () => {}),
      schedule: options.schedule ?? (() => 1),
      clearSchedule: () => {},
      initialValidHits: options.initialValidHits ?? 0,
      initialTargets: options.initialTargets ?? 0,
    }),
  }
}

function sentPayloads(invoke: Mock<any[], any>): AnalyticsPayload[] {
  return invoke.mock.calls.flatMap(([, input]) => input?.body as AnalyticsPayload[])
}

describe('AnalyticsClient privacy and mapping', () => {
  it('hashes the install seed before queueing and never sends the raw seed', async () => {
    const { create, invoke } = harness()
    const client = await create()

    await client.flush()

    const bodyText = JSON.stringify(invoke.mock.calls)
    const [visit] = sentPayloads(invoke)
    expect(bodyText).not.toContain(RAW_SEED)
    expect(visit.installHash).toMatch(/^[a-f0-9]{64}$/)
    expect(visit).toMatchObject({ eventType: 'visit', dayKey: '2026-07-16', weaponId: null, value: 1 })
  })

  it('maps only accepted user events and ignores demo, system, settings, combo, and fever events', async () => {
    const { create, invoke } = harness({ initialValidHits: 1, initialTargets: 1 })
    const client = await create()
    await client.flush()
    invoke.mockClear()

    client.track(used())
    client.track(charge())
    client.trackChargeRelease('hammer', 'user')
    client.trackChargeRelease('hammer', 'demo')
    client.track({ type: 'SHARE_COMPLETED', source: 'user' })
    client.track(used({ actionId: 2, source: 'demo' }))
    client.track(attack({ actionId: 3, source: 'system' }))
    client.track({ type: 'COMBO_CHANGED', source: 'user', value: 3 })
    client.track({ type: 'FEVER_STARTED', source: 'user', combo: 30 })
    client.track({ type: 'SETTING_CHANGED', key: 'haptics', value: true })
    await client.flush()

    expect(sentPayloads(invoke).map((item) => item.eventType)).toEqual([
      'weapon_use',
      'charge_release',
      'share_complete',
    ])
  })

  it('emits first-hit and first-destroy once for a fresh install and keeps weapon use once per action', async () => {
    const { create, invoke } = harness()
    const client = await create()
    await client.flush()
    invoke.mockClear()

    client.track(attack())
    client.track(attack())
    client.track(used())
    client.track(used())
    client.track(destroyed())
    client.track(destroyed())
    await client.flush()

    expect(sentPayloads(invoke).map((item) => item.eventType)).toEqual([
      'first_hit',
      'weapon_use',
      'first_destroy',
      'target_finish_actions',
    ])
  })

  it('counts distinct damaging actions for a target and bounds finish actions to 1 through 3', async () => {
    const { create, invoke } = harness({ initialValidHits: 2, initialTargets: 1 })
    const client = await create()
    await client.flush()
    invoke.mockClear()

    for (let actionId = 1; actionId <= 5; actionId += 1) {
      client.track(attack({ actionId, targetRunId: 9 }))
    }
    client.track(destroyed({ actionId: 5, targetRunId: 9 }))
    await client.flush()

    expect(sentPayloads(invoke)).toEqual([
      expect.objectContaining({ eventType: 'target_finish_actions', value: 3, weaponId: 'hammer' }),
    ])
  })

  it('records charge cancellation only for a user charging-state cancellation requested by Game', async () => {
    const { create, invoke } = harness({ initialValidHits: 1, initialTargets: 1 })
    const client = await create()
    await client.flush()
    invoke.mockClear()

    client.trackChargeCancel('hammer', 'user')
    client.trackChargeCancel('hammer', 'demo')
    client.trackChargeCancel('bad weapon id', 'user')
    client.trackQuestComplete('user')
    await client.flush()

    expect(sentPayloads(invoke).map((item) => item.eventType)).toEqual([
      'charge_cancel',
      'quest_complete',
    ])
  })

  it('does not infer hold release from the progress charged event and rejects unknown safe-format weapon IDs', async () => {
    const { create, invoke } = harness({ initialValidHits: 1, initialTargets: 1 })
    const client = await create()
    await client.flush()
    invoke.mockClear()

    client.track(charge())
    client.trackChargeRelease('made_up_weapon', 'user')
    client.trackChargeRelease('hammer', 'user')
    client.trackChargeRelease('hammer', 'user')
    await client.flush()

    expect(sentPayloads(invoke).map((payload) => payload.eventType)).toEqual([
      'charge_release',
      'charge_release',
    ])
  })
})

describe('AnalyticsClient batching and failure isolation', () => {
  it('sends at most 20 items per request and caps memory at the newest 100 items', async () => {
    const { create, invoke } = harness({ initialValidHits: 1, initialTargets: 1 })
    const client = await create()
    client.clear()
    for (let actionId = 1; actionId <= 120; actionId += 1) {
      client.track(used({ actionId }))
    }

    expect(client.pendingCount).toBe(100)
    await client.flush()

    const body = invoke.mock.calls[0][1].body as AnalyticsPayload[]
    expect(body).toHaveLength(20)
    expect(client.pendingCount).toBe(80)
  })

  it('registers a 10-second flush and exposes a pagehide flush that never throws', async () => {
    const scheduled: Array<{ run: () => void; ms: number }> = []
    const { create, invoke } = harness({
      schedule: (run, ms) => { scheduled.push({ run, ms }); return 1 },
    })
    const client = await create()

    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].ms).toBe(10_000)
    scheduled[0].run()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledOnce())

    client.track(used())
    expect(() => client.flushOnPageHide()).not.toThrow()
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  })

  it('drains every bounded 20-item batch on pagehide as a best-effort transport flush', async () => {
    const { create, invoke } = harness({ initialValidHits: 1, initialTargets: 1 })
    const client = await create()
    client.clear()
    for (let actionId = 1; actionId <= 45; actionId += 1) client.track(used({ actionId }))

    client.flushOnPageHide()

    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
    expect(invoke.mock.calls.map(([, input]) => (input.body as AnalyticsPayload[]).length))
      .toEqual([20, 20, 5])
    expect(client.pendingCount).toBe(0)
  })

  it.each([400, 401, 403])('drops HTTP %i without retry and disables 401/403 sessions', async (status) => {
    const invoke = vi.fn(async () => ({ status }))
    const sleep = vi.fn(async () => {})
    const { create } = harness({ invoke, sleep })
    const client = await create()

    await expect(client.flush()).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledOnce()
    expect(sleep).not.toHaveBeenCalled()
    expect(client.isEnabled).toBe(status === 400)
  })

  it('disables the current session after 429 and clears all queued data', async () => {
    const invoke = vi.fn(async () => ({ status: 429 }))
    const { create } = harness({ invoke })
    const client = await create()
    client.track(used())

    await client.flush()

    expect(client.isEnabled).toBe(false)
    expect(client.pendingCount).toBe(0)
  })

  it.each(['network', 'server'])('retries %s failures with 1s, 2s, and 4s delays then drops the batch', async (kind) => {
    const invoke = (kind === 'network'
      ? vi.fn(async () => { throw new Error('offline') })
      : vi.fn(async () => ({ status: 503 }))) as Mock<any[], any>
    const delays: number[] = []
    const { create } = harness({ invoke, sleep: async (ms) => { delays.push(ms) } })
    const client = await create()

    await expect(client.flush()).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledTimes(4)
    expect(delays).toEqual([1_000, 2_000, 4_000])
    expect(client.pendingCount).toBe(0)
  })

  it('recovers when a transient request succeeds and preserves queued ordering', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 200 })
    const { create } = harness({ invoke })
    const client = await create()
    client.track(used())

    await client.flush()

    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke.mock.calls[0][1].body).toEqual(invoke.mock.calls[1][1].body)
    expect(client.pendingCount).toBe(0)
  })

  it('retries only the unaccepted suffix after a reported partial 500 response', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ status: 500, accepted: 1 })
      .mockResolvedValueOnce({ status: 200 })
    const delays: number[] = []
    const { create } = harness({ invoke, sleep: async (ms) => { delays.push(ms) } })
    const client = await create()
    client.track(used())

    await client.flush()

    expect((invoke.mock.calls[0][1].body as AnalyticsPayload[]).map((item) => item.eventType))
      .toEqual(['visit', 'weapon_use'])
    expect((invoke.mock.calls[1][1].body as AnalyticsPayload[]).map((item) => item.eventType))
      .toEqual(['weapon_use'])
    expect(delays).toEqual([1_000])
  })

  it('clears and stops accepting data when disabled or Supabase is unavailable', async () => {
    const { create, invoke } = harness({ enabled: false })
    const disabled = await create()
    disabled.track(used())
    await disabled.flush()
    expect(invoke).not.toHaveBeenCalled()

    const offline = await AnalyticsClient.create({ installSeed: RAW_SEED, supabase: null, enabled: true })
    offline.track(used())
    expect(offline.pendingCount).toBe(0)
    expect(offline.isEnabled).toBe(false)
  })

  it('isolates scheduler, transport, and hash failures from gameplay callers', async () => {
    const cryptoFailure = await AnalyticsClient.create({
      installSeed: RAW_SEED,
      supabase: { functions: { invoke: async () => { throw new Error('offline') } } },
      enabled: true,
      hash: async () => { throw new Error('crypto unavailable') },
      schedule: () => { throw new Error('timers blocked') },
    })

    expect(() => cryptoFailure.track(used())).not.toThrow()
    await expect(cryptoFailure.flush()).resolves.toBeUndefined()
    expect(cryptoFailure.isEnabled).toBe(false)
  })
})

describe('createSupabaseAnalyticsTransport', () => {
  it('invokes only the named analytics function and returns the HTTP status without exposing errors', async () => {
    const invoke = vi.fn(async () => ({ data: { accepted: 1, rejected: 0 }, error: null }))
    const transport = createSupabaseAnalyticsTransport({ functions: { invoke } })
    const payload = [{
      eventType: 'visit' as const,
      dayKey: '2026-07-16',
      installHash: 'a'.repeat(64),
      weaponId: null,
      value: 1,
    }]

    await expect(transport.send(payload)).resolves.toEqual({ status: 200, accepted: 1 })
    expect(invoke).toHaveBeenCalledWith('ingest-analytics', { body: payload })
  })
})
