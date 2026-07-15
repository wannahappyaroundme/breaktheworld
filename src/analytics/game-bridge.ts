import type { EventSource, GameEvent } from '../progress/events'

export interface GameAnalyticsSink {
  track(event: GameEvent): void | Promise<void>
  setEnabled(enabled: boolean): void
  trackChargeRelease(weaponId: string, source: EventSource): void
  trackChargeCancel(weaponId: string, source: EventSource): void
  trackQuestComplete(source: EventSource): void
  flushOnPageHide(): void
}

type PendingDescriptor =
  | { kind: 'event'; event: GameEvent }
  | { kind: 'chargeRelease'; weaponId: string }
  | { kind: 'chargeCancel'; weaponId: string }
  | { kind: 'questComplete' }

const PRE_READY_CAP = 100

/** DOM-free isolation layer between accepted Game outcomes and optional telemetry. */
export class GameAnalyticsBridge {
  private sink: GameAnalyticsSink | null = null
  private readonly pending: PendingDescriptor[] = []

  constructor(private enabled = false) {}

  attach(sink: GameAnalyticsSink): void {
    this.sink = sink
    this.call(() => sink.setEnabled(this.enabled))
    if (!this.enabled || this.pending.length === 0) return
    const descriptors = this.pending.splice(0)
    for (const descriptor of descriptors) this.deliver(sink, descriptor)
  }

  track(event: GameEvent): void {
    if (event.type === 'SETTING_CHANGED' || event.source !== 'user') return
    this.emit({ kind: 'event', event })
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) this.pending.length = 0
    this.call(() => this.sink?.setEnabled(enabled))
  }

  trackChargeRelease(confirmed: boolean, weaponId: string, source: EventSource): void {
    if (!confirmed || source !== 'user') return
    this.emit({ kind: 'chargeRelease', weaponId })
  }

  trackChargeCancellation(
    confirmed: boolean,
    weaponId: string,
    source: EventSource
  ): void {
    if (!confirmed || source !== 'user') return
    this.emit({ kind: 'chargeCancel', weaponId })
  }

  trackQuestTransition(
    previousCompletedAt: string | null,
    nextCompletedAt: string | null,
    source: EventSource,
    accepted: boolean
  ): void {
    if (!accepted || source !== 'user' || previousCompletedAt !== null || nextCompletedAt === null) {
      return
    }
    this.emit({ kind: 'questComplete' })
  }

  flushOnPageHide(): void {
    this.call(() => this.sink?.flushOnPageHide())
  }

  static confirmedChargeEnd(
    wasCharging: boolean,
    isChargingAfter: boolean,
    operationOccurred: boolean
  ): boolean {
    return operationOccurred && wasCharging && !isChargingAfter
  }

  private emit(descriptor: PendingDescriptor): void {
    if (!this.enabled) return
    if (this.sink) {
      this.deliver(this.sink, descriptor)
      return
    }
    this.pending.push(descriptor)
    if (this.pending.length > PRE_READY_CAP) this.pending.splice(0, this.pending.length - PRE_READY_CAP)
  }

  private deliver(sink: GameAnalyticsSink, descriptor: PendingDescriptor): void {
    switch (descriptor.kind) {
      case 'event':
        this.call(() => sink.track(descriptor.event))
        return
      case 'chargeRelease':
        this.call(() => sink.trackChargeRelease(descriptor.weaponId, 'user'))
        return
      case 'chargeCancel':
        this.call(() => sink.trackChargeCancel(descriptor.weaponId, 'user'))
        return
      case 'questComplete':
        this.call(() => sink.trackQuestComplete('user'))
    }
  }

  private call(action: () => unknown): void {
    try {
      const pending = action()
      if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(pending).catch(() => undefined)
      }
    } catch {
      // Analytics side effects never escape into gameplay or page lifecycle.
    }
  }
}
