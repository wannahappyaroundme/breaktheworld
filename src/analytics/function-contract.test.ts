import { describe, expect, it } from 'vitest'

import { validateAnalyticsBatch } from '../../supabase/functions/_shared/analytics-contract'
import {
  ACHIEVEMENT_CATALOG,
  availableFrameIds,
  availableThemeIds,
} from '../../supabase/functions/_shared/achievement-catalog'
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
    expect(validateAnalyticsBatch([valid])).toEqual({
      ok: true,
      items: [{ ...valid, dimension: null }],
    })
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

  it('accepts exact achievement dimensions and XP without accepting arbitrary text', () => {
    for (const { id, xp } of ACHIEVEMENT_CATALOG) {
      expect(validateAnalyticsBatch([{
        ...valid,
        eventType: 'achievement_unlocked',
        weaponId: null,
        dimension: id,
        value: xp,
      }]).ok).toBe(true)
    }
    expect(validateAnalyticsBatch([{
      ...valid,
      eventType: 'achievement_unlocked',
      weaponId: null,
      dimension: 'user supplied text',
      value: 50,
    }])).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{
      ...valid,
      eventType: 'achievement_unlocked',
      weaponId: null,
      dimension: 'first_hit',
      value: 400,
    }])).toEqual({ ok: false })
  })

  it('accepts only approved hub, level, cosmetic, and profile-step combinations', () => {
    const hubLocations = ['hud', 'notice', 'profile'] as const
    const levels = Array.from({ length: 19 }, (_, index) => index + 2)
    const cosmeticIds = [...new Set([...availableFrameIds(20), ...availableThemeIds(20)])]
    const profileSteps = ['choice', 'id', 'pin', 'complete'] as const
    const approved = [
      ...hubLocations.map((dimension) => ({ eventType: 'achievement_hub_opened', dimension, value: 1 })),
      ...levels.map((level) => ({ eventType: 'level_reached', dimension: `level_${level}`, value: level })),
      ...cosmeticIds.map((dimension) => ({ eventType: 'cosmetic_selected', dimension, value: 1 })),
      ...profileSteps.map((dimension) => ({ eventType: 'profile_step_viewed', dimension, value: 1 })),
    ]
    for (const progressEvent of approved) {
      expect(validateAnalyticsBatch([{
        ...valid,
        ...progressEvent,
        weaponId: null,
      }]).ok).toBe(true)
    }
    expect(hubLocations).toHaveLength(3)
    expect(levels).toEqual(Array.from({ length: 19 }, (_, index) => index + 2))
    expect(cosmeticIds.sort()).toEqual([
      'coral_burst',
      'default',
      'electric_night',
      'first_crack',
      'legend_crown',
    ])
    expect(profileSteps).toHaveLength(4)
    expect(validateAnalyticsBatch([{
      ...valid,
      eventType: 'level_reached',
      weaponId: null,
      dimension: 'level_20',
      value: 19,
    }])).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{
      ...valid,
      eventType: 'profile_step_viewed',
      weaponId: null,
      dimension: 'profile-id-from-user',
      value: 1,
    }])).toEqual({ ok: false })
  })

  it('requires null dimensions for legacy events and no weapon IDs for progress events', () => {
    expect(validateAnalyticsBatch([{ ...valid, dimension: null }]).ok).toBe(true)
    expect(validateAnalyticsBatch([{ ...valid, dimension: 'hammer' }])).toEqual({ ok: false })
    expect(validateAnalyticsBatch([{
      ...valid,
      eventType: 'achievement_hub_opened',
      dimension: 'hud',
      value: 1,
    }])).toEqual({ ok: false })
  })
})
