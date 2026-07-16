# Player Profile UX and Guest Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a polished mobile profile card and full-screen create/login/logout experience while keeping guest play immediate, preserving the guest save, starting every new profile at zero, and maintaining a distinct local cache per player UUID.

**Architecture:** A `PlayerApi` wraps the Plan 1 Edge contract and Supabase session storage. A DOM-free `PlayerAccountController` owns guest/restoring/signed-in/force-PIN-change state and emits progress-scope changes. The game swaps between one unchanged guest `ProgressStore` and namespaced player stores only at a cancellation-safe boundary; `RecordBook` renders a profile card but delegates all account UI to a separate full-screen `PlayerProfileView`.

**Tech Stack:** Existing Vite/TypeScript/Vitest, DOM/CSS, `@supabase/supabase-js`, localStorage for guest and namespaced profile cache. No new runtime dependency.

## Global Constraints

- Plan 1 must be complete and green first.
- Game boot and first interaction never wait for session restoration or the network.
- No automatic signup modal; entry is only the record-book top profile card.
- Guest state remains at exact key `btw.progress.v1`; no guest value is uploaded, renamed, copied, or deleted.
- Player cache key is `btw.player.<user_uuid>.progress.v1`; it is never selected by profile display name.
- A profile without a cached state starts from `createDefaultProgress(accountSeed)` and all counters/unlocks are zero.
- Existing-profile remote restore is completed by Plan 3; Plan 2 keeps player flags closed in production.
- Profile name rules and PIN validation import the Plan 1 shared contract; no duplicate validators.
- ID edit invalidates a successful duplicate check immediately.
- Create form requires explicit availability, matching six-digit PIN, privacy version 1, and 14+ confirmation.
- Creation remains disabled unless the public deletion-contact and data-processing notice values are both present, even if the remote signup flag is accidentally opened.
- PIN uses one `type=password`, `inputmode=numeric`, paste allowed, no auto-submit, and a show/hide button.
- Login errors use `ID 또는 PIN을 다시 확인해 주세요` for missing/wrong/inactive accounts.
- Login persists through Supabase local session; normal logout calls `scope:'local'`.
- Public config/analytics, player Auth, and operator Auth use separate Supabase client instances; player login cannot overwrite the operator session or attach player identity to anonymous analytics.
- Profile screen is a real modal dialog/full-screen layer, blocks Canvas input, traps focus, supports Escape/back, and returns focus to the profile card.
- All interactive controls are at least 44px; primary actions are 48px; input text is at least 16px.
- No em dash, technical jargon, dead empty state, placeholder copy, or empty future My Page menu appears.
- Default avatar is deterministic from player UUID and first profile-name character; no avatar selector now.
- Player profile UI/creation/sync flags default closed; disabling signup does not log out existing players.
- Each task uses TDD and ends with a focused conventional commit.

---

## File Map

```text
src/player/api.ts                    strict Edge/session adapter
src/player/api.test.ts               session and malformed response tests
src/player/types.ts                  account state, profile card, progress scope
src/player/controller.ts             DOM-free state machine and stale-result guard
src/player/controller.test.ts        restore/create/login/logout transition tests
src/player/privacy.ts                versioned Korean storage notice
src/player/avatar.ts                 deterministic initial/color model
src/player/avatar.test.ts            stable/accessibility-safe avatar tests
src/player/view.ts                   full-screen profile DOM and focus lifecycle
src/player/view.test.ts              forms, IME, live regions, focus, copy
src/player/style.css                 isolated mobile profile styling
src/progress/store.ts                configurable storage key and legacy policy
src/progress/store.test.ts           guest/profile isolation tests
src/game-progress.ts                 progress coordinator hydration boundary
src/game-progress.test.ts            safe context replacement tests
src/ui/recordbook.ts                 top profile card and open callback
src/ui/recordbook.test.ts            order, state, focus and visibility tests
src/config/feature-flags.ts           three closed player flags
src/config/quest-provider.ts          strict six-flag remote config parsing
src/config/quest-provider.test.ts     missing/unknown flag fallback tests
src/services/supabase.ts              isolated public/player/operator clients
src/services/supabase.test.ts         storage-key and persistence isolation tests
src/admin/main.ts                      operator-only client selection
src/game.ts                           account-scope switch and profile card bridge
src/main.ts                           non-blocking PlayerApp boot
src/style.css                         record-book profile card integration
index.html                            accessible zoom configuration
.env.example                          public privacy-notice deployment inputs
```

### Task 1: Expand remote flags and versioned privacy copy

**Files:**
- Modify: `src/config/feature-flags.ts`
- Modify: `src/config/quest-provider.ts`
- Modify: `src/config/quest-provider.test.ts`
- Create: `src/player/privacy.ts`
- Create: `src/player/privacy.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `FeatureFlags` with three player keys and a fail-closed `PLAYER_PRIVACY_NOTICE` version 1.
- Consumers: controller/view/game and deployment flags.

- [ ] **Step 1: Write failing flag and privacy tests**

```ts
expect(BUILT_IN_FLAGS).toEqual({
  gamification_enabled: true,
  character_variants_enabled: true,
  analytics_enabled: false,
  player_profiles_ui: false,
  player_signup: false,
  player_sync_writes: false,
})

const notice = createPlayerPrivacyNotice({
  deletionContact: '프로필을 만든 운영자에게 카카오톡으로 알려 주세요.',
  processingNotice: '기록 저장 위치와 처리 업체를 확인했어요.',
})
expect(notice).toMatchObject({ version: 1, ready: true })
expect(notice.items).toEqual([
  '프로필 ID와 게임 기록, 설정을 저장해요.',
  '이메일, 전화번호, 실명, 생년월일은 받지 않아요.',
  '프로필을 삭제할 때까지 보관해요.',
  '기록 저장 위치와 처리 업체를 확인했어요.',
  '프로필을 만든 운영자에게 카카오톡으로 알려 주세요.',
])
expect(createPlayerPrivacyNotice({ deletionContact: '', processingNotice: '' }).ready).toBe(false)
```

Test that a remote response missing any of the six flags, duplicating one, or adding an unknown flag is rejected and falls back to last-good/built-in config. Also prove `player_signup=true` is reduced to false at the controller boundary while the privacy notice is incomplete.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/config/quest-provider.test.ts src/player/privacy.test.ts`

Expected: FAIL because the new flags/privacy module are missing.

- [ ] **Step 3: Add the exact constants**

```ts
export const BUILT_IN_FLAGS = {
  gamification_enabled: true,
  character_variants_enabled: true,
  analytics_enabled: false,
  player_profiles_ui: false,
  player_signup: false,
  player_sync_writes: false,
} as const

export function createPlayerPrivacyNotice(input: {
  deletionContact: string
  processingNotice: string
}) {
  const deletionContact = input.deletionContact.trim()
  const processingNotice = input.processingNotice.trim()
  return {
    version: PLAYER_PRIVACY_VERSION,
    ready: deletionContact.length > 0 && processingNotice.length > 0,
    title: '프로필과 기록 저장 안내',
    items: [
      '프로필 ID와 게임 기록, 설정을 저장해요.',
      '이메일, 전화번호, 실명, 생년월일은 받지 않아요.',
      '프로필을 삭제할 때까지 보관해요.',
      processingNotice,
      deletionContact,
    ] as const,
    ageConfirmation: '만 14세 이상이며, 프로필과 기록 저장 안내를 확인했어요.',
  }
}

export const PLAYER_PRIVACY_NOTICE = createPlayerPrivacyNotice({
  deletionContact: import.meta.env.VITE_PLAYER_DELETION_CONTACT ?? '',
  processingNotice: import.meta.env.VITE_PLAYER_PROCESSING_NOTICE ?? '',
})
```

Import `PLAYER_PRIVACY_VERSION` from the Plan 1 shared contract so the consent gate and rendered notice have one version source. Add empty `VITE_PLAYER_DELETION_CONTACT=` and `VITE_PLAYER_PROCESSING_NOTICE=` keys to `.env.example`; these are intentionally public rendered copy, never secrets. Keep the existing config cache version and reject a cached three-flag payload rather than guessing missing player flags. Built-in player flags remain closed. The controller exposes signup only when both `flags.player_signup` and `PLAYER_PRIVACY_NOTICE.ready` are true; login remains available.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/config src/player/privacy.test.ts && npm run typecheck`

```bash
git add src/config/feature-flags.ts src/config/quest-provider.ts src/config/quest-provider.test.ts src/player/privacy.ts src/player/privacy.test.ts .env.example
git commit -m "feat: gate player profile surfaces"
```

### Task 2: Build the strict player API and persistent session adapter

**Files:**
- Create: `src/player/api.ts`
- Create: `src/player/api.test.ts`
- Create: `src/player/types.ts`
- Modify: `src/services/supabase.ts`
- Modify: `src/services/supabase.test.ts`
- Modify: `src/admin/main.ts`

**Interfaces:**
- Produces: isolated Supabase client factories, `PlayerApi`, `PlayerProfile`, `PlayerProgressScope`, normalized `PlayerApiResult`.
- Consumers: Task 3 controller and Plan 3 sync client.

- [ ] **Step 1: Write failing API tests**

Cover three client factories, no shared storage keys, public client with no persisted session/refresh, existing default-key operator continuity, player key `btw.player.auth.v1`, check-name, create, login, session restore, force-PIN change, malformed extra fields, generic login error, setSession failure, online/offline current-device logout, local-storage removal failure, offline/no-client results, and thrown function calls.

```ts
await api.login('예진', '024550')
expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' })
await api.signOut()
expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
```

- [ ] **Step 2: Run and confirm missing-module failure**

Run: `npm test -- src/player/api.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define exact public state types**

```ts
export interface PlayerProfile {
  userId: string
  displayName: string
  forcePinChange: boolean
  credentialVersion: number
}

export type PlayerProgressScope =
  | { kind: 'guest' }
  | { kind: 'player'; profile: PlayerProfile }

export type PlayerApiErrorCode =
  | 'offline' | 'invalid_request' | 'name_taken' | 'login_failed'
  | 'rate_limited' | 'signup_closed' | 'session_expired'
  | 'change_not_required' | 'service_unavailable'

export type PlayerApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: PlayerApiErrorCode; message: string; retryAfterSeconds?: number } }
```

Refactor `src/services/supabase.ts` into cached `getPublicSupabase()`, `getPlayerSupabase()`, and `getAdminSupabase()` factories. Public config/analytics uses `persistSession:false`, `autoRefreshToken:false`, `detectSessionInUrl:false`, and a non-player storage key. Player Auth uses `persistSession:true`, `autoRefreshToken:true`, `detectSessionInUrl:false`, and exact key `btw.player.auth.v1`. Admin keeps the current default project storage key so the shipped operator session is not silently logged out. `src/admin/main.ts` switches only to `getAdminSupabase()`.

Provide the player client a tiny localStorage adapter owned by the factory. It exposes an application-only `clearPlayerSession()` that removes exactly `btw.player.auth.v1` and `btw.player.auth.v1-code-verifier`; no caller reaches or guesses Supabase's default project key.

- [ ] **Step 4: Implement strict response mapping**

`PlayerApi` accepts `Pick<SupabaseClient,'auth'|'functions'> | null` plus the factory's `clearPlayerSupabaseSession` callback. Every function response must have exact keys. Session payload tokens are passed only to `auth.setSession`; callers receive `PlayerProfile`, not tokens or internal email.

```ts
async login(profileName: string, pin: string): Promise<PlayerApiResult<PlayerProfile>> {
  if (!this.client) return fail('offline', '인터넷에 연결되면 로그인할 수 있어요.')
  const result = await this.client.functions.invoke('player-auth', {
    body: { action: 'login', profileName, pin },
  })
  const payload = parseSessionPayload(result.data)
  if (result.error || !payload) return fail('login_failed', 'ID 또는 PIN을 다시 확인해 주세요.')
  const stored = await this.client.auth.setSession({
    access_token: payload.accessToken,
    refresh_token: payload.refreshToken,
  })
  if (stored.error) return fail('service_unavailable', '연결을 확인한 뒤 다시 시도해 주세요.')
  return { ok: true, data: payload.profile }
}
```

Read the function response body/status before normalizing errors: preserve `rate_limited` plus `retryAfterSeconds`, map a flag race to `signup_closed` with `프로필 만들기를 다시 열면 바로 시작할 수 있어요.`, and keep missing/wrong/inactive login under the one `login_failed` message. Never collapse a 429 into a credential error or show an internal function message.

`restoreSession()` calls `auth.getSession()`. If null it returns `ok guest`; if present it invokes `{action:'session'}` with the stored JWT. A 401 clears only the local player session and returns guest. `signOut()` first calls `{scope:'local'}`. If that network revocation fails, it stops player auto-refresh and calls `clearPlayerSession()`; successful local removal still returns logout success because the current browser no longer possesses the refresh token. Only a local-storage removal failure keeps the signed-in state and maps to `이 기기에서 로그아웃을 다시 눌러 주세요.`. Tests prove this fallback never removes the admin/default or public keys.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/player/api.test.ts && npm run typecheck`

```bash
git add src/player/api.ts src/player/api.test.ts src/player/types.ts src/services/supabase.ts src/services/supabase.test.ts src/admin/main.ts
git commit -m "feat: add persistent player session API"
```

### Task 3: Make progress storage safely switchable by immutable user UUID

**Files:**
- Modify: `src/progress/store.ts`
- Modify: `src/progress/store.test.ts`
- Modify: `src/game-progress.ts`
- Modify: `src/game-progress.test.ts`

**Interfaces:**
- Produces: `progressStorageKey(scope)`, configurable `ProgressStore`, `GameProgressCoordinator.replaceState`.
- Consumers: Game scope switch and Plan 3 sync store.

- [ ] **Step 1: Write failing isolation and hydration tests**

```ts
expect(progressStorageKey({ kind: 'guest' })).toBe('btw.progress.v1')
expect(progressStorageKey({ kind: 'player', userId: '10000000-0000-0000-0000-000000000001' }))
  .toBe('btw.player.10000000-0000-0000-0000-000000000001.progress.v1')
```

Prove profile load does not read/remove `btw.bestCombo`, `btw.totalTargets`, or guest JSON; guest migration behavior remains unchanged. Prove `replaceState` validates a supplied state, clears recent dedupe keys/pending daily evidence, and does not call `save` or analytics.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/progress/store.test.ts src/game-progress.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add exact key and options contract**

```ts
export type ProgressScopeKey = { kind: 'guest' } | { kind: 'player'; userId: string }

export function progressStorageKey(scope: ProgressScopeKey): string {
  if (scope.kind === 'guest') return PROGRESS_STORAGE_KEY
  if (!isUuid(scope.userId)) throw new Error('invalid player user id')
  return `btw.player.${scope.userId}.progress.v1`
}

export interface ProgressStoreOptions {
  storageKey?: string
  migrateLegacy?: boolean
  knownWeaponIds?: readonly string[]
  knownMoveIds?: readonly string[]
  createInstallSeed?: () => string
  onMemoryFallback?: () => void
}
```

Import `isUuid` from the Plan 1 shared contract. Use `storageKey ?? PROGRESS_STORAGE_KEY`; run legacy migration only when `migrateLegacy ?? (storageKey === undefined)`. Player stores pass `migrateLegacy:false`.

- [ ] **Step 4: Add safe state replacement**

```ts
replaceState(next: ProgressStateV1): boolean {
  const parsed = parseProgress(next, [...this.knownWeaponIds], [...this.knownMoveIds], this.catalog)
  if (!parsed.installSeed) return false
  this.state = parsed
  this.recentEventKeys.length = 0
  this.recentEventSet.clear()
  this.clearPendingDailyEvidence()
  return true
}
```

Do not save, notify, unlock, or track from this method. Plan 3 uses it only after identity/revision guards.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/progress/store.test.ts src/game-progress.test.ts && npm run typecheck`

```bash
git add src/progress/store.ts src/progress/store.test.ts src/game-progress.ts src/game-progress.test.ts
git commit -m "refactor: isolate guest and player progress stores"
```

### Task 4: Add the record-book profile card and deterministic avatar

**Files:**
- Create: `src/player/avatar.ts`
- Create: `src/player/avatar.test.ts`
- Modify: `src/player/types.ts`
- Modify: `src/ui/recordbook.ts`
- Modify: `src/ui/recordbook.test.ts`
- Modify: `src/style.css`

**Interfaces:**
- Produces: `ProfileCardView`, `profileAvatar`, profile-aware `RecordBook.render`, and `onOpenProfile` callback.
- Consumers: Task 5 controller/view and Game wiring.

- [ ] **Step 1: Write failing card and avatar tests**

Assert the profile card is the first scroll child before daily quest; guest/signed-in/offline/saving copy; whole card is a button; avatar is stable across calls; hidden flag removes card from focus order; click fires once; re-render preserves focus.

- [ ] **Step 2: Define exact view model**

```ts
export type ProfileCardView =
  | { visible: false; kind: 'hidden' }
  | { visible: true; kind: 'guest'; title: '게스트로 즐기는 중'; detail: string }
  | {
      visible: true
      kind: 'player'
      displayName: string
      userId: string
      sync: 'saved'|'saving'|'offline'|'retry'
      lastSavedAt: string | null
    }

export function profileAvatar(userId: string, displayName: string): { initial: string; color: string } {
  const palette = ['#3156a3','#8452a5','#bc5b76','#b56a2d','#257a73','#5f6f2e'] as const
  let hash = 2166136261
  for (const char of userId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return { initial: Array.from(displayName)[0] ?? '?', color: palette[(hash >>> 0) % palette.length] }
}
```

- [ ] **Step 3: Render the card first**

Add `profile: ProfileCardView` to `RecordBook.render`. Add `onOpenProfile` to callbacks and include `data-recordbook-profile` in the existing focus-key restoration list. The card button has `data-recordbook-profile`, minimum 64px, avatar `aria-hidden=true`, title/detail text, and accessible name `프로필 열기`. For player status use:

- `saved`: `기록이 저장됐어요`
- `saving`: `기록을 저장하는 중이에요`
- `offline`: `연결되면 기록을 저장해요`
- `retry`: `기록 저장을 다시 확인해 주세요`

- [ ] **Step 4: Run tests, copy lint, and commit**

Run: `npm test -- src/player/avatar.test.ts src/ui/recordbook.test.ts && npm run lint:copy && npm run typecheck`

```bash
git add src/player/avatar.ts src/player/avatar.test.ts src/player/types.ts src/ui/recordbook.ts src/ui/recordbook.test.ts src/style.css
git commit -m "feat: add record-book profile card"
```

### Task 5: Implement the DOM-free account state controller

**Files:**
- Create: `src/player/controller.ts`
- Create: `src/player/controller.test.ts`

**Interfaces:**
- Consumes: `PlayerApi` and Task 3 `PlayerProgressScope`.
- Produces: `PlayerAccountController`, `PlayerAccountSnapshot`, monotonic `sessionGeneration`.
- Consumers: Task 6 view and Game boot.

- [ ] **Step 1: Write state-transition and race tests**

Cover immediate guest state, async restore, create name check invalidation, create zero scope, login, force change, logout success/failure, signup-disabled while login remains available, offline errors, and stale restore/login results after a newer logout/login.

```ts
const pending = deferred<PlayerApiResult<PlayerProfile>>()
api.login.mockReturnValueOnce(pending.promise)
const first = controller.login('예진', '024550')
await controller.logout()
pending.resolve(ok(profile('예진')))
await first
expect(controller.snapshot.kind).toBe('guest')
```

- [ ] **Step 2: Define exact snapshots and callbacks**

```ts
export type PlayerAccountSnapshot =
  | { kind: 'restoring'; card: ProfileCardView }
  | { kind: 'guest'; card: ProfileCardView; signupEnabled: boolean }
  | { kind: 'player'; profile: PlayerProfile; card: ProfileCardView; forcePinChange: boolean }

export interface PlayerAccountControllerOptions {
  api: PlayerApi
  onSnapshot(snapshot: PlayerAccountSnapshot): void
  onScope(scope: PlayerProgressScope, generation: number): void
}
```

The constructor emits guest synchronously. `start()` restores in the background. Each async action captures `generation`; only a matching generation may emit. Successful create/login emits player scope; successful logout increments generation then emits guest. Failed logout stays player and returns the API error.

- [ ] **Step 3: Implement duplicate-check state**

Store `{raw, normalizedKey, status:'idle'|'checking'|'available'|'taken'|'error'}`. Editing input sets `idle`. Creation requires the current normalized key to match an `available` result. A check result from an earlier input value is ignored.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/player/controller.test.ts && npm run typecheck`

```bash
git add src/player/controller.ts src/player/controller.test.ts
git commit -m "feat: coordinate player account state"
```

### Task 6: Build the full-screen profile flow and accessibility lifecycle

**Files:**
- Create: `src/player/view.ts`
- Create: `src/player/view.test.ts`
- Create: `src/player/style.css`
- Modify: `index.html`

**Interfaces:**
- Produces: `PlayerProfileView.open`, `.close`, `.render`, and form callbacks into the controller.
- Consumers: Task 7 boot wiring.

- [ ] **Step 1: Write DOM tests for every visible state**

Cover guest choice, signup disabled, ID format error, IME composition, check loading/available/taken, create notice/age checkbox, PIN mismatch, show PIN, login generic failure, force PIN change, signed-in summary, logout busy/error, Escape, backdrop, tab trap, underlying record book inertness, focus return to a re-rendered profile card, 320px semantics, and no future empty menus.

Assert these exact strings:

```ts
expect(root.textContent).toContain('새 프로필에서 첫 기록부터 새로 쌓아요. 지금 게스트 기록은 이 기기에 그대로 남아요.')
expect(root.textContent).toContain('ID 또는 PIN을 다시 확인해 주세요')
expect(root.textContent).not.toContain('Supabase')
expect(root.textContent).not.toContain('이메일')
expect(root.textContent).not.toContain('준비 중')
```

- [ ] **Step 2: Create the full-screen dialog shell**

Use one `<div role="dialog" aria-modal="true" aria-labelledby="player-profile-heading">` with fixed inset, safe-area padding, scroll body, visible `닫기`, and one live region. On open save a focus-return selector plus the current element, make all sibling surfaces including the open record book inert/`aria-hidden`, add `profile-open` to `<html>`, and push one same-URL history sentinel; this class disables Canvas pointer events and scrolling. A normal `popstate` closes the layer, while a forced-PIN-change `popstate` immediately restores one sentinel and keeps the required action visible without stacking entries. A close button consumes the sentinel through `history.back()` and runs the same cleanup once. On close remove listeners/class/inert state, then focus the original element if still connected or the current `[data-recordbook-profile]` after a record-book re-render. At no point may two modal surfaces be exposed to the accessibility tree.

- [ ] **Step 3: Implement guest, create, and login screens**

Guest screen has `새 프로필 만들기` and `내 프로필로 로그인`. Create screen is two-stage:

1. ID input plus `중복 확인`; compose events prevent validation before `compositionend`.
2. Available ID unlocks PIN, confirmation, privacy details, age checkbox, and `프로필 만들기`.

Login screen has ID, PIN, show button, submit, and back. All submit buttons set `disabled` and `aria-busy=true` while waiting. Network-required offline copy is `인터넷에 연결되면 프로필을 만들거나 로그인할 수 있어요. 게스트 플레이는 지금 바로 이어갈 수 있어요.`

- [ ] **Step 4: Implement signed-in and forced-change screens**

Signed-in screen shows avatar, profile ID, `마지막 저장` status, `다시 저장`, privacy notice link, and `로그아웃`. It does not show achievements/titles/avatar choices now. Forced-change screen cannot close through Escape, backdrop, browser back, or the normal close button. It asks for new PIN and confirmation, then shows signed-in state after success. A separate `로그아웃하고 게스트로 돌아가기` action signs out locally and switches to guest, so a temporary-PIN session never remains hidden behind guest UI.

- [ ] **Step 5: Add mobile/accessibility CSS and viewport rule**

```css
.player-profile-layer { position: fixed; inset: 0; z-index: 80; background: #f7f3e8; padding: max(16px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom)); overflow: auto; }
.player-profile-panel { width: min(100%, 480px); min-height: 100%; margin: 0 auto; }
.player-profile-layer button, .player-profile-layer input { min-height: 44px; }
.player-profile-layer input { font-size: 16px; }
.player-profile-primary { min-height: 48px; }
html.profile-open canvas { pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .player-profile-layer { scroll-behavior: auto; } }
```

Ensure viewport does not contain `maximum-scale=1` or `user-scalable=no`.

- [ ] **Step 6: Run tests, copy lint, and commit**

Run: `npm test -- src/player/view.test.ts && npm run lint:copy && npm run typecheck`

```bash
git add src/player/view.ts src/player/view.test.ts src/player/style.css index.html
git commit -m "feat: add accessible player profile flow"
```

### Task 7: Wire non-blocking boot and cancellation-safe progress scope changes

**Files:**
- Modify: `src/game.ts`
- Modify: `src/main.ts`
- Create: `src/player/integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: immediate guest boot, background session restore, `Game.setPlayerAccount`, and `Game.setProgressScope`.
- Consumer: Plan 3 remote sync integration.

- [ ] **Step 1: Write integration tests before wiring**

Test that Game construction does not await Auth, guest can dispatch before restore settles, profile switch cancels an active charge, guest checkpoint occurs before switch, profile state is zero on a first cache, logout restores prior guest state, two user UUIDs never share state, profile flag hides card but does not destroy a restored player cache, and stale scope callbacks are ignored.

- [ ] **Step 2: Factor progress coordinator creation in Game**

```ts
private createProgress(store: ProgressPersistence): GameProgressCoordinator {
  return new GameProgressCoordinator({
    store,
    catalog: this.progress?.questCatalog ?? BUILT_IN_CATALOG,
    dayKey: kstDayKey(new Date()),
    nowIso: () => new Date().toISOString(),
    notify: (notice) => this.hud.notify(notice),
    analytics: this.analytics,
    knownWeaponIds: KNOWN_WEAPON_IDS,
    knownMoveIds: KNOWN_MOVE_IDS,
    deferDailyAssignment: !this.questCatalogResolved,
    onDailyQuestTransition: (previous, next) => this.analytics.trackQuestTransition(previous, next, 'user', true),
  })
}
```

`setProgressScope(scope,generation)` ignores lower generations, cancels current action with existing `settingsMode`, checkpoints current scope, creates guest/profile store with exact key/migration policy, swaps coordinator, updates strong input/motion/skins/best/total/record book, then applies flags. Never recreate analytics because anonymous analytics remains install-scoped, not profile-scoped.

- [ ] **Step 3: Add profile card and open bridge**

Game stores the latest `PlayerAccountSnapshot`, maps it to `ProfileCardView`, and passes it to every `RecordBook.render`. `onOpenProfile` passes the profile-card button as the trigger to a callback supplied in `GameOptions`. `player_profiles_ui=false` hides only the guest discovery card; a signed-in card remains available for status/logout so a flag cannot trap an account.

- [ ] **Step 4: Boot PlayerApp after Game synchronously**

```ts
const publicClient = getPublicSupabase()
const playerClient = getPlayerSupabase()
let profileView: PlayerProfileView | null = null
const game = new Game(canvas, ui, { onOpenProfile: (trigger) => profileView?.open(trigger) })
const playerApi = new PlayerApi(playerClient, clearPlayerSupabaseSession)
const controller = new PlayerAccountController({
  api: playerApi,
  onSnapshot: (snapshot) => {
    game.setPlayerAccount(snapshot)
    profileView?.render(snapshot)
  },
  onScope: (scope, generation) => game.setProgressScope(scope, generation),
})
profileView = new PlayerProfileView(ui, controller)
controller.start()
```

Pass `publicClient` only to the existing remote-config and anonymous-analytics setup. Keep those starts independent; any PlayerApp error leaves guest mode and does not reject boot. No analytics request may use `playerClient`.

- [ ] **Step 5: Run focused and full tests/build**

Run:

```bash
npm test -- src/player src/progress/store.test.ts src/game-progress.test.ts src/ui/recordbook.test.ts src/config/quest-provider.test.ts
npm test
npm run lint:copy
npm run typecheck
npm run build
```

Expected: all existing and new tests PASS; both `dist/index.html` and `dist/admin.html` build; no player account call is required for guest play.

- [ ] **Step 6: Commit**

```bash
git add src/game.ts src/main.ts src/player/integration.test.ts
git commit -m "feat: connect guest-first player profiles"
```

## Plan 2 Completion Gate

Do not start Plan 3 until fresh evidence proves:

- game constructs and accepts guest input before Auth restore completes;
- guest key and every UUID profile key remain isolated across create/login/logout;
- a new profile state is all-zero/default and guest values never appear in it;
- record-book profile card is first, accessible, flag-aware, and the only entry point;
- create requires format, live-current duplicate check, PIN confirmation, privacy, and 14+ confirmation;
- session survives reload and local logout leaves other sessions intact;
- force-PIN-change cannot enter account gameplay with the temporary PIN unchanged;
- Canvas input, focus, browser back/Escape, 320px, 390x844, 200% zoom, and reduced motion behavior pass;
- full Vitest, copy lint, typecheck, and production build pass;
- player flags remain closed in built-in fallback.
