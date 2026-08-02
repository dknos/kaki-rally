# Kaki Rally world-asset baseline

**Branch base:** `c746cc7`

**Captured:** 2026-08-02

**Reference browser report:** `docs/qa/browser-matrix.json` (pre-wave runtime,
2026-07-31)

**Transition report:**
`docs/qa/world-assets/before/baseline-performance-transitions.json` (immutable
copy of 25 clean pre-wave entries; source modules were loaded before
implementation work)

## Environment and interpretation

The repeatable Linux browser path used ANGLE/SwiftShader at 1280×720/high. It
is valid for before/after resource and lifecycle comparisons, not for physical
GPU frame-rate, thermals, or final smoothness approval. The host exposes an RTX
5080 and RTX 2080, but Chromium hardware acquisition is reported separately.

The 25-entry baseline returned DOM nodes 167→167, scene objects 4→4, textures
19→19, geometries 2→2, and render targets 12→12. It recorded no page errors,
console errors, or bad responses.

## Transition baseline

| Mode / representative venue | Enter ms | Median / p95 frame ms | Draw calls | Triangles | Textures | Geometries | Scene objects | GPU estimate MiB | Leases |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Off-Road GP / Borrowed Post | 10,934 | 350.0 / 416.7 | 181 | 1,447,497 | 35 | 166 | 330 | 103.5 | 11 |
| Drift / Whisker Yard | 7,651 | 350.0 / 383.4 | 119 | 1,522,629 | 35 | 173 | 347 | 103.7 | 11 |
| Stock / Thunderbowl | 7,922 | 316.7 / 350.0 | 154 | 781,643 | 41 | 266 | 499 | 91.0 | 11 |
| Monster / Pileup Yard | 11,325 | 300.0 / 333.3 | 221 | 136,607 | 51 | 149 | 216 | 89.9 | 13 |
| Trials / Meadow | 4,403 | 183.3 / 183.4 | 186 | 172,508 | 27 | 153 | 227 | 95.9 | 13 |

The transition tool did not include Draw, Dune, or Raid in its fixed sequence.
For those modes the pre-wave full browser matrix provides the matching rendered
resource baselines below; Raid's dedicated run validates entry, driving,
responsive layouts, and three cleanup cycles but does not expose renderer
memory counters.

| Mode | Backend | Draw calls | Triangles | Textures | Geometries | GPU estimate MiB | Asset leases |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Draw Your Track | WebGPU | 297 | 2,991,423 | 36 | 188 | 152.9 | 11 |
| Dune Run | WebGL | 496 | 252,529 | 28 | 121 | 168.9 | 5 |
| Dune Run | WebGPU | 518 | 206,235 | 28 | 130 | 158.9 | 5 |
| Rally Raid | WebGL | not exposed | not exposed | not exposed | not exposed | not exposed | dedicated 3-cycle cleanup passed |

## Visual findings by production area

- Off-Road GP had strong terrain and vegetation but almost no facility-scale
  architecture; the six venues shared too much roadside language.
- Whisker Yard read as a route on an empty pad. Judging zones stacked at the
  start and the background lacked a freight/fabrication composition.
- Thunderbowl's stadium identity was six box stands, a partly buried box pylon,
  spire/capsule rails, and six clay cones.
- Draw/Workshop lost 28% of its authored triangles into anonymous root-level
  instancing nodes; cones, tires, spectators, bridge posts, braces, and hay ties
  were among the invisible parts.
- Monster had a solid destruction layer but incomplete event perimeter; the
  normal authored-model attach made eight haybales and five stunt targets
  effectively invisible.
- Dune/Raid carried good terrain and landmark spacing but no believable bivouac
  layer. The repeated mesa was stacked boxes and the near-route wreck was a
  rounded box shell.
- Trials had readable painted themes, but its dominant cutaway material was
  over-tiled and Quarry rendered outdoor cloud spheres inside its cave.

The full A/B/C/D classification and all 4 P0, 18 P1, 19 P2, and 2 P3 findings
are in `docs/WORLD_PLACEHOLDER_AUDIT.md`.

## Baseline capture set

The immutable before set is under `docs/qa/world-assets/before/`:

- `baseline-webgl-offroad-borrowed-post-1920.png`
- `baseline-webgl-whisker-yard-1920.png`
- `baseline-webgl-thunderbowl-1920.png`
- `baseline-webgl-monster-smash-1920.png`
- `baseline-webgl-big-litterbox.png`
- `baseline-webgl-rally-raid-prologue.png`
- `baseline-webgl-raid-1920.png`
- `baseline-webgl-trials-meadow-1920.png`
- `baseline-webgl-draw-track-flyover.png`
- `baseline-webgl-draw-editor-32x9.png`
- `baseline-webgl-draw-editor-mobile-landscape.png`
- `baseline-webgl-raid-mobile-landscape.png`

The legacy mode captures whose filenames end in `-1920` were produced by the
older 1280×720 matrix despite that suffix; their pixel dimensions are 1280×720.
True 1920×1080, 2560×1440, 5120×1440, and 844×390 evidence is identified by
exact dimensions in the after-set filenames. The broader original matrices
retain WebGL/WebGPU and quality-tier evidence in `docs/qa/targeted/` and
`docs/qa/browser-matrix.json`.

## Baseline anomalies

- `test:browser:webgl` completed its render captures but failed the existing
  mobile Trials Workshop canvas-height assertion (132.48 px versus 140 px).
- `test:browser:dunes` completed its captures but failed the existing responsive
  target-height assertion (40.479 px versus 44 px).
- `test:browser:raid` passed all observed entry/drive/responsive/cleanup checks,
  then the Node runner did not terminate and was stopped after evidence was
  written.

These were recorded before art integration and are not counted as regressions;
the completion run must either repair them or retain them explicitly as blocked.
