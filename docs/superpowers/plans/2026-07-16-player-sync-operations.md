# Player Sync, Operator UI, and Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize every player progress and setting field across multiple phones with an offline IndexedDB outbox, exact-once server operations, deterministic projection, operator player controls, adversarial verification, preview, and production deployment gates.

**Architecture:** A namespaced profile store converts durable progress checkpoints into bounded monotonic operations. IndexedDB retains ordered operations by immutable user/device/sequence. The authenticated `player-sync` Edge Function atomically accepts contiguous operations, folds all unprojected operations through one shared pure merger, and updates `player_progress` with revision compare-and-swap; duplicate, reversed, concurrent, and retried requests converge to the same projection. The operator UI consumes Plan 1 management APIs; three flags provide non-destructive rollout and rollback.

**Tech Stack:** Existing Vite/TypeScript/Vitest, native IndexedDB with `fake-indexeddb` for tests, Supabase Postgres/Edge Functions/Auth, pgTAP, GitHub Pages workflow.

## Global Constraints

- Plans 1 and 2 must be complete and green first.
- Never upload or import guest state; sync code is constructed only for an authenticated immutable player UUID.
- Full-state last-write-wins is forbidden.
- Sync only at existing meaningful checkpoints: action end, target destroy, daily rollover, unlock, setting, pagehide.
- Never enqueue per frame, pointer coordinate, raw input path, user text, profile name, PIN, internal email, or raw IP.
- Each operation has `operationId`, `operationVersion=1`, immutable `deviceId`, and contiguous positive `clientSeq`.
- Version 1 is the baseline with no earlier wire version; any future version 2 rollout must keep version 1 acceptance until old tabs have aged out.
- Duplicate `operationId` and duplicate `(user_id,device_id,client_seq)` apply exactly once.
- Missing sequence produces a gap response and never applies later operations first.
- Device sequence and operation UUID are allocated inside the same IndexedDB transaction that stores the operation; rapid checkpoints cannot reuse a sequence.
- If the app closes after local progress saves but before outbox persistence, startup reconstructs the missing bounded diff from the last server snapshot plus durable pending operations.
- Counter deltas are nonnegative and bounded; best combo uses max; ID sets use union; achievement unlock uses earliest time; seen/unlocked states never reverse.
- Current daily challenge is server-authoritative per account/day; evidence from every device applies to that challenge; completion/stamp is unique by `(user_id,day_key,quest_id)`.
- Settings resolve field-by-field by accepted operation order; one setting does not overwrite unrelated fields.
- Sync request is at most 100 operations and 256KB; per-user limit is 60 requests/minute.
- Transient failures retry at 1s, 2s, 4s; never retry 400/401/403 automatically.
- Game continues offline; local accepted progress remains visible; sync state always gives a next action.
- Late responses apply only when user UUID, session generation, and requested projection revision still match.
- `player_sync_writes=false` keeps operations locally and does not block game/read/logout.
- Operator reset, deactivate, and delete remain owner-only server checks.
- Existing analytics remains enum/count-only and install-scoped; profile ID is never added.
- Migrations deploy before code; new flags default closed; rollback closes flags and never drops a non-empty player schema.
- Production deploy requires fresh PM approval after preview URL and two-real-device verification.
- Each task uses TDD and ends with a focused conventional commit.

---

## File Map

```text
supabase/functions/_shared/player-sync-contract.ts   bounded operation parser/diff/merge
src/player/player-sync-contract.test.ts              algebra and malformed payload tests
supabase/migrations/202607160003_player_sync.sql      progress/device/op/completion schema and RPCs
supabase/rollbacks/202607160003_player_sync.down.sql  guarded pre-launch rollback
supabase/tests/player_sync.sql                        pgTAP sequence, grants, CAS, completion tests
supabase/functions/_shared/player-sync-handler.ts    JWT/limit/accept/project orchestration
supabase/functions/player-sync/index.ts              authenticated Edge wiring
src/player/player-sync-handler.test.ts               duplicate/gap/concurrency/failure tests
src/player/outbox.ts                                  IndexedDB operations/snapshot/meta adapter
src/player/outbox.test.ts                             fake IndexedDB persistence/isolation tests
src/player/sync-client.ts                             batching/retry/pull/status coordinator
src/player/sync-client.test.ts                        retry/session/stale response tests
src/player/sync-store.ts                              progress checkpoint to operation adapter
src/player/sync-store.test.ts                         diff/optimistic/rebase tests
src/game-progress.ts                                  remote projection hydration hook
src/game.ts                                           authenticated sync lifecycle
src/player/controller.ts                              sync status and logout flush choices
src/player/view.ts                                    saved/saving/offline/retry UI
src/admin/view.ts                                     player list/reset/status/delete UI
src/admin/view.test.ts                                owner-only forms and confirmations
src/admin/style.css                                   mobile player-admin rows/dialogs
scripts/verify-player-sync.mjs                        two-device local integration verifier
package.json                                          fake-indexeddb and verification command
.github/workflows/deploy.yml                          complete quality/deploy sequence
README.md                                             PM guide after production only
AGENTS.md                                             developer SSOT after production only
```

### Task 1: Define bounded progress operations and one deterministic merger

**Files:**
- Create: `supabase/functions/_shared/player-sync-contract.ts`
- Create: `src/player/player-sync-contract.test.ts`

**Interfaces:**
- Produces: `PlayerProgressDraftV1`, `PlayerProgressOperationV1`, `diffPlayerProgress`, `parseSyncBatch`, `applyPlayerOperation`, `applyPendingPlayerOperation`.
- Consumers: client store, Edge handler, optimistic rebase, integration verifier.

- [ ] **Step 1: Write failing parser, diff, and algebra tests**

Cover exact keys, UUIDs, positive sequence, 100-op/256KB bounds, negative/oversized deltas, unknown weapon/move/target/achievement/setting, same operation twice, operation reordering after server ID sort, counter sum, best max, set union, earliest unlock, seen monotonic, setting field isolation, day rollover, and daily completion once.

```ts
const once = applyPlayerOperation(zero('seed'), operation({ validHits: 1 }))
const twice = applyPlayerOperation(once, operation({ validHits: 1 }))
expect(twice.lifetime.validHits).toBe(2)

const merged = [left, right].sort((a, b) => a.acceptedOrder - b.acceptedOrder)
  .reduce((state, op) => applyPlayerOperation(state, op), zero('seed'))
expect(merged.lifetime.bestCombo).toBe(Math.max(left.delta.bestCombo, right.delta.bestCombo))
expect(merged.lifetime.distinctWeaponIds).toEqual(['cat','hammer'])
```

Add a property loop for 200 generated bounded operation lists: applying the same accepted list twice from the same zero state produces byte-identical JSON; grouping batches differently produces the same result when accepted order is unchanged.

- [ ] **Step 2: Run and confirm missing-module failure**

Run: `npm test -- src/player/player-sync-contract.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define the exact operation shape**

```ts
export interface SyncProgressState {
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
  byTarget: { word: { destroys: number }; earth: { destroys: number }; city: { destroys: number } }
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
  daily: {
    dayKey: string
    questId: string
    quest?: { copy: string; event: 'CHARGE_RELEASED'|'WEAPON_USED'|'TARGET_DESTROYED'; distinct: 'weaponId'|null }
    target: number
    progress: number
    distinctIds: string[]
    completedAt: string|null
    stampAwarded: boolean
  }
  profile: {
    selectedTitle: string|null
    skins: Record<string,string>
    strongInput: 'hold'|'doubleTap'
    reducedMotion: boolean
    haptics: boolean
  }
}

export interface PlayerProgressDraftV1 {
  createdAt: string
  playDayKey: string
  dailyQuest: {
    id: string
    copy: string
    event: 'CHARGE_RELEASED'|'WEAPON_USED'|'TARGET_DESTROYED'
    distinct: 'weaponId'|null
    target: number
  } | null
  delta: PlayerProgressDeltaV1
}

export interface PlayerProgressOperationV1 extends PlayerProgressDraftV1 {
  operationId: string
  operationVersion: 1
  deviceId: string
  clientSeq: number
}

export interface PlayerProgressDeltaV1 {
  validHits: number
  chargedFinishers: number
  totalTargets: number
  bestCombo: number
  addDistinctWeaponIds: string[]
  byWeapon: Record<string, { uses: number; finishes: number; addSeenMoves: string[] }>
  byTarget: { word: number; earth: number; city: number }
  achievements: Record<string, { unlockedAt: string; seen: boolean }>
  settings: Partial<{
    selectedTitle: string|null
    cinnamorollSkin: 'default'|'classic'
    dittoSkin: 'default'|'classic'
    strongInput: 'hold'|'doubleTap'
    reducedMotion: boolean
    haptics: boolean
  }>
}

export type AcceptedPlayerProgressOperationV1 = PlayerProgressOperationV1 & {
  acceptedOrder: number
  acceptedAt: string
}
```

Each counter delta is 0-1000, best combo 0-1,000,000, each ID array max 64, `byWeapon` max 21 keys, achievements max 5, JSON per operation max 32KB. `createdAt` is display/debug ordering only; accepted server order decides setting conflicts.

- [ ] **Step 4: Implement `diffPlayerProgress(previous,next,context)`**

Return a `PlayerProgressDraftV1` or `null` when no syncable change exists. The draft deliberately has no operation UUID, device ID, or sequence; Task 4 assigns those atomically with durable storage. Reject any lifetime/by-weapon/by-target counter decrease. Exclude `installSeed` replacement and `lifetime.stamps`; server derives stamps from unique daily completions. Include only newly added IDs/achievements and settings whose field changed. For a new play day, attach the current daily quest snapshot; for the same day attach it only when the server may not have seen that day yet. The snapshot is an offline hint only; the server validates or replaces it from the authoritative catalog and account seed before daily evidence is applied.

- [ ] **Step 5: Implement deterministic apply rules**

`applyPlayerOperation` accepts `AcceptedPlayerProgressOperationV1`, clamps sums to `Number.MAX_SAFE_INTEGER`, sorts/deduplicates sets, validates selected title against unlocked achievements, applies each present setting only, and updates daily progress from operation evidence:

- `CHARGE_RELEASED`: add `delta.chargedFinishers`;
- `TARGET_DESTROYED`: add `word + earth + city` deltas;
- `WEAPON_USED` with `distinct='weaponId'`: union character IDs whose `uses > 0`.

For daily evidence, the merger accepts a server-resolved assignment as an explicit argument. It never chooses a quest from the client snapshot. Operations from an older day still update that day's server assignment even after a newer day exists; lifetime/weapon/achievement changes always apply to the account projection. A different or missing client snapshot is ignored for selection and cannot change the stored assignment.

After each merge, evaluate the same five permanent achievements against the combined server state: first destroy, 10 charged finishers, 10 distinct weapons, all three targets, and best combo 50. Set a newly combined unlock to the operation's trusted `acceptedAt`; keep the earliest timestamp and monotonic seen state. Add a golden test comparing these five IDs, thresholds, and title strings with `src/progress/catalog.ts` so the client and server catalogs cannot drift.

`applyPendingPlayerOperation` is the client-only optimistic adapter. It applies pending operations in `clientSeq` order using their `createdAt` only for temporary display and the already visible local daily quest. It cannot write a server snapshot, award an authoritative stamp, or override the next server response.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/player/player-sync-contract.test.ts && npm run typecheck`

```bash
git add supabase/functions/_shared/player-sync-contract.ts src/player/player-sync-contract.test.ts
git commit -m "feat: define deterministic player progress operations"
```

### Task 2: Add operation acceptance, projection, and daily-assignment schema

**Files:**
- Create: `supabase/migrations/202607160003_player_sync.sql`
- Create: `supabase/rollbacks/202607160003_player_sync.down.sql`
- Create: `supabase/tests/player_sync.sql`

**Interfaces:**
- Produces: `player_progress`, `player_devices`, `player_sync_operations`, `player_daily_assignments`, `player_daily_completions`, `player_sync_rate_limits`, acceptance/limit/compare-and-swap RPCs.
- Consumers: Task 3 Edge handler.

- [ ] **Step 1: Write pgTAP tests first**

Assert tables, RLS, zero grants to anon/authenticated, service-only RPC execution, profile-create trigger, existing-profile backfill, exact zero JSON, contiguous acceptance, duplicate idempotency, gap rejection, cross-user operation-ID rejection, 60/minute sync limiting and hourly stale-bucket cleanup, account and daily compare-and-swap success/failure, deterministic one-assignment-per-account/day, late offline evidence for an older day, daily completion uniqueness, last-sync timestamp, and cascade delete.

- [ ] **Step 2: Run database tests and confirm failure**

Run: `npx supabase db reset && npx supabase test db`

Expected: FAIL because sync schema is missing.

- [ ] **Step 3: Create the exact tables**

```sql
create table public.player_progress (
  user_id uuid primary key references public.player_profiles(user_id) on delete cascade,
  account_seed uuid not null default gen_random_uuid(),
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null,
  last_operation_id bigint not null default 0 check (last_operation_id >= 0),
  updated_at timestamptz not null default now()
);

create table public.player_devices (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  device_id uuid not null,
  last_client_seq bigint not null default 0 check (last_client_seq >= 0),
  created_at timestamptz not null default now(),
  last_sync_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

create table public.player_sync_operations (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  device_id uuid not null,
  client_seq bigint not null check (client_seq > 0),
  operation_id uuid not null,
  operation_version smallint not null check (operation_version = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 32768),
  accepted_at timestamptz not null default now(),
  unique (operation_id),
  unique (user_id, device_id, client_seq),
  foreign key (user_id, device_id) references public.player_devices(user_id, device_id) on delete cascade
);

create table public.player_daily_assignments (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  day_key date not null,
  quest_id text not null check (quest_id ~ '^[a-z0-9_]{3,64}$'),
  quest jsonb not null check (jsonb_typeof(quest) = 'object'),
  target integer not null check (target between 1 and 100),
  progress integer not null default 0 check (progress between 0 and target),
  distinct_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(distinct_ids) = 'array'),
  completed_at timestamptz,
  stamp_awarded boolean not null default false,
  revision bigint not null default 0 check (revision >= 0),
  last_operation_id bigint not null default 0 check (last_operation_id >= 0),
  assigned_at timestamptz not null default now(),
  primary key (user_id, day_key)
);

create table public.player_daily_completions (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  day_key date not null,
  quest_id text not null check (quest_id ~ '^[a-z0-9_]{3,64}$'),
  completed_at timestamptz not null default now(),
  primary key (user_id, day_key, quest_id)
);

create table public.player_sync_rate_limits (
  user_id uuid not null references public.player_profiles(user_id) on delete cascade,
  bucket_start timestamptz not null,
  count integer not null check (count between 0 and 100000),
  primary key (user_id, bucket_start)
);

create index player_sync_rate_limits_expiry_idx
  on public.player_sync_rate_limits (bucket_start);
```

Enable RLS and revoke all table privileges from public/anon/authenticated. Do not add browser policies. The service handler creates an assignment from the account seed plus the authoritative quest catalog; the client `dailyQuest` snapshot is only checked for telemetry-free compatibility and never selects or mutates the stored quest. Accept daily evidence only for KST day keys from the current day back through 90 days; older operations still update lifetime progress but cannot create unbounded historical assignments.

- [ ] **Step 4: Add exact zero-state initialization**

Create `new_player_progress_state(account_seed uuid)` returning the complete `ProgressStateV1` JSON with schema/catalog version 1, all counters 0, empty maps/sets/achievements, three targets at 0, blank daily, and default settings. An `after insert on player_profiles` trigger inserts `player_progress`; the migration backfills existing player rows idempotently.

- [ ] **Step 5: Add atomic contiguous acceptance RPC**

```sql
create or replace function public.accept_player_operations(
  p_user_id uuid,
  p_device_id uuid,
  p_expected_previous_seq bigint,
  p_operations jsonb
)
returns table(last_client_seq bigint, max_operation_id bigint)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_current bigint;
  v_item jsonb;
  v_seq bigint;
begin
  if jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) > 100 then
    raise exception 'invalid_batch' using errcode = '22023';
  end if;
  insert into public.player_devices(user_id, device_id)
  values (p_user_id, p_device_id) on conflict do nothing;
  select d.last_client_seq into v_current from public.player_devices d
  where d.user_id = p_user_id and d.device_id = p_device_id for update;
  if v_current <> p_expected_previous_seq then
    raise exception 'sequence_gap' using errcode = 'P0001';
  end if;
  for v_item in select value from jsonb_array_elements(p_operations) loop
    v_seq := (v_item->>'clientSeq')::bigint;
    if v_seq <> v_current + 1 then raise exception 'sequence_gap' using errcode = 'P0001'; end if;
    insert into public.player_sync_operations(user_id,device_id,client_seq,operation_id,operation_version,payload)
    values (p_user_id,p_device_id,v_seq,(v_item->>'operationId')::uuid,(v_item->>'operationVersion')::smallint,v_item);
    v_current := v_seq;
  end loop;
  update public.player_devices set last_client_seq=v_current,last_sync_at=clock_timestamp()
  where user_id=p_user_id and device_id=p_device_id;
  return query select v_current, coalesce(max(id),0) from public.player_sync_operations
  where user_id=p_user_id;
end;
$$;
```

The Edge handler filters already-accepted leading sequence values before calling this RPC. A duplicate request with the same body returns the current acknowledged sequence without reinsertion; a reused operation ID on a different sequence/user fails.

- [ ] **Step 6: Add account/daily compare-and-swap and completion RPCs**

`compare_and_swap_player_progress(user,expected_revision,state,last_operation_id)` updates only when both current revision and monotonic last-operation conditions match, increments revision once, and returns boolean. `compare_and_swap_player_daily(user,day,expected_revision,state,last_operation_id)` applies the same rule to exactly one assignment row. `record_player_daily_completion(user,day,quest)` inserts `on conflict do nothing` and returns the total completion count for that user; the projection always sets `lifetime.stamps` to this count before account CAS.

The handler resolves or loads one server-selected assignment per operation day and folds that day's unprojected evidence in database acceptance order. At the first state that reaches its target, set `completed_at` to that operation's trusted database `accepted_at`, set `stamp_awarded=true`, call the completion RPC, and replace the client-derived stamp value with the returned unique completion count. Each assignment stores its own last operation ID, so an older offline day can finish after a newer day without mutating the newer assignment. A replay, a second phone, or a later batch cannot move the completion time or award another stamp.

Grant RPC execution only to service role and fix every security-definer search path.

Add `consume_player_sync_limit(user, limit, window)` with fixed bounds of 1-1000 requests and 60-3600 seconds; it returns `{allowed,retry_after_seconds}` from the database bucket, and the handler calls it with 60/one minute after JWT ownership verification. A rejected request returns 429 and does not read or accept its body. Add `cleanup_player_sync_rate_limits()` and one named hourly Cron job, `cleanup-player-sync-rate-limits`, deleting buckets older than two hours. pgTAP verifies a single job and cleanup behavior. The guarded down migration unschedules only this named job and leaves the shared Cron extension installed.

- [ ] **Step 7: Add guarded rollback, run pgTAP, and commit**

The down migration refuses to run if any `player_progress`, operation, assignment, completion, device, or sync-limit row exists. Because every player gets a zero projection at creation, rollback is available only before the first player profile and can never silently discard even an all-zero account. Run:

```bash
npx supabase db reset
npx supabase test db
```

Expected: all previous and sync pgTAP tests PASS.

```bash
git add supabase/migrations/202607160003_player_sync.sql supabase/rollbacks/202607160003_player_sync.down.sql supabase/tests/player_sync.sql
git commit -m "feat: add exact-once player sync storage"
```

### Task 3: Implement authenticated batch acceptance and projection CAS

**Files:**
- Create: `supabase/functions/_shared/player-sync-handler.ts`
- Create: `supabase/functions/player-sync/index.ts`
- Create: `src/player/player-sync-handler.test.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Consumes: Plan 1 `verifyCurrentPlayer`, Task 1 merger, Task 2 RPCs.
- Produces: `POST player-sync` request/response contract.
- Consumers: Task 5 client.

- [ ] **Step 1: Write handler tests including concurrency**

Cover missing JWT, stale credential, force-PIN-change, sync flag closed for writes but open for an empty pull, request >256KB, >100 ops, malformed op, wrong device, leading duplicate retry, gap, cross-user operation ID, account/daily CAS conflict retry, three CAS failures, projection parse failure, deterministic daily assignment, mismatched client daily snapshot ignored, 90-day daily boundary, late offline older-day completion, daily completion count, and two concurrent device batches converging after a follow-up pull.

- [ ] **Step 2: Define exact HTTP contract**

```ts
export interface PlayerSyncRequest {
  deviceId: string
  previousSeq: number
  operations: PlayerProgressOperationV1[]
  knownRevision: number
}

export interface PlayerSyncResponse {
  userId: string
  deviceId: string
  acknowledgedThrough: number
  revision: number
  state: SyncProgressState
  serverTime: string
}
```

Response has exact keys and `cache-control:no-store`. Gap returns 409 `{code:'sequence_gap', expectedPreviousSeq:number}`. When writes are closed, a nonempty batch returns 503 `{code:'sync_paused'}` without accepting operations, while an empty pull remains available for safe session restore and server-state hydration. Force-PIN-change returns 403 `{code:'pin_change_required'}`.

- [ ] **Step 3: Implement the projection loop**

For maximum three compare-and-swap attempts:

1. verify current player and 60/minute user limiter;
2. validate exact body and byte size;
3. discard only the already-acknowledged leading operations whose sequence and operation ID match stored rows;
4. call `accept_player_operations` for the contiguous remainder;
5. load current account projection and all account-unprojected operations ordered by DB `id`;
6. group daily evidence by `playDayKey`; for each allowed day, resolve or load the deterministic assignment from the account seed and authoritative catalog, load only operations after that assignment's `last_operation_id`, fold them in DB order, and daily-CAS the row;
7. when an assignment first completes, use the completing operation's database `accepted_at`, insert the unique completion, and load the user's authoritative completion count;
8. fold lifetime, weapon, target, achievement, and setting fields into the account projection using DB `id` as `acceptedOrder`; replace `lifetime.stamps` with the completion count and replace `state.daily` with the current KST day's server assignment;
9. account-CAS the validated projection and last operation ID;
10. on a daily or account conflict restart from step 5 without reaccepting the batch; already-projected daily rows skip operations through their own last operation ID;
11. on success return the validated projection.

After three CAS conflicts return 503 `{code:'sync_busy'}`; the client retains its outbox.

- [ ] **Step 4: Wire the authenticated function**

```toml
[functions.player-sync]
verify_jwt = true
```

Use one user client only for JWT validation and one secret client for private tables/RPCs. Never log body/state/profile identity. Allowed log fields: operation count bucket (`0`,`1-10`,`11-50`,`51-100`), status, retry count, duration bucket, exception class.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/player/player-sync-handler.test.ts src/player/player-sync-contract.test.ts && npm run typecheck`

```bash
git add supabase/functions/_shared/player-sync-handler.ts supabase/functions/player-sync/index.ts src/player/player-sync-handler.test.ts supabase/config.toml
git commit -m "feat: project player progress operations"
```

### Task 4: Add the profile-scoped IndexedDB outbox

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/player/outbox.ts`
- Create: `src/player/outbox.test.ts`

**Interfaces:**
- Produces: `PlayerOutbox`, `OutboxAdapter`, per-profile snapshot/meta/operation stores.
- Consumers: Tasks 5-6.

- [ ] **Step 1: Install the test-only IndexedDB implementation**

Run: `npm install --save-dev fake-indexeddb`

Expected: lockfile changes; no new production dependency.

- [ ] **Step 2: Write persistence and isolation tests**

Cover database creation/upgrade, stable device ID, sequence continuity after reload, 50 concurrent draft appends receiving unique contiguous sequences in checkpoint order, operation UUID allocation, UUID profile isolation, transaction abort leaving both operation and next sequence unchanged, batch max 100/256KB, acknowledge deletion, keep-on-failure, snapshot revision monotonicity, quota/blocked fallback, and delete only one profile's local data.

- [ ] **Step 3: Define exact stores and adapter**

Database: `btw.player.sync.v1`, version 1.

```ts
type OperationRow = PlayerProgressOperationV1 & { userId: string }
type SnapshotRow = { userId: string; revision: number; state: SyncProgressState; savedAt: string }
type MetaRow = { userId: string; deviceId: string; nextSeq: number; acknowledgedThrough: number }

export interface OutboxAdapter {
  load(userId: string): Promise<{ snapshot: SnapshotRow|null; meta: MetaRow; operations: OperationRow[] }>
  appendDraft(userId: string, draft: PlayerProgressDraftV1): Promise<OperationRow>
  acknowledge(userId: string, throughSeq: number, snapshot: SnapshotRow): Promise<void>
  repairGap(userId: string, serverThroughSeq: number, snapshot: SnapshotRow, recovery: PlayerProgressDraftV1|null): Promise<OperationRow|null>
  clearProfile(userId: string): Promise<void>
}
```

One IndexedDB read-write transaction loads/creates the user's stable device metadata, assigns `crypto.randomUUID()` and the current `nextSeq`, writes the completed operation, and increments `nextSeq`. Draft append calls are serialized in checkpoint order; an aborted transaction consumes neither the sequence nor the UUID-bearing operation row. `acknowledge` deletes only rows `clientSeq <= throughSeq` for the same user and saves snapshot/meta atomically. `repairGap` is the only path allowed to remove unaccepted rows and reset `nextSeq`; it performs server snapshot adoption, row cleanup, meta repair, and optional single recovery-operation creation in one transaction.

- [ ] **Step 4: Add memory fallback without pretending persistence**

`PlayerOutbox.open()` returns `{mode:'persistent'|'memory', outbox}`. On any open/transaction/quota failure it keeps current-session operations in memory and emits one callback. UI copy becomes `이 화면을 닫기 전까지 기록을 보관해요.`; gameplay continues.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/player/outbox.test.ts && npm run typecheck`

```bash
git add package.json package-lock.json src/player/outbox.ts src/player/outbox.test.ts
git commit -m "feat: persist offline player sync operations"
```

### Task 5: Wrap progress checkpoints and implement retrying sync client

**Files:**
- Create: `src/player/sync-store.ts`
- Create: `src/player/sync-store.test.ts`
- Create: `src/player/sync-client.ts`
- Create: `src/player/sync-client.test.ts`

**Interfaces:**
- Produces: `PlayerSyncStore implements ProgressPersistence`, `PlayerSyncClient`, `SyncStatus`.
- Consumers: Task 6 Game/controller integration.

- [ ] **Step 1: Write checkpoint, optimistic, and retry tests**

Prove no operation for identical save, one operation for multiple changes at one checkpoint, no negative delta, guest constructor impossible, local save succeeds before outbox append, rapid saves keep checkpoint order, crash between local save and append is reconstructed on startup, pending rebase on server projection, recoverable sequence gap with the row present, corrupted local hole with server behind/ahead, 1/2/4 retry, no retry 400/401/403, retry 429/5xx/network with server delay, pagehide flush, closed flag queue-only, stale user/generation/revision response ignored, and logout flush choice.

- [ ] **Step 2: Implement the store wrapper**

```ts
export class PlayerSyncStore implements ProgressPersistence {
  private lastState: ProgressStateV1
  private appendChain = Promise.resolve()

  constructor(
    private readonly userId: string,
    private readonly local: ProgressStore,
    private readonly outbox: PlayerOutbox,
    private readonly onMemoryFallback: () => void,
  ) {
    this.lastState = local.load().state
  }

  load(): ProgressLoadResult { return this.local.load() }

  save(state: ProgressStateV1, reason: CheckpointReason): ProgressSaveResult {
    const previous = this.lastState
    const saved = this.local.save(state, reason)
    this.lastState = state
    const draft = diffPlayerProgress(previous, state, { nowIso: new Date().toISOString() })
    if (draft) {
      this.appendChain = this.appendChain
        .then(() => this.outbox.appendDraft(this.userId, draft))
        .then(() => undefined)
        .catch(() => this.onMemoryFallback())
    }
    return saved
  }
}
```

Initialize `lastState` from local load. Enqueue only after the local save attempt; memory fallback still queues in-memory. Never block synchronous game dispatch on IndexedDB. On startup, replay the durable snapshot plus pending operations and compare it with the profile local store. If the local store contains a valid monotonic advance that is absent from the replay, append one recovery draft before the first network sync; if it contains a decrease/corruption, keep the server-plus-pending view and do not emit a negative correction.

- [ ] **Step 3: Implement optimistic rebase**

After a sync response, acknowledge the batch, parse the server state, then apply remaining local operations in client sequence to compute visible state. Local optimistic application uses a separate `applyPendingPlayerOperation` adapter with provisional order and the local daily view; provisional metadata is never persisted as server truth. Return `{serverState,visibleState,revision}`. Never add guest state. If parsing fails, keep local state/outbox and report retry.

- [ ] **Step 4: Implement sync status and retry**

```ts
export type SyncStatus =
  | { kind: 'saved'; lastSavedAt: string }
  | { kind: 'saving' }
  | { kind: 'offline'; pending: number }
  | { kind: 'retry'; pending: number; message: string }
```

Trigger sync after append debounce 500ms, `online`, visibility return, explicit retry, and before logout. Use delays `[1000,2000,4000]`; cancel timers on user/generation change. A 401 attempts one `auth.refreshSession`; failure emits session-expired and keeps outbox.

For a 409 gap, resend the exact expected row when it exists. If local corruption removed that row, make an empty pull at the server-reported sequence, atomically discard only never-accepted rows after that sequence, set local acknowledgement/next sequence to the server boundary, and enqueue one bounded recovery draft from the returned server projection to the current validated local state. If the server is already ahead, first adopt its returned projection so accepted counters are never replayed. Never renumber a durable operation or decrease server acknowledgement; if a monotonic recovery diff cannot be formed, keep the server state, preserve a diagnostic enum without raw state, and show the manual retry status.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/player/sync-store.test.ts src/player/sync-client.test.ts && npm run typecheck`

```bash
git add src/player/sync-store.ts src/player/sync-store.test.ts src/player/sync-client.ts src/player/sync-client.test.ts
git commit -m "feat: sync player progress with offline retry"
```

### Task 6: Integrate remote hydration, status UI, and safe logout

**Files:**
- Modify: `src/game-progress.ts`
- Modify: `src/game-progress.test.ts`
- Modify: `src/game.ts`
- Modify: `src/player/controller.ts`
- Modify: `src/player/controller.test.ts`
- Modify: `src/player/view.ts`
- Modify: `src/player/view.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: full account sync lifecycle and user-visible sync status.

- [ ] **Step 1: Write end-to-end in-process tests**

Cover profile login with cached snapshot, server newer hydration, pending operation rebase, active action cancellation before hydration, settings/skins reapplication, stale response after logout, same profile relogin resumes queue, different profile cannot see queue, offline status, explicit retry, flush success logout, flush failure choices, and sync flag close/reopen.

- [ ] **Step 2: Add an identity-guarded Game hydration method**

```ts
applyPlayerProjection(input: {
  userId: string
  generation: number
  revision: number
  state: ProgressStateV1
}): boolean {
  if (this.scope.kind !== 'player' || this.scope.profile.userId !== input.userId) return false
  if (this.scopeGeneration !== input.generation || input.revision < this.scopeRevision) return false
  this.cancelAction('settingsMode')
  if (!this.progress.replaceState(input.state)) return false
  this.scopeRevision = input.revision
  this.controller.setStrongInput(this.progress.state.profile.strongInput)
  this.applyMotionSetting()
  this.refreshProgressUI()
  return true
}
```

Hydration does not enqueue a new operation, emit analytics, show achievement notices, or increment progress.

- [ ] **Step 3: Connect one sync lifecycle per signed-in generation**

On player scope create/open outbox, load cached server snapshot plus pending operations, create `PlayerSyncStore`, switch Game, then start `PlayerSyncClient`. On guest/logout stop timers/listeners, invalidate generation, retain player outbox, and switch to untouched guest store. Only explicit profile deletion clears that profile's local cache/outbox.

- [ ] **Step 4: Implement logout choices**

Normal logout first calls `flush(5000)`. If pending remains, show:

- `이 기기에 보관하고 로그아웃`: keep profile-scoped outbox, local Supabase logout, switch guest;
- `계속 저장하기`: close confirmation, stay signed in, retry.

Never offer to move pending operations into guest. When the same UUID logs in again, resume before new operations.

- [ ] **Step 5: Render status with exact next actions**

- saved: `기록이 저장됐어요`
- saving: `기록을 저장하는 중이에요`
- offline: `인터넷에 연결되면 기록을 저장해요`
- retry: `기록 저장을 다시 확인해 주세요` plus `다시 저장`
- auth expired: `다시 로그인하면 보관한 기록을 이어서 저장해요`

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/player src/game-progress.test.ts && npm run lint:copy && npm run typecheck`

```bash
git add src/game-progress.ts src/game-progress.test.ts src/game.ts src/player/controller.ts src/player/controller.test.ts src/player/view.ts src/player/view.test.ts src/main.ts
git commit -m "feat: connect multi-device player progress"
```

### Task 7: Add owner-facing player management UI

**Files:**
- Modify: `src/admin/view.ts`
- Modify: `src/admin/view.test.ts`
- Modify: `src/admin/style.css`

**Interfaces:**
- Consumes: Plan 1 `AdminApi` player methods.
- Produces: owner-only player list, temporary PIN reset/reactivation, deactivate, and delete dialogs.

- [ ] **Step 1: Write UI tests before rendering**

Test owner data load in dashboard `Promise.all`, operator sees explanatory non-control state, empty player list, loading error/retry isolated to player section, mobile list labels, PIN exact six/confirmation/show, reset success copy, deactivate confirmation, delete exact profile-name confirmation, busy double-click prevention, dialog focus trap/return, and no internal email/raw progress.

- [ ] **Step 2: Load player section independently**

Owners call `listPlayers`; operators receive an empty ready result without invoking the function. A player-section failure renders `플레이어 목록을 다시 불러와 주세요.` and `다시 불러오기` without hiding quests/flags/metrics/admins.

- [ ] **Step 3: Render the exact list**

Each row shows display ID, `사용 중`/`잠시 멈춤`, created date, last sync (`아직 저장된 기록이 없어요` when null), PIN state, and buttons. Do not render UUID visibly except as `data-user-id` for action binding. An active row offers `PIN 재설정`, `잠시 멈추기`, and `삭제`; an inactive row offers `PIN 재설정하고 다시 사용` and `삭제`, with no unsafe standalone activation. At 640px rows become stacked cards with visible field labels.

- [ ] **Step 4: Implement reset and destructive confirmations**

Reset dialog uses two password inputs with numeric keyboard and show controls. Success: `임시 PIN으로 바꿨어요. 모든 기기에서 다시 로그인해 주세요.` Deactivate success: `이 프로필의 새 로그인을 잠시 멈췄어요.` Delete requires typing the exact profile ID, keeps confirm disabled until matched, and says `프로필과 저장된 기록을 모두 삭제해요. 삭제한 기록은 다시 불러올 수 없어요.`

- [ ] **Step 5: Run tests, copy lint, and commit**

Run: `npm test -- src/admin/view.test.ts src/admin/api.test.ts && npm run lint:copy && npm run typecheck`

```bash
git add src/admin/view.ts src/admin/view.test.ts src/admin/style.css
git commit -m "feat: add operator player management"
```

### Task 8: Adversarial verification, preview, staged rollout, and production gate

**Files:**
- Create: `scripts/verify-player-sync.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/deploy.yml`
- Modify after successful production only: `README.md`
- Modify after successful production only: `AGENTS.md`

**Interfaces:**
- Produces: repeatable local/preview/prod checklist and non-destructive rollback path.

- [ ] **Step 1: Create a two-device integration verifier**

`verify-player-sync.mjs` creates one test player and two random device IDs, then proves:

1. new server projection is all-zero/default;
2. guest fixture values never appear;
3. device A and B simultaneous increments both survive;
4. duplicate A batch does not increment twice;
5. reversed/gapped A sequence is rejected and later succeeds after missing op;
6. concurrent setting changes affect only their fields and accepted order wins same-field conflicts;
7. achievement/title/skin sets merge;
8. same daily completion from A/B yields one completion and one stamp;
9. offline queue survives process restart and syncs later;
10. reset invalidates both sessions while preserving server progress;
11. delete cascades all profile/sync rows.

The script prints only test labels/status and deletes its fixture. No ID/PIN/token/body logging.

- [ ] **Step 2: Add CI gates before build/deploy**

Workflow order:

```text
npm ci
npm run lint:copy
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Supabase schema/function deployment remains a separate manually approved pre-static-deploy step because migrations must precede code and require environment credentials. Do not put production secret keys in GitHub Pages build variables.

- [ ] **Step 3: Run the full local verification matrix**

```bash
npx supabase db reset
npx supabase test db
npm run verify:player-auth
npm run verify:player-sync
npm run lint:copy
npm test
npm run typecheck
npm run build
npm audit --omit=dev --audit-level=high
```

Expected: all PASS; game/admin build entries exist; audit reports zero high/critical production vulnerabilities.

- [ ] **Step 4: Run browser and real-device quality checks**

Serve preview and verify game/admin HTTP 200. Check guest, create, duplicate, login, force change, offline, retry, logout, owner reset, deactivate, delete at 320px, 390x844, 200% text, reduced motion, keyboard, and screen reader. Then use one real iPhone Safari and one real Android Chrome concurrently for the same profile and repeat steps 3-9 from the verifier.

Run 50 login/sync/profile-open cycles and confirm listeners, timers, active requests, and effect/memory counts return to baseline. Run all 21 weapons tap/drag/charge after account integration.

- [ ] **Step 5: Prepare Supabase rollout with flags closed**

1. diff local/production migration history;
2. confirm production project region and the exact public `VITE_PLAYER_DELETION_CONTACT` and `VITE_PLAYER_PROCESSING_NOTICE` copy; keep signup closed if either is blank;
3. set those two public repository build variables and Edge secrets through their separate approved stores;
4. deploy migrations `002` then `003`;
5. deploy `player-auth`, `manage-player`, `player-sync`;
6. verify all three player flags are false and both rate-limit cleanup Cron jobs have a successful recent run;
7. create one owner-only test profile and rerun auth/sync/reset/delete smoke;
8. prepare rollback by closing signup, UI, and sync writes; never run down migrations after a player exists.

- [ ] **Step 6: Publish preview and request PM production approval**

Publish the static preview without opening production flags. Provide game/admin preview URLs and the actual verification counts/results. Stop here until the PM explicitly approves this exact preview for production.

- [ ] **Step 7: After explicit approval, deploy and open gradually**

1. fetch remote state and confirm branch/commit;
2. deploy static production bundle;
3. hit game/admin actual URLs and confirm HTTP 200;
4. enable `player_profiles_ui` and verify profile discovery;
5. enable `player_signup` and create/login one known test profile;
6. enable `player_sync_writes` and verify two-device convergence;
7. observe errors, login failure counts, sync queue latency, and expected event presence for at least five minutes;
8. on anomaly close `player_signup`, then `player_sync_writes`; keep gameplay/queues local.

- [ ] **Step 8: Update both audience documents only after successful production**

Update `README.md` in Korean with guest/profile behavior, creation/login/logout, zero-start, multi-device save, owner reset request, and privacy summary. Update `AGENTS.md` with final schema, modules, functions, flags, exact verification counts, production URL/state, rollback, and version history; remove approved-not-implemented profile text.

- [ ] **Step 9: Commit verification/deploy automation and post-production docs separately**

Before production:

```bash
git add scripts/verify-player-sync.mjs package.json package-lock.json .github/workflows/deploy.yml
git commit -m "test: gate player profile deployment"
```

After successful production only:

```bash
git add README.md AGENTS.md
git commit -m "docs: document deployed player profiles"
```

## Plan 3 Completion Gate

The feature is complete only when all items below have fresh evidence:

- clean migration reset and every existing/new pgTAP test pass;
- operation parser/diff/merge properties pass;
- duplicate, retry, gap, reverse, partial failure, and two-device concurrency converge;
- every progress counter, weapon/target record, daily quest, stamp, achievement, title, skin, and input/motion/haptic setting syncs by its locked rule;
- new profile is zero and guest state is unchanged after create/login/logout;
- owner reset invalidates all sessions, preserves progress, and forces new PIN;
- player ID/PIN/internal email/IP/body do not appear in logs, analytics, admin list, or built assets;
- player UI/accessibility/mobile and operator UI checks pass;
- 50-cycle leak test and all-21-weapon regression pass;
- full Vitest, copy lint, typecheck, build, and production dependency audit pass;
- preview game/admin URLs return 200 and PM explicitly approves production;
- migrations/functions/static deploy in order with flags closed, then flags open gradually;
- actual production game/admin/profile/sync checks pass and five-minute observation is clean;
- README and AGENTS are updated only after successful production.
