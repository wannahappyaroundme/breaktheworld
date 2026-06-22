export interface HudCallbacks {
  onToggleSound: () => void
  onReset: () => void
  onNext: () => void
  onWhatsNew: () => void
  onShare: () => void
}

/** Top HUD: combo counter + sound / next / reset buttons + weapon name flash. */
export class Hud {
  private comboN: HTMLSpanElement
  private comboBox: HTMLDivElement
  private bestEl!: HTMLSpanElement
  private soundBtn: HTMLButtonElement
  private parent: HTMLElement

  constructor(parent: HTMLElement, cb: HudCallbacks) {
    this.parent = parent
    const top = document.createElement('div')
    top.className = 'hud-top'

    this.comboBox = document.createElement('div')
    this.comboBox.className = 'combo'
    this.comboBox.innerHTML = `<span class="n">0</span><span class="label">COMBO</span><span class="best">🏆 0</span>`
    this.comboN = this.comboBox.querySelector('.n') as HTMLSpanElement
    this.bestEl = this.comboBox.querySelector('.best') as HTMLSpanElement

    const buttons = document.createElement('div')
    buttons.className = 'top-buttons'
    const shareBtn = mkBtn('📸', cb.onShare)
    const newsBtn = mkBtn('✨', cb.onWhatsNew)
    this.soundBtn = mkBtn('🔊', cb.onToggleSound)
    const nextBtn = mkBtn('⏭️', cb.onNext)
    const resetBtn = mkBtn('🔄', cb.onReset)
    buttons.append(shareBtn, newsBtn, this.soundBtn, nextBtn, resetBtn)

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

  setBest(n: number): void {
    this.bestEl.textContent = `🏆 ${n}`
  }

  /** Top banner shown when the player beats their best combo. */
  showNewRecord(n: number): void {
    const el = document.createElement('div')
    el.className = 'record-banner show'
    el.innerHTML = `🎉 신기록! <b>${n}</b> 콤보`
    this.parent.appendChild(el)
    window.setTimeout(() => el.remove(), 1800)
  }

  /** Center celebratory popup, e.g. when a target is destroyed. */
  popup(text: string): void {
    const el = document.createElement('div')
    el.className = 'celebrate-popup show'
    el.textContent = text
    this.parent.appendChild(el)
    window.setTimeout(() => el.remove(), 900)
  }

  /** Combo grade flash (GREAT / SUPER / INSANE ...). */
  gradeFlash(label: string): void {
    const el = document.createElement('div')
    el.className = 'grade-flash show'
    el.textContent = label
    this.parent.appendChild(el)
    window.setTimeout(() => el.remove(), 800)
  }

  /** Neutral top toast, e.g. cumulative milestones. */
  toast(text: string): void {
    const el = document.createElement('div')
    el.className = 'toast show'
    el.textContent = text
    this.parent.appendChild(el)
    window.setTimeout(() => el.remove(), 2000)
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
