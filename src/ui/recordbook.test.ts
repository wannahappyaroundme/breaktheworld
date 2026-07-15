import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordBookView } from '../progress/view-model'
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
  parentElement: FakeElement | null = null
  hidden = false
  disabled = false
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

const view: RecordBookView = {
  daily: {
    heading: '오늘의 도전',
    copy: '<img src=x onerror=alert(1)>',
    progress: 1,
    target: 3,
    progressText: '1 / 3',
    complete: false,
  },
  achievements: {
    heading: '부순 기록',
    items: [
      {
        id: 'first_destroy',
        name: '첫 와장창',
        next: '타겟 1개 부수기',
        progress: 1,
        target: 1,
        complete: true,
        seen: false,
        selectableTitle: '첫 와장창',
      },
      {
        id: 'charge_master',
        name: '꾹 와장창 장인',
        next: '꾹 와장창 10번 하기',
        progress: 2,
        target: 10,
        complete: false,
        seen: false,
        selectableTitle: null,
      },
    ],
  },
  skins: {
    heading: '캐릭터 모습',
    items: [{
      id: 'cinnamoroll',
      name: '시나모롤',
      choices: [
        { id: 'default', label: '기본', selected: true },
        { id: 'classic', label: '클래식', selected: false },
      ],
    }],
  },
  stats: {
    heading: '내 기록',
    items: [{ label: '최고 연속', value: '24' }],
  },
  selectedTitle: null,
}

const settings: RecordBookSettingsState = {
  strongInput: 'hold',
  reducedMotion: false,
  haptics: true,
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

describe('RecordBook', () => {
  it('renders the exact four data sections before settings with text-only remote copy', () => {
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
    expect(parent.querySelectorAll('[data-recordbook-section]').map((section) =>
      section.getAttribute('data-recordbook-section')
    )).toEqual(['오늘의 도전', '부순 기록', '캐릭터 모습', '내 기록'])
    expect(parent.querySelector('[data-recordbook-settings]')).not.toBeNull()
    expect(parent.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(recordBook.isOpen).toBe(false)
  })

  it('offers only unlocked titles and provided skins, then forwards one callback per change', () => {
    const parent = fakeDocument.createElement('div')
    const onTitleChange = vi.fn()
    const onSkinChange = vi.fn()
    const onSettingChange = vi.fn()
    new RecordBook(parent as unknown as HTMLElement, view, settings, {
      onTitleChange,
      onSkinChange,
      onSettingChange,
    })

    byAttribute(parent, 'data-title', '첫 와장창').click()
    expect(parent.querySelector('[data-title="꾹 와장창 장인"]')).toBeNull()
    byAttribute(parent, 'data-skin', 'cinnamoroll:classic').click()
    byAttribute(parent, 'data-setting', 'strongInput:doubleTap').click()
    byAttribute(parent, 'data-setting', 'reducedMotion').click()
    byAttribute(parent, 'data-setting', 'haptics').click()

    expect(onTitleChange).toHaveBeenCalledOnce()
    expect(onTitleChange).toHaveBeenCalledWith('첫 와장창')
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
    const buttons = parent.querySelectorAll('button')
    const dialogButtons = buttons.filter((button) => button !== opener)
    expect(recordBook.isOpen).toBe(true)
    expect(backdrop.hidden).toBe(false)
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
})

describe('Hud record button and live notification renderer', () => {
  it('keeps five named top buttons and routes the record button compatibly', () => {
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
    expect(buttons).toHaveLength(5)
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '기록 카드 공유', '기록책 열기', '소리 끄기', '다음 타겟', '처음부터',
    ])
    expect(buttons.map((button) => button.textContent)).toEqual(['📸', '📖', '🔊', '⏭️', '🔄'])

    buttons[1].click()
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
})
