import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createPlayerPrivacyNotice } from './privacy'
import type { PlayerAccountSnapshot, PlayerNameCheck } from './controller'
import type { PlayerApiResult, PlayerProfile } from './types'
import { PlayerProfileView } from './view'

type Listener = (event: FakeEvent) => void

class FakeEvent {
  defaultPrevented = false
  propagationStopped = false
  key = ''
  shiftKey = false
  isComposing = false
  constructor(readonly type: string, readonly target: FakeElement, init: Partial<FakeEvent> = {}) {
    Object.assign(this, init)
  }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
}

class FakeClassList {
  constructor(private readonly element: FakeElement) {}
  add(...names: string[]) { names.forEach((name) => this.element.classes.add(name)) }
  remove(...names: string[]) { names.forEach((name) => this.element.classes.delete(name)) }
  contains(name: string) { return this.element.classes.has(name) }
}

function matches(element: FakeElement, selector: string): boolean {
  const value = selector.trim()
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
  inert = false
  value = ''
  type = ''
  checked = false
  name = ''
  inputMode = ''
  autocomplete = ''
  id = ''
  private ownText = ''
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get isConnected(): boolean { return this === this.ownerDocument.documentElement || !!this.parentElement?.isConnected }
  get className(): string { return [...this.classes].join(' ') }
  set className(value: string) {
    this.classes.clear()
    value.split(/\s+/).filter(Boolean).forEach((name) => this.classes.add(name))
  }
  get textContent(): string { return this.ownText + this.children.map((child) => child.textContent).join('') }
  set textContent(value: string | null) { this.ownText = value ?? ''; this.children.length = 0 }
  append(...nodes: FakeElement[]) { nodes.forEach((node) => this.appendChild(node)) }
  appendChild(node: FakeElement) { node.parentElement = this; this.children.push(node); return node }
  replaceChildren(...nodes: FakeElement[]) {
    this.children.forEach((child) => { child.parentElement = null })
    this.children.length = 0
    this.ownText = ''
    this.append(...nodes)
  }
  remove() {
    if (!this.parentElement) return
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1)
    this.parentElement = null
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
    if (name === 'id') this.id = value
  }
  getAttribute(name: string): string | null {
    if (name === 'id' && this.id) return this.id
    return this.attributes.get(name) ?? null
  }
  removeAttribute(name: string) { this.attributes.delete(name) }
  addEventListener(type: string, listener: EventListener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener as unknown as Listener)
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: EventListener) {
    const removed = listener as unknown as Listener
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== removed))
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}) {
    const event = new FakeEvent(type, this, init)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
  click() { if (!this.disabled) this.dispatch('click') }
  focus() { this.ownerDocument.activeElement = this }
  contains(node: FakeElement | null): boolean {
    return node === this || this.children.some((child) => child.contains(node))
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null }
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
  readonly documentElement = new FakeElement('HTML', this)
  readonly body = new FakeElement('BODY', this)
  readonly listeners = new Map<string, Listener[]>()
  activeElement: FakeElement | null = null
  constructor() { this.documentElement.appendChild(this.body) }
  createElement(tag: string) { return new FakeElement(tag.toUpperCase(), this) }
  querySelector(selector: string) { return this.documentElement.querySelector(selector) }
  addEventListener(type: string, listener: EventListener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener as unknown as Listener)
    this.listeners.set(type, list)
  }
  removeEventListener(type: string, listener: EventListener) {
    const removed = listener as unknown as Listener
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== removed))
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}) {
    const event = new FakeEvent(type, this.documentElement, init)
    for (const listener of this.listeners.get(type) ?? []) listener(event)
    return event
  }
}

const PROFILE: PlayerProfile = {
  userId: '10000000-0000-4000-8000-000000000001',
  displayName: '예진',
  forcePinChange: false,
  credentialVersion: 1,
}

const guest = (signupEnabled = true): PlayerAccountSnapshot => ({
  kind: 'guest', signupEnabled,
  card: { visible: true, kind: 'guest', title: '게스트로 즐기는 중', detail: '로그인해 보세요' },
})

function ok<T>(data: T): PlayerApiResult<T> { return { ok: true, data } }

function setup(snapshot: PlayerAccountSnapshot = guest()) {
  const doc = new FakeDocument()
  const app = doc.createElement('div')
  const canvas = doc.createElement('canvas')
  const ui = doc.createElement('div')
  const recordBook = doc.createElement('div')
  recordBook.className = 'recordbook-backdrop show'
  ui.appendChild(recordBook)
  app.append(canvas, ui)
  doc.body.appendChild(app)
  const history = { pushState: vi.fn(), back: vi.fn() }
  const windowListeners = new Map<string, Listener[]>()
  const fakeWindow = {
    history,
    location: { href: 'https://example.test/game' },
    addEventListener(type: string, listener: EventListener) {
      const list = windowListeners.get(type) ?? []
      list.push(listener as unknown as Listener)
      windowListeners.set(type, list)
    },
    removeEventListener(type: string, listener: EventListener) {
      const removed = listener as unknown as Listener
      windowListeners.set(type, (windowListeners.get(type) ?? []).filter((item) => item !== removed))
    },
    dispatchPop() {
      for (const listener of windowListeners.get('popstate') ?? []) {
        listener(new FakeEvent('popstate', doc.documentElement))
      }
    },
  }
  vi.stubGlobal('document', doc as unknown as Document)
  vi.stubGlobal('window', fakeWindow)
  vi.stubGlobal('history', history)
  vi.stubGlobal('location', fakeWindow.location)

  let nameCheck: PlayerNameCheck = { raw: '', normalizedKey: null, status: 'idle' }
  const controller = {
    snapshot,
    get nameCheck() { return nameCheck },
    editProfileName: vi.fn((raw: string) => {
      nameCheck = { raw, normalizedKey: raw ? raw.toLowerCase() : null, status: 'idle' }
    }),
    checkName: vi.fn(async () => {
      nameCheck = { ...nameCheck, status: 'available' }
      return ok(true)
    }),
    create: vi.fn(async () => ok(PROFILE)),
    login: vi.fn(async () => ok(PROFILE)),
    changePin: vi.fn(async () => ok(PROFILE)),
    logout: vi.fn(async () => ok(null)),
  }
  const privacyNotice = createPlayerPrivacyNotice({
    deletionContact: '프로필 삭제는 운영자에게 알려 주세요.',
    processingNotice: '기록은 한국 리전에 저장해요.',
  })
  const view = new PlayerProfileView(ui as unknown as HTMLElement, controller as never, {
    privacyNotice,
  })
  view.render(snapshot)
  return { doc, ui, recordBook, controller, view, history, fakeWindow }
}

function action(root: FakeElement, name: string): FakeElement {
  const found = root.querySelector(`[data-player-action="${name}"]`)
  if (!found) throw new Error(`missing action ${name}`)
  return found
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

beforeEach(() => { vi.useRealTimers() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('PlayerProfileView', () => {
  it('opens one accessible guest dialog with the approved choice copy', () => {
    const { doc, ui, recordBook, view, history } = setup()
    const trigger = doc.createElement('button')
    ui.appendChild(trigger)
    trigger.focus()

    view.open(trigger as unknown as HTMLElement)

    const dialog = ui.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.textContent).toContain('새 프로필에서 첫 기록부터 새로 쌓아요. 지금 게스트 기록은 이 기기에 그대로 남아요.')
    expect(dialog.textContent).not.toContain('Supabase')
    expect(dialog.textContent).not.toContain('이메일')
    expect(dialog.textContent).not.toContain('준비 중')
    expect(recordBook.inert).toBe(true)
    expect(doc.documentElement.classList.contains('profile-open')).toBe(true)
    expect(history.pushState).toHaveBeenCalledOnce()
  })

  it('keeps login available while profile creation is closed', () => {
    const { ui, view } = setup(guest(false))
    view.open(null)

    expect(action(ui, 'create-start').disabled).toBe(true)
    expect(action(ui, 'login-start').disabled).toBe(false)
    expect(ui.textContent).toContain('게스트 플레이는 지금 바로 이어갈 수 있어요')
  })

  it('requires a current duplicate check before showing the creation fields', async () => {
    const { ui, controller, view } = setup()
    view.open(null)
    action(ui, 'create-start').click()
    const id = ui.querySelector('[data-player-field="profile-name"]')!
    id.value = '예진'
    id.dispatch('compositionstart')
    id.dispatch('input', { isComposing: true })
    expect(controller.editProfileName).not.toHaveBeenCalled()
    id.dispatch('compositionend')
    expect(controller.editProfileName).toHaveBeenCalledWith('예진')

    action(ui, 'check-name').click()
    await flushAsync()

    expect(ui.textContent).toContain('사용할 수 있는 ID예요')
    const pin = ui.querySelector('[data-player-field="pin"]')!
    expect(pin.type).toBe('password')
    expect(pin.inputMode).toBe('numeric')
    expect(ui.textContent).toContain('프로필과 기록 저장 안내')
    expect(action(ui, 'create-submit').disabled).toBe(true)
  })

  it('uses the one generic login error and allows PIN visibility without auto-submit', async () => {
    const { ui, controller, view } = setup()
    controller.login.mockResolvedValueOnce({
      ok: false,
      error: { code: 'login_failed', message: 'ID 또는 PIN을 다시 확인해 주세요.' },
    })
    view.open(null)
    action(ui, 'login-start').click()
    const name = ui.querySelector('[data-player-field="profile-name"]')!
    const pin = ui.querySelector('[data-player-field="pin"]')!
    name.value = '예진'
    pin.value = '000000'
    name.dispatch('input')
    pin.dispatch('input')
    action(ui, 'show-pin').click()
    expect(pin.type).toBe('text')
    expect(controller.login).not.toHaveBeenCalled()
    action(ui, 'login-submit').click()
    await flushAsync()
    expect(ui.textContent).toContain('ID 또는 PIN을 다시 확인해 주세요')
  })

  it('keeps forced PIN change visible through Escape and browser back', () => {
    const forced = { ...PROFILE, forcePinChange: true, credentialVersion: 2 }
    const snapshot: PlayerAccountSnapshot = {
      kind: 'player', profile: forced, forcePinChange: true,
      card: { visible: true, kind: 'player', displayName: '예진', userId: forced.userId, sync: 'saved', lastSavedAt: null },
    }
    const { doc, ui, view, fakeWindow, history } = setup(snapshot)
    view.render(snapshot)

    expect(ui.textContent).toContain('새 PIN으로 바꿔 주세요')
    doc.dispatch('keydown', { key: 'Escape' })
    expect(view.isOpen).toBe(true)
    fakeWindow.dispatchPop()
    expect(view.isOpen).toBe(true)
    expect(history.pushState).toHaveBeenCalledTimes(2)
    expect(action(ui, 'force-logout').textContent).toContain('로그아웃하고 게스트로 돌아가기')
  })

  it('traps focus, closes normally, restores focus, and removes inert state', () => {
    const { doc, ui, recordBook, view, history } = setup()
    const trigger = doc.createElement('button')
    trigger.setAttribute('data-recordbook-profile', 'guest')
    ui.appendChild(trigger)
    trigger.focus()
    view.open(trigger as unknown as HTMLElement)
    const buttons = ui.querySelectorAll('button').filter((button) => !button.disabled && !button.hidden)
    buttons[buttons.length - 1].focus()
    const tab = doc.dispatch('keydown', { key: 'Tab' })
    expect(tab.defaultPrevented).toBe(true)

    action(ui, 'close').click()
    expect(view.isOpen).toBe(false)
    expect(history.back).toHaveBeenCalledOnce()
    expect(recordBook.inert).toBe(false)
    expect(doc.documentElement.classList.contains('profile-open')).toBe(false)
    expect(doc.activeElement).toBe(trigger)
  })

  it('keeps mobile controls zoomable and accessible in CSS', async () => {
    const { readFileSync } = await vi.importActual<{
      readFileSync(path: URL, encoding: 'utf8'): string
    }>('node:fs')
    const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    expect(css).toMatch(/\.player-profile-layer[\s\S]*position:\s*fixed/)
    expect(css).toMatch(/\.player-profile-layer button,[\s\S]*min-height:\s*44px/)
    expect(css).toMatch(/\.player-profile-layer input[\s\S]*font-size:\s*16px/)
    expect(html).not.toContain('maximum-scale=1')
    expect(html).not.toContain('user-scalable=no')
  })
})
