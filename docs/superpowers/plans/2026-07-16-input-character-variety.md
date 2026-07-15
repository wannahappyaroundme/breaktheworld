# Input and Character Variety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add release-based tap/drag/charge controls, deterministic damage results, charged behavior for all weapons, and three distinct moves for each of the nine characters without allowing stale or duplicate damage.

**Architecture:** A DOM-free gesture machine interprets pointer timing and movement. `ActionController` converts gestures into weapon actions and gives each action a stable `actionId` and `targetRunId`. Weapons request damage through a checked `ActionContext`, and `Breakable` applies deterministic patterns against the target's initial fragment budget.

**Tech Stack:** Existing Vite 5, TypeScript, Canvas 2D, Vitest, Web Audio, rough.js. No new runtime dependency.

## Global Constraints

- Keep the current stack and 21-weapon concept; do not migrate frameworks.
- Tap cutoff is 450ms; drag begins at 16px; max charge is 1100ms.
- `pointerdown` gives feedback only. Damage is settled exactly once on tap release, drag samples, or charge release.
- Only the primary pointer can charge; additional pointers remain tap/drag inputs.
- Character tap damage is 35-50% of the initial fragment count; charged damage is 55-80%.
- A fresh target with at least two fragments cannot be destroyed by one charged action from any weapon. Remaining <=20% or the third valid character action must finish.
- Same character tap move cannot appear three times consecutively.
- Old Cinnamoroll/Ditto entries become skins; registry count must be exactly 21.
- Respect reduced motion and disabled haptics; visual state cannot depend only on sound or vibration.
- Every task uses TDD and ends with its own focused commit.

## Execution Setup

Create and remain on `codex/gamification-upgrade` before Task 1. Plans B and C continue on the same branch. Do not merge or push `main` during implementation.

```bash
git switch -c codex/gamification-upgrade
git status --short --branch
```

---

## File Map

```text
src/combat/damage.ts                 damage patterns, requests, results
src/combat/damage.test.ts            pattern geometry and budget tests
src/combat/gesture.ts                DOM-free gesture state machine
src/combat/gesture.test.ts           timing/movement/cancel tests
src/combat/action-controller.ts      action IDs, target-run guard, one cinematic
src/combat/action-controller.test.ts stale/duplicate/cancel tests
src/combat/charge-visual.ts          live canvas charge indicator
src/weapons/weapon.ts                quick/drag/charged contracts
src/weapons/charge-profiles.ts       12 elemental charge multipliers/colors
src/weapons/character-catalog.ts     nine move sets and two skins
src/weapons/character-runtime.ts     shared actor/pattern execution
src/weapons/characters.ts            character drawings and move recipes
src/engine/input.ts                  PointerEvent adapter
src/targets/target.ts                applyDamage contract and initial count
src/targets/breakable.ts             deterministic fragment selection
src/targets/manager.ts               monotonic targetRunId
src/game.ts                          controller wiring; remove global cooldown
src/weapons/registry.ts              exactly 21 entries
src/weapons/bar.ts                   skin-independent character buttons
src/style.css                        press/charge/reduced-motion polish
```

### Task 1: Deterministic damage contract

**Files:**
- Create: `src/combat/damage.ts`
- Create: `src/combat/damage.test.ts`
- Modify: `src/targets/target.ts`
- Modify: `src/targets/breakable.ts`
- Modify: `src/engine/engine.test.ts`

**Interfaces:**
- Produces: `DamagePattern`, `DamageRequest`, `DamageResult`, `Target.applyDamage(request)`.
- Consumers: `ActionController`, elemental weapons, character runtime, progress events in Plan B.

- [ ] **Step 1: Write failing pure geometry and budget tests**

```ts
import { describe, expect, it } from 'vitest'
import { matchesPattern, damageBudget } from './damage'

describe('damage patterns', () => {
  it('matches circles, lines, ellipses, and multi-point clusters', () => {
    expect(matchesPattern({ x: 5, y: 0 }, { kind: 'circle', x: 0, y: 0, radius: 6 })).toBe(true)
    expect(matchesPattern({ x: 5, y: 3 }, { kind: 'line', x1: 0, y1: 0, x2: 10, y2: 0, width: 4 })).toBe(false)
    expect(matchesPattern({ x: 8, y: 2 }, { kind: 'ellipse', x: 0, y: 0, rx: 10, ry: 3, rotation: 0 })).toBe(true)
    expect(matchesPattern({ x: 20, y: 20 }, { kind: 'multi', points: [{ x: 20, y: 20 }], radius: 2 })).toBe(true)
  })

  it('uses the initial fragment count and always returns a usable budget', () => {
    expect(damageBudget(40, 40, 0.35, 0.5)).toEqual({ min: 14, max: 20 })
    expect(damageBudget(1, 1, 0.35, 0.5)).toEqual({ min: 1, max: 1 })
  })
})
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `npm test -- src/combat/damage.test.ts`

Expected: FAIL because `src/combat/damage.ts` does not exist.

- [ ] **Step 3: Add the exact damage types and geometry helpers**

```ts
import { clamp } from '../engine/math'

export type DamagePattern =
  | { kind: 'circle'; x: number; y: number; radius: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; width: number }
  | { kind: 'ellipse'; x: number; y: number; rx: number; ry: number; rotation: number }
  | { kind: 'multi'; points: { x: number; y: number }[]; radius: number }

export interface DamageRequest {
  pattern: DamagePattern
  minRatio: number
  maxRatio: number
  force: number
  mode: 'fall' | 'dissolve' | 'squash'
  seed: number
  finish: boolean
}

export interface DamageResult {
  detached: number
  before: number
  remaining: number
  initial: number
  destroyed: boolean
}

export function damageBudget(initial: number, remaining: number, minRatio: number, maxRatio: number) {
  const min = clamp(Math.round(initial * minRatio), 1, remaining)
  const max = clamp(Math.round(initial * maxRatio), min, remaining)
  return { min, max }
}
```

Implement `matchesPattern()` with point-to-segment distance for lines and inverse rotation for ellipses. Export the point-to-segment helper for its unit tests.

- [ ] **Step 4: Extend `Target` with deterministic damage**

```ts
import type { DamageRequest, DamageResult } from '../combat/damage'

export interface Target {
  // existing members remain
  readonly initialFragmentCount: number
  applyDamage(request: DamageRequest): DamageResult
}
```

In `Breakable.applyDamage`, select matching attached fragments, deterministically shuffle candidates with `new Rng(request.seed)`, detach between the requested min/max budget, and fill from nearest unmatched fragments only until the minimum is met. `finish: true` detaches all remaining fragments. Return a full `DamageResult` after every call. Keep the old methods temporarily as thin compatibility wrappers until Task 4 migrates all weapons.

- [ ] **Step 5: Add Breakable tests with a DOM canvas stub**

Add tests for: deterministic seed, minimum one fragment, max budget, ellipse/line selection, and `finish` cleanup. Reuse a small fake `document.createElement('canvas')` whose context implements only methods called by `Breakable`.

- [ ] **Step 6: Run focused and existing tests**

Run: `npm test -- src/combat/damage.test.ts src/engine/engine.test.ts src/targets/shatter.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/combat/damage.ts src/combat/damage.test.ts src/targets/target.ts src/targets/breakable.ts src/engine/engine.test.ts
git commit -m "refactor: add deterministic damage results"
```

### Task 2: Gesture state machine and PointerEvent adapter

**Files:**
- Create: `src/combat/gesture.ts`
- Create: `src/combat/gesture.test.ts`
- Modify: `src/engine/input.ts`

**Interfaces:**
- Produces: `GestureMachine`, `GestureEvent`, `Input.update(nowMs)`, `Input.cancelAll()`.
- Consumes: viewport pointer coordinates only.
- Consumers: Task 3 `ActionController`.

- [ ] **Step 1: Write boundary-first failing tests**

```ts
it('emits a tap at 449ms and a charged release at 450ms', () => {
  const g = new GestureMachine()
  g.begin(1, 100, 100, 0, true)
  expect(g.end(1, 100, 100, 449)).toMatchObject({ type: 'tap' })
  g.begin(2, 100, 100, 0, true)
  g.update(450)
  expect(g.end(2, 100, 100, 450)).toMatchObject({ type: 'chargeRelease', charge: 0 })
})

it('keeps 15px as a press and converts 16px to drag', () => {
  const g = new GestureMachine()
  g.begin(1, 0, 0, 0, true)
  expect(g.move(1, 15, 0, 100)).toBeNull()
  expect(g.move(1, 16, 0, 110)).toMatchObject({ type: 'dragStart' })
})
```

Also test: 1100ms max charge, a stationary secondary pointer remains a tap even when held past 450ms, secondary pointer cannot charge, cancel emits no attack, drag samples are limited to at most one every 45ms and 14px, and `update()` emits `chargeStart` once.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- src/combat/gesture.test.ts`

Expected: FAIL because the gesture module does not exist.

- [ ] **Step 3: Implement the DOM-free state machine**

```ts
export const TAP_MS = 450
export const MAX_CHARGE_MS = 1100
export const DRAG_PX = 16
export const DRAG_SAMPLE_MS = 45

export type GestureEvent =
  | { type: 'press'; id: number; x: number; y: number }
  | { type: 'tap'; id: number; x: number; y: number }
  | { type: 'dragStart' | 'drag'; id: number; x: number; y: number }
  | { type: 'chargeStart'; id: number; x: number; y: number }
  | { type: 'chargeProgress'; id: number; x: number; y: number; charge: number }
  | { type: 'chargeRelease'; id: number; x: number; y: number; charge: number }
  | { type: 'cancel'; id: number }
```

`charge` is `clamp((heldMs - 450) / 650, 0, 1)`. Store active pointers in a map and a single `primaryChargePointerId`. `end()` deletes the pointer before returning so duplicate end/cancel events cannot settle twice.

- [ ] **Step 4: Replace touch/mouse branches with a PointerEvent adapter**

`Input` listens to `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `lostpointercapture`, `visibilitychange`, and `window.blur`. Call `setPointerCapture` on down. Forward generated `GestureEvent`s to the handler and expose `update(nowMs)` for the game loop. Prevent the canvas context menu.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- src/combat/gesture.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/combat/gesture.ts src/combat/gesture.test.ts src/engine/input.ts
git commit -m "feat: add tap drag and charge gestures"
```

### Task 3: Action controller and stale-impact guard

**Files:**
- Create: `src/combat/action-controller.ts`
- Create: `src/combat/action-controller.test.ts`
- Create: `src/combat/charge-visual.ts`
- Modify: `src/targets/manager.ts`
- Modify: `src/weapons/weapon.ts`
- Modify: `src/game.ts`
- Modify: `src/engine/engine.test.ts`

**Interfaces:**
- Consumes: `GestureEvent`, selected `Weapon`, current target and `targetRunId`.
- Produces: checked `ActionContext.damage()`, `ActionResolution`, charge draw state.

- [ ] **Step 1: Write failing controller tests**

Test that a tap settles once, duplicate release is ignored, a stale target run returns `null`, `next/reset/visibility` cancels the action, only one cinematic runs, and combo grace is true while pressed/charging plus 200ms after release.

```ts
const ctx = controller.start({ weapon, targetRunId: 7, x: 10, y: 20, seed: 99 })
manager.advanceForTest()
expect(ctx.damage(request)).toBeNull()
expect(target.applyDamage).not.toHaveBeenCalled()
```

- [ ] **Step 2: Run and confirm missing controller failure**

Run: `npm test -- src/combat/action-controller.test.ts`

Expected: FAIL.

- [ ] **Step 3: Introduce action contracts**

```ts
export interface WeaponAction {
  actionId: number
  targetRunId: number
  x: number
  y: number
  charge: number
  seed: number
  damage(request: Omit<DamageRequest, 'seed'>): DamageResult | null
}

export interface Weapon {
  id: string
  name: string
  icon: string
  mode: 'point' | 'cinematic'
  /** Temporary Task 3-5 bridge. Task 6 removes this member. */
  apply?: (world: World, x: number, y: number) => void
  quick?: (world: World, action: WeaponAction) => void
  drag?: (world: World, action: WeaponAction) => void
  charged?: (world: World, action: WeaponAction) => void
}
```

Remove `cooldown` now. Keep `apply` and the three new handlers optional only as a migration bridge through Tasks 3-5. `ActionController` owns `idle | pressed | dragging | charging | cinematic | recovery`, increments `actionId`, captures `targetRunId`, and creates a seeded `damage()` closure that checks both IDs immediately before applying damage.

- [ ] **Step 4: Add `targetRunId` to TargetManager**

Start at `1` and increment on every `advance()` and `reset()`. Expose a readonly getter. Add a manager test proving monotonic IDs and that reset invalidates an active action even if it returns to the first target type.

- [ ] **Step 5: Wire the controller into Game**

Store the `Input` instance, call `input.update(performance.now())` each frame, route gestures to the controller, pause combo expiry through `controller.comboGraceUntil`, and remove `cinematicCooldown`. During Tasks 3-5 only, dispatch `quick/drag/charged` when present and otherwise use the legacy `apply(world, x, y)` once per settled tap/drag/charge release. If neither handler exists, settle with no damage and one development warning. `onNext`, `onReset`, target destroy, `visibilitychange`, and weapon change call `controller.cancel()`.

- [ ] **Step 6: Add the canvas charge visual**

`ChargeVisual.draw(ctx, state)` renders one 3px ring, weapon accent color, and a max-charge tick. Reduced motion disables pulsing and target scaling. It must not allocate DOM nodes or particles per frame.

- [ ] **Step 7: Run focused tests and typecheck**

Run: `npm test -- src/combat/action-controller.test.ts src/engine/engine.test.ts && npm run typecheck`

Expected: action tests and typecheck PASS. The migration bridge keeps every existing weapon callable until Tasks 4-5 move them to the new handlers.

- [ ] **Step 8: Commit**

```bash
git add src/combat/action-controller.ts src/combat/action-controller.test.ts src/combat/charge-visual.ts src/targets/manager.ts src/weapons/weapon.ts src/game.ts src/engine/engine.test.ts
git commit -m "refactor: centralize weapon action lifecycle"
```

### Task 4: Elemental quick/drag/charged migration

**Files:**
- Create: `src/weapons/charge-profiles.ts`
- Create: `src/weapons/charge-profiles.test.ts`
- Modify: `src/weapons/elemental.ts`
- Modify: `src/weapons/fx.ts`
- Modify: `src/effects/manager.ts`

**Interfaces:**
- Consumes: `WeaponAction.charge` and checked `damage()`.
- Produces: 12 weapons conforming to the new interface.

- [ ] **Step 1: Write the charge-profile invariant test**

```ts
it('defines a safe charged profile for all 12 elemental weapons', () => {
  expect(Object.keys(ELEMENTAL_CHARGE)).toHaveLength(12)
  for (const p of Object.values(ELEMENTAL_CHARGE)) {
    expect(p.maxRadiusScale).toBeGreaterThanOrEqual(1.4)
    expect(p.maxRadiusScale).toBeLessThanOrEqual(1.6)
    expect(p.maxDamageRatio).toBeGreaterThanOrEqual(0.55)
    expect(p.maxDamageRatio).toBeLessThanOrEqual(0.7)
  }
})
```

- [ ] **Step 2: Implement the exact metadata table**

```ts
export const ELEMENTAL_CHARGE = {
  hammer: { color: '#ffd23f', maxRadiusScale: 1.5, maxDamageRatio: 0.62 },
  fist: { color: '#ffb27a', maxRadiusScale: 1.5, maxDamageRatio: 0.65 },
  glass: { color: '#bfe6ff', maxRadiusScale: 1.6, maxDamageRatio: 0.58 },
  laser: { color: '#ff4d6d', maxRadiusScale: 1.45, maxDamageRatio: 0.58 },
  meteor: { color: '#ffae3b', maxRadiusScale: 1.55, maxDamageRatio: 0.68 },
  missile: { color: '#ff5a3c', maxRadiusScale: 1.5, maxDamageRatio: 0.66 },
  bomb: { color: '#ffd9a0', maxRadiusScale: 1.6, maxDamageRatio: 0.7 },
  lightning: { color: '#bfe3ff', maxRadiusScale: 1.5, maxDamageRatio: 0.62 },
  flame: { color: '#ff7a2f', maxRadiusScale: 1.45, maxDamageRatio: 0.56 },
  tornado: { color: '#d8e8ef', maxRadiusScale: 1.6, maxDamageRatio: 0.6 },
  freeze: { color: '#cdebff', maxRadiusScale: 1.5, maxDamageRatio: 0.6 },
  blackhole: { color: '#b06bff', maxRadiusScale: 1.6, maxDamageRatio: 0.7 },
} as const
```

- [ ] **Step 3: Migrate all elemental weapons**

For each weapon, move its current body into a helper receiving `power` and `WeaponAction`. `quick` uses the current visual scale and a local 20-35% pattern budget, `drag` uses the current small local budget, and `charged` interpolates radius/effect counts within the metadata bounds. Every delayed impact calls `action.damage()` at impact time. All charged profiles cap a fresh target with at least two fragments at `remaining - 1`; black hole uses ellipse/dissolve damage and no longer calls `detachAll` on a fresh target.

- [ ] **Step 4: Add effect budget introspection**

Expose `Effects.activeCount` and refuse to add more than 24 simultaneous non-particle effects. The newest low-priority effect may be skipped, but active cinematic actor and charge visual are never removed.

- [ ] **Step 5: Run tests, typecheck, and build**

Run: `npm test -- src/weapons/charge-profiles.test.ts src/combat && npm run build`

Expected: PASS and 12 elemental entries compile against the new contract.

- [ ] **Step 6: Commit**

```bash
git add src/weapons/charge-profiles.ts src/weapons/charge-profiles.test.ts src/weapons/elemental.ts src/weapons/fx.ts src/effects/manager.ts
git commit -m "feat: add charged elemental attacks"
```

### Task 5: Character move catalog and bounded variation

**Files:**
- Create: `src/weapons/character-catalog.ts`
- Create: `src/weapons/character-catalog.test.ts`
- Create: `src/weapons/character-runtime.ts`
- Modify: `src/weapons/characters.ts`
- Modify: `src/art/assets.ts`

**Interfaces:**
- Produces: `CharacterMoveSet`, `pickQuickMove()`, `runCharacterMove()`.
- Consumes: `WeaponAction.damage()`, existing actor/effect primitives and drawings.

- [ ] **Step 1: Write catalog and selection tests**

Test exact nine IDs, exact three moves each, quick ratios 0.35-0.50, charged ratios 0.55-0.80, deterministic seed, no three identical quick moves, and each catalog move has Korean name, pattern builder, telegraph color, detach mode, SFX, emoji list.

```ts
const history: string[] = []
for (let i = 0; i < 100; i++) history.push(pickQuickMove(set, 1234 + i, history.slice(-2)).id)
for (let i = 2; i < history.length; i++) {
  expect(new Set(history.slice(i - 2, i + 1)).size).toBeGreaterThan(1)
}
```

- [ ] **Step 2: Encode the approved move IDs**

```ts
export const CHARACTER_MOVE_IDS = {
  cinnamoroll: ['cloudBounce', 'earSweep', 'skyPress'],
  thanos: ['gemRicochet', 'gravityGrip', 'fateSnap'],
  ironman: ['palmRepulsor', 'chestBeam', 'repulsorBarrage'],
  hulk: ['fistPound', 'groundStomp', 'thunderSmash'],
  godzilla: ['tailSweep', 'footStomp', 'atomicBreath'],
  dragonball: ['kiVolley', 'instantStrike', 'megaBeam'],
  cat: ['pawTaps', 'tailSweep', 'buttSlam'],
  ditto: ['blobPunch', 'stretchRoller', 'copySmash'],
  pooh: ['honeySplash', 'bellyPush', 'honeyBomb'],
} as const
```

Define full `CharacterMoveSet` objects using the Korean names and patterns from the approved spec. Quick moves have weights 1/1. Selection uses `Rng(seed)` but replaces a third identical result with the other quick move. Charged move selection is never random.

- [ ] **Step 3: Build the shared runtime**

The runtime accepts a character drawer, telegraph renderer, movement path, and an impact callback. Impact calls `action.damage()` once. After damage, if `remaining / initial <= 0.2`, or the controller reports this as the third valid action for the character and target run, issue a checked `finish: true` request. Never access `world.target` later without the checked action closure.

- [ ] **Step 4: Replace each current one-shot recipe**

Reuse existing drawings and shared `actor`, `slam`, beam, shockwave, crack, emoji and particle primitives. Implement all 27 move IDs. Each quick move is 0.55-0.85s; each charged signature is 0.85-1.2s. Only one character actor may be active. Preserve each character's current signature emojis and audio.

- [ ] **Step 5: Add a property test across targets and fragment counts**

Use a fake target with initial counts `[1, 2, 3, 10, 40, 80]`. For each of 9 character sets and 100 seeds, apply actions until destroyed or three valid actions have settled. Assert no action detaches zero while pieces remain, an initial count of 1 finishes on its first valid action, no fresh charged action reaches 100% when the initial count is at least 2, every sample reaches zero in at most three actions, and damage never exceeds the declared max before the finisher condition. For a fresh nontrivial target, cap the first charged budget at `remaining - 1` after ratio rounding.

- [ ] **Step 6: Run tests and build**

Run: `npm test -- src/weapons/character-catalog.test.ts src/combat && npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/weapons/character-catalog.ts src/weapons/character-catalog.test.ts src/weapons/character-runtime.ts src/weapons/characters.ts src/art/assets.ts
git commit -m "feat: add varied character move sets"
```

### Task 6: Consolidate skins and verify the full interaction surface

**Files:**
- Modify: `src/weapons/registry.ts`
- Modify: `src/weapons/bar.ts`
- Modify: `src/art/assets.ts`
- Modify: `src/game.ts`
- Modify: `src/style.css`
- Modify: `src/engine/engine.test.ts`

**Interfaces:**
- Produces: exactly 21 weapons; `CharacterSkinCatalog` with default/classic assets.
- Consumers: Plan B record book and progress profile.

- [ ] **Step 1: Write registry and skin tests**

```ts
expect(weapons).toHaveLength(21)
expect(new Set(weapons.map((w) => w.id)).size).toBe(21)
expect(weapons.some((w) => w.id.endsWith('Old'))).toBe(false)
expect(CHARACTER_SKINS.cinnamoroll.map((s) => s.id)).toEqual(['default', 'classic'])
expect(CHARACTER_SKINS.ditto.map((s) => s.id)).toEqual(['default', 'classic'])
```

- [ ] **Step 2: Consolidate legacy entries**

Remove `cinnamorollOld` and `dittoOld` from `characterWeapons`. Keep both image assets in `CHARACTER_SKINS`. `charDraw()` resolves the selected skin through a getter supplied by Game and defaults to `default` until Plan B persists profile choices.

After all 21 entries expose `quick`, `drag`, and `charged`, make those three members required in `Weapon`, delete the temporary `apply` member and the Game fallback, then prove `rg -n "\.apply\(" src/weapons src/game.ts` has no weapon-dispatch matches.

- [ ] **Step 3: Finish interaction polish**

Change weapon items from `div` to `button type="button"`, minimum 60×70 remains, add `aria-label="<name> 선택"`, visible focus, and reduced-motion styles. Add one-time instructional copy `꾹 눌러 힘을 모으고, 떼면 한방!` after the first valid tap; Plan B moves its seen-state into ProgressStore.

- [ ] **Step 4: Run the full automated gate**

Run: `npm test && npm run build && npm run typecheck`

Expected: all PASS.

- [ ] **Step 5: Run browser verification**

Run: `npm run dev -- --host 127.0.0.1`

At 390×844 verify: 449ms tap, charge ring, max charge release, drag conversion, multi-touch secondary tap, reset/next cancellation, all 12 charged elemental attacks, all 27 character moves, no one-action fresh character destruction, maximum three-action finish, 21 weapon buttons, default/classic asset lookup, reduced motion, haptics off, no console errors. Then run 50 character actions and confirm active effects return to the steady baseline; overlap FEVER with the heaviest charged signature and confirm the effect cap, particle cap, and controls remain stable.

- [ ] **Step 6: Commit**

```bash
git add src/weapons/registry.ts src/weapons/bar.ts src/art/assets.ts src/game.ts src/style.css src/engine/engine.test.ts
git commit -m "feat: finish charged combat interaction"
```

## Plan A Completion Gate

- `npm test`, `npm run build`, and `npm run typecheck` pass.
- Fresh targets are never fully destroyed by one character tap or one fresh charged action.
- Every character/target/seed sample finishes within three valid character actions.
- Stale async impacts, duplicate releases, and cancelled gestures never damage or progress.
- Browser render verified at 390×844 with no overlap, stuck charge state, or console error.
- No Plan B/C feature is implemented early except interfaces explicitly required above.
