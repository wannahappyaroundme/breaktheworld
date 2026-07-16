import type { RecordBookView } from '../progress/view-model'
import { profileAvatar } from '../player/avatar'
import type { ProfileCardView } from '../player/types'
import {
  createSettingsSection,
  type RecordBookSettingChange,
  type RecordBookSettingsState,
} from './settings'

export interface RecordBookCallbacks {
  onTitleChange: (title: string | null) => void
  onSkinChange: (
    characterId: 'cinnamoroll' | 'ditto',
    skinId: 'default' | 'classic'
  ) => void
  onSettingChange: (change: RecordBookSettingChange) => void
  onOpenProfile?: (trigger: HTMLButtonElement) => void
  onClose?: () => void
}

const HIDDEN_PROFILE: ProfileCardView = { visible: false, kind: 'hidden' }

let recordBookId = 0

function textElement(
  doc: Document,
  tag: keyof HTMLElementTagNameMap,
  text: string,
  className?: string
): HTMLElement {
  const element = doc.createElement(tag)
  if (className) element.className = className
  element.textContent = text
  return element
}

function dataSection(doc: Document, heading: string): HTMLElement {
  const section = doc.createElement('section')
  section.className = 'recordbook-section'
  section.setAttribute('data-recordbook-section', heading)
  section.appendChild(textElement(doc, 'h3', heading))
  return section
}

/** Accessible, text-only record-book bottom sheet. It never reads storage or progress rules. */
export class RecordBook {
  private readonly doc: Document
  private readonly backdrop: HTMLDivElement
  private readonly sheet: HTMLDivElement
  private readonly scroll: HTMLDivElement
  private readonly closeButton: HTMLButtonElement
  private previousFocus: HTMLElement | null = null
  private openState = false

  constructor(
    parent: HTMLElement,
    view: RecordBookView,
    settings: RecordBookSettingsState,
    private readonly callbacks: RecordBookCallbacks,
    profile: ProfileCardView = HIDDEN_PROFILE,
  ) {
    this.doc = parent.ownerDocument ?? document
    const headingId = `recordbook-heading-${++recordBookId}`

    this.backdrop = this.doc.createElement('div')
    this.backdrop.className = 'recordbook-backdrop'
    this.backdrop.hidden = true
    this.backdrop.setAttribute('aria-hidden', 'true')

    this.sheet = this.doc.createElement('div')
    this.sheet.className = 'recordbook-sheet'
    this.sheet.setAttribute('role', 'dialog')
    this.sheet.setAttribute('aria-modal', 'true')
    this.sheet.setAttribute('aria-labelledby', headingId)

    const header = this.doc.createElement('header')
    header.className = 'recordbook-header'
    const heading = textElement(this.doc, 'h2', '📖 기록책')
    heading.id = headingId
    this.closeButton = this.doc.createElement('button')
    this.closeButton.type = 'button'
    this.closeButton.className = 'recordbook-close'
    this.closeButton.textContent = '닫기'
    this.closeButton.setAttribute('aria-label', '기록책 닫기')
    this.closeButton.addEventListener('click', () => this.close())
    header.append(heading, this.closeButton)

    this.scroll = this.doc.createElement('div')
    this.scroll.className = 'recordbook-scroll'
    this.sheet.append(header, this.scroll)
    this.backdrop.appendChild(this.sheet)
    parent.appendChild(this.backdrop)

    this.backdrop.addEventListener('click', (event) => {
      event.stopPropagation()
      if (event.target === this.backdrop) this.close()
    })
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      this.backdrop.addEventListener(type, (event) => event.stopPropagation(), { passive: true })
      this.sheet.addEventListener(type, (event) => event.stopPropagation(), { passive: true })
    }
    this.sheet.addEventListener('click', (event) => event.stopPropagation())

    this.render(view, settings, profile)
  }

  get isOpen(): boolean {
    return this.openState
  }

  render(
    view: RecordBookView,
    settings: RecordBookSettingsState,
    profile: ProfileCardView = HIDDEN_PROFILE,
  ): void {
    const active = this.doc.activeElement as HTMLElement | null
    const focusKey = active && this.scroll.contains(active)
      ? (['data-recordbook-profile', 'data-title', 'data-skin', 'data-setting'] as const)
        .map((attribute) => ({ attribute, value: active.getAttribute(attribute) }))
        .find(({ value }) => value !== null) ?? null
      : null
    const profileCard = this.renderProfile(profile)
    this.scroll.replaceChildren(
      ...(profileCard ? [profileCard] : []),
      this.renderDaily(view),
      this.renderAchievements(view),
      this.renderSkins(view),
      this.renderStats(view),
      createSettingsSection(this.doc, settings, this.callbacks.onSettingChange)
    )
    if (focusKey) {
      const replacement = Array.from(this.scroll.querySelectorAll<HTMLElement>('button'))
        .find((button) => button.getAttribute(focusKey.attribute) === focusKey.value)
      replacement?.focus()
    }
  }

  private renderProfile(profile: ProfileCardView): HTMLButtonElement | null {
    if (!profile.visible) return null
    const button = this.doc.createElement('button')
    button.type = 'button'
    button.className = `recordbook-profile ${profile.kind}`
    button.setAttribute('data-recordbook-profile', profile.kind)
    button.setAttribute('aria-label', '프로필 열기')

    const avatar = textElement(this.doc, 'span', 'G', 'recordbook-profile-avatar')
    avatar.setAttribute('aria-hidden', 'true')
    const copy = this.doc.createElement('span')
    copy.className = 'recordbook-profile-copy'

    if (profile.kind === 'guest') {
      copy.append(
        textElement(this.doc, 'strong', profile.title),
        textElement(this.doc, 'span', profile.detail),
      )
    } else {
      const model = profileAvatar(profile.userId, profile.displayName)
      avatar.textContent = model.initial
      avatar.setAttribute('style', `background-color:${model.color}`)
      const detail = {
        saved: '기록이 저장됐어요',
        saving: '기록을 저장하는 중이에요',
        offline: '연결되면 기록을 저장해요',
        retry: '기록 저장을 다시 확인해 주세요',
      }[profile.sync]
      copy.append(
        textElement(this.doc, 'strong', profile.displayName),
        textElement(this.doc, 'span', detail),
      )
    }
    button.append(avatar, copy, textElement(this.doc, 'span', '›', 'recordbook-profile-arrow'))
    button.addEventListener('click', () => this.callbacks.onOpenProfile?.(button))
    return button
  }

  setGamificationVisible(visible: boolean): void {
    const sections = Array.from(
      this.scroll.querySelectorAll<HTMLElement>('[data-recordbook-section]')
    ).filter((section) => {
      const name = section.getAttribute('data-recordbook-section')
      return name === '오늘의 도전' || name === '부순 기록'
    })
    const active = this.doc.activeElement as HTMLElement | null
    const hidesFocusedControl = !visible
      && active !== null
      && sections.some((section) => section.contains(active))
    if (hidesFocusedControl && this.openState) this.closeButton.focus()
    for (const section of sections) section.hidden = !visible
  }

  open(): void {
    if (this.openState) return
    const active = this.doc.activeElement as HTMLElement | null
    this.previousFocus = active && typeof active.focus === 'function' ? active : null
    this.openState = true
    this.backdrop.hidden = false
    this.backdrop.setAttribute('aria-hidden', 'false')
    this.backdrop.classList.add('show')
    this.doc.addEventListener('keydown', this.onKeyDown)
    this.closeButton.focus()
  }

  close(): void {
    if (!this.openState) return
    this.openState = false
    this.backdrop.classList.remove('show')
    this.backdrop.hidden = true
    this.backdrop.setAttribute('aria-hidden', 'true')
    this.doc.removeEventListener('keydown', this.onKeyDown)
    this.previousFocus?.focus()
    this.previousFocus = null
    this.callbacks.onClose?.()
  }

  destroy(): void {
    this.close()
    this.backdrop.remove()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.openState) return
    if (event.key === 'Escape') {
      event.preventDefault()
      this.close()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(this.sheet.querySelectorAll<HTMLButtonElement>('button'))
      .filter((button) => !button.disabled && !button.hidden)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const current = this.doc.activeElement
    if (event.shiftKey && (current === first || !this.sheet.contains(current))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (current === last || !this.sheet.contains(current))) {
      event.preventDefault()
      first.focus()
    }
  }

  private renderDaily(view: RecordBookView): HTMLElement {
    const section = dataSection(this.doc, view.daily.heading)
    const card = this.doc.createElement('div')
    card.className = 'recordbook-card recordbook-daily'
    card.append(
      textElement(
        this.doc,
        'p',
        view.daily.copy.trim() || '오늘의 도전을 열면 바로 시작할 수 있어요',
        'recordbook-primary-copy'
      ),
      textElement(this.doc, 'p', view.daily.progressText, 'recordbook-progress'),
      textElement(
        this.doc,
        'span',
        view.daily.complete ? '도장 받음' : '도전 중',
        `recordbook-stamp${view.daily.complete ? ' complete' : ''}`
      )
    )
    section.appendChild(card)
    return section
  }

  private renderAchievements(view: RecordBookView): HTMLElement {
    const section = dataSection(this.doc, view.achievements.heading)
    if (view.achievements.items.length === 0) {
      section.appendChild(textElement(
        this.doc,
        'p',
        '첫 기록을 만들면 여기에 도장이 생겨요',
        'recordbook-empty'
      ))
      return section
    }

    const list = this.doc.createElement('div')
    list.className = 'recordbook-list'
    for (const item of view.achievements.items) {
      const card = this.doc.createElement('article')
      card.className = `recordbook-card achievement${item.complete ? ' complete' : ' locked'}`
      card.append(
        textElement(this.doc, 'h4', item.name),
        textElement(this.doc, 'p', `${item.progress} / ${item.target}`, 'recordbook-progress'),
        textElement(
          this.doc,
          'p',
          item.complete ? (item.seen ? '완료' : '새 기록') : `다음: ${item.next}`,
          'recordbook-state'
        )
      )
      if (item.selectableTitle) {
        const selected = view.selectedTitle === item.selectableTitle
        const button = this.doc.createElement('button')
        button.type = 'button'
        button.className = 'recordbook-title-choice'
        button.textContent = selected ? '대표 기록 선택됨' : '대표 기록으로 선택'
        button.setAttribute('aria-pressed', String(selected))
        button.setAttribute('data-title', item.selectableTitle)
        button.addEventListener('click', () => {
          this.callbacks.onTitleChange(selected ? null : item.selectableTitle)
        })
        card.appendChild(button)
      }
      list.appendChild(card)
    }
    section.appendChild(list)
    return section
  }

  private renderSkins(view: RecordBookView): HTMLElement {
    const section = dataSection(this.doc, view.skins.heading)
    if (view.skins.items.length === 0) {
      section.appendChild(textElement(
        this.doc,
        'p',
        '캐릭터를 만나면 모습을 골라볼 수 있어요',
        'recordbook-empty'
      ))
      return section
    }

    for (const item of view.skins.items) {
      const group = this.doc.createElement('div')
      group.className = 'recordbook-card recordbook-skin'
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', `${item.name} 모습`)
      group.appendChild(textElement(this.doc, 'h4', item.name))
      const choices = this.doc.createElement('div')
      choices.className = 'recordbook-choice-row'
      for (const choice of item.choices) {
        const button = this.doc.createElement('button')
        button.type = 'button'
        button.className = 'recordbook-choice'
        button.textContent = choice.label
        button.setAttribute('aria-pressed', String(choice.selected))
        button.setAttribute('data-skin', `${item.id}:${choice.id}`)
        button.addEventListener('click', () => this.callbacks.onSkinChange(item.id, choice.id))
        choices.appendChild(button)
      }
      group.appendChild(choices)
      section.appendChild(group)
    }
    return section
  }

  private renderStats(view: RecordBookView): HTMLElement {
    const section = dataSection(this.doc, view.stats.heading)
    if (view.stats.items.length === 0) {
      section.appendChild(textElement(
        this.doc,
        'p',
        '한 번 부수면 내 기록이 여기에 쌓여요',
        'recordbook-empty'
      ))
      return section
    }

    const list = this.doc.createElement('dl')
    list.className = 'recordbook-stats'
    for (const item of view.stats.items) {
      const row = this.doc.createElement('div')
      row.append(
        textElement(this.doc, 'dt', item.label),
        textElement(this.doc, 'dd', item.value)
      )
      list.appendChild(row)
    }
    section.appendChild(list)
    return section
  }
}
