# Kaki Rally performance and lifecycle evidence

Release candidate: `fc84c36518651c8d80fc708f7398db2536046fd4`

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

## Loading and release footprint

The menu does not import production mode sessions or their asset sets. Critical
mode assets, materials, effects, and audio are prewarmed behind the branded
transition before interactivity. Catastrophe assets and Rapier are absent from
the normal manifest and request log.

The focused inventory contains 119 hashed files totaling 60.96 MiB. The
machine-generated record includes path, byte size, SHA-256, source/licence
metadata, and runtime grouping. No runtime CDN request is permitted.

## Evidence files

- `docs/qa/performance-hardware-1920x1080.json` — authoritative 25-session
  native Windows/RTX 5080 run.
- `docs/qa/performance-hardware-5120x1440.json` — 32:9 Ultra physical-GPU run.
- `docs/qa/performance-hardware-1280x720.json` — native physical-adapter probe.
- `docs/qa/browser-matrix.json` — WebGL/WebGPU mode, input, Workshop, request,
  resource, and responsive-browser evidence.

## Remaining hardware gates

The benchmark does not establish physical-phone thermals, battery use,
safe-area behavior, touch feel, or sustained mobile frame pacing. The mobile
layouts and input paths passed Chromium emulation at 844×390 and 390×844, but
a landscape phone remains required. A visible 120 Hz Chrome run is also needed
to prove the aspirational 120 FPS reference target.
