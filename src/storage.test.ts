import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBrowserStorage, readStoredNumber, writeStoredNumber } from './storage'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safe legacy storage', () => {
  it('returns fallbacks when the browser localStorage getter throws', () => {
    const browser = Object.defineProperty({}, 'localStorage', {
      get() {
        throw new Error('getter blocked')
      },
    })
    vi.stubGlobal('window', browser)

    expect(getBrowserStorage()).toBeNull()
    expect(readStoredNumber('btw.bestCombo')).toBe(0)
    expect(writeStoredNumber('btw.bestCombo', 12)).toBe(false)
  })

  it('contains getItem and setItem denial without losing valid fallback behavior', () => {
    const blocked = {
      getItem: vi.fn(() => {
        throw new Error('read blocked')
      }),
      setItem: vi.fn(() => {
        throw new Error('write blocked')
      }),
    }

    expect(readStoredNumber('btw.totalTargets', 7, blocked)).toBe(7)
    expect(writeStoredNumber('btw.totalTargets', 9, blocked)).toBe(false)
  })

  it('reads finite non-negative counters and writes their integer form', () => {
    const storage = {
      getItem: vi.fn(() => '42'),
      setItem: vi.fn(),
    }

    expect(readStoredNumber('btw.bestCombo', 0, storage)).toBe(42)
    expect(writeStoredNumber('btw.bestCombo', 43, storage)).toBe(true)
    expect(storage.setItem).toHaveBeenCalledWith('btw.bestCombo', '43')
  })
})
