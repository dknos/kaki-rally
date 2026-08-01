# Kaki Rally Raid — Wave 1 integration brief (machine-generated recon)

Produced by a ten-thread read-only recon of the repository. Threads that
returned: shell, terrain, dunephysics, embedded-raid, tests, cameras, rendering, assets-audio-input. The `critic` and `waveracer` threads died on API
errors and returned nothing, so their topics — global mutable state hazards,
unrealistic spec claims, and the Wave-Racer licence status — are **unanswered**.

**Treat this as a lead, not as truth.** It was generated part-way through this
session, so some statements about test status are already stale — in particular
it reports `smoke-raid-isolation.mjs` as RED, which was fixed after the brief
was written, and it describes the seams as "uncommitted by another agent" when
they were in fact this session's own uncommitted work. Its central technical
finding — the `smoke-standalone-boundaries.mjs` lazy-import conflict — was
independently verified by hand and is real.

---

# KAKI RALLY RAID — INTEGRATION BRIEF (Waves 0–3)

**Tree state verified live at time of writing (do not trust the recon reports over this):** `HEAD = 632efaf`, working tree has **3 modified tracked files** (`src/racing/index.js`, `src/app/rallyRouter.js`, `src/racing/racingModeAvailability.js`) landed by concurrent sibling agents, plus untracked `src/racing/raid/` (4 modules), `tools/smoke-raid-*.mjs` (4 files), `docs/raid/FROZEN_BOUNDARIES.json`, `tools/generate-raid-frozen-boundaries.mjs`.

**Suite status measured, not assumed:**

| command | result |
|---|---|
| `node tools/smoke-raid-route.mjs` | **GREEN** |
| `node tools/smoke-raid-surface-field.mjs` | **GREEN** |
| `node tools/smoke-raid-sector-seams.mjs` | **GREEN** |
| `node tools/smoke-raid-isolation.mjs` | **RED** — fails at `tools/smoke-raid-isolation.mjs:186-190` (`rallyApp.js` does not lazily import Raid) |
| `npm run test:racing` | GREEN |
| `npm run test:standalone` | GREEN (`smoke-standalone-boundaries` passes only because the lazy import does not exist yet) |
| `node tools/generate-raid-frozen-boundaries.mjs --check` | GREEN — 150 frozen files unchanged, 7 documented seams |

**The single scheduling fact that governs this wave:** `tools/smoke-raid-isolation.mjs:186-190` now *demands* `import('../racing/raid/*.js')` inside `src/app/rallyApp.js` (because `src/racing/raid/` exists), while `tools/smoke-standalone-boundaries.mjs:63-68` *forbids* it by exact-string equality. Exactly one of those two tests is red at any moment until **both** land in the same commit. Section A.5 and A.4 must be applied together.

**Before any edit:** run `git diff src/racing/index.js src/app/rallyRouter.js src/racing/racingModeAvailability.js`. Those three seams are already applied but **uncommitted** by another agent. If they are gone, apply the specs in A.1–A.3 yourself.

---

## A. EXACT SEAM PLAN

Authoritative seam list is `docs/raid/FROZEN_BOUNDARIES.json` → `seams[]`: `src/racing/index.js`, `src/racing/racingModeAvailability.js`, `src/racing/racingManifest.js`, `src/app/rallyRouter.js`, `src/app/rallyApp.js`, `src/app/rallySave.js`, `package.json`. All seam files are excluded from the frozen digest (verified: none appear in `files[]`), so editing them keeps `--check` green. `src/app/rallyMenu.js`, `src/app/rallyTouchControls.js`, `src/racing/racingVehicles.js`, `src/core/**`, `src/rendering/**`, `src/racing/dunes/**` are **frozen and not seams** — no edit is permitted in Waves 0–3.

### A.1 `src/racing/index.js` — **DONE, VERIFY ONLY**

Already applied (23 insertions, uncommitted):

- `:204` `let _raidModeApi = null;`
- `:206-214` `registerDevelopmentRacingMode('raid', api)` branch **ahead of** the crash guard at `:215`, validating `api.enterRaidMode` / `api.exitRaidMode`. Crash throw text and validation are byte-unchanged.
- `:2626-2632` `enterRacing()` raid branch ahead of the crash branch; throws when unregistered; calls `_raidModeApi.enterRaidMode(scene, { ...options, stageId: options.stageId || courseId })`.
- Dispatch: `:3052` `tickRaidMode(dt, elapsedDt)` (**takes `elapsedDt`, unlike crash at `:3053` which drops it — keep this**), `:3440` `getRaidCameraTarget`, `:3446` `updateRaidCamera`, `:3456` `resizeRaidMode`, `:3475` `getRaidCameraConfig`, `:3512` `getRaidSnapshot`, `:3851` `restartRaidMode`, `:3890` `exitRaidMode`.

**Why no adapter avoids it:** `state.racing` is a single global slot and every shell-facing export in this file dispatches on the `raceMode` string literal. There is no registry and no `instanceof`; a mode not named in these branches can be entered but never ticked, resized, snapshotted or exited.

**Verify additionally** (not yet confirmed): `setRacingCameraMode` (`~:3462`), `cycleRacingCamera`, `resetRacingCamera` have **no** raid branch — that is correct and deliberate (see A.4.g / D).

### A.2 `src/app/rallyRouter.js` — **DONE, VERIFY ONLY** (+1 optional line)

Already applied:

- `:15-16` `raid: 'raid', expedition: 'raid'` in `MODE_ALIASES`.
- `:29-38` `developmentFlag` hoisted; `raidDevelopment = isLocalDevelopmentUrl(parsed) && (developmentFlag === '1' || developmentFlag === 'raid')`.
- `:41-45` `gatedMode` nulls `mode` for `crash` without catastrophe flag **or** `raid` without raid flag. This is the clause that keeps `?mode=raid` inert on the public Pages build.
- `:47` `raidDevelopment` exported on the frozen route object; `:57`, `:70-75` `routeUrl` preserves the shared `dev` param for whichever flag is asking; `:112` `restartInWebGL` sets `raidDevelopment: mode === 'raid'`.

**Optional, additive, recommended:** add `stage: parsed.searchParams.get('stage') || null` to the frozen return at `:46-52` so `?mode=raid&play=1&dev=1&stage=<id>` can pick a stage without the shell hardcoding a stage id. If you skip it, the shell passes `courseId: ''` and `getRaidStage()` (`src/racing/raid/raidStageBlueprints.js:92`) falls back to `RAID_STAGE_ORDER[0]`.

**Why no adapter avoids it:** `normalizeRouteMode` (`:18`) returns `MODE_ALIASES[...] || null`. Without the alias the URL mode is `null` before any availability logic runs; nothing downstream can recover it.

### A.3 `src/racing/racingModeAvailability.js` — **DONE, VERIFY ONLY**

Already applied: `:16` new option `raidDevelopment = false`; `:22-40` a `mode === 'raid'` branch returning `canLaunch:false / label:'IN DEVELOPMENT'` without the flag and `canLaunch:true / label:'DEV ONLY'` with it, placed **before** `:41` `if (String(mode||'') !== 'crash') return AVAILABLE;`.

**Why no adapter avoids it:** `:41` reports every unknown id as publicly available, so the moment the router alias exists `raid` would be launchable on the shipped build. `tools/smoke-rally-availability.mjs:13-21` only enumerates the six production modes, so this branch breaks nothing.

### A.4 `src/app/rallyApp.js` — **TO DO (7 additive edits, all in one commit)**

**(a) Lazy loader — new function beside `loadCatastropheDevelopment` (insert after `:99`).**
Mirror `:77-99` exactly: module-level `let raidDevelopmentPromise = null;`, a `<link rel="stylesheet" href="./src/racing/raid/raid.css" data-raid-development="true">` whose `load` event is awaited, `Promise.all([stylesheet, import('../racing/raid/raidMode.js')])`, memoized. **The dynamic specifier string must be exactly `'../racing/raid/raidMode.js'`** — it is asserted literally in A.5 and matched by regex at `tools/smoke-raid-isolation.mjs:186-190`.

**(b) Registration — inside the existing `try` at `:567`, ahead of the crash branch at `:568-571`:**
```
if (mode === 'raid') { const raid = await loadRaidDevelopment(); registerDevelopmentRacingMode('raid', raid); }
```
**Why no adapter:** `enterRacing` throws at `src/racing/index.js:2628` when `_raidModeApi` is null, and this is the only place in the shell that runs before `enterRacing`.

**(c) Availability plumbing — `:541-551`.** Both calls currently pass only `development: !!this.route.catastropheDevelopment` (`:543`, `:547`). Add `raidDevelopment: !!this.route.raidDevelopment,` to **both** option objects. Without this, A.3's gate never sees its flag and every raid launch is rejected with the "not finished" toast.

**(d) Autostart — `:285-290`.** Add a raid branch **before** the draw branch:
```
if (this.route.mode === 'raid') void this.startMode({ courseId: this.route.stage || '', options: { mode: 'raid', playerAvatarId: readRallySettings().lastDriver, cameraMode: readRallySettings().camera } });
else if (this.route.mode === 'draw') ... (unchanged)
```
**Why no adapter:** `this.menu.launchRequest()` (`src/app/rallyMenu.js:580`) has no raid branch and its fallthrough at `:659-666` returns crash-shaped options. `rallyMenu.js` is frozen. Bypassing `launchRequest()` for raid is the only in-seam path.

**(e) Menu isolation — `:494-497`.** Change `route: this.route,` to a copy with `mode` nulled for raid, e.g. `route: this.route.mode === 'raid' ? { ...this.route, mode: null } : this.route,`.
**Why this is mandatory, not cosmetic:** `RallyMenu`'s constructor assigns `this.selectedMode = requestedMode` unguarded (`rallyMenu.js:215-217` only special-cases `'crash'`), `mount()` ends with `this.render()` (`:287`), `render()` calls `renderMode()` (`:341`), which does `const data = MODE_DATA[this.selectedMode]` (`:342`) then `data.art` (`:346`). With `selectedMode === 'raid'` and no `MODE_DATA.raid` (`:52`), **boot throws a TypeError before the menu paints**. `MODE_DATA` lives in a frozen file, so nulling the mode on the menu's copy is the only fix inside the seam list. Everything downstream stays safe: `selectMode()` already rejects unknown ids (`rallyMenu.js:311-312`), so `handleRoute` (`rallyApp.js:526`) is a no-op for raid, and `exitToMenu` (`:747-754`) writes `this.menu.selectedMode` (never `'raid'`) while `routeUrl` called with neither dev flag preserves `?dev=1`.

**(f) Leak-counter regex — `:116`.** Widen to `/^kaki-(rally|trials|dunes|catastrophe|raid)-/`.
**Why no adapter:** `sessionRootCount` (`:114-118`) feeds `getDiagnostics().sessionRoots` (`:1063`, `:1088`), which is the assertion in `tools/benchmark-rally-transitions.mjs:307` and the browser matrix's post-exit wait. A raid root named `kaki-raid-*` would make those assertions pass **vacuously while raid leaks its entire scene graph** — the exact failure Wave 1 exists to detect. (The alternative — naming the root `kaki-rally-raid-*` — is rejected: it collides with the frozen dune raid root at `duneMode.js:878` in every diagnostic.)

**(g) Loader copy — `:560-565` (optional, cosmetic).** Extend the two ternaries with a raid case (`'Loading Kaki Rally Raid'` / `'Seeding the desert corridor and staging the first sectors…'`). Nothing asserts this; skip if you want the seam minimal.

**Explicitly NOT edited in `rallyApp.js`:** `:605` `setCameraFromSession(...)` and `:618` `touchControls.show(mode)` stay untouched — both degrade to safe no-ops for raid (see D and F.7).

### A.5 `tools/smoke-standalone-boundaries.mjs` — **TO DO (must land with A.4)**

Replace the single-string equality at `:63-68` with a two-member allowlist:
```
const ALLOWED_LAZY_IMPORTS = new Set([
  'src/app/rallyApp.js:../racing/crash/crashMode.js',
  'src/app/rallyApp.js:../racing/raid/raidMode.js',
]);
```
assert `ALLOWED_LAZY_IMPORTS.has(key)` with the same failure message. **Keep it an exact-string Set — never a regex** — the strictness is the whole point of the guard. In the same file add, inside the existing `for (const file of graphPaths)` loop at `:78-81`, beside the crash line at `:80`:
```
assert.doesNotMatch(file, /^src\/racing\/raid\//, 'normal startup statically imports the isolated Raid mode');
```
**Why no adapter avoids it:** the walker is a source-text scan of the production graph from `src/main.js`; the assertion is unconditional for every relative dynamic import found.

### A.6 `package.json` — **TO DO**

- `:11` `test:racing`: append `&& node tools/smoke-raid-route.mjs && node tools/smoke-raid-surface-field.mjs && node tools/smoke-raid-sector-seams.mjs && node tools/smoke-raid-terrain-window.mjs && node tools/smoke-raid-vehicle-physics.mjs && node tools/smoke-raid-stage-run.mjs`. **Do not remove `smoke-rally-raid-expansion.mjs`** — asserted at `tools/smoke-raid-isolation.mjs:205`.
- `:14` `test:standalone`: append `&& node tools/smoke-raid-isolation.mjs && node tools/smoke-raid-lifecycle.mjs`. **Do not remove `smoke-catastrophe-isolation.mjs`** — asserted at `tools/smoke-raid-isolation.mjs:206`.
- `:19-20` add `"test:browser:raid": "node tools/smoke-rally-browser-matrix.mjs --scope raid"` — **only after** `runRaid()` and `--scope` validation exist (see E.6), otherwise it is a green no-op.
- Constraints: `tools/smoke-catastrophe-isolation.mjs:19-21` asserts `test:racing` matches none of `/catastrophe|racing:crash|smoke-racing-crash/i` and `test:catastrophe` matches `/smoke-racing-crash/`; `tools/smoke-raid-isolation.mjs:207` asserts `scripts.test` contains no `--skip|--no-`. All proposed names comply.

### A.7 Seams explicitly **NOT** touched in Waves 0–3 (state this in the commit message)

- **`src/app/rallySave.js`** — not needed. Raid writes **no** localStorage in Waves 0–3 (progress store deferred to Wave 4), and `lastMode:'raid'` can never be persisted because `writeRallySettings` is only reached from `rallyMenu.selectMode()`, which rejects raid at `:311-312`. Deferring this keeps `LEGACY_SAVE_KEYS` byte-identical and `tools/smoke-rally-save.mjs:28-36` green with no `RAID_SAVE_KEYS` gymnastics.
- **`src/racing/racingManifest.js`** — not needed. Waves 0–3 ship **no** files under `assets/`; terrain and vehicle are procedural. This avoids the `docs/ASSET_INVENTORY.json` staleness failure in `test:assets` entirely.
- **`index.html`** — raid CSS is injected lazily by A.4(a); `tools/smoke-raid-isolation.mjs:92` asserts `index.html` never references `racing/raid/`.

---

## B. EXACT MODULE PLAN — `src/racing/raid/`

### B.0 ALREADY EXISTS — **DO NOT REWRITE** (sibling-agent output, all three smokes green)

| file | exports you will consume |
|---|---|
| `raidSurfaceField.js` (398 L) | `clamp`, `smoothstep`, `mix`, `RAID_MAX_LATTICE`, `gradientNoise`, `fbm`, `ridgedNoise`, `RAID_SURFACES`, `RAID_SURFACE_ORDER`, `raidSurfaceIndex`, `raidSurfaceByIndex`, `RAID_ZONES`, `RAID_ZONE_ORDER`, `getRaidZone`, `blendRaidZones`, `zoneReliefBound`, `raidZoneHeightParts`, `raidZoneHeight`, `raidRelief`, `raidTerrainHeight`, `raidTerrainNormal`, `classifyRaidSurface`, `raidLooseness` |
| `raidRouteRuntime.js` (427 L) | `RAID_ROUTE_SPACING` (8 m), `RAID_ROUTE_WINDOW_METRES` (900 m), `buildRaidRoute`, `raidRouteZoneAt`, `buildRaidRouteIndex`, `mixAngle`, `nearestRaidRouteSample(index, x, z, { hintMeters, windowMetres })`, `raidRouteLateral`, `raidCorridorHalfWidth` |
| `raidStageBlueprints.js` (181 L) | `RAID_STAGES`, `RAID_STAGE_ORDER` (`['wadi-of-whiskers']`), `getRaidStage`, `validateRaidStage` — stage 1 measures **12.41 km / 1553 samples**, seed `0x57414449`, `windAngle 0.62`, deliberate fold-backs |
| `raidSectorGenerator.js` (326 L) | `RAID_SECTOR_METRES` (512), `RAID_SECTOR_CELLS` (256), `RAID_SECTOR_VERTS` (257), `RAID_CELL_METRES` (2), `RAID_ZONE_LATTICE_METRES` (32), `raidSectorOfWorld`, `raidSectorKey`, `generateRaidSector({ sectorX, sectorZ, route, index, cells })`, `raidSectorBytes()` (396 294 B), `serializeRaidRoute` |

Measured on this machine: `generateRaidSector` = **75 ms** (sector 0,0) / **53 ms** (far sector) at 256 cells, **20.7 ms** at 128 cells. Budget from these numbers, not from guesses.

### B.1 WAVE 1 — empty mode lifecycle (4 new files)

**`src/racing/raid/raidMode.js`** — the *only* module the shell imports; the complete `_raidModeApi` surface. No terrain, no vehicle in Wave 1: an empty root, a ground plane placeholder, a HUD, a camera.
```
export async function enterRaidMode(scene, options = {})   // must set state.racing = session and RETURN it
export function tickRaidMode(dt, elapsedDt = dt)
export function updateRaidCamera(dt, options = {})          // -> { camera, effects, frame, mode } | null
export function resizeRaidMode(aspect)
export function getRaidCameraTarget()                        // -> THREE.Vector3 (module-level, reused)
export function getRaidCameraConfig()                        // -> { chromatic, bloom, heatHaze }
export function getRaidSnapshot()                            // -> object | null
export function restartRaidMode()
export function exitRaidMode(scene, session = null)
```
Contract notes: `enterRaidMode` may be async (`rallyApp.js:584` wraps in `Promise.resolve`), **must** assign `state.racing = session` before resolving or `rallyApp.js:599-601` throws; must re-check `session.disposed` after every `await`; must call its own `exitRaidMode` from its `catch` before rethrowing. `resizeRaidMode(aspect)` takes **one aspect number** (`src/racing/index.js:3456`), not `(width,height)`.

**`src/racing/raid/raidSession.js`** — session shape, owned-resource registry, teardown.
```
export function createRaidSession({ scene, stage, route, routeIndex, options })
export function disposeRaidSession(session)
export function raidSessionSnapshot(session)
```
Session must carry: `raceMode: 'raid'`, `root` (THREE.Group named **`kaki-raid-<stageId>`**), `owned: { geometries:Set, materials:Set, textures:Set }`, `hud`, `camera`, `assetLease` (Wave 1: `{ ready: Promise.resolve() }` or the driver lease only), `cameraFx: { shake:0, roll:0, punch:0, phase:0 }`, `physicsTimeMs`, `disposed`. Teardown order copied from the dune reference (`duneMode.js:1240-1271`): set `disposed = true` **first**, then each step in its own `try/catch` — listeners → camera dispose → audio stop → HUD root remove → hero restore → VFX → GPU resources → root removal → owned Sets → asset lease release → `state.racing = null` → QA hook delete (ownership-checked).

**`src/racing/raid/raidHud.js`** — DOM only.
```
export function mountRaidHud(session)      // root.className = 'kkr-hud kkr-raid-hud', appended to #ui-root
export function updateRaidHud(session, dt)
export function disposeRaidHud(hud)
```
Must include a `.kkr-camera-cycle` button and a `.kkr-camera-list` with `data-camera-mode` entries **only if** you later reuse `RacingCameraInput`; Wave 1–3 raid owns its camera, so these are optional.

**`src/racing/raid/raid.css`** — every selector prefixed `.kkr-raid-`. See F.4 for why `kkr-` and not `kkx-`.

**`src/racing/raid/raidQaBridge.js`**
```
export function installRaidQaBridge(session)   // window.__kkRaid = { snapshot, skipIntro, warpToMeters, finish, terrain }
export function removeRaidQaBridge(session)    // delete only if window.__kkRaid?._session === session
```
**Do not touch `window.__kkRacing`** — `duneMode.js:1269-1271` refuses to clean up if another owner replaced it, which would be an observable regression in a frozen mode.

### B.2 WAVE 2 — streamed terrain vertical slice + one vehicle (7 new files)

**`raidSectorWorker.js`** — module worker entry, modelled on `duneHeightWorker.js:1-21` (transferables + `{error}` channel), but persistent and multi-request: `{ requestId, sectorX, sectorZ, route }` in, `{ requestId, payload }` out with `[heights.buffer, surface.buffer, looseness.buffer]` transferred. **It may import only `raidSectorGenerator.js` / `raidRouteRuntime.js` / `raidSurfaceField.js`** — never a stage table, never anything from `dunes/`.

**`raidTerrainStream.js`** — residency policy + worker pool + payload LRU.
```
export function createRaidTerrainStream({ route, routeIndex, quality = 'medium', workerCount = 2, worker = true })
// -> { update(worldX, worldZ), whenSectorReady(sx, sz), getPayload(sx, sz), snapshot(), dispose() }
```
Same headless bypass as dunes: gate the worker on `worker !== false && typeof Worker === 'function' && typeof document !== 'undefined'` (`duneHeightfield.js:576`) so Node smokes exercise the synchronous path with zero stubs. `dispose()` must `terminate()` every worker and drop every payload.

**`raidTerrainWindow.js`** — **the terrain authority** (see C).
```
export function createRaidTerrainWindow({ stream, sectorsPerSide = 5 })
// -> { originSectorX, originSectorZ, verts, cellMetres, minX, minZ,
//      heights: Float32Array, surface: Uint8Array, looseness: Uint8Array,
//      version, recenter(worldX, worldZ), blitSector(payload), snapshot(), dispose() }
```
**`raidHeightSampler.js`** — CPU query facade over the window, duck-typed to the shape the vehicle layer needs.
```
export function createRaidHeightSampler(window)
// -> { contains(x,z,margin=0), gridX(x), gridZ(z), heightAt(x,z), normalAt(x,z,target),
//      slopeAt(x,z), surfaceAt(x,z,target), findSafeRecoveryPose(pose, meters, route, target) }
```
`surfaceAt` must fill `{ baseHeight, height, normal, slope, compaction, looseness, surface, surfaceGrip, surfaceDrag }` (the field set `stepKart`'s contact object and the Raid wheel layer consume).

**`raidTerrainTexture.js`** — the GPU side of the window; a single `DataTexture` per channel whose `image.data` **aliases** the window's typed arrays (zero copy, the `duneMaterial.js:50-57` trick), `ClampToEdgeWrapping`, `LinearFilter` (height) / `NearestFilter` (surface, looseness), `generateMipmaps=false`, `flipY=false`. `markRaidTerrainTextureDirty(textures)` sets `needsUpdate` after a recenter/blit.
```
export function createRaidTerrainTextures(window)
export function updateRaidTerrainTextures(textures, window)   // version-gated; returns boolean
export function disposeRaidTerrainTextures(textures)
```
**`raidClipmap.js`** — fixed-topology nested rings, shared vertex buffers, `y = 0` in the buffer (displacement is GPU-side), `frustumCulled = false`.
```
export function buildRaidClipmap({ window, textures, quality = 'medium', palette })
// -> { root, levels, triangleCount, update(focusX, focusZ, time), snapshot(), dispose() }
```
Copy exactly two ideas from `duneClipmap.js`: snap each level's centre to the **next coarser level's** lattice (`duneClipmap.js:196-198` — independent per-level snapping cracks the seams), and shader-trim underlays around the finer level's snapped centre. Do **not** copy the unshared-per-quad vertex layout (`duneClipmap.js:22-32`, 4× vertex cost).

**`raidTerrainMaterial.js`** — TSL `MeshStandardNodeMaterial`. Uniforms: `uWindowMin` (vec2), `uWindowTexel` (vec2), `uWindowVerts` (float), `uSectorOrigin`/`uCenter` (vec2, for local-space trig), `uCellSize`, `uOuterRadius`, `uInnerRadius`, `uInnerCenter`. **UV is texel-centre** (see C.2). `three/webgpu` and `three/tsl` resolve only through the `index.html` importmap, so this file is unreachable from Node — assert on it with `readFile` + regex (the sanctioned pattern at `tools/smoke-dune-deformation.mjs:13-17, 116-121`).

**`raidVehicle.js`** — one vehicle for the slice, built on the shared arcade integrator.
```
export const RAID_VEHICLES            // one entry for Wave 2 ('prototype'-class raid car)
export function getRaidVehicleProfile(id)
export function createRaidVehicleState({ vehicleId, x, y, z, yaw })
export class RaidVehicleRuntime { constructor({ vehicleId, quality }) }
export function sampleRaidVehicleContact(kart, sampler, runtime)
export function stepRaidVehicle(kart, controls, sampler, runtime, dt)
export function getRaidVehicleTelemetry(runtime)
```
The contact object must preserve the dune dual-role trick or `stepKart` never re-queries ground after moving the kart (`physics.js:737-746`): `runtime.wheelSupport = runtime`, `runtime.groundNormal = runtime.normal`, and a `sampleGround(x,z)` closure (pattern: `duneVehiclePhysics.js:227-232`). Keep `runtime.onRoad = true` for all drivable raid surfaces and express softness only through `surfaceGrip`/`surfaceDrag` (`duneVehiclePhysics.js:340-343` records the regression: off-road marking kills powerslides and caps speed at `tuning.offroadSpeed`).

**`raidCamera.js`** — Raid-owned camera controller; **does not** publish `session.cameraManager` (see D).
```
export function createRaidCamera({ host, hudRoot, profile })
// -> { update(dt, { aspect, reducedMotion, snap, paused }), resize(aspect), setPaused(p),
//      getConfig(), getTarget(), getSnapshot(), activeCamera, dispose() }
```
Built from `RacingCameraProfile` + `ChaseCameraRig` + `cameraRigMath` (all importable, see D). Must return `frame.effects` on every frame and set `frame.far` explicitly each frame.

### B.3 WAVE 3 MINIMUM — meter-native run, waypoints, finish (1 new file)

**`raidStageRun.js`**
```
export function createRaidStageRun(route, { waypointSpacingMeters, assist = 'rally' })
export function stepRaidStageRun(run, kart, dt)     // returns run.events (reused array — do not retain)
export function finishRaidStageRun(run)
export function raidStageRunSnapshot(run)
```
State: `meters` (official progress, monotonic non-decreasing), `hintMeters` (fed back into `nearestRaidRouteSample`), `lateral`, `offCorridorTime`, `nextWaypoint`, `validatedWaypoints`, `penaltySeconds`, `elapsed`, `finished`, `finishTime`. Rules to carry forward from the frozen experiment (reimplemented, not imported): dual-gate waypoint validation (progress window **and** euclidean distance, radius scaled by assist), flat missed-waypoint penalty, penalties floored and rounded so no run accrues unbounded time. Finish requires `meters >= totalMeters - epsilon` **and** all waypoints validated-or-penalised — never a bare distance check, because the stage folds back on itself (`raidStageBlueprints.js:44-52`).

**Deferred out of Waves 0–3 (do not create):** progress/records localStorage, ghosts, roadbook UI, deformation, service/expedition chaining, touch pad, additional stages, additional vehicles, asset manifest entries.

---

## C. TERRAIN AUTHORITY DECISION

**Decision:** global-coordinate noise from a single stage seed → CPU sector payloads (`generateRaidSector`) → blitted into **one moving CPU window buffer that is the sole authority** → that same buffer aliased as a `DataTexture` → sampled by a fixed-topology clipmap.

### C.1 What is already guaranteed (document it; do not re-derive)

- **Global world-space noise, no tile-local coordinate.** `raidSurfaceField.js` evaluates every octave on absolute world metres; `smoke-raid-surface-field.mjs` proves purity in position/seed/zone-params and asserts bit-identical shared edges out to 24 km, plus int32-safe lattice indices to 123 km.
- **Seam equality by construction.** `generateRaidSector` evaluates a one-vertex **apron** outside each sector so boundary slope is a central difference across the true neighbour, and classification therefore agrees from both sides. `smoke-raid-sector-seams.mjs` checks 2–3 assert every shared edge is bit-identical in **every** channel (height, surface, looseness), near and far from the origin; check 4 asserts order-independence (worker-pool safety).
- **Integer sector geometry.** 512 m / 256 cells / 2 m — power-of-two aligned, boundary vertices shared, world coordinates of every vertex are exact integers.

### C.2 Physics/render agreement — the two rules that must be enforced in new code

1. **One array, two consumers.** The window buffer is the *only* height store. `raidHeightSampler.heightAt` bilinearly interpolates `window.heights`; `raidTerrainTextures` wraps that same `Float32Array` as the `DataTexture` `image.data` with **no copy**. There is no second bake, so there is nothing to drift.
2. **Texel-centre UV on both sides.** GPU: `uv = (worldXZ - uWindowMin) / uWindowTexel * (1/uWindowVerts)` expressed so that grid index *i* maps to `(i + 0.5) / verts`. CPU: bilinear on the same index space, `i = (world - minX) / cellMetres`. **Do not copy the dune convention** (`duneMaterial.js:178-181` uses `(world-minX)/worldSize` while `duneHeightfield.js:432-434` uses `(world-minX)/cellX`); the resulting half-texel shift is ~0 at field centre and maximal at edges, and in a windowed world every vertex is near an edge.
3. **Prove it, don't assert it tautologically.** `duneClipmapRenderedHeightAt` (`duneClipmap.js:262-266`) is a CPU proxy that cannot fail, and `duneMode.js:1301-1359` publishes `authorityShared: true` by construction. Raid's parity test (E.4) reimplements the *shader's* UV arithmetic in plain JS from the same uniform values and asserts agreement with `heightAt` to **< 1 mm** at interior points **and all four window edges**, plus a `readFile` + regex assertion that `raidTerrainMaterial.js` actually contains the texel-centre expression.

### C.3 Window sizing and residency (concrete numbers)

- **5×5 sectors = 2560 m**, `verts = 5*256+1 = 1281`. Memory: heights 6.26 MiB (F32) + surface 1.57 MiB + looseness 1.57 MiB ≈ **9.4 MiB CPU**, texture ≈ 6.26 MiB GPU. A 3×3 window is only 2.26 MiB but leaves the nearest window edge 512 m from the player, inside the racing camera's 800 m far plane — use 5×5 for Wave 2 and let the far ring fade into fog.
- **Blit is exact:** each 257×257 payload copies into the window at offset `(sectorIndex * 256)`; the duplicated shared edge column/row is bit-identical (proven by the seam smoke), so the window is seam-free by construction and the payload can be **released immediately after the blit** — only the window is long-lived.
- **Recenter on sector step:** when `raidSectorOfWorld(kart.x, kart.z)` changes, shift the window by one sector row/column (memmove the retained region, request the 5 new sectors). At 40 m/s a 512 m sector lasts ~13 s; 5 sectors × ~53–75 ms ≈ **265–375 ms of worker time** with a ~12 s lead. Two workers is ample; do the recenter **outside** the fixed-step loop (dunes calls `deformation.recenter` up to 4× per frame at `duneVehiclePhysics.js:614` — do not copy that).
- **Explicit disposal.** `DuneHeightfield`/`DuneDeformationField` have no `dispose()`; Raid's window and stream must have one, and `exitRaidMode` must call it, or every stage entry leaks ~9 MiB.

### C.4 Precision at 12+ km

- **No floating-origin rebase in Waves 0–3.** Float32 vertex spacing at 12.4 km is ~1 mm — adequate. A rebase would also trip `racingCameraManager.js:362-364`, which force-resets the camera on any >24 m single-frame position jump.
- **All clipmap vertex positions are level-local**; world placement is `mesh.position` plus a `uCenter`/`uSectorOrigin` uniform.
- **No trig on raw world coordinates in the shader.** `duneMaterial.js:242-248` computes `sin(worldX*…)` in float32; at 24 km the argument reaches ~6.5e4 rad where float32 spacing is ~0.008 rad and GPU range reduction degrades. Subtract the window origin (or player origin) before any `sin`/`cos`. JS-side noise is safe — `raidSurfaceField.js` is proven to 123 km.
- **No global min/max baked into the material.** `duneMaterial.js:249-253` bakes `heightfield.minimum/maximum` at construction; a streamed world has none. Drive height tone from the window's per-update min/max uniform or from zone parameters.

---

## D. REUSE LIST

### D.1 Import unchanged (path → symbols) — all verified importable and not forbidden by `tools/smoke-raid-isolation.mjs:41` (`/(?:dunes|drift|crash)\//`)

| path | symbols |
|---|---|
| `src/racing/physics.js` | `stepKart`, `createKartState`, `clamp`, `normalizeAngle`, `RACE_TUNING`, `formatRaceTime` — the shared arcade integrator (yaw-rate steering, drivetrain, drift/boost, air control, the whole landing solve). Reimplementing it is how a mode's handling silently diverges. |
| `src/racing/monsterVehiclePhysics.js` | `MONSTER_WHEEL_LAYOUT`, `initializeMonsterVehiclePhysics` (imports only `clamp`) — allocates `kart.wheelContacts` for a 4-wheel kart |
| `src/racing/monsterScoring.js` | `MONSTER_TUNING`, `getMonsterVehicleProfile` — the base tuning table dune profiles spread; note `stuntLanding: true` changes landing grading |
| `src/racing/racingSteering.js` | `mapRacingSteerInput`, `RACING_STEER_SIGN` — **mandatory**, or steering is mirrored |
| `src/core/input.js` (via `src/input.js`) | read `state.input.moveVec`, `isDashPressed`, `isHandbrakePressed`, `consumeJump`, `setTouchDriveState`. **Never call `sampleInput()`** — the shell calls it once per frame at `rallyApp.js:907` |
| `src/core/gamepad.js` (via `src/gamepad.js`) | `gamepadState.buttons` / `.justPressed` for raid-only bindings |
| `src/core/audio.js` (via `src/audio.js`) | `updateRacingAudio`, `stopRacingAudio`, `playRacingImpact`, `sfx.*`. Pass `environment: 'dunes'` (a real `AMBIENT_AUDIO` key) — `raceMode:'raid'` silently falls back to the forest bed |
| `src/core/assets.js` (via `src/assets.js`) | `createDriverAssetLease`, `createDriverMesh`, `prepareRallyClone`, `disposeCachedGLTF`, `getAssetDiagnostics` |
| `src/racing/racingAssets.js` | `createRallyAssetLease({ assetIds, rendererService })`, `getRallyAssetCacheSnapshot` — pass explicit `assetIds` so `rallyAssetIds()` is never entered (Wave 2 slice: driver lease only) |
| `src/racing/racingVehicles.js` | `buildRallyRaidVehicle(options)` (3 finished silhouettes), `updateVehicleWheelPresentation`, `updateVehicleAnimation`. Pass your own `owned:{geometries,materials,textures}` Sets. **Rename the returned `root` from `kaki-rally-raid-<id>`** so it is not counted as a session root by `rallyApp.js:116` |
| `src/racing/cameras/racingCameraProfile.js` | the `RacingCameraProfile` **class** (construct a raid profile anywhere — `cameraSessionBinding.js:19-23` is the precedent). `RACING_CAMERA_PROFILES` is `Object.freeze`d: assigning a `raid` key throws |
| `src/racing/cameras/chaseCameraRig.js`, `driverFpvCameraRig.js`, `cameraRigMath.js`, `chaseCameraCollision.js`, `trackVisionAnalyzer.js`, `racingVisionController.js`, `cameraModes.js` | import as-is; all are profile-driven and mode-agnostic |
| `src/rendering/rendererAccess.js` | `getRendererService`, `getActiveRendererCapabilities` — the dependency-light way to reach the renderer |
| `src/rendering/rendererCapabilities.js` | `detectRendererBackend`, `getRendererCapabilities` — probe float-texture filterability before committing to `FloatType` + `LinearFilter` |
| `src/rendering/textureUpload.js` | `requestTextureUploadIfReady`, `cloneTextureForDeferredUpload` |
| `src/core/navigation.js` | `navigateToMenu(reason)`, `restartRallySession()` — never touch the app object directly |
| `src/state.js` / `src/core/runtimeState.js` | `state` (read/write `state.racing` only; adding a top-level field is forbidden by `smoke-standalone-boundaries.mjs:106-111`) |

**Deliberate non-reuse: `attachRacingCameraManager` (`cameraSessionBinding.js:178`) and `session.cameraManager`.** Calling it would (a) silently select the `rally` profile (`racingCameraProfile.js:288`), (b) bind the entire streamed root to the chase-collision full-scene retraverse every 1.25 s (`chaseCameraCollision.js:338-339`), (c) leave `groundHeightAt` null → an O(n) scan over 1553 samples per resolve. **And**, decisively, publishing `session.cameraManager` re-enables `rallyApp.js:605` `setCameraFromSession(... { save:true })`, which would write the **shared** `kks_racing_camera_mode_v1` key from raid and change what every frozen mode restores. Omitting it makes `setRacingCameraMode`/`cycleRacingCamera`/`resetRacingCamera` (`index.js:3462+`) harmless optional-chained no-ops, and `rallyApp.js:777` `setPaused` is optional-chained too. Raid owns its camera and its pause.

### D.2 Must be reimplemented Raid-side (frozen sources — read as reference, import nothing)

| dune source (frozen) | what to reimplement, and why |
|---|---|
| `dunes/duneVehiclePhysics.js:279-320, 380-441` | four-wheel sinkage/rolling-resistance/suspension equations. The file evaluates a frozen `PROFILE_CACHE` at import time and pulls in `duneDeformation.js` + `duneRallyRaid.js`. Port the equations, retune the constants (crest thresholds, anti-backflip, sinkage bounds are dune-mass/dune-scale specific) |
| `dunes/duneDeformation.js:524-619` (`DuneSurfaceField`) | the query facade — reimplement as `raidHeightSampler.js` with the same field set |
| `dunes/duneClipmap.js`, `dunes/duneMaterial.js` | clipmap + TSL material. `buildDuneClipmap` hard-requires one global array and one baked texture; `createDuneMaterial` bakes `uWorldMin/uWorldSize/min/max` into the node graph at construction |
| `dunes/duneRallyRaid.js` (roadbook, penalties, assists, progress) | reimplement in `raidStageRun.js`. It is frozen, imported by four other files, and writes `kks_rally_raid_progress_v1` which is **frozen dune save data** |
| `dunes/duneRace.js`, `dunes/duneRecords.js` | checkpoint model is short-course; ghost capacity is 2400 samples @10 Hz = **240 s**, useless for a 9–14 minute stage |
| `dunes/duneEnvironment.js` | only the player-following sky/sun trick (`:429-433`) is worth copying; its scatter pass is a single full-world loop and `skyRadius` is clamped ≤620 m |
| `src/app/rallyTouchControls.js` | frozen **and not a seam**: `DRIVE_MODES` (`:3`) cannot gain `'raid'`, so `show('raid')` is a silent no-op. Waves 0–3 are keyboard/gamepad/pointer only; a raid-owned pad calling `setTouchDriveState` is deferred |
| `src/app/developerOverlay.js` | no contribution seam. Feed the generic fields it already renders: `session.physicsTimeMs` (read at `rallyApp.js:954`), `session.racingVfx = {puffs,debris,skids}` with `.life` (`rallyApp.js:162-175`), and a snapshot with `raceMode/speed/telemetry.*` |

---

## E. TEST PLAN

Idiom: plain Node ESM, `import assert from 'node:assert/strict'`, no framework, one trailing `console.log('… passed')`. Two accepted shapes — bare-assert (`tools/smoke-dune-records.mjs`) and the `pass()` counter used by the existing raid smokes (`tools/smoke-raid-isolation.mjs:29-33`). **Match the raid files: use `pass()`.** Never name a new file `smoke-rally-raid-*` (that is the frozen dunes experiment's test, `tools/smoke-rally-raid-expansion.mjs`).

### E.1 Existing — wire, do not edit
`tools/smoke-raid-isolation.mjs` (RED until A.4+A.5), `smoke-raid-route.mjs`, `smoke-raid-surface-field.mjs`, `smoke-raid-sector-seams.mjs` — all four exist and none is in `package.json`. Wiring is in A.6.

### E.2 `tools/smoke-raid-lifecycle.mjs` (Wave 1, **source-regex only** — `raidMode.js` imports THREE and cannot execute in Node; `node_modules/` has only playwright)
Assert over `src/racing/raid/*.js` source text, modelled on `tools/smoke-racing-lifecycle.mjs`:
1. `raidMode.js` exports exactly the nine API names in B.1 and nothing else shell-facing.
2. `enterRaidMode` assigns `state.racing = session` and returns it; re-checks `session.disposed` after each `await`; its `catch` calls `exitRaidMode` before rethrowing.
3. `exitRaidMode` sets `disposed = true` before any teardown, removes the HUD root, terminates the terrain stream, disposes the camera, releases the asset lease, ends with `state.racing = null`.
4. Every `addEventListener` in `src/racing/raid/**` has a matching `removeEventListener`.
5. No `setAnimationLoop` / `requestAnimationFrame` anywhere under `src/racing/raid/`.
6. The scene root name matches `/^kaki-raid-/` **and** `src/app/rallyApp.js:116`'s regex includes `raid` (this is the anti-vacuous-leak guard).
7. `window.__kkRacing` is never assigned by raid; `window.__kkRaid` deletion is ownership-checked.

### E.3 `tools/smoke-raid-terrain-window.mjs` (Wave 2, executable — window + sampler are THREE-free)
1. Blit a 3×3 (and 5×5) block of real payloads; assert every window value equals the corresponding `generateRaidSector` value **exactly** (bit-identical), including duplicated shared edges.
2. `recenter()` by one sector in each of the four directions; assert the retained region is unchanged and the newly exposed region matches freshly generated payloads.
3. `heightAt` at every vertex equals the stored value to 0 (exact) and is C0-continuous across a sector boundary inside the window.
4. `contains()` false outside the window; `heightAt` outside must **not** silently clamp (dune does — `duneHeightfield.js:377-391`); assert it returns `NaN` or throws by design and that the vehicle layer never queries outside.
5. Determinism: build the window from two different recenter paths to the same origin → identical arrays.
6. Memory budget: assert `heights.byteLength + surface + looseness` for the shipped `sectorsPerSide` is under a stated ceiling (≈10 MiB at 5×5).
7. `dispose()` drops references (assert `snapshot().resident === 0`).

### E.4 `tools/smoke-raid-terrain-parity.mjs` (Wave 2, **the anti-tautology test**)
1. Reimplement the shader UV arithmetic in plain JS from the same uniform values; assert `|shaderHeight - sampler.heightAt| < 1e-3 m` at ≥200 interior points **and** along all four window edges and the four corners.
2. `readFile` + regex on `raidTerrainMaterial.js`: contains the texel-centre expression (`+ 0.5`), contains `uWindowMin`/`uWindowTexel`, and **contains no `sin(`/`cos(` applied to an un-offset world coordinate**.
3. `readFile` + regex on `raidClipmap.js`: `frustumCulled = false`, levels snap to the next coarser level's spacing, `dispose()` disposes geometries + materials + textures.

### E.5 `tools/smoke-raid-vehicle-physics.mjs` (Wave 2) and `tools/smoke-raid-stage-run.mjs` (Wave 3)
Physics — copy the `makeRig` / `run(rig, controls, seconds, hz)` harness from `tools/smoke-dune-vehicle-physics.mjs:16-45`: launch speed, drivetrain telemetry consistency, sinkage bounds, steering-sign convention, braking through neutral into reverse, packed-vs-loose surface differentiation, stability-assist bounds, and **60 Hz vs 120 Hz determinism drift** (the single most valuable assertion for a new fixed-step integrator).
Stage run — drive the real route: monotonic progress to `route.totalMeters`; standing beside a later fold-back leg cannot advance windowed progress; every waypoint validates in order; a deliberately skipped waypoint produces exactly one bounded penalty; off-corridor travel manufactures no progress; `finishRaidStageRun` is idempotent; finish requires both distance and waypoint completion.

### E.6 Browser matrix (evidence, not CI)
`npm test` does **not** run playwright. Add to `tools/smoke-rally-browser-matrix.mjs`: a `runRaid(page, backend, evidence)` beside `runDunes`; a scope guard `requestedScope === 'all' || requestedScope === 'raid'` at ~`:2258`; a raid readiness branch in **both** `startMode` (`:648-672`) and `startModeFromMenu` (`:673-722`) that waits on `window.__kkRaid.snapshot().terrain.windowReady` (the shared `assetLease.ready` says nothing about streamed sectors); `--scope` validation mirroring the `--backend` assert at `:15`; and a `unexpectedRaidRequests` bucket mirroring `:103-109` (`/\/src\/racing\/raid\//` when the raid scope was not requested) added to the final `assert.deepEqual` list at `:2588`. Screenshots land automatically in `docs/qa/targeted/webgl-raid/`.
**Wave 1 acceptance evidence:** add a raid entry to `tools/benchmark-rally-transitions.mjs` `baseSequence` (`:38-49`) and run `npm run qa:performance` — 50 enter/exit cycles must hold `sceneObjects`, `hudRoots === 0`, `sessionRoots === 0`, `|Δ domNodes| ≤ 3`, and renderer `textures`/`geometries`/`renderTargets` at baseline (`:305-311`). Add a raid-specific assertion that `window.__kkRaid` is `undefined` and worker count is 0 after exit — no existing counter covers workers.

---

## F. TOP 10 RISKS

1. **Boundary-test deadlock (certain, blocks everything).** `smoke-raid-isolation.mjs:186-190` requires the lazy import; `smoke-standalone-boundaries.mjs:63-68` forbids it. *Mitigation:* A.4 and A.5 in one commit; run `npm run test:standalone && node tools/smoke-raid-isolation.mjs` as a pair before pushing. Never widen the allowlist to a regex.
2. **`?mode=raid&dev=1` crashes boot via the frozen menu (certain without A.4e).** `rallyMenu.js:342/346` dereferences `MODE_DATA['raid'].art` during `mount()`→`render()`. *Mitigation:* A.4(e) nulls the mode on the menu's route copy; A.4(d) autostarts raid without ever calling `launchRequest()`. Add a Node assertion in `smoke-raid-lifecycle.mjs` that `rallyApp.js` contains the nulling expression, so a future refactor cannot silently reintroduce the crash.
3. **Vacuous leak QA (high; silent).** A root named `kaki-raid-*` is invisible to `rallyApp.js:114-118`, so `benchmark-rally-transitions.mjs:307` and the matrix exit-wait pass while raid leaks. *Mitigation:* A.4(f) regex widening **plus** E.2 check 6 pinning it. Verify by deliberately leaking once and confirming the benchmark goes red.
4. **Concurrent agents rewriting the same files (high, happening now).** Three seam files changed during this brief's preparation; `src/racing/raid/` gained two modules in 15 minutes. *Mitigation:* `git status` + `git diff` before every edit; never overwrite `raidSurfaceField.js` / `raidRouteRuntime.js` / `raidStageBlueprints.js` / `raidSectorGenerator.js`; announce the file you are about to touch in `#errors` per the workspace protocol; re-run `node tools/generate-raid-frozen-boundaries.mjs --check` after each commit (currently green at 150 files).
5. **Loader hangs for the whole stage (high).** `rallyApp.js:593` awaits `session.assetLease.ready` **before** `hideLoader()`. If sector streaming joins that promise, the branded card stays up for 12.4 km. *Mitigation:* `assetLease.ready` covers first-visible assets only (driver mesh, vehicle materials); the terrain stream exposes a separate `whenSectorReady` that `enterRaidMode` awaits only for the **start sector plus its 8 neighbours**, with the remaining 16 of the 5×5 window filled after the first frame.
6. **Streaming stalls the frame (high).** 53–75 ms per sector measured in Node; a sector step needs 5. *Mitigation:* persistent 2-worker pool with request ids and cancellation on dispose (never the one-shot `duneHeightfield.js:578` pattern); recenter hoisted **out** of the 1/120 s substep loop; a smoke assertion on single-sector generation time; the worker imports only the three pure raid modules so the lazy-load boundary holds.
7. **No touch controls (medium, product-visible).** `rallyTouchControls.js` is frozen and not a seam; `show('raid')` hides the pad. *Mitigation:* declare Waves 0–3 desktop-only in the commit message and the HUD; defer a raid-owned pad (calling the exported `setTouchDriveState`) to Wave 4.
8. **Shared camera-preference pollution (medium, cross-mode regression).** Publishing `session.cameraManager` re-arms `rallyApp.js:605` `setCameraFromSession(..., {save:true})` → writes `kks_racing_camera_mode_v1`. *Mitigation:* raid never sets `session.cameraManager`; `raidCamera` persists nothing; add an assertion in `smoke-raid-lifecycle.mjs` that no file under `src/racing/raid/` contains `kks_racing_camera_mode_v1` or `cameraManager =`.
9. **Namespace collision with the frozen dune "Rally Raid" (medium, save-data corrupting).** `duneRallyRaid.js` owns `kks_rally_raid_progress_v1`, `kks_dune_records_v1` entries keyed `raid-prologue:prototype`, the `rallyRaid` snapshot field, the `'rally-raid'` runtime mode string, the `kaki-rally-raid-*` root prefix, the `kkd-roadbook*` CSS family, and the vehicle ids `buggy`/`prototype`/`truck`. *Mitigation:* Waves 0–3 write **no** storage at all; snapshot field is `raid`, not `rallyRaid`; root is `kaki-raid-*`; if `buildRallyRaidVehicle` is reused, rename its root. `smoke-raid-isolation.mjs` checks 5–7 already enforce the asset/storage/CSS halves.
10. **GPU/CPU height divergence discovered late (medium, expensive).** The dune stack cannot detect it by construction. *Mitigation:* the single-array authority (C.2 rule 1) makes divergence structurally impossible for *values*; the texel-centre rule plus E.4 catches it for *positions*. Land E.4 in the same commit as `raidTerrainMaterial.js`, not after.

*Also carry, below the top 10:* `RedFormat`+`FloatType`+`LinearFilter` is not universally filterable on WebGL 2 without `OES_texture_float_linear` (raid boots on WebGL by default, `rendererSettings.js:117-119`) — probe with `getRendererCapabilities({includeFeatures:true})` and keep a half-float fallback; `dynamicResolutionScale` is service-global and survives `recreate()`, so if raid ever lowers it, save/restore exactly as monster does (`index.js:2797-2801` / `:3910-3911`).

---

## G. WHAT THE RECON COULD NOT ANSWER — verify by reading code during implementation

1. **The exact post-diff line numbers of every seam.** Three seam files were edited while this brief was written. Re-derive `src/racing/index.js` dispatch lines and `rallyApp.js` line numbers with `grep -n` before citing them in commit messages. Everything in section A was verified against the tree at the time of writing and will drift.
2. **Whether `setRacingCameraMode` / `cycleRacingCamera` / `resetRacingCamera` are truly branch-free for raid.** Recon lists them as unconditional `state.racing?.cameraManager?.…` calls; the live file has since been edited. Read `src/racing/index.js:3460-3475` and confirm raid without a `cameraManager` is a no-op, not a throw.
3. **Whether `getRacingCameraTarget()` (`index.js:3440`) is consumed anywhere per-frame** — recon never traced its callers. If a frozen consumer dereferences the returned `Vector3` unguarded, `getRaidCameraTarget()` must return a module-level reused vector (never `null`).
4. **`RallyMenu.availability()` (`rallyMenu.js:290-293`) hardcodes `'crash'`.** Confirm it cannot be reached with `'raid'` after A.4(e); if the menu ever renders a raid card in a later wave, that call site becomes a frozen-file blocker requiring an eighth seam.
5. **`raidSectorGenerator.js`'s `looseness`/`surface` continuity across sector seams for *non-boundary-adjacent* sampling.** The seam smoke asserts shared **vertices** are identical; it does not assert the bilinear interpolation of `looseness` is continuous across the seam in the window. Read `generateRaidSector`'s pass-two and confirm no grid-index-derived hash exists (the dune trap at `duneHeightfield.js:334` `hash32(column,row,…)`); if one does, re-express it in world coordinates and extend the smoke.
6. **`raidRouteRuntime.nearestRaidRouteSample` return shape.** The brief specifies `hintMeters` feedback but the exact fields of the returned `best` object (`x`, `z`, `yaw`, `meters`, `distance`, `index`?) must be read from `projectOntoSegment` before `raidStageRun.js` is written.
7. **Whether `state.hero.mesh` detach/restore is required for raid.** Dunes detaches the shared hero (`duneMode.js:1057`) and restores it on exit. There is exactly one hero mesh; confirm whether `buildRallyRaidVehicle`'s `driver` slot needs it, and if so replicate `saveHero`/`restoreHero` exactly or the menu hero disappears after a raid session.
8. **Whether `session.assetLease` may be `{ ready: Promise.resolve() }`.** `rallyApp.js:593` does `await session?.assetLease?.ready` — a plain object is fine, but confirm no other shell code calls `assetLease.release()` unconditionally on exit.
9. **`tools/smoke-rally-browser-matrix.mjs:227` hardcodes `V1.1.1`** and `smoke-standalone-boundaries.mjs:96` asserts `RALLY_VERSION === package.json version`. If Waves 0–3 bump the version, three files change in lockstep.
10. **Whether the sibling-written `docs/raid/FROZEN_BOUNDARIES.json` is the accepted contract or a proposal.** It is untracked and was generated at 20:09 today. Confirm with the parent before treating `src/app/rallyMenu.js`'s frozen status as final — the entire "no menu presence in Waves 0–3" decision rests on it.