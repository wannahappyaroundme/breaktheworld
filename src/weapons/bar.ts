import type { Weapon } from './weapon'

/** Bottom scrollable weapon selector (touch). */
export class WeaponBar {
  readonly el: HTMLDivElement
  private buttons = new Map<string, HTMLDivElement>()
  private selectedId = ''

  constructor(parent: HTMLElement, weapons: Weapon[], onSelect: (w: Weapon) => void) {
    this.el = document.createElement('div')
    this.el.className = 'weapon-bar'
    for (const w of weapons) {
      const b = document.createElement('div')
      b.className = 'weapon'
      b.innerHTML = `<span class="emoji">${w.icon}</span><span class="name">${w.name}</span>`
      b.addEventListener('click', () => onSelect(w))
      // prevent the bar tap from also smashing the world
      b.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
      this.buttons.set(w.id, b)
      this.el.appendChild(b)
    }
    parent.appendChild(this.el)
  }

  select(id: string): void {
    if (this.selectedId) this.buttons.get(this.selectedId)?.classList.remove('selected')
    this.selectedId = id
    const b = this.buttons.get(id)
    b?.classList.add('selected')
    b?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }
}
