# Target Diversity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the game from three targets to a deterministic 12-target escalating cycle using nine generated base-art assets, code-owned damage masks and physics, resilient code fallbacks, persisted rotation, and mobile performance gates.

**Architecture:** A typed target catalog separates stable identity and rotation from drawing. Generated WebP assets are optional presentation inputs loaded two at a time; `Breakable` always uses a code mask for fragment membership and a code fallback when art is unavailable. Plan B's versioned progress state stores rotation position without persisting partial damage.

**Tech Stack:** Existing Vite 5, TypeScript, Canvas 2D, Vitest, built-in image generation, local chroma-key removal helper, Sharp as a development-only asset validator/processor, GitHub Actions.

## Global Constraints

- Plans A and B must be complete and green before Plan D implementation starts.
- Plan C must be complete and green before Task 6 runs the SQL/RLS and branch-CI release gate.
- Catalog contains exactly 12 stable IDs: `word`, `alarm`, `mug`, `parcel`, `vending`, `small-house`, `city`, `mountain`, `moon`, `earth`, `ringed-planet`, `sun`.
- Existing `word`, `city`, and `earth` records remain valid; Korean names and array indexes are never storage keys.
- First cycle order is fixed. Later cycles shuffle only `[alarm,mug,parcel]` and `[vending,small-house]` using `installSeed + cycleIndex`.
- `next` never counts as a destroy, quest, stamp, or analytics event. Reset returns to `word` without clearing lifetime progress or cycle count.
- Generated art is build-time static input only. No runtime generation, external image CDN, user upload, target store, target selection UI, or remote target CRUD/analytics.
- Runtime holds at most the current and next decoded target image; first play never waits for optional image loading.
- Breakable fragment membership comes from code `drawMask`, sampled on a fixed 3×3 grid. Generated-image alpha never defines gameplay.
- Main art failure uses the same target's complete code fallback. A target that cannot produce one fragment advances without recording progress.
- New art: nine files, total <=1.8MB; square <=180KB; landscape <=240KB; no text/logo/face/person/animal/landmark/disaster imagery.
- Fragment caps match the approved catalog and never exceed 88.
- Target change announces `현재 타겟: <이름>` once through `aria-live="polite"`; reduced motion limits drop bounce, shake, and moving corona.
- Every task follows TDD where code behavior is involved and ends with a focused commit.
- Production deployment remains behind the existing preview, explicit approval, manual Pages workflow, smoke test, and five-minute observation gate.

---

## File Map

```text
src/targets/catalog.ts                    12 typed definitions and metadata
src/targets/catalog.test.ts               exact roster, IDs, fragment/asset invariants
src/targets/rotation.ts                   seeded order, validation, next/reset transitions
src/targets/rotation.test.ts              cycle, shuffle boundary, corrupt-state tests
src/targets/asset-manifest.ts             nine generated asset metadata entries
src/targets/asset-manifest.test.ts        manifest/file-name contract
src/targets/art-loader.ts                 max-two decoded-art cache and disposal
src/targets/art-loader.test.ts            lazy load, fallback, cache and close behavior
src/targets/generated-target.ts           catalog definition to Breakable factory
src/targets/generated-target.test.ts      asset/fallback choice and fragment creation
src/art/target-masks.ts                   deterministic code gameplay silhouettes
src/art/target-fallbacks.ts               nine complete procedural doodle fallbacks
src/art/target-art.test.ts                pixel occupancy and mask/fallback coverage
src/targets/breakable.ts                  separate mask drawing, 3×3 sampling, dispose
src/targets/target.ts                     stable id and disposal contract
src/targets/manager.ts                    persisted catalog order and position changes
src/targets/manager.test.ts               destroy/skip/reset/reload/cycle behavior
src/progress/types.ts                     targetRotation and 12-ID byTarget records
src/progress/defaults.ts                  first target rotation defaults
src/progress/validate.ts                  corrupt/missing rotation recovery
src/progress/store.ts                     targetMove checkpoint
src/ui/target-announcer.ts                polite one-shot target-name announcement
src/game.ts                               loader, manager, progress and announcement wiring
src/main.ts                               immediate Game boot; background optional assets
public/assets/targets/*.webp               nine generated transparent assets
public/assets/targets/manifest.json       single asset-processing source of truth
scripts/process-target-asset.mjs          normalize dimensions and lossless WebP
scripts/validate-target-assets.mjs         size, dimensions, alpha and total-budget gate
docs/assets/target-art-generation.md       prompts, model/date and visual QA record
.github/workflows/deploy.yml               target-asset validation before tests/build
```

### Task 1: Typed catalog and deterministic rotation

**Files:**
- Create: `src/targets/catalog.ts`
- Create: `src/targets/catalog.test.ts`
- Create: `src/targets/rotation.ts`
- Create: `src/targets/rotation.test.ts`

**Interfaces:**
- Produces: `TargetId`, `TargetDefinition`, `TARGET_CATALOG`, `TargetRotation`, `buildTargetOrder()`, `normalizeTargetRotation()`, `advanceTargetRotation()`, `resetTargetRotation()`.
- Consumers: asset manifest, generated factories, TargetManager, Plan B progress validation.

- [ ] **Step 1: Write the failing catalog tests**

```ts
const ids = TARGET_CATALOG.map((target) => target.id)
expect(ids).toEqual([
  'word', 'alarm', 'mug', 'parcel', 'vending', 'small-house',
  'city', 'mountain', 'moon', 'earth', 'ringed-planet', 'sun',
])
expect(new Set(ids).size).toBe(12)
expect(Math.max(...TARGET_CATALOG.map((target) => target.fragmentCount))).toBe(88)
expect(TARGET_CATALOG.filter((target) => target.assetId !== null).map((target) => target.id))
  .toEqual(['alarm','mug','parcel','vending','small-house','mountain','moon','ringed-planet','sun'])
```

- [ ] **Step 2: Write the failing rotation tests**

Test exact first-cycle order, same-seed equality, different-cycle variation within at least one allowed block, fixed order outside both blocks, sun-to-word cycle increment, reset-to-word without cycle reset, unknown/duplicate/missing ID recovery, and clamped invalid positions.

```ts
expect(buildTargetOrder('install-a', 0)).toEqual(TARGET_IDS)
const later = buildTargetOrder('install-a', 7)
expect(later.slice(0, 1)).toEqual(['word'])
expect(new Set(later.slice(1, 4))).toEqual(new Set(['alarm','mug','parcel']))
expect(new Set(later.slice(4, 6))).toEqual(new Set(['vending','small-house']))
expect(later.slice(6)).toEqual(['city','mountain','moon','earth','ringed-planet','sun'])
```

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- src/targets/catalog.test.ts src/targets/rotation.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement the exact catalog types and values**

```ts
export type TargetId =
  | 'word' | 'alarm' | 'mug' | 'parcel' | 'vending' | 'small-house'
  | 'city' | 'mountain' | 'moon' | 'earth' | 'ringed-planet' | 'sun'

export interface TargetDefinition {
  id: TargetId
  name: string
  tier: 'object' | 'place' | 'world' | 'space'
  fragmentCount: number
  assetId: Exclude<TargetId, 'word' | 'city' | 'earth'> | null
  widthScale: number
  heightScale: number
  centerYFrac: number
}

export const TARGET_CATALOG: readonly TargetDefinition[] = [
  { id: 'word', name: '세상', tier: 'world', fragmentCount: 64, assetId: null, widthScale: 0.90, heightScale: 0.36, centerYFrac: 0.45 },
  { id: 'alarm', name: '알람시계', tier: 'object', fragmentCount: 60, assetId: 'alarm', widthScale: 0.68, heightScale: 0.42, centerYFrac: 0.46 },
  { id: 'mug', name: '머그컵', tier: 'object', fragmentCount: 56, assetId: 'mug', widthScale: 0.64, heightScale: 0.44, centerYFrac: 0.47 },
  { id: 'parcel', name: '택배 상자', tier: 'object', fragmentCount: 64, assetId: 'parcel', widthScale: 0.72, heightScale: 0.48, centerYFrac: 0.48 },
  { id: 'vending', name: '자판기', tier: 'place', fragmentCount: 72, assetId: 'vending', widthScale: 0.62, heightScale: 0.62, centerYFrac: 0.48 },
  { id: 'small-house', name: '작은 집', tier: 'place', fragmentCount: 76, assetId: 'small-house', widthScale: 0.82, heightScale: 0.58, centerYFrac: 0.49 },
  { id: 'city', name: '도시', tier: 'place', fragmentCount: 88, assetId: null, widthScale: 0.92, heightScale: 0.50, centerYFrac: 0.50 },
  { id: 'mountain', name: '산', tier: 'world', fragmentCount: 80, assetId: 'mountain', widthScale: 0.90, heightScale: 0.58, centerYFrac: 0.49 },
  { id: 'moon', name: '달', tier: 'space', fragmentCount: 72, assetId: 'moon', widthScale: 0.72, heightScale: 0.58, centerYFrac: 0.45 },
  { id: 'earth', name: '지구', tier: 'world', fragmentCount: 74, assetId: null, widthScale: 0.72, heightScale: 0.72, centerYFrac: 0.45 },
  { id: 'ringed-planet', name: '고리 행성', tier: 'space', fragmentCount: 82, assetId: 'ringed-planet', widthScale: 0.90, heightScale: 0.56, centerYFrac: 0.45 },
  { id: 'sun', name: '태양', tier: 'space', fragmentCount: 72, assetId: 'sun', widthScale: 0.76, heightScale: 0.62, centerYFrac: 0.45 },
] as const
```

- [ ] **Step 5: Implement deterministic order and validation**

```ts
export interface TargetRotation {
  catalogVersion: 1
  cycleIndex: number
  position: number
  orderIds: TargetId[]
}

export function buildTargetOrder(installSeed: string, cycleIndex: number): TargetId[]
export function normalizeTargetRotation(value: unknown, installSeed: string): TargetRotation
export function advanceTargetRotation(rotation: TargetRotation, installSeed: string): TargetRotation
export function resetTargetRotation(rotation: TargetRotation, installSeed: string): TargetRotation
```

Use FNV-1a over `${installSeed}:${cycleIndex}` to seed existing `Rng`. Apply Fisher-Yates independently to indexes `1..3` and `4..5`; cycle `0` bypasses shuffle. `normalizeTargetRotation` regenerates the whole order when version, IDs, uniqueness, length, or fixed segments are invalid, while preserving a finite non-negative `cycleIndex` and clamping `position` to `0..11`.

- [ ] **Step 6: Run GREEN and full gate**

Run: `npm test -- src/targets/catalog.test.ts src/targets/rotation.test.ts && npm run typecheck`

Expected: both files PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/targets/catalog.ts src/targets/catalog.test.ts src/targets/rotation.ts src/targets/rotation.test.ts
git commit -m "feat: add target catalog and rotation"
```

### Task 2: Generate, process, and validate nine target assets

**Files:**
- Create: `public/assets/targets/manifest.json`
- Create: `public/assets/targets/alarm.webp`
- Create: `public/assets/targets/mug.webp`
- Create: `public/assets/targets/parcel.webp`
- Create: `public/assets/targets/vending.webp`
- Create: `public/assets/targets/small-house.webp`
- Create: `public/assets/targets/mountain.webp`
- Create: `public/assets/targets/moon.webp`
- Create: `public/assets/targets/ringed-planet.webp`
- Create: `public/assets/targets/sun.webp`
- Create: `src/targets/asset-manifest.ts`
- Create: `src/targets/asset-manifest.test.ts`
- Create: `scripts/process-target-asset.mjs`
- Create: `scripts/validate-target-assets.mjs`
- Create: `docs/assets/target-art-generation.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `TARGET_ASSETS`, nine normalized static WebPs, `npm run validate:target-assets`.
- Consumers: Task 4 art loader and CI.

- [ ] **Step 1: Write the failing manifest test**

```ts
expect(TARGET_ASSETS.map((asset) => asset.id)).toEqual([
  'alarm','mug','parcel','vending','small-house','mountain','moon','ringed-planet','sun',
])
expect(TARGET_ASSETS.every((asset) => asset.path.startsWith('assets/targets/'))).toBe(true)
expect(TARGET_ASSETS.filter((asset) => asset.width === 1536).map((asset) => asset.id))
  .toEqual(['mountain','ringed-planet'])
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/targets/asset-manifest.test.ts`

Expected: FAIL because `asset-manifest.ts` is missing.

- [ ] **Step 3: Add the exact manifest and processing scripts**

`manifest.json` contains nine objects with `id`, `file`, `width`, `height`, and `maxBytes`. Use `1024×1024` and `184320` bytes for square assets; use `1536×1024` and `245760` bytes for `mountain` and `ringed-planet`.

`asset-manifest.ts` imports the JSON and exposes a readonly typed array. `process-target-asset.mjs` uses Sharp to contain-fit a transparent PNG to its manifest dimensions without upscaling the subject, then writes lossless WebP. `validate-target-assets.mjs` rejects missing files, wrong dimensions, missing alpha, nontransparent corners, alpha bounding-box occupancy outside 65-85% on both axes, per-file overflow, or total bytes above `1_887_436`.

Core processor shape:

```js
const id = process.argv[2]
const input = process.argv[3]
const spec = manifest.find((item) => item.id === id)
if (!spec || !input) throw new Error('Usage: process-target-asset <id> <alpha-png>')
await sharp(input)
  .resize(spec.width, spec.height, {
    fit: 'contain',
    withoutEnlargement: true,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .webp({ lossless: true, effort: 6 })
  .toFile(new URL(`../public/assets/targets/${spec.file}`, import.meta.url))
```

The validator decodes `ensureAlpha().raw()` pixels, requires all four corner alpha values `<=4`, computes the nontransparent `alpha>=16` bounding box, and prints `9 assets, <total> bytes` on success. Any rejection exits 1 after listing every failing file and rule.

Install: `npm install --save-dev sharp`

Add scripts:

```json
{
  "process:target-asset": "node scripts/process-target-asset.mjs",
  "validate:target-assets": "node scripts/validate-target-assets.mjs"
}
```

- [ ] **Step 4: Prove the asset gate fails before generation**

Run: `npm run validate:target-assets`

Expected: FAIL listing all nine missing `.webp` files.

- [ ] **Step 5: Generate one source image per target with the built-in image tool**

Use one built-in image-generation call per target. Common prompt, copied verbatim into every call:

```text
Use case: stylized-concept
Asset type: mobile game breakable target base art
Style/medium: cute hand-drawn toy model illustration, 4 to 6 flat colors, thick dark navy outline, soft upper-left lighting
Composition: one centered connected subject occupying 65 to 85 percent of the canvas, generous padding, no detached parts
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background, one uniform color, no shadow, gradient, texture, reflection, floor, or lighting variation
Constraints: crisp edges; no #00ff00 in the subject; no feature thinner than 24 pixels at 1024 resolution; fill internal holes with a dark color; no text, logo, watermark, face, person, animal, vehicle, flag, landmark, smoke, fire, damage, debris, or background object
```

Append exactly one subject block per call:

| ID | Subject block |
|---|---|
| `alarm` | `Subject: a chunky rounded toy alarm clock, connected bells and feet, simple clock hands, cream yellow coral and navy palette` |
| `mug` | `Subject: a chunky ceramic toy mug, oversized fused handle with its inner opening filled dark, cream yellow and sky blue palette` |
| `parcel` | `Subject: a closed chunky toy parcel box, one broad tape strip, coral cardboard and cream tape, no label` |
| `vending` | `Subject: a rounded generic toy vending machine, large colored product windows and one large button, coral cream sky blue and navy, no words or brands` |
| `small-house` | `Subject: a compact toy house with connected roof and chimney, filled windows and door, cream coral sky blue and navy, no yard or people` |
| `mountain` | `Subject: one connected asymmetrical toy mountain mass with broad snow cap and two dark rock planes, lavender sky blue cream and navy, no trees or clouds` |
| `moon` | `Subject: one asymmetrical toy moon disc with large filled craters and an uneven outer rim, cream pale blue lavender and navy` |
| `ringed-planet` | `Subject: one toy ringed planet with a very thick ring fused across the planet body and no transparent ring hole, lavender coral cream sky blue and navy` |
| `sun` | `Subject: one warm toy sun disc with two thick concentric rim bands and no detached rays, yellow orange cream and navy; moving corona will be drawn in code` |

After each call, copy the selected generated source named by the tool output into the exact matching path from this list: `/private/tmp/btw-target-alarm-key.png`, `/private/tmp/btw-target-mug-key.png`, `/private/tmp/btw-target-parcel-key.png`, `/private/tmp/btw-target-vending-key.png`, `/private/tmp/btw-target-small-house-key.png`, `/private/tmp/btw-target-mountain-key.png`, `/private/tmp/btw-target-moon-key.png`, `/private/tmp/btw-target-ringed-planet-key.png`, `/private/tmp/btw-target-sun-key.png`. Do not generate or retain rejected variants in the project.

- [ ] **Step 6: Remove chroma key and normalize every final asset**

For each ID, run the installed helper first:

```bash
python /Users/kyungsbook/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py --input /private/tmp/btw-target-alarm-key.png --out /private/tmp/btw-target-alarm-alpha.png --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
```

Repeat with the exact IDs `mug`, `parcel`, `vending`, `small-house`, `mountain`, `moon`, `ringed-planet`, and `sun`, then process each:

```bash
npm run process:target-asset -- alarm /private/tmp/btw-target-alarm-alpha.png
```

The processing script writes the matching `public/assets/targets/ID.webp` where `ID` is one of the nine exact manifest IDs. Retry one chroma removal with `--edge-contract 1` only when visual inspection finds a green fringe.

- [ ] **Step 7: Inspect and record visual QA**

Open all nine final files on both navy and white checkerboards. Reject candidates with inconsistent outline weight, transparent holes, green fringe, isolated decorations, accidental symbols/text, faces, logos, shadows, or realistic damage. `docs/assets/target-art-generation.md` records date `2026-07-16`, built-in image tool, common prompt, each subject block, selected filename, dimensions/bytes, and pass/reject notes.

- [ ] **Step 8: Run GREEN and full asset gate**

Run: `npm test -- src/targets/asset-manifest.test.ts && npm run validate:target-assets && npm run build`

Expected: test PASS; validator reports `9 assets, total <= 1887436 bytes`; build exits 0.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json public/assets/targets src/targets/asset-manifest.ts src/targets/asset-manifest.test.ts scripts/process-target-asset.mjs scripts/validate-target-assets.mjs docs/assets/target-art-generation.md
git commit -m "feat: add generated target art assets"
```

### Task 3: Code masks, fallbacks, 3×3 fragment sampling, and disposal

**Files:**
- Create: `src/art/target-masks.ts`
- Create: `src/art/target-fallbacks.ts`
- Create: `src/art/target-art.test.ts`
- Modify: `src/targets/breakable.ts`
- Modify: `src/targets/target.ts`
- Modify: `src/targets/word.ts`
- Modify: `src/targets/city.ts`
- Modify: `src/targets/earth.ts`
- Modify: `src/engine/engine.test.ts`

**Interfaces:**
- Produces: `TARGET_MASKS`, `TARGET_FALLBACKS`, `Target.dispose()`, `BreakableOptions.drawMask`.
- Consumers: generated factory, manager cleanup, compatibility matrix.

- [ ] **Step 1: Write failing mask/fallback tests**

For each of the nine generated IDs, render its mask and fallback at `512×512`. Assert mask opaque occupancy is 25-80%, all four outer corners are transparent, fallback has visible alpha where the mask is opaque, and repeated renders produce the same pixel hash.

- [ ] **Step 2: Write failing Breakable sampling/disposal tests**

Test that a thin centroid miss survives when at least 3 of the fixed 3×3 sample points are inside, fewer than 3 points is dropped, art alpha cannot keep a mask-excluded fragment, every nonempty mask produces at least one fragment, and `dispose()` releases master/fragment canvas dimensions then becomes idempotent.

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- src/art/target-art.test.ts src/engine/engine.test.ts`

Expected: FAIL because masks/fallbacks, `drawMask`, and `dispose` are missing.

- [ ] **Step 4: Implement the mask and lifecycle contract**

```ts
export type TargetPainter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void

export interface BreakableOptions {
  id: TargetId
  name: string
  spriteW: number
  spriteH: number
  fragments: number
  draw: TargetPainter
  drawMask?: TargetPainter
  centerYFrac?: number
  seed?: number
}
```

Render `draw` to the master canvas and `drawMask ?? draw` to a separate mask canvas. For every polygon, sample offsets `[-0.25,0,0.25] × [-0.25,0,0.25]` relative to its bounding box around the centroid and keep it when at least 3 samples have alpha >=128. Preserve the existing never-empty all-polygons fallback. Add readonly `id` to `Target`. `dispose()` zeroes master/mask/fragment canvas dimensions, clears fragment arrays, and safely returns on repeat calls.

- [ ] **Step 5: Implement all nine deterministic silhouettes**

`TARGET_MASKS` draws filled connected gameplay bodies matching the generated subjects. `TARGET_FALLBACKS` draws complete 4-6 color doodles with the same navy outline. Alarm feet/bells, mug handle interior, ring, and sun corona are connected or filled; no mask uses random numbers, text, filters, or external images.

Use normalized coordinates from `0..1` and these exact body recipes; fallback painters reuse the same geometry with palette fills and 6px navy strokes:

| ID | Code mask recipe |
|---|---|
| `alarm` | rounded body `(0.18,0.25,0.64,0.58,r=.12)`, connected bell circles `(0.31,0.23,.14)` and `(0.69,0.23,.14)`, feet rectangles `(0.25,0.78,.14,.12)` and `(0.61,0.78,.14,.12)` |
| `mug` | rounded body `(0.18,0.20,0.58,0.66,r=.10)` plus filled handle ellipse centered `(0.76,0.52)` radii `(.20,.25)` |
| `parcel` | rounded box `(0.14,0.18,0.72,0.68,r=.06)` plus full-height tape strip `(0.43,0.18,0.14,0.68)` |
| `vending` | rounded cabinet `(0.22,0.08,0.56,0.84,r=.06)`; windows/buttons are painted details, never mask holes |
| `small-house` | connected polygon `(0.10,.45)→(.50,.10)→(.90,.45)→(.84,.88)→(.16,.88)` plus chimney `(0.68,.16,.12,.24)` |
| `mountain` | connected asymmetric polygon `(.04,.88)→(.28,.55)→(.45,.12)→(.60,.42)→(.70,.30)→(.96,.88)` |
| `moon` | main ellipse centered `(.50,.50)` radii `(.37,.40)` with four filled crater details |
| `ringed-planet` | thick rotated ellipse ring centered `(.50,.53)` radii `(.46,.22)`, line width `.16*h`, plus planet ellipse radii `(.29,.32)` |
| `sun` | disc centered `(.50,.50)` radius `.36`; corona is a nonmask decorative code layer |

- [ ] **Step 6: Run GREEN and build**

Run: `npm test -- src/art/target-art.test.ts src/engine/engine.test.ts && npm run build`

Expected: all tests PASS and build exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/art/target-masks.ts src/art/target-fallbacks.ts src/art/target-art.test.ts src/targets/breakable.ts src/targets/target.ts src/targets/word.ts src/targets/city.ts src/targets/earth.ts src/engine/engine.test.ts
git commit -m "feat: add target masks and fallbacks"
```

### Task 4: On-demand art loader and generated target factory

**Files:**
- Create: `src/targets/art-loader.ts`
- Create: `src/targets/art-loader.test.ts`
- Create: `src/targets/generated-target.ts`
- Create: `src/targets/generated-target.test.ts`
- Modify: `src/art/assets.ts`
- Modify: `src/main.ts`
- Modify: `src/targets/word.ts`
- Modify: `src/targets/city.ts`
- Modify: `src/targets/earth.ts`

**Interfaces:**
- Produces: `TargetArtLoader`, `createTarget(definition, viewport, loader, seed)`, nonblocking boot.
- Consumes: catalog, asset manifest, masks/fallbacks, existing three code targets.

- [ ] **Step 1: Write failing loader tests**

Use injected `load(url)` and `close(image)` functions. Test cache hit, failed load returns `null`, retry only on a later explicit `prepare`, `keep([current,next])` never retains more than two images, evicted/cleared images close exactly once, stale in-flight results close instead of entering cache, and duplicate prepares share one promise.

- [ ] **Step 2: Write failing factory tests**

Test all 12 definitions produce matching `Target.id/name`, exact fragment cap request, generated art when ready, code fallback when absent, same code mask in both paths, and existing word/city/earth factories preserve their approved code art.

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- src/targets/art-loader.test.ts src/targets/generated-target.test.ts`

Expected: FAIL because loader/factory modules are missing.

- [ ] **Step 4: Implement the two-image loader**

```ts
export interface DecodedTargetArt {
  readonly source: CanvasImageSource
  readonly width: number
  readonly height: number
  close(): void
}

export class TargetArtLoader {
  prepare(id: GeneratedTargetId): Promise<DecodedTargetArt | null>
  get(id: GeneratedTargetId): DecodedTargetArt | null
  keep(ids: readonly GeneratedTargetId[]): void
  clear(): void
}
```

Default loading uses same-origin `fetch`, `blob`, and `createImageBitmap`; a guarded HTMLImageElement path handles browsers without `createImageBitmap`. Prefix manifest paths with `import.meta.env.BASE_URL`. Do not retry during the same `prepare` call and never throw into Game.

- [ ] **Step 5: Implement the catalog factory**

For generated targets, `draw` uses the ready decoded source through `drawImageContain`, otherwise `TARGET_FALLBACKS[id]`; `drawMask` always uses `TARGET_MASKS[id]`. Compute sprite dimensions from catalog scales and the viewport with the same mobile height guards as existing factories. For `word`, `city`, and `earth`, reuse existing code drawers and add stable IDs.

- [ ] **Step 6: Make boot nonblocking**

Replace the blocking `preloadAssets(...).finally(() => new Game(...))` with immediate `new Game(...)`. Start legacy character/image preload in the background and never await it. Target art is exclusively prepared by `TargetArtLoader`; the all-assets preload list must not include target WebPs.

- [ ] **Step 7: Run GREEN and browser boot check**

Run: `npm test -- src/targets/art-loader.test.ts src/targets/generated-target.test.ts && npm run build`

Serve with network disabled before load. Expected: game renders `word` immediately with no console error; generated targets use fallbacks.

- [ ] **Step 8: Commit**

```bash
git add src/targets/art-loader.ts src/targets/art-loader.test.ts src/targets/generated-target.ts src/targets/generated-target.test.ts src/art/assets.ts src/main.ts src/targets/word.ts src/targets/city.ts src/targets/earth.ts
git commit -m "perf: load target art on demand"
```

### Task 5: Persisted TargetManager integration and accessible announcement

**Files:**
- Create: `src/targets/manager.test.ts`
- Create: `src/ui/target-announcer.ts`
- Create: `src/ui/target-announcer.test.ts`
- Modify: `src/targets/manager.ts`
- Modify: `src/progress/types.ts`
- Modify: `src/progress/defaults.ts`
- Modify: `src/progress/validate.ts`
- Modify: `src/progress/store.ts`
- Modify: `src/progress/store.test.ts`
- Modify: `src/progress/catalog.ts`
- Modify: `src/game.ts`
- Modify: `src/style.css`

**Interfaces:**
- Produces: manager snapshots, targetMove checkpoint, 12-ID progress records, polite announcement.
- Consumes: completed Plan B `ProgressStore`, catalog/rotation, Plan A targetRunId/action cancellation.

- [ ] **Step 1: Write failing manager and progress tests**

Test: constructor resumes stored position with a fresh intact target; destroy advances and calls `onPositionChange(...,'destroy')`; skip advances with reason `skip` but never `onDestroyed`; reset goes to word with reason `reset` and keeps `cycleIndex`; sun advances to word and increments cycle; next image is prepared; old target is disposed before spawn; invalid stored order is normalized without altering lifetime totals.

Extend storage tests so `targetRotation` survives reload, unknown IDs recover, missing fields use cycle 0 word, and `targetMove` checkpoints once.

- [ ] **Step 2: Write failing announcer tests**

Test one persistent `aria-live="polite"` node, exact `현재 타겟: 달` text, repeated same-run calls do not duplicate DOM, a new targetRunId updates once, and technical load errors never appear in the visible UI.

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- src/targets/manager.test.ts src/progress/store.test.ts src/ui/target-announcer.test.ts`

Expected: FAIL for missing rotation integration and announcer.

- [ ] **Step 4: Extend the progress state exactly**

```ts
byTarget: Record<TargetId, { destroys: number }>
targetRotation: TargetRotation
```

Add `targetMove` to `CheckpointReason`. Defaults use cycle 0, position 0, and the fixed first order. Validation keeps valid existing `word/city/earth` counters, initializes nine new counters to zero, normalizes rotation through `normalizeTargetRotation`, and never changes lifetime/achievement state while repairing rotation.

Keep `world_cycle` anchored to `word`, `city`, and `earth`; do not add a target-specific quest or stamp.

- [ ] **Step 5: Refactor TargetManager around rotation**

```ts
export type TargetMoveReason = 'destroy' | 'skip' | 'reset'

export interface TargetManagerOpts {
  rotation: TargetRotation
  installSeed: string
  createTarget(id: TargetId, w: number, h: number): Target | null
  prepareTarget(id: TargetId): void
  onPositionChange(snapshot: TargetRotation, reason: TargetMoveReason): void
  onDestroyed?: (target: Target) => void
  onSpawn?: (target: Target, targetRunId: number) => void
}
```

Preserve Plan A's monotonic `targetRunId` and stale-action cancellation. Dispose the outgoing target before replacement. After spawn, keep current+next generated images and prepare only next. A failed factory moves forward once without calling destroy/progress; after 12 consecutive failures instantiate the `word` code fallback and stop automatic skipping.

- [ ] **Step 6: Wire Game and announcement**

Game reads the stored rotation, creates the manager with catalog factories, saves `targetMove` after destroy/skip/reset, dispatches `TARGET_DESTROYED` only from real user destruction, cancels active actions before every target change, and announces each spawned target once. Reduced motion reaches Target drop/corona effects; no new permanent control is added.

- [ ] **Step 7: Run GREEN and full gate**

Run: `npm test -- src/targets/manager.test.ts src/progress/store.test.ts src/ui/target-announcer.test.ts && npm test && npm run build && npm run typecheck`

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/targets/manager.ts src/targets/manager.test.ts src/ui/target-announcer.ts src/ui/target-announcer.test.ts src/progress/types.ts src/progress/defaults.ts src/progress/validate.ts src/progress/store.ts src/progress/store.test.ts src/progress/catalog.ts src/game.ts src/style.css
git commit -m "feat: add persisted twelve-target cycle"
```

### Task 6: Compatibility matrix, CI, browser performance, and release wording

**Files:**
- Create: `src/targets/compatibility.test.ts`
- Create: `src/targets/fallback.test.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `package.json`
- Modify: `src/ui/whatsnew.ts`
- Modify after verified production deploy: `README.md`
- Modify after verified production deploy: `AGENTS.md`

**Interfaces:**
- Produces: automated 252-combination regression gate, forced-fallback gate, CI asset validation, final release summary.

- [ ] **Step 1: Write the 21×12 failing compatibility test**

Using the real weapon registry, actual target factories, deterministic fake time, and existing effect/world primitives, run one quick and one charged action for every weapon-target pair. Assert every settled user action detaches at least one fragment while pieces remain, no fresh target with at least two fragments is fully destroyed by one charged action, no request exceeds its declared budget, stale targetRunId impacts do nothing, and cleanup leaves no active target/effect resources.

Separately run each of nine character sets against each of 12 targets for 100 seeds and assert destruction in at most three valid actions.

- [ ] **Step 2: Write forced-fallback tests**

Force all nine image loads to fail and assert exact target IDs/names/order, playable fragment counts, and no visible technical message. Force one code fallback to return zero fragments and assert a record-free single advance. Force all definitions to fail and assert the manager remains on a playable `word` fallback without an infinite advance loop.

- [ ] **Step 3: Run and verify RED**

Run: `npm test -- src/targets/compatibility.test.ts src/targets/fallback.test.ts`

Expected: FAIL until all integration hooks and cleanup assertions exist.

- [ ] **Step 4: Complete the test harness and make it GREEN**

Use test-owned canvas/clock utilities; do not add production-only test methods. Step effects until idle with a hard 2-second simulated cap per action. If a real action cannot be observed without production changes, expose a generally useful readonly lifecycle value, never a test-only reset or inspection hook.

Run: `npm test -- src/targets/compatibility.test.ts src/targets/fallback.test.ts`

Expected: 252 weapon-target cases and 10,800 character-target-seed cases PASS.

- [ ] **Step 5: Wire asset validation into CI**

Create `.github/workflows/ci.yml` for `pull_request` and pushes to `codex/**`. Its read-only build job runs `npm ci`, target-asset validation, copy lint, tests, typecheck, and build, then uploads the `dist` artifact without Pages deployment permissions. Run the same target-asset validation immediately after `npm ci` in `.github/workflows/deploy.yml`; keep that deployment workflow on manual `workflow_dispatch` only.

```yaml
name: CI
on:
  pull_request:
  push:
    branches: ['codex/**']
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run validate:target-assets
      - run: npm run lint:copy
      - run: npm test
      - run: npm run typecheck
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist
```

- [ ] **Step 6: Update the once-per-version notice**

Add one item without technical terms:

```ts
{ e: '🌍', t: '세상부터 태양까지 12가지 대상을 차례로 부숴요.' }
```

Do not add a startup dialog beyond the existing once-per-version notice.

- [ ] **Step 7: Run the complete local CI equivalent**

```bash
npm run validate:target-assets
npm run lint:copy
npm test
npm run typecheck
npm run build
npx supabase db reset
npx supabase test db
```

Expected: every command exits 0 with no warnings treated as errors.

- [ ] **Step 8: Run visual, fallback, and performance verification**

At 320×568, 390×844, and 430×932 verify all 12 targets in normal, golden, reduced-motion, WebP, offline, delayed-load, and code-fallback states. Confirm silhouettes distinguish moon/earth/sun without color. At 390×844 on iOS Safari and low-end Android Chrome, cycle 50 times; record p95 frame time, >50ms frame percentage, transition long tasks, decoded-image count, active effects/canvases, and heap before/after. Required: p95 <=20ms, >50ms frames <1%, transition block <50ms, decoded images <=2, target memory <=24MB, post-cycle heap within ±10%.

- [ ] **Step 9: Push the feature branch and verify GitHub Actions**

Fetch first, confirm the branch contains only intended commits, push `codex/gamification-upgrade`, and inspect the workflow run. CI must pass asset validation, copy lint, tests, typecheck/build, and Pages artifact creation. Do not dispatch the production deployment workflow yet.

- [ ] **Step 10: Add final PM wording only after production verification**

The final README section uses the actual production date and these concise bullets:

```md
## 최근 업데이트: 2026-07-16

- 꾹 누르기 강타와 무기별 충전 효과 추가
- 캐릭터 9종에 각기 다른 기술 3개 적용
- 파괴 타겟을 3종에서 12종으로 확대
- 오늘의 도전 1개와 영구 도장 5개 추가
- 기록책에서 통계·칭호·캐릭터 모습 확인
- 운영자 화면에서 도전·기능·통계 관리
```

If production occurs on another date, replace only the heading date with that date. Update `AGENTS.md` from planned to actual architecture, paths, asset budgets, tests, deploy state, and one condensed history line.

- [ ] **Step 11: Commit verified integration**

Before production:

```bash
git add src/targets/compatibility.test.ts src/targets/fallback.test.ts .github/workflows/ci.yml .github/workflows/deploy.yml package.json src/ui/whatsnew.ts
git commit -m "test: verify twelve-target compatibility"
```

After production verification:

```bash
git add README.md AGENTS.md
git commit -m "docs: summarize twelve-target update"
```

## Plan D Completion Gate

- Exactly 12 targets follow the approved first-cycle and restricted later-cycle order.
- Nine generated WebPs pass visual and mechanical asset validation; all nine have complete code fallbacks.
- Runtime gameplay never depends on generated art, network availability, or target-specific remote configuration.
- Current+next is the only decoded target-art set; outgoing targets and bitmaps are disposed.
- Skip/reset/reload/cycle semantics persist without false destroy/progress events.
- Existing word/city/earth records and `world_cycle` meaning remain valid.
- 21×12 compatibility, 9×12×100 three-action property, fallback, migration, asset, full suite, typecheck, build, SQL/RLS, and copy gates pass.
- Three mobile viewport checks, real iOS/Android 50-cycle performance, local preview, branch CI, explicit production approval, production smoke test, and five-minute observation are complete before README/AGENTS claim delivery.
