# Admin, Remote Configuration, and Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-protected operator page for challenge CRUD, feature switches, admin-account status, and anonymous aggregate metrics while preserving no-login gameplay and complete static/local fallback.

**Architecture:** The existing Vite project becomes a two-entry static build: game and admin. Supabase Auth protects operator sessions, Postgres RLS centralizes authorization, Edge Functions validate public analytics and privileged admin-account actions, and the game consumes a cached remote catalog through the Plan B provider interface. Gameplay never depends on a successful remote call.

**Tech Stack:** Existing Vite/TypeScript plus `@supabase/supabase-js`, Supabase Auth/Postgres/Edge Functions, Supabase CLI for migrations and local verification. Current official patterns: publishable browser keys, RLS for exposed tables, `signInWithPassword`, and authenticated/publishable Edge Function modes.

## Global Constraints

- Plans A and B must be complete and green first.
- Player gameplay remains account-free; only operators authenticate.
- Browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Secret/service-role keys never enter source, `VITE_*`, Git, logs, or browser bundles.
- All public tables have RLS enabled before any policy grant.
- Authorization uses one central `is_admin()` database function and an `admin_users` table.
- Raw user text, pointer coordinates, IP, document content, prompts, and PII are never stored by the app.
- Analytics payload accepts enumerated event types, approved IDs, bounded integers, and a one-way install hash only.
- Public event ingestion has per-install/action buckets, maximum 30/minute and 1,000/day.
- Remote config caches for 24 hours; network/4xx/5xx failure uses last-good cache, then built-in catalog.
- Built-in fallback flags are `gamification=true`, `character_variants=true`, `analytics=false`; an actual remote response or unexpired cache overrides them.
- Transient network errors retry at most 3 times with 1s/2s/4s backoff. Never retry 400/401/403.
- Admin authentication must not reveal whether an account exists.
- Production deployment requires a separate explicit user approval after preview verification.
- Each task uses TDD and ends with a focused commit.

---

## Official References Checked

- Supabase client initialization: <https://supabase.com/docs/reference/javascript/initializing>
- Password sign-in: <https://supabase.com/docs/reference/javascript/auth-signinwithpassword>
- Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Secure Edge Functions: <https://supabase.com/docs/guides/functions/auth>
- Authorization headers: <https://supabase.com/docs/guides/functions/auth-headers>

## File Map

```text
admin.html                              Vite admin entry
src/admin/main.ts                       admin boot and auth state
src/admin/api.ts                        typed admin operations
src/admin/view.ts                       login/dashboard rendering
src/admin/style.css                     isolated accessible admin UI
src/services/supabase.ts                single browser client
src/config/quest-provider.ts            remote/cache/built-in fallback
src/config/feature-flags.ts             safe feature flag defaults
src/analytics/client.ts                 batched enum-only event sender
src/analytics/client.test.ts            validation/retry/fallback tests
src/env.ts                              public env validation
supabase/config.toml                    function auth modes
supabase/migrations/*_operations.sql    tables, constraints, RLS, RPC/view
supabase/functions/ingest-analytics/    public validated ingestion
supabase/functions/manage-admin/        authenticated admin management
.env.example                            public variable names only
vite.config.ts                          main/admin multi-page build
```

### Task 1: Add dependencies, environment boundary, and admin build entry

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Create: `.env.example`
- Create: `src/env.ts`
- Create: `src/env.test.ts`
- Create: `src/services/supabase.ts`
- Create: `admin.html`
- Create: `src/admin/main.ts`
- Create: `src/admin/style.css`
- Modify: `vite.config.ts`

**Interfaces:**
- Produces: `PublicEnv`, `supabase|null`, two build HTML entries.
- Consumers: all remote/admin tasks.

- [ ] **Step 1: Install current official packages**

Run:

```bash
npm install @supabase/supabase-js
npm install --save-dev supabase
```

Expected: `package.json` and lockfile record both dependencies.

- [ ] **Step 2: Write environment validation tests**

```ts
expect(readPublicEnv({})).toEqual({ mode: 'offline', url: null, publishableKey: null })
expect(readPublicEnv({ VITE_SUPABASE_URL: 'https://example.supabase.co' })).toEqual({ mode: 'offline', url: null, publishableKey: null })
expect(readPublicEnv({ VITE_SUPABASE_URL: 'javascript:bad', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toEqual({ mode: 'offline', url: null, publishableKey: null })
expect(readPublicEnv({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toEqual({ mode: 'offline', url: null, publishableKey: null })
expect(readPublicEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }).mode).toBe('remote')
```

- [ ] **Step 3: Implement the exact public environment contract**

```ts
export type PublicEnv =
  | { mode: 'offline'; url: null; publishableKey: null }
  | { mode: 'remote'; url: string; publishableKey: string }

export function readPublicEnv(env: Record<string, string | undefined>): PublicEnv {
  const url = env.VITE_SUPABASE_URL?.trim()
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url && !publishableKey) return { mode: 'offline', url: null, publishableKey: null }
  if (!url || !publishableKey) return { mode: 'offline', url: null, publishableKey: null }
  try {
    const parsed = new URL(url)
    const localDev = parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)
    if (parsed.protocol !== 'https:' && !localDev) {
      return { mode: 'offline', url: null, publishableKey: null }
    }
  } catch {
    return { mode: 'offline', url: null, publishableKey: null }
  }
  return { mode: 'remote', url, publishableKey }
}
```

`src/services/supabase.ts` exports one lazily-created client using `createClient(url, publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })`; export `null` in offline mode.

- [ ] **Step 4: Create `.env.example` and reinforce `.gitignore`**

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

Ensure `.gitignore` contains `.env`, `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `*.p12`, `secrets/`, and `config/credentials*`.

- [ ] **Step 5: Create the admin HTML shell and two-entry build**

`admin.html` contains `<main id="admin-app"></main>` and `/src/admin/main.ts`. Set `robots=noindex,nofollow`. Configure:

```ts
build: {
  target: 'es2020',
  outDir: 'dist',
  rollupOptions: { input: { game: 'index.html', admin: 'admin.html' } },
}
```

The first `src/admin/main.ts` renders `운영자 설정을 불러오는 중이에요.` and imports isolated admin CSS.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- src/env.test.ts && npm run build`

Expected: PASS; `dist/index.html` and `dist/admin.html` both exist; no key value appears in built JS when env is empty.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example src/env.ts src/env.test.ts src/services/supabase.ts admin.html src/admin/main.ts src/admin/style.css vite.config.ts
git commit -m "chore: add secure admin application boundary"
```

### Task 2: Create schema, constraints, centralized authorization, and RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202607160001_operations.sql`
- Create: `supabase/rollbacks/202607160001_operations.down.sql`
- Create: `supabase/tests/operations.sql`

**Interfaces:**
- Produces: `is_admin()`, quest/flag/event tables, `analytics_daily` view, `ingest_analytics()` RPC.
- Consumers: Edge Functions and admin client.

- [ ] **Step 1: Initialize local Supabase files**

Run: `npx supabase init`

Keep the generated config and add per-function settings in later tasks.

- [ ] **Step 2: Write the migration with exact domains and tables**

```sql
create type public.quest_event_type as enum ('CHARGE_RELEASED','WEAPON_USED','TARGET_DESTROYED');
create type public.analytics_event_type as enum (
  'visit','first_hit','first_destroy','weapon_use','target_finish_actions',
  'charge_release','charge_cancel','quest_complete','share_complete'
);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','operator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.quest_catalog (
  id text primary key check (id ~ '^[a-z0-9_]{3,64}$'),
  copy text not null check (char_length(copy) between 2 and 60 and position('—' in copy) = 0),
  event_type public.quest_event_type not null,
  target integer not null check (target between 1 and 100),
  active_from timestamptz,
  active_to timestamptz,
  enabled boolean not null default false,
  version integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  check (active_to is null or active_from is null or active_to > active_from)
);

create table public.feature_flags (
  key text primary key check (key in ('gamification_enabled','character_variants_enabled','analytics_enabled')),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  event_type public.analytics_event_type not null,
  day_key date not null,
  install_hash text not null check (install_hash ~ '^[a-f0-9]{64}$'),
  weapon_id text check (weapon_id is null or weapon_id ~ '^[A-Za-z0-9_]{2,40}$'),
  value integer not null default 1 check (value between 0 and 1000),
  created_at timestamptz not null default now()
);

create table public.analytics_rate_limits (
  install_hash text not null,
  bucket_start timestamptz not null,
  bucket_type text not null check (bucket_type in ('minute','day')),
  count integer not null check (count >= 0),
  primary key (install_hash, bucket_start, bucket_type)
);
```

Seed all three flags as `false` with `on conflict do nothing`, and seed the three built-in quests disabled so deploy never silently activates new behavior.

Create the matching rollback in dependency-safe reverse order: revoke function/view access, drop `analytics_daily`, drop both functions, drop the five tables, then drop the two enum types. Never run the rollback automatically; keep it as the reviewed recovery path.

- [ ] **Step 3: Add central authorization and RLS**

```sql
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and active
  );
$$;
```

Enable RLS on all five tables. Grant anon select only on enabled/current `quest_catalog` rows and all `feature_flags` rows. Active admins may CRUD `quest_catalog` and `feature_flags` through policies using `public.is_admin()` with matching `with check`, and may read analytics. On `admin_users`, authenticated users may select only their own row so login status can be checked; browser roles receive no insert/update/delete policy. All account status changes go through the owner-only `manage-admin` function with its service-scoped client. Grant no direct browser insert on analytics tables or access to rate-limit rows.

- [ ] **Step 4: Add aggregate view and atomic ingest RPC**

Create `analytics_daily` with `security_invoker=true`, grouped by day/event/weapon and columns `event_count`, `value_sum`, and `average_value`. `weapon_use` supplies character usage counts; `target_finish_actions.value` supplies actions-to-finish averages; `charge_release` versus `charge_cancel` supplies the charge completion ratio. Create `ingest_analytics(p_install_hash,p_event_type,p_day_key,p_weapon_id,p_value)` as `security definer` with fixed search path. It upserts minute/day buckets, raises `rate_limited` above 30/minute or 1000/day, then inserts one bounded event. Revoke direct execution from anon/authenticated; grant only to service role.

- [ ] **Step 5: Add pgTAP-style SQL assertions**

Test flags default closed, anon sees only enabled active quests, anon cannot mutate, non-admin authenticated users cannot read analytics or mutate config, an operator can CRUD quests/flags but cannot mutate `admin_users`, an owner has the same direct-table limits, disabled admins lose access, and ingest limits reject event 31 in a minute.

- [ ] **Step 6: Apply and verify locally**

Run:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
```

Expected: migration and SQL tests PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/config.toml supabase/migrations/202607160001_operations.sql supabase/rollbacks/202607160001_operations.down.sql supabase/tests/operations.sql
git commit -m "security: add operations schema and rls"
```

### Task 3: Remote quest and feature-flag provider with local fallback

**Files:**
- Create: `src/config/quest-provider.ts`
- Create: `src/config/quest-provider.test.ts`
- Create: `src/config/feature-flags.ts`
- Modify: `src/main.ts`
- Modify: `src/game.ts`

**Interfaces:**
- Implements: Plan B `QuestCatalogProvider`.
- Produces: `{ catalog, flags, source: 'remote'|'cache'|'builtIn' }`.

- [ ] **Step 1: Write fallback-order tests**

Test: fresh remote success caches, remote timeout uses unexpired cache, expired/malformed cache uses built-in, 400/401/403 do not retry, 500 retries at 1s/2s/4s through an injected sleeper, disabled flags override remote catalog, and no remote client returns built-in immediately.

- [ ] **Step 2: Implement cache and normalization**

Use cache key `btw.remoteConfig.v1` with `fetchedAt`, exact quest fields, and exact flag keys. TTL is `86_400_000`ms. Normalize IDs, 2-60 character copy, event enum, target 1-100, and ISO dates. Reject the whole remote response if duplicate IDs or unknown flag keys exist.

Export `BUILT_IN_FLAGS = { gamification_enabled: true, character_variants_enabled: true, analytics_enabled: false }`. This preserves the complete personal/static game when no backend is configured while analytics always stays opt-in. A valid remote or cached `false` value wins over the built-in value.

- [ ] **Step 3: Implement remote reads**

Select explicit columns, never `*`:

```ts
const quests = await supabase.from('quest_catalog')
  .select('id,copy,event_type,target,active_from,active_to,enabled,version')
  .eq('enabled', true)
const flags = await supabase.from('feature_flags').select('key,enabled,updated_at')
```

Each request has an 8-second `AbortController` timeout. Fetch both in parallel once per boot. No duplicate call from UI components.

- [ ] **Step 4: Wire boot without blocking play**

Start Game immediately with built-in catalog. Load remote config in the background. Apply a new catalog only before the current day has assigned a quest; never reroll the current day. `gamification_enabled=false` hides challenge/stamp progress and stops their reducers while retaining local lifetime stats and skin controls. `character_variants_enabled=false` uses the shared deterministic safe quick/charged profiles instead of random character move selection; it never restores one-shot damage. `analytics_enabled=false` stops and clears the in-memory outbound queue. Flag changes apply only after the current action settles.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/config/quest-provider.test.ts && npm run build`

```bash
git add src/config/quest-provider.ts src/config/quest-provider.test.ts src/config/feature-flags.ts src/main.ts src/game.ts
git commit -m "feat: add remote configuration fallback"
```

### Task 4: Validated anonymous analytics ingestion

**Files:**
- Create: `src/analytics/client.ts`
- Create: `src/analytics/client.test.ts`
- Create: `supabase/functions/ingest-analytics/index.ts`
- Modify: `supabase/config.toml`
- Modify: `src/game.ts`

**Interfaces:**
- Consumes: accepted Plan B events only.
- Produces: bounded batched POST through `supabase.functions.invoke('ingest-analytics')`.

- [ ] **Step 1: Write analytics client tests**

Test enum mapping, install seed SHA-256 hashing, raw seed absent from body, unsupported event ignored, max batch 20, flush on 10 seconds/pagehide, 400/401/403 drop without retry, 429 drop for current session, network/5xx retry 1s/2s/4s, and queue cap 100 with oldest discard.

- [ ] **Step 2: Implement the client**

```ts
export interface AnalyticsPayload {
  eventType: 'visit' | 'first_hit' | 'first_destroy' | 'weapon_use' | 'target_finish_actions' | 'charge_release' | 'charge_cancel' | 'quest_complete' | 'share_complete'
  dayKey: string
  installHash: string
  weaponId: string | null
  value: number
}
```

The client is disabled when the flag is false, Supabase is absent, or the session received 401/403/429. `weapon_use` is emitted once per settled user action, `target_finish_actions.value` is the bounded count `1..3`, `charge_release` means a charging state ended in a release, and `charge_cancel` means it ended through input/visibility/target cancellation. Demo/system actions emit none. The client never throws into Game.

- [ ] **Step 3: Configure and implement the public function**

Set:

```toml
[functions.ingest-analytics]
verify_jwt = false
```

Use `withSupabase({ auth: 'publishable' }, handler)` from `npm:@supabase/server`. Parse a maximum 20-item JSON array, reject unknown keys and invalid enums/ranges, then call the service-scoped `ingest_analytics` RPC for each item. Return per-item accepted/rejected counts, never echo payloads or hashes.

- [ ] **Step 4: Serve and test locally**

Run:

```bash
npx supabase functions serve ingest-analytics
npm test -- src/analytics/client.test.ts
```

Use `curl` with the local publishable key to verify a valid batch returns `200`, malformed returns `400`, wrong key returns `401`, and limit overflow returns `429` without inserting extra rows.

- [ ] **Step 5: Commit**

```bash
git add src/analytics/client.ts src/analytics/client.test.ts supabase/functions/ingest-analytics/index.ts supabase/config.toml src/game.ts
git commit -m "feat: add privacy-limited analytics"
```

### Task 5: Admin authentication, CRUD, flags, metrics, and account status

**Files:**
- Create: `src/admin/api.ts`
- Create: `src/admin/api.test.ts`
- Create: `src/admin/view.ts`
- Modify: `src/admin/main.ts`
- Modify: `src/admin/style.css`
- Create: `supabase/functions/manage-admin/index.ts`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: one normalized admin API and accessible operator UI.
- Consumes: Supabase authenticated session and central RLS.

- [ ] **Step 1: Write admin API tests with a fake Supabase client**

Cover sign-in normalization, sign-out, session restore, non-admin denial, explicit column selects, quest copy/target validation, CRUD errors, flag update, daily metrics mapping, admin account list/activate/deactivate, and primary operation success even if analytics side effects fail.

- [ ] **Step 2: Implement ID/PW sign-in**

```ts
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
if (error || !data.user) return { ok: false, message: '로그인 정보를 다시 확인해 주세요.' }
```

After auth, select the current user's `admin_users` row. Return the same user-facing login message for nonexistent account, wrong password, inactive admin, or missing role. Log only normalized error codes in development.

- [ ] **Step 3: Implement the admin API**

Expose functions: `listQuests`, `createQuest`, `updateQuest`, `deleteQuest`, `setQuestEnabled`, `listFlags`, `setFlag`, `loadDailyMetrics`, `listAdmins`, `setAdminActive`. Quest/flag/metric operations use explicit-column Supabase queries and RLS. `listAdmins` and `setAdminActive` call the authenticated `manage-admin` Edge Function because browser clients cannot safely read Auth email data. Every mutation validates ID/copy/event/target/date order locally. Do not use `select('*')`.

- [ ] **Step 4: Implement operator UI states**

Provide complete loading, login, empty, error, and success states. Dashboard sections:

1. `오늘의 도전 관리`: table plus create/edit dialog and on/off switch
2. `기능 설정`: three switches with current saved state
3. `사용 통계`: 방문, 첫 유효 공격, 첫 파괴, 충전 완료율, 도전 완료, 공유 완료, 캐릭터별 사용 수, 평균 완파 행동 수
4. `운영자 계정`: email/role/status and activate/deactivate

Use native forms, labelled inputs, 44px controls, confirmation for disabling the current operator or deleting a quest, focus restoration, and no user-facing technical terms.

- [ ] **Step 5: Implement privileged admin management function**

Keep default `verify_jwt=true` and use `withSupabase({ auth: 'user' }, handler)`. Confirm the caller's active `owner` row using the RLS-scoped client before using `supabaseAdmin`. The `list` action joins only auth user ID/email with `admin_users.role/active`; the `set-active` action updates an existing `admin_users.active` value, rejects self-disable, and never changes owner role. Responses never expose password hashes, tokens, provider data, or metadata.

Bootstrap the first owner only after local/preview verification: in Supabase Dashboard, open `Authentication > Users > Add user`, create the user's email/password with email confirmed, copy its UUID, then run `insert into public.admin_users (user_id, role, active) values ('<copied-uuid>', 'owner', true);` in `SQL Editor`. Verify the same UUID appears once and the login opens the dashboard. No seed password or owner UUID enters source or migration files.

- [ ] **Step 6: Run tests and browser verification**

Run: `npm test -- src/admin/api.test.ts && npm run build`

Serve locally and verify: wrong login identical response, owner login, operator denial for account changes, quest CRUD, invalid copy rejection, flags save and reload, metrics empty state, admin activate/deactivate, mobile 390×844 and desktop 1280×800 layouts, sign-out, refresh session restore, no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/admin/api.ts src/admin/api.test.ts src/admin/view.ts src/admin/main.ts src/admin/style.css supabase/functions/manage-admin/index.ts supabase/config.toml
git commit -m "feat: add operator dashboard"
```

### Task 6: Integrated verification, preview, and concise release summary

**Files:**
- Modify after verified preview and approved production deploy: `README.md`
- Modify after verified production deploy: `AGENTS.md`
- Modify: `src/ui/whatsnew.ts` only if final delivered wording differs from Plan B

**Interfaces:**
- Produces: full quality gate, deploy-safe workflow, PM-facing latest-update summary.

- [ ] **Step 1: Run the complete local gate**

Run:

```bash
npm run lint:copy
npm test
npm run typecheck
npm run build
npx supabase db reset
npx supabase test db
```

Expected: all PASS.

- [ ] **Step 2: Verify actual local APIs and pages**

- Call analytics function with valid, invalid, unauthorized, and rate-limited requests.
- Sign in to `/admin.html`, create/modify/disable a challenge, and verify the game reads it once then caches it.
- Stop Supabase and verify the game still starts, keeps local progress, assigns built-in challenge, and shows no technical error.
- Verify main/admin console contains no errors or raw payload/hash logging.

- [ ] **Step 3: Verify full mobile gameplay**

At 390×844 and real iOS Safari/Android Chrome, run all Plan A/B acceptance checks, then verify remote-on, remote-off, cache, offline, analytics-off, reduced motion, haptics-off, and double-tap strong input.

- [ ] **Step 4: Prepare preview deploy and rollback**

Confirm env diff, feature flags default closed, migration forward order, SQL rollback file, previous Pages artifact, and built-in fallback. Run the production build through local `vite preview`, open the game and `/admin.html` in the shared in-app browser, and present the verification record. Do not run the Pages workflow or change production in this step.

- [ ] **Step 5: Obtain explicit production approval**

Show the local preview and verification record to the user. Production remains blocked until they explicitly approve.

- [ ] **Step 6: Deploy production and perform post-deploy checks**

After approval, apply migration, deploy Edge Functions, enable only verified flags, finish and merge `codex/gamification-upgrade` into `main`, push `main`, manually dispatch the Pages workflow, hit the actual game/admin URLs, perform one real admin config change, confirm fallback, and observe errors/latency for five minutes. Fetch and inspect remote state immediately before the merge/push. Roll back flags first if any gameplay regression appears.

- [ ] **Step 7: Update PM and agent documentation after deployment**

Add this exact concise section near the top of `README.md`:

```md
## 최근 업데이트: 2026-07-16

- 꾹 누르기 강타와 무기별 충전 효과 추가
- 캐릭터 9종에 각기 다른 기술 3개 적용
- 오늘의 도전 1개와 영구 도장 5개 추가
- 기록책에서 통계·칭호·캐릭터 모습 확인
- 운영자 화면에서 도전·기능·통계 관리
```

Update `AGENTS.md` status from planned to implemented/deployed, replace planned architecture/schema statements with actual paths and deployed behavior, and append one condensed version-history line. Ensure `WhatsNew` shows the same four user-facing themes once per version.

- [ ] **Step 8: Commit documentation**

```bash
git add README.md AGENTS.md src/ui/whatsnew.ts
git commit -m "docs: summarize 2026-07-16 gameplay update"
```

## Plan C Completion Gate

- Main and admin entries build and load with correct base paths.
- RLS denies all unauthorized writes/analytics reads; service/secret keys are absent from the bundle and Git.
- Admin login, quest CRUD, flags, metrics, and account status work with complete UI states.
- Analytics accepts only bounded enum payloads and enforces 30/minute plus 1,000/day limits.
- Remote failures never prevent game boot, progress, quest assignment, or sharing.
- Full tests, typecheck, build, SQL tests, API calls, mobile browser verification, preview, explicit production approval, production smoke test, and five-minute observation complete.
- README and AGENTS carry the exact recent-update date and short bullet summary after deployment.
