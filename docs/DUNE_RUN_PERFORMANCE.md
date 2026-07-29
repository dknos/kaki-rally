# Kaki Dune Run performance notes

Validation date: 2026-07-29

This document separates structural performance evidence from hardware claims.
The focused browser matrix currently runs headless Chromium through SwiftShader.
Its measured FPS is useful for regression comparison only and must not be
presented as physical-device performance.

## Fixed budgets

| System | Low | Medium | High | Ultra |
| --- | ---: | ---: | ---: | ---: |
| Clipmap levels | 6 | 7 | 7 | 8 |
| Cells per patch side | 48 | 64 | 80 | 96 |
| Finest spacing | 0.52 m | 0.40 m | 0.31 m | 0.24 m |
| Recent deformation | 128² | 256² | 512² | 1024² |
| Coarse deformation | 64² | 96² | 128² | 160² |
| Swept wake samples per wheel | 12 | 18 | 24 | 32 |
| Pooled dust instances | 72 | 128 | 196 | 280 |

Clipmap topology, wake lattice, dust capacity, deformation arrays, wheel
contacts, and record buffers are allocated at construction. Driving updates
typed arrays and existing textures; it does not rebuild terrain geometry or
grow particle/wake objects.

## Focused browser sample

The latest WebGL High Whiskerwind sample used:

- a deterministic 513² heightfield (`8bb06adc`) covering 704 m;
- seven clipmap levels and 90,240 terrain triangles;
- a 512² / 96 m recent deformation field plus 128² coarse field;
- four active swept-wake curtains and a 196-instance dust pool;
- 58 authored scatter placements, 25 LOD objects, 19 gates, and 38 flags;
- zero renderer/physics height divergence at the sampled truck position.

The sample recorded roughly 250k submitted triangles and about 500 draws after
the full environment and post graph were warm. Exact values vary by camera,
event, active dust, vehicle, and renderer. SwiftShader rendered this workload
well below real-time target rate; that is expected and is not a release FPS
number.

The focused WebGPU SwiftShader run initialized Three r185’s WebGPU backend,
submitted Dune frames, retained zero compilation events after warmup, and
reported no device loss. It likewise is parity evidence, not a GPU benchmark.

## Cost controls

- Height generation runs once in a worker and returns a transferable
  `Float32Array`.
- Route centerline smoothing, authored rhythm stamps, and closest-segment
  interpolation are baked during that same one-time worker job; no spline
  search runs during driving.
- Physics uses local bilinear samples and a bounded 120 Hz accumulator.
- Recent deformation uploads every dirty frame; coarse history uploads at a
  lower version cadence.
- Complete overlapping clipmap patches trade modest predictable overdraw for
  crack-free static topology. Shader trims prevent the coarse underlay from
  z-fighting the fine patch.
- Environment scatter is seeded and capped by shadow quality; repeated distant
  objects use authored LOD nodes.
- Dust and wake are fixed-capacity pools. Reduced motion shortens wake life,
  suppresses flag motion and heat refraction, and lowers active visual motion.
- Assets and node-material pipelines are leased and compiled behind the Dune
  loading card before the first playable frame.

## Hardware acceptance still required

A release performance claim requires the existing native Windows harness (or
equivalent) to add Dune sessions at 1280×720 High, 1920×1080 High, and
5120×1440 Ultra on a physical adapter. It should record median/p95/p99,
1%-low, update/physics/render submission, draw/triangle/resource peaks, entry
and restart time, and exact post-exit resource equality. A landscape phone must
separately cover thermals, battery, safe-area layout, sustained frame pacing,
and touch feel.
