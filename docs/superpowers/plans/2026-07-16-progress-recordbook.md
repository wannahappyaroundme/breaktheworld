# Progress, Quest, and Record Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist valid play outcomes, migrate existing records, add one rotating daily challenge and five permanent stamps, and expose them through a restrained record-book sheet with accessible settings and queued notifications.

**Architecture:** Checked combat outcomes become typed `GameEvent`s. A pure reducer updates a versioned `ProgressStateV1`; `ProgressStore` validates and checkpoints it. Quest and achievement definitions are data catalogs over the same reducer. UI reads a view model and never calculates progress directly.

**Tech Stack:** Existing TypeScript/Vite/Vitest/DOM/CSS. No new runtime dependency. Plan C later supplies a remote catalog through the interface defined here.

## Global Constraints

- Plan A must be complete and green before this plan starts.
- Storage key is exactly `btw.progress.v1`; migrate `btw.bestCombo` and `btw.totalTargets` only after a successful new save.
- Store enums/counts/IDs only; never raw coordinates, user text, prompts, or PII.
- Demo/system actions never progress quests, stamps, or analytics.
- One daily challenge only; KST 04:00 day boundary; no streak, failure, expiry warning, or claim button.
- Permanent stamp catalog contains exactly five entries approved in the spec.
- Record book replaces the existing top `✨` button; do not add another top button.
- Challenge progress appears for four seconds after first progress, at 50%, and at completion only.
- Notification priority is record > achievement > quest > general; one visible item at a time.
- User-facing copy uses easy Korean and contains no em dash.
- Each task uses TDD and ends with a focused commit.

---

## File Map

```text
src/progress/events.ts             typed game events and source filtering
src/progress/types.ts              ProgressStateV1 and catalog contracts
src/progress/defaults.ts           validated defaults
src/progress/validate.ts           unknown JSON parsing and field recovery
src/progress/store.ts              storage adapter, migration, checkpoints
src/progress/reducer.ts            one progress state transition function
src/progress/day.ts                KST 04:00 day key
src/progress/catalog.ts            built-in quests and five stamps
src/progress/view-model.ts         UI-ready record-book model
src/ui/notification-queue.ts       priority/dedupe scheduler
src/ui/recordbook.ts               accessible bottom sheet
src/ui/settings.ts                 strong input, motion, haptics
src/ui/whatsnew.ts                 once-per-version update summary
src/ui/sharecard.ts                selected title and stamp frame
scripts/copy-lint.mjs              rendered-string scanner
src/game.ts                        event dispatch and UI wiring
src/ui/hud.ts                      record-book button and queue renderer
src/style.css                      sheet, stamp, chip, focus, reduced motion
```

### Task 1: Typed game events and pure progress reducer

**Files:**
- Create: `src/progress/events.ts`
- Create: `src/progress/types.ts`
- Create: `src/progress/defaults.ts`
- Create: `src/progress/reducer.ts`
- Create: `src/progress/reducer.test.ts`

**Interfaces:**
- Consumes: Plan A checked action/damage results.
- Produces: `GameEvent`, `ProgressStateV1`, `reduceProgress(state, event)`.
- Consumers: store, quest/achievement view model, analytics adapter in Plan C.

- [ ] **Step 1: Write failing reducer tests**

```ts
it('counts only user events that detach fragments', () => {
  const s = createDefaultProgress('seed')
  const ignored = reduceProgress(s, attack({ source: 'demo', detached: 4 }))
  expect(ignored.lifetime.validHits).toBe(0)
  const counted = reduceProgress(s, attack({ source: 'user', detached: 4 }))
  expect(counted.lifetime.validHits).toBe(1)
})

it('deduplicates an action id within a target run', () => {
  const once = reduceProgress(createDefaultProgress('seed'), destroyed({ actionId: 7, targetRunId: 2 }))
  const twice = reduceProgress(once, destroyed({ actionId: 7, targetRunId: 2 }))
  expect(twice.lifetime.totalTargets).toBe(1)
})
```

Add tests for best combo max, charged finisher count, by-weapon uses/finishes/seen moves, by-target destroys, distinct weapons, settings, and bounded integer counters.

- [ ] **Step 2: Run and confirm missing-module failure**

Run: `npm test -- src/progress/reducer.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define the exact event union**

```ts
export type EventSource = 'user' | 'demo' | 'system'
export type GameEvent =
  | { type: 'ATTACK_RESOLVED'; source: EventSource; actionId: number; targetRunId: number; weaponId: string; moveId: string; detached: number }
  | { type: 'CHARGE_RELEASED'; source: EventSource; actionId: number; targetRunId: number; weaponId: string; charge: number }
  | { type: 'TARGET_DESTROYED'; source: EventSource; actionId: number; targetRunId: number; weaponId: string; targetId: 'word' | 'earth' | 'city'; golden: boolean }
  | { type: 'WEAPON_USED'; source: EventSource; actionId: number; targetRunId: number; weaponId: string }
  | { type: 'COMBO_CHANGED'; source: EventSource; value: number }
  | { type: 'FEVER_STARTED'; source: EventSource; combo: number }
  | { type: 'SHARE_COMPLETED'; source: EventSource }
  | { type: 'SETTING_CHANGED'; key: 'strongInput'; value: 'hold' | 'doubleTap' }
  | { type: 'SETTING_CHANGED'; key: 'reducedMotion' | 'haptics'; value: boolean }
```

Use a bounded recent-set of the last 64 `actionId:targetRunId:eventType` keys in memory to reject duplicate settlement. Do not persist the dedupe cache.

- [ ] **Step 4: Implement the exact state shape**

```ts
export interface ProgressStateV1 {
  schemaVersion: 1
  catalogVersion: number
  installSeed: string
  lifetime: {
    validHits: number
    chargedFinishers: number
    totalTargets: number
    bestCombo: number
    stamps: number
    distinctWeaponIds: string[]
  }
  byWeapon: Record<string, { uses: number; finishes: number; seenMoves: string[] }>
  byTarget: Record<'word' | 'earth' | 'city', { destroys: number }>
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
  daily: {
    dayKey: string
    questId: string
    target: number
    progress: number
    distinctIds: string[]
    completedAt: string | null
    stampAwarded: boolean
  }
  profile: {
    selectedTitle: string | null
    skins: Record<string, string>
    strongInput: 'hold' | 'doubleTap'
    reducedMotion: boolean
    haptics: boolean
  }
}
```

`daily.distinctIds` is required so `characters_3` survives reload without borrowing lifetime history. Keep all ID arrays sorted and deduplicated inside the reducer. Increment `lifetime.stamps` once for each completed daily challenge; permanent achievements remain represented by `achievements` and are not added to that counter.

- [ ] **Step 5: Implement and verify reducer purity**

Return a new state only for accepted events. Never read `localStorage`, the clock, or the DOM inside the reducer. Clamp all counters to `[0, Number.MAX_SAFE_INTEGER]` and charge to `[0,1]`.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/progress/reducer.test.ts && npm run typecheck`

```bash
git add src/progress/events.ts src/progress/types.ts src/progress/defaults.ts src/progress/reducer.ts src/progress/reducer.test.ts
git commit -m "feat: add typed progress reducer"
```

### Task 2: Validation, legacy migration, and storage fallback

**Files:**
- Create: `src/progress/validate.ts`
- Create: `src/progress/store.ts`
- Create: `src/progress/store.test.ts`

**Interfaces:**
- Produces: `ProgressStore`, `StorageAdapter`, `loadResult.mode: 'persistent'|'memory'`.
- Consumes: defaults and reducer state.

- [ ] **Step 1: Write failing storage tests**

Cover: new install, valid load, malformed JSON, negative/Infinity/unknown IDs, blocked get/set, partial field recovery, legacy key migration, and the rule that legacy keys remain when the new write fails.

```ts
const storage = new FakeStorage({ 'btw.bestCombo': '42', 'btw.totalTargets': '19' })
const store = new ProgressStore(storage)
const loaded = store.load()
expect(loaded.state.lifetime.bestCombo).toBe(42)
expect(loaded.state.lifetime.totalTargets).toBe(19)
expect(storage.getItem('btw.bestCombo')).toBeNull()
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/progress/store.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement field-level validation**

`parseProgress(raw: unknown, knownWeaponIds, knownMoveIds)` starts from defaults and accepts only exact primitive types, finite non-negative integers, approved enum values, ISO timestamps, and known IDs. Unknown weapon/move entries are dropped; `daily.distinctIds` is restricted to the active quest's accepted IDs; one bad field never discards unrelated valid history.

- [ ] **Step 4: Implement checkpoint rules**

```ts
export type CheckpointReason = 'actionEnd' | 'targetDestroy' | 'unlock' | 'setting' | 'pagehide'

save(state: ProgressStateV1, reason: CheckpointReason): { ok: true } | { ok: false; mode: 'memory' }
```

The store writes only on those reasons. First failure switches the current session to memory mode and invokes one callback for the user notice. No retry loop is allowed for `localStorage` errors.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/progress/store.test.ts src/progress/reducer.test.ts`

```bash
git add src/progress/validate.ts src/progress/store.ts src/progress/store.test.ts
git commit -m "feat: add resilient progress storage"
```

### Task 3: KST day boundary, one daily challenge, and five stamps

**Files:**
- Create: `src/progress/day.ts`
- Create: `src/progress/catalog.ts`
- Create: `src/progress/catalog.test.ts`
- Create: `src/progress/view-model.ts`

**Interfaces:**
- Produces: `kstDayKey(date)`, `BUILT_IN_QUESTS`, `ACHIEVEMENTS`, `assignDailyQuest()`.
- Plan C implements the same `QuestCatalogProvider` interface remotely.

- [ ] **Step 1: Write day-boundary and catalog tests**

```ts
expect(kstDayKey(new Date('2026-07-15T18:59:59Z'))).toBe('2026-07-15')
expect(kstDayKey(new Date('2026-07-15T19:00:00Z'))).toBe('2026-07-16')
expect(BUILT_IN_QUESTS.map((q) => q.id)).toEqual(['charged_finisher_2', 'characters_3', 'targets_3'])
expect(ACHIEVEMENTS).toHaveLength(5)
```

Also assert that a stored daily quest is not rerolled when catalog order/version changes during the same day.

- [ ] **Step 2: Implement KST 04:00 calculation**

Format the instant in `Asia/Seoul`, subtract four wall-clock hours before extracting the `YYYY-MM-DD` key, and test both winter-equivalent offsets and month/year boundaries. Do not use the server timezone.

- [ ] **Step 3: Encode exact challenge and stamp definitions**

```ts
export const BUILT_IN_QUESTS = [
  { id: 'charged_finisher_2', copy: '꾹 와장창 2번', event: 'CHARGE_RELEASED', target: 2, accepts: (e) => e.type === 'CHARGE_RELEASED' && e.charge === 1 },
  { id: 'characters_3', copy: '캐릭터 3종 만나기', event: 'WEAPON_USED', target: 3, distinct: 'weaponId', accepts: isCharacterUse },
  { id: 'targets_3', copy: '타겟 3개 부수기', event: 'TARGET_DESTROYED', target: 3, accepts: isUserDestroy },
] as const
```

Encode the five approved stamps with their exact names and conditions:

- `first_destroy`: `첫 와장창`, target destroy 1
- `charge_master`: `꾹 와장창 장인`, max-charge releases 10
- `variety_10`: `골고루 파괴`, 10 distinct weapons
- `world_cycle`: `세상 한 바퀴`, all three target IDs
- `combo_50`: `콤보 폭주`, best combo 50

Use each unlocked stamp name as its selectable title. Daily progress notices emit only on the first accepted progress, the first crossing of 50%, and completion.

- [ ] **Step 4: Build a UI view model**

`makeRecordBookView(state, catalog)` returns only user-ready strings, progress numbers, complete/seen state, selected title, skin choices, and personal stat labels. It contains no DOM nodes and no mutation.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/progress/catalog.test.ts src/progress/reducer.test.ts`

```bash
git add src/progress/day.ts src/progress/catalog.ts src/progress/catalog.test.ts src/progress/view-model.ts
git commit -m "feat: add daily challenge and stamps"
```

### Task 4: Notification queue and record-book UI

**Files:**
- Create: `src/ui/notification-queue.ts`
- Create: `src/ui/notification-queue.test.ts`
- Create: `src/ui/recordbook.ts`
- Create: `src/ui/settings.ts`
- Modify: `src/combat/action-controller.ts`
- Modify: `src/combat/action-controller.test.ts`
- Modify: `src/ui/hud.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: record-book view model and store callbacks.
- Produces: one visible notification, accessible sheet open/close, settings changes.

- [ ] **Step 1: Write queue tests**

Test priority ordering, same-key dedupe, current item not preempted mid-animation, four-second challenge notice, and exactly one completion notice when multiple reducer events unlock the same stamp.

```ts
queue.push({ key: 'quest:q1', kind: 'quest', text: '오늘의 도전 완료', durationMs: 2000 })
queue.push({ key: 'record:50', kind: 'record', text: '최고 연속 50', durationMs: 1800 })
expect(queue.next()?.kind).toBe('record')
```

- [ ] **Step 2: Implement the queue**

Priority numeric values are `record=40`, `achievement=30`, `quest=20`, `general=10`. The queue owns timing and calls one `onShow`/`onHide`; HUD no longer appends independent toast DOM nodes.

- [ ] **Step 3: Implement the record book**

Replace `✨` with a `button` whose accessible name is `기록책 열기`. The bottom sheet uses `role="dialog"`, `aria-modal="true"`, a visible heading, close button, focus return, Escape handling, backdrop close, and touch propagation blocking. Sections appear in this order: 오늘의 도전, 부순 기록, 캐릭터 모습, 내 기록.

- [ ] **Step 4: Implement settings**

Controls are native buttons/switches with these labels and values:

- `강타 방식`: `꾹 누르기` or `두 번 탭`
- `움직임 줄이기`: on/off
- `진동`: on/off

Changing a setting dispatches `SETTING_CHANGED`, checkpoints immediately, and updates Game/ActionController without reload.

For `doubleTap`, hold a completed first tap for 280ms. A second tap within 280ms and 32px cancels the pending quick action and dispatches one `charged` action with `charge=1`; timeout dispatches the original quick action once. Drag, target change, reset, visibility loss, or weapon change cancels the pending tap without damage. Add fake-clock tests for the 279/280ms and 31/32px boundaries, duplicate release, and cancellation. The default remains `hold`, so the base interaction has no added tap delay.

- [ ] **Step 5: Add restrained styling**

Use the current navy panel, yellow accent, one-color stamp, 44px controls, safe-area bottom padding, and no rainbow outside FEVER. Add `@media (prefers-reduced-motion: reduce)` and explicit focus-visible outlines. The sheet must fit 320px-wide screens and scroll internally.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- src/ui/notification-queue.test.ts src/combat/action-controller.test.ts src/progress && npm run build`

- [ ] **Step 7: Commit**

```bash
git add src/ui/notification-queue.ts src/ui/notification-queue.test.ts src/ui/recordbook.ts src/ui/settings.ts src/combat/action-controller.ts src/combat/action-controller.test.ts src/ui/hud.ts src/style.css
git commit -m "feat: add record book and queued notices"
```

### Task 5: Wire progress into gameplay, skins, share card, and update notice

**Files:**
- Create: `src/game-progress.test.ts`
- Modify: `src/game.ts`
- Modify: `src/main.ts`
- Modify: `src/ui/sharecard.ts`
- Modify: `src/ui/whatsnew.ts`
- Modify: `src/weapons/characters.ts`
- Modify: `src/art/assets.ts`

**Interfaces:**
- Consumes: Plan A action resolutions and all Plan B progress modules.
- Produces: persisted gameplay, selectable skins, stamped share card, once-per-version notice.

- [ ] **Step 1: Add an event wiring integration test**

Use a fake action source, store, and UI callbacks. Assert one valid destroy updates total, quest, achievement, queue, and one checkpoint; demo destroy updates none; max charge updates the daily challenge once; skin change changes the asset resolver without changing weapon stats.

- [ ] **Step 2: Wire the event flow**

Create one `dispatch(event)` method in Game: reduce state, detect unlock/progress transitions, save for the appropriate reason, enqueue notices, refresh HUD/record-book view, and pass the accepted event to an optional analytics sink. No weapon or HUD directly mutates progress.

- [ ] **Step 3: Apply selected skins**

The character asset resolver reads `state.profile.skins.cinnamoroll|ditto`, maps `default|classic` to the existing current/old asset names, and falls back to default for missing/corrupt choices.

- [ ] **Step 4: Update the share card**

Add `title: string | null` and `stampFrame: boolean` to `ShareStats`. Render the selected title in a legible line above the challenge text and use a restrained one-color stamp border. Keep the existing best and total stats.

- [ ] **Step 5: Make what's-new versioned**

Use key `btw.whatsnew.2026-07-16`. Show automatically only when the key is absent; closing sets it. Replace the list with short items:

```ts
const ITEMS = [
  { e: '👆', t: '짧게 톡, 길게 꾹. 누르는 방법에 따라 공격이 달라졌어요.' },
  { e: '🎭', t: '캐릭터마다 세 가지 기술로 다르게 부숴요.' },
  { e: '📖', t: '오늘의 도전과 부순 기록을 기록책에서 확인해요.' },
  { e: '🎨', t: '시나모롤과 메타몽의 클래식 모습을 골라요.' },
]
```

- [ ] **Step 6: Run tests and build**

Run: `npm test && npm run build && npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add src/game-progress.test.ts src/game.ts src/main.ts src/ui/sharecard.ts src/ui/whatsnew.ts src/weapons/characters.ts src/art/assets.ts
git commit -m "feat: connect progress quests and skins"
```

### Task 6: Mechanical copy gate and mobile browser verification

**Files:**
- Create: `scripts/copy-lint.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`
- Test: all rendered-string source files

**Interfaces:**
- Produces: `npm run lint:copy` and CI failure on forbidden rendered strings.

- [ ] **Step 1: Write the scanner**

The script recursively reads `index.html` and `src/**/*.ts`, extracts quoted/template string literals conservatively, and fails when rendered Korean copy contains `—` or any approved forbidden term list. Ignore comments, test fixtures, internal enum identifiers, and the scanner's own rules file.

```js
const forbidden = ['—', 'OCR', '리드', 'Kanban', '심의 완료']
if (hits.length) {
  process.stderr.write(hits.map((h) => `${h.file}:${h.line} ${h.term}`).join('\n') + '\n')
  process.exit(1)
}
```

- [ ] **Step 2: Wire scripts and CI**

Add `"lint:copy": "node scripts/copy-lint.mjs"`. Run it before tests/build in the Pages workflow. Remove the automatic `push: main` trigger and keep `workflow_dispatch` only, so merging code cannot deploy production without the later explicit approval gate. Map GitHub Actions repository variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` into the build job; empty variables keep the static offline build valid.

- [ ] **Step 3: Run the full automated gate**

Run: `npm run lint:copy && npm test && npm run build && npm run typecheck`

Expected: all PASS.

- [ ] **Step 4: Run browser verification**

At 390×844 verify: no startup modal after version seen, quest notice appears only at first progress/50%/complete, record book focus/scroll/close, all five stamp conditions, automatic rewards, skin selection, personal stats, settings live update, memory-mode notice once, share card title, notification priority, 320px width, reduced motion, and no console errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/copy-lint.mjs package.json .github/workflows/deploy.yml
git commit -m "test: enforce product copy rules"
```

## Plan B Completion Gate

- Legacy records migrate only after a successful `btw.progress.v1` write.
- One challenge and five stamps update only from accepted user events.
- KST 04:00 boundary and same-day non-reroll behavior are tested.
- Record book is keyboard/touch accessible and adds no permanent top control.
- Notifications never overlap and reward collection is automatic.
- Copy lint, tests, typecheck, build, and 390×844 browser verification pass.
