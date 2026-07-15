import { describe, expect, it, vi } from 'vitest'
import {
  MAX_NOTICE_MS,
  MIN_NOTICE_MS,
  NotificationQueue,
  type NotificationScheduler,
  type QueuedNotification,
} from './notification-queue'

class FakeScheduler implements NotificationScheduler {
  now = 0
  throwOnPositiveDelay = false
  private nextId = 0
  private tasks: Array<{ id: number; at: number; run: () => void }> = []

  schedule(run: () => void, delayMs: number): () => void {
    if (this.throwOnPositiveDelay && delayMs > 0) throw new Error('timer unavailable')
    const id = ++this.nextId
    this.tasks.push({ id, at: this.now + delayMs, run })
    return () => {
      this.tasks = this.tasks.filter((task) => task.id !== id)
    }
  }

  advance(ms: number): void {
    const end = this.now + ms
    while (true) {
      this.tasks.sort((left, right) => left.at - right.at || left.id - right.id)
      const next = this.tasks[0]
      if (!next || next.at > end) break
      this.tasks.shift()
      this.now = next.at
      next.run()
    }
    this.now = end
  }
}

function harness(recentLimit?: number) {
  const scheduler = new FakeScheduler()
  const shown: QueuedNotification[] = []
  const hidden: QueuedNotification[] = []
  const onShow = vi.fn((notice: QueuedNotification) => shown.push(notice))
  const onHide = vi.fn((notice: QueuedNotification) => hidden.push(notice))
  const queue = new NotificationQueue({ scheduler, onShow, onHide, recentLimit })
  return { queue, scheduler, shown, hidden, onShow, onHide }
}

describe('NotificationQueue', () => {
  it('never preempts the visible item and then shows waiting items by priority', () => {
    const h = harness()

    h.queue.push({ key: 'general:1', kind: 'general', text: '먼저', durationMs: 500 })
    h.scheduler.advance(0)
    h.queue.push({ key: 'quest:1', kind: 'quest', text: '오늘의 도전' })
    h.queue.push({ key: 'record:1', kind: 'record', text: '신기록', durationMs: 500 })
    h.queue.push({ key: 'achievement:1', kind: 'achievement', text: '새 도장', durationMs: 500 })

    expect(h.shown.map((notice) => notice.kind)).toEqual(['general'])
    expect(h.queue.current?.key).toBe('general:1')

    h.scheduler.advance(500)
    expect(h.shown.map((notice) => notice.kind)).toEqual(['general', 'record'])
    h.scheduler.advance(500)
    expect(h.shown.map((notice) => notice.kind)).toEqual(['general', 'record', 'achievement'])
    h.scheduler.advance(500)
    expect(h.shown.map((notice) => notice.kind)).toEqual([
      'general', 'record', 'achievement', 'quest',
    ])
  })

  it('keeps equal-priority items in insertion order', () => {
    const h = harness()

    h.queue.push({ key: 'blocker', kind: 'general', text: '표시 중', durationMs: 500 })
    h.scheduler.advance(0)
    h.queue.push({ key: 'quest:a', kind: 'quest', text: '첫 번째' })
    h.queue.push({ key: 'quest:b', kind: 'quest', text: '두 번째' })
    h.scheduler.advance(500)
    h.scheduler.advance(4_000)

    expect(h.shown.map((notice) => notice.key)).toEqual(['blocker', 'quest:a', 'quest:b'])
  })

  it('forces every quest notice to exactly 4000ms', () => {
    const h = harness()
    h.queue.push({ key: 'quest:q1', kind: 'quest', text: '오늘의 도전 완료', durationMs: 1 })
    h.scheduler.advance(0)

    expect(h.shown[0].durationMs).toBe(4_000)
    h.scheduler.advance(3_999)
    expect(h.hidden).toEqual([])
    h.scheduler.advance(1)
    expect(h.hidden.map((notice) => notice.key)).toEqual(['quest:q1'])
  })

  it('deduplicates the same key while current, queued, or in bounded recent history', () => {
    const h = harness(2)
    const push = (key: string) => h.queue.push({ key, kind: 'general', text: key, durationMs: 250 })

    expect(push('a')).toBe(true)
    expect(push('a')).toBe(false)
    expect(push('b')).toBe(true)
    expect(push('b')).toBe(false)
    h.scheduler.advance(0)
    h.scheduler.advance(500)
    expect(push('a')).toBe(false)
    expect(push('c')).toBe(true)
    h.scheduler.advance(250)
    expect(push('a')).toBe(true)
  })

  it('bounds invalid, negative, and huge non-quest durations safely', () => {
    const h = harness()

    h.queue.push({ key: 'negative', kind: 'general', text: '짧게', durationMs: -50 })
    h.queue.push({ key: 'huge', kind: 'record', text: '길게', durationMs: 999_999_999 })
    h.queue.push({ key: 'invalid', kind: 'achievement', text: '기본', durationMs: Number.NaN })
    h.scheduler.advance(0)

    expect(h.shown[0].durationMs).toBe(MAX_NOTICE_MS)
    h.scheduler.advance(MAX_NOTICE_MS)
    expect(h.shown[1].durationMs).toBeGreaterThanOrEqual(MIN_NOTICE_MS)
    expect(h.shown[1].durationMs).toBeLessThanOrEqual(MAX_NOTICE_MS)
    h.scheduler.advance(h.shown[1].durationMs)
    expect(h.shown[2].durationMs).toBe(MIN_NOTICE_MS)
  })

  it('shows and hides one completion notice exactly once for duplicate reducer output', () => {
    const h = harness()
    const completion = {
      key: 'quest:targets_3:2026-07-17:complete',
      kind: 'quest' as const,
      text: '오늘의 도전 완료',
    }

    expect(h.queue.push(completion)).toBe(true)
    expect(h.queue.push(completion)).toBe(false)
    h.scheduler.advance(0)
    h.scheduler.advance(4_000)

    expect(h.onShow).toHaveBeenCalledTimes(1)
    expect(h.onHide).toHaveBeenCalledTimes(1)
  })

  it('selects the highest priority before a synchronous notice batch becomes visible', () => {
    const h = harness()

    h.queue.push({ key: 'quest:q1', kind: 'quest', text: '오늘의 도전 완료' })
    h.queue.push({ key: 'record:50', kind: 'record', text: '최고 연속 50', durationMs: 1_800 })

    expect(h.shown).toEqual([])
    h.scheduler.advance(0)
    expect(h.shown.map((notice) => notice.kind)).toEqual(['record'])

    h.queue.push({ key: 'record:60', kind: 'record', text: '최고 연속 60', durationMs: 1_800 })
    expect(h.shown.map((notice) => notice.key)).toEqual(['record:50'])
    h.scheduler.advance(1_800)
    expect(h.shown.map((notice) => notice.key)).toEqual(['record:50', 'record:60'])
  })

  it('hides safely and drains waiting notices when duration scheduling fails', () => {
    const h = harness()
    h.scheduler.throwOnPositiveDelay = true

    h.queue.push({ key: 'achievement:1', kind: 'achievement', text: '새 도장' })
    h.queue.push({ key: 'record:1', kind: 'record', text: '신기록' })

    expect(() => h.scheduler.advance(0)).not.toThrow()
    expect(h.shown.map((notice) => notice.key)).toEqual(['record:1', 'achievement:1'])
    expect(h.hidden.map((notice) => notice.key)).toEqual(['record:1', 'achievement:1'])
    expect(h.queue.current).toBeNull()
    expect(h.queue.waitingCount).toBe(0)
  })
})
