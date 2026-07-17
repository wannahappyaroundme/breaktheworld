import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hud } from './hud'
import type { NotificationScheduler } from './notification-queue'

type Listener = (event: FakeEvent) => void

class FakeEvent {
  readonly key?: string
  readonly shiftKey: boolean
  readonly target: FakeElement | FakeDocument
  defaultPrevented = false
  propagationStopped = false

  constructor(type: string, target: FakeElement | FakeDocument, key?: string, shiftKey = false) {
    this.type = type
    this.target = target
    this.key = key
    this.shiftKey = shiftKey
  }

  readonly type: string

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
    names.forEach((name) => this.element.classes.add(name))
  }

  remove(...names: string[]): void {
    names.forEach((name) => this.element.classes.delete(name))
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

class FakeStyle {
  private readonly values = new Map<string, string>()

  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? ''
  }
}

function matches(element: FakeElement, selector: string): boolean {
  if (selector === 'button') return element.tagName === 'BUTTON'
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1))
  const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector)
  if (attribute) {
    const actual = element.getAttribute(attribute[1])
    return attribute[2] === undefined ? actual !== null : actual === attribute[2]
  }
  return element.tagName === selector.toUpperCase()
}

class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly children: FakeElement[] = []
  readonly classes = new Set<string>()
  readonly classList = new FakeClassList(this)
  readonly listeners = new Map<string, Listener[]>()
  readonly style = new FakeStyle()
  parentElement: FakeElement | null = null
  hidden = false
  id = ''
  type = ''
  private ownText = ''

  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  get className(): string {
    return [...this.classes].join(' ')
  }

  set className(value: string) {
    this.classes.clear()
    value.split(/\s+/).filter(Boolean).forEach((name) => this.classes.add(name))
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value: string | null) {
    this.ownText = value ?? ''
    this.children.length = 0
  }

  append(...nodes: FakeElement[]): void {
    nodes.forEach((node) => this.appendChild(node))
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
    const index = this.parentElement.children.indexOf(this)
    if (index >= 0) this.parentElement.children.splice(index, 1)
    this.parentElement = null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
    if (name === 'id') this.id = value
  }

  getAttribute(name: string): string | null {
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

  dispatch(type: string, key?: string, shiftKey = false): FakeEvent {
    const event = new FakeEvent(type, this, key, shiftKey)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }

  click(): void {
    this.dispatch('click')
  }

  focus(): void {
    this.ownerDocument.activeElement = this
  }

  contains(node: FakeElement | FakeDocument): boolean {
    if (!(node instanceof FakeElement)) return false
    return node === this || this.children.some((child) => child.contains(node))
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    const result: FakeElement[] = []
    const visit = (node: FakeElement) => {
      for (const child of node.children) {
        if (matches(child, selector)) result.push(child)
        visit(child)
      }
    }
    visit(this)
    return result
  }
}

class FakeDocument {
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

  dispatch(type: string, target: FakeElement | FakeDocument = this, key?: string): FakeEvent {
    const event = new FakeEvent(type, target, key)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
}

class FakeScheduler implements NotificationScheduler {
  schedule(): () => void {
    return () => {}
  }
}

let documentFake: FakeDocument

beforeEach(() => {
  documentFake = new FakeDocument()
  vi.stubGlobal('document', documentFake as unknown as Document)
  vi.stubGlobal('window', {
    setTimeout: vi.fn(() => 1),
    clearTimeout: vi.fn(),
    matchMedia: vi.fn(() => ({ matches: false })),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function setupHud() {
  const callbacks = {
    onToggleSound: vi.fn(),
    onReset: vi.fn(),
    onNext: vi.fn(),
    onWhatsNew: vi.fn(),
    onOpenRecordBook: vi.fn(),
    onShare: vi.fn(),
  }
  const parent = documentFake.createElement('div')
  const hud = new Hud(parent as unknown as HTMLElement, callbacks, {
    scheduler: new FakeScheduler(),
  })
  return { callbacks, hud, parent }
}

function buttonByName(root: FakeElement, name: string): FakeElement {
  const button = root.querySelectorAll('button')
    .find((candidate) => candidate.getAttribute('aria-label') === name)
  if (!button) throw new Error(`Missing button: ${name}`)
  return button
}

describe('Hud compact controls', () => {
  it('gives simultaneous HUD menus stable unique ids', () => {
    const first = setupHud().parent
    const second = setupHud().parent
    const firstMenu = first.querySelector('.hud-more-menu')!
    const secondMenu = second.querySelector('.hud-more-menu')!

    expect(firstMenu.id).toMatch(/^hud-more-menu-\d+$/)
    expect(secondMenu.id).toMatch(/^hud-more-menu-\d+$/)
    expect(firstMenu.id).not.toBe(secondMenu.id)
    expect(buttonByName(first, '게임 메뉴 열기').getAttribute('aria-controls')).toBe(firstMenu.id)
    expect(buttonByName(second, '게임 메뉴 열기').getAttribute('aria-controls')).toBe(secondMenu.id)
  })

  it('keeps only level, sound, and more as top-level controls and preserves menu callbacks', () => {
    const { callbacks, parent } = setupHud()
    const topButtons = parent.querySelector('.top-buttons')!.children

    expect(topButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      '기록책 열기, 현재 레벨 1', '소리 끄기', '게임 메뉴 열기',
    ])

    const more = buttonByName(parent, '게임 메뉴 열기')
    const menu = parent.querySelector('.hud-more-menu')!
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe(menu.id)
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(menu.hidden).toBe(true)

    more.click()
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(menu.hidden).toBe(false)
    expect(menu.children.map((button) => button.getAttribute('aria-label'))).toEqual([
      '기록 카드 공유', '다음 타겟', '처음부터',
    ])
    expect(documentFake.activeElement).toBe(menu.children[0])
    menu.dispatch('keydown', 'ArrowDown')
    expect(documentFake.activeElement).toBe(menu.children[1])

    buttonByName(menu, '기록 카드 공유').click()
    expect(callbacks.onShare).toHaveBeenCalledOnce()
    expect(menu.hidden).toBe(true)
    expect(documentFake.activeElement).toBe(more)
  })

  it('dismisses the menu with Escape or an outside press and returns focus', () => {
    const { parent } = setupHud()
    const more = buttonByName(parent, '게임 메뉴 열기')
    const menu = parent.querySelector('.hud-more-menu')!

    more.click()
    documentFake.dispatch('keydown', documentFake, 'Escape')
    expect(menu.hidden).toBe(true)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(documentFake.activeElement).toBe(more)

    more.click()
    documentFake.dispatch('pointerdown', buttonByName(parent, '소리 끄기'))
    expect(menu.hidden).toBe(true)
    expect(documentFake.activeElement).toBe(more)
  })

  it.each([
    ['Tab', false],
    ['Shift+Tab', true],
  ])('closes the role menu on %s and returns focus to more', (_label, shiftKey) => {
    const { parent } = setupHud()
    const more = buttonByName(parent, '게임 메뉴 열기')
    const menu = parent.querySelector('.hud-more-menu')!
    more.click()

    const event = menu.dispatch('keydown', 'Tab', shiftKey)

    expect(event.defaultPrevented).toBe(true)
    expect(menu.hidden).toBe(true)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(documentFake.activeElement).toBe(more)
  })

  it('destroys once without later callbacks, focus changes, timers, or document listeners', () => {
    const { callbacks, hud, parent } = setupHud()
    const more = buttonByName(parent, '게임 메뉴 열기')
    const sound = buttonByName(parent, '소리 끄기')
    const menu = parent.querySelector('.hud-more-menu')!
    const share = buttonByName(menu, '기록 카드 공유')
    const feedback = parent.querySelector('.hud-progress-feedback')!
    const outside = documentFake.createElement('button')
    more.click()
    hud.showProgressGain({ xp: 50, levelUp: 2 })
    outside.focus()

    hud.destroy()
    hud.destroy()
    documentFake.dispatch('keydown', documentFake, 'Escape')
    documentFake.dispatch('pointerdown', outside)
    more.click()
    sound.click()
    share.click()

    expect(callbacks.onToggleSound).not.toHaveBeenCalled()
    expect(callbacks.onShare).not.toHaveBeenCalled()
    expect(menu.hidden).toBe(true)
    expect(documentFake.activeElement).toBe(outside)
    expect(feedback.hidden).toBe(true)
    expect(feedback.children).toHaveLength(0)
    expect(parent.children).toHaveLength(0)
    expect(documentFake.listeners.get('keydown')).toEqual([])
    expect(documentFake.listeners.get('pointerdown')).toEqual([])
    expect(window.clearTimeout).toHaveBeenCalled()
  })
})

describe('Hud progress feedback', () => {
  it('renders bounded progress without creating a second live region', () => {
    const { hud, parent } = setupHud()
    hud.setProgress({ level: 5, xp: 300, nextLevelXp: 450, ratio: 2, unseen: 2 })

    const level = parent.querySelector('.hud-level-button')!
    expect(level.textContent).toContain('LV 5')
    expect(level.getAttribute('aria-label')).toBe('기록책 열기, 현재 레벨 5, 새 업적 2개')
    expect(level.style.getPropertyValue('--hud-level-ratio')).toBe('1')
    expect(parent.querySelectorAll('[aria-live]')).toHaveLength(1)

    hud.showProgressGain({ xp: 9_999, levelUp: 99 })
    const highFeedback = parent.querySelector('.hud-progress-feedback')!
    expect(highFeedback.textContent).toContain('경험치 +4700')
    expect(highFeedback.textContent).toContain('레벨 20')
    hud.showProgressGain({ xp: 50, levelUp: null })
    const feedback = parent.querySelector('.hud-progress-feedback')!
    expect(feedback.getAttribute('aria-hidden')).toBe('true')
    expect(feedback.querySelectorAll('.hud-xp-fragment').length).toBeLessThanOrEqual(3)
    expect(parent.querySelectorAll('[aria-live]')).toHaveLength(1)
  })

  it.each([
    {
      name: 'high',
      input: { level: 99, xp: 99_999, nextLevelXp: 99_999, ratio: 99, unseen: 99 },
      level: 'LV 20', detail: '4700 / 4700', ratio: '1', aria: '기록책 열기, 현재 레벨 20, 새 업적 32개', badge: '32',
    },
    {
      name: 'negative',
      input: { level: -9, xp: -1, nextLevelXp: -1, ratio: -5, unseen: -2 },
      level: 'LV 1', detail: '0 경험치', ratio: '0', aria: '기록책 열기, 현재 레벨 1', badge: '',
    },
    {
      name: 'nonfinite',
      input: { level: Number.NaN, xp: Number.POSITIVE_INFINITY, nextLevelXp: Number.NaN, ratio: Number.NaN, unseen: Number.NEGATIVE_INFINITY },
      level: 'LV 1', detail: '0 경험치', ratio: '0', aria: '기록책 열기, 현재 레벨 1', badge: '',
    },
  ])('clamps $name progress to product bounds', ({ input, level, detail, ratio, aria, badge }) => {
    const { hud, parent } = setupHud()
    hud.setProgress(input)
    const levelButton = parent.querySelector('.hud-level-button')!
    const unseenBadge = parent.querySelector('.hud-unseen-badge')!

    expect(parent.querySelector('.hud-level-value')!.textContent).toBe(level)
    expect(parent.querySelector('.hud-level-detail')!.textContent).toBe(detail)
    expect(levelButton.style.getPropertyValue('--hud-level-ratio')).toBe(ratio)
    expect(levelButton.getAttribute('aria-label')).toBe(aria)
    expect(unseenBadge.textContent).toBe(badge)
    expect(unseenBadge.hidden).toBe(badge === '')
  })

  it('defines mobile-safe controls and static feedback for both reduced-motion modes', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8')

    expect(css).toMatch(/\.hud-level-button\s*\{[^}]*min-height:\s*44px/s)
    expect(css).toMatch(/\.hud-more-menu\[hidden\]\s*\{[^}]*display:\s*none/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*340px\)[\s\S]*\.hud-top/)
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.hud-progress-feedback[^{]*\{[^}]*transform:\s*none\s*!important/s
    )
    expect(css).toMatch(
      /html\.reduce-motion \.hud-progress-feedback[^{]*\{[^}]*transform:\s*none\s*!important/s
    )
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.hud-menu-item:active[^{]*\{[^}]*transform:\s*none\s*!important/s
    )
    expect(css).toMatch(
      /html\.reduce-motion \.hud-menu-item:active[^{]*\{[^}]*transform:\s*none\s*!important/s
    )
  })
})
