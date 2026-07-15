import type { Weapon } from './weapon'
import { getImage, type AssetName } from '../art/assets'
import { weaponIconSVG } from '../art/weapon-icons'
import { isCharacterId } from './character-ids'

/** Best available icon: character sprite > trusted doodle SVG > emoji. */
function createIcon(w: Weapon): HTMLElement {
  if (isCharacterId(w.id)) {
    const img = getImage(w.id as AssetName)
    if (img) {
      const icon = document.createElement('img')
      icon.className = 'wicon-img'
      icon.src = img.src
      icon.alt = ''
      icon.draggable = false
      icon.setAttribute('aria-hidden', 'true')
      return icon
    }
  }
  if (weaponIconSVG[w.id]) {
    const icon = document.createElement('span')
    icon.className = 'wicon-svg'
    icon.setAttribute('aria-hidden', 'true')
    icon.innerHTML = weaponIconSVG[w.id]
    return icon
  }
  const icon = document.createElement('span')
  icon.className = 'emoji'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = w.icon
  return icon
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

/** Bottom scrollable weapon selector (touch). */
export class WeaponBar {
  readonly el: HTMLDivElement
  private buttons = new Map<string, HTMLButtonElement>()
  private selectedId = ''

  constructor(parent: HTMLElement, weapons: Weapon[], onSelect: (w: Weapon) => void) {
    this.el = document.createElement('div')
    this.el.className = 'weapon-bar'
    for (const w of weapons) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'weapon'
      b.setAttribute('aria-label', `${w.name} 선택`)
      b.setAttribute('aria-pressed', 'false')

      const icon = document.createElement('span')
      icon.className = 'wicon'
      icon.appendChild(createIcon(w))
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = w.name
      b.appendChild(icon)
      b.appendChild(name)

      b.addEventListener('click', () => onSelect(w))
      // prevent the bar tap from also smashing the world
      b.addEventListener('pointerdown', (event) => event.stopPropagation())
      b.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
      this.buttons.set(w.id, b)
      this.el.appendChild(b)
    }
    parent.appendChild(this.el)
  }

  select(id: string): void {
    if (this.selectedId) {
      const previous = this.buttons.get(this.selectedId)
      previous?.classList.remove('selected')
      previous?.setAttribute('aria-pressed', 'false')
    }
    this.selectedId = id
    const b = this.buttons.get(id)
    b?.classList.add('selected')
    b?.setAttribute('aria-pressed', 'true')
    b?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }
}
