export type NotificationKind = 'record' | 'achievement' | 'quest' | 'general'

export const NOTIFICATION_PRIORITY: Readonly<Record<NotificationKind, number>> = {
  record: 40,
  achievement: 30,
  quest: 20,
  general: 10,
}

export const MIN_NOTICE_MS = 250
export const MAX_NOTICE_MS = 10_000
export const QUEST_NOTICE_MS = 4_000
const DEFAULT_NOTICE_MS = 2_000
const DEFAULT_RECENT_LIMIT = 64
const MAX_RECENT_LIMIT = 256

export interface NotificationInput {
  key: string
  kind: NotificationKind
  text: string
  durationMs?: number
}

export interface QueuedNotification extends NotificationInput {
  durationMs: number
  priority: number
}

export interface NotificationScheduler {
  schedule(run: () => void, delayMs: number): () => void
}

export interface NotificationQueueOptions {
  scheduler: NotificationScheduler
  onShow: (notice: QueuedNotification) => void
  onHide: (notice: QueuedNotification) => void
  recentLimit?: number
}

interface WaitingNotification {
  notice: QueuedNotification
  order: number
}

function boundedDuration(kind: NotificationKind, durationMs: number | undefined): number {
  if (kind === 'quest') return QUEST_NOTICE_MS
  const value = Number.isFinite(durationMs) ? Math.floor(durationMs!) : DEFAULT_NOTICE_MS
  return Math.min(MAX_NOTICE_MS, Math.max(MIN_NOTICE_MS, value))
}

/** DOM-free, non-preemptive notification scheduler with bounded session dedupe. */
export class NotificationQueue {
  private readonly scheduler: NotificationScheduler
  private readonly onShow: (notice: QueuedNotification) => void
  private readonly onHide: (notice: QueuedNotification) => void
  private readonly recentLimit: number
  private readonly waiting: WaitingNotification[] = []
  private readonly recentKeys: string[] = []
  private readonly recentSet = new Set<string>()
  private sequence = 0
  private visible: QueuedNotification | null = null
  private startPending = false
  private cancelStartScheduled: (() => void) | null = null
  private cancelScheduled: (() => void) | null = null

  constructor(options: NotificationQueueOptions) {
    this.scheduler = options.scheduler
    this.onShow = options.onShow
    this.onHide = options.onHide
    const requestedLimit = Number.isSafeInteger(options.recentLimit)
      ? options.recentLimit!
      : DEFAULT_RECENT_LIMIT
    this.recentLimit = Math.min(MAX_RECENT_LIMIT, Math.max(1, requestedLimit))
  }

  get current(): QueuedNotification | null {
    return this.visible
  }

  get waitingCount(): number {
    return this.waiting.length
  }

  push(input: NotificationInput): boolean {
    const key = input.key.trim()
    const text = input.text.trim()
    if (key === '' || text === '' || this.hasKey(key)) return false

    this.waiting.push({
      order: this.sequence++,
      notice: {
        key,
        kind: input.kind,
        text,
        durationMs: boundedDuration(input.kind, input.durationMs),
        priority: NOTIFICATION_PRIORITY[input.kind],
      },
    })
    this.requestStart()
    return true
  }

  clear(): void {
    this.cancelStartScheduled?.()
    this.cancelStartScheduled = null
    this.startPending = false
    this.cancelScheduled?.()
    this.cancelScheduled = null
    this.waiting.length = 0
    if (!this.visible) return
    const hidden = this.visible
    this.visible = null
    this.remember(hidden.key)
    this.safeHide(hidden)
  }

  private hasKey(key: string): boolean {
    return (
      this.visible?.key === key
      || this.waiting.some(({ notice }) => notice.key === key)
      || this.recentSet.has(key)
    )
  }

  private showNext(): void {
    if (this.visible || this.waiting.length === 0) return
    this.cancelStartScheduled?.()
    this.cancelStartScheduled = null
    this.startPending = false
    this.waiting.sort((left, right) => (
      right.notice.priority - left.notice.priority || left.order - right.order
    ))
    const next = this.waiting.shift()!.notice
    this.visible = next
    try {
      this.onShow(next)
    } catch {
      // Rendering feedback must not stop the queue clock.
    }
    if (this.visible !== next) return

    let completedSynchronously = false
    try {
      const cancel = this.scheduler.schedule(() => {
        completedSynchronously = true
        this.finishCurrent(next)
      }, next.durationMs)
      if (!completedSynchronously && this.visible === next) this.cancelScheduled = cancel
    } catch {
      // A broken timer must not leave a notice visible forever or block the queue.
      this.finishCurrent(next)
    }
  }

  /** Lets one synchronous event batch enter the queue before choosing its first visible item. */
  private requestStart(): void {
    if (this.visible || this.waiting.length === 0 || this.startPending) return
    this.startPending = true
    try {
      const cancel = this.scheduler.schedule(() => {
        this.startPending = false
        this.cancelStartScheduled = null
        this.showNext()
      }, 0)
      // A scheduler may execute synchronously; do not retain a stale cancel handle in that case.
      if (this.startPending) this.cancelStartScheduled = cancel
    } catch {
      this.startPending = false
      this.cancelStartScheduled = null
      this.showNext()
    }
  }

  private finishCurrent(expected?: QueuedNotification): void {
    const hidden = this.visible
    if (!hidden || (expected && hidden !== expected)) return
    this.cancelScheduled = null
    this.visible = null
    this.remember(hidden.key)
    this.safeHide(hidden)
    this.showNext()
  }

  private safeHide(notice: QueuedNotification): void {
    try {
      this.onHide(notice)
    } catch {
      // A renderer failure cannot block later notices.
    }
  }

  private remember(key: string): void {
    this.recentKeys.push(key)
    this.recentSet.add(key)
    while (this.recentKeys.length > this.recentLimit) {
      const expired = this.recentKeys.shift()!
      this.recentSet.delete(expired)
    }
  }
}
