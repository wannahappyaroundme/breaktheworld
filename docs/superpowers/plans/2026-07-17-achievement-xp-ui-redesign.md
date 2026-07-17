# Achievement XP and UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 32 public achievements, derived XP and 20 cosmetic-only levels, a full-screen game hub, and one coherent “midnight sticker arcade” visual system across gameplay and profiles without losing existing progress.

**Architecture:** Keep the Vite/Canvas game engine and operation-based sync. Add one immutable pure-data achievement catalog shared by the browser and Edge Function, derive XP/level from server-recognized achievement IDs, and extend the existing schema additively for selected cosmetics. Replace the text-only record-book sheet with an accessible DOM hub while retaining the current progress coordinator, notification queue, profile controller, and Supabase security boundaries.

**Tech Stack:** Vite 5, TypeScript, Canvas 2D, DOM/CSS, Vitest, Supabase Auth/Postgres/Edge Functions, pgTAP, GitHub Pages.

## Global Constraints

- Approved product spec: `docs/superpowers/specs/2026-07-17-achievement-xp-ui-redesign-design.md`, especially Sections 4-13.
- Stack is fixed; do not migrate away from Vite 5, TypeScript, Canvas 2D, or Supabase.
- All 32 achievement names, IDs, conditions, tiers, and XP values are immutable and must match design spec Section 5.
- Tier counts are exactly easy 10, normal 10, hard 8, master 4; total permanent XP is exactly 4,700.
- XP and level are derived values, never incremented or stored as mutable counters.
- Logged-in progress is server-authoritative; client unlock timestamps are not trusted.
- Guest play uses the same catalog locally; guest progress is not imported into profiles.
- Existing five achievement IDs, names, earliest trusted timestamps, selected titles, skins, and settings must survive.
- Today’s challenge continues to award stamps only; it grants no repeatable XP.
- No stats, currency, store, energy, leaderboard, PvP, streak penalty, season system, or hidden achievement.
- No raw coordinates, profile IDs, PINs, user copy, or PII in logs or analytics.
- Rendered Korean uses easy positive language and contains no em dash.
- Minimum interactive target is 44px; primary choices are 48px; text inputs are 16px or larger.
- Support 320/360/390/430px, 200% text zoom, reduced motion, keyboard, screen readers, iOS Safari, and Android Chrome.
- `gamification_enabled` is the existing emergency gate; do not add a seventh feature-flag row.
- Backend compatibility ships before the new frontend. Production deployment still requires a separate explicit approval.

## File Structure

### New files

- `supabase/functions/_shared/achievement-catalog.ts`: immutable catalog, structural progress evaluator, XP/level math, cosmetic requirements.
- `supabase/migrations/202607170005_achievement_progress.sql`: additive profile defaults, analytics dimensions/events, v2 analytics RPC/view.
- `supabase/rollbacks/202607170005_achievement_progress.down.sql`: safe rollback that preserves unused enum values but removes v2 objects and restores prior defaults/view.
- `src/ui/hud.test.ts`: focused compact-HUD, menu, level, and live-region behavior tests.

### Primary modified files

- `src/progress/catalog.ts`: daily quests plus re-exports/wrappers for shared achievements.
- `src/progress/types.ts`, `defaults.ts`, `validate.ts`, `view-model.ts`: additive cosmetic state and hub-ready derived view.
- `src/game-progress.ts`: grouped unlock/backfill notifications and cosmetic selection.
- `supabase/functions/_shared/player-sync-contract.ts`, `player-sync-handler.ts`: server recomputation, old/new state normalization, cosmetic authorization.
- `src/ui/recordbook.ts`, `src/style.css`: full-screen hub and shared game tokens.
- `src/ui/hud.ts`, `src/weapons/bar.ts`: compact level entry, more menu, improved weapon cards.
- `src/player/view.ts`, `src/player/style.css`: visually unified entry/profile flows and explicit progress states.
- `src/game.ts`, `src/ui/sharecard.ts`: level/hub/cosmetic wiring.
- `src/analytics/client.ts`, `game-bridge.ts`, shared analytics contract/handler: approved enum/dimension telemetry.
- `src/admin/api.ts`, `view.ts`, `style.css`: read-only achievement and level metrics.
- Existing colocated tests and `supabase/tests/*.sql`: all regression coverage.

---

### Task 1: Immutable 32-achievement catalog and derived progression math

**Files:**
- Create: `supabase/functions/_shared/achievement-catalog.ts`
- Modify: `supabase/functions/_shared/weapon-ids.ts`
- Modify: `src/progress/catalog.ts`
- Test: `src/progress/catalog.test.ts`
- Test: `src/player/player-sync-contract.test.ts`

**Interfaces:**
- Produces: `ACHIEVEMENT_CATALOG`, `ACHIEVEMENT_CATALOG_VERSION`, `achievementProgress`, `achievementReached`, `totalAchievementXp`, `levelProgress`, `availableFrameIds`, `availableThemeIds`.
- Consumes: the existing progress shape’s `lifetime`, `byWeapon`, `byTarget`, and `achievements` only.
- Preserves: existing daily quest exports and the five legacy achievement IDs.

- [ ] **Step 1: Add failing catalog invariant tests**

Add tests that express the approved contract before implementation:

```ts
it('defines the approved immutable achievement and XP contract', () => {
  expect(ACHIEVEMENTS).toHaveLength(32)
  expect(new Set(ACHIEVEMENTS.map(({ id }) => id)).size).toBe(32)
  expect(countBy(ACHIEVEMENTS, 'tier')).toEqual({
    easy: 10,
    normal: 10,
    hard: 8,
    master: 4,
  })
  expect(ACHIEVEMENTS.reduce((sum, item) => sum + item.xp, 0)).toBe(4_700)
  expect(ACHIEVEMENTS.filter(({ titleReward }) => titleReward).map(({ name }) => name)).toEqual([
    '산산조각',
    '최애의 한 방',
    '끊기지 않는 손',
    '기술 박사',
    '무기 도감 완성',
    '모든 손의 마무리',
    '세계 순환 전문가',
    '모든 무기의 달인',
  ])
})

it('keeps every legacy achievement identity and title', () => {
  expect(pickAchievementNames([
    'first_destroy', 'charge_master', 'variety_10', 'world_cycle', 'combo_50',
  ])).toEqual([
    '첫 와장창', '꾹 와장창 장인', '골고루 파괴', '세상 한 바퀴', '콤보 폭주',
  ])
})
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
npm test -- src/progress/catalog.test.ts src/player/player-sync-contract.test.ts
```

Expected: FAIL because the catalog still contains five definitions and has no XP/level exports.

- [ ] **Step 3: Define the shared catalog types and structural evaluator**

Implement a dependency-free file usable by Vite and Deno:

```ts
export type AchievementTier = 'easy' | 'normal' | 'hard' | 'master'
export type AchievementCategory = 'destruction' | 'skill' | 'exploration' | 'journey'

export type AchievementCondition =
  | { kind: 'lifetime'; field: 'validHits' | 'chargedFinishers' | 'totalTargets' | 'bestCombo' | 'stamps'; target: number }
  | { kind: 'maxWeapon'; field: 'uses' | 'finishes'; target: number }
  | { kind: 'movePairs'; target: number }
  | { kind: 'distinctWeapons'; target: number }
  | { kind: 'distinctFinishers'; target: number }
  | { kind: 'distinctCharacters'; target: number }
  | { kind: 'worldTargets'; target: 3 }
  | { kind: 'allTargets'; targetEach: number }
  | { kind: 'weaponsAtUses'; weaponCount: number; usesEach: number }

export interface AchievementDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: AchievementCategory
  readonly tier: AchievementTier
  readonly xp: 50 | 100 | 200 | 400
  readonly icon: string
  readonly condition: AchievementCondition
  readonly titleReward: boolean
}

export interface AchievementProgressSource {
  lifetime: {
    validHits: number
    chargedFinishers: number
    totalTargets: number
    bestCombo: number
    stamps: number
    distinctWeaponIds: string[]
  }
  byWeapon: Record<string, { uses: number; finishes: number; seenMoves: string[] }>
  byTarget: { word: { destroys: number }; earth: { destroys: number }; city: { destroys: number } }
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
}

export const ACHIEVEMENT_CATALOG_VERSION = 2
export const TIER_XP = Object.freeze({ easy: 50, normal: 100, hard: 200, master: 400 })
export const LEVEL_THRESHOLDS = Object.freeze([
  0, 50, 100, 200, 300, 450, 600, 800, 1_000, 1_250,
  1_500, 1_800, 2_100, 2_450, 2_800, 3_200, 3_600, 4_000, 4_400, 4_700,
] as const)
```

Encode the exact 32 definitions from design spec Section 5. Export the nine canonical character IDs from `weapon-ids.ts`; do not duplicate them inside predicates.

- [ ] **Step 4: Implement deterministic progress, XP, level, and cosmetic helpers**

Use bounded pure functions:

```ts
export function achievementProgress(
  definition: AchievementDefinition,
  state: AchievementProgressSource,
): number {
  const condition = definition.condition
  switch (condition.kind) {
    case 'lifetime': return Math.min(state.lifetime[condition.field], condition.target)
    case 'maxWeapon': return Math.min(
      Math.max(0, ...Object.values(state.byWeapon).map((item) => item[condition.field])),
      condition.target,
    )
    case 'movePairs': return Math.min(
      Object.values(state.byWeapon).reduce((sum, item) => sum + new Set(item.seenMoves).size, 0),
      condition.target,
    )
    case 'distinctWeapons': return Math.min(new Set(state.lifetime.distinctWeaponIds).size, condition.target)
    case 'distinctFinishers': return Math.min(
      Object.values(state.byWeapon).filter(({ finishes }) => finishes > 0).length,
      condition.target,
    )
    case 'distinctCharacters': return Math.min(
      CHARACTER_WEAPON_IDS.filter((id) => (state.byWeapon[id]?.uses ?? 0) > 0).length,
      condition.target,
    )
    case 'worldTargets': return (['word', 'earth', 'city'] as const)
      .filter((id) => state.byTarget[id].destroys > 0).length
    case 'allTargets': return Math.min(
      ...(['word', 'earth', 'city'] as const).map((id) => state.byTarget[id].destroys),
      condition.targetEach,
    )
    case 'weaponsAtUses': return Math.min(
      Object.values(state.byWeapon).filter(({ uses }) => uses >= condition.usesEach).length,
      condition.weaponCount,
    )
  }
}

export function totalAchievementXp(state: Pick<AchievementProgressSource, 'achievements'>): number {
  const unlocked = new Set(Object.keys(state.achievements))
  return ACHIEVEMENT_CATALOG.reduce((sum, item) => sum + (unlocked.has(item.id) ? item.xp : 0), 0)
}

export function levelProgress(xp: number) {
  const safeXp = Number.isSafeInteger(xp) && xp > 0 ? Math.min(xp, 4_700) : 0
  let index = 0
  for (let candidate = 1; candidate < LEVEL_THRESHOLDS.length; candidate += 1) {
    if (LEVEL_THRESHOLDS[candidate] > safeXp) break
    index = candidate
  }
  const level = Math.max(1, index + 1)
  const current = LEVEL_THRESHOLDS[level - 1]
  const next = LEVEL_THRESHOLDS[level] ?? current
  return { level, xp: safeXp, current, next, progress: next === current ? 1 : (safeXp - current) / (next - current) }
}
```

- [ ] **Step 5: Run catalog tests and verify pass**

Run the focused command from Step 2.

Expected: PASS with 32 items, the exact tier distribution, 4,700 XP, and all legacy IDs intact.

- [ ] **Step 6: Commit catalog work**

```bash
git add supabase/functions/_shared/achievement-catalog.ts supabase/functions/_shared/weapon-ids.ts src/progress/catalog.ts src/progress/catalog.test.ts src/player/player-sync-contract.test.ts
git commit -m "feat: add achievement xp catalog"
```

---

### Task 2: Local progress compatibility, cosmetics, and grouped unlocks

**Files:**
- Modify: `src/progress/types.ts`
- Modify: `src/progress/defaults.ts`
- Modify: `src/progress/validate.ts`
- Modify: `src/progress/store.test.ts`
- Modify: `src/game-progress.ts`
- Modify: `src/game-progress.test.ts`

**Interfaces:**
- Produces profile fields: `frameId: ProfileFrameId`, `recordBookThemeId: RecordBookThemeId`.
- Produces coordinator methods: `selectFrame(id)`, `selectRecordBookTheme(id)`.
- Produces grouped notice text with total XP and optional level transition.
- Preserves `schemaVersion: 1` and the current local storage key.

- [ ] **Step 1: Add failing old-state and cosmetic authorization tests**

```ts
it('loads an old schema-one state with default cosmetics and all valid legacy progress', () => {
  const parsed = parseProgress(legacyState, KNOWN_WEAPON_IDS, KNOWN_MOVE_IDS)
  expect(parsed.schemaVersion).toBe(1)
  expect(parsed.profile.frameId).toBe('default')
  expect(parsed.profile.recordBookThemeId).toBe('default')
  expect(parsed.achievements.first_destroy).toEqual(legacyState.achievements.first_destroy)
})

it('rejects a locked frame and saves an unlocked frame exactly once', () => {
  const coordinator = setupCoordinator(stateAtXp(299))
  expect(coordinator.selectFrame('first_crack')).toBe(false)
  coordinator.replaceState(stateAtXp(300))
  expect(coordinator.selectFrame('first_crack')).toBe(true)
  expect(coordinator.state.profile.frameId).toBe('first_crack')
  expect(save).toHaveBeenCalledTimes(1)
})

it('groups simultaneous unlocks and XP into one achievement notice', () => {
  const result = coordinator.dispatch(firstDestroyBatch, 'targetDestroy')
  expect(result.unlockedIds).toEqual(['first_hit', 'first_destroy'])
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'achievement',
    text: '업적 2개 달성, 경험치 +100',
  }))
})
```

- [ ] **Step 2: Run focused tests and verify fail**

```bash
npm test -- src/progress/store.test.ts src/game-progress.test.ts
```

Expected: FAIL because cosmetics do not exist and unlock notices are emitted individually.

- [ ] **Step 3: Extend the additive profile state and parser**

Add exact enums and defaults:

```ts
export type ProfileFrameId = 'default' | 'first_crack' | 'electric_night' | 'coral_burst' | 'legend_crown'
export type RecordBookThemeId = 'default' | 'electric_night' | 'coral_burst' | 'legend_crown'

profile: {
  selectedTitle: string | null
  skins: Record<string, string>
  frameId: ProfileFrameId
  recordBookThemeId: RecordBookThemeId
  strongInput: 'hold' | 'doubleTap'
  reducedMotion: boolean
  haptics: boolean
}
```

`parseProfile` accepts only catalog-approved IDs, defaults missing values, and drops locked/unknown values during server projection normalization. Do not change the root schema version or storage key.

- [ ] **Step 4: Replace per-event unlock notifications with one batch result**

Return exact transition data:

```ts
export interface ProgressDispatchResult {
  accepted: number
  state: ProgressStateV1
  unlockedIds: string[]
  xpGained: number
  previousLevel: number
  nextLevel: number
}
```

Within one dispatch, collect all newly unlocked IDs, calculate `xpGained` from catalog definitions, and enqueue one notice. Preserve notification priority. Daily notices follow the grouped achievement notice.

- [ ] **Step 5: Add level-gated selection**

```ts
selectFrame(id: ProfileFrameId): boolean {
  if (!availableFrameIds(levelProgress(totalAchievementXp(this.state)).level).includes(id)) return false
  if (this.state.profile.frameId === id) return false
  this.state = { ...this.state, profile: { ...this.state.profile, frameId: id } }
  this.store.save(this.state, 'setting')
  return true
}
```

Implement the equivalent theme method. Reset an impossible projected selection to `default`; never remove existing character skins.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/progress/store.test.ts src/game-progress.test.ts src/progress/catalog.test.ts
git add src/progress/types.ts src/progress/defaults.ts src/progress/validate.ts src/progress/store.test.ts src/game-progress.ts src/game-progress.test.ts
git commit -m "feat: derive local xp and cosmetic progress"
```

Expected: all focused tests PASS.

---

### Task 3: Server-authoritative achievements and backward-compatible sync

**Files:**
- Modify: `supabase/functions/_shared/player-sync-contract.ts`
- Modify: `supabase/functions/_shared/player-sync-handler.ts`
- Modify: `src/player/player-sync-contract.test.ts`
- Modify: `src/player/player-sync-handler.test.ts`
- Modify: `src/player/sync-client.test.ts`
- Modify: `src/player/sync-store.test.ts`

**Interfaces:**
- Consumes: unchanged operation version 1 plus optional `frameId` and `recordBookThemeId` setting keys.
- Produces: normalized schema-one state with 32 server-evaluated achievements.
- Security rule: server applies counters, recomputes reachability, then merges `seen`; it never trusts incoming `unlockedAt`.

- [ ] **Step 1: Add failing adversarial sync tests**

```ts
it('ignores a forged unlock timestamp and only unlocks reached achievements', () => {
  const forged = operation({
    achievements: {
      weapons_21x25: { unlockedAt: '2000-01-01T00:00:00.000Z', seen: true },
    },
  })
  const next = applyPlayerOperation(emptyState(), accepted(forged, SERVER_NOW))
  expect(next.achievements.weapons_21x25).toBeUndefined()
})

it('uses the trusted accepted time after counters satisfy a condition', () => {
  const next = applyPlayerOperation(emptyState(), accepted(operation({ validHits: 1 }), SERVER_NOW))
  expect(next.achievements.first_hit).toEqual({ unlockedAt: SERVER_NOW, seen: false })
})

it('accepts an old state without cosmetic fields and preserves old operations', async () => {
  const response = await syncOldClientStateAndOperation()
  expect(response.status).toBe(200)
  expect(response.state.profile).toMatchObject({ frameId: 'default', recordBookThemeId: 'default' })
})

it('rejects selecting a cosmetic before the server-derived required level', () => {
  const next = applyPlayerOperation(emptyState(), accepted(operation({
    settings: { frameId: 'legend_crown' },
  }), SERVER_NOW))
  expect(next.profile.frameId).toBe('default')
})
```

- [ ] **Step 2: Run sync tests and verify fail**

```bash
npm test -- src/player/player-sync-contract.test.ts src/player/player-sync-handler.test.ts src/player/sync-client.test.ts src/player/sync-store.test.ts
```

Expected: FAIL on the five-achievement cap, forged timestamp behavior, and missing cosmetics.

- [ ] **Step 3: Normalize old and new stored projections**

Replace exact old-profile parsing with a compatibility normalizer that requires the legacy keys, permits only the two approved optional cosmetic keys, fills defaults, and rejects all other unknown keys. Raise the achievement cap to exactly the catalog length rather than a free numeric constant.

```ts
const allowedProfileKeys = new Set([
  'selectedTitle', 'skins', 'strongInput', 'reducedMotion', 'haptics',
  'frameId', 'recordBookThemeId',
])
if (Object.keys(value.profile).some((key) => !allowedProfileKeys.has(key))) return null
```

- [ ] **Step 4: Make server recomputation authoritative**

Split account application into two modes:

```ts
type AchievementAuthority = 'server' | 'optimistic'

function applyAccountDelta(
  input: SyncProgressState,
  operation: PlayerProgressOperationV1,
  trustedAt: string,
  authority: AchievementAuthority,
): SyncProgressState
```

For `server`, ignore incoming timestamps, apply all bounded counter deltas, then loop through `ACHIEVEMENT_CATALOG` and create only reached records with `trustedAt`. Merge `seen=true` only after reachability is established. For `optimistic`, use `createdAt` so offline UI remains responsive, knowing the later server projection is final.

- [ ] **Step 5: Authorize cosmetic settings from derived level**

Extend the exact settings parser with `frameId` and `recordBookThemeId`. In application, derive XP/level from the recomputed state and apply a selection only when the corresponding required level is satisfied. Unknown or locked IDs leave the previous selection unchanged.

- [ ] **Step 6: Preserve deterministic multi-device merging**

Extend the existing 200-sample grouping/property test so random accepted operations are reduced in one batch and multiple batch groupings with identical final counters. Assert equal achievement IDs, XP, level, and cosmetics in every grouping.

- [ ] **Step 7: Run sync suite and commit**

```bash
npm test -- src/player/player-sync-contract.test.ts src/player/player-sync-handler.test.ts src/player/sync-client.test.ts src/player/sync-store.test.ts src/player/outbox.test.ts
git add supabase/functions/_shared/player-sync-contract.ts supabase/functions/_shared/player-sync-handler.ts src/player/player-sync-contract.test.ts src/player/player-sync-handler.test.ts src/player/sync-client.test.ts src/player/sync-store.test.ts
git commit -m "security: validate achievement xp on server"
```

Expected: all sync tests PASS, including old-client and forged-unlock cases.

---

### Task 4: Postgres defaults, safe analytics dimensions, and pgTAP coverage

**Files:**
- Create: `supabase/migrations/202607170005_achievement_progress.sql`
- Create: `supabase/rollbacks/202607170005_achievement_progress.down.sql`
- Modify: `supabase/tests/player_sync.sql`
- Modify: `supabase/tests/operations.sql`
- Modify: `supabase/functions/_shared/analytics-contract.ts`
- Modify: `supabase/functions/_shared/ingest-handler.ts`
- Modify: `src/analytics/function-contract.test.ts`
- Modify: `src/analytics/function-handler.test.ts`

**Interfaces:**
- Keeps `ingest_analytics` v1 for old Edge Functions.
- Adds `ingest_analytics_v2(..., p_dimension text)` and `analytics_events.dimension`.
- Adds enum events: `achievement_hub_opened`, `achievement_unlocked`, `level_reached`, `cosmetic_selected`, `profile_step_viewed`.
- Updates new-player JSON defaults to catalog version 2 and default cosmetic IDs.

- [ ] **Step 1: Add failing analytics and pgTAP cases**

```ts
it('accepts approved progress dimensions without accepting arbitrary text', () => {
  expect(validateAnalyticsBatch([payload({
    eventType: 'achievement_unlocked', dimension: 'first_hit', value: 50,
  })])).toMatchObject({ ok: true })
  expect(validateAnalyticsBatch([payload({
    eventType: 'achievement_unlocked', dimension: 'user supplied text', value: 50,
  })])).toEqual({ ok: false })
})
```

Add pgTAP assertions that new profiles default to catalog version 2, default cosmetics, old v1 RPC remains executable, v2 rejects an unapproved dimension, and authenticated non-admin users still cannot read analytics rows.

- [ ] **Step 2: Run tests and verify fail**

```bash
npm test -- src/analytics/function-contract.test.ts src/analytics/function-handler.test.ts
supabase test db
```

Expected: unit tests FAIL for unknown event fields; pgTAP FAIL before the migration is applied.

- [ ] **Step 3: Write the additive migration**

The migration must:

```sql
alter type public.analytics_event_type add value if not exists 'achievement_hub_opened';
alter type public.analytics_event_type add value if not exists 'achievement_unlocked';
alter type public.analytics_event_type add value if not exists 'level_reached';
alter type public.analytics_event_type add value if not exists 'cosmetic_selected';
alter type public.analytics_event_type add value if not exists 'profile_step_viewed';

alter table public.analytics_events
  add column dimension text,
  add constraint analytics_dimension_shape
    check (dimension is null or dimension ~ '^[a-z0-9_]{1,64}$');
```

Recreate `analytics_daily` grouping by `dimension`, add a six-argument `ingest_analytics_v2`, keep the five-argument function unchanged, and update `new_player_progress_state` to emit `catalogVersion: 2`, `frameId: 'default'`, and `recordBookThemeId: 'default'`.

- [ ] **Step 4: Validate exact event/dimension combinations in code and SQL**

Use code allowlists from the immutable achievement and cosmetic catalogs. Rules:

```ts
const EVENT_VALUE_RULES = {
  achievement_hub_opened: { dimensions: ['hud', 'notice', 'profile'], min: 1, max: 1 },
  achievement_unlocked: { dimensions: achievementIds, allowedValues: [50, 100, 200, 400] },
  level_reached: { dimensions: levelDimensions, min: 2, max: 20 },
  cosmetic_selected: { dimensions: cosmeticIds, min: 1, max: 1 },
  profile_step_viewed: { dimensions: ['choice', 'id', 'pin', 'complete'], min: 1, max: 1 },
} as const
```

Old events require `dimension: null`. The v2 RPC repeats the same bounded checks server-side before inserting.

- [ ] **Step 5: Write the rollback**

The rollback drops `ingest_analytics_v2`, restores the old view, drops the dimension constraint/column, and restores catalog version 1/default profile shape for newly created profiles. Document in SQL comments that Postgres enum values remain but are unused because removing enum labels is destructive.

- [ ] **Step 6: Run migration tests and commit**

```bash
npm test -- src/analytics/function-contract.test.ts src/analytics/function-handler.test.ts
supabase db reset
supabase test db
git add supabase/migrations/202607170005_achievement_progress.sql supabase/rollbacks/202607170005_achievement_progress.down.sql supabase/tests/player_sync.sql supabase/tests/operations.sql supabase/functions/_shared/analytics-contract.ts supabase/functions/_shared/ingest-handler.ts src/analytics/function-contract.test.ts src/analytics/function-handler.test.ts
git commit -m "feat: add achievement progress backend"
```

Expected: analytics unit tests and all pgTAP suites PASS. If local Supabase is unavailable, record that exact unverified gate; do not substitute SQLite.

---

### Task 5: Hub-ready view model and full-screen achievement record book

**Files:**
- Modify: `src/progress/view-model.ts`
- Modify: `src/progress/catalog.test.ts`
- Modify: `src/ui/recordbook.ts`
- Modify: `src/ui/recordbook.test.ts`
- Modify: `src/ui/settings.ts`
- Modify: `src/style.css`

**Interfaces:**
- Produces: `RecordBookView` with `summary`, `daily`, `achievements`, `cosmetics`, `stats`, `profile`.
- Produces callbacks: `onTabChange`, `onFilterChange`, `onFrameChange`, `onThemeChange`, existing title/skin/setting/profile callbacks.
- Preserves: `open`, `close`, focus restoration, one modal, existing `RecordBook` integration point.

- [ ] **Step 1: Add failing view-model and accessible hub tests**

```ts
it('shows level, exact XP, completion, and nearest three incomplete achievements', () => {
  const view = makeRecordBookView(state, catalog)
  expect(view.summary).toMatchObject({ level: 4, xp: 250, nextLevelXp: 300, completed: 3, total: 32 })
  expect(view.summary.nearest).toHaveLength(3)
  expect(view.summary.nearest.map(({ ratio }) => ratio)).toEqual([...view.summary.nearest.map(({ ratio }) => ratio)].sort((a, b) => b - a))
})

it('renders four named hub tabs and all public achievement details', () => {
  const hub = setupRecordBook()
  hub.open(trigger)
  expect(buttonNames()).toEqual(expect.arrayContaining(['홈', '업적', '꾸미기', '설정']))
  click('업적')
  expect(document.querySelectorAll('[data-achievement-id]')).toHaveLength(32)
  expect(card('first_hit').textContent).toContain('쉬움')
  expect(card('first_hit').textContent).toContain('경험치 +50')
  expect(card('first_hit').textContent).toContain('0 / 1, 0%')
})

it('filters without losing keyboard focus or hiding locked conditions', () => {
  click('진행 중')
  expect(activeFilter()).toBe('진행 중')
  expect(document.activeElement).toBe(filterButton('진행 중'))
  expect(visibleCards().every((card) => card.textContent?.includes('다음'))).toBe(true)
})
```

- [ ] **Step 2: Run focused UI tests and verify fail**

```bash
npm test -- src/progress/catalog.test.ts src/ui/recordbook.test.ts
```

Expected: FAIL because the view is a single text-only sheet and has no XP/tabs/filters.

- [ ] **Step 3: Build the plain derived view model**

Use exact types:

```ts
export type HubTab = 'home' | 'achievements' | 'cosmetics' | 'settings'
export type AchievementStatusFilter = 'all' | 'active' | 'complete'

export interface AchievementCardView {
  id: string
  name: string
  description: string
  icon: string
  tier: AchievementTier
  tierLabel: '쉬움' | '보통' | '어려움' | '달인'
  xp: number
  progress: number
  target: number
  ratio: number
  progressText: string
  complete: boolean
  seen: boolean
  titleReward: boolean
}
```

Sort home recommendations by incomplete first, ratio descending, smaller remaining amount, then catalog order. Never hide the full catalog.

- [ ] **Step 4: Rebuild `RecordBook` as one full-screen dialog**

Keep one DOM dialog and switch panels with explicit buttons. Add category choice buttons and `전체·진행 중·완료` filters. Cards must include a native `<progress>` or an ARIA-valued progress element plus visible numeric text. Only the active panel is focusable/visible.

- [ ] **Step 5: Implement all states and cosmetic controls**

Render:

- Home with level/XP, completion, daily challenge, nearest three, recent unlock summary.
- Achievements with 32 public cards and locked conditions.
- Cosmetics with eight title rewards, four frames, three theme variants, existing character skins, level requirements.
- Settings with current controls and profile card.
- Zero-progress guidance, 32/32 completion, offline/saving profile state, and unavailable/locked cosmetics.

- [ ] **Step 6: Apply midnight sticker arcade tokens and responsive layout**

Define root CSS custom properties once:

```css
:root {
  --night-ink: #0d1326;
  --arena-navy: #1a2342;
  --paper-warm: #fff8e7;
  --smash-yellow: #ffd23f;
  --impact-coral: #ff6b6b;
  --electric-sky: #61d4ff;
  --ink-text: #202133;
  --night-text: #fff8e7;
  --comic-shadow: 3px 4px 0 rgba(8, 11, 25, 0.72);
}
```

Use grid/list layouts that fit 320px, `min-width: 0`, internal scroll, safe areas, 44/48px controls, focus-visible outlines, and reduced-motion overrides. Do not use permanent backdrop blur.

- [ ] **Step 7: Run tests and commit**

```bash
npm test -- src/progress/catalog.test.ts src/ui/recordbook.test.ts
git add src/progress/view-model.ts src/progress/catalog.test.ts src/ui/recordbook.ts src/ui/recordbook.test.ts src/ui/settings.ts src/style.css
git commit -m "feat: build achievement record book hub"
```

---

### Task 6: Compact game HUD, level feedback, and weapon bar polish

**Files:**
- Modify: `src/ui/hud.ts`
- Modify: `src/ui/notification-queue.ts`
- Create: `src/ui/hud.test.ts`
- Modify: `src/weapons/bar.ts`
- Modify: `src/weapons/bar.test.ts`
- Modify: `src/style.css`

**Interfaces:**
- Produces HUD methods: `setProgress({ level, xp, nextLevelXp, ratio, unseen })`, `showProgressGain({ xp, levelUp })`.
- Preserves callbacks for sound, share, next, reset, and opening the record book.
- Moves share/next/reset under one accessible more menu; sound and level remain top-level.

- [ ] **Step 1: Add failing HUD/menu tests**

```ts
it('keeps only level, sound, and more as top-level game controls', () => {
  const hud = setupHud()
  expect(topLevelButtonNames()).toEqual(['기록책 열기, 현재 레벨 1', '소리 끄기', '게임 메뉴 열기'])
  click('게임 메뉴 열기')
  expect(menuButtonNames()).toEqual(['기록 카드 공유', '다음 타겟', '처음부터'])
})

it('renders a bounded level gain without adding another queued live region', () => {
  hud.setProgress({ level: 5, xp: 300, nextLevelXp: 450, ratio: 0, unseen: 2 })
  expect(levelButton().textContent).toContain('LV 5')
  expect(levelButton().getAttribute('aria-label')).toBe('기록책 열기, 현재 레벨 5, 새 업적 2개')
  expect(document.querySelectorAll('[aria-live]')).toHaveLength(1)
})
```

- [ ] **Step 2: Run focused tests and verify fail**

```bash
npm test -- src/ui/hud.test.ts src/weapons/bar.test.ts src/game-progress.test.ts
```

Expected: FAIL because five icon buttons remain top-level and no level state exists.

- [ ] **Step 3: Implement accessible level button and more menu**

Use native buttons, `aria-expanded`, `aria-controls`, Escape/outside dismissal, and focus return. The menu must not intercept canvas gestures while closed. Replace emoji-only labels with lightweight CSS/SVG marks and visible `LV n` text.

- [ ] **Step 4: Add grouped XP and level-up feedback**

One achievement queue notice owns screen-reader output. Visual XP fragments are `aria-hidden`; reduced motion replaces travel with a static yellow outline/value change. Level-up text is part of the same queue item, e.g. `업적 2개 달성, 경험치 +100, 레벨 5`.

- [ ] **Step 5: Polish weapon cards without changing roster behavior**

Increase rendered names to at least 12px, make active/pressed/focus states use shape plus color, retain horizontal scroll and selected weapon behavior, and avoid changing weapon IDs/order.

- [ ] **Step 6: Run tests and commit**

```bash
npm test -- src/ui/hud.test.ts src/weapons/bar.test.ts src/game-progress.test.ts src/ui/notification-queue.test.ts
git add src/ui/hud.ts src/ui/hud.test.ts src/ui/notification-queue.ts src/weapons/bar.ts src/weapons/bar.test.ts src/game-progress.test.ts src/style.css
git commit -m "feat: polish game hud and level feedback"
```

Expected: focused tests PASS and the top-level control count is three.

---

### Task 7: Profile, signup, and first-entry visual unification

**Files:**
- Modify: `src/player/view.ts`
- Modify: `src/player/view.test.ts`
- Modify: `src/player/style.css`
- Modify: `src/player/entry-choice.test.ts`
- Modify: `src/style.css`

**Interfaces:**
- Preserves all `PlayerProfileView` screens, controller methods, required-choice precedence, guest memory, focus behavior, and account-enumeration-safe error copy.
- Adds visual/state hooks only: `data-profile-screen`, step indicator, stable busy labels, illustrated brand mark.

- [ ] **Step 1: Add failing semantic and copy tests**

```ts
it('renders required choice inside the game visual system with equal primary choices', () => {
  view.openRequired('choice')
  expect(layer().getAttribute('data-profile-screen')).toBe('choice')
  expect(choice('프로필로 이어하기').classList.contains('player-choice-card')).toBe(true)
  expect(choice('이 기기에서 바로 놀기').classList.contains('player-choice-card')).toBe(true)
})

it('shows the exact create flow step without losing field values on an error', async () => {
  openCreateWithName('이미쓴ID')
  await submitDuplicateCheck()
  expect(stepIndicator().textContent).toContain('1 / 3')
  expect(profileNameInput().value).toBe('이미쓴ID')
  expect(fieldMessage().textContent).toContain('다른 ID를 입력하면 바로 이어갈 수 있어요')
})

it('keeps ordinary record-book profile close behavior and required-entry blocking', () => {
  expect(existingOrdinaryAndRequiredBehavior()).toBe(true)
})
```

- [ ] **Step 2: Run profile tests and verify visual-hook failures**

```bash
npm test -- src/player/view.test.ts src/player/entry-choice.test.ts src/player/integration.test.ts
```

Expected: existing behavior passes; new screen/step/card assertions FAIL.

- [ ] **Step 3: Add the explicit three-step create flow presentation**

Keep the API/controller sequence unchanged. Render `1. ID`, `2. PIN`, `3. 완료` as a labelled progress list. Do not expose internal auth alias, credential version, rate limits, or sync risk language.

- [ ] **Step 4: Replace the beige full-screen layer with game background plus paper panel**

Required CSS shape:

```css
.player-profile-layer {
  background:
    radial-gradient(circle at 18% 14%, rgba(97, 212, 255, .14), transparent 32%),
    radial-gradient(circle at 86% 28%, rgba(255, 210, 63, .12), transparent 28%),
    linear-gradient(180deg, var(--arena-navy), var(--night-ink));
  color: var(--night-text);
}

.player-profile-panel {
  background: var(--paper-warm);
  color: var(--ink-text);
  border: 3px solid var(--night-ink);
  box-shadow: var(--comic-shadow);
}
```

Use the existing game/doodle art vocabulary through CSS/SVG, not a large raster background. Keep inputs high-contrast and 16px.

- [ ] **Step 5: Implement loading, error, offline, signed-in, and forced-PIN states**

Button widths remain stable while busy. Field errors are linked with `aria-describedby`. The offline state says `연결되면 기록을 맞춰 저장해요`. Required modal precedence and no-overlap startup behavior must stay unchanged.

- [ ] **Step 6: Run profile regression and commit**

```bash
npm test -- src/player/view.test.ts src/player/entry-choice.test.ts src/player/integration.test.ts src/player/controller.test.ts
git add src/player/view.ts src/player/view.test.ts src/player/style.css src/player/entry-choice.test.ts src/style.css
git commit -m "feat: unify profile and game ui"
```

Expected: all profile and first-entry tests PASS.

---

### Task 8: Game wiring, share cosmetics, telemetry, and admin visibility

**Files:**
- Modify: `src/game.ts`
- Modify: `src/game-progress.test.ts`
- Modify: `src/ui/sharecard.ts`
- Modify: `src/ui/sharecard.test.ts`
- Modify: `src/analytics/client.ts`
- Modify: `src/analytics/client.test.ts`
- Modify: `src/analytics/game-bridge.ts`
- Modify: `src/analytics/game-bridge.test.ts`
- Modify: `src/admin/api.ts`
- Modify: `src/admin/api.test.ts`
- Modify: `src/admin/view.ts`
- Modify: `src/admin/view.test.ts`
- Modify: `src/admin/style.css`

**Interfaces:**
- Game refresh sends one derived progression snapshot to HUD and RecordBook.
- Share card consumes selected title/frame/theme without reading storage.
- Analytics sends only approved event enums, dimensions, and bounded values.
- Admin shows read-only catalog version, unlock counts, hub opens, and level distribution summary.

- [ ] **Step 1: Add failing integration tests**

```ts
it('refreshes HUD, hub, and share data from one derived progress snapshot', () => {
  game.applyPlayerProjection(projectionAtLevel10)
  expect(hud.setProgress).toHaveBeenLastCalledWith(expect.objectContaining({ level: 10, xp: 1_250 }))
  expect(recordBook.render).toHaveBeenLastCalledWith(expect.objectContaining({
    summary: expect.objectContaining({ level: 10 }),
  }), expect.anything(), expect.anything())
})

it('renders only an unlocked selected frame on the share card', () => {
  shareCard(context, { frameId: 'electric_night', recordBookThemeId: 'electric_night' })
  expect(frameCommands()).toMatchSnapshot()
})

it('maps progress events to enum-only analytics payloads', () => {
  bridge.trackAchievementUnlock(['first_hit'], 50)
  bridge.trackLevelReached(2)
  expect(client.enqueueCalls()).toEqual([
    ['achievement_unlocked', 'first_hit', 50],
    ['level_reached', 'level_2', 2],
  ])
})
```

- [ ] **Step 2: Run integration tests and verify fail**

```bash
npm test -- src/game-progress.test.ts src/ui/sharecard.test.ts src/analytics/client.test.ts src/analytics/game-bridge.test.ts src/admin/api.test.ts src/admin/view.test.ts
```

Expected: FAIL on new progress/cosmetic/metric interfaces.

- [ ] **Step 3: Centralize derived UI refresh in Game**

Create one helper:

```ts
private progressionView() {
  const xp = totalAchievementXp(this.progress.state)
  const level = levelProgress(xp)
  return {
    ...level,
    unseen: Object.values(this.progress.state.achievements).filter(({ seen }) => !seen).length,
  }
}
```

`refreshProgressUI` is the only place that calls HUD progress, record-book view, profile card, and share cosmetic state. No HUD or view reads storage.

- [ ] **Step 4: Wire cosmetic callbacks and share rendering**

Add `onFrameChange`/`onThemeChange` callbacks to the existing coordinator methods. Share card validates the selected derived-unlocked frame before drawing a restrained border; it never changes gameplay stats.

- [ ] **Step 5: Add approved progress telemetry**

Expose dedicated bridge methods for hub open, unlock, level reached, cosmetic select, and profile step. Queue one event per unlocked achievement but batch transport them; never put achievement names, profile ID, or raw copy in the payload. Existing analytics disable/clear/retry behavior remains.

- [ ] **Step 6: Extend admin daily metrics read-only**

Add exact fields:

```ts
export interface DailyMetrics {
  // existing fields remain
  achievementHubOpens: number
  achievementsUnlocked: number
  highestLevelReached: number | null
  cosmeticSelections: number
  profileSteps: Array<{ step: 'choice' | 'id' | 'pin' | 'complete'; count: number }>
}
```

Render a separate `성장 흐름` subsection. Empty data uses `아직 기록이 없어요`; a metrics failure must not hide quests, flags, players, or admins.

- [ ] **Step 7: Run focused tests and commit**

```bash
npm test -- src/game-progress.test.ts src/ui/sharecard.test.ts src/analytics/client.test.ts src/analytics/game-bridge.test.ts src/admin/api.test.ts src/admin/view.test.ts
git add src/game.ts src/game-progress.test.ts src/ui/sharecard.ts src/ui/sharecard.test.ts src/analytics/client.ts src/analytics/client.test.ts src/analytics/game-bridge.ts src/analytics/game-bridge.test.ts src/admin/api.ts src/admin/api.test.ts src/admin/view.ts src/admin/view.test.ts src/admin/style.css
git commit -m "feat: connect progression ui and metrics"
```

Expected: focused tests PASS and no primary gameplay path depends on telemetry success.

---

### Task 9: Cross-system regression, copy lint, and adversarial review fixes

**Files:**
- No planned mutations. A confirmed finding reopens its owning Task 1-8, adds a failing regression test there, and is committed with that task's exact file list before Task 9 restarts.
- Do not update `README.md` or `AGENTS.md` before merge and production deployment.

**Interfaces:**
- Produces verified preview candidate only.
- Does not deploy production.

- [ ] **Step 1: Run the complete local automated gate**

```bash
npm run lint:copy
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Expected: copy lint PASS, all Vitest files PASS, TypeScript PASS, production build PASS, high/critical audit count 0.

- [ ] **Step 2: Run the database and Edge-function gate**

```bash
supabase db reset
supabase test db
npm test -- src/player/player-sync-contract.test.ts src/player/player-sync-handler.test.ts src/analytics/function-contract.test.ts src/analytics/function-handler.test.ts
```

Expected: all migrations apply, all pgTAP tests PASS, and the selected function contract tests PASS.

- [ ] **Step 3: Run security and data adversarial cases**

Confirm through tests or scripted requests:

- forged achievement ID/timestamp rejected or ignored;
- locked cosmetic selection ignored by the server;
- duplicate device/sequence/operation cannot add XP;
- two-device simultaneous unlock yields one recognized achievement;
- old operation version 1 remains accepted;
- malformed 33rd achievement rejects the projection;
- analytics rejects raw profile text and unapproved dimensions;
- disabling gamification preserves stored achievements/cosmetics.

Expected: every case has a passing assertion and no raw content in logs.

- [ ] **Step 4: Start production-config preview and inspect mobile layouts**

```bash
npm run dev -- --host 127.0.0.1
```

Use the in-app browser at 320x700, 390x844, and 430x932. Verify first-entry choice, guest play, create/login, first unlock, grouped XP, level button, all four hub tabs, 32 public cards, filters, cosmetics, settings, more menu, weapon bar, offline copy, reduced motion, and console errors. Repeat at 200% zoom.

Expected: no horizontal overflow, no clipped keyboard flow, no console warning/error, and target remains visually dominant.

- [ ] **Step 5: Perform multi-lens adversarial review**

Review independently for correctness, security/privacy, UX/accessibility, mobile performance, and rollback compatibility. Record every finding with severity and evidence. A confirmed P0-P2 finding returns to the owning Task 1-8, which first adds a failing regression test, applies the focused fix, reruns that task's gate, and uses that task's exact staging list. Record rejected findings with technical reasons in the final verification note.

- [ ] **Step 6: Re-run all affected gates after fixes**

Re-run Step 1 plus the exact focused tests for every modified subsystem. Do not claim completion from a stale earlier test run.

---

### Task 10: Preview handoff and production approval gate

**Files:**
- No product-code changes unless preview verification finds a confirmed bug.
- Update `README.md` and `AGENTS.md` only after implementation is merged and production is actually deployed, per repository policy.

- [ ] **Step 1: Prepare exact preview evidence**

Report:

```text
Changed: 32 public achievements, derived XP/20 levels, cosmetic rewards, full-screen hub, compact HUD, unified profile UI, server-authoritative sync, safe metrics.
Verified by: exact unit/integration/pgTAP/build/audit/browser commands and viewport checks.
Result: actual pass counts, build output, rendered flows, console result.
Unverified: real-device or remote-production checks that have not happened.
```

- [ ] **Step 2: Stop before production deployment**

Do not deploy Edge Functions, migrations, or GitHub Pages without a new explicit production approval. Present backend-first rollout order, rollback commands, env/flag diff, and real-device checklist.

- [ ] **Step 3: After later approved production deployment, close documentation**

Only after merge and deploy:

- update Korean PM-facing `README.md` with the live service behavior;
- update dense developer `AGENTS.md` with the new architecture/current evidence;
- record migration/function/Pages identifiers and production smoke results;
- commit with `docs: record achievement ui release`.

## Execution Choice

The user pre-approved the recommended state and asked not to be interrupted for further choices. Execute with **superpowers:subagent-driven-development**, one task at a time with specification and quality review between tasks. The primary agent owns integration, shared-tree safety, final tests, and all production approval boundaries.
