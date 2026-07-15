import { describe, expect, it } from 'vitest'
import type { GestureEvent } from '../combat/gesture'
import { createInputForwarder, type PointerHit } from './input'

function legacyForwarder(): { events: PointerHit[]; forward: (event: GestureEvent) => void } {
  const events: PointerHit[] = []
  return { events, forward: createInputForwarder((hit) => events.push(hit)) }
}

describe('input event forwarding', () => {
  it('ignores press feedback in legacy mode', () => {
    const { events, forward } = legacyForwarder()

    forward({ type: 'press', id: 1, x: 10, y: 20 })

    expect(events).toEqual([])
  })

  it('maps a tap release to exactly one legacy down hit', () => {
    const { events, forward } = legacyForwarder()

    forward({ type: 'press', id: 1, x: 10, y: 20 })
    forward({ type: 'tap', id: 1, x: 11, y: 21 })

    expect(events).toEqual([{ id: 1, x: 11, y: 21, phase: 'down' }])
  })

  it('maps a charge release to exactly one legacy down hit', () => {
    const { events, forward } = legacyForwarder()

    forward({ type: 'press', id: 1, x: 10, y: 20 })
    forward({ type: 'chargeStart', id: 1, x: 10, y: 20 })
    forward({ type: 'chargeProgress', id: 1, x: 10, y: 20, charge: 0.5 })
    forward({ type: 'chargeRelease', id: 1, x: 12, y: 22, charge: 0.5 })

    expect(events).toEqual([{ id: 1, x: 12, y: 22, phase: 'down' }])
  })

  it('ignores cancellation in legacy mode', () => {
    const { events, forward } = legacyForwarder()

    forward({ type: 'press', id: 1, x: 10, y: 20 })
    forward({ type: 'cancel', id: 1 })

    expect(events).toEqual([])
  })

  it('maps drag start and later samples to legacy drag hits', () => {
    const { events, forward } = legacyForwarder()

    forward({ type: 'dragStart', id: 1, x: 16, y: 0 })
    forward({ type: 'drag', id: 1, x: 30, y: 0 })

    expect(events).toEqual([
      { id: 1, x: 16, y: 0, phase: 'drag' },
      { id: 1, x: 30, y: 0, phase: 'drag' },
    ])
  })

  it('forwards every event unchanged in explicit gesture mode', () => {
    const events: GestureEvent[] = [
      { type: 'press', id: 1, x: 10, y: 20 },
      { type: 'tap', id: 1, x: 10, y: 20 },
      { type: 'dragStart', id: 1, x: 16, y: 20 },
      { type: 'drag', id: 1, x: 30, y: 20 },
      { type: 'chargeStart', id: 1, x: 10, y: 20 },
      { type: 'chargeProgress', id: 1, x: 10, y: 20, charge: 0.5 },
      { type: 'chargeRelease', id: 1, x: 10, y: 20, charge: 0.5 },
      { type: 'cancel', id: 1 },
    ]
    const forwarded: GestureEvent[] = []
    const forward = createInputForwarder((event) => forwarded.push(event), 'gesture')

    for (const event of events) forward(event)

    expect(forwarded).toEqual(events)
  })
})
