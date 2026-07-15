import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionDamageResolution } from '../combat/action-controller'
import {
  HOLD_HINT_COPY,
  LEGACY_HOLD_HINT_SEEN_KEY,
  OneTimeHoldHint,
} from './hold-hint'

class FakeClassList {
  hidden = false

  add(value: string): void {
    if (value === 'hidden') this.hidden = true
  }

  remove(value: string): void {
    if (value === 'hidden') this.hidden = false
  }
}

function damage(kind: ActionDamageResolution['kind'], detached: number): ActionDamageResolution {
  return {
    actionId: 1,
    targetRunId: 1,
    weaponId: 'hammer',
    kind,
    charge: 0,
    damage: { detached, before: 20, remaining: 20 - detached, initial: 20, destroyed: false },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OneTimeHoldHint', () => {
  it('reveals exact copy once after the first valid quick damage and persists a migration key', () => {
    const classList = new FakeClassList()
    const element = { textContent: '', classList }
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() }
    const scheduleHide = vi.fn()
    const hint = new OneTimeHoldHint(
      element as unknown as HTMLElement,
      storage,
      scheduleHide
    )

    hint.hideInitial()
    expect(classList.hidden).toBe(true)
    expect(hint.onDamage(damage('charged', 8))).toBe(false)
    expect(hint.onDamage(damage('quick', 0))).toBe(false)
    expect(hint.onDamage(damage('quick', 4))).toBe(true)
    expect(element.textContent).toBe(HOLD_HINT_COPY)
    expect(HOLD_HINT_COPY).toBe('꾹 눌러 힘을 모으고, 떼면 한방!')
    expect(classList.hidden).toBe(false)
    expect(storage.setItem).toHaveBeenCalledWith(LEGACY_HOLD_HINT_SEEN_KEY, '1')
    expect(scheduleHide).toHaveBeenCalledTimes(1)
    expect(scheduleHide).toHaveBeenCalledWith(expect.any(Function), 4_000)

    hint.hideInitial()
    expect(classList.hidden).toBe(false)
    const hide = scheduleHide.mock.calls[0][0] as () => void
    hide()
    expect(classList.hidden).toBe(true)
    expect(hint.onDamage(damage('quick', 4))).toBe(false)
  })

  it('does not reveal again when the temporary seen key already exists', () => {
    const element = { textContent: '', classList: new FakeClassList() }
    const storage = { getItem: vi.fn(() => '1'), setItem: vi.fn() }
    const hint = new OneTimeHoldHint(element as unknown as HTMLElement, storage, vi.fn())

    expect(hint.onDamage(damage('quick', 4))).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('keeps the session playable when storage is blocked', () => {
    const element = { textContent: '', classList: new FakeClassList() }
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked')
      }),
    }
    const hint = new OneTimeHoldHint(element as unknown as HTMLElement, storage, vi.fn())

    expect(() => hint.onDamage(damage('quick', 4))).not.toThrow()
    expect(hint.onDamage(damage('quick', 4))).toBe(false)
  })

  it('survives a throwing browser localStorage getter before constructor body execution', () => {
    const browser = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new Error('getter blocked')
      },
    })
    vi.stubGlobal('window', browser)
    const element = { textContent: '', classList: new FakeClassList() }

    expect(
      () => new OneTimeHoldHint(element as unknown as HTMLElement, undefined, vi.fn())
    ).not.toThrow()
  })
})
