# Break The World Agent SSOT

## Status

- Date: 2026-07-17
- Branch: `main`
- Production: `https://wannahappyaroundme.github.io/breaktheworld/`
- Admin: `https://wannahappyaroundme.github.io/breaktheworld/admin.html`
- Backend: Supabase project `breaktheworld`, ref `ohvkunouhcxbnfjhhuih`, Seoul region.
- Release state: 32-achievement XP/level progression, cosmetic rewards, full-screen record book, unified game/profile UI, analytics, first-entry choice, cross-device sync, and operator management are merged and deployed.
- All 6 production feature flags are enabled. One active owner exists; credentials are never documented.
- Next product gate: a full My Page, new avatar-art rewards, or any social/competitive progression requires a new approved design and plan before code.

## Product

Personal, non-commercial, mobile-first stress-relief web game. Target users want immediate, cute, non-gory destruction with strong audiovisual feedback. Guest play is instant. Optional profiles provide persistent multi-device progress.

### Implemented

- Targets: word `세상` -> earth -> city loop with sky drop-in.
- Registry: 12 elemental/physical weapons + 9 characters = 21 entries. Legacy Cinnamoroll/Ditto appearances are classic skins.
- Input state machine: tap, drag, hold/charge, release-to-fire, cancellation safety, and double-tap strong-attack accessibility option.
- Character partial moves/signatures, bounded seeded variation, and max-3-valid-action finish invariant.
- Combo/best combo, FEVER, golden targets, haptics, share card, what's-new modal, PWA.
- Versioned `btw.progress.v1`, legacy migration, one daily quest, 32 public achievements across four tiers/categories, derived 4,700 XP and 20 levels, queued notifications.
- Full-screen record book exposes all locked conditions/rewards from first visit; home summary, filters, progress, eight achievement titles, four earned frames, three earned themes, and legacy character skins are supported.
- Guest-first profiles: globally unique 2-12 Hangul/ASCII/digit ID, ASCII case-insensitive comparison, explicit duplicate check, exact 6-digit numeric PIN.
- An undecided device must choose create/login/guest before play. Exact local marker `btw.profileEntry.v1=guest` skips later prompts; valid sessions and forced PIN change outrank it, and logout clears it.
- New profiles start at zero. Guest progress stays device-local and is never imported.
- Persistent login, logout, multi-device operation sync, offline outbox, and server projection.
- Supabase admin auth, quest CRUD/scheduling, feature flags, enum-only analytics, and static/local fallbacks.
- Operator dashboard: admin accounts, quests, flags, daily metrics, player list, PIN reset, deactivate/reactivate, hard delete.

### Explicit non-goals

Leaderboards, PvP, currency/store/energy, punitive streaks, new characters/targets, new avatar art, native app, monetization, player email/phone, social login, guest-record import, public profiles, and a full My Page are outside the deployed release.

## Architecture

Stack is fixed: Vite 5, TypeScript, Canvas 2D, rough.js, Web Audio, Vitest, GitHub Pages, Supabase Auth/Postgres/Edge Functions. No framework migration.

```text
Input -> ActionController -> Weapon/CharacterMoveSet -> DamageResult -> GameEventBus
  -> Combo/FEVER | ProgressStore | Quest/Achievement reducers | NotificationQueue | AnalyticsClient

GameEvent/setting change -> local ProgressStore -> authenticated Outbox
  -> player-sync Edge Function -> idempotent operation ledger -> server projection

Profile UI -> player-auth Edge Function -> Supabase Auth session
Admin UI -> Supabase Auth -> RLS/management Edge Functions
```

Rules:

- `Input` owns gesture interpretation only; `ActionController` owns action lifecycle and one active cinematic.
- Async impacts must match `actionId + targetRunId`; stale visuals cannot damage or progress.
- Progress counts only detached fragments >0. Demo/system events never progress quests or achievements.
- Same seed produces the same bounded variation; no tap move repeats three times consecutively.
- Save on action end, destroy, unlock, setting change, and pagehide, never per frame.
- Player sync is operation-based and idempotent by device/sequence/operation ID. Server writes never trust a browser-owned final snapshot.
- Local, remote-config, analytics, or sync failures cannot block gameplay. Guest/local fallback remains available.
- Event/telemetry storage accepts enums, counts, and IDs only, never raw coordinates, user content, PINs, or PII.
- Notification priority: record > achievement > quest > general; one visible notification at a time.

## Folder Map

```text
src/main.ts                 boot, profile/sync wiring
src/game.ts                 game orchestration
src/engine/                 loop, renderer, input, camera, particles, audio, math/rng
src/effects/                effect manager and primitives
src/targets/                target contracts, breakables, target manager
src/weapons/                weapon contracts, registry, elemental and character moves
src/art/                    canvas/doodle art and optional PNG assets
src/progress/               local state, reducers, catalog, validation, store
src/combat/                 action state and resolved attack contracts
src/analytics/              privacy-limited event mapping and transport
src/player/                 profile UI/API, privacy, auth, outbox, sync client/store
src/admin/                  operator application, API, view, styles
src/ui/                     HUD, record book, notifications, what's new, share card
supabase/migrations/        five deployed SQL migrations
supabase/functions/         five deployed Edge Functions plus shared handlers
supabase/tests/             pgTAP security/data tests
docs/superpowers/specs/     approved product/design specs
docs/superpowers/plans/     approved implementation plans
public/                     PWA icons, OG image, optional assets
dist/                       generated build; never hand-edit
```

## Data and Security

### Local

- `btw.progress.v1`: schema/catalog version, install seed, counters, weapon/target history, achievements, daily quest, selected title/skins, input/motion/haptics settings.
- `btw.profileEntry.v1`: optional exact `guest` marker only. Storage failure falls back to the current tab and never blocks play.
- Guest state is device-local. Authenticated operations enter an offline outbox and retry without blocking play.

### Supabase

- Operations: `admin_users`, `quest_catalog`, `feature_flags`, `analytics_events`, `analytics_rate_limits`, `analytics_daily` view.
- Player auth: `player_profiles`, `player_auth_aliases`, `player_auth_rate_limits`, `admin_audit_logs`.
- Player sync: `player_progress`, `player_devices`, `player_sync_operations`, `player_daily_assignments`, `player_daily_completions`, `player_sync_rate_limits`.
- Five migrations are deployed: operations, player auth, player sync, authenticated feature flags, authoritative achievement progress/analytics.
- Five active Edge Functions: `ingest-analytics`, `manage-admin`, `manage-player`, `player-auth`, `player-sync`.
- Hourly cron cleanup runs for player auth and sync rate-limit buckets.

RLS centrally checks `admin_users`. The browser receives only the Supabase URL and publishable key. The service-role key and custom peppers remain server-side. PINs are handled through Supabase Auth and are never stored or logged raw. Synthetic internal auth aliases are never returned to the UI. PIN reset increments `credential_version`, revokes sessions, and forces a change on next login. Anonymous endpoints validate origin/body and apply rate limits; authenticated writes verify JWT ownership.

## Admin

- Email/password login and local logout.
- Admin account list/add/activate/deactivate with owner-only authorization.
- Quest CRUD, scheduling, and game/character/analytics toggles.
- Daily funnel, character, and hold metrics without player content or raw PII.
- Player profile list/status, exact 6-digit temporary PIN reset, global session invalidation, deactivate/reactivate, hard delete.
- Section failures are isolated so one failed backend call does not hide unrelated controls.

## Hosting and Deployment

- Static game/admin: GitHub Pages via manual `.github/workflows/deploy.yml` dispatch from `main`.
- Backend: linked Supabase project in Seoul; migrations/functions deploy independently before Pages activation.
- GitHub Actions Secrets supply `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PLAYER_DELETION_CONTACT`, and `VITE_PLAYER_PROCESSING_NOTICE`.
- Remote quest config caches for one day; built-in catalog is mandatory fallback.
- Analytics and sync retry transient failures up to 3 times with 1s/2s/4s backoff and never block play.
- Production requires preview signoff and explicit PM approval. Roll back Pages to the previous deployment and close feature flags before a backend rollback.

## UI and Copy

- Mobile portrait first; target remains visually dominant.
- The top `LV` card is the single entry for progression, profile, cosmetics, and settings; it surfaces unseen-achievement count without crowding the target.
- Record-book tabs are home, achievements, cosmetics, and settings. All 32 locked achievements disclose condition, progress, tier, XP, and title reward from first visit.
- Profile entry/create/login surfaces reuse the game night-sky background and paper-card visual language.
- Required first-entry profile choice precedes What's New and reuses the existing profile dialog; normal record-book profile behavior is unchanged.
- Minimum interactive target 44px, semantic buttons, Korean accessible names, visible focus.
- Full-screen effects are reserved for FEVER, records, and max-charge signatures.
- Rendered Korean uses easy words and positive next actions. No em dash. Copy lint enforces forbidden terms and punctuation.
- Reduced motion and double-tap strong attack are supported; sound/haptics are never the only feedback.

## Release Evidence

- GitHub Actions production run `29567381477` deployed commit `14b5cf5` from `main` on 2026-07-17 KST.
- CI passed copy lint, 789 Vitest tests across 49 files, TypeScript check, production build, and `npm audit --omit=dev --audit-level=high` with 0 vulnerabilities.
- Fresh local PostgreSQL reset applied all five migrations; pgTAP passed 254 tests and four Edge contract suites passed 57 tests. Remote `public` schema lint reported 0 errors.
- Production game/admin HTML and all referenced game/admin/Supabase JS/CSS bundles returned HTTP 200 with the new deployment timestamp.
- Production browser at 390x844 confirmed no horizontal overflow, exact 32-card achievement catalog, minimum 44px record-book/signup controls, unified signup/game backdrop, and no warning/error logs.
- Supabase production verification: 5 migrations; all 5 functions ACTIVE; `ingest-analytics` and `player-sync` upgraded to version 2; 6 existing flags remain enabled.
- Post-deploy observation sampled game/admin every 30 seconds for 5 minutes: all 10 pairs returned HTTP 200. Both changed Edge Functions returned the expected 401 security response to unauthenticated smoke requests; no 5xx was observed.

Required future release gates: fresh tests/build/audit, migration and flag diff, preview signoff, real iOS Safari and Android Chrome smoke, production approval, live URL checks, and post-deploy observation.

## Version History

- 2026-06-14: initial mobile destruction game.
- 2026-06 to 2026-07: 21 weapons/characters, feedback effects, records, golden target, FEVER, and share card.
- 2026-07-16: gamification, character variety, progress, operator dashboard, analytics, and player profile/sync designs approved and implemented.
- 2026-07-17: Supabase operations/auth/sync backend and GitHub Pages frontend deployed to production; all release flags enabled.
- 2026-07-17: first-entry guest/profile choice, same-device guest memory, logout re-choice, and deferred What's New deployed without backend changes.
- 2026-07-17: 32-achievement catalog, 4,700 XP/20 levels, title/frame/theme rewards, authoritative sync/analytics, and full game/profile UI redesign deployed.

## Documentation Rule

- `README.md` is Korean PM-facing service documentation.
- `AGENTS.md` is the developer SSOT and must stay dense, current, and secret-free.
- Update both only after a feature is implemented, merged, and deployed.
