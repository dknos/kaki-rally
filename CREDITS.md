# Kaki Rally credits

Kaki Rally code is copyright © 2026 Daniel (@dknos) and is distributed under
the [MIT License](LICENSE). It was extracted from
[Kaki-Survivors-2](https://github.com/dknos/Kaki-Survivors-2). The extraction
does not change the licenses or ownership of third-party assets.

## Art and models

- **Quaternius** — CC0 models and authored kit sources used by the original
  project.
- **Poly by Google**, distributed through
  [Poly Pizza](https://poly.pizza) — CC-BY models retained by the original
  project.
- **Poly Haven** — CC0 forest and mud PBR materials and sky/environment
  sources used by racing.
- **asian3dmodel** — the optimized arena traffic kits are modified derivatives
  of [Full Pack Traffic Bussid Part 1](https://sketchfab.com/3d-models/full-pack-traffic-bussid-part-1-d1f3739ef6fa4ebbb5c7d30a66305f60)
  and [Part 2](https://sketchfab.com/3d-models/pack-traffic-bussid-part-2-6a55c5170f6c4cafbdad2a042aeef4fd),
  licensed CC BY 4.0. Attribution and source URLs are also embedded in the GLB.
- **AGUNG.IHACKSTUFF@GMAIL.COM / agung.ihackstuff** —
  [Audience On Stage](https://sketchfab.com/3d-models/audience-on-stage-people-whatching-concert-a1cf1dd513b842e089d79bc2bc90b4ad),
  CC BY 4.0. The game uses an optimized posed derivative.
- **aleksandr.yatsenco** —
  [Drunk Monster Truck](https://sketchfab.com/3d-models/drunk-monster-truck-82b67c22d68343d399439342ab935e0a),
  CC BY 4.0. Its optimized animated derivative ships under the fictional
  player-facing name **Tipsy Tumbler**.

The Monster Smash environment kit is original project artwork generated
through the source project’s reproducible Blender tooling. Racing artwork,
arena dirt/crowd/VFX studies, and other project-bound raster assets were
created through the documented Grok Imagine / SuperHeavy, image-generation,
and Blender workflows. The decal atlas’s reviewed source artifact is retained
under `assets/source/imagegen/`; the focused runtime inventory records every
shipped derivative’s path, size, and SHA-256 hash.

### Kaki Course Workshop

The Workshop bridge, ramp, utility, hazard, destructible, scenery, challenge,
and editor-thumbnail kit is original project-bound artwork. The reproducible
Blender source is `tools/blender/build-kaki-course-workshop-kit.py`; its runtime
output is `assets/racing/workshop/kaki-course-workshop-kit-v1.glb`.

The art-direction concept at
`docs/concepts/kaki-course-workshop-kit.png` was generated with the built-in
OpenAI image-generation workflow from an orthographic neo-chibi Kaki modular
bridge/ramp-kit prompt specifying laminated wood, painted steel splice plates,
warm guardrails, rubberized ramps, Standard/Tall/Huge bridge variants, and
theme-reactive trims. It was used only as a concept reference. No generated
raster is copied into the runtime GLB or thumbnail atlas; final geometry,
materials, LOD-ready modules, origins, collisions, theme variants, and
thumbnails were authored through the Blender pipeline and inspected in-engine.

### Kaki Dune Run

The Dune environment kit is original project-bound artwork generated through
`tools/blender/build-kaki-dune-environment-kit.py`. The reproducible
`kaki-dune-environment-kit-v1.blend`, runtime GLB, and Blender preview are
retained in the repository.

Two raster assets were generated with the built-in OpenAI image-generation
workflow after the preferred Vertex-backed route was unavailable:

- the key-art prompt requested a wide, text-free neo-chibi Kaki motorsport
  scene with a cat-driven monster truck cresting warm sculpted dunes, a strong
  low three-quarter silhouette, coral/amber sand, turquoise rally accents,
  readable dust, and clear dark space for menu typography;
- the material prompt requested a square, seamless, evenly lit stylized desert
  sand surface with fine wind ripples, granular color breakup, no objects,
  horizon, text, shadows, or baked directional lighting.

The source tool outputs were
`/home/nemoclaw/.codex/generated_images/019facbc-fb32-7f33-a5e0-2538302555c8/call_aMUxLSTnJDBMf0QJjXsaCare.png`
and
`/home/nemoclaw/.codex/generated_images/019facbc-fb32-7f33-a5e0-2538302555c8/call_a9t2ynkKLOD76JHxOdPgYooZ.png`.
The optimized runtime derivatives are
`assets/racing/dunes/kaki-dune-run-key-art-imagegen-v1.webp` and
`assets/racing/dunes/kaki-dune-sand-detail-imagegen-v1.webp`.

### Definitive browser rebuild

The 2026-07-29 handling, terrain, HUD, Workshop elevation/banking, Trials
layering, Stock pack LOD, telemetry, VFX integration, and performance pass adds
no new third-party production model, texture, or audio dependency. Its new
visual structures are procedural or code-authored from the already credited
and inventoried Kaki Rally sources. No raw image-generation output is used as
an entire 3D environment. `docs/ASSET_INVENTORY.json` is the authoritative
path, byte-size, SHA-256, source, and licence record for the release candidate.

## Audio

- **Kenney** — CC0 menu/audio source material used by the original project.
- Racing engine, impact, ambient, and interface audio paths are adaptations
  from Kaki-Survivors-2’s racing implementation.

## Runtime technology

- [Three.js](https://threejs.org/) r185 — MIT License.
- [Rapier](https://github.com/dimforge/rapier.js) 0.19.3 — Apache License 2.0.
  The vendored notice is at
  `src/racing/crash/vendor/LICENSE-APACHE-2.0.txt`. Rapier is retained only by
  the frozen Kaki Catastrophe experiment and is not imported or requested
  during ordinary Kaki Rally startup or production-mode play.
- [Draco](https://github.com/google/draco) decoder — Apache License 2.0.
- [meshoptimizer](https://github.com/zeux/meshoptimizer) / Meshopt decoder —
  MIT License.

Workshop rendering and asset decisions were researched against official
Three.js r185 documentation and examples, including
[GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html),
[compressed glTF on WebGPU](https://threejs.org/examples/webgpu_loader_gltf_compressed.html),
[batched LOD/BVH](https://threejs.org/examples/webgl_batch_lod_bvh.html), and
[BloomNode](https://threejs.org/docs/pages/BloomNode.html). These were used as
implementation patterns only; no example code or assets were copied into the
project. The existing renderer abstraction, asset leases, DRACO/Meshopt loader,
instancing, and TSL post-processing remain the owners.

Kaki Dune Run’s nested terrain, deformation-channel, displaced-berm, and
fixed-lattice wake decisions were also researched against
[Noniv’s Snowflow demo](https://github.com/Noniv/snowflow_demo) at commit
`545039733b74eec742862f161990142c7ca7c7ec`. Snowflow is copyright © 2026
Maksymilian Dendura and MIT licensed. No Snowflow source, WGSL, dependency, or
asset ships in Kaki Rally; the full research boundary and preserved notice are
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Thanks to the authors and communities whose work makes an open browser game
like this possible. No ownership of third-party work is claimed.

## Local Wave 1 authored content

The Needle, Comet, and Monarch drift-car presentation, Whisker Yard venue
dressing, Kaki Thunderbowl stadium/clay dressing, and Skimmer, Atlas, and
Colossus rally-raid bodies in Wave 1 are project-authored procedural content
in the existing Three.js presentation code. No manufacturer logo, protected
livery, or downloaded vehicle/environment mesh was added. Drift judging,
Thunderbowl variants, and Raid roadbook/stage data are original gameplay data
in `src/racing/`.

Formula Drift, Bristol Motor Speedway, Dakar, and Wreckfest references were
used as broad design and engineering references supplied in the task, not as
runtime assets or copied branding. Any future external asset must be added to
the inventory and provenance tables before production use.

## Kaki Rally Raid environment kit

`assets/racing/raid/kaki-raid-environment-kit-v1.glb` and its `.blend` source are
original project geometry, authored procedurally by
`tools/blender/build-kaki-raid-environment-kit.py`. Boulders, rock slabs, a
spire, a mesa landmark, desert scrub, tussock grass, deadwood, a Kaki navigation
marker and gravel clusters. Nothing in the kit is downloaded, traced, scanned, or
derived from a third-party asset, so it carries no attribution requirement.
