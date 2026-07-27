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

## Focused shared services

- `runtimeState.js` contains only scene/renderer/session, hero presentation,
  time/pause, input, options, mode, and diagnostic fields. Required contracts
  are asserted at boot.
- `input.js` and `gamepad.js` expose racing actions, pointer/touch attribution,
  Trials pitch, pause, camera switching, and Draw Track controller input.
- `audio.js` owns menu/racing engines, impacts and bus volumes. Exit cancels
  racing audio and cleanup timers.
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

## Renderer policy

The renderer layer remains backend-neutral Three.js r185. WebGL 2 is the
stable automatic default because it is the proven Monster Smash path. Explicit
`?renderer=webgpu` selection, saved preference, initialization fallback,
device-loss recovery, diagnostics, quality/DPR caps, resize, 16:9 desktop
staging, ultrawide letterboxing, and landscape-mobile handling remain intact.

Kaki Catastrophe uses vendored Rapier and is enabled as a WebGL beta only. Its
source, assets, and tests remain present under WebGPU, but the availability
matrix prevents launch and supplies a renderer-restart action.

## Persistence

The five `kks_*` keys are the source of truth. A sixth
`kaki_rally_settings_v1` key holds standalone menu preferences. Export copies
recognized strings verbatim into a versioned document. Import validates JSON,
writes a pre-import backup, and never deletes keys absent from the incoming
file.

## Boundaries

`tools/smoke-standalone-boundaries.mjs` walks production modules and import
edges. It rejects imports of Bullet Hell, weapons, enemies, spawn directors,
XP, towns, catacombs, Survivors stage gameplay, and combat UI. Asset checks
likewise reject absolute/out-of-repository paths and stale or case-mismatched
references.
