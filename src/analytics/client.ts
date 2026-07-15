import type { GameEvent, EventSource } from '../progress/events'
import { isApprovedAnalyticsWeaponId } from '../../supabase/functions/_shared/weapon-ids'

export type AnalyticsEventType =
  | 'visit'
  | 'first_hit'
  | 'first_destroy'
  | 'weapon_use'
  | 'target_finish_actions'
  | 'charge_release'
  | 'charge_cancel'
  | 'quest_complete'
  | 'share_complete'

export interface AnalyticsPayload {
  eventType: AnalyticsEventType
  dayKey: string
  installHash: string
  weaponId: string | null
  value: number
}

export interface AnalyticsSupabaseClient {
  functions: {
    invoke(
      name: string,
      input?: { body?: unknown }
    ): Promise<unknown>
  }
}

export interface AnalyticsTransport {
  send(payloads: readonly AnalyticsPayload[]): Promise<{ status: number; accepted?: number }>
}

export interface AnalyticsClientOptions {
  installSeed: string
  supabase: AnalyticsSupabaseClient | null
  enabled: boolean
  initialValidHits?: number
  initialTargets?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  schedule?: (run: () => void, ms: number) => unknown
  clearSchedule?: (handle: unknown) => void
  hash?: (value: string) => Promise<string>
}

const QUEUE_CAP = 100
const BATCH_CAP = 20
const FLUSH_INTERVAL_MS = 10_000
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const
const RECENT_ACTION_CAP = 128

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ''
  )
  return `${part('year')}-${part('month')}-${part('day')}`
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function safeAccepted(value: unknown, batchLength: number): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= batchLength
    ? value as number
    : undefined
}

async function responseResult(
  result: unknown,
  batchLength: number
): Promise<{ status: number; accepted?: number }> {
  if (!result || typeof result !== 'object') return { status: 0 }
  const record = result as Record<string, unknown>
  let status = typeof record.status === 'number' ? record.status : 0
  let accepted = safeAccepted(record.accepted, batchLength)
  if (record.data && typeof record.data === 'object') {
    accepted ??= safeAccepted((record.data as Record<string, unknown>).accepted, batchLength)
  }
  if (record.response instanceof Response) status = record.response.status
  const error = record.error
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>
    if (typeof errorRecord.status === 'number') status = errorRecord.status
    if (errorRecord.context instanceof Response) {
      status = errorRecord.context.status
      try {
        const body = await errorRecord.context.clone().json() as unknown
        if (body && typeof body === 'object') {
          accepted ??= safeAccepted((body as Record<string, unknown>).accepted, batchLength)
        }
      } catch {
        // A non-JSON error response still carries a usable HTTP status.
      }
    }
  }
  if (status === 0 && !error) status = 200
  return accepted === undefined ? { status } : { status, accepted }
}

export class AnalyticsClient {
  private readonly queue: AnalyticsPayload[] = []
  private readonly targetActions = new Map<number, Set<number>>()
  private readonly recentKeys: string[] = []
  private readonly recentSet = new Set<string>()
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>
  private readonly schedule: (run: () => void, ms: number) => unknown
  private readonly clearSchedule: (handle: unknown) => void
  private scheduleHandle: unknown = null
  private flushing: Promise<void> | null = null
  private featureEnabled: boolean
  private sessionDisabled = false
  private hasHit: boolean
  private hasDestroy: boolean
  private visitQueued = false

  private constructor(
    private readonly installHash: string | null,
    private readonly transport: AnalyticsTransport | null,
    options: Omit<AnalyticsClientOptions, 'installSeed' | 'supabase' | 'hash'>
  ) {
    this.featureEnabled = options.enabled
    this.hasHit = (options.initialValidHits ?? 0) > 0
    this.hasDestroy = (options.initialTargets ?? 0) > 0
    this.now = options.now ?? (() => new Date())
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.schedule = options.schedule ?? ((run, ms) => window.setInterval(run, ms))
    this.clearSchedule = options.clearSchedule ?? ((handle) => clearInterval(handle as number))
    if (this.isEnabled) this.start()
  }

  static async create(options: AnalyticsClientOptions): Promise<AnalyticsClient> {
    if (!options.supabase) {
      return new AnalyticsClient(null, null, { ...options, enabled: false })
    }
    let installHash: string
    try {
      installHash = await (options.hash ?? sha256)(options.installSeed)
    } catch {
      return new AnalyticsClient(null, null, { ...options, enabled: false })
    }
    if (!/^[a-f0-9]{64}$/.test(installHash)) {
      return new AnalyticsClient(null, null, { ...options, enabled: false })
    }
    return new AnalyticsClient(
      installHash,
      createSupabaseAnalyticsTransport(options.supabase),
      options
    )
  }

  get pendingCount(): number { return this.queue.length }

  get isEnabled(): boolean {
    return this.featureEnabled && !this.sessionDisabled && this.transport !== null && this.installHash !== null
  }

  setEnabled(enabled: boolean): void {
    if (this.sessionDisabled) return
    this.featureEnabled = enabled
    if (!enabled) {
      this.clear()
      this.stopSchedule()
      return
    }
    if (this.isEnabled) this.start()
  }

  track(event: GameEvent): void {
    if (!this.isEnabled || event.type === 'SETTING_CHANGED' || event.source !== 'user') return
    try {
      switch (event.type) {
        case 'ATTACK_RESOLVED':
          if (!this.validAction(event) || !Number.isFinite(event.detached) || event.detached <= 0) return
          this.rememberTargetAction(event.targetRunId, event.actionId)
          if (!this.hasHit) {
            this.hasHit = true
            this.enqueue('first_hit', event.weaponId, 1)
          }
          return
        case 'WEAPON_USED':
          if (!this.validAction(event) || !this.remember(`used:${event.actionId}:${event.targetRunId}`)) return
          this.enqueue('weapon_use', event.weaponId, 1)
          return
        case 'CHARGE_RELEASED':
          return
        case 'TARGET_DESTROYED': {
          if (!this.validAction(event) || !this.remember(`destroyed:${event.actionId}:${event.targetRunId}`)) return
          if (!this.hasDestroy) {
            this.hasDestroy = true
            this.enqueue('first_destroy', event.weaponId, 1)
          }
          const actions = this.targetActions.get(event.targetRunId)?.size ?? 1
          this.targetActions.delete(event.targetRunId)
          this.enqueue('target_finish_actions', event.weaponId, Math.min(3, Math.max(1, actions)))
          return
        }
        case 'SHARE_COMPLETED':
          this.enqueue('share_complete', null, 1)
          return
        default:
          return
      }
    } catch {
      // Optional analytics never interrupt an accepted gameplay event.
    }
  }

  trackChargeCancel(weaponId: string, source: EventSource): void {
    if (source !== 'user' || !isApprovedAnalyticsWeaponId(weaponId)) return
    try {
      this.enqueue('charge_cancel', weaponId, 1)
    } catch {
      // Optional analytics never interrupt a cancellation.
    }
  }

  trackChargeRelease(weaponId: string, source: EventSource): void {
    if (source !== 'user' || !isApprovedAnalyticsWeaponId(weaponId)) return
    try {
      this.enqueue('charge_release', weaponId, 1)
    } catch {
      // Optional analytics never interrupt a release.
    }
  }

  trackQuestComplete(source: EventSource): void {
    if (source !== 'user') return
    try {
      this.enqueue('quest_complete', null, 1)
    } catch {
      // Optional analytics never interrupt quest completion.
    }
  }

  clear(): void {
    this.queue.length = 0
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing.then(() => this.flush())
    if (!this.isEnabled || this.queue.length === 0 || !this.transport) return Promise.resolve()
    const batch = this.queue.splice(0, BATCH_CAP)
    this.flushing = this.sendWithRetry(batch).finally(() => { this.flushing = null })
    return this.flushing
  }

  flushOnPageHide(): void {
    try {
      void this.drainQueue().catch(() => undefined)
    } catch {
      // Page lifecycle must remain independent from telemetry.
    }
  }

  private async drainQueue(): Promise<void> {
    while (this.isEnabled && this.queue.length > 0) await this.flush()
  }

  private start(): void {
    if (!this.visitQueued) {
      this.visitQueued = true
      this.enqueue('visit', null, 1)
    }
    if (this.scheduleHandle !== null) return
    try {
      this.scheduleHandle = this.schedule(() => {
        try {
          void this.flush().catch(() => undefined)
        } catch {
          // Timer callbacks must never surface analytics errors.
        }
      }, FLUSH_INTERVAL_MS)
    } catch {
      this.scheduleHandle = null
    }
  }

  private stopSchedule(): void {
    if (this.scheduleHandle === null) return
    try {
      this.clearSchedule(this.scheduleHandle)
    } catch {
      // A blocked timer API cannot affect queue clearing.
    }
    this.scheduleHandle = null
  }

  private validAction(event: { actionId: number; targetRunId: number; weaponId: string }): boolean {
    return isPositiveSafeInteger(event.actionId)
      && isPositiveSafeInteger(event.targetRunId)
      && isApprovedAnalyticsWeaponId(event.weaponId)
  }

  private rememberTargetAction(targetRunId: number, actionId: number): void {
    let actions = this.targetActions.get(targetRunId)
    if (!actions) {
      actions = new Set<number>()
      this.targetActions.clear()
      this.targetActions.set(targetRunId, actions)
    }
    actions.add(actionId)
  }

  private remember(key: string): boolean {
    if (this.recentSet.has(key)) return false
    this.recentSet.add(key)
    this.recentKeys.push(key)
    if (this.recentKeys.length > RECENT_ACTION_CAP) {
      const expired = this.recentKeys.shift()
      if (expired) this.recentSet.delete(expired)
    }
    return true
  }

  private enqueue(eventType: AnalyticsEventType, weaponId: string | null, value: number): void {
    if (!this.isEnabled || !this.installHash) return
    this.queue.push({
      eventType,
      dayKey: dayKey(this.now()),
      installHash: this.installHash,
      weaponId,
      value,
    })
    if (this.queue.length > QUEUE_CAP) this.queue.splice(0, this.queue.length - QUEUE_CAP)
  }

  private async sendWithRetry(batch: readonly AnalyticsPayload[]): Promise<void> {
    if (!this.transport) return
    let remaining = [...batch]
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      let status = 0
      let accepted = 0
      try {
        const result = await this.transport.send(remaining)
        status = result.status
        accepted = result.accepted ?? 0
      } catch {
        status = 0
      }
      if (status >= 200 && status < 300) return
      if (status === 401 || status === 403 || status === 429) {
        this.disableSession()
        return
      }
      const transient = status === 0 || status >= 500
      if (!transient || attempt === RETRY_DELAYS_MS.length) return
      if (accepted > 0) {
        remaining = remaining.slice(Math.min(accepted, remaining.length))
        if (remaining.length === 0) return
      }
      try {
        await this.sleep(RETRY_DELAYS_MS[attempt])
      } catch {
        return
      }
      if (!this.isEnabled) return
    }
  }

  private disableSession(): void {
    this.sessionDisabled = true
    this.featureEnabled = false
    this.clear()
    this.stopSchedule()
  }
}

export function createSupabaseAnalyticsTransport(client: AnalyticsSupabaseClient): AnalyticsTransport {
  return {
    async send(payloads) {
      try {
        const result = await client.functions.invoke('ingest-analytics', { body: payloads })
        return responseResult(result, payloads.length)
      } catch {
        return { status: 0 }
      }
    },
  }
}
