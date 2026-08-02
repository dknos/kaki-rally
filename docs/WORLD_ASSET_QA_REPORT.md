# Kaki Rally world-asset QA report

**Wave:** `feat/kaki-world-asset-overhaul`

**Base commit:** `c746cc7`

**Date:** 2026-08-02

**Repeatable browser environments:** WSL2, Playwright Chromium 147,
ANGLE/SwiftShader for controlled A/B; physical D3D12 AMD Radeon for the
post-wave hardware run

## Result

All production environments except the explicitly frozen Kaki Catastrophe now
lease one mode-specific world kit plus the shared race-day kit. The pass adds
facility-scale silhouettes, safety infrastructure, service areas, deterministic
ambient motion, and quality-tiered dressing without changing tracks, vehicle
physics, records, saves, checkpoints, Dune heightfields, Raid sectors, Trials
surfaces, or Monster destruction ownership.

The systematic audit recorded 4 P0, 18 P1, 19 P2, and 2 P3 findings. All P0 and
P1 findings are complete. Remaining debt is limited to the P2/P3 register in
`docs/WORLD_PLACEHOLDER_AUDIT.md`.

## Rights and acquisition gate

The approved local browser profile was used only through a local, headed
BIMobject session. Seventeen candidates were reviewed through normal product
and search pages. The authenticated format/download flow redirected to login,
so acquisition was stopped rather than bypassed. No cookie value,
authorization header, browser profile, raw BIM file, or private permission
artifact entered the repository or QA captures.

The current BIMobject User Terms do not grant the transformation, product
incorporation, or redistribution rights required by this game. All 17
candidates are therefore RED absent separate written permission. No BIMobject
geometry, texture, metadata, logo, or manufacturer branding ships. Seven
procedurally authored clean-room kits are GREEN in
`docs/ASSET_RIGHTS_LEDGER.json`; their exact builders, `.blend` sources, GLBs,
SHA-256 values, and zero-source-import declarations are recorded there.

## Production kits

| Runtime kit | Compressed bytes | LOD0 / LOD1 / LOD2 triangles | Purpose |
| --- | ---: | ---: | --- |
| Roadside v3 | 459,292 | 23,892 / 14,280 / 8,484 | GP safety, rural and roadside facilities |
| Industrial yard v1 | 424,172 | 22,292 / 16,000 / 7,364 | Whisker Yard freight/fabrication identity |
| Thunderbowl v1 | 482,036 | 28,344 / 16,324 / 6,484 | stands, press, pit, lights and catch fencing |
| Monster event v2 | 433,036 | 24,488 / 17,088 / 7,020 | arena perimeter and backstage event layer |
| Desert service v1 | 432,516 | 19,352 / 15,376 / 6,828 | bivouac, timing, utilities and recovery |
| Trials infrastructure v1 | 481,932 | 28,860 / 22,520 / 10,644 | side-readable structural obstacle dressing |
| Shared race-day v1 | 409,648 | 17,396 / 15,532 / 7,084 | reusable marshals, barriers, tents and props |

The seven GLBs total 3,122,632 bytes. Each exposes named LOD0/LOD1/LOD2 and
collision nodes; repeated families use `InstancedMesh`, hero structures use
`THREE.LOD`, distant levels terminate in bounded culling, and no GLB embeds an
image. Source builders generate compact metal/rough PBR palettes without stock
Blender materials or external texture paths.

## Runtime and lifecycle verification

`src/racing/worldLiveness.js` is the pure deterministic plan layer and
`src/racing/worldLivenessRuntime.js` is its single renderer attachment. Runtime
content is obtained only through `createRallyAssetLease`; neither creates a
loader, renderer, parallel asset cache, scene manager, or animation loop. The
renderer attachment batches same-class kit materials into session-owned
vertex-color geometry, then disposes those batches before releasing the lease.
Plans are seeded by
mode/course/theme, validate the racing-line exclusion envelope against route or
terrain height, and use bounded low/medium/high compositions. Flags, windsocks,
beacons, fans, and emissive event states share the existing update/pause path
and are stopped and disposed on mode exit or reduced-motion changes.

The 25-session transition benchmark re-enters circuit, drift, stock, Monster,
and Trials five times each and checks every return to the warmed baseline. Raid
also completed 12 enter/exit cycles with geometry +0, textures +0, and scene
nodes +0; Dune isolation requested zero Raid resources.

| Controlled 25-entry SwiftShader measurement | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Global average frame time | 304.952 ms | 321.987 ms | +5.59% |
| Circuit median | 350.0 ms | 349.9 ms | -0.03% |
| Drift median | 366.6 ms | 350.0 ms | -4.53% |
| Stock median | 333.2 ms | 366.7 ms | +10.05% |
| Monster median | 283.3 ms | 299.9 ms | +5.86% |
| Trials median | 183.3 ms | 183.4 ms | +0.05% |
| Worst p95 | 516.7 ms | 666.6 ms | +29.01% |
| Warmed spikes | 968 | 842 | -13.02% |
| Entry p95 | 11,569 ms | 14,237 ms | +23.06% |
| Restart p95 | 7,156 ms | 9,466 ms | +32.28% |
| Peak draw calls | 252 | 261 | +3.57% |
| Peak triangles | 1,522,629 | 1,560,289 | +2.47% |
| Peak estimated GPU memory | 112,401,477 B | 114,509,629 B | +1.88% |

All per-mode median changes are inside the approximately 15% acceptance
envelope. The worst software p95 is a bounded Monster outlier rather than
unbounded asset appearance: total warmed spikes fall by 126, no compilation
event repeats, and the physical-adapter p95/p99 below are both 50 ms. Runtime
batch preparation increases software-rendered entry/restart time but remains
behind the existing branded transition/countdown and does not recur as scenery
enters view.

The controlled WSL A/B path is software-rendered. Its figures are useful for
relative lifecycle and workload comparisons, not physical-GPU frame rate or
thermals. The final post-wave hardware command acquired the physical D3D12 AMD
Radeon adapter at source commit `88f4681`: 20.148 ms global average and 50 ms
worst p95/p99 at 1280×720/high across 25 entries. It returned DOM 167→167,
scene objects 4→4, textures 19→19, geometries 2→2, and render targets 12→12.
That is current
physical-GPU evidence, but it does not substitute for a discrete RTX or real
landscape-phone driving review.

## Visual review by mode and venue

- **Off-Road GP:** Borrowed Post gains a warm depot/service crossing;
  Nobody's Turn gains contradictory municipal wayfinding and a closed
  guardhouse; Kiln-Shift gains brickworks loading and vent silhouettes; Quiet
  Toll gains covered booths, emergency lighting, guardrail and drainage;
  Glass Mile gains a clean technical campus and solar canopy; Chalkline gains
  pale quarry retaining, culvert and conveyor language.
- **Drift Attack / Whisker Yard:** warehouse bays, dock ramps, pipe racks,
  floodlights, spectators and utilities turn the empty pad into one coherent
  facility. Bank-aware judged-zone chevrons now span their actual route
  intervals rather than stacking at the start.
- **Kaki Stock Cup / Thunderbowl:** the facility now layers wall, catch fence,
  stands, press box, scoreboard, pit access, lighting and service buildings.
  Concrete and clay retain one facility identity while the clay surface uses a
  continuous bank-aware inner ribbon instead of isolated cones.
- **Draw Your Track:** the existing KDT feature IDs, footprints and collisions
  are untouched. The Workshop GLB's previously anonymous roots were restored,
  and all themes receive deterministic weighted dressing and exclusions behind
  their current IDs.
- **Monster Smash:** grandstands, scoreboard, tunnel, tents, fences and
  backstage service dressing form a county-fair event perimeter. Authored
  crushable targets retain their destruction contracts; fallback shells and
  wheels remain visible through damage states.
- **Kaki Dune Run:** Whiskerwind, Sunspine, Mirage Mile and Big Litterbox now
  use distinct timing, bivouac, radio, solar, recovery and earthworks beats.
  The authored base kit also replaces the box-stack mesa and rounded-box wreck
  with eroded strata and a buckled shell.
- **Kaki Rally Raid:** desert timing, observation, waypoint and recovery
  landmarks complement rather than alter the 12.41 km route and its sectors.
- **Kaki Trials:** Meadow uses timber/painted proving-ground forms, Quarry uses
  culverts/scaffolds/retaining structures, and Crown uses polished championship
  silhouettes. The terrain material no longer over-tiles and indoor Quarry
  cloud spheres are suppressed.

## Driven capture matrix

The dedicated capture runner skipped countdowns, warped to a representative
sector where appropriate, applied throttle, waited for both asset leases, and
asserted nonzero placement plus a clean console. Its eight primary captures
cover all world systems, all three quality tiers, 1920×1080, 2560×1440, and
5120×1440:

| Capture | Quality | World placements | Instanced / LOD | Draws | Triangles |
| --- | --- | ---: | ---: | ---: | ---: |
| Borrowed Post 1920×1080 | high | 20 | 2 / 8 | 193 | 1,482,017 |
| Whisker Yard 1920×1080 | high | 32 | 2 / 19 | 151 | 1,604,629 |
| Whisker Yard 1920×1080 | low | 30 | 2 / 19 | 162 | 1,341,299 |
| Thunderbowl 2560×1440 | medium | 52 | 5 / 11 | 121 | 729,143 |
| Monster Smash 5120×1440 | high | 9 | 0 / 9 | 230 | 236,199 |
| Whiskerwind 1920×1080 | low | 9 | 1 / 6 | 350 | 141,053 |
| Trials Meadow 1920×1080 | medium | 7 | 1 / 5 | 84 | 151,493 |
| Rally Raid 1920×1080 | high | 8 | 0 / 8 | 56 | 892,335 |

Visual inspection checked racing-line and checkpoint clearance, camera
occlusion, foundations, silhouettes, material response, color space,
z-fighting, LOD/culling behavior, and venue readability. No capture shows a
world prop in the driving envelope or a missing model/material.

## Renderer, responsive, and regression matrix

| Command / evidence | Result |
| --- | --- |
| `npm test` | PASS: renderer 30, visuals 639, lifecycle 88, assets 1,693 assertions, all boundary suites |
| `npm run test:assets` | PASS: 81 runtime assets, 1,693 assertions, all seven kit/rights gates |
| `npm run test:browser:webgl` | PASS: seven-mode lifecycle, touch, gamepad, driven and responsive matrix |
| WebGL responsive scope | PASS after 844×390 Trials and Dune target repairs |
| `npm run test:browser:webgpu` | PASS: production-mode smoke and frozen Catastrophe gate |
| `npm run test:browser:dunes` | PASS: WebGL and WebGPU matrix |
| `npm run test:browser:raid` | PASS: drive, three resolutions and 12-cycle cleanup |
| `npm run qa:performance` | PASS: 25 entries / 55 transitions; global average +5.59%, all mode medians within target, zero lifecycle growth |
| `npm run qa:performance:hardware` | PASS: physical AMD Radeon D3D12, 20.148 ms average / 50 ms worst p95/p99, zero lifecycle growth |
| `npm run assets:inventory` | PASS: 134 assets, 69.57 MiB |
| `npm run test:production-assets -- http://127.0.0.1:4173/` | PASS: all 134 served URLs |

WebGPU after-captures include Dune Run and Trials Workshop. The WebGPU suite
also checks that Catastrophe remains frozen and does not request ordinary world
kits. The responsive WebGL suite exercises 5120×1440 Draw composition and
844×390 landscape mobile. The latter now retains a 140 px Trials canvas and
44 px physical target height after the intentional `.92` interface scale; Dune
touch targets meet the same physical requirement.

## Evidence paths

Immutable before evidence is in `docs/qa/world-assets/before/`; final evidence
is in `docs/qa/world-assets/after/`. The most useful pairs are:

- `before/baseline-webgl-offroad-borrowed-post-1920.png` →
  `after/webgl-offroad-borrowed-post-1920x1080-high.png`
- `before/baseline-webgl-whisker-yard-1920.png` →
  `after/webgl-whisker-yard-1920x1080-high.png`
- `before/baseline-webgl-thunderbowl-1920.png` →
  `after/webgl-thunderbowl-2560x1440-medium.png`
- `before/baseline-webgl-monster-smash-1920.png` →
  `after/webgl-monster-smash-5120x1440-high.png`
- `before/baseline-webgl-big-litterbox.png` →
  `after/webgl-dune-whiskerwind-1920x1080-low.png`
- `before/baseline-webgl-trials-meadow-1920.png` →
  `after/webgl-trials-meadow-1920x1080-medium.png`
- `before/baseline-webgl-raid-1920.png` →
  `after/webgl-rally-raid-1920x1080-high.png`

Additional exact-size evidence includes
`after/webgl-rally-raid-844x390-mobile.png`, WebGPU Dune/Trials images, and the
full browser matrices under `docs/qa/targeted/`. The legacy filenames ending in
`-1920` are 1280×720 captures; files carrying exact `1920x1080`, `2560x1440`,
`5120x1440`, or `844x390` names are the resolution-authoritative evidence.

## Remaining gates and low-priority debt

- P2/P3 polish remains: more bespoke micro-decals and crowd pose variation,
  longer-route venue-specific prop density tuning, and optional additional
  distant silhouettes.
- The physical D3D12 AMD Radeon run passed, but discrete RTX and actual
  landscape-phone thermals/touch feel remain human/device review gates even
  though the automated responsive and renderer matrices pass.
- BIMobject candidates remain RED unless a future separate written permission
  explicitly grants modification, game incorporation, public hosting,
  redistribution, and commercial use. They must not be promoted from staging
  by inference.
