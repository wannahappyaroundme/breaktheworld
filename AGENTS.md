# Break The World Agent SSOT

## Status

- Date: 2026-07-16
- Branch: `main`
- Product: personal, non-commercial, mobile-only stress-relief web game.
- Current code is shipped v1; approved gamification design is NOT implemented.
- Approved design: `docs/superpowers/specs/2026-07-16-gamification-character-variety-design.md`
- Next gate: PM reviews written spec, then create 3 implementation plans. Never code before plan approval.

## Product

Target: phone users who want immediate, cute, non-gory destruction. Core promise: tap/drag/hold to break the world with strong audiovisual feedback. No signup for players.

### Implemented

- Targets: word `세상` → earth → city loop, sky drop-in.
- Weapons: 12 elemental/physical + 9 distinct characters; 2 legacy character appearances are currently separate entries, so registry currently exposes 23 entries despite docs saying 21.
- Tap/drag/multitouch, combo/best combo, FEVER, golden targets, haptics, share card, what's-new modal, PWA.
- Local keys: `btw.bestCombo`, `btw.totalTargets`.

### Approved, not implemented

- Input state machine: tap (<450ms), drag (>=16px), charge (>=450ms), max charge (1.1s), release-to-fire, cancellation safety.
- All weapons get charge behavior; 9 characters get 2 partial tap moves + 1 charged signature.
- Initial-fragment damage budget; max 3 valid character actions to finish; no zero-damage remainder.
- Seeded bounded variation; no same tap move 3 times consecutively.
- Legacy Cinnamoroll/Ditto entries become `classic` skins; registry returns to 21 weapons.
- Versioned `btw.progress.v1` store; migrate legacy keys only after new save succeeds.
- One daily quest, 5 permanent stamps, record-book bottom sheet, queued notifications.
- Supabase admin auth, quest CRUD, feature flags, enum-only anonymous aggregates; static/local fallback.

### Explicit non-goals

Player accounts/sync, leaderboards, PvP, XP/levels, currency/store/energy, punitive streaks, new characters/targets, native app, monetization/public marketing rights work.

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
src/game.ts                 current orchestration; approved plan will split state responsibilities
src/engine/                 loop, renderer, input, camera, particles, audio, math/rng
src/effects/                effect manager + primitives
src/targets/                target interface, breakable, target types, manager
src/weapons/                weapon contracts, registry, elemental, characters, bar
src/art/                    canvas/doodle art + optional PNG assets
src/ui/                     HUD, what's new, share card
docs/superpowers/specs/     approved product/design specs
docs/superpowers/plans/     implementation plans
public/                     PWA icons, OG image, optional assets
dist/                       generated build; do not hand-edit
```

Planned focused modules and exact paths are locked in implementation plans, not this SSOT.

## Data

### Local planned schema

`btw.progress.v1`: schema/catalog version, install seed, lifetime counters, by-weapon uses/finishes/seen moves, by-target destroys, achievements, one daily quest, selected title/skins/input/motion/haptics settings.

### Supabase planned schema

- `admin_users(user_id, role, active)`
- `quest_catalog(id, copy, event_type, target, active_from, active_to, enabled, version)`
- `feature_flags(key, enabled, updated_at)`
- `analytics_events(event_type, day_key, install_hash, weapon_id, value, created_at)`
- `analytics_daily(day_key, event_type, weapon_id, count)`

RLS centrally checks `admin_users`. Browser gets anon key only. Service-role key stays server-side. Anonymous writes go through a validating/rate-limited Edge Function. Admin errors must not reveal whether an account exists.

## Admin

Required in approved delivery:

- ID/PW login
- admin account list/activate/deactivate
- quest CRUD and scheduling
- feature toggles: gamification, character variants, analytics
- daily funnel and character/hold metrics
- no player content or raw PII

## Hosting / APIs

- Game/admin static bundle: GitHub Pages via `.github/workflows/deploy.yml`.
- Planned backend: Supabase Auth/Postgres/Edge Functions.
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
- 2026-07-16: gamification/character-variety direction approved; written spec pending PM review; implementation not started.
