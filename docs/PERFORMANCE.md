# Performance and lifecycle evidence

Measurements were made at 1280×720, DPR 1, high quality, WebGL 2, using
headless Chromium’s SwiftShader software renderer. These values are useful for
relative regression and leak detection only; they do not predict physical GPU
FPS, thermal behavior, or mobile frame pacing.

## Source parity sample

The clean source snapshot and standalone build were both measured on Pileup
Pyramid Yard with the Cyber Kaki, chase camera, and 24 frames. Geometry parity
is effectively exact:

| Build | Frame interval | Draw calls | Triangles | Estimated GPU bytes |
| --- | ---: | ---: | ---: | ---: |
| Source `3711e8f` | 305.75 ms | 256 | 212,917 | 173,173,475 |
| Standalone | 305.45 ms | 256 | 212,793 | 134,601,855 |

The source page also emitted repeated preload warnings for unrelated Bullet
Hell, weapon, pickup, and ambient assets. The standalone browser diagnostics
contain no equivalent Survivors preloads. On this software-rendered sample,
frame interval and draw submissions are effectively unchanged while the
standalone renderer reports about 22% fewer estimated GPU bytes. The 124
triangle difference is transient pooled effect state, not missing arena
geometry.

## Ten-session lifecycle benchmark

After one unmeasured renderer warmup, the benchmark enters and exits circuit,
drift, stock, two Monster arenas/events, and two Trials configurations ten
times in one page:

| Counter | Warm baseline | After 10 exits |
| --- | ---: | ---: |
| DOM nodes | 153 | 153 |
| Scene objects | 4 | 4 |
| Session roots | 0 | 0 |
| HUD roots | 0 | 0 |
| Renderer textures | 19 | 19 |
| Renderer geometries | 2 | 2 |
| Render targets | 12 | 12 |
| Racing audio active | false | false |

Across active scenes, the recorded peaks were 413 draw calls, 1,528,821
triangles, 253 DOM nodes, and 721 scene objects. The average SwiftShader frame
interval across the ten configurations was 412.646 ms, with a worst per-mode
p95 of 633.3 ms. Each mode retained fixed-step
physics and capped frame-time input from the source implementation. Draw Track
validation remains outside the racing hot path.

The complete per-transition report, renderer diagnostics, and environment
description are in `qa/performance-transitions.json`; the matching immutable
source sample is in `qa/source-monster-baseline.json`.

## Terra grass budget

At high quality, the forest circuit builds 5,020 carpet/emergent clumps in six
instanced draws. Its merged blade templates submit 412,044 triangles and use
31,080 bytes of unique geometry data plus 381,520 bytes of instance matrix and
color data. Twilight drift submits 336,336 grass triangles; the Stock Cup
safeguard and sparse cinder biome submit 113,340. Low quality was browser
validated at 1,420 clumps, two draws, and 134,280 triangles.

The optimized final grass templates reduced the initial integration from
612,472 to 412,044 forest triangles without reducing clump count. Compared
with the immediately preceding checked SwiftShader run, the ten-mode average
frame interval moved from 398.149 to 412.646 ms (+3.6%), while the worst p95
moved from 650 to 633.3 ms. These software-rendered runs are noisy comparative
evidence, not a physical-GPU FPS claim.

## Interpretation

The warmed resource counters demonstrate that enter/restart/exit/re-entry does
not accumulate cloned model textures, geometries, render targets, HUDs, scene
roots, or racing audio. Aggregate estimated GPU bytes may vary slightly as
Three.js/SwiftShader allocators retain internal pools; the concrete resource
counts are the lifecycle gate.

Physical desktop and phone profiling remains the correct gate for release
quality or a future decision to make WebGPU the default.

## Release footprint

The immutable clean source tree was 310,738,119 bytes (296.34 MiB), including
203,941,028 bytes (194.49 MiB) under `assets/`. The standalone release tree is
approximately 72.48 MiB, with 52,284,905 bytes (49.86 MiB) under `assets/`.
The focused hashed inventory is 62,633,563 bytes (59.73 MiB).

The final vendor pass removed 423 unused Three.js example files (7.06 MiB) and
retains 15 audited runtime/license files. This is a 75.5% repository-tree
reduction from the exact source snapshot without recompressing authored art.
