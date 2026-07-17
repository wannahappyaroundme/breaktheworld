import { describe, expect, it } from 'vitest'
import type { GameEvent } from './events'
import { createDefaultProgress } from './defaults'
import { reduceProgress } from './reducer'
import type { ProgressStateV1 } from './types'

const attack = (
  overrides: Partial<Extract<GameEvent, { type: 'ATTACK_RESOLVED' }>> = {}
): Extract<GameEvent, { type: 'ATTACK_RESOLVED' }> => ({
  type: 'ATTACK_RESOLVED',
  source: 'user',
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
  moveId: 'bonk',
  detached: 4,
  ...overrides,
})

const used = (
  overrides: Partial<Extract<GameEvent, { type: 'WEAPON_USED' }>> = {}
): Extract<GameEvent, { type: 'WEAPON_USED' }> => ({
  type: 'WEAPON_USED',
  source: 'user',
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
  ...overrides,
})

const charged = (
  overrides: Partial<Extract<GameEvent, { type: 'CHARGE_RELEASED' }>> = {}
): Extract<GameEvent, { type: 'CHARGE_RELEASED' }> => ({
  type: 'CHARGE_RELEASED',
  source: 'user',
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
  charge: 1,
  ...overrides,
})

const destroyed = (
  overrides: Partial<Extract<GameEvent, { type: 'TARGET_DESTROYED' }>> = {}
): Extract<GameEvent, { type: 'TARGET_DESTROYED' }> => ({
  type: 'TARGET_DESTROYED',
  source: 'user',
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
  targetId: 'word',
  golden: false,
  ...overrides,
})

function withDaily(
  state: ProgressStateV1,
  questId: string,
  target: number
): ProgressStateV1 {
  return {
    ...state,
    daily: {
      dayKey: '2026-07-16',
      questId,
      target,
      progress: 0,
      distinctIds: [],
      completedAt: null,
      stampAwarded: false,
    },
  }
}

describe('progress defaults', () => {
  it('creates the exact version-one state without reading environment state', () => {
    expect(createDefaultProgress('install-seed')).toEqual({
      schemaVersion: 1,
      catalogVersion: 1,
      installSeed: 'install-seed',
      lifetime: {
        validHits: 0,
        chargedFinishers: 0,
        totalTargets: 0,
        bestCombo: 0,
        stamps: 0,
        distinctWeaponIds: [],
      },
      byWeapon: {},
      byTarget: {
        word: { destroys: 0 },
        earth: { destroys: 0 },
        city: { destroys: 0 },
      },
      achievements: {},
      daily: {
        dayKey: '',
        questId: '',
        target: 0,
        progress: 0,
        distinctIds: [],
        completedAt: null,
        stampAwarded: false,
      },
      profile: {
        selectedTitle: null,
        skins: {},
        frameId: 'default',
        recordBookThemeId: 'default',
        strongInput: 'hold',
        reducedMotion: false,
        haptics: true,
      },
    })
  })
})

describe('progress reducer', () => {
  it('counts only user attacks that detach fragments and returns rejected events unchanged', () => {
    const state = createDefaultProgress('seed')

    expect(reduceProgress(state, attack({ source: 'demo' }))).toBe(state)
    expect(reduceProgress(state, attack({ source: 'system' }))).toBe(state)
    expect(reduceProgress(state, attack({ detached: 0 }))).toBe(state)
    expect(reduceProgress(state, attack({ detached: -3 }))).toBe(state)

    const counted = reduceProgress(state, attack())
    expect(counted).not.toBe(state)
    expect(counted.lifetime.validHits).toBe(1)
    expect(counted.byWeapon.hammer.seenMoves).toEqual(['bonk'])
    expect(state.lifetime.validHits).toBe(0)
  })

  it('deduplicates per action, target run, and event type', () => {
    const state = createDefaultProgress('seed')
    const hit = reduceProgress(state, attack())
    const duplicate = reduceProgress(hit, attack())
    const useFromSameAction = reduceProgress(duplicate, used())

    expect(duplicate).toBe(hit)
    expect(useFromSameAction.lifetime.validHits).toBe(1)
    expect(useFromSameAction.byWeapon.hammer.uses).toBe(1)
  })

  it.each([
    ['ATTACK_RESOLVED', attack({ actionId: 8, targetRunId: 3 })],
    ['CHARGE_RELEASED', charged({ actionId: 8, targetRunId: 3 })],
    ['TARGET_DESTROYED', destroyed({ actionId: 8, targetRunId: 3 })],
    ['WEAPON_USED', used({ actionId: 8, targetRunId: 3 })],
  ] as const)('rejects a duplicate %s settlement', (_type, event) => {
    const once = reduceProgress(createDefaultProgress('seed'), event)

    expect(reduceProgress(once, event)).toBe(once)
  })

  it('accepts the same action id in a new target run', () => {
    const firstRun = reduceProgress(createDefaultProgress('seed'), used({ targetRunId: 1 }))
    const secondRun = reduceProgress(firstRun, used({ targetRunId: 2 }))

    expect(secondRun.byWeapon.hammer.uses).toBe(2)
  })

  it.each([
    ['ATTACK_RESOLVED', attack()],
    ['CHARGE_RELEASED', charged()],
    ['TARGET_DESTROYED', destroyed()],
    ['WEAPON_USED', used()],
  ] as const)('rejects invalid settlement identity boundaries for %s', (_type, event) => {
    const state = createDefaultProgress('seed')
    const invalidIds = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      0,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]

    for (const invalidId of invalidIds) {
      expect(reduceProgress(state, { ...event, actionId: invalidId })).toBe(state)
      expect(reduceProgress(state, { ...event, targetRunId: invalidId })).toBe(state)
    }
  })

  it.each([
    ['ATTACK_RESOLVED', attack()],
    ['CHARGE_RELEASED', charged()],
    ['TARGET_DESTROYED', destroyed()],
    ['WEAPON_USED', used()],
  ] as const)('accepts positive safe-integer identity boundaries for %s', (_type, event) => {
    const state = createDefaultProgress('seed')

    expect(reduceProgress(state, { ...event, actionId: 1, targetRunId: 1 })).not.toBe(state)
    expect(reduceProgress(state, {
      ...event,
      actionId: Number.MAX_SAFE_INTEGER,
      targetRunId: Number.MAX_SAFE_INTEGER,
    })).not.toBe(state)
  })

  it('keeps settlement dedupe history through unrelated accepted events', () => {
    const usedOnce = reduceProgress(createDefaultProgress('seed'), used())
    const comboChanged = reduceProgress(usedOnce, {
      type: 'COMBO_CHANGED',
      source: 'user',
      value: 4,
    })
    const settingChanged = reduceProgress(comboChanged, {
      type: 'SETTING_CHANGED',
      key: 'haptics',
      value: false,
    })

    expect(reduceProgress(settingChanged, used())).toBe(settingChanged)
  })

  it('keeps only 64 runtime dedupe keys', () => {
    const first = used({ actionId: 1 })
    let state = reduceProgress(createDefaultProgress('seed'), first)
    for (let actionId = 2; actionId <= 65; actionId += 1) {
      state = reduceProgress(state, used({ actionId }))
    }

    const replayed = reduceProgress(state, first)
    expect(state.byWeapon.hammer.uses).toBe(65)
    expect(replayed.byWeapon.hammer.uses).toBe(66)
  })

  it('does not serialize the runtime dedupe chain', () => {
    const once = reduceProgress(createDefaultProgress('seed'), used())
    const restored = JSON.parse(JSON.stringify(once)) as ProgressStateV1

    expect(Object.keys(once)).toEqual(Object.keys(createDefaultProgress('seed')))
    expect(JSON.stringify(once)).not.toContain('1:1:WEAPON_USED')
    expect(reduceProgress(restored, used()).byWeapon.hammer.uses).toBe(2)
  })

  it('tracks maximum combo and clamps invalid values', () => {
    let state = createDefaultProgress('seed')
    state = reduceProgress(state, { type: 'COMBO_CHANGED', source: 'user', value: 12.9 })
    state = reduceProgress(state, { type: 'COMBO_CHANGED', source: 'user', value: 4 })
    state = reduceProgress(state, { type: 'COMBO_CHANGED', source: 'user', value: Number.POSITIVE_INFINITY })
    state = reduceProgress(state, { type: 'COMBO_CHANGED', source: 'user', value: -2 })

    expect(state.lifetime.bestCombo).toBe(12)
    expect(reduceProgress(state, { type: 'COMBO_CHANGED', source: 'demo', value: 99 })).toBe(state)
  })

  it('counts only clamped maximum-charge finishers', () => {
    let state = createDefaultProgress('seed')
    state = reduceProgress(state, charged({ actionId: 1, charge: 0.999 }))
    state = reduceProgress(state, charged({ actionId: 2, charge: 1.8 }))

    expect(state.lifetime.chargedFinishers).toBe(1)
  })

  it('tracks sorted weapon uses, finishes, moves, targets, and distinct IDs', () => {
    let state = createDefaultProgress('seed')
    state = reduceProgress(state, used({ actionId: 1, weaponId: 'zapper' }))
    state = reduceProgress(state, used({ actionId: 2, weaponId: 'hammer' }))
    state = reduceProgress(state, used({ actionId: 3, weaponId: 'zapper' }))
    state = reduceProgress(state, attack({ actionId: 4, weaponId: 'zapper', moveId: 'zap-b' }))
    state = reduceProgress(state, attack({ actionId: 5, weaponId: 'zapper', moveId: 'zap-a' }))
    state = reduceProgress(state, destroyed({ actionId: 6, weaponId: 'zapper', targetId: 'earth' }))
    state = reduceProgress(state, destroyed({ actionId: 7, weaponId: 'zapper', targetId: 'earth' }))

    expect(state.lifetime.distinctWeaponIds).toEqual(['hammer', 'zapper'])
    expect(state.byWeapon.hammer).toEqual({ uses: 1, finishes: 0, seenMoves: [] })
    expect(state.byWeapon.zapper).toEqual({ uses: 2, finishes: 2, seenMoves: ['zap-a', 'zap-b'] })
    expect(state.byTarget.earth.destroys).toBe(2)
    expect(state.lifetime.totalTargets).toBe(2)
  })

  it('updates settings while preserving mismatched setting values at the type boundary', () => {
    let state = createDefaultProgress('seed')
    state = reduceProgress(state, { type: 'SETTING_CHANGED', key: 'strongInput', value: 'doubleTap' })
    state = reduceProgress(state, { type: 'SETTING_CHANGED', key: 'reducedMotion', value: true })
    state = reduceProgress(state, { type: 'SETTING_CHANGED', key: 'haptics', value: false })

    expect(state.profile).toMatchObject({
      strongInput: 'doubleTap',
      reducedMotion: true,
      haptics: false,
    })
  })

  it('advances a distinct daily quest and awards one stamp at completion', () => {
    let state = withDaily(createDefaultProgress('seed'), 'characters_3', 3)
    state = reduceProgress(state, used({ actionId: 1, weaponId: 'cinnamoroll' }))
    state = reduceProgress(state, used({ actionId: 2, weaponId: 'cinnamoroll' }))
    state = reduceProgress(state, used({ actionId: 3, weaponId: 'hulk' }))
    state = reduceProgress(state, used({ actionId: 4, weaponId: 'cat' }))

    expect(state.daily.progress).toBe(3)
    expect(state.daily.distinctIds).toEqual(['cat', 'cinnamoroll', 'hulk'])
    expect(state.daily.completedAt).not.toBeNull()
    expect(state.daily.stampAwarded).toBe(true)
    expect(state.lifetime.stamps).toBe(1)

    const afterCompletion = reduceProgress(state, used({ actionId: 5, weaponId: 'pooh' }))
    expect(afterCompletion.daily.progress).toBe(3)
    expect(afterCompletion.lifetime.stamps).toBe(1)
  })

  it('counts only character weapons toward the distinct-character daily quest', () => {
    let state = withDaily(createDefaultProgress('seed'), 'characters_3', 3)
    state = reduceProgress(state, used({ actionId: 1, weaponId: 'hammer' }))
    state = reduceProgress(state, used({ actionId: 2, weaponId: 'fire' }))
    state = reduceProgress(state, used({ actionId: 3, weaponId: 'blackhole' }))

    expect(state.daily.progress).toBe(0)
    expect(state.daily.distinctIds).toEqual([])
    expect(state.daily.completedAt).toBeNull()

    state = reduceProgress(state, used({ actionId: 4, weaponId: 'cinnamoroll' }))
    state = reduceProgress(state, used({ actionId: 5, weaponId: 'dragonball' }))
    state = reduceProgress(state, used({ actionId: 6, weaponId: 'ditto' }))

    expect(state.daily.progress).toBe(3)
    expect(state.daily.distinctIds).toEqual(['cinnamoroll', 'ditto', 'dragonball'])
    expect(state.daily.completedAt).not.toBeNull()
    expect(state.lifetime.stamps).toBe(1)
  })

  it('advances charged and destroyed daily quests only from their matching user event', () => {
    let chargedState = withDaily(createDefaultProgress('charged'), 'charged_finisher_2', 2)
    chargedState = reduceProgress(chargedState, charged({ actionId: 1, charge: 0.8 }))
    chargedState = reduceProgress(chargedState, charged({ actionId: 2, charge: 1 }))
    chargedState = reduceProgress(chargedState, charged({ actionId: 3, charge: 2 }))
    expect(chargedState.daily.progress).toBe(2)
    expect(chargedState.lifetime.stamps).toBe(1)

    let targetState = withDaily(createDefaultProgress('targets'), 'targets_3', 2)
    targetState = reduceProgress(targetState, destroyed({ actionId: 1, source: 'demo' }))
    targetState = reduceProgress(targetState, destroyed({ actionId: 2 }))
    targetState = reduceProgress(targetState, destroyed({ actionId: 3, targetId: 'city' }))
    expect(targetState.daily.progress).toBe(2)
    expect(targetState.lifetime.stamps).toBe(1)
  })

  it('does not progress an unknown or inactive daily quest', () => {
    const inactive = withDaily(createDefaultProgress('seed'), 'unknown', 3)
    const reduced = reduceProgress(inactive, used())

    expect(reduced.daily).toEqual(inactive.daily)
    expect(reduced.lifetime.stamps).toBe(0)
  })

  it('clamps corrupted and overflowing counters to finite safe integers', () => {
    const corrupted: ProgressStateV1 = {
      ...createDefaultProgress('seed'),
      lifetime: {
        ...createDefaultProgress('seed').lifetime,
        validHits: Number.NaN,
        chargedFinishers: -4,
        totalTargets: Number.MAX_SAFE_INTEGER,
        bestCombo: Number.POSITIVE_INFINITY,
        stamps: Number.MAX_SAFE_INTEGER,
      },
      byWeapon: {
        hammer: { uses: Number.MAX_SAFE_INTEGER, finishes: -9, seenMoves: [] },
      },
      byTarget: {
        word: { destroys: Number.NaN },
        earth: { destroys: Number.MAX_SAFE_INTEGER },
        city: { destroys: -1 },
      },
    }

    let state = reduceProgress(corrupted, attack())
    state = reduceProgress(state, used({ actionId: 2 }))
    state = reduceProgress(state, destroyed({ actionId: 3, targetId: 'earth' }))
    state = reduceProgress(state, charged({ actionId: 4 }))

    expect(state.lifetime).toMatchObject({
      validHits: 1,
      chargedFinishers: 1,
      totalTargets: Number.MAX_SAFE_INTEGER,
      bestCombo: 0,
      stamps: Number.MAX_SAFE_INTEGER,
    })
    expect(state.byWeapon.hammer.uses).toBe(Number.MAX_SAFE_INTEGER)
    expect(state.byWeapon.hammer.finishes).toBe(1)
    expect(state.byTarget).toEqual({
      word: { destroys: 0 },
      earth: { destroys: Number.MAX_SAFE_INTEGER },
      city: { destroys: 0 },
    })
  })
})
