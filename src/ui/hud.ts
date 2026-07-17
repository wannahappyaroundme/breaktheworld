import {
  NotificationQueue,
  type NotificationInput,
  type NotificationScheduler,
  type QueuedNotification,
} from './notification-queue'

export interface HudCallbacks {
  onToggleSound: () => void
  onReset: () => void
  onNext: () => void
  onWhatsNew: () => void
  onOpenRecordBook?: () => void
  onShare: () => void
}

export interface HudOptions {
  scheduler?: NotificationScheduler
}

export interface HudProgress {
  level: number
  xp: number
  nextLevelXp: number
  ratio: number
  unseen: number
}

export interface HudProgressGain {
  xp: number
  levelUp: number | null
}

const MAX_XP_FRAGMENTS = 3
const PROGRESS_FEEDBACK_MS = 1_000
const MAX_LEVEL = 20
const MAX_ACHIEVEMENTS = 32
const MAX_ACHIEVEMENT_XP = 4_700
let hudInstanceSequence = 0

function browserScheduler(): NotificationScheduler {
  return {
    schedule(run, delayMs) {
      const handle = window.setTimeout(run, delayMs)
      return () => window.clearTimeout(handle)
    },
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

/** Top HUD with one queued live-region notice renderer. */
export class Hud {
  private top: HTMLDivElement
  private comboN: HTMLSpanElement
  private comboBox: HTMLDivElement
  private bestEl: HTMLSpanElement
  private soundBtn: HTMLButtonElement
  private soundMark: HTMLSpanElement
  private levelBtn: HTMLButtonElement
  private levelValue: HTMLSpanElement
  private levelDetail: HTMLSpanElement
  private unseenBadge: HTMLSpanElement
  private levelTrack: HTMLSpanElement
  private moreBtn: HTMLButtonElement
  private moreMenu: HTMLDivElement
  private controls: HTMLDivElement
  private progressFeedback: HTMLDivElement
  private progressFeedbackTimer: number | null = null
  private gamificationVisible = true
  private progressSnapshot: HudProgress = {
    level: 1,
    xp: 0,
    nextLevelXp: 50,
    ratio: 0,
    unseen: 0,
  }
  private parent: HTMLElement
  private feverBanner: HTMLDivElement
  private noticeEl: HTMLDivElement
  private notices: NotificationQueue
  private noticeSequence = 0
  private destroyed = false
  private readonly timers = new Set<number>()
  private readonly transientFeedback = new Set<HTMLElement>()
  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (this.destroyed || event.key !== 'Escape' || this.moreMenu.hidden) return
    event.preventDefault()
    this.closeMenu(true)
  }
  private readonly handleDocumentPointerdown = (event: PointerEvent): void => {
    if (this.destroyed) return
    const target = event.target as Node
    if (
      this.moreMenu.hidden
      || this.moreMenu.contains(target)
      || this.moreBtn.contains(target)
    ) return
    this.closeMenu(true)
  }
  private readonly handleMenuKeydown = (event: KeyboardEvent): void => {
    this.onMenuKeydown(event)
  }

  constructor(parent: HTMLElement, cb: HudCallbacks, options: HudOptions = {}) {
    this.parent = parent
    this.top = document.createElement('div')
    this.top.className = 'hud-top'

    this.comboBox = document.createElement('div')
    this.comboBox.className = 'combo'
    this.comboN = span('n', '0')
    this.bestEl = span('best', '🏆 0')
    this.comboBox.append(this.comboN, span('label', '연속'), this.bestEl)

    this.controls = document.createElement('div')
    this.controls.className = 'hud-controls'
    const buttons = document.createElement('div')
    buttons.className = 'top-buttons'
    this.levelBtn = mkBtn(
      '기록책 열기, 현재 레벨 1',
      () => this.runCallback(cb.onOpenRecordBook ?? cb.onWhatsNew),
    )
    this.levelBtn.classList.add('hud-level-button')
    this.levelValue = span('hud-level-value', 'LV 1')
    this.levelDetail = span('hud-level-detail', '0 / 50')
    this.levelDetail.setAttribute('aria-hidden', 'true')
    this.unseenBadge = span('hud-unseen-badge', '')
    this.unseenBadge.setAttribute('aria-hidden', 'true')
    this.unseenBadge.hidden = true
    this.levelTrack = span('hud-level-track', '')
    this.levelTrack.setAttribute('aria-hidden', 'true')
    this.levelBtn.append(this.levelValue, this.levelDetail, this.unseenBadge, this.levelTrack)
    this.levelBtn.style.setProperty('--hud-level-ratio', '0')

    this.soundBtn = mkBtn('소리 끄기', () => this.runCallback(cb.onToggleSound))
    this.soundBtn.classList.add('hud-sound-button')
    this.soundMark = span('hud-sound-mark', '')
    this.soundMark.setAttribute('aria-hidden', 'true')
    this.soundBtn.appendChild(this.soundMark)

    this.moreBtn = mkBtn('게임 메뉴 열기', () => this.toggleMenu())
    this.moreBtn.classList.add('hud-more-button')
    this.moreBtn.setAttribute('aria-expanded', 'false')
    const moreMenuId = `hud-more-menu-${++hudInstanceSequence}`
    this.moreBtn.setAttribute('aria-controls', moreMenuId)
    this.moreBtn.setAttribute('aria-haspopup', 'menu')
    this.moreBtn.appendChild(mark('hud-more-mark'))
    buttons.append(this.levelBtn, this.soundBtn, this.moreBtn)

    this.moreMenu = document.createElement('div')
    this.moreMenu.id = moreMenuId
    this.moreMenu.className = 'hud-more-menu'
    this.moreMenu.hidden = true
    this.moreMenu.setAttribute('role', 'menu')
    this.moreMenu.addEventListener('keydown', this.handleMenuKeydown)
    this.moreMenu.append(
      menuButton('기록 카드 공유', () => this.runCallback(cb.onShare), () => this.closeMenu(true)),
      menuButton('다음 타겟', () => this.runCallback(cb.onNext), () => this.closeMenu(true)),
      menuButton('처음부터', () => this.runCallback(cb.onReset), () => this.closeMenu(true)),
    )
    this.controls.append(buttons, this.moreMenu)

    this.top.append(this.comboBox, this.controls)
    parent.appendChild(this.top)

    document.addEventListener('keydown', this.handleDocumentKeydown)
    document.addEventListener('pointerdown', this.handleDocumentPointerdown)

    this.feverBanner = document.createElement('div')
    this.feverBanner.className = 'fever-banner'
    this.feverBanner.textContent = '🌈 FEVER! 🌈'
    parent.appendChild(this.feverBanner)

    this.noticeEl = document.createElement('div')
    this.noticeEl.className = 'hud-notice'
    this.noticeEl.setAttribute('role', 'status')
    this.noticeEl.setAttribute('aria-live', 'polite')
    this.noticeEl.setAttribute('aria-atomic', 'true')
    parent.appendChild(this.noticeEl)

    this.progressFeedback = document.createElement('div')
    this.progressFeedback.className = 'hud-progress-feedback'
    this.progressFeedback.hidden = true
    this.progressFeedback.setAttribute('aria-hidden', 'true')
    parent.appendChild(this.progressFeedback)

    this.notices = new NotificationQueue({
      scheduler: options.scheduler ?? browserScheduler(),
      onShow: (notice) => this.showNotice(notice),
      onHide: () => this.hideNotice(),
    })
  }

  setFever(on: boolean): void {
    if (this.destroyed) return
    this.feverBanner.classList.toggle('on', on)
  }

  setCombo(n: number): void {
    if (this.destroyed) return
    this.comboN.textContent = String(n)
    this.comboBox.classList.add('bump')
    this.schedule(() => this.comboBox.classList.remove('bump'), 90)
  }

  setMuted(muted: boolean): void {
    if (this.destroyed) return
    this.soundBtn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기')
    this.soundMark.classList.toggle('muted', muted)
  }

  setProgress(progress: HudProgress): void {
    if (this.destroyed) return
    this.progressSnapshot = {
      level: boundedInteger(progress.level, 1, MAX_LEVEL),
      xp: boundedInteger(progress.xp, 0, MAX_ACHIEVEMENT_XP),
      nextLevelXp: boundedInteger(progress.nextLevelXp, 0, MAX_ACHIEVEMENT_XP),
      unseen: boundedInteger(progress.unseen, 0, MAX_ACHIEVEMENTS),
      ratio: boundedRatio(progress.ratio),
    }
    if (this.gamificationVisible) this.renderProgress()
  }

  setGamificationVisible(visible: boolean): void {
    if (this.destroyed) return
    this.gamificationVisible = visible
    if (!visible) {
      this.clearProgressFeedback()
      this.levelValue.textContent = '기록책'
      this.levelDetail.textContent = ''
      this.levelDetail.hidden = true
      this.levelTrack.hidden = true
      this.unseenBadge.textContent = ''
      this.unseenBadge.hidden = true
      this.levelBtn.style.setProperty('--hud-level-ratio', '0')
      this.levelBtn.setAttribute('aria-label', '기록책 열기')
      return
    }
    this.levelDetail.hidden = false
    this.levelTrack.hidden = false
    this.renderProgress()
  }

  showProgressGain(gain: HudProgressGain): void {
    if (this.destroyed || !this.gamificationVisible) return
    const xp = boundedInteger(gain.xp, 0, MAX_ACHIEVEMENT_XP)
    const levelUp = gain.levelUp === null || !Number.isFinite(gain.levelUp)
      ? null
      : boundedInteger(gain.levelUp, 1, MAX_LEVEL)
    if (xp === 0 && levelUp === null) return

    if (this.progressFeedbackTimer !== null) this.clearTimer(this.progressFeedbackTimer)
    this.progressFeedback.classList.remove('show')
    this.progressFeedback.replaceChildren()
    if (xp > 0) {
      this.progressFeedback.appendChild(span('hud-xp-value', `경험치 +${xp}`))
      const fragmentCount = Math.min(MAX_XP_FRAGMENTS, Math.max(1, Math.ceil(xp / 100)))
      for (let index = 0; index < fragmentCount; index += 1) {
        const fragment = span('hud-xp-fragment', '')
        fragment.setAttribute('aria-hidden', 'true')
        fragment.style.setProperty('--fragment-index', String(index))
        this.progressFeedback.appendChild(fragment)
      }
    }
    if (levelUp !== null) {
      this.progressFeedback.appendChild(span('hud-level-up', `레벨 ${levelUp}`))
    }
    this.progressFeedback.hidden = false
    this.progressFeedback.classList.toggle('level-up', levelUp !== null)
    void this.progressFeedback.offsetWidth
    this.progressFeedback.classList.add('show')
    this.levelBtn.classList.toggle('level-up', levelUp !== null)
    this.levelBtn.classList.add('progress-gain')
    this.progressFeedbackTimer = this.schedule(() => {
      this.progressFeedback.classList.remove('show', 'level-up')
      this.progressFeedback.hidden = true
      this.levelBtn.classList.remove('progress-gain', 'level-up')
      this.progressFeedbackTimer = null
    }, PROGRESS_FEEDBACK_MS)
  }

  flashWeapon(name: string): void {
    if (this.destroyed) return
    const el = document.createElement('div')
    el.className = 'weapon-flash show'
    el.textContent = `${name}!`
    this.parent.appendChild(el)
    this.transientFeedback.add(el)
    this.schedule(() => {
      el.remove()
      this.transientFeedback.delete(el)
    }, 700)
  }

  setBest(n: number): void {
    if (this.destroyed) return
    this.bestEl.textContent = `🏆 ${n}`
  }

  notify(input: NotificationInput): boolean {
    if (this.destroyed) return false
    return this.notices.push(input)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    document.removeEventListener('keydown', this.handleDocumentKeydown)
    document.removeEventListener('pointerdown', this.handleDocumentPointerdown)
    this.moreMenu.removeEventListener('keydown', this.handleMenuKeydown)
    this.closeMenu(false)
    this.notices.clear()
    this.clearProgressFeedback()
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers.clear()
    for (const element of this.transientFeedback) element.remove()
    this.transientFeedback.clear()
    this.top.remove()
    this.feverBanner.remove()
    this.noticeEl.remove()
    this.progressFeedback.remove()
  }

  /** Compatibility method routed through the shared record-priority queue. */
  showNewRecord(n: number): void {
    this.notify({
      key: `record:${n}`,
      kind: 'record',
      text: `🎉 신기록! ${n} 연속`,
      durationMs: 1_800,
    })
  }

  /** Compatibility method routed through the shared live-region queue. */
  popup(text: string): void {
    this.notify({
      key: this.transientKey('popup'),
      kind: 'general',
      text,
      durationMs: 900,
    })
  }

  /** Compatibility method routed through the shared live-region queue. */
  gradeFlash(label: string): void {
    this.notify({
      key: this.transientKey('grade'),
      kind: 'general',
      text: label,
      durationMs: 800,
    })
  }

  /** Compatibility method routed through the shared live-region queue. */
  toast(text: string): void {
    this.notify({
      key: this.transientKey('toast'),
      kind: 'general',
      text,
      durationMs: 2_000,
    })
  }

  private transientKey(prefix: string): string {
    return `${prefix}:${++this.noticeSequence}`
  }

  private toggleMenu(): void {
    if (this.destroyed) return
    if (this.moreMenu.hidden) {
      this.moreMenu.hidden = false
      this.moreBtn.setAttribute('aria-expanded', 'true')
      this.moreMenu.querySelector<HTMLButtonElement>('button')?.focus()
      return
    }
    this.closeMenu(true)
  }

  private closeMenu(returnFocus: boolean): void {
    if (this.moreMenu.hidden) return
    this.moreMenu.hidden = true
    this.moreBtn.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.moreBtn.focus()
  }

  private onMenuKeydown(event: KeyboardEvent): void {
    if (this.destroyed) return
    if (event.key === 'Tab') {
      event.preventDefault()
      this.closeMenu(true)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.closeMenu(true)
      return
    }
    const items = Array.from(this.moreMenu.querySelectorAll<HTMLButtonElement>('button'))
    if (items.length === 0) return
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
    let next: number | null = null
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (next === null) return
    event.preventDefault()
    items[next].focus()
  }

  private runCallback(callback: () => void): void {
    if (!this.destroyed) callback()
  }

  private schedule(run: () => void, delayMs: number): number {
    let handle = 0
    handle = window.setTimeout(() => {
      this.timers.delete(handle)
      if (!this.destroyed) run()
    }, delayMs)
    this.timers.add(handle)
    return handle
  }

  private clearTimer(handle: number): void {
    window.clearTimeout(handle)
    this.timers.delete(handle)
  }

  private renderProgress(): void {
    const { level, xp, nextLevelXp, unseen, ratio } = this.progressSnapshot
    this.levelValue.textContent = `LV ${level}`
    this.levelDetail.textContent = nextLevelXp > 0 ? `${xp} / ${nextLevelXp}` : `${xp} 경험치`
    this.levelBtn.style.setProperty('--hud-level-ratio', String(ratio))
    this.levelBtn.setAttribute('aria-label', unseen > 0
      ? `기록책 열기, 현재 레벨 ${level}, 새 업적 ${unseen}개`
      : `기록책 열기, 현재 레벨 ${level}`)
    this.unseenBadge.textContent = unseen > 0 ? String(unseen) : ''
    this.unseenBadge.hidden = unseen === 0
  }

  private clearProgressFeedback(): void {
    if (this.progressFeedbackTimer !== null) this.clearTimer(this.progressFeedbackTimer)
    this.progressFeedbackTimer = null
    this.progressFeedback.replaceChildren()
    this.progressFeedback.classList.remove('show', 'level-up')
    this.progressFeedback.hidden = true
    this.levelBtn.classList.remove('progress-gain', 'level-up')
  }

  private showNotice(notice: QueuedNotification): void {
    this.noticeEl.textContent = notice.text
    this.noticeEl.setAttribute('data-kind', notice.kind)
    this.noticeEl.classList.add('show')
  }

  private hideNotice(): void {
    this.noticeEl.classList.remove('show')
    this.noticeEl.textContent = ''
    this.noticeEl.removeAttribute('data-kind')
  }
}

function mkBtn(accessibleName: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'icon-btn'
  button.setAttribute('aria-label', accessibleName)
  button.addEventListener('click', onClick)
  button.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true })
  return button
}

function mark(className: string): HTMLSpanElement {
  const element = span(className, '')
  element.setAttribute('aria-hidden', 'true')
  return element
}

function menuButton(
  text: string,
  onClick: () => void,
  close: () => void,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'hud-menu-item'
  button.textContent = text
  button.setAttribute('aria-label', text)
  button.setAttribute('role', 'menuitem')
  button.addEventListener('click', () => {
    close()
    onClick()
  })
  button.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true })
  return button
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function boundedRatio(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
