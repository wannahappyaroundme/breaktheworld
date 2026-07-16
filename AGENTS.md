# Break The World Agent SSOT

## Status

- Date: 2026-07-16
- Branch: `codex/gamification-upgrade`
- Product: personal, non-commercial, mobile-only stress-relief web game.
- Gamification, character variety, progress, analytics, and operator UI are implemented and locally verified on this branch; they are not merged or deployed.
- Player profile/sync design is approved: `docs/superpowers/specs/2026-07-16-player-profile-sync-design.md`.
- Next gate: PM reviews 3 player-profile implementation plans. Never code before plan approval.

## Product

Target: phone users who want immediate, cute, non-gory destruction. Core promise: tap/drag/hold to break the world with strong audiovisual feedback. Guest play remains immediate; optional player profiles are planned for cross-device sync.

### Implemented

- Targets: word `세상` → earth → city loop, sky drop-in.
- Weapons: 12 elemental/physical + 9 characters; legacy Cinnamoroll/Ditto appearances are classic skins, registry exposes 21 entries.
- Tap/drag/charge input state machine, per-character partial moves/signatures, bounded seeded variation, max-3-action finish invariant.
- Combo/best combo, FEVER, golden targets, haptics, share card, what's-new modal, PWA.
- Versioned `btw.progress.v1`, legacy migration, one daily quest, 5 permanent stamps, record-book sheet, queued notifications.
- Supabase admin auth, quest CRUD/scheduling, feature flags, enum-only anonymous analytics, static/local fallback.
- Operator dashboard includes admin account management, quest/flag operations, and daily metrics.

### Approved, not implemented

- Guest-first optional player profiles: globally unique 2-12 char Hangul/ASCII/digit ID and exact 6-digit numeric PIN.
- Explicit duplicate check plus DB UNIQUE; ASCII case-insensitive ID comparison.
- New profiles start at zero; guest state stays device-local and is never imported.
- Persistent multi-device sessions, local logout, admin PIN reset with global session invalidation.
- Idempotent operation sync for all progress/settings; offline outbox and server projection.
- Record-book profile card/full-screen profile; default circle avatar; future My Page extension point.

### Explicit non-goals

Leaderboards, PvP, XP/levels, currency/store/energy, punitive streaks, new characters/targets, native app, monetization/public marketing rights work. Player email/phone, social login, guest-record import, public profiles, and full My Page remain out of the current profile increment.

## Architecture

Stack is fixed: Vite 5, TypeScript, Canvas 2D, rough.js, Web Audio, Vitest, GitHub Pages. Keep stack; no framework migration.

```text
Input → ActionController → Weapon/CharacterMoveSet → DamageResult → GameEventBus
  → Combo/FEVER | ProgressStore | Quest/Achievement reducers | NotificationQueue | AnalyticsClient
```

Rules:

- `Input` owns gesture interpretation only.
- `ActionController` owns tap/drag/charge lifecycle and single active cinematic.
- Async impacts must match `actionId + targetRunId`; stale visuals may draw but cannot damage or progress.
- `Weapon.apply` replacement must return actual damage result; progress counts only detached fragments >0.
- Demo/system events never progress quests/achievements.
- Character tap damage: 35-50% of initial fragment count; charge: 55-80%; remaining <=20% or third valid action finishes.
- Event store accepts enums/counts/IDs only; never raw pointer coordinates, user content, prompts, or PII.
- Save only on action end, destroy, unlock, setting change, pagehide; never per frame/tick.
- If local/remote storage fails, gameplay continues with in-memory/static fallback.
- Notification priority: record > achievement > quest > general; one visible at a time.

## Folder Map

```text
src/main.ts                 boot
src/game.ts                 game orchestration
src/engine/                 loop, renderer, input, camera, particles, audio, math/rng
src/effects/                effect manager + primitives
src/targets/                target interface, breakable, target types, manager
src/weapons/                weapon contracts, registry, elemental, characters, bar
src/art/                    canvas/doodle art + optional PNG assets
src/progress/               local progress state, reducer, catalog, validation, store
src/combat/                 action state and resolved attack contracts
src/analytics/              privacy-limited event mapping and transport
src/admin/                  operator application, API, view, styles
src/ui/                     HUD, record book, notifications, what's new, share card
supabase/                   migrations, Edge Functions, pgTAP tests, seed
docs/superpowers/specs/     approved product/design specs
docs/superpowers/plans/     implementation plans
public/                     PWA icons, OG image, optional assets
dist/                       generated build; do not hand-edit
```

New profile module paths and interfaces are locked in approved implementation plans, not this SSOT.

## Data

### Local implemented schema

`btw.progress.v1`: schema/catalog version, install seed, lifetime counters, by-weapon uses/finishes/seen moves, by-target destroys, achievements, one daily quest, selected title/skins/input/motion/haptics settings.

### Supabase implemented schema

- `admin_users(user_id, role, active)`
- `quest_catalog(id, copy, event_type, target, active_from, active_to, enabled, version)`
- `feature_flags(key, enabled, updated_at)`
- `analytics_events(event_type, day_key, install_hash, weapon_id, value, created_at)`
- `analytics_daily(day_key, event_type, weapon_id, count)`

RLS centrally checks `admin_users`. Browser gets anon key only. Service-role key stays server-side. Anonymous writes go through a validating/rate-limited Edge Function. Admin errors must not reveal whether an account exists.

### Supabase player profile schema, approved not implemented

- `player_profiles`, `player_auth_aliases`, `player_progress`
- `player_devices`, `player_sync_operations`
- `player_auth_rate_limits`, `admin_audit_logs`

Player browser writes are forbidden. Player Auth/Sync Edge Functions validate publishable or user JWT requests; custom access-token claims carry `credential_version`. Sync uses UUID ownership, device sequence, operation ID, and transactional projection.

## Admin

Implemented on branch:

- ID/PW login
- admin account list/activate/deactivate
- quest CRUD and scheduling
- feature toggles: gamification, character variants, analytics
- daily funnel and character/hold metrics
- no player content or raw PII

Approved next increment: player list/status, temporary 6-digit PIN reset, global session invalidation, force-change state, deactivate, hard delete.

## Hosting / APIs

- Game/admin static bundle: GitHub Pages via `.github/workflows/deploy.yml`.
- Backend: Supabase Auth/Postgres/Edge Functions; player Auth/Sync functions are planned.
- Remote quest config caches for one day; built-in catalog is mandatory fallback.
- Analytics retries transient failures max 3 with 1s/2s/4s backoff; never block play.
- Production deploy always requires explicit PM approval after preview verification.

## UI / Copy

- Mobile portrait first; center target remains dominant.
- Replace top `✨` with accessible `📖 기록책`; add no new top buttons.
- Minimum interactive target 44px, real buttons, Korean accessible names, visible focus.
- Big full-screen effects only for FEVER, record, max-charge signature.
- Korean easy words: `연속`, `오늘의 도전`, `부순 기록`, `도장`, `캐릭터 모습`.
- No em dash in rendered copy. No punitive/negative framing. Add copy lint to CI.
- Respect reduced motion; offer double-tap strong attack alternative; sound/haptics cannot be sole signal.

## Quality Gates

- TDD for input boundaries, action state, damage profiles, RNG invariants, progress reducer/migration, daily boundary, RLS/admin.
- Property/golden tests: same seed same result; no 3 identical moves; every character/target finishes <=3 valid actions; 1 fragment never stalls; destroy/progress exactly once.
- Runtime: all 21 weapons tap/drag/charge at 390x844; real iOS Safari + Android Chrome.
- Worst character + FEVER respects particle/effect budget; 50 repeated cinematics return active effects/memory to baseline.
- `npm test`, `npm run build`, `tsc --noEmit`; preview URL play test; actual admin CRUD/fallback test.
- Before prod: env diff, migration order/rollback, flags, preview signoff. Post-deploy hit real URL and observe errors/latency.

## Docs / Version History

- `README.md`: PM-facing Korean service guide. Update only after feature is implemented, merged, and deployed.
- `AGENTS.md`: developer SSOT; prune stale facts every change.
- 2026-06-14: initial mobile destruction game design.
- 2026-06 to 2026-07: 21+ weapons, juice, records, golden target, FEVER, share card; auto-demo removed.
- 2026-07-16: gamification/character-variety, progress, admin, and analytics implemented on feature branch; 464 Vitest and 97 pgTAP tests passed; not deployed.
- 2026-07-16: player profile/cross-device sync design approved; implementation plans pending PM review.
