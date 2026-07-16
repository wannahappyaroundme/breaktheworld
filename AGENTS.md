# Break The World Agent SSOT

## Status

- Date: 2026-07-17
- Branch: `main`
- Production: `https://wannahappyaroundme.github.io/breaktheworld/`
- Admin: `https://wannahappyaroundme.github.io/breaktheworld/admin.html`
- Backend: Supabase project `breaktheworld`, ref `ohvkunouhcxbnfjhhuih`, Seoul region.
- Release state: gamification, character variants, analytics, guest-first player profiles, cross-device sync, and operator player management are merged and deployed.
- All 6 production feature flags are enabled. One active owner exists; credentials are never documented.
- Next product gate: future My Page, achievement titles, and achievement avatar rewards require a new approved design and plan before code.

## Product

Personal, non-commercial, mobile-first stress-relief web game. Target users want immediate, cute, non-gory destruction with strong audiovisual feedback. Guest play is instant. Optional profiles provide persistent multi-device progress.

### Implemented

- Targets: word `세상` -> earth -> city loop with sky drop-in.
- Registry: 12 elemental/physical weapons + 9 characters = 21 entries. Legacy Cinnamoroll/Ditto appearances are classic skins.
- Input state machine: tap, drag, hold/charge, release-to-fire, cancellation safety, and double-tap strong-attack accessibility option.
- Character partial moves/signatures, bounded seeded variation, and max-3-valid-action finish invariant.
- Combo/best combo, FEVER, golden targets, haptics, share card, what's-new modal, PWA.
- Versioned `btw.progress.v1`, legacy migration, one daily quest, 5 permanent stamps, record-book sheet, queued notifications.
- Guest-first profiles: globally unique 2-12 Hangul/ASCII/digit ID, ASCII case-insensitive comparison, explicit duplicate check, exact 6-digit numeric PIN.
- New profiles start at zero. Guest progress stays device-local and is never imported.
- Persistent login, logout, multi-device operation sync, offline outbox, and server projection.
- Supabase admin auth, quest CRUD/scheduling, feature flags, enum-only analytics, and static/local fallbacks.
- Operator dashboard: admin accounts, quests, flags, daily metrics, player list, PIN reset, deactivate/reactivate, hard delete.

### Explicit non-goals

Leaderboards, PvP, XP/levels, currency/store/energy, punitive streaks, new characters/targets, native app, monetization, player email/phone, social login, guest-record import, public profiles, and a full My Page are outside the deployed release.

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
supabase/migrations/        four deployed SQL migrations
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
- Guest state is device-local. Authenticated operations enter an offline outbox and retry without blocking play.

### Supabase

- Operations: `admin_users`, `quest_catalog`, `feature_flags`, `analytics_events`, `analytics_rate_limits`, `analytics_daily` view.
- Player auth: `player_profiles`, `player_auth_aliases`, `player_auth_rate_limits`, `admin_audit_logs`.
- Player sync: `player_progress`, `player_devices`, `player_sync_operations`, `player_daily_assignments`, `player_daily_completions`, `player_sync_rate_limits`.
- Four migrations are deployed: operations, player auth, player sync, authenticated feature flags.
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
- `📖 기록책` is the single top entry for progress, profile, skins, and settings.
- Minimum interactive target 44px, semantic buttons, Korean accessible names, visible focus.
- Full-screen effects are reserved for FEVER, records, and max-charge signatures.
- Rendered Korean uses easy words and positive next actions. No em dash. Copy lint enforces forbidden terms and punctuation.
- Reduced motion and double-tap strong attack are supported; sound/haptics are never the only feedback.

## Release Evidence

- GitHub Actions production run `29509957681` deployed commit `b23e11a` from `main` on 2026-07-17 KST.
- CI passed copy lint, 685 Vitest tests across 47 files, TypeScript check, production build, and `npm audit --omit=dev --audit-level=high` with 0 vulnerabilities.
- Local pgTAP suite passed 234 tests before backend deploy. Remote DB lint reported 0 errors.
- Production game, admin HTML, game/admin/Supabase bundles returned HTTP 200. Initial sampled responses were 0.25-0.31s.
- Production browser confirmed game, record book, guest profile card, unique-ID check, profile-create form, and admin login form. Game/admin browser logs were empty.
- Supabase production verification: 4 migrations, 5 active functions, 6 enabled flags, active owner, duplicate-check endpoint response, and no observed 5xx.

Required future release gates: fresh tests/build/audit, migration and flag diff, preview signoff, real iOS Safari and Android Chrome smoke, production approval, live URL checks, and post-deploy observation.

## Version History

- 2026-06-14: initial mobile destruction game.
- 2026-06 to 2026-07: 21 weapons/characters, feedback effects, records, golden target, FEVER, and share card.
- 2026-07-16: gamification, character variety, progress, operator dashboard, analytics, and player profile/sync designs approved and implemented.
- 2026-07-17: Supabase operations/auth/sync backend and GitHub Pages frontend deployed to production; all release flags enabled.

## Documentation Rule

- `README.md` is Korean PM-facing service documentation.
- `AGENTS.md` is the developer SSOT and must stay dense, current, and secret-free.
- Update both only after a feature is implemented, merged, and deployed.
