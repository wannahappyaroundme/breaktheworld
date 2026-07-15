import { describe, expect, it } from 'vitest'
import { GestureMachine } from './gesture'

describe('GestureMachine', () => {
  it('emits a tap at 449ms and a charged release at 450ms', () => {
    const g = new GestureMachine()
    g.begin(1, 100, 100, 0, true)
    expect(g.end(1, 100, 100, 449)).toMatchObject({ type: 'tap' })

    g.begin(2, 100, 100, 0, true)
    g.update(450)
    expect(g.end(2, 100, 100, 450)).toMatchObject({ type: 'chargeRelease', charge: 0 })
  })

  it('keeps 15px as a press and converts 16px to drag', () => {
    const g = new GestureMachine()
    g.begin(1, 0, 0, 0, true)
    expect(g.move(1, 15, 0, 100)).toBeNull()
    expect(g.move(1, 16, 0, 110)).toMatchObject({ type: 'dragStart' })
  })

  it('reaches max charge at 1100ms and stays clamped on release', () => {
    const g = new GestureMachine()
    g.begin(1, 10, 20, 0, true)
    expect(g.update(450)).toMatchObject({ type: 'chargeStart' })
    expect(g.update(1100)).toMatchObject({ type: 'chargeProgress', charge: 1 })
    expect(g.end(1, 10, 20, 1500)).toMatchObject({ type: 'chargeRelease', charge: 1 })
  })

  it('keeps a stationary secondary pointer as a tap after 450ms', () => {
    const g = new GestureMachine()
    g.begin(1, 10, 20, 0, true)
    g.begin(2, 30, 40, 10, false)

    expect(g.update(500)).toMatchObject({ type: 'chargeStart', id: 1 })
    expect(g.end(2, 30, 40, 700)).toMatchObject({ type: 'tap', id: 2 })
  })

  it('never charges a secondary pointer when it is the only active pointer', () => {
    const g = new GestureMachine()
    g.begin(2, 30, 40, 0, false)

    expect(g.update(1100)).toBeNull()
    expect(g.end(2, 30, 40, 1100)).toMatchObject({ type: 'tap', id: 2 })
  })

  it('cancels without emitting a settling attack', () => {
    const g = new GestureMachine()
    g.begin(1, 10, 20, 0, true)

    expect(g.cancel(1)).toEqual({ type: 'cancel', id: 1 })
    expect(g.end(1, 10, 20, 100)).toBeNull()
  })

  it('does not settle duplicate end or cancel events twice', () => {
    const g = new GestureMachine()
    g.begin(1, 10, 20, 0, true)

    expect(g.end(1, 10, 20, 100)).toMatchObject({ type: 'tap' })
    expect(g.end(1, 10, 20, 100)).toBeNull()
    expect(g.cancel(1)).toBeNull()
  })

  it('cancels every active pointer without producing an attack', () => {
    const g = new GestureMachine()
    g.begin(1, 10, 20, 0, true)
    g.begin(2, 30, 40, 10, false)

    expect(g.cancelAll()).toEqual([
      { type: 'cancel', id: 1 },
      { type: 'cancel', id: 2 },
    ])
    expect(g.end(1, 10, 20, 100)).toBeNull()
    expect(g.end(2, 30, 40, 100)).toBeNull()
  })

  it('requires both 45ms and 14px between drag samples', () => {
    const g = new GestureMachine()
    g.begin(1, 0, 0, 0, true)
    expect(g.move(1, 16, 0, 10)).toMatchObject({ type: 'dragStart' })

    expect(g.move(1, 40, 0, 54)).toBeNull()
    expect(g.move(1, 29, 0, 55)).toBeNull()
    expect(g.move(1, 30, 0, 55)).toMatchObject({ type: 'drag', x: 30 })

    expect(g.move(1, 60, 0, 99)).toBeNull()
    expect(g.move(1, 43, 0, 100)).toBeNull()
    expect(g.move(1, 44, 0, 100)).toMatchObject({ type: 'drag', x: 44 })
  })

  it('emits chargeStart once before charge progress', () => {
    const g = new GestureMachine()
    g.begin(1, 10, 20, 0, true)

    expect(g.update(449)).toBeNull()
    expect(g.update(450)).toEqual({ type: 'chargeStart', id: 1, x: 10, y: 20 })
    expect(g.update(451)).toMatchObject({ type: 'chargeProgress', charge: 1 / 650 })
  })

  it('converts a moved charge into a drag and does not release a charged attack', () => {
    const g = new GestureMachine()
    g.begin(1, 0, 0, 0, true)
    expect(g.update(450)).toMatchObject({ type: 'chargeStart' })

    expect(g.move(1, 16, 0, 500)).toMatchObject({ type: 'dragStart' })
    expect(g.end(1, 16, 0, 600)).toEqual({ type: 'cancel', id: 1 })
  })
})
