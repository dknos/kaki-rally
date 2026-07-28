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

## Audio

- **Kenney** — CC0 menu/audio source material used by the original project.
- Racing engine, impact, ambient, and interface audio paths are adaptations
  from Kaki-Survivors-2’s racing implementation.

## Runtime technology

- [Three.js](https://threejs.org/) r185 — MIT License.
- [Rapier](https://github.com/dimforge/rapier.js) 0.19.3 — Apache License 2.0.
  The vendored notice is at
  `src/racing/crash/vendor/LICENSE-APACHE-2.0.txt`.
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

Thanks to the authors and communities whose work makes an open browser game
like this possible. No ownership of third-party work is claimed.
