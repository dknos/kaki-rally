# Changelog

All notable standalone Kaki Rally changes are recorded here.

## Unreleased

### Added

- Terra-STL-derived AAA grass for rally, drift, stock, and generated Draw
  Track courses: deterministic carpet/emergent clumps, biome palettes,
  road-safe placement, distance bands, GPU wind, reduced-motion handling, and
  quality-scaled instance budgets on both WebGL and WebGPU.
- Grass layout, renderer-contract, lifecycle, browser-matrix, and
  ten-transition leak/performance coverage.

## 1.0.0 — 2026-07-27

### Added

- Independent Kaki Rally application and repository boot path.
- Purpose-built service-park menu, records/garage, options, deep links, touch
  controls, keyboard/gamepad navigation, and landscape-mobile presentation.
- Off-Road GP, Drift Attack, Kaki Stock Cup, Draw Your Track, Monster Smash,
  and Kaki Trials as standalone production modes.
- Validated WebGL-only **Kaki Catastrophe · Beta**, including a WebGPU
  availability gate and mode-preserving **Restart in WebGL** action.
- Complete save export/import, import backup, and separately confirmed reset
  controls while retaining the five legacy keys.
- Deterministic runtime asset inventory with size and SHA-256, exact-case and
  missing-path validation, production-URL validation, standalone import
  boundaries, lifecycle checks, browser matrix, and ten-session leak benchmark.
- GitHub Pages deployment workflow.

### Preserved

- Racing fixed-step physics, handling differences, camera rigs, authored
  venues, vehicles, records, Draw Track KDT1/KDT2 compatibility, Monster Smash
  systems, Trials medals/ghosts, and the Three.js renderer abstraction from
  source commit `3711e8fc0c2c86b27911171c5394723ceb9e45aa`.

### Removed from the production graph

- Survivors campaign/title bootstrap, combat, Bullet Hell, enemies, weapons,
  XP, chests, towns, dungeons, stage exploration, and combat UI.
