import type { Weapon } from './weapon'
import { getImage, type AssetName } from '../art/assets'
import { weaponIconSVG } from '../art/weapon-icons'

const CHAR_IDS = new Set<string>([
  'cinnamoroll',
  'thanos',
  'ironman',
  'hulk',
  'godzilla',
  'dragonball',
  'cat',
  'ditto',
  'pooh',
])

/** Best available icon: character sprite > doodle SVG > emoji. */
function iconHTML(w: Weapon): string {
  if (CHAR_IDS.has(w.id)) {
    const img = getImage(w.id as AssetName)
    if (img) return `<img class="wicon-img" src="${img.src}" alt="${w.name}" draggable="false" />`
  }
  if (weaponIconSVG[w.id]) return `<span class="wicon-svg">${weaponIconSVG[w.id]}</span>`
  return `<span class="emoji">${w.icon}</span>`
}

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
      b.innerHTML = `<span class="wicon">${iconHTML(w)}</span><span class="name">${w.name}</span>`
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
