export const WHATS_NEW_KEY = 'btw.whatsnew.2026-07-16'

const ITEMS = [
  { e: '👆', t: '짧게 톡, 길게 꾹. 누르는 방법에 따라 공격이 달라졌어요.' },
  { e: '🎭', t: '캐릭터마다 세 가지 기술로 다르게 부숴요.' },
  { e: '📖', t: '오늘의 도전과 부순 기록을 기록책에서 확인해요.' },
  { e: '🎨', t: '시나모롤과 메타몽의 클래식 모습을 골라요.' },
] as const

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Small centered versioned update dialog, built with static text-only DOM. */
export class WhatsNew {
  private readonly backdrop: HTMLDivElement
  private readonly closeButton: HTMLButtonElement
  private returnFocus: { focus?: () => void } | null = null

  constructor(parent: HTMLElement) {
    this.backdrop = element('div', 'modal-backdrop')
    this.backdrop.hidden = true
    this.backdrop.setAttribute('aria-hidden', 'true')
    const dialog = element('div', 'whatsnew')
    const heading = element('h2', undefined, '✨ 업데이트 안내')
    heading.id = 'whatsnew-title'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    dialog.setAttribute('aria-labelledby', heading.id)
    dialog.append(heading, element('div', 'sub', '세상 부수기가 더 재미있어졌어요!'))

    const list = element('ul')
    for (const item of ITEMS) {
      const row = element('li')
      row.append(element('span', 'e', item.e), element('span', undefined, item.t))
      list.append(row)
    }
    this.closeButton = element('button', 'ok-btn', '부수러 가기 💥')
    this.closeButton.type = 'button'
    dialog.append(list, this.closeButton)
    this.backdrop.append(dialog)
    parent.appendChild(this.backdrop)

    this.backdrop.addEventListener('click', (event) => {
      if (event.target === this.backdrop) this.close()
    })
    this.closeButton.addEventListener('click', () => this.close())
    this.backdrop.addEventListener('touchstart', (event) => event.stopPropagation(), {
      passive: true,
    })
    document.addEventListener('keydown', (event) => {
      if (!this.backdrop.classList.contains('show')) return
      if (event.key === 'Escape') this.close()
      else if (event.key === 'Tab') {
        event.preventDefault()
        this.closeButton.focus()
      }
    })
  }

  open(): void {
    const active = document.activeElement as { focus?: () => void } | null
    this.returnFocus = active
    this.backdrop.hidden = false
    this.backdrop.setAttribute('aria-hidden', 'false')
    this.backdrop.classList.add('show')
    this.closeButton.focus()
  }

  close(): void {
    this.backdrop.classList.remove('show')
    this.backdrop.hidden = true
    this.backdrop.setAttribute('aria-hidden', 'true')
    try {
      localStorage.setItem(WHATS_NEW_KEY, '1')
    } catch {
      // Storage may be unavailable in private browsing; play remains available.
    }
    try {
      this.returnFocus?.focus?.()
    } catch {
      // A removed opener needs no focus restoration.
    }
    this.returnFocus = null
  }

  /** Returns whether this version was opened. Callers can skip this for ?nonews tests. */
  maybeShowOnLoad(): boolean {
    let seen = false
    try {
      seen = localStorage.getItem(WHATS_NEW_KEY) !== null
    } catch {
      seen = false
    }
    if (seen) return false
    this.open()
    return true
  }
}
