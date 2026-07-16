import { describe, expect, it } from 'vitest'

import { profileAvatar } from './avatar'

describe('profileAvatar', () => {
  it('is stable for one immutable user UUID and uses the first ID character', () => {
    const userId = '10000000-0000-4000-8000-000000000001'

    expect(profileAvatar(userId, '예진')).toEqual(profileAvatar(userId, '예진'))
    expect(profileAvatar(userId, '예진').initial).toBe('예')
    expect(profileAvatar(userId, '').initial).toBe('?')
  })

  it('selects only a bounded high-contrast palette color', () => {
    const colors = new Set([
      '#3156a3', '#8452a5', '#bc5b76', '#b56a2d', '#257a73', '#5f6f2e',
    ])
    for (let index = 1; index <= 20; index += 1) {
      const userId = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      expect(colors.has(profileAvatar(userId, '예진').color)).toBe(true)
    }
  })
})
