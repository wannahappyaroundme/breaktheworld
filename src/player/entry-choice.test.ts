import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PLAYER_ENTRY_CHOICE_KEY,
  PlayerEntryChoiceStore,
  decidePlayerEntry,
  withEntryTimeout,
} from './entry-choice'

afterEach(() => { vi.useRealTimers() })

describe('first-entry profile choice', () => {
  it.each([
    [{ restore: 'player', profilesEnabled: true, guestRemembered: true }, 'player'],
    [{ restore: 'force', profilesEnabled: true, guestRemembered: true }, 'force'],
    [{ restore: 'guest', profilesEnabled: true, guestRemembered: false }, 'choose'],
    [{ restore: 'error', profilesEnabled: true, guestRemembered: false }, 'choose'],
    [{ restore: 'guest', profilesEnabled: true, guestRemembered: true }, 'guest'],
    [{ restore: 'guest', profilesEnabled: false, guestRemembered: false }, 'fallback-guest'],
  ] as const)('resolves %o to %s', (input, expected) => {
    expect(decidePlayerEntry(input)).toBe(expected)
  })

  it('stores only the exact guest marker and clears it', () => {
    const values = new Map<string, string>()
    const store = new PlayerEntryChoiceStore({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    })

    expect(store.isGuestRemembered()).toBe(false)
    expect(store.rememberGuest()).toBe(true)
    expect(values).toEqual(new Map([[PLAYER_ENTRY_CHOICE_KEY, 'guest']]))
    expect(store.isGuestRemembered()).toBe(true)
    store.clear()
    expect(store.isGuestRemembered()).toBe(false)
  })

  it.each(['Guest', ' guest', 'guest ', 'player', 'true'])(
    'does not treat %s as the guest marker',
    (value) => {
      const store = new PlayerEntryChoiceStore({
        getItem: () => value,
        setItem: () => undefined,
        removeItem: () => undefined,
      })

      expect(store.isGuestRemembered()).toBe(false)
    },
  )

  it('continues in memory when browser storage throws', () => {
    const store = new PlayerEntryChoiceStore({
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })

    expect(store.isGuestRemembered()).toBe(false)
    expect(store.rememberGuest()).toBe(false)
    expect(store.isGuestRemembered()).toBe(true)
    expect(() => store.clear()).not.toThrow()
  })

  it('releases a pending entry check after the bounded timeout', async () => {
    vi.useFakeTimers()
    const pending = new Promise<'player'>(() => undefined)
    const result = withEntryTimeout(pending, 8_000, 'fallback-guest')

    await vi.advanceTimersByTimeAsync(8_000)

    await expect(result).resolves.toEqual({ value: 'fallback-guest', timedOut: true })
  })

  it('clears the timeout when the decision resolves first', async () => {
    vi.useFakeTimers()
    await expect(withEntryTimeout(Promise.resolve('guest'), 8_000, 'fallback-guest'))
      .resolves.toEqual({ value: 'guest', timedOut: false })
    expect(vi.getTimerCount()).toBe(0)
  })
})
