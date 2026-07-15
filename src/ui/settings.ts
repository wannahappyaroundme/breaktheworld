import type { StrongInputMode } from '../combat/action-controller'

export interface RecordBookSettingsState {
  strongInput: StrongInputMode
  reducedMotion: boolean
  haptics: boolean
}

export type RecordBookSettingChange =
  | { key: 'strongInput'; value: StrongInputMode }
  | { key: 'reducedMotion'; value: boolean }
  | { key: 'haptics'; value: boolean }

export type RecordBookSettingChangeHandler = (change: RecordBookSettingChange) => void

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

function choiceButton(
  doc: Document,
  label: string,
  selected: boolean,
  dataSetting: string,
  onClick: () => void
): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'recordbook-choice'
  button.textContent = label
  button.setAttribute('aria-pressed', String(selected))
  button.setAttribute('data-setting', dataSetting)
  button.addEventListener('click', onClick)
  return button
}

function switchButton(
  doc: Document,
  label: string,
  checked: boolean,
  dataSetting: 'reducedMotion' | 'haptics',
  onClick: () => void
): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'recordbook-switch'
  button.setAttribute('role', 'switch')
  button.setAttribute('aria-checked', String(checked))
  button.setAttribute('aria-label', label)
  button.setAttribute('data-setting', dataSetting)
  const visibleLabel = textElement(doc, 'span', label, 'recordbook-switch-label')
  const visibleState = textElement(
    doc,
    'span',
    checked ? '켜짐' : '꺼짐',
    'recordbook-switch-state'
  )
  visibleState.setAttribute('aria-hidden', 'true')
  button.append(visibleLabel, visibleState)
  button.addEventListener('click', onClick)
  return button
}

/** Renders stateless native controls; persistence and runtime wiring belong to the caller. */
export function createSettingsSection(
  doc: Document,
  state: RecordBookSettingsState,
  onChange: RecordBookSettingChangeHandler
): HTMLElement {
  const section = doc.createElement('section')
  section.className = 'recordbook-section recordbook-settings'
  section.setAttribute('data-recordbook-settings', '')
  section.appendChild(textElement(doc, 'h3', '설정'))

  const strongGroup = doc.createElement('div')
  strongGroup.className = 'recordbook-setting-group'
  strongGroup.setAttribute('role', 'group')
  strongGroup.setAttribute('aria-label', '강타 방식')
  strongGroup.appendChild(textElement(doc, 'p', '강타 방식', 'recordbook-setting-label'))

  const strongChoices = doc.createElement('div')
  strongChoices.className = 'recordbook-choice-row'
  strongChoices.append(
    choiceButton(doc, '꾹 누르기', state.strongInput === 'hold', 'strongInput:hold', () => {
      onChange({ key: 'strongInput', value: 'hold' })
    }),
    choiceButton(
      doc,
      '두 번 탭',
      state.strongInput === 'doubleTap',
      'strongInput:doubleTap',
      () => onChange({ key: 'strongInput', value: 'doubleTap' })
    )
  )
  strongGroup.appendChild(strongChoices)

  const switches = doc.createElement('div')
  switches.className = 'recordbook-switches'
  switches.append(
    switchButton(doc, '움직임 줄이기', state.reducedMotion, 'reducedMotion', () => {
      onChange({ key: 'reducedMotion', value: !state.reducedMotion })
    }),
    switchButton(doc, '진동', state.haptics, 'haptics', () => {
      onChange({ key: 'haptics', value: !state.haptics })
    })
  )

  section.append(strongGroup, switches)
  return section
}
