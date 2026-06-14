export interface HudCallbacks {
  onToggleSound: () => void
  onReset: () => void
  onNext: () => void
}

/** Top HUD: combo counter + sound / next / reset buttons + weapon name flash. */
export class Hud {
  private comboN: HTMLSpanElement
  private comboBox: HTMLDivElement
  private soundBtn: HTMLButtonElement
  private parent: HTMLElement

  constructor(parent: HTMLElement, cb: HudCallbacks) {
    this.parent = parent
    const top = document.createElement('div')
    top.className = 'hud-top'

    this.comboBox = document.createElement('div')
    this.comboBox.className = 'combo'
    this.comboBox.innerHTML = `<span class="n">0</span><span class="label">COMBO</span>`
    this.comboN = this.comboBox.querySelector('.n') as HTMLSpanElement

    const buttons = document.createElement('div')
    buttons.className = 'top-buttons'
    this.soundBtn = mkBtn('🔊', cb.onToggleSound)
    const nextBtn = mkBtn('⏭️', cb.onNext)
    const resetBtn = mkBtn('🔄', cb.onReset)
    buttons.append(this.soundBtn, nextBtn, resetBtn)

    top.append(this.comboBox, buttons)
    parent.appendChild(top)
  }

  setCombo(n: number): void {
    this.comboN.textContent = String(n)
    this.comboBox.classList.add('bump')
    window.setTimeout(() => this.comboBox.classList.remove('bump'), 90)
  }

  setMuted(muted: boolean): void {
    this.soundBtn.textContent = muted ? '🔇' : '🔊'
  }

  flashWeapon(name: string): void {
    const el = document.createElement('div')
    el.className = 'weapon-flash show'
    el.textContent = name + '!'
    this.parent.appendChild(el)
    window.setTimeout(() => el.remove(), 700)
  }
}

function mkBtn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = 'icon-btn'
  b.textContent = label
  b.addEventListener('click', onClick)
  b.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true })
  return b
}
