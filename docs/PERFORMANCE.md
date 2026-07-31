# Kaki Rally performance and lifecycle evidence

Physical-benchmark baseline: `fc84c36518651c8d80fc708f7398db2536046fd4`

Dune expansion base: `05b6a394c26fe186e466cc02e4bca357057c2020`

The expansion was validated from that integration base for its GitHub Pages
release; the Pages workflow packages the exact revision that passes `npm test`.

Validation date: 2026-07-29

WebGL 2 remains the stable default. The authoritative desktop measurements
below ran in native Windows Chrome against the physical NVIDIA GeForce RTX
5080 through ANGLE/D3D11. The browser was started by Windows Node rather than
through WSL, and the WebGL renderer string was recorded in every report.
SwiftShader remains useful for relative rendering regressions but is not used
for the release FPS claims.

## Physical desktop results

| Viewport / quality | Sessions | Average frame | Worst p95 | Worst p99 | Minimum 1% low | Warm spikes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1280×720 High | 1 | 16.622 ms | 16.8 ms | 16.8 ms | 59.52 FPS | 0 |
| 1920×1080 High | 25 | 16.610 ms | 16.8 ms | 16.9 ms | 59.17 FPS | 0 |
| 5120×1440 Ultra | 10 | 16.620 ms | 16.8 ms | 16.9 ms | 59.17 FPS | 0 |

Chrome's native headless compositor was synchronized at approximately 60 Hz,
so these runs prove the 60 FPS floor and clean 60 Hz pacing, not the requested
120 FPS ceiling. A visible 120 Hz browser session remains a human hardware
gate.

The 25-session 1920×1080 run covered five rotations of Off-Road GP, Drift,
Stock, Monster, and Trials. Each sample contains 120 warmed animation frames.

| Mode | Runs | Average frame | Minimum 1% low | Peak draws | Peak triangles | Worst JS p99 | Peak render submit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Off-Road GP | 5 | 16.621 ms | 59.17 FPS | 181 | 1,447,497 | 6.3 ms | 3.05 ms |
| Drift Attack | 5 | 16.633 ms | 59.52 FPS | 188 | 1,245,069 | 4.7 ms | 2.00 ms |
| Kaki Stock Cup | 5 | 16.612 ms | 59.52 FPS | 457 | 857,523 | 8.7 ms | 4.97 ms |
| Monster Smash | 5 | 16.612 ms | 59.52 FPS | 252 | 212,601 | 11.3 ms | 3.36 ms |
| Kaki Trials | 5 | 16.571 ms | 59.52 FPS | 186 | 172,508 | 18.3 ms | 1.22 ms |

At 5120×1440 Ultra, the same modes remained at or above 59.17 FPS for ten
sessions. The largest sample submitted 305 draws and 1,675,071 triangles.
Stock's production pack LOD reduced its measured worst view from roughly 870
draws during the first audit to 457 at 1080p and 305 at the ultrawide sampled
view. It retains unique paints, numbers, badges, cockpits, driver colors,
animated wheels, smoke, sparks, and damage states while removing sub-pixel
pack-car trim and per-part shadow submissions.

## Lifecycle stability

The 25-session run performed 55 enter, restart, and exit transitions in one
page. Every exit returned the concrete warmed counters exactly:

| Counter | Warm baseline | Final |
| --- | ---: | ---: |
| DOM nodes | 158 | 158 |
| Scene objects | 4 | 4 |
| Session roots | 0 | 0 |
| HUD roots | 0 | 0 |
| Renderer textures | 19 | 19 |
| Renderer geometries | 2 | 2 |
| Render targets | 12 | 12 |
| Racing audio active | false | false |

Peak active counts were 259 DOM nodes, 494 scene objects, 41 renderer textures,
262 renderer geometries, 13 render targets, and an estimated 112,401,477 GPU
bytes. Resource equality, rather than JavaScript heap position, is the
lifecycle gate because V8 and Three.js retain reusable allocator capacity.

The recorded entry p95 was 9,493 ms and restart p95 was 2,300 ms. Entry time is
conservatively inflated by Windows Chrome loading development files through
the `\\wsl.localhost` bridge. It does not describe the static GitHub Pages
delivery path and is not presented as a production network timing.

## Frame-cost controls

The rebuild removes transient arrays and vectors from contact, AI, nearest
road, rank, feature, input, and collision hot paths; reuses typed candidate
buffers and event objects; pools effects; and throttles HUD text/minimap
updates. Pack cars share authored geometry/material families and use
distance-aware presentation tiers. Course bridges use material-compatible
instancing rather than one draw per module, and generated terrain/vegetation
remain quality-budgeted.

The F3 developer overlay exposes live backend, mode, FPS, frame graph, median,
p95, 1% low, JS/physics/render time, draw/triangle/object/resource counts,
estimated GPU memory, audio/DOM/pool counts, and mode-specific vehicle
telemetry. It is hidden in ordinary play.

## Workshop and five-overpass cost

The Colossal fixture remains a deliberately abusive validation course with
five simultaneously selected overpasses. The exact crossing solver, stable
IDs, material-compatible bridge instancing, height-aware road query, and
distance-aware LOD remain unchanged. The fresh browser capture verifies the
five structures in an ordinary chase view; the physical benchmark's peak
triangle count is now 1.68 million rather than the earlier multi-million
full-detail view.

Generated route terrain uses bounded segments, instanced dressing, vegetation
exclusion, and theme-aware distance layers. Elevation and banking are sampled
from a sparse bounded profile, so legacy flat tracks do not allocate or render
extra structures.

## Kaki Dune Run structural evidence

The physical RTX 5080 benchmark above predates Kaki Dune Run and therefore does
not establish a Dune FPS number. The focused Dune Chromium matrix currently
uses SwiftShader and is reported only as behavior/parity evidence.

Its WebGL High Whiskerwind sample used a deterministic 513² base heightfield,
seven fixed-topology clipmap patches (90,240 terrain triangles), a 512² recent
deformation field, a 128² coarse field, four active swept wake curtains, and a
196-instance pooled dust field. At the measured truck position the
renderer/physics height delta was zero. The same test drove keyboard, touch,
gamepad, recovery, result persistence, restart/re-entry, all four events,
custom Dune Workshop content, and direct auto-start.

The explicit WebGPU run initialized Three r185’s real WebGPU backend, submitted
the Dune scene, retained static trimmed clipmap underlays and shared height
authority, and recorded no compilation event after warmup or device loss.
These headless software-backend measurements are not substituted for the
required native physical-adapter benchmark. Full budgets and the remaining gate
are in `docs/DUNE_RUN_PERFORMANCE.md`.

## Loading and release footprint

The menu does not import production mode sessions or their asset sets. Critical
mode assets, materials, effects, and audio are prewarmed behind the branded
transition before interactivity. Catastrophe assets and Rapier are absent from
the normal manifest and request log.

The focused inventory contains 123 hashed files totaling 62.48 MiB. The
machine-generated record includes path, byte size, SHA-256, source/licence
metadata, and runtime grouping. No runtime CDN request is permitted.

## Evidence files

- `docs/qa/performance-hardware-1920x1080.json` — authoritative 25-session
  native Windows/RTX 5080 run.
- `docs/qa/performance-hardware-5120x1440.json` — 32:9 Ultra physical-GPU run.
- `docs/qa/performance-hardware-1280x720.json` — native physical-adapter probe.
- `docs/qa/browser-matrix.json` — WebGL/WebGPU mode, input, Workshop, request,
  resource, and responsive-browser evidence.
- `docs/qa/targeted/all-dunes/browser-matrix.json` — focused WebGL Dune events,
  input, lifecycle, records, Workshop, deep-link, asset, authority evidence,
  and explicit WebGPU Dune parity.
- `docs/qa/targeted/webgl-responsive/browser-matrix.json` — 844×390 Dune
  touch/overflow/target-size evidence.

## Remaining hardware gates

The benchmark does not establish physical-phone thermals, battery use,
safe-area behavior, touch feel, or sustained mobile frame pacing. The mobile
layouts and input paths passed Chromium emulation at 844×390 and 390×844, but
a landscape phone remains required. A visible 120 Hz Chrome run is also needed
to prove the aspirational 120 FPS reference target. Kaki Dune Run additionally
needs to be added to the native physical-adapter transition/performance
rotation before any Dune release FPS claim is made.

## Wave 1 local expansion probe

The focused WebGL Stock matrix ran under `/home/nemoclaw/bin/chromium` with
SwiftShader, so its low frame rate and high frame-time tail are not hardware
claims. The captured dirt opening reported 168 draw calls, 787,893 triangles,
40 textures, 13 render targets, and an estimated 154,818,743 bytes of GPU
resources; the warmed concrete restart reported 154 draw calls and 286,539
triangles. The same matrix recorded `stockVariant: dirt`, 16 cars, clay grip
near `0.796`, and clay drag near `0.241`, proving the variant and pack are
reaching runtime state. A native RTX 5080 rotation is required before these
new disciplines can be compared with the existing 60 FPS baseline.

Rally Raid currently reuses the Dune heightfield/deformation and bounded
effect pools. Its new stage assets are procedural and mode-owned; no runtime
CDN or second renderer was introduced. Add Prologue, Wadi, Saltline, and
Night Ridge to the native hardware rotation before making a release-sized
asset or frame-time claim.

## Wave 1.1 feel-repair probe

The repair adds no render target, canvas, loop, or mode asset. Drift changes
only the shared fixed-step handling profile and telemetry state; bank roll is a
single visual transform driven by existing contact samples; Dune camera FX are
a four-number object with bounded decay. `npm test` and the focused Dune
WebGL/WebGPU matrix passed. The managed browser landing capture is behavior
evidence only; it does not replace the native RTX 5080 or physical-controller
rotation above.
