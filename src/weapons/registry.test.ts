import { describe, expect, it } from 'vitest'
import { CHARACTER_SKINS } from '../art/assets'
import { weapons } from './registry'

describe('weapon registry contract', () => {
  it('exposes exactly 21 unique weapons without legacy weapon ids', () => {
    expect(weapons).toHaveLength(21)
    expect(new Set(weapons.map((weapon) => weapon.id)).size).toBe(21)
    expect(weapons.some((weapon) => weapon.id.endsWith('Old'))).toBe(false)
  })

  it('requires every weapon to support quick, drag, and charged actions only', () => {
    for (const weapon of weapons) {
      expect(weapon.quick, `${weapon.id} quick`).toBeTypeOf('function')
      expect(weapon.drag, `${weapon.id} drag`).toBeTypeOf('function')
      expect(weapon.charged, `${weapon.id} charged`).toBeTypeOf('function')
      expect(weapon, `${weapon.id} legacy apply`).not.toHaveProperty('apply')
    }
  })

  it('publishes default and classic skin choices in stable order', () => {
    expect(CHARACTER_SKINS.cinnamoroll.map((skin) => skin.id)).toEqual(['default', 'classic'])
    expect(CHARACTER_SKINS.ditto.map((skin) => skin.id)).toEqual(['default', 'classic'])
  })
})
