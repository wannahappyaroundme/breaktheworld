export const TAP_MS = 450
export const MAX_CHARGE_MS = 1100
export const DRAG_PX = 16
export const DRAG_SAMPLE_MS = 45

const DRAG_SAMPLE_PX = 14

export type GestureEvent =
  | { type: 'press'; id: number; x: number; y: number }
  | { type: 'tap'; id: number; x: number; y: number }
  | { type: 'dragStart' | 'drag'; id: number; x: number; y: number }
  | { type: 'chargeStart'; id: number; x: number; y: number }
  | { type: 'chargeProgress'; id: number; x: number; y: number; charge: number }
  | { type: 'chargeRelease'; id: number; x: number; y: number; charge: number }
  | { type: 'cancel'; id: number }

interface ActivePointer {
  startedAt: number
  startX: number
  startY: number
  x: number
  y: number
  phase: 'pressed' | 'dragging' | 'charging'
  canCharge: boolean
  lastDragAt: number
  lastDragX: number
  lastDragY: number
}

function chargeAmount(heldMs: number): number {
  return Math.min(1, Math.max(0, (heldMs - TAP_MS) / (MAX_CHARGE_MS - TAP_MS)))
}

export class GestureMachine {
  private active = new Map<number, ActivePointer>()
  private primaryChargePointerId: number | null = null

  begin(id: number, x: number, y: number, nowMs: number, isPrimary: boolean): GestureEvent {
    const canCharge = isPrimary && this.primaryChargePointerId === null
    if (canCharge) this.primaryChargePointerId = id
    this.active.set(id, {
      startedAt: nowMs,
      startX: x,
      startY: y,
      x,
      y,
      phase: 'pressed',
      canCharge,
      lastDragAt: nowMs,
      lastDragX: x,
      lastDragY: y,
    })
    return { type: 'press', id, x, y }
  }

  move(id: number, x: number, y: number, nowMs: number): GestureEvent | null {
    const pointer = this.active.get(id)
    if (!pointer) return null
    pointer.x = x
    pointer.y = y

    if (pointer.phase !== 'dragging') {
      const moved = Math.hypot(x - pointer.startX, y - pointer.startY)
      if (moved < DRAG_PX) return null
      pointer.phase = 'dragging'
      pointer.canCharge = false
      if (this.primaryChargePointerId === id) this.primaryChargePointerId = null
      pointer.lastDragAt = nowMs
      pointer.lastDragX = x
      pointer.lastDragY = y
      return { type: 'dragStart', id, x, y }
    }

    const enoughTime = nowMs - pointer.lastDragAt >= DRAG_SAMPLE_MS
    const enoughDistance =
      Math.hypot(x - pointer.lastDragX, y - pointer.lastDragY) >= DRAG_SAMPLE_PX
    if (!enoughTime || !enoughDistance) return null

    pointer.lastDragAt = nowMs
    pointer.lastDragX = x
    pointer.lastDragY = y
    return { type: 'drag', id, x, y }
  }

  update(nowMs: number): GestureEvent | null {
    if (this.primaryChargePointerId === null) return null
    const id = this.primaryChargePointerId
    const pointer = this.active.get(id)
    if (!pointer || !pointer.canCharge) return null

    const heldMs = nowMs - pointer.startedAt
    if (heldMs < TAP_MS) return null
    if (pointer.phase === 'pressed') {
      pointer.phase = 'charging'
      return { type: 'chargeStart', id, x: pointer.x, y: pointer.y }
    }
    if (pointer.phase === 'charging') {
      return { type: 'chargeProgress', id, x: pointer.x, y: pointer.y, charge: chargeAmount(heldMs) }
    }
    return null
  }

  end(id: number, x: number, y: number, nowMs: number): GestureEvent | null {
    const pointer = this.active.get(id)
    if (!pointer) return null
    this.active.delete(id)
    if (this.primaryChargePointerId === id) this.primaryChargePointerId = null

    if (pointer.phase === 'dragging') return { type: 'cancel', id }
    const heldMs = nowMs - pointer.startedAt
    if (pointer.canCharge && heldMs >= TAP_MS) {
      return { type: 'chargeRelease', id, x, y, charge: chargeAmount(heldMs) }
    }
    return { type: 'tap', id, x, y }
  }

  cancel(id: number): GestureEvent | null {
    if (!this.active.delete(id)) return null
    if (this.primaryChargePointerId === id) this.primaryChargePointerId = null
    return { type: 'cancel', id }
  }

  cancelAll(): GestureEvent[] {
    const events: GestureEvent[] = []
    for (const id of [...this.active.keys()]) {
      const event = this.cancel(id)
      if (event) events.push(event)
    }
    return events
  }
}
