# First-Entry Profile Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the existing profile UI before gameplay on an undecided device, remember one guest choice locally, restore valid player sessions first, and show the update notice only after the entry decision.

**Architecture:** Add one DOM-free entry-choice module for the local key and deterministic decision matrix. Extend the existing account controller with an explicit restore outcome, extend `PlayerProfileView` with a blocking required-entry mode that reuses all current styles/forms, and let `main.ts` coordinate account restore, remote flags, the entry gate, and deferred What's New display. No database, Supabase function, dependency, or visual-system change is allowed.

**Tech Stack:** Vite 5, TypeScript, Canvas 2D, DOM APIs, Vitest, GitHub Actions, GitHub Pages.

## Global Constraints

- Preserve the current game, record-book, profile, HUD, weapon-bar, typography, color, spacing, modal, and mobile interaction design.
- Reuse `.player-profile-layer`, `.player-profile-panel`, `.player-profile-button`, and `.player-profile-primary`; add no new visual theme or dependency.
- First-entry choices are exactly `새 프로필 만들기`, `내 프로필로 로그인`, and `게스트로 시작`.
- Store only exact value `guest` under `btw.profileEntry.v1`; never store a profile ID, PIN, user UUID, token, or progress in this key.
- Valid player session and forced PIN change outrank a remembered guest choice.
- Required entry outranks What's New; the two modals must never be visible together.
- `player_profiles_ui=false` or an unresolved/failed remote configuration releases guest play without persisting a guest choice.
- Storage, network, auth, or configuration failure must not block guest gameplay indefinitely.
- No Supabase migration, Edge Function, RLS, secret, package, or lockfile change.
- Rendered copy uses easy Korean, positive next actions, and no em dash.
- Use TDD: observe every new test fail for the intended reason before implementing it.

---

## File Map

- Create `src/player/entry-choice.ts`: local guest-choice adapter, restore/entry outcome types, deterministic decision function, timeout helper.
- Create `src/player/entry-choice.test.ts`: decision matrix, exact storage contract, storage-failure fallback, timeout behavior.
- Modify `src/player/controller.ts`: return an explicit result from background session restoration without changing current snapshot/scope behavior.
- Modify `src/player/controller.test.ts`: restoration outcomes for player, forced PIN, guest, and service failure.
- Modify `src/player/view.ts`: required checking/choice mode, guest action, blocking close rules, completion/logout callbacks.
- Modify `src/player/view.test.ts`: required-mode UI, unchanged normal UI, focus/history blocking, auth completion, logout reopening.
- Modify `src/game.ts`: allow automatic What's New display to be deferred and expose one idempotent startup method.
- Modify `src/player/integration.test.ts`: startup order and main wiring contract.
- Modify `src/main.ts`: one startup coordinator joining restore, feature flags, entry choice, fallback, and What's New.
- Verify `src/player/style.css`: no visual rule changes unless the 390x844 render proves a layout defect.
- After production only, modify `README.md` and `AGENTS.md` with shipped behavior and verification evidence.

### Task 1: Deterministic Entry Choice and Local Preference

**Files:**
- Create: `src/player/entry-choice.ts`
- Create: `src/player/entry-choice.test.ts`

**Interfaces:**
- Produces: `PLAYER_ENTRY_CHOICE_KEY`, `PlayerRestoreOutcome`, `PlayerEntryDecision`, `PlayerEntryChoiceStore`, `decidePlayerEntry`, `withEntryTimeout`.
- Consumes: a `Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>` compatible adapter and no DOM globals.

- [ ] **Step 1: Write the failing decision and storage tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_ENTRY_CHOICE_KEY,
  PlayerEntryChoiceStore,
  decidePlayerEntry,
  withEntryTimeout,
} from './entry-choice'

describe('first-entry profile choice', () => {
  it.each([
    [{ restore: 'player', profilesEnabled: true, guestRemembered: true }, 'player'],
    [{ restore: 'force', profilesEnabled: true, guestRemembered: true }, 'force'],
    [{ restore: 'guest', profilesEnabled: true, guestRemembered: false }, 'choose'],
    [{ restore: 'error', profilesEnabled: true, guestRemembered: false }, 'choose'],
    [{ restore: 'guest', profilesEnabled: true, guestRemembered: true }, 'guest'],
    [{ restore: 'guest', profilesEnabled: false, guestRemembered: false }, 'fallback-guest'],
  ] as const)('resolves %o to %s', (input, expected) => {
    expect(decidePlayerEntry(input)).toBe(expected)
  })

  it('stores only the exact guest marker and clears it', () => {
    const values = new Map<string, string>()
    const store = new PlayerEntryChoiceStore({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    })
    expect(store.isGuestRemembered()).toBe(false)
    store.rememberGuest()
    expect(values).toEqual(new Map([[PLAYER_ENTRY_CHOICE_KEY, 'guest']]))
    expect(store.isGuestRemembered()).toBe(true)
    store.clear()
    expect(store.isGuestRemembered()).toBe(false)
  })

  it('continues in memory when browser storage throws', () => {
    const store = new PlayerEntryChoiceStore({
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(store.isGuestRemembered()).toBe(false)
    expect(store.rememberGuest()).toBe(false)
    expect(store.isGuestRemembered()).toBe(true)
    expect(() => store.clear()).not.toThrow()
  })

  it('releases a pending entry check after the bounded timeout', async () => {
    vi.useFakeTimers()
    const pending = new Promise<'player'>(() => undefined)
    const result = withEntryTimeout(pending, 8_000, 'fallback-guest')
    await vi.advanceTimersByTimeAsync(8_000)
    await expect(result).resolves.toEqual({ value: 'fallback-guest', timedOut: true })
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `npx vitest run src/player/entry-choice.test.ts`

Expected: FAIL because `./entry-choice` does not exist.

- [ ] **Step 3: Implement the minimal DOM-free contract**

```ts
export const PLAYER_ENTRY_CHOICE_KEY = 'btw.profileEntry.v1'

export type PlayerRestoreOutcome = 'player' | 'force' | 'guest' | 'error'
export type PlayerEntryDecision = PlayerRestoreOutcome | 'choose' | 'fallback-guest'

export function decidePlayerEntry(input: {
  restore: PlayerRestoreOutcome
  profilesEnabled: boolean
  guestRemembered: boolean
}): PlayerEntryDecision {
  if (input.restore === 'player' || input.restore === 'force') return input.restore
  if (!input.profilesEnabled) return 'fallback-guest'
  return input.guestRemembered ? 'guest' : 'choose'
}

type EntryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export class PlayerEntryChoiceStore {
  private memoryGuest = false
  constructor(private readonly storage: EntryStorage) {}

  isGuestRemembered(): boolean {
    if (this.memoryGuest) return true
    try { return this.storage.getItem(PLAYER_ENTRY_CHOICE_KEY) === 'guest' } catch { return false }
  }

  rememberGuest(): boolean {
    this.memoryGuest = true
    try {
      this.storage.setItem(PLAYER_ENTRY_CHOICE_KEY, 'guest')
      return true
    } catch { return false }
  }

  clear(): void {
    this.memoryGuest = false
    try { this.storage.removeItem(PLAYER_ENTRY_CHOICE_KEY) } catch { /* optional preference */ }
  }
}

export async function withEntryTimeout<T>(
  pending: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const fallbackResult = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    timeout = setTimeout(() => resolve({ value: fallback, timedOut: true }), timeoutMs)
  })
  try {
    return await Promise.race([
      pending.then((value) => ({ value, timedOut: false })),
      fallbackResult,
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run src/player/entry-choice.test.ts && npm run typecheck`

Expected: all entry-choice tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the independent entry contract**

```bash
git add src/player/entry-choice.ts src/player/entry-choice.test.ts
git commit -m "feat: define first-entry profile choice"
```

### Task 2: Explicit Session Restoration Outcome

**Files:**
- Modify: `src/player/controller.ts:92-119`
- Modify: `src/player/controller.test.ts:52-68`

**Interfaces:**
- Consumes: `PlayerRestoreOutcome` from `src/player/entry-choice.ts`.
- Produces: `PlayerAccountController.start(): Promise<PlayerRestoreOutcome>` while preserving all existing snapshots, generation guards, and scope callbacks.

- [ ] **Step 1: Add failing restore-outcome tests**

```ts
it.each([
  ['player', ok(PROFILE), 'player'],
  ['force', ok({ ...PROFILE, forcePinChange: true }), 'force'],
  ['guest', ok(null), 'guest'],
  ['error', { ok: false, error: { code: 'service_unavailable', message: '다시 확인해 주세요.' } }, 'error'],
] as const)('returns the %s restoration outcome', async (_label, restored, expected) => {
  const { controller, api } = setup()
  api.restoreSession.mockResolvedValueOnce(restored)
  await expect(controller.start()).resolves.toBe(expected)
})
```

- [ ] **Step 2: Run the controller test and verify the return-value failure**

Run: `npx vitest run src/player/controller.test.ts`

Expected: FAIL because `start()` currently resolves `void`.

- [ ] **Step 3: Return exact outcomes without changing side effects**

```ts
async start(): Promise<PlayerRestoreOutcome> {
  const generation = this.nextGeneration()
  this.current = { kind: 'restoring', card: this.guestCard('프로필을 확인하는 중이에요') }
  this.emit()
  const result = await this.api.restoreSession()
  if (!this.isCurrent(generation)) return 'error'
  if (!result.ok) {
    this.current = this.guestSnapshot()
    this.emit()
    return 'error'
  }
  if (result.data === null) {
    this.current = this.guestSnapshot()
    this.emit()
    return 'guest'
  }
  this.applyPlayer(result.data, generation)
  return result.data.forcePinChange ? 'force' : 'player'
}
```

Add the type-only import:

```ts
import type { PlayerRestoreOutcome } from './entry-choice'
```

- [ ] **Step 4: Run controller and entry tests**

Run: `npx vitest run src/player/controller.test.ts src/player/entry-choice.test.ts`

Expected: both files PASS; existing stale-generation and scope assertions remain unchanged.

- [ ] **Step 5: Commit restoration outcome support**

```bash
git add src/player/controller.ts src/player/controller.test.ts
git commit -m "refactor: expose player restore outcome"
```

### Task 3: Required Mode in the Existing Profile View

**Files:**
- Modify: `src/player/view.ts:8-229,323-383,421-540,612-704`
- Modify: `src/player/view.test.ts:155-490`
- Verify only: `src/player/style.css`

**Interfaces:**
- Produces: `openRequired(screen?: 'checking' | 'choice'): void`, `releaseRequired(): void`.
- Produces callbacks: `onGuestChosen`, `onAuthenticated`, `onLoggedOut` in `PlayerProfileViewOptions`.
- Preserves: `open(trigger)` and all ordinary record-book behavior.

- [ ] **Step 1: Add failing required-mode behavior tests**

```ts
it('shows the approved first choice before play and cannot be dismissed', () => {
  const onGuestChosen = vi.fn()
  const { doc, ui, view, fakeWindow } = setup(guest(), { onGuestChosen })
  view.openRequired('choice')
  expect(ui.textContent).toContain('어떻게 시작할까요?')
  expect(ui.textContent).toContain('새 프로필 만들기')
  expect(ui.textContent).toContain('내 프로필로 로그인')
  expect(ui.textContent).toContain('게스트로 시작')
  expect(action(ui, 'close').hidden).toBe(true)
  doc.dispatch('keydown', { key: 'Escape' })
  fakeWindow.dispatchPop()
  expect(view.isOpen).toBe(true)
  action(ui, 'guest-start').click()
  expect(onGuestChosen).toHaveBeenCalledOnce()
  expect(view.isOpen).toBe(false)
})

it('keeps the ordinary record-book profile screen closable and visually unchanged', () => {
  const { ui, view } = setup()
  view.open(null)
  expect(ui.textContent).toContain('새 프로필에서 첫 기록부터 새로 쌓아요.')
  expect(ui.textContent).not.toContain('게스트로 시작')
  expect(action(ui, 'close').hidden).toBe(false)
  action(ui, 'close').click()
  expect(view.isOpen).toBe(false)
})

it('turns a completed logout into a required choice', async () => {
  const onLoggedOut = vi.fn()
  const { ui, view } = setup(signedSnapshot, { onLoggedOut })
  view.open(null)
  action(ui, 'logout').click()
  await flushAsync()
  expect(onLoggedOut).toHaveBeenCalledOnce()
  expect(ui.textContent).toContain('게스트로 시작')
  expect(action(ui, 'close').hidden).toBe(true)
})
```

Extend the test setup option type and pass the callbacks into `PlayerProfileView`.

- [ ] **Step 2: Run the view test and verify missing required-mode APIs**

Run: `npx vitest run src/player/view.test.ts`

Expected: FAIL because `openRequired`, the callbacks, and `guest-start` do not exist.

- [ ] **Step 3: Add the required screen state while reusing existing DOM and classes**

Add the required state and callbacks:

```ts
type ProfileScreen = 'starting' | 'guest' | 'create' | 'login' | 'signed' | 'force'
type RequiredEntryScreen = 'checking' | 'choice'

export interface PlayerProfileViewOptions {
  privacyNotice?: PlayerPrivacyNotice
  onRetrySave?: () => void | Promise<void>
  onGuestChosen?: () => void
  onAuthenticated?: () => void
  onLoggedOut?: () => void
}

private requiredEntry = false

openRequired(screen: RequiredEntryScreen = 'choice'): void {
  this.requiredEntry = true
  this.screen = screen === 'checking' ? 'starting' : 'guest'
  if (!this.openState) this.openInternal(null)
  else this.paint()
}

releaseRequired(): void {
  if (!this.requiredEntry) return
  this.requiredEntry = false
  this.close()
}

private isBlocking(): boolean {
  return this.requiredEntry || this.isForced()
}
```

Extract the current `open()` body to `openInternal(trigger)` so normal `open(trigger)` sets `requiredEntry=false`, while `openRequired()` keeps it true. Use `isBlocking()` for close, backdrop, Escape, and popstate guards. Hide/disable close with `isBlocking()`.

Render the checking state and approved choice using existing classes:

```ts
private renderStarting(): void {
  this.heading.textContent = '시작을 준비하고 있어요'
  this.body.replaceChildren(element(
    this.doc,
    'p',
    '프로필을 확인하는 중이에요.',
    'player-profile-lead',
  ))
}

private renderGuest(): void {
  this.heading.textContent = this.requiredEntry ? '어떻게 시작할까요?' : '프로필'
  const intro = element(
    this.doc,
    'p',
    this.requiredEntry
      ? '프로필로 시작하면 여러 기기에서 기록을 이어갈 수 있어요. 게스트로 시작하면 이 기기에만 기록돼요.'
      : '새 프로필에서 첫 기록부터 새로 쌓아요. 지금 게스트 기록은 이 기기에 그대로 남아요.',
    'player-profile-lead',
  )
  // Reuse the existing create/login buttons and listeners.
  const children: HTMLElement[] = [intro, create, login]
  if (this.requiredEntry) {
    const guest = this.actionButton('게스트로 시작', 'guest-start')
    guest.addEventListener('click', () => {
      this.requiredEntry = false
      this.close()
      this.options.onGuestChosen?.()
    })
    children.push(guest)
  } else {
    children.push(note)
  }
  this.body.replaceChildren(...children)
}
```

Keep `PlayerProfileViewOptions` as a retained private options field or retain the three callbacks separately. After successful create, login, or forced PIN change, call `onAuthenticated`; if `requiredEntry` is true, release/close the required view before the callback. After either successful logout path, set `requiredEntry=true`, render guest choice, and call `onLoggedOut`.

- [ ] **Step 4: Prove existing CSS remains sufficient**

Run: `npx vitest run src/player/view.test.ts`

Expected: PASS, including current 44px, 16px input, focus-trap, pending-logout, and normal-close tests. Do not edit `src/player/style.css` unless the browser check in Task 5 finds a concrete overflow defect.

- [ ] **Step 5: Commit the required view behavior**

```bash
git add src/player/view.ts src/player/view.test.ts
git commit -m "feat: require a first-entry profile choice"
```

### Task 4: Defer What's New and Coordinate Startup

**Files:**
- Modify: `src/game.ts:80-83,134-138,237-240,315-330`
- Modify: `src/main.ts:20-145`
- Modify: `src/player/integration.test.ts:149-165`

**Interfaces:**
- Consumes: Task 1 decision/store/timeout and Task 2 restore outcome.
- Consumes: Task 3 `openRequired`, `releaseRequired`, and callbacks.
- Produces: `GameOptions.autoShowWhatsNew?: boolean` and `Game.maybeShowWhatsNewOnLoad(): boolean`.

- [ ] **Step 1: Add failing startup-order integration assertions**

```ts
it('defers updates until the first-entry decision settles', async () => {
  const { readFileSync } = await vi.importActual<typeof import('node:fs')>('node:fs')
  const source = readFileSync(new URL('../main.ts', import.meta.url), 'utf8')
  expect(source).toContain('autoShowWhatsNew: false')
  expect(source).toContain('new PlayerEntryChoiceStore(')
  expect(source).toContain("profileView.openRequired('checking')")
  expect(source).toContain('decidePlayerEntry(')
  expect(source).toContain('game.maybeShowWhatsNewOnLoad()')
  expect(source.indexOf('controller.start()')).toBeLessThan(source.indexOf('decidePlayerEntry('))
})
```

Add a focused `Game` prototype test that verifies `maybeShowWhatsNewOnLoad()` calls the existing notice only when `?nonews` is absent.

- [ ] **Step 2: Run the integration test and verify missing wiring**

Run: `npx vitest run src/player/integration.test.ts`

Expected: FAIL because deferred What's New and the entry coordinator are not wired.

- [ ] **Step 3: Add explicit What's New deferral to Game**

```ts
export interface GameOptions {
  onOpenProfile?: (trigger: HTMLButtonElement) => void
  onFeatureFlags?: (flags: FeatureFlags) => void
  autoShowWhatsNew?: boolean
}

// constructor
if (this.options.autoShowWhatsNew !== false) this.maybeShowWhatsNewOnLoad()

maybeShowWhatsNewOnLoad(): boolean {
  return location.search.includes('nonews') ? false : this.whatsNew.maybeShowOnLoad()
}
```

- [ ] **Step 4: Wire one bounded startup coordinator in main**

Create the preference before starting the asynchronous checks:

```ts
const entryChoice = new PlayerEntryChoiceStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: (key) => window.localStorage.removeItem(key),
})
const guestRememberedAtBoot = entryChoice.isGuestRemembered()
let startupSettled = false
let startupTimedOut = false

const finishStartup = () => {
  if (startupSettled) return
  startupSettled = true
  game.maybeShowWhatsNewOnLoad()
}
```

Construct `Game` with `autoShowWhatsNew: false`. Pass view callbacks that keep storage and modal order centralized:

```ts
profileView = new PlayerProfileView(ui, controller, {
  onRetrySave: () => { void activeSync?.retry() },
  onGuestChosen: () => {
    entryChoice.rememberGuest()
    finishStartup()
  },
  onAuthenticated: () => {
    entryChoice.clear()
    finishStartup()
  },
  onLoggedOut: () => { entryChoice.clear() },
})
if (!guestRememberedAtBoot) profileView.openRequired('checking')
```

Start both checks without awaiting before the game exists:

```ts
const restorePromise = controller.start()
const configPromise = game.loadRemoteConfig(provider)
const resolvedDecision = Promise.all([restorePromise, configPromise]).then(([restore]) => (
  decidePlayerEntry({
    restore,
    profilesEnabled: activeFlags.player_profiles_ui,
    guestRemembered: entryChoice.isGuestRemembered(),
  })
))

void withEntryTimeout(resolvedDecision, 8_000, 'fallback-guest').then(({ value: decision, timedOut }) => {
  startupTimedOut = timedOut
  if (decision === 'choose') profileView?.openRequired('choice')
  else if (decision === 'force') profileView?.openRequired('choice')
  else {
    if (decision === 'player') entryChoice.clear()
    profileView?.releaseRequired()
    if (!timedOut) finishStartup()
  }
})

void resolvedDecision.then((decision) => {
  if (!startupTimedOut) return
  startupTimedOut = false
  if (decision === 'force') profileView?.openRequired('choice')
  else finishStartup()
})
```

Move the existing `game.loadRemoteConfig(provider)` call into this shared promise so it is invoked exactly once. Keep analytics startup independent and non-blocking.

- [ ] **Step 5: Run focused startup, view, controller, and choice tests**

Run: `npx vitest run src/player/entry-choice.test.ts src/player/controller.test.ts src/player/view.test.ts src/player/integration.test.ts src/ui/whatsnew.test.ts`

Expected: all focused files PASS; no update/profile modal race assertion fails.

- [ ] **Step 6: Commit startup orchestration**

```bash
git add src/game.ts src/main.ts src/player/integration.test.ts
git commit -m "feat: gate first play on profile choice"
```

### Task 5: Full Verification, Visual Regression, CI, and Production Deployment

**Files:**
- Verify: all source and test files
- Modify after production: `README.md`, `AGENTS.md`

**Interfaces:**
- Produces: a preview-approved, CI-verified, production-deployed first-entry flow.
- Deployment target: GitHub Pages workflow `.github/workflows/deploy.yml` from `main`.

- [ ] **Step 1: Run the complete local quality gate**

Run each command independently:

```bash
npm run lint:copy
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
git diff --check
```

Expected: copy lint PASS, all Vitest files PASS, TypeScript exits 0, Vite build succeeds, audit reports 0 high/critical production vulnerabilities, and `git diff --check` prints nothing.

- [ ] **Step 2: Run the mobile preview and verify exact flows at 390x844**

Use a fresh browser origin/local-storage state and verify:

1. `어떻게 시작할까요?` appears before What's New.
2. Close, backdrop, Escape, and browser back cannot bypass the choice.
3. Existing colors, spacing, panel width, buttons, HUD, record book, and weapon bar are unchanged.
4. `게스트로 시작` closes the profile view and opens What's New only if unseen.
5. Reload on the same origin skips the choice.
6. Clearing `btw.profileEntry.v1` restores the first-entry choice.
7. Record-book profile open remains closable and contains no startup-only guest button.
8. Login/create forms, duplicate check, six-digit PIN, and zero-start copy remain unchanged.

Expected: no horizontal overflow, no clipped button, no simultaneous modal, no console error.

- [ ] **Step 3: Perform adversarial review**

Review these exact risks and fix every confirmed issue before shipping:

- late session restore after the 8-second fallback
- forced PIN change while startup is pending
- storage getter/setter/remove exceptions
- remote profile flag disabled or built-in fallback
- repeated callback or duplicate What's New open
- logout with pending sync and keep-local path
- stale login completion after logout
- focus/history restoration when required mode closes
- copy-lint and 390x844 layout invariance

- [ ] **Step 4: Commit the verified implementation if review required changes**

```bash
git add src/player/entry-choice.ts src/player/entry-choice.test.ts \
  src/player/controller.ts src/player/controller.test.ts \
  src/player/view.ts src/player/view.test.ts \
  src/game.ts src/main.ts src/player/integration.test.ts
git commit -m "fix: harden first-entry profile flow"
```

Skip this commit only if the adversarial review produces no code change.

- [ ] **Step 5: Fetch remote main, confirm zero divergence, and push**

```bash
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
git status --short --branch
git push origin main
```

Expected before push: remote-ahead count `0`, only intentional local commits ahead, clean worktree.

- [ ] **Step 6: Run and monitor GitHub Actions CI/deploy**

```bash
gh workflow run deploy.yml --ref main
gh run list --workflow deploy.yml --branch main --event workflow_dispatch --limit 1 \
  --json databaseId,status,conclusion,headSha,url,createdAt
RUN_ID="$(gh run list --workflow deploy.yml --branch main --event workflow_dispatch \
  --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$RUN_ID" --exit-status
```

Expected: workflow head SHA equals pushed `main`; copy lint, full tests, typecheck, build, audit, Pages artifact, and deploy jobs all succeed.

- [ ] **Step 7: Verify actual production behavior**

Verify both URLs return 200:

```bash
curl -sS -L --max-time 20 -o /dev/null -w 'game=%{http_code} %{time_total}\n' \
  https://wannahappyaroundme.github.io/breaktheworld/
curl -sS -L --max-time 20 -o /dev/null -w 'admin=%{http_code} %{time_total}\n' \
  https://wannahappyaroundme.github.io/breaktheworld/admin.html
```

In a fresh production browser state, repeat the first visit, remembered guest reload, record-book profile, and console-error checks. Do not create a real profile or use the owner password unless separately needed.

- [ ] **Step 8: Update both shipped-state documents after production succeeds**

Update `README.md` in Korean with first-entry choice and same-device guest memory. Update `AGENTS.md` in dense English with the deployed key, startup priority, exact test count, workflow run, production verification, and current commit.

```bash
git add README.md AGENTS.md
git commit -m "docs: record first-entry choice rollout"
git fetch origin main
git push origin main
```

Expected: documentation commit is on `main`; manual deploy is not rerun because only Markdown changed.

---

## Rollback

1. Set `player_profiles_ui=false` to release the game to existing guest behavior without persisting a new choice.
2. Roll GitHub Pages back to the previous successful deployment if the frontend itself fails.
3. Do not delete `btw.profileEntry.v1`; it contains only `guest` and does not alter progress or sessions.
4. No database or Edge Function rollback is required.
