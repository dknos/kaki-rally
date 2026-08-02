# World-asset wave QA report

**Wave:** `feat/kaki-world-asset-overhaul`
**Base commit:** `c746cc7`
**Date:** 2026-08-02
**Environment:** WSL2, headless Chromium 147 (Playwright), software rendering

## Renderer availability in this environment

| Backend | Available | Notes |
| --- | --- | --- |
| WebGL 2 | yes | ANGLE / SwiftShader. This is the project's own harness default (`--use-gl=swiftshader`), not a compromise. |
| WebGPU | **yes** | ANGLE Vulkan / SwiftShader. `backend: "webgpu"`, `initialized: true` confirmed in the matrix report, real screenshots produced. |
| Hardware GPU | no | The machine has an RTX 5080 and `/dev/dxg`, but there is no `/dev/dri` and no hardware Vulkan ICD, so headless Chromium cannot reach it. Forcing `MESA_LOADER_DRIVER_OVERRIDE=d3d12` still lands on llvmpipe. |

Practical consequence: frame-time figures from this environment measure the
software rasteriser, not the target GPU. They are usable for **relative**
comparison between two runs on the same machine, and must not be quoted as
absolute performance.

Caveat worth recording: probing `navigator.gpu` on `about:blank` reports WebGPU
missing. It is only exposed on a served page. An early probe here concluded
WebGPU was unavailable on that basis and was wrong.

## Baseline results at `c746cc7` (before any wave change)

| Suite | Result |
| --- | --- |
| `npm test` | PASS |
| `npm run test:browser:webgpu` | PASS |
| `npm run test:browser:webgl` | **FAIL** (pre-existing) |

### Pre-existing failure: mobile Trials Workshop responsive layout

`npm run test:browser:webgl` fails on the untouched baseline, in
`runWorkshopResponsive`, at viewport **844 x 390** (landscape, which selects the
`@media (max-height: 430px) and (orientation: landscape)` block in
`src/racing/trialsWorkshop.css:764`).

This was verified as pre-existing by running the matrix on a separate clean
clone held at `origin/main` with no working-tree changes. The failure reproduces
with a byte-identical bounding rect, so it is deterministic rather than flaky.

Measured layout at that viewport:

| Element | Grid row | Actual height | Top | Bottom |
| --- | --- | --- | --- | --- |
| `.ktr-header` | 88px | 80.96 | 0.0 | 81.0 |
| `.ktr-workspace` | 152px | 139.84 | 81.0 | 220.8 |
| `.ktr-canvas` | (inside workspace) | **132.48** | 84.6 | 217.1 |
| `.ktr-panel` | 150px | 138.00 | 220.8 | 358.8 |

**Two assertions fail, not one.** The canvas assertion fires first and masks the
second:

1. `canvas.height >= 140` — actual **132.48**, short by 7.52px
   (`tools/smoke-rally-browser-matrix.mjs:396`).
2. `minTouchTarget >= 43.5` — actual **40.48**
   (`tools/smoke-rally-browser-matrix.mjs:400`).

`terrainTools` and `visibleTerrainTools` both pass at 12/12.

**This is fixable, not over-constrained.** The grid rows sum to exactly the
390px viewport, but every element renders shorter than its row, and the panel
bottom sits at 358.8 in a 390px viewport, leaving **31.2px of dead space** below
it. Against a required budget of header 81.0 + panel 138.0 + workspace chrome
7.4 + canvas 140 = 366.3px, there is **23.7px of slack**. Both failing
assertions can be satisfied without shrinking anything that is currently at its
minimum.

**Not fixed in this wave.** `trialsWorkshop.css` is responsive UI chrome with no
relationship to world assets, and a wave should not quietly absorb an unrelated
layout change. It is recorded here so it can be fixed deliberately. It does not
block capture generation: the harness writes `browser-matrix.json` and all
screenshots from a `finally` block, and the failure occurs late in `runWebGl`,
so mode captures are still produced.

### Non-failure: Dunes timeout

An earlier `test:browser:webgl` run failed with a 30s `page.waitForFunction`
timeout in `runDunes`. It did not recur on the clean run. It was CPU contention
from a concurrent 523MB clone and a second browser matrix, not a defect.

Operational note for this wave: browser matrices take 15 to 40 minutes under
software rendering and are sensitive to load. Run them alone, and never edit
`src/` while one is in flight — an early run here overlapped source edits and
produced captures that recorded neither the before nor the after state.

## Changes made in this wave so far

| Change | Verification |
| --- | --- |
| Drift Attack judged zones placed along their spans | `test:racing` 585 + 88 assertions; placement maths verified offline against the real layout data including a wrapping span |
| Drift zone markers follow track bank | as above; zero-valued today because Whisker Yard sets no `bankProfile` |
| Trials theme dressing built unconditionally | `test:racing` 585 + 88 assertions; z-band non-overlap verified by reading both placement paths |
| `npm test` after frozen-boundary exceptions | PASS end to end |

**Visually verified.** Targeted WebGL scope runs (`--scope drift`,
`--scope trials`) both pass and their captures confirm the fixes.

- **Drift Attack, Whisker Yard Wall Run.** The `c746cc7` baseline shows no judged-zone
  marker anywhere on the route. After the fix, markers run along the racing line and
  curve away into the distance at the judged lateral offset. Camera, car position,
  speed (112 km/h) and score (90) are unchanged between frames, so the markers are the
  only difference.
- **Kaki Trials, Mochi Meadow.** The baseline near band is bare either side of the
  racing line. After the fix it carries ground-level meadow flowers, an added
  left-hand tree, and pink mochi blossom on the right-hand tree. Subtler than the
  drift case because the meadow story's windmills sit further along the 780 m stage
  than the start frame reaches.

Still unverified: the two fixes on ultrawide, mobile landscape, and the low/high
quality tiers, and under WebGPU.

## Evidence

- Baseline WebGPU captures: `docs/qa/targeted/webgpu-all/` (clean passing run)
- Baseline WebGL captures: `docs/qa/targeted/webgl-all/` at `c746cc7`, restored
  after an overlapping run corrupted them
- `docs/qa/world-assets/before/` and `after/`: drift and trials pairs
