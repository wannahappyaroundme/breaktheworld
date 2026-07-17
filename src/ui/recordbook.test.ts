import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_CATALOG } from '../progress/catalog'
import { createDefaultProgress } from '../progress/defaults'
import type { RecordBookView } from '../progress/view-model'
import { makeRecordBookView } from '../progress/view-model'
import type { ProfileCardView } from '../player/types'
import { Hud } from './hud'
import type { NotificationScheduler } from './notification-queue'
import { RecordBook } from './recordbook'
import type { RecordBookSettingsState } from './settings'

type Listener = (event: FakeEvent) => void

class FakeEvent {
  target: FakeElement | FakeDocument | null
  key?: string
  shiftKey = false
  defaultPrevented = false
  propagationStopped = false

  constructor(
    readonly type: string,
    init: { target?: FakeElement | FakeDocument; key?: string; shiftKey?: boolean } = {}
  ) {
    this.target = init.target ?? null
    this.key = init.key
    this.shiftKey = init.shiftKey ?? false
  }

  preventDefault(): void {
    this.defaultPrevented = true
  }

  stopPropagation(): void {
    this.propagationStopped = true
  }
}

class FakeClassList {
  constructor(private readonly element: FakeElement) {}

  add(...names: string[]): void {
    for (const name of names) this.element.classes.add(name)
  }

  remove(...names: string[]): void {
    for (const name of names) this.element.classes.delete(name)
  }

  contains(name: string): boolean {
    return this.element.classes.has(name)
  }

  toggle(name: string, force?: boolean): boolean {
    const next = force ?? !this.contains(name)
    if (next) this.add(name)
    else this.remove(name)
    return next
  }
}

function matches(element: FakeElement, selector: string): boolean {
  const value = selector.trim()
  if (value === 'button') return element.tagName === 'BUTTON'
  if (value.startsWith('.')) return element.classList.contains(value.slice(1))
  if (value.startsWith('#')) return element.id === value.slice(1)
  const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(value)
  if (attribute) {
    const actual = element.getAttribute(attribute[1])
    return attribute[2] === undefined ? actual !== null : actual === attribute[2]
  }
  return element.tagName === value.toUpperCase()
}

class FakeElement {
  readonly children: FakeElement[] = []
  readonly classes = new Set<string>()
  readonly classList = new FakeClassList(this)
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Listener[]>()
  readonly style = {
    setProperty: vi.fn(),
  }
  parentElement: FakeElement | null = null
  hidden = false
  disabled = false
  scrollTop = 0
  id = ''
  private ownText = ''

  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  get className(): string {
    return [...this.classes].join(' ')
  }

  set className(value: string) {
    this.classes.clear()
    for (const name of value.split(/\s+/).filter(Boolean)) this.classes.add(name)
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value: string | null) {
    this.ownText = value ?? ''
    this.children.length = 0
  }

  set innerHTML(_value: string) {
    throw new Error('innerHTML is forbidden in this UI test')
  }

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) this.appendChild(node)
  }

  appendChild(node: FakeElement): FakeElement {
    node.parentElement = this
    this.children.push(node)
    return node
  }

  prepend(node: FakeElement): void {
    node.parentElement = this
    this.children.unshift(node)
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.length = 0
    this.ownText = ''
    this.append(...nodes)
  }

  remove(): void {
    if (!this.parentElement) return
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1)
    this.parentElement = null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
    if (name === 'id') this.id = value
  }

  getAttribute(name: string): string | null {
    if (name === 'id' && this.id !== '') return this.id
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener as unknown as Listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    const removed = listener as unknown as Listener
    this.listeners.set(type, listeners.filter((candidate) => candidate !== removed))
  }

  dispatch(type: string, init: Omit<ConstructorParameters<typeof FakeEvent>[1], 'target'> = {}): FakeEvent {
    const event = new FakeEvent(type, { ...init, target: this })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }

  click(): void {
    this.dispatch('click')
  }

  focus(): void {
    this.ownerDocument.activeElement = this
  }

  contains(node: FakeElement | FakeDocument | null): boolean {
    if (!(node instanceof FakeElement)) return false
    if (node === this) return true
    return this.children.some((child) => child.contains(node))
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const selectors = selector.split(',')
    const result: FakeElement[] = []
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (selectors.some((candidate) => matches(child, candidate))) result.push(child)
        visit(child)
      }
    }
    visit(this)
    return result
  }
}

class FakeDocument {
  readonly body = new FakeElement('BODY', this)
  readonly listeners = new Map<string, Listener[]>()
  activeElement: FakeElement | null = null

  createElement(tag: string): FakeElement {
    return new FakeElement(tag.toUpperCase(), this)
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener as unknown as Listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? []
    const removed = listener as unknown as Listener
    this.listeners.set(type, listeners.filter((candidate) => candidate !== removed))
  }

  dispatch(type: string, init: Omit<ConstructorParameters<typeof FakeEvent>[1], 'target'> = {}): FakeEvent {
    const event = new FakeEvent(type, { ...init, target: this })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
}

class FakeScheduler implements NotificationScheduler {
  private tasks: Array<{ at: number; run: () => void }> = []
  private now = 0

  schedule(run: () => void, delayMs: number): () => void {
    const task = { at: this.now + delayMs, run }
    this.tasks.push(task)
    return () => {
      this.tasks = this.tasks.filter((candidate) => candidate !== task)
    }
  }

  advance(ms: number): void {
    const end = this.now + ms
    while (true) {
      this.tasks.sort((left, right) => left.at - right.at)
      const next = this.tasks[0]
      if (!next || next.at > end) break
      this.tasks.shift()
      this.now = next.at
      next.run()
    }
    this.now = end
  }
}

const viewState = createDefaultProgress('recordbook-test')
viewState.daily = {
  ...viewState.daily,
  dayKey: '2026-07-17',
  questId: 'targets_3',
  target: 3,
  progress: 1,
}
viewState.lifetime.bestCombo = 24
viewState.achievements.hits_1000 = {
  unlockedAt: '2026-07-17T00:00:00.000Z',
  seen: false,
}
const baseView = makeRecordBookView(viewState, BUILT_IN_CATALOG)
const view: RecordBookView = {
  ...baseView,
  daily: { ...baseView.daily, copy: '<img src=x onerror=alert(1)>' },
  cosmetics: {
    ...baseView.cosmetics,
    skins: [baseView.cosmetics.skins[0]],
  },
  stats: {
    heading: '내 기록',
    items: [{ label: '최고 연속', value: '24' }],
  },
}

const settings: RecordBookSettingsState = {
  strongInput: 'hold',
  reducedMotion: false,
  haptics: true,
}

const guestProfile: ProfileCardView = {
  visible: true,
  kind: 'guest',
  title: '게스트로 즐기는 중',
  detail: '로그인하면 이 기기와 다른 기기에서 기록을 이어갈 수 있어요',
}

let fakeDocument: FakeDocument

beforeEach(() => {
  fakeDocument = new FakeDocument()
  vi.stubGlobal('document', fakeDocument as unknown as Document)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function byAttribute(root: FakeElement, name: string, value: string): FakeElement {
  const found = root.querySelector(`[${name}="${value}"]`)
  if (!found) throw new Error(`Missing [${name}="${value}"]`)
  return found
}

function buttonByText(root: FakeElement, text: string): FakeElement {
  const found = root.querySelectorAll('button').find((button) => button.textContent === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

function visibleButton(button: FakeElement, boundary: FakeElement): boolean {
  if (button.disabled || button.getAttribute('tabindex') === '-1') return false
  let current: FakeElement | null = button
  while (current && current !== boundary) {
    if (current.hidden) return false
    current = current.parentElement
  }
  return true
}

describe('RecordBook', () => {
  it('renders one accessible full-screen hub with four named tabs and all public details', () => {
    const parent = fakeDocument.createElement('div')
    const hubView = makeRecordBookView(createDefaultProgress('hub-dom'), BUILT_IN_CATALOG)
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      hubView,
      settings,
      { onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn() }
    )

    recordBook.open()

    expect(parent.querySelectorAll('[role="dialog"]')).toHaveLength(1)
    expect(parent.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('기록책 메뉴')
    expect(parent.querySelectorAll('[role="tab"]').map((tab) => tab.textContent)).toEqual([
      '홈', '업적', '꾸미기', '설정',
    ])
    expect(parent.textContent).toContain('다음 레벨: 50 경험치')
    buttonByText(parent, '업적').click()
    expect(parent.querySelectorAll('[data-achievement-id]')).toHaveLength(32)
    const firstHit = byAttribute(parent, 'data-achievement-id', 'first_hit')
    expect(firstHit.textContent).toContain('첫 금')
    expect(firstHit.textContent).toContain('쉬움')
    expect(firstHit.textContent).toContain('유효 공격 1회')
    expect(firstHit.textContent).toContain('0 / 1, 0%')
    expect(firstHit.textContent).toContain('경험치 +50')
    expect(firstHit.textContent).toContain('다음: 유효 공격 1회')
    const progress = firstHit.querySelector('progress')
    expect(progress?.getAttribute('max')).toBe('1')
    expect(progress?.getAttribute('value')).toBe('0')
    expect(byAttribute(parent, 'data-achievement-id', 'hits_1000').textContent)
      .toContain('칭호 보상: 산산조각')
  })

  it('keeps tab and panel relationships stable across multiple hub renders', () => {
    const firstParent = fakeDocument.createElement('div')
    const secondParent = fakeDocument.createElement('div')
    const callbacks = {
      onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn(),
    }
    const first = new RecordBook(
      firstParent as unknown as HTMLElement,
      view,
      settings,
      callbacks
    )
    const firstHome = byAttribute(firstParent, 'data-hub-tab', 'home')
    const firstId = firstHome.id
    new RecordBook(secondParent as unknown as HTMLElement, view, settings, callbacks)

    first.render(view, settings)

    const renderedHome = byAttribute(firstParent, 'data-hub-tab', 'home')
    const secondHome = byAttribute(secondParent, 'data-hub-tab', 'home')
    expect(renderedHome.id).toBe(firstId)
    expect(renderedHome.id).not.toBe(secondHome.id)
    expect(renderedHome.getAttribute('aria-controls'))
      .toBe(byAttribute(firstParent, 'data-hub-panel', 'home').id)
  })

  it('retains keyboard focus across tabs and filters without concealing locked conditions', () => {
    const parent = fakeDocument.createElement('div')
    const state = createDefaultProgress('hub-filter')
    state.lifetime.validHits = 40
    new RecordBook(
      parent as unknown as HTMLElement,
      makeRecordBookView(state, BUILT_IN_CATALOG),
      settings,
      {
        onTitleChange: vi.fn(),
        onSkinChange: vi.fn(),
        onSettingChange: vi.fn(),
        onTabChange: vi.fn(),
        onFilterChange: vi.fn(),
      }
    )
    const achievementsTab = buttonByText(parent, '업적')
    achievementsTab.focus()
    achievementsTab.click()
    expect(fakeDocument.activeElement).toBe(achievementsTab)
    expect(achievementsTab.getAttribute('aria-selected')).toBe('true')

    const active = buttonByText(parent, '진행 중')
    active.focus()
    active.click()
    expect(fakeDocument.activeElement).toBe(active)
    expect(active.getAttribute('aria-pressed')).toBe('true')
    const visibleCards = parent.querySelectorAll('[data-achievement-id]')
      .filter((card) => !card.hidden)
    expect(visibleCards.length).toBeGreaterThan(0)
    expect(visibleCards.every((card) => card.textContent.includes('다음:'))).toBe(true)
    expect(parent.querySelectorAll('[data-achievement-id]')).toHaveLength(32)

    const skill = buttonByText(parent, '연속·충전')
    skill.focus()
    skill.click()
    expect(fakeDocument.activeElement).toBe(skill)
    expect(parent.querySelectorAll('[data-achievement-id]').filter((card) => !card.hidden)
      .every((card) => card.getAttribute('data-achievement-category') === 'skill')).toBe(true)
    const count = parent.querySelector('[data-achievement-filter-count]')
    expect(count?.getAttribute('role')).toBe('status')
    expect(count?.textContent).toBe('8개 업적 표시')
  })

  it('shows locked cosmetic requirements and never forwards a locked selection', () => {
    const parent = fakeDocument.createElement('div')
    const onFrameChange = vi.fn()
    const onThemeChange = vi.fn()
    new RecordBook(
      parent as unknown as HTMLElement,
      makeRecordBookView(createDefaultProgress('hub-locks'), BUILT_IN_CATALOG),
      settings,
      {
        onTitleChange: vi.fn(),
        onSkinChange: vi.fn(),
        onSettingChange: vi.fn(),
        onFrameChange,
        onThemeChange,
      }
    )
    buttonByText(parent, '꾸미기').click()
    const lockedFrame = byAttribute(parent, 'data-frame', 'first_crack')
    const lockedTheme = byAttribute(parent, 'data-theme', 'electric_night')

    expect(lockedFrame.disabled).toBe(true)
    expect(lockedFrame.textContent).toContain('레벨 5가 되면 고를 수 있어요')
    expect(lockedTheme.disabled).toBe(true)
    expect(lockedTheme.textContent).toContain('레벨 10이 되면 고를 수 있어요')
    lockedFrame.click()
    lockedTheme.click()
    expect(onFrameChange).not.toHaveBeenCalled()
    expect(onThemeChange).not.toHaveBeenCalled()

    byAttribute(parent, 'data-frame', 'default').click()
    byAttribute(parent, 'data-theme', 'default').click()
    expect(onFrameChange).toHaveBeenCalledWith('default')
    expect(onThemeChange).toHaveBeenCalledWith('default')
  })

  it('keeps an already selected legacy title available to remove', () => {
    const parent = fakeDocument.createElement('div')
    const state = createDefaultProgress('legacy-title')
    state.achievements.first_destroy = {
      unlockedAt: '2026-07-16T00:00:00.000Z',
      seen: true,
    }
    state.profile.selectedTitle = '첫 와장창'
    const onTitleChange = vi.fn()

    new RecordBook(
      parent as unknown as HTMLElement,
      makeRecordBookView(state, BUILT_IN_CATALOG),
      settings,
      { onTitleChange, onSkinChange: vi.fn(), onSettingChange: vi.fn() }
    )

    const selected = byAttribute(parent, 'data-title', '첫 와장창')
    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(selected.textContent).toContain('현재 사용 중인 칭호예요')
    selected.click()
    expect(onTitleChange).toHaveBeenCalledWith(null)
  })

  it('renders the profile button in settings and forwards one open action', () => {
    const parent = fakeDocument.createElement('div')
    const onOpenProfile = vi.fn()
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      view,
      settings,
      {
        onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn(),
        onOpenProfile,
      },
      guestProfile,
    )
    const profile = byAttribute(parent, 'data-recordbook-profile', 'guest')

    expect(byAttribute(parent, 'data-hub-panel', 'settings').contains(profile)).toBe(true)
    expect(profile.tagName).toBe('BUTTON')
    expect(profile.getAttribute('aria-label')).toBe('프로필 열기')
    expect(profile.textContent).toContain('게스트로 즐기는 중')
    profile.click()
    expect(onOpenProfile).toHaveBeenCalledOnce()
    expect(onOpenProfile).toHaveBeenCalledWith(profile)

    recordBook.render(view, settings, { visible: false, kind: 'hidden' })
    expect(parent.querySelector('[data-recordbook-profile]')).toBeNull()
  })

  it('shows player save status and restores profile-card focus after a render', () => {
    const parent = fakeDocument.createElement('div')
    const profile: ProfileCardView = {
      visible: true,
      kind: 'player',
      displayName: '예진',
      userId: '10000000-0000-4000-8000-000000000001',
      sync: 'saving',
      lastSavedAt: null,
    }
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      view,
      settings,
      { onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn() },
      profile,
    )
    const previous = byAttribute(parent, 'data-recordbook-profile', 'player')
    buttonByText(parent, '설정').click()
    previous.focus()

    recordBook.render(view, settings, { ...profile, sync: 'saved' })

    expect(fakeDocument.activeElement).not.toBe(previous)
    expect(fakeDocument.activeElement?.getAttribute('data-recordbook-profile')).toBe('player')
    expect(fakeDocument.activeElement?.textContent).toContain('기록이 저장됐어요')
  })

  it('renders the exact four panels with text-only remote copy', () => {
    const parent = fakeDocument.createElement('div')
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      view,
      settings,
      { onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn() }
    )
    const dialog = parent.querySelector('[role="dialog"]')!

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull()
    expect(parent.querySelectorAll('[data-hub-panel]').map((section) =>
      section.getAttribute('data-hub-panel')
    )).toEqual(['home', 'achievements', 'cosmetics', 'settings'])
    expect(parent.querySelector('[data-recordbook-settings]')).not.toBeNull()
    expect(parent.querySelector('[data-recordbook-settings]')?.textContent)
      .toContain('원하는 조작과 반응을 바로 바꿀 수 있어요')
    expect(parent.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(recordBook.isOpen).toBe(false)
  })

  it('offers all title requirements and provided skins, then forwards unlocked changes', () => {
    const parent = fakeDocument.createElement('div')
    const onTitleChange = vi.fn()
    const onSkinChange = vi.fn()
    const onSettingChange = vi.fn()
    new RecordBook(parent as unknown as HTMLElement, view, settings, {
      onTitleChange,
      onSkinChange,
      onSettingChange,
    })

    byAttribute(parent, 'data-title', '산산조각').click()
    expect(byAttribute(parent, 'data-title', '기술 박사').disabled).toBe(true)
    byAttribute(parent, 'data-skin', 'cinnamoroll:classic').click()
    byAttribute(parent, 'data-setting', 'strongInput:doubleTap').click()
    byAttribute(parent, 'data-setting', 'reducedMotion').click()
    byAttribute(parent, 'data-setting', 'haptics').click()

    expect(onTitleChange).toHaveBeenCalledOnce()
    expect(onTitleChange).toHaveBeenCalledWith('산산조각')
    expect(onSkinChange).toHaveBeenCalledWith('cinnamoroll', 'classic')
    expect(onSettingChange.mock.calls).toEqual([
      [{ key: 'strongInput', value: 'doubleTap' }],
      [{ key: 'reducedMotion', value: true }],
      [{ key: 'haptics', value: false }],
    ])
    expect(byAttribute(parent, 'data-setting', 'strongInput:hold').getAttribute('aria-pressed'))
      .toBe('true')
    const reducedMotion = byAttribute(parent, 'data-setting', 'reducedMotion')
    const haptics = byAttribute(parent, 'data-setting', 'haptics')
    expect(reducedMotion.getAttribute('role')).toBe('switch')
    expect(reducedMotion.getAttribute('aria-label')).toBe('움직임 줄이기')
    expect(reducedMotion.querySelector('.recordbook-switch-state')?.textContent).toBe('꺼짐')
    expect(haptics.getAttribute('aria-checked')).toBe('true')
    expect(haptics.getAttribute('aria-label')).toBe('진동')
    expect(haptics.querySelector('.recordbook-switch-state')?.textContent).toBe('켜짐')
  })

  it('restores focus to the equivalent control after a live profile render', () => {
    const parent = fakeDocument.createElement('div')
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      view,
      settings,
      { onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn() }
    )
    const previous = byAttribute(parent, 'data-skin', 'cinnamoroll:classic')
    buttonByText(parent, '꾸미기').click()
    previous.focus()
    const changedView: RecordBookView = {
      ...view,
      cosmetics: {
        ...view.cosmetics,
        skins: view.cosmetics.skins.map((item) => ({
          ...item,
          choices: item.choices.map((choice) => ({
            ...choice,
            selected: choice.id === 'classic',
          })),
        })),
      },
    }

    recordBook.render(changedView, settings)

    expect(fakeDocument.activeElement).not.toBe(previous)
    expect(fakeDocument.activeElement?.getAttribute('data-skin')).toBe('cinnamoroll:classic')
  })

  it('gates every progression and reward surface with safe focus and callbacks', () => {
    const parent = fakeDocument.createElement('div')
    const state = createDefaultProgress('gated-hub')
    for (const id of [
      'first_hit',
      'hits_100',
      'hits_1000',
      'destroys_25',
      'favorite_finisher_50',
      'moves_30',
    ]) {
      state.achievements[id] = {
        unlockedAt: '2026-07-17T00:00:00.000Z',
        seen: true,
      }
    }
    state.profile.frameId = 'electric_night'
    state.profile.recordBookThemeId = 'electric_night'
    const onTabChange = vi.fn()
    const onTitleChange = vi.fn()
    const onFrameChange = vi.fn()
    const onThemeChange = vi.fn()
    const onSkinChange = vi.fn()
    const onFilterChange = vi.fn()
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      makeRecordBookView(state, BUILT_IN_CATALOG),
      settings,
      {
        onTitleChange,
        onSkinChange,
        onSettingChange: vi.fn(),
        onTabChange,
        onFrameChange,
        onThemeChange,
        onFilterChange,
      },
      guestProfile,
    )
    recordBook.open()
    const achievementsTab = byAttribute(parent, 'data-hub-tab', 'achievements')
    const cosmeticsTab = byAttribute(parent, 'data-hub-tab', 'cosmetics')
    const settingsTab = byAttribute(parent, 'data-hub-tab', 'settings')
    cosmeticsTab.focus()
    cosmeticsTab.click()
    expect(cosmeticsTab.getAttribute('aria-selected')).toBe('true')
    byAttribute(parent, 'data-title', '기술 박사').focus()
    onTabChange.mockClear()

    recordBook.setGamificationVisible(false)

    const gamificationSections = parent.querySelectorAll('[data-gamification]')
    expect(gamificationSections.every((section) => section.hidden)).toBe(true)
    const cosmeticsPanel = byAttribute(parent, 'data-hub-panel', 'cosmetics')
    expect(cosmeticsPanel.querySelector('.recordbook-panel-intro')?.hidden).toBe(true)
    expect(achievementsTab.disabled).toBe(true)
    expect(cosmeticsTab.disabled).toBe(false)
    expect(settingsTab.disabled).toBe(false)
    expect(cosmeticsTab.getAttribute('aria-selected')).toBe('true')
    expect(fakeDocument.activeElement).toBe(cosmeticsTab)
    expect(parent.querySelector('.recordbook-heading-meta')?.textContent).toBe('게스트')
    expect(byAttribute(parent, 'data-recordbook-profile', 'guest').textContent)
      .toContain('게스트로 즐기는 중')
    expect(parent.querySelector('.recordbook-sheet')?.getAttribute('data-recordbook-theme'))
      .toBe('default')

    achievementsTab.click()
    byAttribute(parent, 'data-achievement-status-filter', 'active').click()
    byAttribute(parent, 'data-title', '기술 박사').click()
    byAttribute(parent, 'data-frame', 'electric_night').click()
    byAttribute(parent, 'data-theme', 'electric_night').click()
    const classicSkin = byAttribute(parent, 'data-skin', 'cinnamoroll:classic')
    let skinAncestor = classicSkin.parentElement
    while (skinAncestor && skinAncestor.getAttribute('data-gamification') === null) {
      skinAncestor = skinAncestor.parentElement
    }
    expect(skinAncestor).toBeNull()
    classicSkin.click()
    expect(onTabChange).not.toHaveBeenCalled()
    expect(onTitleChange).not.toHaveBeenCalled()
    expect(onFrameChange).not.toHaveBeenCalled()
    expect(onThemeChange).not.toHaveBeenCalled()
    expect(onSkinChange).toHaveBeenCalledWith('cinnamoroll', 'classic')
    expect(onFilterChange).not.toHaveBeenCalled()

    recordBook.setGamificationVisible(true)

    expect(achievementsTab.disabled).toBe(false)
    expect(cosmeticsTab.disabled).toBe(false)
    expect(cosmeticsTab.getAttribute('aria-selected')).toBe('true')
    expect(fakeDocument.activeElement).toBe(cosmeticsTab)
    expect(parent.querySelector('.recordbook-sheet')?.getAttribute('data-recordbook-theme'))
      .toBe('electric_night')
    expect(byAttribute(parent, 'data-frame', 'electric_night').getAttribute('aria-pressed'))
      .toBe('true')
  })

  it('resets the shared scroll position on every tab switch and open', () => {
    const parent = fakeDocument.createElement('div')
    const recordBook = new RecordBook(
      parent as unknown as HTMLElement,
      view,
      settings,
      { onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn() }
    )
    const scroll = parent.querySelector('.recordbook-scroll')!

    scroll.scrollTop = 720
    buttonByText(parent, '업적').click()
    expect(scroll.scrollTop).toBe(0)

    scroll.scrollTop = 640
    buttonByText(parent, '꾸미기').click()
    expect(scroll.scrollTop).toBe(0)

    scroll.scrollTop = 500
    recordBook.open()
    expect(scroll.scrollTop).toBe(0)
    recordBook.close()
    scroll.scrollTop = 420
    recordBook.open()
    expect(scroll.scrollTop).toBe(0)
  })

  it('traps focus and closes by Escape or backdrop while returning focus', () => {
    const parent = fakeDocument.createElement('div')
    const opener = fakeDocument.createElement('button')
    parent.appendChild(opener)
    const onClose = vi.fn()
    const recordBook = new RecordBook(parent as unknown as HTMLElement, view, settings, {
      onTitleChange: vi.fn(),
      onSkinChange: vi.fn(),
      onSettingChange: vi.fn(),
      onClose,
    })
    opener.focus()

    recordBook.open()
    const backdrop = parent.querySelector('.recordbook-backdrop')!
    const sheet = parent.querySelector('.recordbook-sheet')!
    const dialogButtons = sheet.querySelectorAll('button')
      .filter((button) => visibleButton(button, sheet))
    expect(recordBook.isOpen).toBe(true)
    expect(backdrop.hidden).toBe(false)
    expect(backdrop.getAttribute('data-recordbook-backdrop')).toBe('hit-area')
    expect(backdrop.children).toEqual([sheet])
    expect(fakeDocument.activeElement).toBe(dialogButtons[0])

    dialogButtons[dialogButtons.length - 1].focus()
    const tab = fakeDocument.dispatch('keydown', { key: 'Tab' })
    expect(tab.defaultPrevented).toBe(true)
    expect(fakeDocument.activeElement).toBe(dialogButtons[0])
    const shiftTab = fakeDocument.dispatch('keydown', { key: 'Tab', shiftKey: true })
    expect(shiftTab.defaultPrevented).toBe(true)
    expect(fakeDocument.activeElement).toBe(dialogButtons[dialogButtons.length - 1])

    fakeDocument.dispatch('keydown', { key: 'Escape' })
    expect(recordBook.isOpen).toBe(false)
    expect(fakeDocument.activeElement).toBe(opener)
    expect(onClose).toHaveBeenCalledOnce()

    recordBook.open()
    backdrop.dispatch('click')
    expect(recordBook.isOpen).toBe(false)
  })

  it('blocks pointer and touch propagation inside the sheet', () => {
    const parent = fakeDocument.createElement('div')
    new RecordBook(parent as unknown as HTMLElement, view, settings, {
      onTitleChange: vi.fn(), onSkinChange: vi.fn(), onSettingChange: vi.fn(),
    })
    const sheet = parent.querySelector('.recordbook-sheet')!

    expect(sheet.dispatch('pointerdown').propagationStopped).toBe(true)
    expect(sheet.dispatch('touchstart').propagationStopped).toBe(true)
    expect(sheet.dispatch('touchmove').propagationStopped).toBe(true)
  })

  it('uses the approved arcade tokens and mobile-safe full-screen hub styles', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const styleCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
    for (const token of [
      '--night-ink: #0d1326',
      '--arena-navy: #1a2342',
      '--paper-warm: #fff8e7',
      '--smash-yellow: #ffd23f',
      '--impact-coral: #ff6b6b',
      '--electric-sky: #61d4ff',
      '--ink-text: #202133',
      '--night-text: #fff8e7',
    ]) {
      expect(styleCss).toContain(token)
    }
    expect(styleCss).toMatch(
      /\.recordbook-backdrop\s*\{[^}]*align-items:\s*center/s
    )
    expect(styleCss).toMatch(
      /\.recordbook-sheet\s*\{[^}]*width:\s*calc\([^;]*safe-area-inset-left[^;]*safe-area-inset-right[^;]*\)[^}]*height:\s*calc\([^;]*safe-area-inset-top[^;]*safe-area-inset-bottom[^;]*\)[^}]*max-width:\s*920px[^}]*border-radius:\s*(?!0)[^;]+;/s
    )
    expect(styleCss).toMatch(/\.recordbook-scroll\s*\{[^}]*overflow-x:\s*hidden[^}]*overflow-y:\s*auto/s)
    expect(styleCss).toMatch(/\.recordbook-(?:tab|filter|close)[^{]*\{[^}]*min-height:\s*(?:44|48)px/s)
    expect(styleCss).toMatch(/\.recordbook-[^{]*:focus-visible/s)
    expect(styleCss).toMatch(/@media\s*\(max-width:\s*340px\)/)
    expect(styleCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.recordbook-sheet/)
    expect(styleCss).toMatch(
      /html\.reduce-motion \.recordbook-sheet[^{]*\{[^}]*transition:\s*none\s*!important/s
    )
    expect(styleCss).toMatch(
      /html\.reduce-motion \.recordbook-tab\[aria-selected='true'\][^{]*\{[^}]*transform:\s*none\s*!important/s
    )
    const recordBookCss = styleCss.split('/* ===== record-book')[1]
      ?.split("/* ===== what's-new")[0] ?? ''
    expect(recordBookCss).not.toContain('backdrop-filter')
  })
})

describe('Hud record button and live notification renderer', () => {
  it('keeps three named top controls and routes the level button compatibly', () => {
    const parent = fakeDocument.createElement('div')
    const onOpenRecordBook = vi.fn()
    const onWhatsNew = vi.fn()
    const scheduler = new FakeScheduler()
    new Hud(parent as unknown as HTMLElement, {
      onToggleSound: vi.fn(),
      onReset: vi.fn(),
      onNext: vi.fn(),
      onWhatsNew,
      onOpenRecordBook,
      onShare: vi.fn(),
    }, { scheduler })

    const buttons = parent.querySelector('.top-buttons')!.querySelectorAll('button')
    expect(parent.querySelector('.combo')!.querySelector('.label')!.textContent).toBe('연속')
    expect(buttons).toHaveLength(3)
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '기록책 열기, 현재 레벨 1', '소리 끄기', '게임 메뉴 열기',
    ])
    expect(buttons[0].textContent).toContain('LV 1')

    buttons[0].click()
    expect(onOpenRecordBook).toHaveBeenCalledOnce()
    expect(onWhatsNew).not.toHaveBeenCalled()
  })

  it('reuses one polite live-region node for record, grade, popup, and toast calls', () => {
    const parent = fakeDocument.createElement('div')
    const scheduler = new FakeScheduler()
    const hud = new Hud(parent as unknown as HTMLElement, {
      onToggleSound: vi.fn(), onReset: vi.fn(), onNext: vi.fn(),
      onWhatsNew: vi.fn(), onShare: vi.fn(),
    }, { scheduler })
    const childCount = parent.children.length

    hud.popup('세상 와장창!')
    hud.gradeFlash('GREAT!')
    hud.showNewRecord(12)
    hud.toast('황금 타겟 등장!')

    const liveRegions = parent.querySelectorAll('[aria-live="polite"]')
    expect(liveRegions).toHaveLength(1)
    expect(liveRegions[0].textContent).toBe('')
    expect(parent.children).toHaveLength(childCount)
    scheduler.advance(0)
    expect(liveRegions[0].textContent).toContain('신기록')
    scheduler.advance(1_800)
    expect(liveRegions[0].textContent).toBe('세상 와장창!')
    expect(parent.querySelectorAll('.record-banner')).toHaveLength(0)
    expect(parent.querySelectorAll('.grade-flash')).toHaveLength(0)
    expect(parent.querySelectorAll('.celebrate-popup')).toHaveLength(0)
    expect(parent.querySelectorAll('.toast')).toHaveLength(0)
  })

  it('keeps the HUD notice transparent to game taps at UI-child specificity', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const styleCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
    expect(styleCss).toMatch(
      /#ui\s*>\s*\.hud-notice\s*\{[^}]*pointer-events:\s*none\s*;/s
    )
  })

  it('keeps the game tap hint beneath the UI modal stacking context', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const styleCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
    const uiLayer = /#ui\s*\{[^}]*z-index:\s*(\d+)\s*;/s.exec(styleCss)
    const hintLayer = /#tap-hint\s*\{[^}]*z-index:\s*(\d+)\s*;/s.exec(styleCss)

    expect(uiLayer).not.toBeNull()
    expect(hintLayer).not.toBeNull()
    expect(Number(hintLayer?.[1])).toBeLessThan(Number(uiLayer?.[1]))
  })
})
