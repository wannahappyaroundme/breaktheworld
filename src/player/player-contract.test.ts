import { describe, expect, it } from 'vitest'

import {
  isUuid,
  normalizeProfileName,
  parsePlayerAuthRequest,
  validatePinPair,
} from '../../supabase/functions/_shared/player-contract'

const REQUEST_ID = '10000000-0000-4000-8000-000000000001'

describe('player profile contract', () => {
  it.each([
    ['예진', { displayName: '예진', nameKey: '예진' }],
    ['Yejin2455', { displayName: 'Yejin2455', nameKey: 'yejin2455' }],
    ['가나다라마바사아자차카타', { displayName: '가나다라마바사아자차카타', nameKey: '가나다라마바사아자차카타' }],
    ['A\u0301A', null],
    ['ㄱ예진', null],
    ['예 진', null],
    ['예진!', null],
    ['🙂예진', null],
    ['가', null],
    ['가나다라마바사아자차카타파', null],
    ['', null],
  ])('normalizes %s with the shared ID rules', (raw, expected) => {
    expect(normalizeProfileName(raw)).toEqual(expected)
  })

  it('rejects non-string profile IDs', () => {
    expect(normalizeProfileName(null)).toBeNull()
    expect(normalizeProfileName(2455)).toBeNull()
    expect(normalizeProfileName(['예진'])).toBeNull()
  })

  it('keeps leading zeroes and requires matching six ASCII digits', () => {
    expect(validatePinPair('024550', '024550')).toEqual({ ok: true, pin: '024550' })
    expect(validatePinPair('24550', '24550')).toEqual({ ok: false, code: 'invalid_pin' })
    expect(validatePinPair('0245500', '0245500')).toEqual({ ok: false, code: 'invalid_pin' })
    expect(validatePinPair('０２４５５０', '０２４５５０')).toEqual({ ok: false, code: 'invalid_pin' })
    expect(validatePinPair(245500, 245500)).toEqual({ ok: false, code: 'invalid_pin' })
    expect(validatePinPair('024550', '024551')).toEqual({ ok: false, code: 'pin_mismatch' })
  })

  it('recognizes only canonical UUID text', () => {
    expect(isUuid(REQUEST_ID)).toBe(true)
    expect(isUuid(REQUEST_ID.toUpperCase())).toBe(true)
    expect(isUuid('10000000000040008000000000000001')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(null)).toBe(false)
  })

  it.each([
    [{ action: 'check-name', profileName: '예진' }],
    [{
      action: 'create',
      requestId: REQUEST_ID,
      profileName: '예진',
      pin: '024550',
      pinConfirmation: '024550',
      privacyVersion: 1,
      over14: true,
    }],
    [{ action: 'login', profileName: '예진', pin: '024550' }],
    [{ action: 'session' }],
    [{ action: 'change-pin', pin: '024550', pinConfirmation: '024550' }],
  ])('accepts an exact valid request: %j', (request) => {
    expect(parsePlayerAuthRequest(request)).toEqual(request)
  })

  it.each([
    { action: 'login', profileName: '예진', pin: '024550', email: 'x' },
    { action: 'login', profileName: '예 진', pin: '024550' },
    { action: 'login', profileName: '예진', pin: '24550' },
    { action: 'check-name', profileName: 'ㄱ예진' },
    { action: 'create', requestId: 'bad', profileName: '예진', pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: true },
    { action: 'create', requestId: REQUEST_ID, profileName: '예진', pin: '024550', pinConfirmation: '024551', privacyVersion: 1, over14: true },
    { action: 'create', requestId: REQUEST_ID, profileName: '예진', pin: '024550', pinConfirmation: '024550', privacyVersion: 2, over14: true },
    { action: 'create', requestId: REQUEST_ID, profileName: '예진', pin: '024550', pinConfirmation: '024550', privacyVersion: 1, over14: false },
    { action: 'session', userId: REQUEST_ID },
    { action: 'change-pin', pin: '024550', pinConfirmation: '024551' },
    { action: 'unknown' },
    null,
    [],
  ])('rejects an invalid or non-exact request: %j', (request) => {
    expect(parsePlayerAuthRequest(request)).toBeNull()
  })
})
