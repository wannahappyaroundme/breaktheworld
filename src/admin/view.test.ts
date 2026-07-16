import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AdminView,
  canManageAccounts,
  characterDisplayName,
  formatMetricValue,
  nextDialogFocusIndex,
  questInputFromForm,
} from './view'
import type { AdminApi, ApiResult, DailyMetrics, ManagedAdmin } from './api'

type FakeListener = (event: { preventDefault(): void }) => void

class FakeElement {
  readonly children: FakeElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, FakeListener[]>()
  private ownText = ''
  className = ''
  id = ''
  disabled = false
  hidden = false
  type = ''
  parent: FakeElement | null = null

  constructor(readonly tagName: string) {}

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.ownText = value
    this.children.splice(0)
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parent = this
      this.children.push(node)
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.ownText = ''
    this.children.splice(0)
    this.append(...nodes)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(type: string, listener: FakeListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener({ preventDefault() {} })
  }

  focus(): void {}

  querySelectorAll<T>(): T[] {
    return []
  }
}

function installFakeDocument(): void {
  const body = new FakeElement('BODY')
  vi.stubGlobal('document', {
    body,
    activeElement: null,
    createElement: (tag: string) => new FakeElement(tag.toUpperCase()),
  })
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(descendants)]
}

function byText(root: FakeElement, tagName: string, copy: string): FakeElement {
  const result = descendants(root).find((node) => node.tagName === tagName && node.textContent === copy)
  if (!result) throw new Error(`Missing ${tagName} with copy: ${copy}`)
  return result
}

function sectionByHeading(root: FakeElement, heading: string): FakeElement {
  const title = byText(root, 'H2', heading)
  const section = descendants(root).find((node) => node.tagName === 'SECTION' && descendants(node).includes(title))
  if (!section) throw new Error(`Missing section: ${heading}`)
  return section
}

const EMPTY_METRICS: DailyMetrics = {
  visits: 0,
  firstValidAttacks: 0,
  firstDestroys: 0,
  chargeCompletionRate: 0,
  questsCompleted: 0,
  sharesCompleted: 0,
  characterUses: [],
  averageFinishActions: null,
}

function dashboardApi(options: {
  metrics?: ApiResult<DailyMetrics>
  admins?: ApiResult<ManagedAdmin[]>
  signOut?: ReturnType<typeof vi.fn>
} = {}): AdminApi {
  return {
    restoreSession: vi.fn(async () => ({
      ok: true,
      data: { userId: 'owner', email: 'owner@example.test', role: 'owner' },
    })),
    listQuests: vi.fn(async () => ({ ok: true, data: [] })),
    listFlags: vi.fn(async () => ({ ok: true, data: [] })),
    loadDailyMetrics: vi.fn(async () => options.metrics ?? { ok: true, data: EMPTY_METRICS }),
    listAdmins: vi.fn(async () => options.admins ?? { ok: true, data: [] }),
    signOut: options.signOut ?? vi.fn(async () => ({ ok: true, data: null })),
  } as unknown as AdminApi
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it.each(['metrics', 'accounts'] as const)(
    'keeps challenge and flag controls usable when %s fails',
    async (failedSection) => {
      installFakeDocument()
      const failure = { ok: false, error: { kind: 'request', message: '이 영역을 불러오지 못했어요.' } } as const
      const root = new FakeElement('DIV')
      const api = dashboardApi({
        metrics: failedSection === 'metrics' ? failure : undefined,
        admins: failedSection === 'accounts' ? failure : undefined,
      })

      await new AdminView(root as unknown as HTMLElement, api).start()

      const quests = sectionByHeading(root, '오늘의 도전 관리')
      const flags = sectionByHeading(root, '기능 설정')
      expect(byText(quests, 'BUTTON', '새 도전 만들기').disabled).toBe(false)
      expect(descendants(flags).filter((node) => node.attributes.get('role') === 'switch')).toHaveLength(3)

      const failed = sectionByHeading(root, failedSection === 'metrics' ? '사용 통계' : '운영자 계정')
      expect(failed.textContent).toContain('이 영역을 불러오지 못했어요.')
      expect(byText(failed, 'BUTTON', '다시 불러오기').disabled).toBe(false)
      expect(root.textContent).toContain('세상 부수기 관리')
    },
  )

  it('keeps the dashboard on logout failure and shows login only after confirmed success', async () => {
    installFakeDocument()
    const signOut = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { kind: 'request', message: '연결을 확인한 뒤 로그아웃을 다시 눌러 주세요.' },
      })
      .mockResolvedValueOnce({ ok: true, data: null })
    const root = new FakeElement('DIV')
    await new AdminView(root as unknown as HTMLElement, dashboardApi({ signOut })).start()
    const logout = byText(root, 'BUTTON', '로그아웃')

    logout.click()
    await flushPromises()

    expect(root.textContent).toContain('세상 부수기 관리')
    expect(root.textContent).toContain('연결을 확인한 뒤 로그아웃을 다시 눌러 주세요.')
    expect(root.textContent).not.toContain('운영자 로그인')
    expect(logout.disabled).toBe(false)

    logout.click()
    await flushPromises()

    expect(root.textContent).toContain('운영자 로그인')
    expect(root.textContent).not.toContain('세상 부수기 관리')
  })
})
