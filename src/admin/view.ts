import {
  type AdminApi,
  type AdminQuest,
  type AdminQuestInput,
  type AdminRole,
  type AdminSession,
  type ApiResult,
  type DailyMetrics,
  type FeatureFlag,
  type FeatureFlagKey,
  type ManagedAdmin,
  type QuestEventType,
} from './api'
import { isCharacterId, type CharacterId } from '../weapons/character-ids'

type MetricFormat = 'number' | 'percent'

const EVENT_LABELS: Record<QuestEventType, string> = {
  CHARGE_RELEASED: '꾹 와장창 완료',
  WEAPON_USED: '무기 또는 캐릭터 사용',
  TARGET_DESTROYED: '타겟 완파',
}

const FLAG_LABELS: Record<FeatureFlagKey, { title: string; copy: string }> = {
  gamification_enabled: { title: '도전과 도장', copy: '오늘의 도전과 부순 기록을 게임에 보여줘요.' },
  character_variants_enabled: { title: '캐릭터별 움직임', copy: '캐릭터마다 다른 공격과 모습을 적용해요.' },
  analytics_enabled: { title: '사용 통계 모으기', copy: '개인을 알아볼 수 없는 사용 횟수만 모아요.' },
}

const CHARACTER_DISPLAY_NAMES: Readonly<Record<CharacterId, string>> = {
  cinnamoroll: '시나모롤',
  thanos: '타노스',
  ironman: '아이언맨',
  hulk: '헐크',
  godzilla: '고질라',
  dragonball: '드래곤볼',
  cat: '고양이',
  ditto: '메타몽',
  pooh: '푸',
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string): HTMLElementTagNameMap[K] {
  const node = element(tag, className)
  node.textContent = value
  return node
}

function actionButton(label: string, kind: 'primary' | 'secondary' | 'danger' = 'secondary'): HTMLButtonElement {
  const node = text('button', label, `admin-button admin-button--${kind}`)
  node.type = 'button'
  return node
}

function isoFromLocal(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : value
}

export function questInputFromForm(values: FormData): AdminQuestInput {
  return {
    id: String(values.get('id') ?? '').trim(),
    copy: String(values.get('copy') ?? '').trim(),
    eventType: String(values.get('eventType') ?? '') as QuestEventType,
    target: Number(values.get('target')),
    activeFrom: isoFromLocal(values.get('activeFrom')),
    activeTo: isoFromLocal(values.get('activeTo')),
    enabled: values.get('enabled') === 'on',
    version: Number(values.get('version')),
  }
}

export function canManageAccounts(role: AdminRole): boolean {
  return role === 'owner'
}

export function nextDialogFocusIndex(count: number, current: number, reverse: boolean): number {
  if (count <= 0) return 0
  if (reverse) return current <= 0 ? count - 1 : current - 1
  return current >= count - 1 ? 0 : current + 1
}

export function formatMetricValue(value: number | null, format: MetricFormat = 'number'): string {
  if (value === null) return '아직 기록이 없어요'
  if (format === 'percent') return `${value.toLocaleString('ko-KR')}%`
  return value.toLocaleString('ko-KR')
}

export function characterDisplayName(value: string): string {
  return isCharacterId(value) ? CHARACTER_DISPLAY_NAMES[value] : '알 수 없는 캐릭터'
}

export type DashboardSectionState<T> =
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string; nextAction: '다시 불러오기' }

export function dashboardSectionState<T>(result: ApiResult<T>): DashboardSectionState<T> {
  if (result.ok) return { status: 'ready', data: result.data }
  return { status: 'error', message: result.error.message, nextAction: '다시 불러오기' }
}

function localDateTime(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.disabled = busy
  button.setAttribute('aria-busy', String(busy))
}

export class AdminView {
  private session: AdminSession | null = null
  private live: HTMLElement | null = null
  private successMessage = ''
  private restoreFocusKey = ''

  constructor(private readonly root: HTMLElement, private readonly api: AdminApi) {}

  async start(): Promise<void> {
    this.renderLoading('운영자 설정을 불러오는 중이에요.')
    const restored = await this.api.restoreSession()
    if (!restored.ok) {
      this.renderLogin(restored.error.message)
      return
    }
    if (!restored.data) {
      this.renderLogin()
      return
    }
    this.session = restored.data
    await this.renderDashboard()
  }

  renderOffline(): void {
    const card = element('section', 'admin-auth-card')
    card.append(
      text('span', '운영 도구', 'admin-eyebrow'),
      text('h1', '연결 설정을 확인해 주세요.'),
      text('p', '연결 정보를 입력한 뒤 화면을 새로 열면 운영자 기능을 사용할 수 있어요.', 'admin-lead'),
    )
    this.root.replaceChildren(card)
  }

  renderSessionExpired(): void {
    if (!this.session) return
    this.session = null
    this.renderLogin('로그인 시간이 끝났어요. 다시 로그인해 주세요.')
  }

  private renderLoading(copy: string): void {
    this.root.className = 'admin-shell admin-shell--auth'
    const section = element('section', 'admin-loading')
    section.setAttribute('aria-busy', 'true')
    section.setAttribute('aria-labelledby', 'admin-loading-title')
    const mark = text('div', '💥', 'admin-loading__mark')
    mark.setAttribute('aria-hidden', 'true')
    const title = text('h1', '세상 부수기 운영자')
    title.id = 'admin-loading-title'
    const progress = element('div', 'admin-loading__progress')
    progress.setAttribute('aria-hidden', 'true')
    progress.append(element('span'))
    section.append(mark, title, text('p', copy), progress)
    this.root.replaceChildren(section)
  }

  private renderLogin(message = ''): void {
    this.session = null
    this.root.className = 'admin-shell admin-shell--auth'
    const card = element('section', 'admin-auth-card')
    const mark = text('div', '💥', 'admin-brand-mark')
    mark.setAttribute('aria-hidden', 'true')
    const title = text('h1', '운영자 로그인')
    const intro = text('p', '도전과 기능 설정을 관리하려면 운영자 정보를 입력해 주세요.', 'admin-lead')
    const status = text('p', message, 'admin-form-status')
    status.setAttribute('role', 'alert')
    status.hidden = message.length === 0

    const form = element('form', 'admin-form')
    form.noValidate = true
    const email = this.labelledInput('이메일', 'email', 'email', true)
    const password = this.labelledInput('비밀번호', 'password', 'password', true)
    const submit = actionButton('로그인', 'primary')
    submit.type = 'submit'
    form.append(email.wrap, password.wrap, status, submit)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      status.hidden = true
      const emailValue = email.input.value.trim()
      const passwordValue = password.input.value
      if (!emailValue || !passwordValue) {
        status.textContent = '이메일과 비밀번호를 모두 입력해 주세요.'
        status.hidden = false
        ;(!emailValue ? email.input : password.input).focus()
        return
      }
      setBusy(submit, true)
      submit.textContent = '확인하는 중이에요'
      void this.api.signIn(emailValue, passwordValue).then(async (result) => {
        if (!result.ok) {
          status.textContent = result.error.message
          status.hidden = false
          password.input.value = ''
          password.input.focus()
          setBusy(submit, false)
          submit.textContent = '로그인'
          return
        }
        this.session = result.data
        await this.renderDashboard()
      })
    })

    card.append(mark, text('span', '세상 부수기', 'admin-eyebrow'), title, intro, form)
    this.root.replaceChildren(card)
    email.input.focus()
  }

  private async renderDashboard(): Promise<void> {
    if (!this.session) return
    this.root.className = 'admin-shell'
    this.renderLoading('저장된 운영 내용을 모으고 있어요.')
    const [quests, flags, metrics, admins] = await Promise.all([
      this.api.listQuests(),
      this.api.listFlags(),
      this.api.loadDailyMetrics(),
      canManageAccounts(this.session.role)
        ? this.api.listAdmins()
        : Promise.resolve({ ok: true, data: [] } as ApiResult<ManagedAdmin[]>),
    ])
    const questState = dashboardSectionState(quests)
    const flagState = dashboardSectionState(flags)
    const metricState = dashboardSectionState(metrics)
    const adminState = dashboardSectionState(admins)

    const layout = element('div', 'admin-dashboard')
    this.root.className = 'admin-shell'
    const header = element('header', 'admin-header')
    const brand = element('div', 'admin-header__brand')
    brand.append(text('span', '운영 도구', 'admin-eyebrow'), text('h1', '세상 부수기 관리'))
    const identity = element('div', 'admin-identity')
    identity.append(text('span', this.session.email), text('small', this.session.role === 'owner' ? '전체 운영자' : '운영자'))
    const signOut = actionButton('로그아웃')
    signOut.addEventListener('click', () => {
      setBusy(signOut, true)
      void this.api.signOut().then((result) => {
        if (!result.ok) {
          setBusy(signOut, false)
          this.announce(result.error.message)
          return
        }
        this.session = null
        this.renderLogin()
      })
    })
    const account = element('div', 'admin-header__account')
    account.append(identity, signOut)
    header.append(brand, account)

    this.live = text('p', this.successMessage, 'admin-live')
    this.live.setAttribute('role', 'status')
    this.live.setAttribute('aria-live', 'polite')
    this.successMessage = ''

    const grid = element('main', 'admin-grid')
    grid.append(
      questState.status === 'ready'
        ? this.renderQuestSection(questState.data)
        : this.renderSectionError('오늘의 도전 관리', '게임에 보여줄 오늘의 도전을 만들고 기간을 정해요.', questState),
      flagState.status === 'ready'
        ? this.renderFlagSection(flagState.data)
        : this.renderSectionError('기능 설정', '게임에서 사용할 기능을 저장 즉시 바꿔요.', flagState),
      metricState.status === 'ready'
        ? this.renderMetricSection(metricState.data)
        : this.renderSectionError('사용 통계', '개인을 알아볼 수 없는 게임 사용 흐름만 보여줘요.', metricState),
      adminState.status === 'ready'
        ? this.renderAdminSection(adminState.data)
        : this.renderSectionError('운영자 계정', '운영 도구를 사용할 계정 상태를 확인해요.', adminState),
    )
    layout.append(header, this.live, grid)
    this.root.replaceChildren(layout)
    if (this.restoreFocusKey) {
      const focusKey = this.restoreFocusKey
      this.restoreFocusKey = ''
      const focusTarget = [...this.root.querySelectorAll<HTMLElement>('[data-focus-key]')]
        .find((node) => node.dataset.focusKey === focusKey)
      focusTarget?.focus()
    }
  }

  private renderSectionError(
    titleValue: string,
    copy: string,
    state: Extract<DashboardSectionState<unknown>, { status: 'error' }>,
  ): HTMLElement {
    const { section, body } = this.section(titleValue, copy)
    const retry = actionButton(state.nextAction, 'primary')
    retry.addEventListener('click', () => {
      setBusy(retry, true)
      void this.renderDashboard()
    })
    body.append(text('p', state.message, 'admin-empty'), retry)
    return section
  }

  private section(titleValue: string, copy: string): { section: HTMLElement; head: HTMLElement; body: HTMLElement } {
    const section = element('section', 'admin-card')
    const head = element('div', 'admin-card__head')
    const heading = text('h2', titleValue)
    const id = `admin-${titleValue.replace(/\s/g, '-')}`
    heading.id = id
    head.append(heading, text('p', copy))
    section.setAttribute('aria-labelledby', id)
    const body = element('div', 'admin-card__body')
    section.append(head, body)
    return { section, head, body }
  }

  private renderQuestSection(quests: AdminQuest[]): HTMLElement {
    const { section, head, body } = this.section('오늘의 도전 관리', '게임에 보여줄 오늘의 도전을 만들고 기간을 정해요.')
    const create = actionButton('새 도전 만들기', 'primary')
    create.dataset.focusKey = 'quest-create'
    create.addEventListener('click', () => this.openQuestDialog(null, create))
    head.append(create)
    if (quests.length === 0) {
      body.append(text('p', '첫 도전을 만들면 게임에서 바로 선택할 수 있어요.', 'admin-empty'))
      return section
    }
    const tableWrap = element('div', 'admin-table-wrap')
    const table = element('table', 'admin-quest-table')
    table.append(text('caption', '오늘의 도전 목록'))
    const tableHead = element('thead')
    const headerRow = element('tr')
    for (const label of ['도전', '기준', '상태', '관리']) {
      const header = text('th', label)
      header.scope = 'col'
      headerRow.append(header)
    }
    tableHead.append(headerRow)
    const tableBody = element('tbody')
    for (const quest of quests) {
      const row = element('tr')
      const copy = element('td')
      copy.dataset.label = '도전'
      copy.append(text('strong', quest.copy))
      const rule = element('td')
      rule.dataset.label = '기준'
      rule.append(text('span', `${EVENT_LABELS[quest.eventType]} ${quest.target}회`))
      const status = element('td')
      status.dataset.label = '상태'
      status.append(text('span', quest.enabled ? '게임에 보이는 중' : '잠시 숨김'))
      const controls = element('td', 'admin-quest-actions')
      controls.dataset.label = '관리'
      const toggle = element('button', 'admin-switch')
      toggle.dataset.focusKey = `quest-toggle:${quest.id}`
      toggle.type = 'button'
      toggle.setAttribute('role', 'switch')
      toggle.setAttribute('aria-checked', String(quest.enabled))
      toggle.setAttribute('aria-label', `${quest.copy} ${quest.enabled ? '끄기' : '켜기'}`)
      toggle.append(text('span', quest.enabled ? '켬' : '끔'))
      toggle.addEventListener('click', () => this.runMutation(toggle, this.api.setQuestEnabled(quest.id, !quest.enabled), '도전 표시 설정을 저장했어요.'))
      const edit = actionButton('수정')
      edit.dataset.focusKey = `quest-edit:${quest.id}`
      edit.setAttribute('aria-label', `${quest.copy} 수정`)
      edit.addEventListener('click', () => this.openQuestDialog(quest, edit))
      const remove = actionButton('삭제', 'danger')
      remove.dataset.focusKey = `quest-delete:${quest.id}`
      remove.setAttribute('aria-label', `${quest.copy} 삭제`)
      remove.addEventListener('click', () => this.openConfirmation({
        title: '이 도전을 삭제할까요?',
        copy: `${quest.copy} 도전은 삭제 뒤 목록에서 사라져요.`,
        confirmLabel: '도전 삭제',
        trigger: remove,
        action: () => this.api.deleteQuest(quest.id),
        success: '도전을 삭제했어요.',
        focusKey: 'quest-create',
      }))
      controls.append(toggle, edit, remove)
      row.append(copy, rule, status, controls)
      tableBody.append(row)
    }
    table.append(tableHead, tableBody)
    tableWrap.append(table)
    body.append(tableWrap)
    return section
  }

  private renderFlagSection(flags: FeatureFlag[]): HTMLElement {
    const { section, body } = this.section('기능 설정', '게임에서 사용할 기능을 저장 즉시 바꿔요.')
    const byKey = new Map(flags.map((flag) => [flag.key, flag]))
    const list = element('div', 'admin-switch-list')
    for (const key of Object.keys(FLAG_LABELS) as FeatureFlagKey[]) {
      const flag = byKey.get(key)
      const row = element('div', 'admin-switch-row')
      const words = element('div')
      words.append(text('strong', FLAG_LABELS[key].title), text('span', FLAG_LABELS[key].copy))
      const toggle = element('button', 'admin-switch')
      toggle.dataset.focusKey = `flag:${key}`
      toggle.type = 'button'
      toggle.setAttribute('role', 'switch')
      toggle.setAttribute('aria-checked', String(flag?.enabled ?? false))
      toggle.setAttribute('aria-label', `${FLAG_LABELS[key].title} ${flag?.enabled ? '끄기' : '켜기'}`)
      toggle.append(text('span', flag?.enabled ? '켬' : '끔'))
      toggle.addEventListener('click', () => this.runMutation(toggle, this.api.setFlag(key, !(flag?.enabled ?? false)), '기능 설정을 저장했어요.'))
      row.append(words, toggle)
      list.append(row)
    }
    body.append(list)
    return section
  }

  private renderMetricSection(metrics: DailyMetrics): HTMLElement {
    const { section, body } = this.section('사용 통계', '개인을 알아볼 수 없는 게임 사용 흐름만 보여줘요.')
    const values: Array<[string, string]> = [
      ['방문', formatMetricValue(metrics.visits)],
      ['첫 유효 공격', formatMetricValue(metrics.firstValidAttacks)],
      ['첫 파괴', formatMetricValue(metrics.firstDestroys)],
      ['충전 완료율', formatMetricValue(metrics.chargeCompletionRate, 'percent')],
      ['도전 완료', formatMetricValue(metrics.questsCompleted)],
      ['공유 완료', formatMetricValue(metrics.sharesCompleted)],
      ['평균 완파 행동 수', formatMetricValue(metrics.averageFinishActions)],
    ]
    const grid = element('dl', 'admin-metrics')
    for (const [label, value] of values) {
      const item = element('div', 'admin-metric')
      item.append(text('dt', label), text('dd', value))
      grid.append(item)
    }
    body.append(grid)
    const usageTitle = text('h3', '캐릭터별 사용 수')
    body.append(usageTitle)
    if (metrics.characterUses.length === 0) {
      body.append(text('p', '캐릭터 사용이 쌓이면 이곳에서 비교할 수 있어요.', 'admin-empty admin-empty--small'))
    } else {
      const list = element('ul', 'admin-usage-list')
      metrics.characterUses.forEach(({ weaponId, count }) => {
        const item = element('li')
        item.append(text('span', characterDisplayName(weaponId)), text('strong', formatMetricValue(count)))
        list.append(item)
      })
      body.append(list)
    }
    return section
  }

  private renderAdminSection(admins: ManagedAdmin[]): HTMLElement {
    const { section, body } = this.section('운영자 계정', '운영 도구를 사용할 계정 상태를 확인해요.')
    if (!this.session) return section
    if (!canManageAccounts(this.session.role)) {
      body.append(text('p', '전체 운영자가 계정 상태를 관리해요. 도전과 기능 설정은 지금 바로 바꿀 수 있어요.', 'admin-empty'))
      return section
    }
    if (admins.length === 0) {
      body.append(text('p', '등록된 운영자 계정을 확인하면 이곳에 표시돼요.', 'admin-empty'))
      return section
    }
    const list = element('ul', 'admin-list')
    for (const admin of admins) {
      const item = element('li', 'admin-list-item')
      const info = element('div', 'admin-list-item__info')
      info.append(text('strong', admin.email), text('span', admin.role === 'owner' ? '전체 운영자' : '운영자'))
      const isSelf = admin.id === this.session.userId
      const status = text('small', admin.active ? '사용 중' : '쉬는 중')
      const toggle = actionButton(admin.active ? '사용 쉬기' : '다시 사용')
      toggle.dataset.focusKey = `admin:${admin.id}`
      toggle.disabled = isSelf && admin.active
      if (toggle.disabled) toggle.title = '현재 로그인한 계정은 여기서 쉴 수 없어요.'
      toggle.addEventListener('click', () => this.openConfirmation({
        title: admin.active ? '이 계정 사용을 쉴까요?' : '이 계정을 다시 사용할까요?',
        copy: admin.active ? '다음 로그인부터 운영 도구에 들어오지 못해요.' : '다음 로그인부터 운영 도구를 다시 사용할 수 있어요.',
        confirmLabel: admin.active ? '계정 사용 쉬기' : '계정 다시 사용',
        trigger: toggle,
        action: () => this.api.setAdminActive(admin.id, !admin.active),
        success: '운영자 계정 상태를 저장했어요.',
        focusKey: `admin:${admin.id}`,
      }))
      item.append(info, status, toggle)
      list.append(item)
    }
    body.append(list)
    return section
  }

  private openQuestDialog(quest: AdminQuest | null, trigger: HTMLButtonElement): void {
    const dialog = element('dialog', 'admin-dialog')
    dialog.setAttribute('aria-labelledby', 'quest-dialog-title')
    const form = element('form', 'admin-dialog__panel')
    form.noValidate = true
    const title = text('h2', quest ? '도전 수정' : '새 도전 만들기')
    title.id = 'quest-dialog-title'
    const status = text('p', '', 'admin-form-status')
    status.setAttribute('role', 'alert')
    status.hidden = true
    const id = this.labelledInput('도전 구분 이름', 'id', 'text', true, quest?.id ?? '')
    id.input.pattern = '[a-z0-9_]{3,64}'
    id.input.disabled = quest !== null
    const copy = this.labelledInput('게임에 보일 문구', 'copy', 'text', true, quest?.copy ?? '')
    copy.input.minLength = 2
    copy.input.maxLength = 60
    const eventWrap = element('label', 'admin-field')
    eventWrap.append(text('span', '도전 기준'))
    const eventSelect = element('select')
    eventSelect.name = 'eventType'
    eventSelect.required = true
    for (const event of Object.keys(EVENT_LABELS) as QuestEventType[]) {
      const option = text('option', EVENT_LABELS[event])
      option.value = event
      option.selected = (quest?.eventType ?? 'TARGET_DESTROYED') === event
      eventSelect.append(option)
    }
    eventWrap.append(eventSelect)
    const target = this.labelledInput('목표 횟수', 'target', 'number', true, String(quest?.target ?? 1))
    target.input.min = '1'; target.input.max = '100'; target.input.step = '1'
    const start = this.labelledInput('시작 날짜 (선택)', 'activeFrom', 'datetime-local', false, localDateTime(quest?.activeFrom ?? null))
    const end = this.labelledInput('종료 날짜 (선택)', 'activeTo', 'datetime-local', false, localDateTime(quest?.activeTo ?? null))
    const version = this.labelledInput('변경 번호', 'version', 'number', true, String(quest?.version ?? 1))
    version.input.min = '1'; version.input.step = '1'
    const enabledLabel = element('label', 'admin-check')
    const enabled = element('input')
    enabled.type = 'checkbox'; enabled.name = 'enabled'; enabled.checked = quest?.enabled ?? false
    enabledLabel.append(enabled, text('span', '저장 뒤 게임에 보이기'))
    const actions = element('div', 'admin-dialog__actions')
    const cancel = actionButton('취소')
    const save = actionButton(quest ? '수정 저장' : '도전 만들기', 'primary')
    save.type = 'submit'
    cancel.addEventListener('click', () => dialog.close())
    actions.append(cancel, save)
    form.append(title, text('p', '문구와 목표를 확인한 뒤 저장해 주세요.', 'admin-lead'), id.wrap, copy.wrap, eventWrap, target.wrap, start.wrap, end.wrap, version.wrap, enabledLabel, status, actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      if (quest) id.input.disabled = false
      const input = questInputFromForm(new FormData(form))
      if (quest) id.input.disabled = true
      setBusy(save, true)
      const request = quest ? this.api.updateQuest(quest.id, input) : this.api.createQuest(input)
      void request.then(async (result) => {
        if (!result.ok) {
          status.textContent = result.error.message
          status.hidden = false
          setBusy(save, false)
          return
        }
        dialog.close()
        this.restoreFocusKey = quest ? `quest-edit:${quest.id}` : 'quest-create'
        this.successMessage = quest ? '도전 변경을 저장했어요.' : '새 도전을 저장했어요.'
        await this.renderDashboard()
      })
    })
    dialog.append(form)
    this.mountDialog(dialog, trigger)
    id.input.focus()
  }

  private openConfirmation(options: {
    title: string
    copy: string
    confirmLabel: string
    trigger: HTMLButtonElement
    action: () => Promise<ApiResult<unknown>>
    success: string
    focusKey: string
  }): void {
    const dialog = element('dialog', 'admin-dialog admin-dialog--confirm')
    dialog.setAttribute('aria-labelledby', 'confirm-dialog-title')
    const panel = element('div', 'admin-dialog__panel')
    const title = text('h2', options.title)
    title.id = 'confirm-dialog-title'
    const status = text('p', '', 'admin-form-status')
    status.setAttribute('role', 'alert'); status.hidden = true
    const actions = element('div', 'admin-dialog__actions')
    const cancel = actionButton('돌아가기')
    const confirm = actionButton(options.confirmLabel, 'danger')
    cancel.addEventListener('click', () => dialog.close())
    confirm.addEventListener('click', () => {
      setBusy(confirm, true)
      void options.action().then(async (result) => {
        if (!result.ok) {
          status.textContent = result.error.message
          status.hidden = false
          setBusy(confirm, false)
          return
        }
        dialog.close()
        this.restoreFocusKey = options.focusKey
        this.successMessage = options.success
        await this.renderDashboard()
      })
    })
    actions.append(cancel, confirm)
    panel.append(title, text('p', options.copy, 'admin-lead'), status, actions)
    dialog.append(panel)
    this.mountDialog(dialog, options.trigger)
    cancel.focus()
  }

  private mountDialog(dialog: HTMLDialogElement, trigger: HTMLButtonElement): void {
    document.body.append(dialog)
    dialog.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
      const current = focusable.indexOf(document.activeElement as HTMLElement)
      const next = nextDialogFocusIndex(focusable.length, Math.max(0, current), event.shiftKey)
      if ((event.shiftKey && current <= 0) || (!event.shiftKey && current >= focusable.length - 1)) {
        event.preventDefault()
        focusable[next]?.focus()
      }
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close()
    })
    dialog.addEventListener('close', () => {
      dialog.remove()
      if (trigger.isConnected) trigger.focus()
    }, { once: true })
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }

  private runMutation(button: HTMLButtonElement, request: Promise<ApiResult<unknown>>, success: string): void {
    setBusy(button, true)
    this.restoreFocusKey = button.dataset.focusKey ?? ''
    void request.then(async (result) => {
      if (!result.ok) {
        setBusy(button, false)
        this.restoreFocusKey = ''
        this.announce(result.error.message)
        return
      }
      this.successMessage = success
      await this.renderDashboard()
    })
  }

  private announce(message: string): void {
    if (!this.live) return
    this.live.textContent = message
    this.live.focus()
  }

  private labelledInput(label: string, name: string, type: string, required: boolean, value = ''): { wrap: HTMLLabelElement; input: HTMLInputElement } {
    const wrap = element('label', 'admin-field')
    wrap.append(text('span', label))
    const input = element('input')
    input.name = name
    input.type = type
    input.required = required
    input.value = value
    if (type === 'email') input.autocomplete = 'username'
    if (type === 'password') input.autocomplete = 'current-password'
    wrap.append(input)
    return { wrap, input }
  }
}
