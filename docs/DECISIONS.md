# Kaki Rally implementation decisions

## 2026-07-29 — Dune routes own rhythm; isometric owns altitude

Procedural macro dunes remain the world surface, but pure noise did not make
good race composition: Sunspine and Mirage had no deliberate crest sequence,
while the Litterbox centerline could reach a 0.67 grade. Each event now owns
named elevation/bank stamps over a smoothed, continuously interpolated
centerline. The packed fast line is narrower than the conditioned corridor, so
leaving it remains a meaningful soft-sand choice.

The isometric camera previously used an absolute world Y. A large jump could
place the truck above the camera and off-screen. Isometric now follows
authoritative terrain plus airborne height, and cross-projection switches snap
while airborne so Chase and FPV remain immediate recovery views.

Consequence: event identity and jump readability are deterministic and tested,
without adding a road mesh, runtime spline search, or camera-specific physics.

## 2026-07-29 — Dune terrain authority remains CPU-readable

Snowflow demonstrates a GPU-generated 4096² height texture mirrored to the CPU.
Kaki Rally instead bakes a smaller seeded heightfield in a worker and retains
the returned `Float32Array` as the base authority. The same data is uploaded to
TSL for rendering. This fits WebGL and WebGPU, deterministic Node tests,
recovery/checkpoint queries, and the existing fixed-step vehicle loop without a
GPU readback path.

Consequence: Kaki Dune Run does not claim Snowflow’s 4096² detail or one-draw
terrain. It gains deterministic cross-backend physics/render parity and a
bounded memory/runtime profile suitable for the existing game.

## 2026-07-29 — Deformation is bounded physical state, not a decal

Tires write depression, displaced berm mass, and compaction through one field.
Physics and terrain shading sample that same state. Depression/berm values are
clamped to -0.15 m / +0.08 m, and local high-resolution history rolls into a
coarse whole-world field.

Consequence: ruts can affect later wheel contacts and presentation while
remaining deterministic and bounded. The implementation intentionally avoids
two 2048² RGBA16F ping-pong render targets and per-frame full-screen simulation,
which would be a poor WebGL-default fit here.

## 2026-07-29 — Static overlapping patches replace raw centered ring holes

A centered annulus opens gaps when independently snapped inner and outer
origins differ. Kaki Dune Run keeps complete static patches, snaps levels to
their morph lattice, and shader-trims each coarser underlay around the actual
finer origin.

Consequence: there is modest overdraw and more than one terrain draw, but no
moving topology, exposed sky holes, or dependence on backend-specific shader
injection. The renderer and physics still resolve the same height.

## 2026-07-29 — WebGL remains automatic; WebGPU is a parity target

The Dune shaders use Three r185 TSL and are exercised on both renderers.
WebGL 2 remains the stable automatic choice for the full standalone game;
explicit WebGPU stays selectable and falls back through the existing renderer
service when unavailable.

Consequence: no Dune feature may require WebGPU-only compute or WGSL. Quality
tiers and bounded CPU/texture updates are part of the design, not a temporary
fallback.

## 2026-07-29 — Research is credited without importing Snowflow

The nested clipmap, persistent deformation channels, displaced berm concept,
and fixed-lattice swept wake were researched against Noniv’s Snowflow demo at
commit `545039733b74eec742862f161990142c7ca7c7ec`.

Kaki Rally does not vendor Babylon.js, Snowflow WGSL, source modules, geometry,
or assets. Its code uses Three/TSL, a CPU-readable authority, quality-scaled
patches, two-tier typed arrays, four tire curtains, and the existing Kaki
lifecycle. The research source and complete MIT notice are recorded in
`THIRD_PARTY_NOTICES.md`.
