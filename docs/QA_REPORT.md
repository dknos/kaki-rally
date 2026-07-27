# Kaki Rally release QA

Release candidate: 1.0.0

Source baseline: `3711e8fc0c2c86b27911171c5394723ceb9e45aa`

Validation date: 2026-07-27

## Deterministic suite

`npm test` covers renderer settings/backend selection, six-course definitions,
racing physics/cameras/steering, Draw Track geometry/repair/storage/KDT
compatibility, Monster systems/arena/vehicle physics/records, Trials
physics/progression/ghosts, Catastrophe logic/Rapier/collision matrix/assets,
racing visuals, save export/import/reset, mode lifecycle, production import
boundaries, and the focused asset inventory.

The standalone boundary walk contains 109 production runtime modules and 279
import edges. It has no path to Survivors combat systems. The runtime asset
manifest contains 72 directly required files (27.95 MiB); the wider focused
inventory contains 117 files (59.73 MiB), including retained license/runtime
support and the reviewed decal source artifact. Exact hashes are in
`ASSET_INVENTORY.json`.

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

- Draw Track: mouse stroke, touch stroke, controller cursor, KDT1 import, KDT2
  import, save/reload/edit/reverse/generated race/restart/re-entry.
- Monster Smash: complete Smashdown round and advance; Freestyle and Free Ride;
  collapse/destruction, boost, and respawn paths.
- Trials: all three courses; medal and B-medal unlock; saved and replayed
  personal-best ghost; restart from checkpoint.
- Catastrophe: live ordinary-control collision, settlement, results, replay,
  replay camera, restart, exit, and re-entry.
- 1280×720 desktop, ultrawide letterboxing, and landscape phone layout.
- Renderer recovery/state-machine tests plus WebGPU initialization fallback.

The final machine-readable run and screenshots are under `docs/qa/`. Expected
request aborts are limited to in-flight assets canceled by deliberate mode
exit/context closure; 4xx responses, missing assets, uncaught errors, and
unexpected failed requests fail the run.

## Compatibility notes

- Existing storage strings are left in the five legacy keys.
- Both KDT1 and KDT2 imports pass. A historical KDT1 loop that violates the
  source commit’s newer race-safety validator remains importable and editable
  but may require the existing **Repair** action before racing; it is not
  silently rewritten.
- Catastrophe does not claim WebGPU support.

## Human/hardware review gate

Chromium touch emulation and a synthetic standards-compliant Gamepad object
verify input plumbing, state transitions, and visible controls. They do not
prove physical-phone thermals/frame pacing or every controller/browser mapping.
Those remain explicit human hardware checks. Visual screenshots were inspected
at desktop and phone aspect ratios; release automation is not an artistic
approval claim.
