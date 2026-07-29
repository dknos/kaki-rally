# Kaki Rally definitive browser rebuild QA

Production-code candidate: `fc84c36518651c8d80fc708f7398db2536046fd4`

Validation date: 2026-07-29

The production navigation now contains exactly six pillars: Off-Road GP,
Drift Attack, Kaki Stock Cup, Draw Your Track, Monster Smash, and Kaki Trials.
Kaki Catastrophe is preserved outside production and is excluded from the
acceptance matrix.

## Automated release gates

`npm test` passes the renderer, racing, Workshop, Monster, Trials, persistence,
asset, and lifecycle suites. The production import walk covers 100 modules and
261 edges; the Catastrophe boundary separately checks 57 production racing
modules. The asset validator checks 70 runtime files (24.94 MiB) and 1,493
assertions; the broader inventory contains 119 files (60.96 MiB). The frozen
experiment remains available only through the separate
`npm run test:catastrophe` command.

The fresh `npm test:browser` matrix passed:

> Kaki Rally browser matrix passed: WebGL six-mode lifecycle/touch/gamepad;
> WebGPU production-mode smoke and frozen-mode gate

Both backends recorded zero page errors, console errors, bad responses,
unexpected failed requests, and frozen-mode requests. Expected aborts are
limited to in-flight decoder/model requests canceled by deliberate mode exit
or browser-context disposal.

| Production pillar | WebGL 2 | WebGPU | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- | --- | --- |
| Off-Road GP | Pass | Pass | Pass | Pass | Pass |
| Drift Attack | Pass | Pass | Pass | Pass | Pass |
| Kaki Stock Cup | Pass | Pass | Pass | Pass | Pass |
| Draw Your Track | Pass | Pass | Pass | Pass | Pass |
| Monster Smash | Pass | Pass | Pass | Pass | Pass |
| Kaki Trials | Pass | Pass | Pass | Pass | Pass |

Each production mode was entered, controlled, exercised through its central
mechanic, restarted, exited, and re-entered. WebGL additionally covers pause,
camera/input changes, records, ghosts, custom content, and detailed resource
state. WebGPU covers all six mode starts, the Trials Workshop custom route,
fallback behavior, and the frozen Catastrophe gate.

## Handling results

The handling audit used deterministic fixed-step probes. Values are not
cross-mode balance targets; they are reproducible evidence that each model now
has a distinct response.

| Probe | Before | After |
| --- | ---: | ---: |
| GP speed after 1 s | 14.108 m/s | 17.295 m/s |
| GP speed after 3 s | 24.000 m/s | 24.863 m/s |
| GP right-turn displacement | 12.647 m | 19.403 m |
| GP brake from 20 m/s | 0.617 s / 5.684 m | 0.725 s / 7.038 m |
| Drift speed after 3 s | 24.340 m/s | 27.009 m/s |
| Drift maximum slip | 0.167 rad | 0.274 rad |
| Monster speed after 3 s | 22.500 m/s | 21.704 m/s |
| Monster speed after 5 s | 22.500 m/s | 23.955 m/s |

The GP change favors stronger initial response, finer sustained steering, and
progressive braking rather than an abrupt arcade stop. Drift now carries more
speed and readable angle through breakaway/recovery. Monster's top-speed
number changes only modestly because its additional strength comes from the
torque curve, gearing, final drive, wheel torque, engine braking, obstacle
recovery, and boost—not a single maximum-speed multiplier.

Directional tests assert yaw and lateral displacement for keyboard,
controller, and touch. Right is right from chase, isometric, and FPV views;
front-wheel steering and AI use the same world convention at the input
boundary.

Monster-specific deterministic coverage verifies:

- four persistent wheel-support regions and suspension compression/velocity;
- lower/forward swept tire-arc contact at speed;
- ground, climbable edge, ramp, roof, vertical wall, and unsupported-air
  classification;
- curb and crush-car traversal without roof teleportation;
- analytical ramp lip crossing and momentum-preserving takeoff;
- bounded anti-backflip torque only for a substantially grounded frontal snag;
- staged deformation, collapse, wreck support, and restart.

Trials retains its separate 2.5D contact and pitch model. Monster and buggy
keep distinct torque, radius, pitch response, landing weight, and forgiveness.
Official/custom course, gap, turbo, checkpoint restart, vehicle switch, and
ghost persistence paths pass.

## Visual audit and corrections

The baseline defects were flat near-black road ribbons, repeated planar
terrain, primitive foreground trees, sparse Monster yards, oversized permanent
HUD panels, pasted Trials backdrop planes/void edges, weak Stock pack identity,
and a utilitarian Draw flyover.

The candidate replaces or corrects them with:

- venue-specific road color, roughness breakup, shoulders, cuts, embankments,
  drainage/edge cues, route-aware terrain, and layered distant silhouettes;
- authored instanced vegetation, deterministic road exclusion, biome color
  groups, multiple distance bands, and reduced-motion-safe density;
- compact timing-board HUDs, a venue title that clears the racing line,
  contextual controls that fade and return through Help, and 32:9/touch-safe
  layout;
- telemetry-driven dirt, gravel, smoke, skid, boost, spark, landing, and impact
  feedback with pooled resources;
- layered Trials near/mid/distant scenery with camera-safe art placement and no
  white void/backdrop edge in the captured official or custom course;
- denser Monster arenas with sculpted dirt, ramps, crush lanes, wrecks,
  barriers, crowd/stand treatment, lights, banners, service dressing, and
  atmospheric dust;
- a readable 16-car Stock pack with unique paint, numbers, badges, drivers,
  wheels, damage, smoke, and sparks at the production LOD;
- a six-shot Draw reveal that calls out outline, bridges, features, and grid,
  supports Skip, and shortens repeat viewing.

Representative evidence:

- Before/after pair:
  [earlier checked GP frame](../assets/screenshots/kaki-rally-forest-chase.png)
  versus [fresh GP frame](qa/webgl-circuit.png), and
  [earlier Monster frame](../assets/screenshots/monster-smash-arena-chase.png)
  versus [fresh Monster frame](qa/webgl-monster.png). The earlier frames retain
  the oversized permanent race boards, darker road grammar, thinner terrain,
  and prototype arena density used for the defect audit.
- [Off-Road GP chase](qa/webgl-circuit.png) and
  [driver FPV](qa/webgl-circuit-fpv.png)
- [Drift at angle](qa/webgl-drift.png)
- [Stock 16-car pack](qa/webgl-stock-pack.png)
- [Colossal five-overpass race](qa/webgl-draw-colossal-five-overpasses.png)
- [finished build flyover](qa/webgl-draw-build-flyover.png)
- [Monster arena](qa/webgl-monster.png) and
  [crush-car traversal](qa/webgl-monster-crush-traversal.png)
- [Trials layered side view](qa/webgl-trials.png) and
  [custom course](qa/webgl-trials-workshop-custom-run.png)
- [mobile Draw editor](qa/webgl-draw-editor-mobile-landscape.png),
  [32:9 Draw editor](qa/webgl-draw-editor-32x9.png), and
  [portrait orientation gate](qa/webgl-draw-editor-mobile-portrait.png)

The interface pass followed the established Kaki Motor Club visual language:
compact motorsport timing-board typography, enamel colors, marshalling motion,
and one strong venue-intro gesture instead of a collection of generic cards.

## Workshop checklist

| Workshop requirement | Result |
| --- | --- |
| Pocket through Colossal sizes and all road widths | Preserved |
| Exact 1/3/5-crossing solver and stable crossing IDs | Preserved and browser-tested |
| Manual over/under, height-aware queries, bridge validation | Preserved |
| 47-entry feature catalog, stamping, Auto Dress, history | Preserved |
| Raise/lower/smooth/hill/valley/flatten/reset elevation | Added |
| Bank left/right and bounded sanitization | Added |
| Curvature/height/grade/bank/clearance/AI/cost overlays | Added |
| Elevation-aware road, AI, checkpoints, respawns, camera | Added |
| Route-aware foundations, shoulders, terrain, dressing | Added |
| Finished flyover with Skip/repeat timing | Added |
| Mouse, touch, controller cursor, direct manipulation | Passed |
| Trials terrain/ramp/gap/checkpoint/goal/custom workflow | Passed |
| Meadow, Quarry, Crown, Construction, Snow, Neon theme data | Preserved and layered presentation applied |

Elevation and banking use a bounded sparse additive profile in the optional
KDT3 `e` extension: at most 32 stamps, elevation clamped to -4…12 m, banking
to ±0.24 rad, and radius to 0.035…0.24 normalized route length. Maximum grade,
transition, bridge, camera, AI, grid, respawn, and feature constraints share
the same sanitized samples used by visible road geometry.

## Persistence and compatibility

- Existing legacy save keys and record/ghost strings remain source of truth.
- KDT1 and KDT2 import unchanged and remain flat.
- KDT3 without elevation data decodes exactly as before; the optional bounded
  `e` field round-trips only when authored.
- Reverse flips banking direction while mirror and resampling preserve stable
  authored anchors.
- KTR1 and the isolated custom Trials library remain compatible through
  restart, vehicle change, result, export/import, and ghost playback.
- The exact multi-overpass solver and feature placement IDs remain
  deterministic.
- Import sanitizers clamp finite values, cap counts, reject corrupt checksums,
  and never silently rewrite a legacy code.

## Catastrophe isolation

Catastrophe has no production card or focus-order gap. Ordinary use does not
import `src/racing/crash/**`, request its vehicles/world assets, or load
Rapier. `npm test` excludes it; opt-in tests remain available. A localhost-only
`?dev=catastrophe` route preserves development access without adding it to
release acceptance. Future extraction dependencies and steps are recorded in
`docs/CATASTROPHE_EXTRACTION_NOTES.md`.

## Physical/browser evidence

Native Windows Chrome on the RTX 5080 passed 25 sessions at 1920×1080 High and
10 at 5120×1440 Ultra with a minimum 1% low of 59.17 FPS and zero warmed
spikes. Concrete renderer/DOM/audio resource counts returned exactly to
baseline after the final exit. Full values and limitations are in
`docs/PERFORMANCE.md`.

## Genuine remaining limitations

- Native headless Chrome was compositor-capped around 60 Hz; a visible 120 Hz
  run is still required to prove 120 FPS.
- Chromium emulation verifies responsive layout and touch plumbing, not
  physical-phone thermals, battery, safe areas, frame pacing, or tactile feel.
- Synthetic gamepads verify the standards path, not every physical controller
  mapping.
- Automated motion inspection and screenshots do not replace final human art,
  audio-mix, accessibility, or repeated-play feel approval.
- The production pack uses presentation LODs to meet its cost target; close
  replay/cinematic shots should continue reserving showcase-tier vehicles.
