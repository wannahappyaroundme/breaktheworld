import { describe, expect, it, vi } from 'vitest'

import type { GameEvent } from '../progress/events'
import { GameAnalyticsBridge, type GameAnalyticsSink } from './game-bridge'

function sink(overrides: Partial<GameAnalyticsSink> = {}): GameAnalyticsSink {
  return {
    track: vi.fn(),
    setEnabled: vi.fn(),
    trackChargeRelease: vi.fn(),
    trackChargeCancel: vi.fn(),
    trackQuestComplete: vi.fn(),
    flushOnPageHide: vi.fn(),
    ...overrides,
  }
}

const used = (
  source: 'user' | 'demo' | 'system' = 'user'
): Extract<GameEvent, { type: 'WEAPON_USED' }> => ({
  type: 'WEAPON_USED',
  source,
  actionId: 1,
  targetRunId: 1,
  weaponId: 'hammer',
})

describe('GameAnalyticsBridge', () => {
  it('forwards only accepted user gameplay events and ignores demo/system/settings inputs', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    bridge.attach(target)

    bridge.track(used('user'))
    bridge.track(used('demo'))
    bridge.track(used('system'))
    bridge.track({ type: 'SETTING_CHANGED', key: 'haptics', value: true })

    expect(target.track).toHaveBeenCalledOnce()
    expect(target.track).toHaveBeenCalledWith(used('user'))
  })

  it('keeps charge release in the accepted event stream', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    bridge.attach(target)
    const event: GameEvent = {
      type: 'CHARGE_RELEASED',
      source: 'user',
      actionId: 2,
      targetRunId: 3,
      weaponId: 'hammer',
      charge: 0.8,
    }

    bridge.track(event)
    bridge.trackChargeRelease(false, 'hammer', 'user')
    bridge.trackChargeRelease(true, 'hammer', 'demo')
    bridge.trackChargeRelease(true, 'hammer', 'user')

    expect(target.track).toHaveBeenCalledWith(event)
    expect(target.trackChargeRelease).toHaveBeenCalledOnce()
    expect(target.trackChargeRelease).toHaveBeenCalledWith('hammer', 'user')
  })

  it('records charge cancel only when a user charging state actually ended', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    bridge.attach(target)

    bridge.trackChargeCancellation(false, 'hammer', 'user')
    bridge.trackChargeCancellation(true, 'hammer', 'demo')
    bridge.trackChargeCancellation(true, 'hammer', 'user')

    expect(target.trackChargeCancel).toHaveBeenCalledOnce()
    expect(target.trackChargeCancel).toHaveBeenCalledWith('hammer', 'user')
  })

  it('records quest completion only for a newly completed accepted user transition', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    bridge.attach(target)

    bridge.trackQuestTransition(null, null, 'user', true)
    bridge.trackQuestTransition(null, '2026-07-16T00:00:00.000Z', 'demo', true)
    bridge.trackQuestTransition(null, '2026-07-16T00:00:00.000Z', 'user', false)
    bridge.trackQuestTransition(null, '2026-07-16T00:00:00.000Z', 'user', true)
    bridge.trackQuestTransition('2026-07-16T00:00:00.000Z', '2026-07-16T00:00:00.000Z', 'user', true)

    expect(target.trackQuestComplete).toHaveBeenCalledOnce()
    expect(target.trackQuestComplete).toHaveBeenCalledWith('user')
  })

  it('applies flag changes and forwards pagehide flushes', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    bridge.attach(target)

    bridge.setEnabled(false)
    bridge.flushOnPageHide()

    expect(target.setEnabled).toHaveBeenCalledWith(false)
    expect(target.flushOnPageHide).toHaveBeenCalledOnce()
  })

  it('applies the current flag when a late-created client attaches', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(false)
    bridge.setEnabled(true)

    bridge.attach(target)

    expect(target.setEnabled).toHaveBeenCalledWith(true)
  })

  it('buffers at most 100 enum-only pre-ready descriptors and replays them exactly once', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    for (let actionId = 1; actionId <= 101; actionId += 1) {
      bridge.track({ ...used(), actionId })
    }
    bridge.trackChargeRelease(true, 'hammer', 'user')
    bridge.trackChargeCancellation(true, 'hammer', 'user')
    bridge.trackQuestTransition(null, 'done', 'user', true)

    bridge.attach(target)
    bridge.attach(target)

    expect(target.track).toHaveBeenCalledTimes(97)
    expect(target.track).not.toHaveBeenCalledWith(expect.objectContaining({ actionId: 1 }))
    expect(target.trackChargeRelease).toHaveBeenCalledOnce()
    expect(target.trackChargeCancel).toHaveBeenCalledOnce()
    expect(target.trackQuestComplete).toHaveBeenCalledOnce()
  })

  it('clears pre-ready descriptors when the feature becomes disabled', () => {
    const target = sink()
    const bridge = new GameAnalyticsBridge(true)
    bridge.track(used())
    bridge.trackChargeRelease(true, 'hammer', 'user')

    bridge.setEnabled(false)
    bridge.attach(target)

    expect(target.track).not.toHaveBeenCalled()
    expect(target.trackChargeRelease).not.toHaveBeenCalled()
  })

  it('requires both a changed setting and confirmed post-operation charge end', () => {
    expect(GameAnalyticsBridge.confirmedChargeEnd(true, false, true)).toBe(true)
    expect(GameAnalyticsBridge.confirmedChargeEnd(true, false, false)).toBe(false)
    expect(GameAnalyticsBridge.confirmedChargeEnd(true, true, true)).toBe(false)
    expect(GameAnalyticsBridge.confirmedChargeEnd(false, false, true)).toBe(false)
  })

  it('isolates every analytics throw from gameplay, remote flags, and page lifecycle', () => {
    const unavailable = sink({
      track: () => { throw new Error('track') },
      setEnabled: () => { throw new Error('flag') },
      trackChargeRelease: () => { throw new Error('release') },
      trackChargeCancel: () => { throw new Error('cancel') },
      trackQuestComplete: () => { throw new Error('quest') },
      flushOnPageHide: () => { throw new Error('pagehide') },
    })
    const bridge = new GameAnalyticsBridge(true)
    bridge.attach(unavailable)

    expect(() => bridge.track(used())).not.toThrow()
    expect(() => bridge.setEnabled(false)).not.toThrow()
    expect(() => bridge.trackChargeRelease(true, 'hammer', 'user')).not.toThrow()
    expect(() => bridge.trackChargeCancellation(true, 'hammer', 'user')).not.toThrow()
    expect(() => bridge.trackQuestTransition(null, 'done', 'user', true)).not.toThrow()
    expect(() => bridge.flushOnPageHide()).not.toThrow()
  })
})
