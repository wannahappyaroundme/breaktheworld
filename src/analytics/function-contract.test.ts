import { describe, expect, it } from 'vitest'

import { validateAnalyticsBatch } from '../../supabase/functions/_shared/analytics-contract'
import { APPROVED_ANALYTICS_WEAPON_IDS } from '../../supabase/functions/_shared/weapon-ids'
import { KNOWN_WEAPON_IDS } from '../game-progress'

const HASH = 'a'.repeat(64)
const valid = {
  eventType: 'weapon_use',
  dayKey: '2026-07-16',
  installHash: HASH,
  weaponId: 'hammer',
  value: 1,
}

describe('ingest analytics function contract', () => {
  it('accepts only arrays of 1 through 20 exact payloads', () => {
    expect(validateAnalyticsBatch([valid])).toEqual({ ok: true, items: [valid] })
    expect(validateAnalyticsBatch([])).toEqual({ ok: false })
    expect(validateAnalyticsBatch(Array.from({ length: 21 }, () => valid))).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{ ...valid, rawSeed: 'private' }])).toEqual({ ok: false })
  })

  it.each([
    ['event enum', { ...valid, eventType: 'pointer_move' }],
    ['real calendar date', { ...valid, dayKey: '2026-02-30' }],
    ['lowercase SHA-256 hash', { ...valid, installHash: 'A'.repeat(64) }],
    ['safe weapon ID', { ...valid, weaponId: 'bad-id' }],
    ['count metric value', { ...valid, value: 2 }],
    ['finite integer value', { ...valid, value: Number.NaN }],
  ])('rejects an invalid %s', (_label, item) => {
    expect(validateAnalyticsBatch([item])).toEqual({ ok: false })
  })

  it('requires target finish values from 1 through 3 and the expected weapon nullability', () => {
    expect(validateAnalyticsBatch([{ ...valid, eventType: 'target_finish_actions', value: 3 }]).ok).toBe(true)
    expect(validateAnalyticsBatch([{ ...valid, eventType: 'target_finish_actions', value: 4 }])).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{ ...valid, eventType: 'visit', weaponId: null }]).ok).toBe(true)
    expect(validateAnalyticsBatch([{ ...valid, eventType: 'visit', weaponId: 'hammer' }])).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{ ...valid, eventType: 'weapon_use', weaponId: null }])).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{ ...valid, weaponId: 'made_up_weapon' }])).toEqual({ ok: false })
  })

  it('keeps the server allowlist identical to the 21 playable weapon IDs', () => {
    expect([...APPROVED_ANALYTICS_WEAPON_IDS].sort()).toEqual([...KNOWN_WEAPON_IDS].sort())
    expect(APPROVED_ANALYTICS_WEAPON_IDS).toHaveLength(21)
  })
})
