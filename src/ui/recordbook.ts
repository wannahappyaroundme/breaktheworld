import type {
  AchievementCardView,
  AchievementCategoryFilter,
  AchievementStatusFilter,
  HubTab,
  RecordBookView,
} from '../progress/view-model'
import type { ProfileFrameId, RecordBookThemeId } from '../progress/types'
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
  onTabChange?: (tab: HubTab) => void
  onFilterChange?: (filter: {
    category: AchievementCategoryFilter
    status: AchievementStatusFilter
  }) => void
  onFrameChange?: (frameId: ProfileFrameId) => void
  onThemeChange?: (themeId: RecordBookThemeId) => void
  onOpenProfile?: (trigger: HTMLButtonElement) => void
  onClose?: () => void
}

const HIDDEN_PROFILE: ProfileCardView = { visible: false, kind: 'hidden' }

const HUB_TABS: ReadonlyArray<{ id: HubTab; label: string }> = [
  { id: 'home', label: '홈' },
  { id: 'achievements', label: '업적' },
  { id: 'cosmetics', label: '꾸미기' },
  { id: 'settings', label: '설정' },
]

function isGamificationTab(tab: HubTab): boolean {
  return tab === 'achievements'
}

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

function progressElement(
  doc: Document,
  label: string,
  value: number,
  max: number,
  className?: string
): HTMLProgressElement {
  const progress = doc.createElement('progress')
  if (className) progress.className = className
  progress.max = Math.max(1, max)
  progress.value = Math.min(Math.max(0, value), progress.max)
  progress.setAttribute('max', String(progress.max))
  progress.setAttribute('value', String(progress.value))
  progress.setAttribute('aria-label', label)
  return progress
}

function panel(doc: Document, id: string, labelledBy: string, tab: HubTab): HTMLElement {
  const section = doc.createElement('section')
  section.id = id
  section.className = `recordbook-panel recordbook-panel-${tab}`
  section.setAttribute('role', 'tabpanel')
  section.setAttribute('aria-labelledby', labelledBy)
  section.setAttribute('data-hub-panel', tab)
  return section
}

function isVisibleControl(control: HTMLElement, boundary: HTMLElement): boolean {
  let current: HTMLElement | null = control
  while (current && current !== boundary) {
    if (current.hidden) return false
    current = current.parentElement
  }
  return true
}

/** One accessible full-screen record-book hub. It never reads storage or progress rules. */
export class RecordBook {
  private readonly doc: Document
  private readonly backdrop: HTMLDivElement
  private readonly sheet: HTMLDivElement
  private readonly tabs: HTMLElement
  private readonly scroll: HTMLDivElement
  private readonly closeButton: HTMLButtonElement
  private readonly headingMeta: HTMLElement
  private readonly instanceId: number
  private previousFocus: HTMLElement | null = null
  private openState = false
  private activeTab: HubTab = 'home'
  private categoryFilter: AchievementCategoryFilter = 'all'
  private statusFilter: AchievementStatusFilter = 'all'
  private gamificationVisible = true
  private level = 1
  private profileStatus = '이 기기 기록'
  private recordBookThemeId: RecordBookThemeId = 'default'

  constructor(
    parent: HTMLElement,
    view: RecordBookView,
    settings: RecordBookSettingsState,
    private readonly callbacks: RecordBookCallbacks,
    profile: ProfileCardView = HIDDEN_PROFILE,
  ) {
    this.doc = parent.ownerDocument ?? document
    this.instanceId = ++recordBookId
    const headingId = `recordbook-heading-${this.instanceId}`

    this.backdrop = this.doc.createElement('div')
    this.backdrop.className = 'recordbook-backdrop'
    this.backdrop.hidden = true
    this.backdrop.setAttribute('aria-hidden', 'true')
    this.backdrop.setAttribute('data-recordbook-backdrop', 'hit-area')

    this.sheet = this.doc.createElement('div')
    this.sheet.className = 'recordbook-sheet'
    this.sheet.setAttribute('role', 'dialog')
    this.sheet.setAttribute('aria-modal', 'true')
    this.sheet.setAttribute('aria-labelledby', headingId)

    const header = this.doc.createElement('header')
    header.className = 'recordbook-header'
    const title = this.doc.createElement('div')
    title.className = 'recordbook-heading'
    const heading = textElement(this.doc, 'h2', '기록책')
    heading.id = headingId
    this.headingMeta = textElement(this.doc, 'p', '', 'recordbook-heading-meta')
    title.append(heading, this.headingMeta)
    this.closeButton = this.doc.createElement('button')
    this.closeButton.type = 'button'
    this.closeButton.className = 'recordbook-close'
    this.closeButton.textContent = '닫기'
    this.closeButton.setAttribute('aria-label', '기록책 닫기')
    this.closeButton.addEventListener('click', () => this.close())
    header.append(title, this.closeButton)

    this.tabs = this.doc.createElement('div')
    this.tabs.className = 'recordbook-tabs'
    this.tabs.setAttribute('role', 'tablist')
    this.tabs.setAttribute('aria-label', '기록책 메뉴')

    this.scroll = this.doc.createElement('div')
    this.scroll.className = 'recordbook-scroll'
    this.sheet.append(header, this.tabs, this.scroll)
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
    const focusKey = active && this.sheet.contains(active)
      ? ([
          'data-hub-tab',
          'data-achievement-category-filter',
          'data-achievement-status-filter',
          'data-recordbook-profile',
          'data-title',
          'data-frame',
          'data-theme',
          'data-skin',
          'data-setting',
        ] as const)
        .map((attribute) => ({ attribute, value: active.getAttribute(attribute) }))
        .find(({ value }) => value !== null) ?? null
      : null
    this.level = view.summary.level
    this.profileStatus = profile.visible
      ? profile.kind === 'guest' ? '게스트' : profile.displayName
      : '이 기기 기록'
    this.recordBookThemeId = view.profile.recordBookThemeId
    this.updatePresentation()

    this.tabs.replaceChildren(...this.renderTabs())
    this.scroll.replaceChildren(
      this.renderHome(view),
      this.renderAchievements(view),
      this.renderCosmetics(view),
      this.renderSettings(settings, profile),
    )
    this.updateTabs()
    this.updateAchievementFilters(false)
    this.applyGamificationVisibility()

    if (focusKey) {
      const replacement = Array.from(this.sheet.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.getAttribute(focusKey.attribute) === focusKey.value)
      if (replacement && !replacement.disabled && isVisibleControl(replacement, this.sheet)) {
        replacement.focus()
      }
    }
  }

  setGamificationVisible(visible: boolean): void {
    const active = this.doc.activeElement as HTMLElement | null
    const focusedTab = (active?.getAttribute('data-hub-tab') ?? null) as HubTab | null
    const focusedGatedControl = active !== null && (
      (focusedTab !== null && isGamificationTab(focusedTab))
      || Array.from(this.sheet.querySelectorAll<HTMLElement>('[data-gamification]'))
        .some((section) => section.contains(active))
    )
    const activeTabBecomesGated = !visible && isGamificationTab(this.activeTab)
    this.gamificationVisible = visible
    if (activeTabBecomesGated) {
      this.activeTab = 'home'
      this.scroll.scrollTop = 0
    }
    this.updatePresentation()
    this.updateTabs()
    this.applyGamificationVisibility()
    if (!visible && this.openState && (activeTabBecomesGated || focusedGatedControl)) {
      this.tabs.querySelector<HTMLElement>('[data-hub-tab="home"]')?.focus()
    }
  }

  open(trigger?: HTMLElement): void {
    if (this.openState) return
    const active = trigger ?? this.doc.activeElement as HTMLElement | null
    this.previousFocus = active && typeof active.focus === 'function' ? active : null
    this.activeTab = 'home'
    this.scroll.scrollTop = 0
    this.updateTabs()
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
      .filter((button) => (
        !button.disabled
        && !button.hidden
        && isVisibleControl(button, this.sheet)
        && button.getAttribute('tabindex') !== '-1'
      ))
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

  private renderTabs(): HTMLButtonElement[] {
    return HUB_TABS.map(({ id, label }, index) => {
      const button = this.doc.createElement('button')
      button.type = 'button'
      button.id = `recordbook-tab-${this.instanceId}-${id}`
      button.className = 'recordbook-tab'
      button.textContent = label
      button.setAttribute('role', 'tab')
      button.setAttribute('data-hub-tab', id)
      button.setAttribute('aria-controls', `recordbook-panel-${this.instanceId}-${id}`)
      button.addEventListener('click', () => this.changeTab(id))
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const enabledTabs = HUB_TABS.filter((tab) => (
          this.gamificationVisible || !isGamificationTab(tab.id)
        ))
        const current = enabledTabs.findIndex((tab) => tab.id === id)
        const nextIndex = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabledTabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + enabledTabs.length)
              % enabledTabs.length
        const next = enabledTabs[nextIndex]
        this.changeTab(next.id)
        this.tabs.querySelector<HTMLElement>(`[data-hub-tab="${next.id}"]`)?.focus()
      })
      if (index > 0) button.setAttribute('tabindex', '-1')
      return button
    })
  }

  private changeTab(tab: HubTab): void {
    if (isGamificationTab(tab) && !this.gamificationVisible) return
    this.activeTab = tab
    this.scroll.scrollTop = 0
    this.updateTabs()
    this.callbacks.onTabChange?.(tab)
  }

  private updateTabs(): void {
    for (const button of this.tabs.querySelectorAll<HTMLButtonElement>('[data-hub-tab]')) {
      const id = button.getAttribute('data-hub-tab') as HubTab
      const selected = id === this.activeTab
      button.setAttribute('aria-selected', String(selected))
      button.setAttribute('tabindex', selected ? '0' : '-1')
      button.disabled = isGamificationTab(id) && !this.gamificationVisible
    }
    for (const currentPanel of this.scroll.querySelectorAll<HTMLElement>('[data-hub-panel]')) {
      currentPanel.hidden = currentPanel.getAttribute('data-hub-panel') !== this.activeTab
    }
  }

  private renderHome(view: RecordBookView): HTMLElement {
    const home = panel(
      this.doc,
      `recordbook-panel-${this.instanceId}-home`,
      `recordbook-tab-${this.instanceId}-home`,
      'home'
    )
    const hero = this.doc.createElement('section')
    hero.className = 'recordbook-hero recordbook-paper-card'
    hero.setAttribute('data-gamification', '')
    hero.setAttribute('aria-labelledby', `recordbook-level-${this.instanceId}`)
    const level = textElement(this.doc, 'h3', `LV ${view.summary.level}`)
    level.id = `recordbook-level-${this.instanceId}`
    const maxLevel = view.summary.level === 20
    hero.append(
      textElement(this.doc, 'p', '업적으로 경험치를 모아 기록책을 꾸며보세요', 'recordbook-kicker'),
      level,
      textElement(this.doc, 'strong', `${view.summary.xp} 경험치`, 'recordbook-xp'),
      progressElement(
        this.doc,
        `레벨 ${view.summary.level} 경험치`,
        maxLevel ? 1 : view.summary.xp - view.summary.currentLevelXp,
        maxLevel ? 1 : view.summary.nextLevelXp - view.summary.currentLevelXp,
        'recordbook-progress-bar recordbook-xp-bar'
      ),
      textElement(
        this.doc,
        'p',
        maxLevel
          ? '최고 레벨을 달성했어요'
          : `다음 레벨: ${view.summary.nextLevelXp} 경험치, ${
              view.summary.nextLevelXp - view.summary.xp
            } 경험치 남았어요`,
        'recordbook-help'
      )
    )

    const completion = this.doc.createElement('section')
    completion.className = 'recordbook-paper-card recordbook-completion'
    completion.setAttribute('data-gamification', '')
    completion.append(
      textElement(this.doc, 'h3', '전체 업적'),
      textElement(this.doc, 'strong', view.summary.completionText, 'recordbook-completion-number'),
      progressElement(
        this.doc,
        '전체 업적 완료율',
        view.summary.completed,
        view.summary.total,
        'recordbook-progress-bar'
      ),
      textElement(
        this.doc,
        'p',
        view.summary.completed === view.summary.total
          ? '32개 업적을 모두 완성했어요. 받은 꾸미기를 골라보세요'
          : '모든 조건과 보상을 업적 화면에서 볼 수 있어요',
        'recordbook-help'
      )
    )

    const daily = this.renderDaily(view)
    daily.setAttribute('data-gamification', '')
    const nearest = this.doc.createElement('section')
    nearest.className = 'recordbook-home-section'
    nearest.setAttribute('data-gamification', '')
    nearest.appendChild(textElement(this.doc, 'h3', '곧 달성할 업적'))
    if (view.summary.nearest.length === 0) {
      nearest.appendChild(textElement(
        this.doc,
        'p',
        '모든 업적을 완성했어요. 꾸미기에서 받은 보상을 골라보세요',
        'recordbook-empty'
      ))
    } else {
      const list = this.doc.createElement('div')
      list.className = 'recordbook-nearest-list'
      for (const item of view.summary.nearest) list.appendChild(this.renderCompactAchievement(item))
      nearest.appendChild(list)
    }

    const recent = this.doc.createElement('section')
    recent.className = 'recordbook-home-section'
    recent.setAttribute('data-gamification', '')
    recent.appendChild(textElement(this.doc, 'h3', '최근 보상'))
    recent.appendChild(textElement(
      this.doc,
      'p',
      view.summary.recent?.copy
        ?? (view.summary.completed === 0
          ? '첫 공격부터 업적과 경험치가 쌓여요'
          : '새 업적을 달성하면 받은 경험치를 여기서 볼 수 있어요'),
      `recordbook-paper-card recordbook-recent${view.summary.recent ? ' has-reward' : ''}`
    ))

    home.append(hero, completion, daily, nearest, recent, this.renderStats(view))
    return home
  }

  private renderDaily(view: RecordBookView): HTMLElement {
    const section = this.doc.createElement('section')
    section.className = 'recordbook-home-section'
    section.setAttribute('data-recordbook-section', view.daily.heading)
    section.appendChild(textElement(this.doc, 'h3', view.daily.heading))
    const card = this.doc.createElement('div')
    card.className = 'recordbook-paper-card recordbook-daily'
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

  private renderCompactAchievement(item: AchievementCardView): HTMLElement {
    const card = this.doc.createElement('article')
    card.className = `recordbook-paper-card recordbook-nearest tier-${item.tier}`
    card.append(
      textElement(this.doc, 'span', item.icon, 'recordbook-achievement-icon'),
      textElement(this.doc, 'h4', item.name),
      textElement(this.doc, 'p', item.description, 'recordbook-condition'),
      progressElement(
        this.doc,
        `${item.name} 진행도`,
        item.progress,
        item.target,
        'recordbook-progress-bar'
      ),
      textElement(this.doc, 'p', item.progressText, 'recordbook-progress')
    )
    return card
  }

  private renderAchievements(view: RecordBookView): HTMLElement {
    const achievements = panel(
      this.doc,
      `recordbook-panel-${this.instanceId}-achievements`,
      `recordbook-tab-${this.instanceId}-achievements`,
      'achievements'
    )
    achievements.setAttribute('data-gamification', '')
    const intro = this.doc.createElement('header')
    intro.className = 'recordbook-panel-intro'
    intro.append(
      textElement(this.doc, 'h3', `${view.achievements.heading} ${view.achievements.items.length}개`),
      textElement(this.doc, 'p', '잠긴 업적도 조건과 경험치를 처음부터 볼 수 있어요')
    )

    const categoryFilters = this.doc.createElement('div')
    categoryFilters.className = 'recordbook-filter-row recordbook-category-filters'
    categoryFilters.setAttribute('role', 'group')
    categoryFilters.setAttribute('aria-label', '업적 분야')
    for (const item of view.achievements.categories) {
      const button = this.filterButton(item.label, item.id === this.categoryFilter)
      button.setAttribute('data-achievement-category-filter', item.id)
      button.addEventListener('click', () => {
        if (!this.gamificationVisible) return
        this.categoryFilter = item.id
        this.updateAchievementFilters(true)
      })
      categoryFilters.appendChild(button)
    }

    const statusFilters = this.doc.createElement('div')
    statusFilters.className = 'recordbook-filter-row recordbook-status-filters'
    statusFilters.setAttribute('role', 'group')
    statusFilters.setAttribute('aria-label', '업적 상태')
    for (const item of view.achievements.statuses) {
      const button = this.filterButton(item.label, item.id === this.statusFilter)
      button.setAttribute('data-achievement-status-filter', item.id)
      button.addEventListener('click', () => {
        if (!this.gamificationVisible) return
        this.statusFilter = item.id
        this.updateAchievementFilters(true)
      })
      statusFilters.appendChild(button)
    }

    const list = this.doc.createElement('div')
    list.className = 'recordbook-achievement-list'
    for (const item of view.achievements.items) list.appendChild(this.renderAchievement(item))
    const count = textElement(this.doc, 'p', '', 'recordbook-filter-count')
    count.setAttribute('role', 'status')
    count.setAttribute('aria-live', 'polite')
    count.setAttribute('data-achievement-filter-count', '')
    const empty = textElement(
      this.doc,
      'p',
      '이 조건에 맞는 업적은 없어요. 다른 필터를 골라보세요',
      'recordbook-filter-empty'
    )
    empty.hidden = true
    empty.setAttribute('data-achievement-filter-empty', '')
    achievements.append(intro, categoryFilters, statusFilters, count, list, empty)
    return achievements
  }

  private filterButton(label: string, selected: boolean): HTMLButtonElement {
    const button = this.doc.createElement('button')
    button.type = 'button'
    button.className = 'recordbook-filter'
    button.textContent = label
    button.setAttribute('aria-pressed', String(selected))
    return button
  }

  private renderAchievement(item: AchievementCardView): HTMLElement {
    const card = this.doc.createElement('article')
    card.className = `recordbook-paper-card recordbook-achievement tier-${item.tier}${
      item.complete ? ' complete' : ' locked'
    }`
    card.setAttribute('data-achievement-id', item.id)
    card.setAttribute('data-achievement-category', item.category)
    card.setAttribute('data-achievement-status', item.complete ? 'complete' : 'active')

    const title = this.doc.createElement('div')
    title.className = 'recordbook-achievement-title'
    const icon = textElement(this.doc, 'span', item.icon, 'recordbook-achievement-icon')
    icon.setAttribute('aria-hidden', 'true')
    title.append(icon, textElement(this.doc, 'h4', item.name))
    const tier = textElement(
      this.doc,
      'span',
      item.tierLabel,
      `recordbook-tier tier-${item.tier}`
    )
    card.append(
      title,
      tier,
      textElement(this.doc, 'p', item.description, 'recordbook-condition'),
      progressElement(
        this.doc,
        `${item.name} 진행도`,
        item.progress,
        item.target,
        'recordbook-progress-bar'
      ),
      textElement(this.doc, 'p', item.progressText, 'recordbook-progress'),
      textElement(this.doc, 'p', `경험치 +${item.xp}`, 'recordbook-xp-reward')
    )
    if (item.titleReward) {
      card.appendChild(textElement(
        this.doc,
        'p',
        `칭호 보상: ${item.name}`,
        'recordbook-title-reward'
      ))
    }
    card.appendChild(textElement(
      this.doc,
      'p',
      item.complete ? (item.seen ? '완료' : '새 업적') : `다음: ${item.description}`,
      'recordbook-state'
    ))
    return card
  }

  private updateAchievementFilters(notify: boolean): void {
    const cards = Array.from(
      this.scroll.querySelectorAll<HTMLElement>('[data-achievement-id]')
    )
    let visible = 0
    for (const card of cards) {
      const categoryMatches = this.categoryFilter === 'all'
        || card.getAttribute('data-achievement-category') === this.categoryFilter
      const statusMatches = this.statusFilter === 'all'
        || card.getAttribute('data-achievement-status') === this.statusFilter
      card.hidden = !(categoryMatches && statusMatches)
      if (!card.hidden) visible += 1
    }
    for (const button of this.scroll.querySelectorAll<HTMLButtonElement>(
      '[data-achievement-category-filter]'
    )) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-achievement-category-filter') === this.categoryFilter)
      )
    }
    for (const button of this.scroll.querySelectorAll<HTMLButtonElement>(
      '[data-achievement-status-filter]'
    )) {
      button.setAttribute(
        'aria-pressed',
        String(button.getAttribute('data-achievement-status-filter') === this.statusFilter)
      )
    }
    const empty = this.scroll.querySelector<HTMLElement>('[data-achievement-filter-empty]')
    if (empty) empty.hidden = visible !== 0
    const count = this.scroll.querySelector<HTMLElement>('[data-achievement-filter-count]')
    if (count) count.textContent = `${visible}개 업적 표시`
    if (notify) {
      this.callbacks.onFilterChange?.({
        category: this.categoryFilter,
        status: this.statusFilter,
      })
    }
  }

  private renderCosmetics(view: RecordBookView): HTMLElement {
    const cosmetics = panel(
      this.doc,
      `recordbook-panel-${this.instanceId}-cosmetics`,
      `recordbook-tab-${this.instanceId}-cosmetics`,
      'cosmetics'
    )
    const intro = this.doc.createElement('header')
    intro.className = 'recordbook-panel-intro'
    intro.append(
      textElement(this.doc, 'h3', view.cosmetics.heading),
      textElement(this.doc, 'p', '업적과 레벨로 받은 모습을 골라보세요')
    )
    cosmetics.append(
      intro,
      this.renderTitles(view),
      this.renderFrames(view),
      this.renderThemes(view),
      this.renderSkins(view),
    )
    return cosmetics
  }

  private cosmeticSection(heading: string, copy: string): HTMLElement {
    const section = this.doc.createElement('section')
    section.className = 'recordbook-cosmetic-section'
    section.append(
      textElement(this.doc, 'h3', heading),
      textElement(this.doc, 'p', copy, 'recordbook-help')
    )
    return section
  }

  private renderTitles(view: RecordBookView): HTMLElement {
    const section = this.cosmeticSection('대표 칭호', '프로필과 기록 카드에 보여줄 이름이에요')
    section.setAttribute('data-gamification', '')
    const choices = this.doc.createElement('div')
    choices.className = 'recordbook-cosmetic-grid'
    for (const choice of view.cosmetics.titles) {
      const button = this.cosmeticButton(choice.name, choice.requirement, choice.selected, choice.unlocked)
      button.setAttribute('data-title', choice.name)
      if (choice.unlocked) {
        button.addEventListener('click', () => {
          if (this.gamificationVisible) {
            this.callbacks.onTitleChange(choice.selected ? null : choice.name)
          }
        })
      }
      choices.appendChild(button)
    }
    if (
      view.profile.selectedTitle
      && !view.cosmetics.titles.some(({ name }) => name === view.profile.selectedTitle)
    ) {
      const legacy = this.cosmeticButton(
        view.profile.selectedTitle,
        '현재 사용 중인 칭호예요',
        true,
        true
      )
      legacy.setAttribute('data-title', view.profile.selectedTitle)
      legacy.addEventListener('click', () => {
        if (this.gamificationVisible) this.callbacks.onTitleChange(null)
      })
      choices.prepend(legacy)
    }
    section.appendChild(choices)
    return section
  }

  private renderFrames(view: RecordBookView): HTMLElement {
    const section = this.cosmeticSection('프로필·기록 카드 테두리', '기본 테두리와 레벨 보상 4개가 있어요')
    section.setAttribute('data-gamification', '')
    const choices = this.doc.createElement('div')
    choices.className = 'recordbook-cosmetic-grid'
    for (const choice of view.cosmetics.frames) {
      const button = this.cosmeticButton(choice.name, choice.requirement, choice.selected, choice.unlocked)
      button.setAttribute('data-frame', choice.id)
      if (choice.unlocked) {
        button.addEventListener('click', () => {
          if (this.gamificationVisible) this.callbacks.onFrameChange?.(choice.id)
        })
      }
      choices.appendChild(button)
    }
    section.appendChild(choices)
    return section
  }

  private renderThemes(view: RecordBookView): HTMLElement {
    const section = this.cosmeticSection('기록책 색', '기본 색과 레벨 보상 3개가 있어요')
    section.setAttribute('data-gamification', '')
    const choices = this.doc.createElement('div')
    choices.className = 'recordbook-cosmetic-grid'
    for (const choice of view.cosmetics.themes) {
      const button = this.cosmeticButton(choice.name, choice.requirement, choice.selected, choice.unlocked)
      button.setAttribute('data-theme', choice.id)
      if (choice.unlocked) {
        button.addEventListener('click', () => {
          if (this.gamificationVisible) this.callbacks.onThemeChange?.(choice.id)
        })
      }
      choices.appendChild(button)
    }
    section.appendChild(choices)
    return section
  }

  private cosmeticButton(
    name: string,
    requirement: string,
    selected: boolean,
    unlocked: boolean
  ): HTMLButtonElement {
    const button = this.doc.createElement('button')
    button.type = 'button'
    button.className = `recordbook-cosmetic${unlocked ? '' : ' locked'}`
    button.disabled = !unlocked
    button.setAttribute('aria-pressed', String(selected))
    button.append(
      textElement(this.doc, 'strong', name),
      textElement(this.doc, 'span', requirement)
    )
    return button
  }

  private renderSkins(view: RecordBookView): HTMLElement {
    const section = this.cosmeticSection('캐릭터 모습', '기존에 고른 모습은 그대로 사용할 수 있어요')
    for (const item of view.cosmetics.skins) {
      const group = this.doc.createElement('div')
      group.className = 'recordbook-paper-card recordbook-skin'
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
        button.addEventListener('click', () => {
          this.callbacks.onSkinChange(item.id, choice.id)
        })
        choices.appendChild(button)
      }
      group.appendChild(choices)
      section.appendChild(group)
    }
    return section
  }

  private renderSettings(
    settings: RecordBookSettingsState,
    profile: ProfileCardView
  ): HTMLElement {
    const settingsPanel = panel(
      this.doc,
      `recordbook-panel-${this.instanceId}-settings`,
      `recordbook-tab-${this.instanceId}-settings`,
      'settings'
    )
    const profileCard = this.renderProfile(profile)
    if (profileCard) {
      const profileSection = this.doc.createElement('section')
      profileSection.className = 'recordbook-settings-profile'
      profileSection.append(
        textElement(this.doc, 'h3', '프로필'),
        profileCard
      )
      settingsPanel.appendChild(profileSection)
    }
    settingsPanel.appendChild(
      createSettingsSection(this.doc, settings, this.callbacks.onSettingChange)
    )
    return settingsPanel
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
        offline: '연결되면 기록을 맞춰 저장해요',
        retry: '기록 저장을 다시 확인해 주세요',
        'auth-expired': '다시 로그인하면 보관한 기록을 이어서 저장해요',
        memory: '이 화면을 닫기 전까지 기록을 보관해요.',
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

  private renderStats(view: RecordBookView): HTMLElement {
    const section = this.doc.createElement('section')
    section.className = 'recordbook-home-section'
    section.setAttribute('data-recordbook-section', view.stats.heading)
    section.appendChild(textElement(this.doc, 'h3', view.stats.heading))
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

  private applyGamificationVisibility(): void {
    for (const section of this.sheet.querySelectorAll<HTMLElement>('[data-gamification]')) {
      const tab = section.getAttribute('data-hub-panel') as HubTab | null
      if (tab !== null) {
        section.hidden = !this.gamificationVisible || this.activeTab !== tab
      } else {
        section.hidden = !this.gamificationVisible
      }
    }
  }

  private updatePresentation(): void {
    this.headingMeta.textContent = this.gamificationVisible
      ? `LV ${this.level} · ${this.profileStatus}`
      : this.profileStatus
    this.sheet.setAttribute(
      'data-recordbook-theme',
      this.gamificationVisible ? this.recordBookThemeId : 'default'
    )
  }
}
