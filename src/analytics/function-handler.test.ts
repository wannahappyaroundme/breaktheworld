import { describe, expect, it, vi } from 'vitest'

import { createIngestHandler } from '../../supabase/functions/_shared/ingest-handler'

const HASH = 'b'.repeat(64)
const item = {
  eventType: 'weapon_use',
  dayKey: '2026-07-16',
  installHash: HASH,
  weaponId: 'hammer',
  value: 1,
}

async function responseBody(response: Response) {
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  }
}

function request(body: unknown, init: RequestInit = {}): Request {
  return new Request('http://local/ingest-analytics', {
    method: 'POST',
    body: JSON.stringify(body),
    ...init,
  })
}

describe('ingest analytics handler', () => {
  it('calls the atomic RPC with exact server-side fields and returns counts only', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const handler = createIngestHandler({ rpc })

    const result = await responseBody(await handler(request([item])))

    expect(result).toEqual({ status: 200, body: { accepted: 1, rejected: 0 } })
    expect(rpc).toHaveBeenCalledWith('ingest_analytics', {
      p_install_hash: HASH,
      p_event_type: 'weapon_use',
      p_day_key: '2026-07-16',
      p_weapon_id: 'hammer',
      p_value: 1,
    })
    expect(JSON.stringify(result)).not.toContain(HASH)
  })

  it('calls the v2 RPC only for an approved dimension event', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const handler = createIngestHandler({ rpc })
    const progressItem = {
      ...item,
      eventType: 'achievement_unlocked',
      weaponId: null,
      dimension: 'first_hit',
      value: 50,
    }

    const result = await responseBody(await handler(request([progressItem])))

    expect(result).toEqual({ status: 200, body: { accepted: 1, rejected: 0 } })
    expect(rpc).toHaveBeenCalledWith('ingest_analytics_v2', {
      p_install_hash: HASH,
      p_event_type: 'achievement_unlocked',
      p_day_key: '2026-07-16',
      p_weapon_id: null,
      p_value: 50,
      p_dimension: 'first_hit',
    })
  })

  it.each([
    ['non-POST method', new Request('http://local/ingest-analytics', { method: 'GET' })],
    ['malformed JSON', new Request('http://local/ingest-analytics', { method: 'POST', body: '{' })],
    ['invalid payload', request([{ ...item, rawSeed: 'private' }])],
  ])('maps %s to a content-free 400/405 response', async (_label, input) => {
    const rpc = vi.fn(async () => ({ error: null }))
    const result = await responseBody(await createIngestHandler({ rpc })(input))

    expect([400, 405]).toContain(result.status)
    expect(Object.keys(result.body).sort()).toEqual(['accepted', 'rejected'])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects oversized bodies before parsing or calling the database', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const input = request([item], { headers: { 'content-length': '16385' } })

    const result = await responseBody(await createIngestHandler({ rpc })(input))

    expect(result.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps the rate-limit database code to 429 without accepting the overflow row', async () => {
    const rpc = vi.fn(async () => ({ error: { code: 'P0001' } }))

    const result = await responseBody(await createIngestHandler({ rpc })(request([item])))

    expect(result).toEqual({ status: 429, body: { accepted: 0, rejected: 1 } })
  })

  it('reports partial acceptance without echoing or logging content', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: 'P0001' } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const result = await responseBody(await createIngestHandler({ rpc })(request([
        item,
        { ...item, eventType: 'charge_release' },
      ])))

      expect(result).toEqual({ status: 429, body: { accepted: 1, rejected: 1 } })
      expect(JSON.stringify(result.body)).not.toContain(HASH)
      expect(consoleError).not.toHaveBeenCalled()
      expect(consoleLog).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
      consoleLog.mockRestore()
    }
  })

  it.each([
    ['invalid RPC input', { code: '22023' }, 400],
    ['unexpected RPC result', { code: 'XX000' }, 500],
  ])('maps %s without returning database details', async (_label, error, status) => {
    const rpc = vi.fn(async () => ({ error }))

    const result = await responseBody(await createIngestHandler({ rpc })(request([item])))

    expect(result).toEqual({ status, body: { accepted: 0, rejected: 1 } })
    expect(JSON.stringify(result.body)).not.toContain(error.code)
  })

  it('isolates a thrown database request and reports the unprocessed count', async () => {
    const rpc = vi.fn(async () => { throw new Error('database unavailable') })
    const two = [item, { ...item, eventType: 'charge_release' }]

    const result = await responseBody(await createIngestHandler({ rpc })(request(two)))

    expect(result).toEqual({ status: 500, body: { accepted: 0, rejected: 2 } })
  })
})
