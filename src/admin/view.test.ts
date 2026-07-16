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
import type { ManagedPlayer } from '../player/admin-contract'

interface FakeEvent {
  key?: string
  shiftKey?: boolean
  target?: FakeElement
  preventDefault(): void
}

type FakeListener = (event: FakeEvent) => void

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
  value = ''
  name = ''
  pattern = ''
  inputMode = ''
  autocomplete = ''
  title = ''
  minLength = 0
  maxLength = 0
  required = false
  checked = false
  selected = false
  noValidate = false
  isConnected = true
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
    if (this.disabled) return
    this.dispatch('click')
    if (this.type === 'submit') {
      let ancestor = this.parent
      while (ancestor && ancestor.tagName !== 'FORM') ancestor = ancestor.parent
      ancestor?.dispatch('submit')
    }
  }

  dispatch(type: string, event: Partial<FakeEvent> = {}): void {
    const fakeEvent: FakeEvent = {
      preventDefault() {},
      target: this,
      ...event,
    }
    for (const listener of this.listeners.get(type) ?? []) listener(fakeEvent)
  }

  focus(): void {
    ;(document as unknown as { activeElement: FakeElement | null }).activeElement = this
  }

  close(): void {
    this.attributes.delete('open')
    this.dispatch('close')
  }

  showModal(): void {
    this.attributes.set('open', '')
  }

  remove(): void {
    if (this.parent) {
      const index = this.parent.children.indexOf(this)
      if (index >= 0) this.parent.children.splice(index, 1)
    }
    this.parent = null
    this.isConnected = false
  }

  querySelectorAll<T>(selector: string): T[] {
    const nodes = descendants(this).slice(1)
    if (selector === '[data-focus-key]') {
      return nodes.filter((node) => typeof node.dataset.focusKey === 'string') as T[]
    }
    if (selector.includes('button:not([disabled])')) {
      return nodes.filter((node) => ['BUTTON', 'INPUT', 'SELECT'].includes(node.tagName) && !node.disabled) as T[]
    }
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

function byName(root: FakeElement, name: string): FakeElement {
  const result = descendants(root).find((node) => node.name === name)
  if (!result) throw new Error(`Missing field named: ${name}`)
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

const PLAYER_ID = '11111111-1111-4111-8111-111111111111'
const INACTIVE_PLAYER_ID = '22222222-2222-4222-8222-222222222222'
const PLAYERS: ManagedPlayer[] = [
  {
    userId: PLAYER_ID,
    displayName: '예진',
    status: 'active',
    forcePinChange: false,
    createdAt: '2026-07-16T00:00:00Z',
    lastSyncAt: null,
  },
  {
    userId: INACTIVE_PLAYER_ID,
    displayName: '테스트친구',
    status: 'inactive',
    forcePinChange: true,
    createdAt: '2026-07-15T00:00:00Z',
    lastSyncAt: '2026-07-16T03:04:00Z',
  },
]

function dashboardApi(options: {
  role?: 'owner' | 'operator'
  metrics?: ApiResult<DailyMetrics>
  admins?: ApiResult<ManagedAdmin[]>
  players?: ApiResult<ManagedPlayer[]>
  listPlayers?: AdminApi['listPlayers']
  resetPlayerPin?: AdminApi['resetPlayerPin']
  deactivatePlayer?: AdminApi['deactivatePlayer']
  deletePlayer?: AdminApi['deletePlayer']
  signOut?: ReturnType<typeof vi.fn>
} = {}): AdminApi {
  return {
    restoreSession: vi.fn(async () => ({
      ok: true,
      data: { userId: 'owner', email: 'owner@example.test', role: options.role ?? 'owner' },
    })),
    listQuests: vi.fn(async () => ({ ok: true, data: [] })),
    listFlags: vi.fn(async () => ({ ok: true, data: [] })),
    loadDailyMetrics: vi.fn(async () => options.metrics ?? { ok: true, data: EMPTY_METRICS }),
    listAdmins: vi.fn(async () => options.admins ?? { ok: true, data: [] }),
    listPlayers: options.listPlayers ?? vi.fn(async () => options.players ?? { ok: true, data: [] }),
    resetPlayerPin: options.resetPlayerPin ?? vi.fn(async () => ({ ok: true, data: PLAYERS[0] })),
    deactivatePlayer: options.deactivatePlayer ?? vi.fn(async () => ({ ok: true, data: PLAYERS[0] })),
    deletePlayer: options.deletePlayer ?? vi.fn(async () => ({ ok: true, data: null })),
    signOut: options.signOut ?? vi.fn(async () => ({ ok: true, data: null })),
  } as unknown as AdminApi
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}


function deferredResult<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
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

  it('loads owner players and renders only the safe player fields and exact actions', async () => {
    installFakeDocument()
    const root = new FakeElement('DIV')
    const listPlayers = vi.fn(async () => ({ ok: true as const, data: PLAYERS }))

    await new AdminView(root as unknown as HTMLElement, dashboardApi({ listPlayers })).start()

    expect(listPlayers).toHaveBeenCalledTimes(1)
    const section = sectionByHeading(root, '플레이어 프로필')
    expect(section.textContent).toContain('예진')
    expect(section.textContent).toContain('사용 중')
    expect(section.textContent).toContain('아직 저장된 기록이 없어요')
    expect(section.textContent).toContain('사용자 PIN')
    expect(section.textContent).toContain('테스트친구')
    expect(section.textContent).toContain('잠시 멈춤')
    expect(section.textContent).toContain('임시 PIN, 다음 로그인 때 변경')
    expect(section.textContent).not.toContain(PLAYER_ID)
    expect(section.textContent).not.toContain('progress')
    expect(descendants(section).some((node) => node.dataset.userId === PLAYER_ID)).toBe(true)
    expect(byText(section, 'BUTTON', 'PIN 재설정').disabled).toBe(false)
    expect(byText(section, 'BUTTON', '잠시 멈추기').disabled).toBe(false)
    expect(byText(section, 'BUTTON', 'PIN 재설정하고 다시 사용').disabled).toBe(false)
    expect(descendants(section).filter((node) => node.tagName === 'BUTTON' && node.textContent === '다시 사용')).toHaveLength(0)
  })

  it('keeps player management owner-only without calling the player function for operators', async () => {
    installFakeDocument()
    const root = new FakeElement('DIV')
    const listPlayers = vi.fn()

    await new AdminView(root as unknown as HTMLElement, dashboardApi({ role: 'operator', listPlayers })).start()

    expect(listPlayers).not.toHaveBeenCalled()
    const section = sectionByHeading(root, '플레이어 프로필')
    expect(section.textContent).toContain('전체 운영자가 플레이어 프로필을 관리해요.')
    expect(descendants(section).filter((node) => node.tagName === 'BUTTON')).toHaveLength(0)
  })

  it('isolates player loading failure and retries without hiding the other dashboard sections', async () => {
    installFakeDocument()
    const root = new FakeElement('DIV')
    const listPlayers = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { kind: 'request', message: '내부 오류 문구' } })
      .mockResolvedValueOnce({ ok: true, data: [] })

    await new AdminView(root as unknown as HTMLElement, dashboardApi({ listPlayers })).start()

    const failed = sectionByHeading(root, '플레이어 프로필')
    expect(failed.textContent).toContain('플레이어 목록을 다시 불러와 주세요.')
    expect(root.textContent).toContain('오늘의 도전 관리')
    expect(root.textContent).toContain('기능 설정')
    byText(failed, 'BUTTON', '다시 불러오기').click()
    await flushPromises()

    expect(listPlayers).toHaveBeenCalledTimes(2)
    expect(sectionByHeading(root, '플레이어 프로필').textContent).toContain('플레이어가 프로필을 만들면')
  })

  it('validates an exact six-digit temporary PIN, shows both fields, and prevents duplicate reset requests', async () => {
    installFakeDocument()
    const root = new FakeElement('DIV')
    const pending = deferredResult<ApiResult<ManagedPlayer>>()
    const resetPlayerPin = vi.fn(() => pending.promise)
    await new AdminView(root as unknown as HTMLElement, dashboardApi({
      players: { ok: true, data: [PLAYERS[0]] },
      resetPlayerPin,
    })).start()
    const trigger = byText(sectionByHeading(root, '플레이어 프로필'), 'BUTTON', 'PIN 재설정')

    trigger.click()
    const dialog = descendants((document as unknown as { body: FakeElement }).body).find((node) => node.tagName === 'DIALOG')!
    const pin = byName(dialog, 'temporaryPin')
    const confirmation = byName(dialog, 'temporaryPinConfirmation')
    const form = descendants(dialog).find((node) => node.tagName === 'FORM')!
    expect([pin.type, confirmation.type]).toEqual(['password', 'password'])
    expect([pin.inputMode, confirmation.inputMode]).toEqual(['numeric', 'numeric'])
    expect([pin.pattern, confirmation.pattern]).toEqual(['[0-9]{6}', '[0-9]{6}'])
    expect([pin.minLength, pin.maxLength]).toEqual([6, 6])

    pin.value = '12345'
    confirmation.value = '12345'
    form.dispatch('submit')
    expect(resetPlayerPin).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain('PIN은 숫자 6자리로 입력해 주세요.')

    pin.value = '123456'
    confirmation.value = '654321'
    form.dispatch('submit')
    expect(resetPlayerPin).not.toHaveBeenCalled()
    expect(dialog.textContent).toContain('PIN을 같은 숫자 6자리로 다시 입력해 주세요.')

    byText(dialog, 'BUTTON', 'PIN 보이기').click()
    expect([pin.type, confirmation.type]).toEqual(['text', 'text'])
    confirmation.value = '123456'
    form.dispatch('submit')
    form.dispatch('submit')
    expect(resetPlayerPin).toHaveBeenCalledTimes(1)
    expect(resetPlayerPin).toHaveBeenCalledWith(PLAYER_ID, '123456', '123456')

    pending.resolve({ ok: true, data: PLAYERS[0] })
    await flushPromises()
    expect(root.textContent).toContain('임시 PIN으로 바꿨어요. 모든 기기에서 다시 로그인해 주세요.')
  })

  it('confirms deactivation once and returns focus when a player dialog is cancelled', async () => {
    installFakeDocument()
    const root = new FakeElement('DIV')
    const pending = deferredResult<ApiResult<ManagedPlayer>>()
    const deactivatePlayer = vi.fn(() => pending.promise)
    await new AdminView(root as unknown as HTMLElement, dashboardApi({
      players: { ok: true, data: [PLAYERS[0]] },
      deactivatePlayer,
    })).start()
    const trigger = byText(sectionByHeading(root, '플레이어 프로필'), 'BUTTON', '잠시 멈추기')

    trigger.click()
    let dialog = descendants((document as unknown as { body: FakeElement }).body).find((node) => node.tagName === 'DIALOG')!
    expect(dialog.textContent).toContain('새 로그인을 잠시 멈출까요?')
    const confirm = byText(dialog, 'BUTTON', '잠시 멈추기')
    confirm.click()
    confirm.click()
    expect(deactivatePlayer).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, data: { ...PLAYERS[0], status: 'inactive' } })
    await flushPromises()
    expect(root.textContent).toContain('이 프로필의 새 로그인을 잠시 멈췄어요.')

    const resetTrigger = byText(sectionByHeading(root, '플레이어 프로필'), 'BUTTON', 'PIN 재설정')
    resetTrigger.click()
    dialog = descendants((document as unknown as { body: FakeElement }).body).find((node) => node.tagName === 'DIALOG')!
    byText(dialog, 'BUTTON', '돌아가기').click()
    expect((document as unknown as { activeElement: FakeElement }).activeElement).toBe(resetTrigger)
  })

  it('requires the exact visible profile ID before one irreversible delete request', async () => {
    installFakeDocument()
    const root = new FakeElement('DIV')
    const pending = deferredResult<ApiResult<null>>()
    const deletePlayer = vi.fn(() => pending.promise)
    await new AdminView(root as unknown as HTMLElement, dashboardApi({
      players: { ok: true, data: [PLAYERS[0]] },
      deletePlayer,
    })).start()
    byText(sectionByHeading(root, '플레이어 프로필'), 'BUTTON', '삭제').click()

    const dialog = descendants((document as unknown as { body: FakeElement }).body).find((node) => node.tagName === 'DIALOG')!
    expect(dialog.textContent).toContain('프로필과 저장된 기록을 모두 삭제해요. 삭제한 기록은 다시 불러올 수 없어요.')
    const confirmation = byName(dialog, 'profileConfirmation')
    const confirm = byText(dialog, 'BUTTON', '프로필 삭제')
    expect(confirm.disabled).toBe(true)
    confirmation.value = '예진아님'
    confirmation.dispatch('input')
    expect(confirm.disabled).toBe(true)
    confirmation.value = '예진'
    confirmation.dispatch('input')
    expect(confirm.disabled).toBe(false)
    confirm.click()
    confirm.click()
    expect(deletePlayer).toHaveBeenCalledTimes(1)
    expect(deletePlayer).toHaveBeenCalledWith(PLAYER_ID, '예진', '예진')
  })

  it('ships explicit mobile player labels at the 640px card breakpoint', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const source = readFileSync(new URL('./style.css', import.meta.url), 'utf8')

    expect(source).toContain('@media (max-width: 640px)')
    expect(source).toContain('.admin-player-meta')
    expect(source).toContain('.admin-player-actions')
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
