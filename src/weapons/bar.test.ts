import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Weapon } from './weapon'
import { WeaponBar } from './bar'

class FakeClassList {
  private values = new Set<string>()

  add(value: string): void {
    this.values.add(value)
  }

  remove(value: string): void {
    this.values.delete(value)
  }

  contains(value: string): boolean {
    return this.values.has(value)
  }
}

class FakeElement {
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, Array<(event: { stopPropagation(): void }) => void>>()
  readonly attributes = new Map<string, string>()
  readonly classList = new FakeClassList()
  className = ''
  textContent = ''
  innerHTML = ''
  type = ''
  src = ''
  alt = ''
  draggable = true
  scrollIntoView = vi.fn()

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child)
    return child
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  addEventListener(type: string, listener: (event: { stopPropagation(): void }) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  dispatch(type: string, event: { stopPropagation(): void }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const weapon: Weapon = {
  id: 'hammer',
  name: '망치',
  icon: '🔨',
  mode: 'point',
  quick: () => {},
  drag: () => {},
  charged: () => {},
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WeaponBar accessibility', () => {
  it('builds a labelled button with safe text nodes and isolated touch input', () => {
    vi.stubGlobal('document', {
      createElement: (tag: string) => new FakeElement(tag),
    })
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    })
    const parent = new FakeElement('div')
    const onSelect = vi.fn()

    const weaponBar = new WeaponBar(parent as unknown as HTMLElement, [weapon], onSelect)

    const bar = parent.children[0]
    const button = bar.children[0]
    expect(button.tagName).toBe('button')
    expect(button.type).toBe('button')
    expect(button.getAttribute('aria-label')).toBe('망치 선택')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.innerHTML).toBe('')
    expect(button.children[1].textContent).toBe('망치')

    const pointerEvent = { stopPropagation: vi.fn() }
    const touchEvent = { stopPropagation: vi.fn() }
    button.dispatch('pointerdown', pointerEvent)
    button.dispatch('touchstart', touchEvent)
    button.dispatch('click', { stopPropagation: vi.fn() })

    expect(pointerEvent.stopPropagation).toHaveBeenCalledTimes(1)
    expect(touchEvent.stopPropagation).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(weapon)

    weaponBar.select(weapon.id)
    expect(button.getAttribute('aria-pressed')).toBe('true')
  })
})
