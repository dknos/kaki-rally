# Kaki Dune Run implementation baseline

Validation date: 2026-07-29

Kaki Dune Run is a seventh first-class Kaki Rally discipline. It uses the
existing app shell, input, renderer service, camera manager, asset leases,
audio buses, pause/restart/menu lifecycle, save export/import, and Monster
truck presentation. It does not fork a second canvas, renderer, or animation
loop.

## Playable events

| Event | Format | Distinguishing state |
| --- | --- | --- |
| Whiskerwind Circuit | Two-lap seeded circuit | Rolling conditioned ribbon, warm sunset, route ghosts |
| Sunspine Ridge Run | Point-to-point ridge rally | Taller windward spine, natural crests and lee descent |
| Mirage Mile | Point-to-point record sprint | Fast hardpack shelves, heat shimmer, soft-basin shortcuts |
| The Big Litterbox | Freeride | Sandstorm, bowls and shelves, style score with manual bank |

All four events use deterministic route, terrain, weather, palette, medal, and
landmark definitions. Three existing finished Monster trucks—Mighty Meowster,
Cyber Kaki, and Tipsy Tumbler—are available with their authored bodies,
independent wheels, suspension presentation, engines, cameras, and driver.

## Terrain and deformation contract

The event worker bakes one seeded 257² or 513² `Float32Array` heightfield. That
array remains the base-height authority:

- fixed-step suspension and tire contact sample it on the CPU;
- one float texture exposes it to the TSL terrain material;
- route checkpoints, recovery, props, ghosts, and camera targets use the same
  world coordinates;
- the runtime snapshot reports the rendered/physical height delta.

Each production route also owns an authored rhythm profile. The worker smooths
the procedural centerline, adds named crest/landing/bank stamps, and
continuously interpolates the closest route segment before blending it back
into natural dunes. A narrower packed fast line sits inside the softer
corridor. This creates readable set pieces without introducing a separate road
mesh or a second physics surface.

The deformation authority is bounded and additive. A moving 96 m recent field
stores high-resolution depression and compaction; a 128² world field retains
coarser history. Four tire brushes conserve a bounded displaced berm alongside
depression, add compaction from load and slip, and never exceed -0.15 m / +0.08
m physical displacement. Both physics and rendering sample the same field.

The visible terrain is a fixed-topology, quality-scaled nested clipmap. Fine
patches overlap complete coarse underlays; TSL alpha trims each underlay around
the finer patch’s actual snapped origin. This avoids open holes when adjacent
LOD origins differ while preserving static geometry and shared height samples.

## Vehicle and feedback

The Dune controller advances at 120 Hz inside the existing bounded accumulator.
Each wheel resolves suspension load, longitudinal/lateral slip, surface
looseness, sinkage, rolling resistance, drive force, steering, and terrain
normal. Chassis pitch/roll follows four contacts; airborne throttle and
steering become pitch/lean trim. Recovery is explicit on `R`, touch Recover,
or gamepad Y, with an optional delayed automatic assist.

The isometric rig is anchored to authoritative terrain height and carries
airborne displacement. Projection changes involving isometric snap while the
truck is airborne, so a major jump cannot move above the camera or prevent an
immediate return to Chase/FPV.

Feedback is driven by that physical state:

- four fixed-lattice swept tire curtains form the sand wake;
- one pooled instanced dust field supplies low sand sheets, ballistic grains,
  landing bursts, and storm drift;
- bounded rut/berm/compaction textures displace and recolor the terrain;
- engine load, wheel RPM, slip, impacts, boost, and sand surface feed the
  existing synthesized racing audio;
- high-quality post processing adds reduced-motion-gated lower-frame heat
  refraction without distorting DOM telemetry.

The F3 overlay includes contact count, normal load, wheel slip, sinkage, maximum
rut/berm, applied brushes, and renderer/physics height delta.

## Draw Your Track integration

The appended `dune` Workshop theme preserves all legacy theme ordinals and
KDT1/KDT2/KDT3 decoding. A validated Dune build converts the existing route,
elevation/banking profile, modifiers, seed, and compatible placements into a
serializable custom Dune event. Broad elevation stamps and jump features alter
the authoritative heightfield; compatible Workshop stamps map to the authored
Dune environment kit.

No stored track is silently converted. A Dune course remains ordinary Draw
data until the user builds it, and the custom identity survives restart,
result, recovery, and ghost record keys.

## Runtime assets

- `assets/racing/dunes/kaki-dune-environment-kit-v1.glb` — reproducible
  project-bound Blender environment kit.
- `assets/racing/dunes/kaki-dune-environment-kit-v1.blend` — retained source.
- `assets/racing/dunes/kaki-dune-run-key-art-imagegen-v1.webp` — menu/loading
  key art generated for this expansion.
- `assets/racing/dunes/kaki-dune-sand-detail-imagegen-v1.webp` — tileable
  project-bound sand detail.

Paths, sizes, SHA-256 hashes, source categories, and license metadata are
recorded in `docs/ASSET_INVENTORY.json`.

## Current browser evidence

The focused matrix covers real Chromium input and lifecycle rather than source
inspection alone:

- WebGL: menu launch, keyboard, touch, gamepad, `R` recovery, wheelspin,
  deformation, wake, result/record, pause, restart, exit/re-entry, all four
  events, custom Dune Workshop build, and direct `?mode=dunes&play=1`.
- WebGPU: real initialization, Dune session, fixed terrain authority, clipmap
  trims, assets, rendering submissions, and exit.
- Responsive WebGL: 844×390 coarse pointer, zero horizontal overflow, three
  Dune action controls, ordinary drive controls, separate route/camera panels,
  and a 44 CSS-pixel minimum tested target.

The canonical dual-backend evidence lives under
`docs/qa/targeted/all-dunes/`; the separate responsive proof lives under
`docs/qa/targeted/webgl-responsive/`.

## Remaining human and hardware gates

SwiftShader browser runs prove behavior, backend compatibility, deterministic
state, and lifecycle; they do not establish physical-GPU frame rate. Dune Run
still needs a native physical-adapter benchmark, a visible high-refresh run,
landscape-phone thermal/battery/frame-pacing review, controller hardware
sampling, and human review of handling, art, audio mix, legibility, and
long-session fun.
