import { describe, expect, it, vi } from 'vitest'

import {
  AdminView,
  canManageAccounts,
  characterDisplayName,
  formatMetricValue,
  nextDialogFocusIndex,
  questInputFromForm,
} from './view'

describe('operator view helpers', () => {
  it('ignores signed-out events while login verification has no dashboard session', () => {
    const view = new AdminView({} as HTMLElement, {} as never)

    expect(() => view.renderSessionExpired()).not.toThrow()
  })

  it('keeps account changes owner-only in rendered controls', () => {
    expect(canManageAccounts('owner')).toBe(true)
    expect(canManageAccounts('operator')).toBe(false)
  })

  it('turns local date fields into real ISO values without accepting an impossible interval', () => {
    const values = new FormData()
    values.set('id', 'targets_4')
    values.set('copy', '타겟 4개 부수기')
    values.set('eventType', 'TARGET_DESTROYED')
    values.set('target', '4')
    values.set('activeFrom', '2026-07-16T09:00')
    values.set('activeTo', '2026-07-17T09:00')
    values.set('enabled', 'on')
    values.set('version', '2')

    expect(questInputFromForm(values)).toMatchObject({
      id: 'targets_4',
      activeFrom: expect.stringMatching(/^2026-07-16T/),
      activeTo: expect.stringMatching(/^2026-07-17T/),
      target: 4,
      enabled: true,
      version: 2,
    })
  })

  it.each([
    [0, 0, false, 0],
    [4, 0, true, 3],
    [4, 3, false, 0],
    [4, 1, true, 0],
    [4, 1, false, 2],
  ])('traps dialog focus count=%i current=%i reverse=%s', (count, current, reverse, expected) => {
    expect(nextDialogFocusIndex(count, current, reverse)).toBe(expected)
  })

  it('uses a helpful empty value and compact percentages', () => {
    expect(formatMetricValue(null)).toBe('아직 기록이 없어요')
    expect(formatMetricValue(0, 'percent')).toBe('0%')
    expect(formatMetricValue(82.5, 'percent')).toBe('82.5%')
  })

  it('shows plain Korean character names instead of stored identifiers', () => {
    expect(characterDisplayName('cat')).toBe('고양이')
    expect(characterDisplayName('not-a-character')).toBe('알 수 없는 캐릭터')
  })

  it('renders the challenge manager as the required table with accessible switches', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const source = readFileSync(new URL('./view.ts', import.meta.url), 'utf8')

    expect(source).toContain("this.section('오늘의 도전 관리'")
    expect(source).toContain("element('table', 'admin-quest-table')")
    expect(source).toContain("toggle.setAttribute('role', 'switch')")
  })
})
