# Kaki Catastrophe extraction notes

Status: frozen experiment, excluded from the Kaki Rally production menu and
default acceptance suites.

These notes preserve an extraction path without treating Catastrophe as one of
Kaki Rally's seven production pillars. Do not delete the files until a standalone
repository decision has been made.

## Entry modules

- `src/racing/crash/crashMode.js` owns enter, tick, camera, restart, snapshot,
  and exit behavior.
- `src/racing/crash/crashConfig.js` owns scenario, player, traffic, and quality
  configuration.
- `src/racing/crash/crashManifest.js` is the experiment-only asset manifest.
- `src/racing/crash/crashPhysics.js` is the sole Rapier loader and physics
  adapter.
- `src/racing/index.js` contains only an external development-mode registry and
  forwarding hooks. It does not import Catastrophe.
- `src/app/rallyApp.js` imports `crashMode.js` only after the explicit
  localhost route `?dev=catastrophe` has passed availability checks.

The optional deterministic suite is `npm run test:catastrophe`. The optional
browser route is `npm run test:browser:catastrophe`.

## Rapier dependency

Catastrophe vendors `@dimforge/rapier3d-compat` 0.19.3 as
`src/racing/crash/vendor/rapier.mjs`. `crashPhysics.js` initializes that module
on demand. No production mode, normal startup module, or standard asset
manifest imports Rapier.

For extraction, either keep the audited vendored module and its licence notice
or replace it with a pinned package dependency. Do not introduce a runtime CDN.

## Assets

Experiment-owned runtime assets:

- `assets/racing/crash/kaki-catastrophe-vehicles-v2.glb`
- `assets/racing/crash/pawprint-moonpaw-environment-v2.glb`
- `assets/racing/crash/kaki-crash-kit-v1.glb` (retained legacy source)
- `images/pawprint_interchange_03_chain_reaction.png`

Shared Kaki Rally assets currently consumed through `crashManifest.js`:

- `assets/racing/kaki-rally-decal-atlas-imagegen-v1.webp`
- `assets/textures/sky_twilight.webp`
- Kaki driver GLBs under `assets/breakroom/`

The authored vehicle/world validation is
`tools/validate-kaki-catastrophe-assets.mjs`. Re-run it after paths or model
names change.

## Persistence

The production save service preserves the legacy key
`kks_kaki_catastrophe_records_v1` during export/import/reset compatibility.
Catastrophe also uses session-local replay data that is not persisted as a
deterministic input recording.

An extracted game should retain the key or perform a one-time copy/migration.
It must not silently consume or rewrite the Rally, Draw, Monster, or Trials
keys.

## Renderer assumptions

- WebGL 2 only. The experiment has no production WebGPU acceptance.
- Three.js r185 and the existing import map.
- Perspective chase, driver FPV, isometric, and replay cameras supplied by the
  Catastrophe camera manager.
- Shared renderer access/capability helpers and one application-owned render
  loop.
- Local GLTF, DRACO, Meshopt, textures, and audio; no CDN at runtime.

The localhost development route still refuses Catastrophe on WebGPU.

## Shared services currently consumed

- `src/core/runtimeState.js` through `src/state.js`
- driver loading and cloning through `src/core/assets.js`
- shared audio entry points through `src/core/audio.js`
- input/gamepad state and the common steering mapper
- `src/core/navigation.js`
- renderer capability/access helpers
- `src/racing/racingAssets.js` for reference-counted leases
- `src/racing/racingVehicles.js` for the fallback/player vehicle presentation
- `src/racing/racingSteering.js` for directional input convention
- common Three.js and vendored loader modules

These are dependencies to replace or copy deliberately; they are not evidence
that the production modes should import Catastrophe.

## Standalone extraction sequence

1. Create a clean repository and copy `src/racing/crash/**`, the experiment
   assets, Rapier licence material, and relevant credits.
2. Add a small application shell that owns one scene, renderer, loop, input,
   audio lifecycle, and active Catastrophe session.
3. Copy or replace each shared service listed above behind Catastrophe-local
   adapters.
4. Move the shared decal, sky, driver, and vehicle dependencies into a
   standalone manifest with updated relative paths.
5. Preserve or explicitly migrate `kks_kaki_catastrophe_records_v1`.
6. Keep WebGL 2 as the initial renderer contract. Treat WebGPU as new work with
   its own physical validation.
7. Run the optional Node suites, browser lifecycle/replay run, repeated
   enter/restart/exit leak pass, asset hash/licence checks, and save migration
   test in the new repository.
8. Only after the standalone build passes should Kaki Rally remove the frozen
   source/assets and legacy save-key compatibility.
