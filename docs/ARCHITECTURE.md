# Standalone architecture

Kaki Rally retains the source racing engine and surrounds it with a small,
explicit lifecycle shell. `src/main.js` has one job: construct and boot
`KakiRallyApp`.

```text
index.html
  └─ src/main.js
      └─ src/app/rallyApp.js          one scene, renderer, frame loop, session owner
          ├─ rallyMenu / Router       menu, deep links, back/Escape contract
          ├─ rallySave / Options      legacy-safe persistence and preferences
          ├─ rallyTouchControls       coarse-pointer driving surface
          ├─ src/core/*               focused state/input/gamepad/audio/assets
          ├─ src/rendering/*          Three r185 WebGL/WebGPU service and recovery
          └─ src/racing/*             preserved racing implementation
```

## Ownership and lifecycle

`KakiRallyApp` owns exactly one Three.js scene, one renderer service, one
animation loop, and at most one active racing session. Transitions are
serialized. A launch:

1. exits and disposes any prior session;
2. hides menu presentation and stops menu audio;
3. enters the selected racing mode with a standalone navigation callback;
4. binds resize, restart, pause, and touch/gamepad input to that session;
5. records renderer, DOM, scene, asset, and audio diagnostics.

Exit reverses those bindings, disposes camera managers, physics worlds, HUDs,
listeners, asset leases, textures/materials/geometries, timers, and racing
audio, then restores the Kaki Rally menu. Re-entry always constructs a new
session. Racing code never relies on a Survivors-provided
`window.kkReturnToMenu`; `src/core/navigation.js` is the contract owner.

Every active mode exposes enter/tick/resize/restart/exit behavior through the
shell. Draw Track owns its editor DOM while open and transfers a generated
course into the ordinary racing lifecycle only after validation.

## Kaki Course Workshop

The Workshop extends the existing racing lifecycle rather than introducing a
second editor runtime, renderer, input layer, or physics engine.

```text
Draw UI ──> drawTrackGeometry ──> drawTrackCrossings ──> generated circuit
   │               │                       │                    │
   │               ├─ spatial hash         └─ exact conflict    ├─ road/AI/checkpoints
   │               └─ elevation/banking         graph solver    ├─ bridge height query
   └─ feature catalog ─> placement/validation ──────────────────└─ terrain/runtime
                              │
                              └─ bounded KDT3 extensions / legacy-safe KDT1/KDT2

Trials UI ──> normalized custom course ──> sampleTrialsGround ──> Trials runtime
   │                  │                          ▲
   └─ shared catalog  └─ KTR1 + custom library ──┘

Dune theme ──> validated Draw course ──> createDrawDuneEvent ──> Dune runtime
                    │                          │                     │
                    ├─ elevation/banking ──────┤                     ├─ heightfield
                    └─ compatible placements ──┴─ terrain stamps ───└─ props/records
```

`courseFeatureCatalog.js` is renderer-free and defines 47 production entries
across six categories. Forty-two are circuit compatible and 39 are Trials
compatible. Every entry binds a final authored asset node to its footprint,
placement rules, transform limits, collision/surface profile, AI behavior,
gameplay/score effect, LOD policy, and theme variants. Mode adapters consume
that data; they do not duplicate the catalog in giant switches.

Spline placements use normalized route fractions plus lateral/facing/scale
data. Trials placements use world-X plus ground offset/facing/scale data.
Sanitizers clamp every finite value, cap counts, ignore unknown catalog IDs
with warnings, and keep placement IDs stable through sample-density changes.
Mirror and reverse are explicit transformations: mirror moves the authored
anchor, while reverse changes travel direction and flips only
direction-sensitive features.

All meaningful Draw edits pass through the existing snapshot history,
including placement, transform, duplicate, delete, crossing override,
deterministic Auto Dress regeneration/removal, and start-line changes. The
touch UI keeps 44 CSS-pixel targets; controller navigation reuses the existing
workshop cursor and standard gamepad mapping.

## Multiple overpasses

`drawTrackCrossings.js` detects every sampled center-line intersection through
`CourseSpatialHash`, deduplicates neighboring segment hits, and converts both
branches to canonical route fractions and quantized authored coordinates.
Those values form stable IDs that survive resampling and support conservative
override reassociation after reshape, resize, mirror, and smoothing.

For each crossing the solver generates A-over-B and B-over-A orientations.
It rejects unsafe angle, approach, grade, clearance, start-grid, and feature
conditions, then scores straightness, crossing angle, approach margin,
start-line clearance, grade, and underpass clearance. Conflicts cover the two
orientations of one crossing, circular route-interval overlap, and bridge
support volumes. An exact deterministic maximum-weight independent set chooses
the compatible group for every raceable course. Only an already invalid
preview with more than 32 crossings or 128% of the allowed course length uses
a bounded deterministic pointer-time preview.

The generated road height, pitch, AI line, checkpoints, respawns, bridge deck,
supports, barriers, camera collision, and nearest-road selection all read the
same selected-overpass data. Height-aware queries disambiguate upper and lower
roads at the same X/Z coordinate. Overlapping elevated envelopes are rejected
with a precise explanation rather than summed into unstable height spikes.

`drawTrackElevation.js` owns a sparse additive elevation/banking profile. The
editor exposes raise, lower, smooth, hill, valley, bank-left, bank-right,
flatten, and reset operations plus curvature, height, grade, bank, clearance,
AI-risk, and cost overlays. The storage boundary limits profiles to 32 finite
stamps, -4…12 m elevation, ±0.24 rad banking, and bounded route radii.
TrackMeshBuilder samples that same sanitized profile for visible geometry,
surface queries, AI, start grid, checkpoints, respawns, camera clearance,
bridges, and generated route-aware terrain. Legacy tracks with no profile stay
flat.

## Feature surfaces and runtime

`courseFeaturePlacement.js` owns stable anchors and transformations;
`courseFeatureValidation.js` owns start/grid/checkpoint/respawn/bridge,
footprint, lane, road-width, and landing checks. The editor ghost uses the
same final GLB node as runtime and overlays footprint, direction, lane
coverage, trajectory, and exact validation text.

`courseFeatureSurfaces.js` analytically evaluates the catalog's kicker,
launch, tabletop, double, roller, step-up, and step-down profiles. Circuit
vehicle ground height, pitch, takeoff, swept contact, AI speed/line choice,
and trajectory previews share those profiles. Visible ramps are therefore not
tilted decorations over flat road collision.

`courseFeatureRuntime.js` loads one leased Workshop GLB, applies theme material
variants, groups repeated bridge parts into material-compatible
`InstancedMesh` draws, and owns trigger/collision/VFX disposal. Transform-
sensitive quantized glTF attributes are promoted to float only while flattening
runtime templates; the shipped Meshopt-compressed file remains quantized.

## Trials Workshop

The Trials flow is `TERRAIN → PLACE → CHECKPOINTS → GOALS → TEST/RUN`.
`trialsWorkshopGeometry.js` provides 12 terrain tools, actual tuning-based jump
previews, and separate monster-truck/buggy validation. Shared ramps are
catalog placements evaluated by `sampleTrialsGround()`; hills, rollers, and
landing slopes modify the normalized terrain profile; gap ranges return no
ground over exactly their visible interval.

`trialsWorkshopStorage.js` owns a separate `kks_rally_trials_courses_v1`
library and bounded KTR1 codec. It does not repurpose
`kks_rally_trials_v1`, which remains official progression, records, medals,
and ghost data. Custom track objects remain objects through entry, checkpoint
restart, full restart, vehicle change, results, and ghost playback rather than
being collapsed to an official string ID.

## Focused shared services

- `runtimeState.js` contains only scene/renderer/session, hero presentation,
  time/pause, input, options, mode, and diagnostic fields. Required contracts
  are asserted at boot.
- `input.js` and `gamepad.js` expose racing actions, pointer/touch attribution,
  Trials pitch, pause, camera switching, and Draw Track controller input.
- `audio.js` owns menu/racing engines, impacts and bus volumes. Exit cancels
  racing audio and cleanup timers. Circuit/Monster/Dune/Trials telemetry drives
  engine load/RPM layers, throttle lift, surfaces, suspension, impact, boost,
  and venue ambience rather than one global pitch control.
- `assets.js` owns cached GLTF/texture loading, DRACO, Meshopt, safe cloning,
  leases, disposal, and cache diagnostics. Racing models dispose cloned
  material textures as well as materials and geometries.
- `rallySave.js` leaves legacy records untouched and adds only preferences plus
  portable export/import.

Compatibility re-exports at `src/assets.js`, `src/audio.js`, `src/config.js`,
`src/input.js`, `src/gamepad.js`, and `src/state.js` keep the preserved racing
imports stable. They expose the focused implementations; they are not
Survivors services.

## Rally vegetation

`rallyGrassLayout.js` is a pure deterministic placement layer derived from the
Terra-STL grass research. It owns quality budgets, biome palette selection,
low-frequency patchiness, distance bands, and full sampled-road clearance.
It accepts a presentation-only terrain-height callback and never reaches
physics, course progression, or Draw Track storage.

`rallyGrass.js` builds merged curved multi-blade templates and distributes the
layout through at most six `InstancedMesh` draws. Its
`rallyGrassMaterial.js` uses a Three r185 `MeshStandardNodeMaterial` for
base-to-tip color, instance tint, warm tips, and stiff-base/floppy-tip wind on
both backends. `racingEnvironment.js` owns update and disposal. Reduced-motion
sets wind strength to zero; low through ultra display quality changes instance
budgets without changing track geometry or handling.

## Kaki Dune Run

`src/racing/dunes/duneMode.js` is a normal shell-owned session adapter. It
leases the chosen Monster truck, Dune environment kit, key art, and sand detail;
starts one worker heightfield bake; creates fixed-capacity terrain,
deformation, dust, wake, record, environment, and vehicle systems; binds the
shared camera manager and HUD; and removes every listener/resource on exit.

```text
duneEvents ──> duneHeightWorker ──> DuneHeightfield Float32 authority
                                           │
                     ┌─────────────────────┴──────────────────────┐
                     ▼                                            ▼
          DuneSurfaceField / 120 Hz wheels             TSL height DataTexture
                     │                                            │
                     └──── DuneDeformationField ──────────────────┘
                                  │
                         depression / berm / pack
                                  │
                  race + recovery + records + wake/dust/audio
```

The base event field is deterministic and CPU-readable. Its exact float array
is uploaded rather than reimplemented in a shader. A recent high-resolution
window and coarser world field add bounded deformation; both physics and TSL
sample that same state. Terrain patches have fixed topology, snapped origins,
LOD morphing, and shader-trimmed overlapping underlays. This differs
deliberately from a WebGPU-only compute/render-target design and keeps the
renderer contract intact.

`duneVehiclePhysics.js` owns four wheel contacts, suspension, load/slip,
sinkage, resistance, drive/brake forces, steering, chassis attitude, and
air-control state. `duneRace.js` owns checkpoint/lap/freeride progress and
recovery. `duneRecords.js` owns the isolated `kks_dune_records_v1` document and
bounded deterministic ghosts. `duneRoosterTail.js` and `duneDust.js` are
fixed-capacity VFX pools driven by those contacts rather than cosmetic throttle
guesses.

Draw integration does not create a second track format. The appended Dune theme
marks a compiled course with `drawDiscipline: "dunes"` and a bounded
`duneConfig`; `createDrawDuneEvent()` converts the current sanitized route,
profile, modifiers, and placements when launched. Restart preserves the
original custom course and draft.

## Renderer policy

The renderer layer remains backend-neutral Three.js r185. WebGL 2 is the
stable automatic default because it is the proven Monster Smash path. Explicit
`?renderer=webgpu` selection, saved preference, initialization fallback,
device-loss recovery, diagnostics, quality/DPR caps, resize, 16:9 desktop
staging, ultrawide letterboxing, and landscape-mobile handling remain intact.

The F3 developer overlay reads diagnostics without taking ownership of the
renderer or simulation. It includes frame distribution, update/render cost,
resource/pool/audio counts, and active vehicle telemetry.

Kaki Catastrophe and vendored Rapier are frozen outside the production graph.
The source and assets remain for later extraction, but the production menu,
normal manifest, default tests, and seven production modes cannot import or
request them. A localhost-only `?dev=catastrophe` flag dynamically imports the
frozen entry when explicitly requested. Extraction boundaries are documented
in `docs/CATASTROPHE_EXTRACTION_NOTES.md`.

## Persistence

The existing legacy `kks_*` keys remain source-of-truth data.
`kks_dune_records_v1` is an isolated Dune record/ghost document,
`kks_rally_trials_courses_v1` is isolated custom-course content, and
`kaki_rally_settings_v1` holds standalone menu preferences. Export copies
recognized strings verbatim into a versioned document. Import validates JSON,
writes a pre-import backup, and never deletes keys absent from the incoming
file.

Draw Track continues decoding KDT1 and KDT2. Tracks without KDT3-only data
still encode as KDT2, byte-compatible with the old payload layout. KDT3
appends bounded, checksummed extensions for crossing overrides, feature
placements, and optional elevation/banking. An absent elevation extension
decodes flat, and decode never silently rewrites old stored courses. Only
explicit Save replaces a library entry.

## Boundaries

`tools/smoke-standalone-boundaries.mjs` walks production modules and import
edges. It rejects imports of Bullet Hell, weapons, enemies, spawn directors,
XP, towns, catacombs, Survivors stage gameplay, combat UI, and the frozen
Catastrophe tree. `tools/smoke-catastrophe-isolation.mjs` independently checks
production racing imports, normal navigation, manifests, and request paths for
Catastrophe/Rapier leakage. Asset checks likewise reject absolute or
out-of-repository paths and stale or case-mismatched references.

## Production discipline extensions

Wave 1 keeps the existing ownership boundaries. Drift Attack data and judging
live in `src/racing/drift/driftAttack.js`; the normal racing session remains
the owner of input, fixed-step state, camera, ghost, HUD, and cleanup. Stock
banking is authored by `sampleTrackBank()` in `src/racing/tracks.js` and is
consumed by both `TrackMeshBuilder` and the racing contact sample, so the
visible oval and tire contact do not disagree. Concrete and clay are variants
of the existing Stock contract rather than a second oval engine.

Kaki Rally Raid extends the Dune ownership boundary. `duneRallyRaid.js`
contains stage, vehicle, roadbook, penalty, and expedition data; `duneMode.js`
continues to own the one Dune scene, 120 Hz vehicle loop, shared heightfield,
deformation, camera, records, Workshop lifecycle, and teardown. Procedural
raid bodies are built through the existing vehicle presentation path. The new
progress key is versioned and included in the existing export/import/reset
allow-list; KDT1/KDT2/KDT3 and prior production saves remain unchanged.

Wave 1.1 keeps the same seams for feel repairs. Drift rear-slip yaw is part of
the shared `physics.js` integrator and is enabled only by Drift handling
profiles; the normal racing session still owns input, charge/boost lifecycle,
judging, camera, and cleanup. `rallyChassisRoll()` combines bank/contact roll,
weight transfer, and steering lean so the visible car follows the same bank
authority sampled by contact physics. Dune camera FX are an object contract
owned by `duneMode.js`; `sanitizeIsometricCameraFx()` and the terrain-frame
guard provide a defensive boundary for stale or malformed payloads.
