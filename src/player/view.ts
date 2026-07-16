import { normalizeProfileName, PIN_PATTERN } from '../../supabase/functions/_shared/player-contract'
import { profileAvatar } from './avatar'
import type { PlayerAccountController, PlayerAccountSnapshot, PlayerNameCheck } from './controller'
import { PLAYER_PRIVACY_NOTICE, type PlayerPrivacyNotice } from './privacy'
import type { PlayerApiResult } from './types'
import './style.css'

type ProfileScreen = 'guest' | 'create' | 'login' | 'signed' | 'force'

type ControllerPort = Pick<
  PlayerAccountController,
  | 'snapshot'
  | 'nameCheck'
  | 'editProfileName'
  | 'checkName'
  | 'create'
  | 'login'
  | 'changePin'
  | 'logout'
>

export interface PlayerProfileViewOptions {
  privacyNotice?: PlayerPrivacyNotice
  onRetrySave?: () => void | Promise<void>
}

interface InertState {
  element: HTMLElement
  inert: boolean
  inertAttribute: string | null
  ariaHidden: string | null
}

let profileHeadingId = 0

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function exactError(result: PlayerApiResult<unknown>): string {
  return result.ok ? '' : result.error.message
}

export class PlayerProfileView {
  private readonly doc: Document
  private readonly layer: HTMLDivElement
  private readonly panel: HTMLDivElement
  private readonly heading: HTMLHeadingElement
  private readonly closeButton: HTMLButtonElement
  private readonly body: HTMLDivElement
  private readonly live: HTMLParagraphElement
  private readonly privacyNotice: PlayerPrivacyNotice
  private readonly onRetrySave?: PlayerProfileViewOptions['onRetrySave']
  private snapshot: PlayerAccountSnapshot
  private screen: ProfileScreen = 'guest'
  private openState = false
  private historySentinel = false
  private returnFocus: HTMLElement | null = null
  private inertStates: InertState[] = []
  private busy = false
  private error = ''
  private composing = false
  private createForm = { profileName: '', pin: '', confirmation: '', over14: false, showPin: false }
  private loginForm = { profileName: '', pin: '', showPin: false }
  private forceForm = { pin: '', confirmation: '', showPin: false }
  private privacyExpanded = false

  constructor(
    private readonly parent: HTMLElement,
    private readonly controller: ControllerPort,
    options: PlayerProfileViewOptions = {},
  ) {
    this.doc = parent.ownerDocument ?? document
    this.snapshot = controller.snapshot
    this.privacyNotice = options.privacyNotice ?? PLAYER_PRIVACY_NOTICE
    this.onRetrySave = options.onRetrySave

    this.layer = this.doc.createElement('div')
    this.layer.className = 'player-profile-layer'
    this.layer.hidden = true
    this.layer.setAttribute('aria-hidden', 'true')

    this.panel = this.doc.createElement('div')
    this.panel.className = 'player-profile-panel'
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')
    const headingId = `player-profile-heading-${++profileHeadingId}`
    this.panel.setAttribute('aria-labelledby', headingId)

    const header = this.doc.createElement('header')
    header.className = 'player-profile-header'
    this.heading = element(this.doc, 'h1', '프로필')
    this.heading.id = headingId
    this.closeButton = element(this.doc, 'button', '닫기', 'player-profile-close')
    this.closeButton.type = 'button'
    this.closeButton.setAttribute('data-player-action', 'close')
    this.closeButton.setAttribute('aria-label', '프로필 닫기')
    this.closeButton.addEventListener('click', () => this.close())
    header.append(this.heading, this.closeButton)

    this.body = this.doc.createElement('div')
    this.body.className = 'player-profile-body'
    this.live = element(this.doc, 'p', '', 'player-profile-live')
    this.live.setAttribute('aria-live', 'polite')
    this.live.setAttribute('aria-atomic', 'true')
    this.panel.append(header, this.body, this.live)
    this.layer.appendChild(this.panel)
    this.parent.appendChild(this.layer)

    this.layer.addEventListener('click', (event) => {
      event.stopPropagation()
      if (event.target === this.layer && !this.isForced()) this.close()
    })
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
      this.layer.addEventListener(name, (event) => event.stopPropagation(), { passive: true })
    }
  }

  get isOpen(): boolean {
    return this.openState
  }

  open(trigger: HTMLElement | null): void {
    if (this.openState) {
      this.paint()
      return
    }
    this.returnFocus = trigger
    this.screen = this.snapshot.kind === 'player'
      ? (this.snapshot.forcePinChange ? 'force' : 'signed')
      : 'guest'
    this.openState = true
    this.layer.hidden = false
    this.layer.setAttribute('aria-hidden', 'false')
    this.doc.documentElement.classList.add('profile-open')
    this.makeSiblingsInert()
    this.doc.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('popstate', this.onPopState)
    this.pushHistorySentinel()
    this.paint()
    this.firstFocusable()?.focus()
  }

  close(): void {
    if (!this.openState || this.isForced()) return
    if (this.historySentinel) {
      this.historySentinel = false
      try { history.back() } catch { /* cleanup below remains authoritative */ }
    }
    this.closeInternal()
  }

  render(snapshot: PlayerAccountSnapshot): void {
    const changed = snapshot !== this.snapshot
    this.snapshot = snapshot
    if (snapshot.kind === 'player' && snapshot.forcePinChange) {
      this.screen = 'force'
      if (!this.openState) this.open(null)
      else this.paint()
      return
    }
    if (!this.openState || !changed) return
    if (snapshot.kind === 'player') this.screen = 'signed'
    else if (this.screen === 'signed' || this.screen === 'force') this.screen = 'guest'
    this.paint()
  }

  destroy(): void {
    if (this.openState) this.closeInternal()
    this.layer.remove()
  }

  private paint(): void {
    this.layer.setAttribute('data-player-screen', this.screen)
    this.closeButton.hidden = this.isForced()
    this.closeButton.disabled = this.isForced()
    this.live.textContent = this.error
    switch (this.screen) {
      case 'guest': this.renderGuest(); break
      case 'create': this.renderCreate(); break
      case 'login': this.renderLogin(); break
      case 'signed': this.renderSigned(); break
      case 'force': this.renderForcePin(); break
    }
  }

  private renderGuest(): void {
    this.heading.textContent = '프로필'
    const intro = element(
      this.doc,
      'p',
      '새 프로필에서 첫 기록부터 새로 쌓아요. 지금 게스트 기록은 이 기기에 그대로 남아요.',
      'player-profile-lead',
    )
    const create = this.actionButton('새 프로필 만들기', 'create-start', true)
    const signupEnabled = this.snapshot.kind === 'guest' && this.snapshot.signupEnabled
    create.disabled = !signupEnabled
    create.addEventListener('click', () => {
      this.error = ''
      this.screen = 'create'
      this.paint()
      this.body.querySelector<HTMLInputElement>('[data-player-field="profile-name"]')?.focus()
    })
    const login = this.actionButton('내 프로필로 로그인', 'login-start')
    login.addEventListener('click', () => {
      this.error = ''
      this.screen = 'login'
      this.paint()
      this.body.querySelector<HTMLInputElement>('[data-player-field="profile-name"]')?.focus()
    })
    const note = element(
      this.doc,
      'p',
      signupEnabled
        ? '게스트 플레이는 지금 바로 이어갈 수 있고, 로그인하면 저장을 시작해요.'
        : '프로필 만들기가 열리기 전에도 로그인할 수 있어요. 게스트 플레이는 지금 바로 이어갈 수 있어요.',
      'player-profile-note',
    )
    this.body.replaceChildren(intro, create, login, note)
  }

  private renderCreate(): void {
    this.heading.textContent = '새 프로필 만들기'
    const back = this.backButton()
    const form = this.doc.createElement('form')
    form.className = 'player-profile-form'
    form.addEventListener('submit', (event) => event.preventDefault())
    const name = this.inputField('프로필 ID', 'profile-name', 'text')
    name.input.value = this.createForm.profileName || this.controller.nameCheck.raw
    name.input.autocomplete = 'username'
    name.input.addEventListener('compositionstart', () => { this.composing = true })
    name.input.addEventListener('compositionend', () => {
      this.composing = false
      this.createForm.profileName = name.input.value
      this.controller.editProfileName(name.input.value)
      advanced.hidden = true
      updateSubmit()
    })
    name.input.addEventListener('input', (event) => {
      if (this.composing || (event as InputEvent).isComposing) return
      this.createForm.profileName = name.input.value
      this.controller.editProfileName(name.input.value)
      advanced.hidden = true
      updateSubmit()
    })
    const check = this.actionButton(
      this.controller.nameCheck.status === 'checking' ? '확인하는 중' : '중복 확인',
      'check-name',
      false,
    )
    check.disabled = this.busy || this.controller.nameCheck.status === 'checking'
    const checkState = element(this.doc, 'p', this.nameCheckCopy(this.controller.nameCheck), 'player-profile-field-state')
    checkState.setAttribute('aria-live', 'polite')

    const advanced = this.doc.createElement('div')
    advanced.className = 'player-profile-create-fields'
    const available = this.controller.nameCheck.status === 'available'
    advanced.hidden = !available
    const zeroCopy = element(
      this.doc,
      'p',
      '새 프로필은 기록 0부터 시작해요. 게스트 기록은 이 기기에 그대로 남아요.',
      'player-profile-note',
    )
    const pin = this.inputField('PIN 숫자 6자리', 'pin', this.createForm.showPin ? 'text' : 'password')
    const confirmation = this.inputField('PIN 다시 입력', 'pin-confirmation', this.createForm.showPin ? 'text' : 'password')
    pin.input.value = this.createForm.pin
    confirmation.input.value = this.createForm.confirmation
    this.configurePin(pin.input)
    this.configurePin(confirmation.input)
    const show = this.actionButton(this.createForm.showPin ? 'PIN 숨기기' : 'PIN 보기', 'show-pin', false)
    show.addEventListener('click', () => {
      this.createForm.showPin = !this.createForm.showPin
      pin.input.type = this.createForm.showPin ? 'text' : 'password'
      confirmation.input.type = pin.input.type
      show.textContent = this.createForm.showPin ? 'PIN 숨기기' : 'PIN 보기'
    })
    const notice = this.renderPrivacyNotice()
    const ageRow = this.doc.createElement('label')
    ageRow.className = 'player-profile-check-row'
    const age = this.doc.createElement('input')
    age.type = 'checkbox'
    age.checked = this.createForm.over14
    age.setAttribute('data-player-field', 'over14')
    ageRow.append(age, element(this.doc, 'span', this.privacyNotice.ageConfirmation))
    const submit = this.actionButton('프로필 만들기', 'create-submit', true)
    advanced.append(zeroCopy, pin.label, confirmation.label, show, notice, ageRow, submit)
    const updateSubmit = () => {
      this.createForm.pin = pin.input.value
      this.createForm.confirmation = confirmation.input.value
      this.createForm.over14 = age.checked
      submit.disabled = this.busy
        || this.controller.nameCheck.status !== 'available'
        || !PIN_PATTERN.test(this.createForm.pin)
        || this.createForm.pin !== this.createForm.confirmation
        || !this.createForm.over14
    }
    pin.input.addEventListener('input', updateSubmit)
    confirmation.input.addEventListener('input', updateSubmit)
    age.addEventListener('change', updateSubmit)
    updateSubmit()
    check.addEventListener('click', async () => {
      this.createForm.profileName = name.input.value
      this.controller.editProfileName(name.input.value)
      this.busy = true
      this.error = ''
      check.disabled = true
      check.setAttribute('aria-busy', 'true')
      const result = await this.controller.checkName()
      this.busy = false
      this.error = result.ok ? '' : exactError(result)
      this.paint()
    })
    submit.addEventListener('click', async () => {
      updateSubmit()
      if (submit.disabled) return
      this.busy = true
      submit.disabled = true
      submit.setAttribute('aria-busy', 'true')
      const result = await this.controller.create(
        this.createForm.profileName,
        this.createForm.pin,
        this.createForm.confirmation,
        this.createForm.over14,
      )
      this.busy = false
      this.error = exactError(result)
      if (result.ok) this.render(this.controller.snapshot)
      else this.paint()
    })
    form.append(name.label, check, checkState, advanced)
    this.body.replaceChildren(back, form)
  }

  private renderLogin(): void {
    this.heading.textContent = '내 프로필로 로그인'
    const back = this.backButton()
    const form = this.doc.createElement('form')
    form.className = 'player-profile-form'
    form.addEventListener('submit', (event) => event.preventDefault())
    const name = this.inputField('프로필 ID', 'profile-name', 'text')
    const pin = this.inputField('PIN 숫자 6자리', 'pin', this.loginForm.showPin ? 'text' : 'password')
    name.input.value = this.loginForm.profileName
    pin.input.value = this.loginForm.pin
    name.input.autocomplete = 'username'
    this.configurePin(pin.input)
    const show = this.actionButton(this.loginForm.showPin ? 'PIN 숨기기' : 'PIN 보기', 'show-pin', false)
    const submit = this.actionButton('로그인', 'login-submit', true)
    const update = () => {
      this.loginForm.profileName = name.input.value
      this.loginForm.pin = pin.input.value
      submit.disabled = this.busy
        || !normalizeProfileName(this.loginForm.profileName)
        || !PIN_PATTERN.test(this.loginForm.pin)
    }
    name.input.addEventListener('input', update)
    pin.input.addEventListener('input', update)
    show.addEventListener('click', () => {
      this.loginForm.showPin = !this.loginForm.showPin
      pin.input.type = this.loginForm.showPin ? 'text' : 'password'
      show.textContent = this.loginForm.showPin ? 'PIN 숨기기' : 'PIN 보기'
    })
    submit.addEventListener('click', async () => {
      update()
      if (submit.disabled) return
      this.busy = true
      submit.disabled = true
      submit.setAttribute('aria-busy', 'true')
      const result = await this.controller.login(this.loginForm.profileName, this.loginForm.pin)
      this.busy = false
      this.error = result.ok ? '' : 'ID 또는 PIN을 다시 확인해 주세요.'
      if (result.ok) this.render(this.controller.snapshot)
      else this.paint()
    })
    update()
    form.append(name.label, pin.label, show, submit)
    this.body.replaceChildren(back, form)
  }

  private renderSigned(): void {
    this.heading.textContent = '내 프로필'
    if (this.snapshot.kind !== 'player') {
      this.screen = 'guest'
      this.renderGuest()
      return
    }
    const avatarModel = profileAvatar(this.snapshot.profile.userId, this.snapshot.profile.displayName)
    const summary = this.doc.createElement('section')
    summary.className = 'player-profile-summary'
    const avatar = element(this.doc, 'span', avatarModel.initial, 'player-profile-avatar')
    avatar.setAttribute('aria-hidden', 'true')
    avatar.setAttribute('style', `background-color:${avatarModel.color}`)
    summary.append(
      avatar,
      element(this.doc, 'strong', this.snapshot.profile.displayName),
      element(this.doc, 'span', '기록이 저장됐어요'),
    )
    const privacy = this.actionButton('프로필과 기록 저장 안내 보기', 'privacy-toggle', false)
    const privacyDetails = this.renderPrivacyNotice()
    privacyDetails.hidden = !this.privacyExpanded
    privacy.addEventListener('click', () => {
      this.privacyExpanded = !this.privacyExpanded
      privacyDetails.hidden = !this.privacyExpanded
    })
    const controls: HTMLElement[] = [summary]
    if (this.onRetrySave) {
      const retry = this.actionButton('다시 저장', 'retry-save')
      retry.addEventListener('click', () => { void this.onRetrySave?.() })
      controls.push(retry)
    }
    const logout = this.actionButton('로그아웃', 'logout')
    logout.addEventListener('click', async () => {
      this.busy = true
      logout.disabled = true
      logout.setAttribute('aria-busy', 'true')
      const result = await this.controller.logout()
      this.busy = false
      this.error = exactError(result)
      if (result.ok) {
        this.snapshot = this.controller.snapshot
        this.screen = 'guest'
      }
      this.paint()
    })
    controls.push(privacy, privacyDetails, logout)
    this.body.replaceChildren(...controls)
  }

  private renderForcePin(): void {
    this.heading.textContent = '새 PIN으로 바꿔 주세요'
    const lead = element(
      this.doc,
      'p',
      '운영자가 만든 임시 PIN으로 로그인했어요. 계속하려면 내가 사용할 새 PIN을 정해 주세요.',
      'player-profile-lead',
    )
    const pin = this.inputField('새 PIN 숫자 6자리', 'pin', this.forceForm.showPin ? 'text' : 'password')
    const confirmation = this.inputField('새 PIN 다시 입력', 'pin-confirmation', this.forceForm.showPin ? 'text' : 'password')
    pin.input.value = this.forceForm.pin
    confirmation.input.value = this.forceForm.confirmation
    this.configurePin(pin.input)
    this.configurePin(confirmation.input)
    const show = this.actionButton(this.forceForm.showPin ? 'PIN 숨기기' : 'PIN 보기', 'show-pin', false)
    const submit = this.actionButton('새 PIN 저장', 'force-submit', true)
    const logout = this.actionButton('로그아웃하고 게스트로 돌아가기', 'force-logout', false)
    const update = () => {
      this.forceForm.pin = pin.input.value
      this.forceForm.confirmation = confirmation.input.value
      submit.disabled = this.busy
        || !PIN_PATTERN.test(this.forceForm.pin)
        || this.forceForm.pin !== this.forceForm.confirmation
    }
    pin.input.addEventListener('input', update)
    confirmation.input.addEventListener('input', update)
    show.addEventListener('click', () => {
      this.forceForm.showPin = !this.forceForm.showPin
      pin.input.type = this.forceForm.showPin ? 'text' : 'password'
      confirmation.input.type = pin.input.type
      show.textContent = this.forceForm.showPin ? 'PIN 숨기기' : 'PIN 보기'
    })
    submit.addEventListener('click', async () => {
      update()
      if (submit.disabled) return
      this.busy = true
      submit.disabled = true
      submit.setAttribute('aria-busy', 'true')
      const result = await this.controller.changePin(this.forceForm.pin, this.forceForm.confirmation)
      this.busy = false
      this.error = exactError(result)
      if (result.ok) this.render(this.controller.snapshot)
      else this.paint()
    })
    logout.addEventListener('click', async () => {
      this.busy = true
      logout.disabled = true
      const result = await this.controller.logout()
      this.busy = false
      this.error = exactError(result)
      if (result.ok) {
        this.snapshot = this.controller.snapshot
        this.screen = 'guest'
      }
      this.paint()
    })
    update()
    this.body.replaceChildren(lead, pin.label, confirmation.label, show, submit, logout)
  }

  private inputField(labelCopy: string, field: string, type: string): {
    label: HTMLLabelElement
    input: HTMLInputElement
  } {
    const label = this.doc.createElement('label')
    label.className = 'player-profile-field'
    const copy = element(this.doc, 'span', labelCopy)
    const input = this.doc.createElement('input')
    input.type = type
    input.setAttribute('data-player-field', field)
    input.setAttribute('aria-label', labelCopy)
    label.append(copy, input)
    return { label, input }
  }

  private configurePin(input: HTMLInputElement): void {
    input.inputMode = 'numeric'
    input.autocomplete = 'current-password'
    input.maxLength = 6
    input.pattern = '[0-9]{6}'
  }

  private actionButton(copy: string, action: string, primary = false): HTMLButtonElement {
    const button = element(
      this.doc,
      'button',
      copy,
      primary ? 'player-profile-button player-profile-primary' : 'player-profile-button',
    )
    button.type = 'button'
    button.setAttribute('data-player-action', action)
    return button
  }

  private backButton(): HTMLButtonElement {
    const back = this.actionButton('뒤로', 'back', false)
    back.addEventListener('click', () => {
      this.error = ''
      this.screen = 'guest'
      this.paint()
    })
    return back
  }

  private renderPrivacyNotice(): HTMLElement {
    const section = this.doc.createElement('section')
    section.className = 'player-profile-privacy'
    section.appendChild(element(this.doc, 'h2', this.privacyNotice.title))
    const list = this.doc.createElement('ul')
    for (const item of this.privacyNotice.items) {
      if (!item) continue
      list.appendChild(element(this.doc, 'li', item))
    }
    section.appendChild(list)
    return section
  }

  private nameCheckCopy(check: PlayerNameCheck): string {
    switch (check.status) {
      case 'checking': return 'ID를 확인하는 중이에요'
      case 'available': return '사용할 수 있는 ID예요'
      case 'taken': return '이미 사용 중인 ID예요. 다른 ID를 입력해 주세요.'
      case 'error': return '연결을 확인한 뒤 중복 확인을 다시 눌러 주세요.'
      default: return '한글, 영문, 숫자로 2자에서 12자로 입력해 주세요.'
    }
  }

  private isForced(): boolean {
    return this.snapshot.kind === 'player' && this.snapshot.forcePinChange
  }

  private makeSiblingsInert(): void {
    const localSurfaces = Array.from(this.parent.children)
      .filter((child): child is HTMLElement => child !== this.layer)
    const outerSurfaces = this.parent.parentElement
      ? Array.from(this.parent.parentElement.children)
        .filter((child): child is HTMLElement => child !== this.parent)
      : []
    this.inertStates = [...localSurfaces, ...outerSurfaces]
      .map((child) => ({
        element: child,
        inert: child.inert,
        inertAttribute: child.getAttribute('inert'),
        ariaHidden: child.getAttribute('aria-hidden'),
      }))
    for (const state of this.inertStates) {
      state.element.inert = true
      state.element.setAttribute('inert', '')
      state.element.setAttribute('aria-hidden', 'true')
    }
  }

  private restoreSiblings(): void {
    for (const state of this.inertStates) {
      state.element.inert = state.inert
      if (state.inertAttribute === null) state.element.removeAttribute('inert')
      else state.element.setAttribute('inert', state.inertAttribute)
      if (state.ariaHidden === null) state.element.removeAttribute('aria-hidden')
      else state.element.setAttribute('aria-hidden', state.ariaHidden)
    }
    this.inertStates = []
  }

  private pushHistorySentinel(): void {
    try {
      history.pushState({ playerProfile: true }, '', location.href)
      this.historySentinel = true
    } catch {
      this.historySentinel = false
    }
  }

  private closeInternal(): void {
    if (!this.openState) return
    this.openState = false
    this.historySentinel = false
    this.layer.hidden = true
    this.layer.setAttribute('aria-hidden', 'true')
    this.doc.documentElement.classList.remove('profile-open')
    this.doc.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('popstate', this.onPopState)
    this.restoreSiblings()
    const fallback = this.doc.querySelector<HTMLElement>('[data-recordbook-profile]')
    const target = this.returnFocus?.isConnected ? this.returnFocus : fallback
    target?.focus()
    this.returnFocus = null
  }

  private readonly onPopState = (): void => {
    if (!this.openState) return
    this.historySentinel = false
    if (this.isForced()) {
      this.pushHistorySentinel()
      this.paint()
      return
    }
    this.closeInternal()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.openState) return
    if (event.key === 'Escape') {
      if (!this.isForced()) this.close()
      event.preventDefault()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = this.focusable()
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = this.doc.activeElement
    if (event.shiftKey && (active === first || !this.panel.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !this.panel.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  private focusable(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]'))
      .filter((node) => !node.hidden
        && !('disabled' in node && (node as HTMLButtonElement | HTMLInputElement).disabled)
        && node.getAttribute('aria-hidden') !== 'true')
  }

  private firstFocusable(): HTMLElement | null {
    return this.focusable()[0] ?? null
  }
}
