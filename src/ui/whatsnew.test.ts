import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WHATS_NEW_KEY, WhatsNew } from './whatsnew'

type Listener = (event: FakeEvent) => void

class FakeEvent {
  defaultPrevented = false
  constructor(
    readonly type: string,
    readonly target: FakeElement | FakeDocument,
    readonly key?: string
  ) {}
  preventDefault(): void { this.defaultPrevented = true }
  stopPropagation(): void {}
}

class FakeClassList {
  constructor(private readonly names: Set<string>) {}
  add(name: string): void { this.names.add(name) }
  remove(name: string): void { this.names.delete(name) }
  contains(name: string): boolean { return this.names.has(name) }
}

class FakeElement {
  readonly children: FakeElement[] = []
  readonly names = new Set<string>()
  readonly classList = new FakeClassList(this.names)
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Listener[]>()
  textContent = ''
  hidden = false
  parentElement: FakeElement | null = null

  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  set className(value: string) {
    this.names.clear()
    value.split(/\s+/).filter(Boolean).forEach((name) => this.names.add(name))
  }

  set innerHTML(_value: string) {
    throw new Error('innerHTML is forbidden')
  }

  append(...nodes: FakeElement[]): void {
    nodes.forEach((node) => {
      node.parentElement = this
      this.children.push(node)
    })
  }

  appendChild(node: FakeElement): FakeElement {
    this.append(node)
    return node
  }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }

  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as unknown as Listener])
  }

  dispatch(type: string, target: FakeElement = this): void {
    const event = new FakeEvent(type, target)
    ;(this.listeners.get(type) ?? []).forEach((listener) => listener(event))
  }

  click(): void { this.dispatch('click') }
  focus(): void { this.ownerDocument.activeElement = this }

  querySelector(selector: string): FakeElement | null {
    const matches = (node: FakeElement) => selector.startsWith('.')
      ? node.classList.contains(selector.slice(1))
      : selector === 'button'
        ? node.tagName === 'BUTTON'
        : false
    for (const child of this.children) {
      if (matches(child)) return child
      const nested = child.querySelector(selector)
      if (nested) return nested
    }
    return null
  }

  get allText(): string {
    return this.textContent + this.children.map((child) => child.allText).join('')
  }
}

class FakeDocument {
  activeElement: FakeElement | null = null
  readonly listeners = new Map<string, Listener[]>()

  createElement(tag: string): FakeElement { return new FakeElement(tag.toUpperCase(), this) }
  addEventListener(type: string, listener: EventListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener as unknown as Listener])
  }
  dispatchKey(key: string): FakeEvent {
    const event = new FakeEvent('keydown', this, key)
    ;(this.listeners.get('keydown') ?? []).forEach((listener) => listener(event))
    return event
  }
}

let documentFake: FakeDocument
let storage: Map<string, string>

beforeEach(() => {
  documentFake = new FakeDocument()
  storage = new Map()
  vi.stubGlobal('document', documentFake as unknown as Document)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value) },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WhatsNew', () => {
  it('uses the exact four approved items and auto-opens only once per version', () => {
    const parent = documentFake.createElement('div')
    const first = new WhatsNew(parent as unknown as HTMLElement)

    expect(first.maybeShowOnLoad()).toBe(true)
    expect(parent.classList.contains('show')).toBe(false)
    expect(parent.children[0].classList.contains('show')).toBe(true)
    expect(parent.children[0].allText).toContain('짧게 톡, 길게 꾹. 누르는 방법에 따라 공격이 달라졌어요.')
    expect(parent.children[0].allText).toContain('시나모롤과 메타몽의 클래식 모습을 골라요.')
    expect(parent.children[0].allText).not.toContain('—')
    expect(parent.children[0].children[0].children.filter((item) => item.tagName === 'UL')[0].children)
      .toHaveLength(4)

    first.close()
    expect(parent.children[0].hidden).toBe(true)
    expect(parent.children[0].getAttribute('aria-hidden')).toBe('true')
    expect(storage.get(WHATS_NEW_KEY)).toBe('1')
    const second = new WhatsNew(parent as unknown as HTMLElement)
    expect(second.maybeShowOnLoad()).toBe(false)
  })

  it('closes with Escape and returns focus to the opener', () => {
    const parent = documentFake.createElement('div')
    const opener = documentFake.createElement('button')
    opener.focus()
    const notice = new WhatsNew(parent as unknown as HTMLElement)
    notice.open()

    documentFake.dispatchKey('Escape')

    expect(parent.children[0].classList.contains('show')).toBe(false)
    expect(documentFake.activeElement).toBe(opener)
  })

  it('keeps keyboard focus inside the one-button modal', () => {
    const parent = documentFake.createElement('div')
    const notice = new WhatsNew(parent as unknown as HTMLElement)
    notice.open()

    const event = documentFake.dispatchKey('Tab')

    expect(event.defaultPrevented).toBe(true)
    expect(documentFake.activeElement?.classList.contains('ok-btn')).toBe(true)
  })

  it('keeps play available when version storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })
    const parent = documentFake.createElement('div')
    const notice = new WhatsNew(parent as unknown as HTMLElement)

    expect(() => notice.maybeShowOnLoad()).not.toThrow()
    expect(() => notice.close()).not.toThrow()
  })
})
