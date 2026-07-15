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
  private comboN: HTMLSpanElement
  private comboBox: HTMLDivElement
  private bestEl: HTMLSpanElement
  private soundBtn: HTMLButtonElement
  private parent: HTMLElement
  private feverBanner: HTMLDivElement
  private noticeEl: HTMLDivElement
  private notices: NotificationQueue
  private noticeSequence = 0

  constructor(parent: HTMLElement, cb: HudCallbacks, options: HudOptions = {}) {
    this.parent = parent
    const top = document.createElement('div')
    top.className = 'hud-top'

    this.comboBox = document.createElement('div')
    this.comboBox.className = 'combo'
    this.comboN = span('n', '0')
    this.bestEl = span('best', '🏆 0')
    this.comboBox.append(this.comboN, span('label', '연속'), this.bestEl)

    const buttons = document.createElement('div')
    buttons.className = 'top-buttons'
    const shareBtn = mkBtn('📸', '기록 카드 공유', cb.onShare)
    const recordBtn = mkBtn('📖', '기록책 열기', cb.onOpenRecordBook ?? cb.onWhatsNew)
    this.soundBtn = mkBtn('🔊', '소리 끄기', cb.onToggleSound)
    const nextBtn = mkBtn('⏭️', '다음 타겟', cb.onNext)
    const resetBtn = mkBtn('🔄', '처음부터', cb.onReset)
    buttons.append(shareBtn, recordBtn, this.soundBtn, nextBtn, resetBtn)

    top.append(this.comboBox, buttons)
    parent.appendChild(top)

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

    this.notices = new NotificationQueue({
      scheduler: options.scheduler ?? browserScheduler(),
      onShow: (notice) => this.showNotice(notice),
      onHide: () => this.hideNotice(),
    })
  }

  setFever(on: boolean): void {
    this.feverBanner.classList.toggle('on', on)
  }

  setCombo(n: number): void {
    this.comboN.textContent = String(n)
    this.comboBox.classList.add('bump')
    window.setTimeout(() => this.comboBox.classList.remove('bump'), 90)
  }

  setMuted(muted: boolean): void {
    this.soundBtn.textContent = muted ? '🔇' : '🔊'
    this.soundBtn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기')
  }

  flashWeapon(name: string): void {
    const el = document.createElement('div')
    el.className = 'weapon-flash show'
    el.textContent = `${name}!`
    this.parent.appendChild(el)
    window.setTimeout(() => el.remove(), 700)
  }

  setBest(n: number): void {
    this.bestEl.textContent = `🏆 ${n}`
  }

  notify(input: NotificationInput): boolean {
    return this.notices.push(input)
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

function mkBtn(label: string, accessibleName: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'icon-btn'
  button.textContent = label
  button.setAttribute('aria-label', accessibleName)
  button.addEventListener('click', onClick)
  button.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true })
  return button
}
