# Kaki Rally source baseline

- Source repository: https://github.com/dknos/Kaki-Survivors-2
- Exact source commit: `3711e8fc0c2c86b27911171c5394723ceb9e45aa`
- Extraction date: 2026-07-27
- Resolution method: remote `refs/heads/main` was resolved, then that exact SHA was fetched into a detached clean snapshot before any destination work began.

## Racing directories imported

- `src/racing/` in full, including Draw Your Track, Monster Smash, Kaki Trials, the camera stack, and the vendored Kaki Catastrophe/Rapier implementation
- `assets/racing/` runtime assets
- The runtime avatar set used by rally drivers
- The exact shared terrain, sky, chapter, Kaki Land, and menu-audio assets referenced by racing
- Three.js r185, its DRACO decoders, Meshopt decoder, and required addons under `vendor/three/`

## Shared runtime modules adapted

The standalone application keeps the racing engine intact and replaces the source game's broad shared services with focused Kaki Rally contracts:

- `src/state.js`: standalone scene, renderer, time, hero, input, options, diagnostics, and active-session state
- `src/config.js`: rally driver/avatar and hero presentation configuration only
- `src/assets.js`: cached GLTF loading, safe cloning, DRACO/Meshopt support, leases, disposal, and diagnostics
- `src/input.js` and `src/gamepad.js`: keyboard, pointer/touch, controller, racing actions, Trials pitch, and Draw Track controller input
- `src/audio.js`: menu music, racing engines, impacts, UI cues, volume buses, suspend/resume, and shutdown
- `src/rendering/`: the source Three.js r185 backend-neutral renderer service, WebGL fallback, diagnostics, recovery, quality management, TSL post-processing, and racing materials

## Known deviations

- The Survivors title screen, campaign bootstrap, combat runtime, stages, weapons, enemies, XP, chests, towns, dungeons, and combat UI are not part of the standalone production graph.
- Kaki Rally owns navigation through a standalone router instead of relying on a Survivors-provided `window.kkReturnToMenu`.
- Kaki Catastrophe availability is selected by renderer capability and browser validation rather than the source build's global renderer-migration deferral.
- Save export/import, focused reset controls, rally preferences, deep links, and standalone records/options screens are destination-only shell features.

## Auditing future upstream racing changes

1. Resolve and record a new immutable upstream SHA; never diff against an unrecorded moving branch.
2. Compare `src/racing/` and `assets/racing/` against this SHA with `git diff --name-status 3711e8fc0c2c86b27911171c5394723ceb9e45aa..<new-sha> -- src/racing assets/racing`.
3. Re-run `npm run assets:inventory` and inspect added, removed, renamed, or case-changed runtime URLs.
4. Audit imports leaving `src/racing/` and adapt only the focused standalone service contracts they actually require.
5. Run `npm test` plus the browser matrix before accepting the sync.
6. Record intentional behavioral or asset deviations here and in `CHANGELOG.md`.
