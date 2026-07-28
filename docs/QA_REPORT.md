# Kaki Rally release QA

Release: Kaki Course Workshop

Source baseline: `3711e8fc0c2c86b27911171c5394723ceb9e45aa`

Validation date: 2026-07-27

Destination starting commit:
`6443e1a5663a2ce55efaba4b9a9aa478aeeba5f0`

This revision is published from `main` by the tested GitHub Pages workflow.
Public URL and asset verification remain post-deployment evidence rather than
inputs to the packaged source tree.

## Deterministic suite

`npm test` covers renderer settings/backend selection, six-course definitions,
racing physics/cameras/steering, Draw Track geometry/repair/storage/KDT
compatibility, Terra-derived grass placement/render contracts, Monster
systems/arena/vehicle physics/records, Trials
physics/progression/ghosts, KTR1/custom terrain and restart persistence,
Catastrophe logic/Rapier/collision matrix/assets,
racing visuals, save export/import/reset, mode lifecycle, production import
boundaries, and the focused asset inventory.

The grass suite contributes 44 deterministic assertions for quality budgets,
all six biome palettes, terrain following, three distance bands, complete road
clearance, Draw Track self-near clearance, node-material wind, reduced-motion,
and disposal wiring.

The standalone boundary walk contains 123 production runtime modules and 326
import edges. It has no path to Survivors combat systems. The runtime asset
manifest contains 73 directly required files (28.94 MiB); the wider focused
inventory contains 119 files (60.96 MiB), including retained license/runtime
support and the reviewed decal source artifact. Exact hashes are in
`ASSET_INVENTORY.json`.

The Draw suite covers Pocket, Club, Grand, Epic, Mega, and Colossal profiles;
all road widths; 1/3/5-crossing fixtures; overlapping approaches; manual
orientation; reverse, mirror, resize, start relocation, and removed/corrupt
overrides; upper/lower nearest-road selection; feature transforms,
validation/history; KDT1/KDT2/KDT3 round trips and corruption bounds; and
deterministic Auto Dress. The Trials suite keeps all three official courses
unchanged while covering KTR1, 12 terrain tools, real gaps, shared physical
ramps, checkpoints/goals, separate vehicle jump validation, restart, vehicle
switch, ghosts, sanitization, and storage quotas.

## Browser interaction matrix

The automated matrix performs ordinary UI/input interaction rather than
calling a mode “working” when its card opens.

| Mode | WebGL | WebGPU | Emulated touch | Emulated gamepad |
| --- | --- | --- | --- | --- |
| Off-Road GP | Pass | Pass | Pass | Pass |
| Drift Attack | Pass | Pass | Pass | Pass |
| Kaki Stock Cup | Pass | Pass | Pass | Pass |
| Draw Your Track | Pass | Pass | Pass | Pass |
| Monster Smash | Pass | Pass | Pass | Pass |
| Kaki Trials | Pass | Pass | Pass | Pass |
| Kaki Catastrophe | **Pass · WebGL beta** | Correctly gated | Best effort pass | Pass |

For each normal mode the matrix enters from the menu, completes/skips only the
authored countdown boundary, drives for a meaningful interval, triggers the
central mechanic, pauses/resumes, restarts, exits, re-enters, and checks HUD,
renderer, audio, storage, network, console, and scene-root state.

Additional scenarios:

- Draw Track: mouse stroke, touch stroke, controller cursor, KDT1/KDT2/KDT3
  import and round trip, deterministic Auto Dress, placement ghost and invalid
  feedback, start-line editing, five simultaneous Colossal overpasses,
  build flyover, generated race, restart, and re-entry.
- Monster Smash: complete Smashdown round and advance; Freestyle and Free Ride;
  collapse/destruction, boost, and respawn paths.
- Trials: all three official courses; medal and B-medal unlock; saved and
  replayed personal-best ghost; KTR1 custom terrain/ramp/gap build; separate
  monster/buggy trajectory checks; checkpoint/full restart and vehicle switch
  while retaining the custom object.
- Catastrophe: live ordinary-control collision, settlement, results, replay,
  replay camera, restart, exit, and re-entry.
- 1280×720 desktop, exact 2560×720 32:9 letterboxing, 844×390 coarse-pointer
  landscape, and 390×844 orientation-gate layouts.
- Reduced-motion/high-contrast styles, 44-pixel touch targets, renderer
  recovery/state-machine tests, and forced WebGPU initialization fallback.
- Terra grass on circuit, drift, stock, and generated Draw Track sessions:
  nonempty diagnostics, six-draw ceiling, submitted geometry, TSL wind, and
  matching WebGL/WebGPU presentation.

The final machine-readable run and screenshots are under `docs/qa/`. Expected
request aborts are limited to in-flight assets canceled by deliberate mode
exit/context closure; 4xx responses, missing assets, uncaught errors, and
unexpected failed requests fail the run.

The browser five-crossing fixture is a 1,633.836 m Colossal course. It selects
five compatible overpasses with the exact global solver, produces 251 bridge
module instances in 23 instanced material groups, and reports complete
Standard/Tall/Huge deck, rail, support, and portal bounds. WebGL submitted 228
draws with the bridges visible and 180 when hidden: 48 marginal bridge draws,
not one draw per module.

Across the WebGL and WebGPU captures, inspected screenshots include the staged
Draw editor, Colossal multi-overpass race, actual ramp ghost, invalid
placement, build flyover, snow/neon material variants, Trials
terrain/place/gap/custom run, mobile Draw/Trials, 32:9, and portrait
orientation guidance.

## Compatibility notes

- Existing storage strings are left in the five legacy keys.
- KDT1 and KDT2 imports still pass and old-data-only tracks continue exporting
  as KDT2. KDT3 is used only when feature/crossing extension data exists.
  A historical KDT1 loop that violates the
  source commit’s newer race-safety validator remains importable and editable
  but may require the existing **Repair** action before racing; it is not
  silently rewritten.
- KTR1 data is stored only under `kks_rally_trials_courses_v1`; official
  `kks_rally_trials_v1` progression and records remain unchanged.
- Catastrophe does not claim WebGPU support.
- Before publication, the new Workshop GLB/WebP passed local existence,
  decode, hash, manifest, budget, and static-URL validation. The production
  asset probe is rerun against the deployed revision as a release gate.

## Human/hardware review gate

Chromium touch emulation and a synthetic standards-compliant Gamepad object
verify input plumbing, state transitions, and visible controls. They do not
prove physical-phone thermals/frame pacing or every controller/browser mapping.
Those remain explicit human hardware checks. Visual screenshots were inspected
at desktop and phone aspect ratios. Physical-device QA, human final art/gameplay
approval, and deployed Pages verification remain release gates.
