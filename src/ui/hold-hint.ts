import type { ActionDamageResolution } from '../combat/action-controller'
import { getBrowserStorage, type StorageLike } from '../storage'

export const HOLD_HINT_COPY = '꾹 눌러 힘을 모으고, 떼면 한방!'
export const LEGACY_HOLD_HINT_SEEN_KEY = 'btw.holdHintSeen'

type ScheduleHide = (callback: () => void, delayMs: number) => unknown

/** Temporary one-time onboarding state. Plan B migrates the stable key into ProgressStore. */
export class OneTimeHoldHint {
  private seen: boolean
  private instructionVisible = false
  private storage: StorageLike | null

  constructor(
    private element: HTMLElement | null,
    storage: StorageLike | null | undefined = undefined,
    private scheduleHide: ScheduleHide = (callback, delayMs) => window.setTimeout(callback, delayMs)
  ) {
    this.storage = storage === undefined ? getBrowserStorage() : storage
    try {
      this.seen = this.storage?.getItem(LEGACY_HOLD_HINT_SEEN_KEY) === '1'
    } catch {
      this.seen = false
    }
  }

  hideInitial(): void {
    if (this.instructionVisible) return
    this.element?.classList.add('hidden')
  }

  onDamage(resolution: ActionDamageResolution): boolean {
    if (
      this.seen ||
      !this.element ||
      resolution.kind !== 'quick' ||
      resolution.damage.detached <= 0
    ) {
      return false
    }

    this.seen = true
    this.instructionVisible = true
    this.element.textContent = HOLD_HINT_COPY
    this.element.classList.remove('hidden')
    try {
      this.storage?.setItem(LEGACY_HOLD_HINT_SEEN_KEY, '1')
    } catch {
      // Keep the current session playable; Plan B owns the user-facing storage fallback notice.
    }
    this.scheduleHide(() => {
      this.instructionVisible = false
      this.element?.classList.add('hidden')
    }, 4_000)
    return true
  }
}
