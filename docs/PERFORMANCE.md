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

The pre-Workshop checked run recorded 413 peak draw calls and 1,528,821 peak
triangles. The final Workshop candidate records 385 peak draw calls, 1,528,665
peak triangles, 253 DOM nodes, and 721 scene objects. Its average SwiftShader
frame interval across the ten
configurations was 392.983 ms, with a worst per-mode p95 of 600 ms. Each mode
retained fixed-step
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
with the pre-Workshop checked run, the final ten-mode average moved from
412.646 to 392.983 ms (-4.8%), while the worst p95 moved from 633.3 to 600 ms
(-5.3%). These software-rendered runs are noisy comparative evidence, not a
physical-GPU FPS claim or causal attribution.

## Course Workshop bridge budget

The browser fixture used for the bridge gate is a 1,633.836 m Colossal course
with five simultaneously selected overpasses. The initial correct-but-naive
module-clone integration submitted 5,747 draws. The final runtime merges
material-compatible templates and instances repeated deck, rail, support, and
portal modules:

| Five-overpass WebGL sample | Visible | Bridges hidden | Marginal bridge cost |
| --- | ---: | ---: | ---: |
| Draw calls | 228 | 180 | 48 |
| Triangles | 6,919,733 | 5,166,829 | 1,752,904 |

The 251 visible module instances are represented by 23 instanced material
groups. There is no per-frame geometry or texture creation, and the groups
share the existing leased Workshop asset. Distance culling and catalog LOD
profiles remain quality-level controlled. The high triangle count is a
deliberately abusive fixture and still requires physical-GPU and phone
profiling before public release.

Crossing detection no longer performs a full all-pairs segment scan during
editing. It inserts sampled segments into a deterministic spatial hash,
deduplicates adjacent hits, and runs the exact conflict solver only on the
small crossing graph. An invalid scribble above 32 crossings or 128% of its
size limit uses a bounded deterministic preview until repaired.

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
203,941,028 bytes (194.49 MiB) under `assets/`. The pre-Workshop standalone
tree was approximately 72.48 MiB, with 52,284,905 bytes (49.86 MiB) under
`assets/`. The current working tree is 88,971,088 bytes (84.85 MiB), excluding
`.git/` and `node_modules/`, with 53,572,819 bytes (51.09 MiB) under `assets/`.
Most non-runtime growth is the required screenshot and concept evidence. The
focused hashed inventory is 63,917,381 bytes (60.96 MiB).

The final Workshop runtime adds:

| Asset | Encoded bytes | Notes |
| --- | ---: | --- |
| `kaki-course-workshop-kit-v1.glb` | 1,044,496 | 42 feature nodes + 8 bridge roots; Meshopt, quantized attributes, WebP texture, reusable theme materials |
| `kaki-course-feature-thumbnails-v1.webp` | 239,322 | 1792×1152 final-asset palette atlas |

The concept sheet is documentation-only (2,249,623 bytes) and is not requested
by the runtime. The Workshop GLB reports 423,663 rendered vertices from 79,634
uploaded vertices, 32 shared materials, and one embedded reused 1024-pixel
decal texture.

The final vendor pass removed 423 unused Three.js example files (7.06 MiB) and
retains 15 audited runtime/license files. This is a 75.5% repository-tree
reduction from the exact source snapshot without recompressing authored art.
