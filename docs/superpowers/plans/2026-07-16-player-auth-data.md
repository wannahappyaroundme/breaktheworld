# Player Auth and Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-controlled player identity system with globally unique profile IDs, exact six-digit PIN authentication, persistent Supabase sessions, owner-operated PIN reset, deactivation, and deletion without exposing email or privileged keys to players.

**Architecture:** A public `player-auth` Edge Function is the only unauthenticated entry for name checks, profile creation, and login. It maps the public normalized profile name to a random internal Supabase Auth email, relies on Supabase Auth for password hashing and sessions, and applies database-backed limits before every credential attempt. Player tables are browser-inaccessible; owner actions run through an authenticated `manage-player` Edge Function and a versioned reset saga.

**Tech Stack:** Existing Vite 5, TypeScript, Vitest, `@supabase/supabase-js` 2.109.x, Supabase Auth/Postgres/Edge Functions, Supabase CLI 2.109.x, pgTAP.

## Global Constraints

- Guest play remains immediately available and does not call player Auth.
- Profile ID is the login ID; no player email, phone number, real name, or birth date is collected.
- Profile IDs accept only completed Hangul syllables, ASCII letters, and digits; length is 2-12 Unicode code points.
- Normalize profile IDs with NFC; lowercase ASCII letters only for `name_key`; `Yejin` and `yejin` conflict.
- Duplicate check is advisory; `UNIQUE(name_key)` is the final decision during creation.
- PIN is a string matching exactly `^\d{6}$`; preserve leading zeroes; require confirmation on create/reset/change.
- New profiles start with no progress; never import guest state.
- General Supabase signup remains disabled; only `player-auth` uses server-side `admin.createUser` with random internal email.
- Browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; secret/service-role keys remain in Edge secrets.
- Login failures for missing, inactive, and wrong-PIN profiles return the same user message and status.
- Limits: name check 30/minute per derived requester, signup 5/hour, login 5/15 minutes per name+requester and 20/hour per requester.
- Normal logout is local-device only; owner PIN reset invalidates every refresh session and rejects old access tokens immediately.
- Player table reads/writes are unavailable to `anon` and `authenticated`; Edge Functions validate ownership from JWT claims.
- Logs and analytics never contain profile ID, internal Auth email, PIN, raw IP, or request body.
- All new feature flags default closed.
- Each task uses TDD and ends with a focused conventional commit.
- Production deployment remains forbidden until preview approval after all three player-profile plans pass.

---

## Official References Checked

- Auth sessions and refresh tokens: <https://supabase.com/docs/guides/auth/sessions>
- Password sign-in: <https://supabase.com/docs/reference/javascript/auth-signinwithpassword>
- Server-only user creation: <https://supabase.com/docs/reference/javascript/auth-admin-createuser>
- Server-only user update: <https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid>
- Logout scopes: <https://supabase.com/docs/guides/auth/signout>
- Custom access-token hook: <https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>
- Verified JWT custom claims: <https://supabase.com/docs/reference/javascript/auth-getclaims>
- Edge Function authentication: <https://supabase.com/docs/guides/functions/auth>
- Auth rate limits and forwarded requester IP: <https://supabase.com/docs/guides/auth/rate-limits>
- Scheduled database cleanup: <https://supabase.com/docs/guides/cron>

## File Map

```text
supabase/functions/_shared/player-contract.ts       browser-safe profile/PIN contracts
supabase/functions/_shared/player-auth-handler.ts   check/create/login/change-PIN orchestration
supabase/functions/player-auth/index.ts             Edge dependency wiring and CORS boundary
supabase/functions/_shared/manage-player-handler.ts owner list/reset/status/delete orchestration
supabase/functions/manage-player/index.ts           authenticated owner Edge entry
supabase/migrations/202607160002_player_auth.sql     profile/auth/rate/audit schema and JWT hook
supabase/rollbacks/202607160002_player_auth.down.sql guarded pre-launch rollback
supabase/tests/player_auth.sql                       pgTAP constraints, grants, hook, and cascade
src/player/admin-contract.ts                         strict operator response types
src/admin/api.ts                                     typed player management requests
src/admin/api.test.ts                                malformed/failure/success response tests
src/admin/manage-player-handler.test.ts              owner action handler tests
supabase/config.toml                                 function auth modes and access-token hook
```

### Task 1: Lock the shared profile and PIN contract

**Files:**
- Create: `supabase/functions/_shared/player-contract.ts`
- Create: `src/player/player-contract.test.ts`

**Interfaces:**
- Produces: `normalizeProfileName`, `validatePinPair`, `PlayerAuthRequest`, `PlayerSessionPayload`, `PLAYER_PRIVACY_VERSION`.
- Consumers: both Edge handlers, frontend API and profile UI in Plan 2.

- [ ] **Step 1: Write failing normalization and exact-shape tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  normalizeProfileName,
  parsePlayerAuthRequest,
  validatePinPair,
} from '../../supabase/functions/_shared/player-contract'

describe('player contract', () => {
  it.each([
    ['예진', { displayName: '예진', nameKey: '예진' }],
    ['Yejin2455', { displayName: 'Yejin2455', nameKey: 'yejin2455' }],
    ['A\u0301A', null],
    ['ㄱ예진', null],
    ['예 진', null],
    ['예진!', null],
    ['가', null],
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeProfileName(raw)).toEqual(expected)
  })

  it('keeps leading zeroes and requires matching six digits', () => {
    expect(validatePinPair('024550', '024550')).toEqual({ ok: true, pin: '024550' })
    expect(validatePinPair('24550', '24550')).toEqual({ ok: false, code: 'invalid_pin' })
    expect(validatePinPair('024550', '024551')).toEqual({ ok: false, code: 'pin_mismatch' })
  })

  it('rejects unknown request keys', () => {
    expect(parsePlayerAuthRequest({ action: 'login', profileName: '예진', pin: '024550', email: 'x' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run the focused test and confirm missing-module failure**

Run: `npm test -- src/player/player-contract.test.ts`

Expected: FAIL because `player-contract.ts` does not exist.

- [ ] **Step 3: Implement the exact shared types and validators**

```ts
export const PLAYER_PRIVACY_VERSION = 1
export const PROFILE_NAME_PATTERN = /^[가-힣A-Za-z0-9]{2,12}$/u
export const PIN_PATTERN = /^\d{6}$/
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export interface NormalizedProfileName {
  displayName: string
  nameKey: string
}

export type PlayerAuthRequest =
  | { action: 'check-name'; profileName: string }
  | {
      action: 'create'
      requestId: string
      profileName: string
      pin: string
      pinConfirmation: string
      privacyVersion: 1
      over14: true
    }
  | { action: 'login'; profileName: string; pin: string }
  | { action: 'session' }
  | { action: 'change-pin'; pin: string; pinConfirmation: string }

export interface PlayerSessionPayload {
  accessToken: string
  refreshToken: string
  expiresAt: number
  profile: {
    userId: string
    displayName: string
    forcePinChange: boolean
    credentialVersion: number
  }
}

export function normalizeProfileName(raw: unknown): NormalizedProfileName | null {
  if (typeof raw !== 'string') return null
  const displayName = raw.normalize('NFC')
  if (Array.from(displayName).length < 2 || Array.from(displayName).length > 12) return null
  if (!PROFILE_NAME_PATTERN.test(displayName)) return null
  return {
    displayName,
    nameKey: displayName.replace(/[A-Z]/g, (value) => value.toLowerCase()),
  }
}

export function validatePinPair(pin: unknown, confirmation: unknown):
  | { ok: true; pin: string }
  | { ok: false; code: 'invalid_pin' | 'pin_mismatch' } {
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return { ok: false, code: 'invalid_pin' }
  if (pin !== confirmation) return { ok: false, code: 'pin_mismatch' }
  return { ok: true, pin }
}
```

`parsePlayerAuthRequest` must require exactly the keys in the selected union member, validate UUID syntax for `requestId` with `isUuid`, require literal privacy version `1`, and require literal `over14: true`. `session` accepts only the `action` key. It returns `null` for arrays, extra keys, missing keys, or wrong primitive types.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- src/player/player-contract.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/player-contract.ts src/player/player-contract.test.ts
git commit -m "feat: define player identity contract"
```

### Task 2: Add the private player identity schema and access-token hook

**Files:**
- Create: `supabase/migrations/202607160002_player_auth.sql`
- Create: `supabase/rollbacks/202607160002_player_auth.down.sql`
- Create: `supabase/tests/player_auth.sql`
- Modify: `supabase/config.toml`

**Interfaces:**
- Produces: player identity tables, `consume_player_auth_limit`, hourly rate-limit cleanup, `player_access_token_hook`, `is_owner`, six closed flags.
- Consumers: Tasks 3-6 and Plans 2-3.

- [ ] **Step 1: Write pgTAP tests before the migration**

`supabase/tests/player_auth.sql` must start a transaction and assert the exact tables, constraints, grants, functions, and hook:

```sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

select has_table('public', 'player_profiles');
select has_table('public', 'player_auth_aliases');
select has_table('public', 'player_auth_rate_limits');
select has_table('public', 'admin_audit_logs');
select has_function('public', 'player_access_token_hook', array['jsonb']);
select has_function('public', 'consume_player_auth_limit', array['text','text','integer','interval']);
select ok(not has_table_privilege('anon', 'public.player_profiles', 'select'));
select ok(not has_table_privilege('authenticated', 'public.player_profiles', 'select'));
select ok(not has_table_privilege('authenticated', 'public.player_auth_aliases', 'select'));
select is((select count(*) from public.feature_flags where key like 'player_%'), 3::bigint);
select is((select count(*) from public.feature_flags where key like 'player_%' and enabled), 0::bigint);
```

Add fixtures proving `예진` conflicts with a second `name_key='예진'`, `Yejin` conflicts with `name_key='yejin'`, invalid names/status/version fail, deleting `auth.users` cascades identity rows, the hourly cleanup removes expired buckets without touching active ones, its named Cron job exists once, `supabase_auth_admin` can read only the hook-required profile columns through its dedicated policy, and the hook adds `credential_version`, `player_status`, and `account_kind='player'` only for player rows. End with `select * from finish(); rollback;`.

- [ ] **Step 2: Run the database tests and confirm failure**

Run: `npx supabase db reset && npx supabase test db`

Expected: FAIL because the player tables and hook are missing.

- [ ] **Step 3: Create bounded enums, tables, and flags**

```sql
create type public.player_status as enum ('active', 'inactive');
create type public.player_admin_action as enum ('pin_reset', 'deactivate', 'delete');

alter table public.feature_flags drop constraint feature_flags_key_check;
alter table public.feature_flags add constraint feature_flags_key_check check (
  key in (
    'gamification_enabled', 'character_variants_enabled', 'analytics_enabled',
    'player_profiles_ui', 'player_signup', 'player_sync_writes'
  )
);

insert into public.feature_flags (key, enabled)
values ('player_profiles_ui', false), ('player_signup', false), ('player_sync_writes', false)
on conflict (key) do nothing;

create table public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 12 and display_name ~ '^[가-힣A-Za-z0-9]+$'),
  name_key text not null unique check (char_length(name_key) between 2 and 12 and name_key ~ '^[가-힣a-z0-9]+$'),
  status public.player_status not null default 'active',
  credential_version integer not null default 1 check (credential_version between 1 and 2147483647),
  force_pin_change boolean not null default false,
  privacy_version integer not null check (privacy_version = 1),
  over_14_confirmed_at timestamptz not null,
  signup_request_id uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_auth_aliases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  auth_email text not null unique check (auth_email ~ '^[0-9a-f-]{36}@players\\.invalid$'),
  created_at timestamptz not null default now()
);

create table public.player_auth_rate_limits (
  action text not null check (action in ('check_name','signup','login_name','login_requester')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  bucket_start timestamptz not null,
  count integer not null check (count between 0 and 100000),
  primary key (action, subject_hash, bucket_start)
);

create index player_auth_rate_limits_expiry_idx
  on public.player_auth_rate_limits (bucket_start);

create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action public.player_admin_action not null,
  request_id uuid not null unique,
  request_fingerprint text not null check (request_fingerprint ~ '^[a-f0-9]{64}$'),
  outcome text not null check (outcome in ('started','completed','failed')),
  step text not null check (step in ('requested','credential_invalidated','password_changed','sessions_revoked','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
```

Enable RLS on all four tables, revoke all privileges from `public`, `anon`, and `authenticated`, grant only the minimum service-role columns/functions, and do not add player browser policies.

- [ ] **Step 4: Add central owner and atomic limiter functions**

```sql
create or replace function public.is_owner()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = (select auth.uid()) and role = 'owner' and active
  );
$$;

create or replace function public.consume_player_auth_limit(
  p_action text,
  p_subject_hash text,
  p_limit integer,
  p_window interval
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz := to_timestamp(
    floor(extract(epoch from v_now) / extract(epoch from p_window))
    * extract(epoch from p_window)
  );
  v_count integer;
begin
  if p_action not in ('check_name','signup','login_name','login_requester')
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_limit < 1 or p_limit > 1000
    or extract(epoch from p_window) < 60 or extract(epoch from p_window) > 86400
  then raise exception 'invalid_limit_request' using errcode = '22023'; end if;

  insert into public.player_auth_rate_limits(action, subject_hash, bucket_start, count)
  values (p_action, p_subject_hash, v_bucket, 1)
  on conflict (action, subject_hash, bucket_start)
  do update set count = public.player_auth_rate_limits.count + 1
  returning count into v_count;
  return query select
    v_count <= p_limit,
    case when v_count <= p_limit then 0 else greatest(
      1,
      ceil(extract(epoch from (v_bucket + p_window - v_now)))::integer
    ) end;
end;
$$;
```

Add `create_player_profile(...)` as a service-role-only security-definer function that inserts `player_profiles` and `player_auth_aliases` in one database transaction and returns `created` or `duplicate_name`. It rejects a request ID already bound to a different normalized name. Revoke all three functions from public roles; grant `is_owner()` to authenticated and the limiter/create functions only to service role.

Add `cleanup_player_auth_rate_limits()` with a fixed search path. It deletes buckets older than 25 hours and returns only the deleted-row count. Enable `pg_cron` if absent and register exactly one named hourly job, `cleanup-player-auth-rate-limits`, that calls this function. Revoke the cleanup function from browser roles. pgTAP must invoke it directly and inspect `cron.job`; deployment verification must inspect its most recent successful run. The 25-hour bound covers the longest one-hour rate window plus scheduling delay while keeping the security-derived values short-lived.

- [ ] **Step 5: Add the custom access-token hook**

```sql
create or replace function public.player_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
  v_claims jsonb := event->'claims';
  v_credential_version integer;
  v_status public.player_status;
begin
  select credential_version, status
  into v_credential_version, v_status
  from public.player_profiles
  where user_id = (event->>'user_id')::uuid;
  if not found then return event; end if;
  v_claims := jsonb_set(v_claims, '{credential_version}', to_jsonb(v_credential_version));
  v_claims := jsonb_set(v_claims, '{player_status}', to_jsonb(v_status::text));
  v_claims := jsonb_set(v_claims, '{account_kind}', '"player"'::jsonb);
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant select (user_id, credential_version, status) on public.player_profiles to supabase_auth_admin;
grant execute on function public.player_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.player_access_token_hook(jsonb) from public, anon, authenticated;

create policy "Auth hook reads current player credential"
on public.player_profiles for select
to supabase_auth_admin
using (true);
```

Configure:

```toml
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/player_access_token_hook"

[functions.player-auth]
verify_jwt = false

[functions.manage-player]
verify_jwt = true
```

- [ ] **Step 6: Add a guarded rollback**

The down migration first raises `player_profiles_not_empty` if any player exists. Only an empty pre-launch schema may unschedule the specifically named cleanup job, drop the cleanup/hook/schema objects, and restore the original three-key flag constraint. It leaves the shared `pg_cron` extension installed because another project job may use it, and it must never delete a real profile as a rollback shortcut.

- [ ] **Step 7: Reset, run pgTAP, and commit**

Run: `npx supabase db reset && npx supabase test db`

Expected: existing 97 tests plus all new player-auth tests PASS.

```bash
git add supabase/config.toml supabase/migrations/202607160002_player_auth.sql supabase/rollbacks/202607160002_player_auth.down.sql supabase/tests/player_auth.sql
git commit -m "security: add private player identity schema"
```

### Task 3: Implement rate-limited name check, creation, and login

**Files:**
- Create: `supabase/functions/_shared/player-auth-handler.ts`
- Create: `src/player/player-auth-handler.test.ts`

**Interfaces:**
- Consumes: Task 1 contracts and Task 2 tables/RPC.
- Produces: `createPlayerAuthHandler(dependencies): (request) => Promise<Response>`.
- Consumer: Task 4 Edge entry and Plan 2 frontend API.

- [ ] **Step 1: Write handler tests with in-memory dependencies**

Test exact response status/body for method rejection, unknown keys, malformed name/PIN, rate limit, available/duplicate, create success, duplicate race cleanup, idempotent repeated `requestId`, generic login failure, inactive profile, and session success.

```ts
expect(await body(handler(request({ action: 'check-name', profileName: 'Yejin' })))).toEqual({ available: true })
expect(await body(handler(request({ action: 'login', profileName: 'missing', pin: '024550' })))).toEqual({ code: 'login_failed' })
expect(await body(handler(request({ action: 'login', profileName: 'Yejin', pin: '999999' })))).toEqual({ code: 'login_failed' })
expect(logs.join(' ')).not.toContain('Yejin')
expect(logs.join(' ')).not.toContain('024550')
```

- [ ] **Step 2: Run and confirm missing-handler failure**

Run: `npm test -- src/player/player-auth-handler.test.ts`

Expected: FAIL.

- [ ] **Step 3: Define dependency boundaries and response helpers**

```ts
export interface PlayerProfileRow {
  user_id: string
  display_name: string
  name_key: string
  status: 'active' | 'inactive'
  credential_version: number
  force_pin_change: boolean
  signup_request_id: string
}

export interface PlayerAuthDependencies {
  requester(request: Request): Promise<{ forwardedFor: string; fingerprintHash: string }>
  isFlagEnabled(key: 'player_signup'): Promise<boolean>
  consume(action: 'check_name'|'signup'|'login_name'|'login_requester', subjectHash: string, limit: number, seconds: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  findByNameKey(nameKey: string): Promise<(PlayerProfileRow & { auth_email: string }) | null>
  findByRequestId(requestId: string): Promise<(PlayerProfileRow & { auth_email: string }) | null>
  createAuthUser(email: string, pin: string): Promise<{ id: string }>
  createProfile(input: PlayerProfileRow & { auth_email: string; privacy_version: 1; over_14_confirmed_at: string }): Promise<'created'|'duplicate_name'>
  deleteAuthUser(userId: string): Promise<void>
  signIn(email: string, pin: string, forwardedFor: string): Promise<{ access_token: string; refresh_token: string; expires_at: number } | null>
  nowIso(): string
  randomUuid(): string
}
```

Every response uses `content-type: application/json`, `cache-control: no-store`, and no profile/PIN echo on errors.

- [ ] **Step 4: Implement the exact action rules**

- `check-name`: normalize, consume 30/60s for requester fingerprint hash, return `{available}`.
- `create`: require `player_signup=true`, otherwise return 503 `{code:'signup_closed'}`; normalize/validate; consume 5/3600s; if `requestId` exists with the same `name_key`, sign in and return the same profile; otherwise create `${randomUuid()}@players.invalid`, then insert profile+alias. On UNIQUE duplicate, delete the newly created Auth user and return `{code:'name_taken'}` with 409. On any other profile insert failure, delete the Auth user and return 503.
- `login`: consume requester 20/3600s and `sha256(fingerprintHash:nameKey)` 5/900s before Auth; inactive/missing/wrong PIN all return status 401 and `{code:'login_failed'}`; forward the in-memory original requester IP to Supabase Auth using the official secret-key forwarding header, then discard it.
- any exhausted limiter returns 429 `{code:'rate_limited',retryAfterSeconds}` without revealing which profile/name bucket was hit; calculate retry time from the current database bucket rather than a client clock.
- successful create/login: return only `PlayerSessionPayload`; never return internal email.
- any thrown dependency failure: return 503 `{code:'service_unavailable'}` without the thrown message.

- [ ] **Step 5: Run tests and commit**

Run: `npm test -- src/player/player-auth-handler.test.ts && npm run typecheck`

```bash
git add supabase/functions/_shared/player-auth-handler.ts src/player/player-auth-handler.test.ts
git commit -m "security: broker player profile authentication"
```

### Task 4: Wire the public Edge Function and credential-version guard

**Files:**
- Create: `supabase/functions/player-auth/index.ts`
- Create: `supabase/functions/_shared/player-request-security.ts`
- Create: `src/player/player-request-security.test.ts`

**Interfaces:**
- Produces: deployed `player-auth` function; `verifyCurrentPlayer(request, clients)` for all authenticated player functions.
- Consumers: Plan 2 API and Plan 3 `player-sync`.

- [ ] **Step 1: Write security helper tests**

Cover missing/invalid JWT, admin/non-player JWT, inactive profile, stale credential claim, and active current player. A token with claim `credential_version=2` must fail when the row is version 3.

- [ ] **Step 2: Implement the exact guard result**

```ts
export type VerifiedPlayer = {
  userId: string
  displayName: string
  credentialVersion: number
  forcePinChange: boolean
}

export type PlayerVerification =
  | { ok: true; player: VerifiedPlayer }
  | { ok: false; status: 401|403; code: 'authentication_required'|'session_expired' }
```

`verifyCurrentPlayer` extracts the Bearer token and calls `auth.getClaims(token)` so signature, expiry, subject, and the custom claims are verified by the installed Supabase client. It requires `account_kind='player'`, uses the verified `sub` to load `player_profiles` through the service client, requires active status, and compares the numeric `credential_version` claim to the current row. It never decodes an unverified JWT and never trusts a body `userId`.

- [ ] **Step 3: Implement authenticated session restore and forced PIN change**

- `session`: require `verifyCurrentPlayer`; return the current public profile without internal email or progress.
- `change-pin`: require a current active player with `forcePinChange=true`, validate the matching PIN pair, load the private alias, update the Supabase Auth password, increment `credential_version`, clear `force_pin_change`, globally sign out using the caller access token, sign in once with the new PIN, and return the replacement `PlayerSessionPayload` carrying the new credential claim.
- if password update succeeds but a later step fails, return 503 and allow direct login with the new PIN; never restore the old PIN or report success with a stale session.
- a player without `forcePinChange` receives 409 `{code:'change_not_required'}` so this increment does not silently become a general PIN settings feature.

Add tests proving an old access token fails after change, all old refresh sessions fail, the replacement session works, and no PIN/internal alias reaches logs.

- [ ] **Step 4: Wire Edge dependencies without logging sensitive data**

Create one publishable Auth client with no session persistence for password sign-in and one secret client for Auth admin/database work. `OPTIONS` returns the existing project CORS headers. POST delegates to `createPlayerAuthHandler`; all other methods return 405.

Required secrets:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
PLAYER_RATE_LIMIT_PEPPER
PLAYER_ADMIN_REQUEST_PEPPER
```

Hash `requesterIp + YYYY-MM-DD + PLAYER_RATE_LIMIT_PEPPER` with SHA-256. Do not print the IP, hash, request body, profile name, alias, or Auth error. The only allowed log fields are route action enum, HTTP status, duration bucket, and exception class.

- [ ] **Step 5: Run unit and local function smoke tests**

Run:

```bash
npm test -- src/player/player-request-security.test.ts src/player/player-auth-handler.test.ts
npx supabase functions serve player-auth --env-file supabase/.env.local
```

In another shell call an invalid body and expect HTTP 400 with `{"code":"invalid_request"}`. Stop the function server after the check.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/player-auth/index.ts supabase/functions/_shared/player-request-security.ts src/player/player-request-security.test.ts
git commit -m "security: enforce current player sessions"
```

### Task 5: Implement owner player management and idempotent PIN reset

**Files:**
- Create: `supabase/functions/_shared/manage-player-handler.ts`
- Create: `supabase/functions/manage-player/index.ts`
- Create: `src/admin/manage-player-handler.test.ts`

**Interfaces:**
- Produces actions `list`, `deactivate`, `reset-pin`, and `delete` for active owners only. Resetting an inactive profile also reactivates it.
- Consumers: Task 6 Admin API and Plan 3 operator view.

- [ ] **Step 1: Write adversarial handler tests**

Cover non-POST, unauthenticated, operator-not-owner, exact request keys, list data minimization, invalid PIN, reset retry by `requestId`, request-ID reuse with a different target/action/PIN/confirmation, failure after password update, global logout failure, force-change completion, deactivate, reset-and-reactivate, exact-name delete confirmation, cascade failure, and audit rows without PIN/name.

```ts
expect(await response(handler, { action: 'reset-pin', requestId, userId, pin: '024550', pinConfirmation: '024550' })).toMatchObject({ status: 200 })
expect(calls.globalSignOut).toBe(1)
expect(calls.audit.at(-1)).toMatchObject({ action: 'pin_reset', outcome: 'completed' })
expect(JSON.stringify(calls.audit)).not.toContain('024550')
```

- [ ] **Step 2: Define exact public admin shapes**

```ts
export interface ManagedPlayer {
  userId: string
  displayName: string
  status: 'active' | 'inactive'
  forcePinChange: boolean
  createdAt: string
  lastSyncAt: string | null
}

export type ManagePlayerRequest =
  | { action: 'list' }
  | { action: 'deactivate'; requestId: string; userId: string }
  | { action: 'reset-pin'; requestId: string; userId: string; pin: string; pinConfirmation: string }
  | { action: 'delete'; requestId: string; userId: string; confirmation: string }
```

List never includes internal email, raw progress, PIN metadata, IP, or signup request ID.

- [ ] **Step 3: Implement the reset saga**

For one `requestId`:

1. Canonicalize the action/target and secret input, compute HMAC-SHA256 with `PLAYER_ADMIN_REQUEST_PEPPER`, and insert audit `started` at step `requested`; if the request exists with the same actor/target/action/fingerprint, resume from its stored step. Reject reuse for different input. The database stores only the keyed fingerprint, never the PIN or confirmation text.
2. Increment `credential_version`, set `force_pin_change=true`, then update Auth password.
3. Sign in server-side using the private alias and temporary PIN to obtain a player JWT.
4. Call Auth Admin `signOut(accessToken, 'global')`; this removes every refresh session including the temporary server session.
5. Set profile status `active`, mark audit `completed`, and return `{player}`.
6. If a step fails, mark `failed`, return 503, and allow the same `requestId` to retry unfinished steps. Never return success before global signout.

Old access tokens remain cryptographically valid until expiry, but Task 4 rejects them immediately because their credential-version claim is stale.

- [ ] **Step 4: Implement state and delete actions**

- `deactivate`: set status `inactive` and increment credential version so every old access token is rejected immediately. Do not offer a separate activation call because an old refresh token could otherwise regain access without PIN verification. The owner reactivates by running `reset-pin`, whose known temporary PIN permits official global session revocation before status becomes active.
- `delete`: require `confirmation === display_name`; delete Auth user through Admin API; foreign-key cascades all profile data; retain only audit actor UUID, target UUID, action, outcome, and timestamps.
- every action rechecks current owner status through `admin_users`; hiding UI is not authorization.

- [ ] **Step 5: Wire `manage-player` with authenticated JWT context**

Follow the existing `manage-admin/index.ts` pattern: user-scoped client for caller identity/owner row and secret client for privileged Auth/table operations. Function config keeps JWT verification enabled.

- [ ] **Step 6: Run tests and commit**

Run: `npm test -- src/admin/manage-player-handler.test.ts && npm run typecheck`

```bash
git add supabase/functions/_shared/manage-player-handler.ts supabase/functions/manage-player/index.ts src/admin/manage-player-handler.test.ts
git commit -m "security: add owner player account controls"
```

### Task 6: Add typed operator API methods without exposing player internals

**Files:**
- Create: `src/player/admin-contract.ts`
- Modify: `src/admin/api.ts`
- Modify: `src/admin/api.test.ts`

**Interfaces:**
- Produces: `AdminApi.listPlayers`, `deactivatePlayer`, `resetPlayerPin`, `deletePlayer`.
- Consumer: operator UI in Plan 3.

- [ ] **Step 1: Write strict response-parser tests**

Test successful list/actions and reject extra keys, internal email, invalid status/date, unknown player, generic request failures, invalid PIN pair, and delete confirmation mismatch.

- [ ] **Step 2: Define strict contract parsers**

```ts
export function isManagedPlayer(value: unknown): value is ManagedPlayer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join(',') === 'createdAt,displayName,forcePinChange,lastSyncAt,status,userId'
    && typeof row.userId === 'string'
    && typeof row.displayName === 'string'
    && (row.status === 'active' || row.status === 'inactive')
    && typeof row.forcePinChange === 'boolean'
    && typeof row.createdAt === 'string'
    && (row.lastSyncAt === null || typeof row.lastSyncAt === 'string')
}
```

- [ ] **Step 3: Add exact API methods**

Each method invokes `manage-player`, validates the full response shape, maps any function/Auth/network error to the existing normalized `ApiResult`, and emits mutation feedback only after success.

```ts
async resetPlayerPin(userId: string, pin: string, confirmation: string): Promise<ApiResult<ManagedPlayer>> {
  const checked = validatePinPair(pin, confirmation)
  if (!checked.ok) return failure('validation', checked.code === 'pin_mismatch'
    ? 'PIN을 같은 숫자 6자리로 다시 입력해 주세요.'
    : 'PIN은 숫자 6자리로 입력해 주세요.')
  const result = await this.client.functions.invoke('manage-player', {
    body: { action: 'reset-pin', requestId: crypto.randomUUID(), userId, pin: checked.pin, pinConfirmation: checked.pin },
  })
  if (result.error || !isManagedPlayerPayload(result.data)) return failure('request', SAVE_MESSAGE)
  this.feedback('player-pin-reset')
  return { ok: true, data: result.data.player }
}
```

Use the same UUID-per-click rule for deactivate and delete. Do not retry mutations with a new request ID; a caller retry reuses the pending ID until the request resolves.

- [ ] **Step 4: Run tests and commit**

Run: `npm test -- src/admin/api.test.ts && npm run typecheck`

```bash
git add src/player/admin-contract.ts src/admin/api.ts src/admin/api.test.ts
git commit -m "feat: add typed player administration API"
```

### Task 7: Prove session issuance, persistence, and global invalidation locally

**Files:**
- Create: `scripts/verify-player-auth.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: repeatable `npm run verify:player-auth` local integration gate.
- Consumer: Plans 2-3 and pre-deploy checklist.

- [ ] **Step 1: Add secret-safe script inputs and ignore rules**

The script reads only local values from `npx supabase status -o env`; it never writes them. Ensure `.gitignore` keeps `supabase/.temp/`, `supabase/.branches/`, and `supabase/.env.local` untracked.

Before exercising owner-only actions, create a one-run Auth owner fixture with the local service-role client, insert its UUID into `admin_users` as active `owner`, and obtain its access token through the local Auth API. Generate the fixture email/password in memory, never print them, and delete both the Auth user and `admin_users` row in a `finally` block even when an assertion fails. Do not depend on a developer's existing local owner account.

- [ ] **Step 2: Implement the exact integration scenario**

The Node script must:

1. confirm general `/auth/v1/signup` is closed;
2. create profile `AuthTest01` with PIN `024550` through `player-auth`;
3. assert a second `authtest01` create returns name-taken;
4. log in twice and retain two refresh tokens;
5. call local logout from only the first session and prove the second refresh token still works;
6. owner-reset to temporary PIN `135790`;
7. assert both old refresh tokens fail;
8. assert the old access token fails the credential-version guard;
9. log in with `135790`, change to `246802`, and assert `forcePinChange=false`;
10. delete the player and assert login returns the same generic failure as a missing account.

Every assertion prints only action name, expected status, and actual status. Never print request/response bodies, owner credentials, player identifiers, PINs, aliases, or tokens. The final cleanup assertion proves both temporary Auth users and their application rows are gone.

- [ ] **Step 3: Add package command and run all foundation gates**

```json
"verify:player-auth": "node scripts/verify-player-auth.mjs"
```

Run:

```bash
npx supabase db reset
npx supabase test db
npm test -- src/player src/admin/manage-player-handler.test.ts src/admin/api.test.ts
npm run typecheck
npm run verify:player-auth
```

Expected: all tests PASS; the script ends with `player auth verification passed` and prints no profile name, PIN, alias, or token.

- [ ] **Step 4: Run secret and copy scans**

Run:

```bash
npm run lint:copy
rg -n "SUPABASE_(SECRET|SERVICE)|service_role|024550|135790|246802" src supabase/functions dist
```

Expected: copy lint PASS; only server environment variable names and test fixtures appear, never a real secret or production credential.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-player-auth.mjs package.json .gitignore
git commit -m "test: verify player authentication lifecycle"
```

## Plan 1 Completion Gate

Do not start Plan 2 until all of the following are evidenced in fresh output:

- shared contract tests pass;
- existing and new pgTAP tests pass after a clean database reset;
- Auth handler, session guard, manage-player handler, and Admin API tests pass;
- general signup remains closed;
- exact six-digit PIN login returns a Supabase session;
- local logout keeps another device session active;
- owner reset revokes both refresh tokens and the custom guard rejects old access tokens;
- no player/internal identity values appear in logs;
- `npm run typecheck`, `npm run lint:copy`, and secret scan pass.
