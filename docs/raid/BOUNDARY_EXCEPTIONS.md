# Raid frozen-boundary exceptions

`tools/generate-raid-frozen-boundaries.mjs` freezes the production racing tree
so a Raid-only change cannot silently alter an existing mode. Its policy allows
a deliberate rebaseline only after every affected file records the reason, why
an adapter is insufficient, blast radius, regression evidence, and visual
evidence. This document is that per-file record; it is not permission for a
blanket rebaseline.

## Wave: `feat/kaki-world-asset-overhaul` (2026-08-02)

This is a cross-production art wave whose brief explicitly requires changes in
the shared racing, Dune, Monster, Trials, Draw, and asset-lifecycle modules while
keeping Raid's route, sector generator, heightfield, physics, saves, and
development-gated ownership intact. All exceptions below are presentation,
asset-selection, or lifecycle changes. `src/racing/raid/raidMode.js` remains the
existing documented seam and is not a frozen-file exception.

| File | Reason and why an adapter cannot solve it | Blast radius | Regression and visual evidence |
| --- | --- | --- | --- |
| `src/racing/courseFeatureRuntime.js` | Restores Workshop hierarchy-backed visuals, corrects quality-step bridge deck/rail span, and uses the existing feature IDs. The feature transforms and cloned hierarchy are owned in this builder, so an outside adapter would duplicate or bypass the catalog runtime. | Presentation only; IDs, footprints, surfaces, collisions, AI/scoring, transforms, mirror/reverse rules, and KDT1/KDT2/KDT3 data are unchanged. | `test:racing`, Workshop browser matrix, and rebuilt 50-root GLB assertions. Before: anonymous children and gaps; after: named complete modules and continuous bridge spans. |
| `src/racing/dunes/dune.css` | Raises the landscape touch-target source size so the existing `.92` compact transform still produces a physical 44 px target. The failed dimensions originate in this stylesheet; an adapter cannot repair its computed box. | Responsive UI only; no Dune input semantics or physics. | WebGL responsive scope and `test:browser:dunes`; before 40.479 px, after at least 44 px. |
| `src/racing/dunes/duneEnvironment.js` | Updates, snapshots, and disposes the leased desert-service presentation group with the environment that owns it. An external owner would create a second lifecycle and risk updating a released group. | Presentation lifecycle only; terrain, deformation, route, and vehicle state untouched. | Dune WebGL/WebGPU matrix, transition cleanup, and Whiskerwind low-quality capture. |
| `src/racing/dunes/duneMode.js` | Creates the mode-specific desert/race-day plan after its existing lease resolves. Only the Dune session has the route samples, surface-height sampler, quality tier, and exit owner needed to attach it safely. | Adds two local leases and a presentation group; heightfield and authoritative gameplay are unchanged. | `test:browser:dunes`, `test:assets`, and driven Whiskerwind capture. |
| `src/racing/monsterArena.js` | Uses already-leased authored barrier, guardrail, and fence modules in the default event story. The normal story attach is implemented here; an adapter would require a parallel arena dressing path. | Static presentation outside crush targets; arena bounds, ramps, targets, scoring, and destruction ownership unchanged. | Monster visual/lifecycle smokes and 5120×1440 driven arena capture. |
| `src/racing/monsterDestruction.js` | Retains class-specific fallbacks for authored-model coverage holes and keeps pooled wheels hidden at rest but visible through axle/domino damage. The damage transforms and pools live here and cannot be safely reconstructed externally. | Visual shells only; collision bodies, sweep tests, target health, scoring, and domino authority unchanged. | Monster target-class, crush traversal, destruction, and lifecycle smokes. Before: 13 invisible hittable targets; after: every class and damage wheel has a visible state. |
| `src/racing/racingAssets.js` | Extends `createRallyAssetLease` with the existing Draw theme input so manifest selection stays mode-specific. A caller-side adapter would fragment the single lease/cache contract. | Asset IDs only; same reference-counted cache and release semantics. | Asset manifest/lease gates and 25-transition cleanup benchmark. |
| `src/racing/racingEnvironment.js` | Attaches the shared world plan; replaces primitive Drift/Thunderbowl presentation; selects single atlas cells; fixes bank-aware drift/clay dressing. These meshes, track samples, height sampler, and disposal owner exist only in this environment builder. | Presentation only; samples and course/vehicle/score/save state are not mutated. | Full WebGL/WebGPU matrices plus dedicated Off-Road, Whisker Yard, and Thunderbowl captures. |
| `src/racing/tracks.js` | Explicitly clears inherited rally ramp/boost fractions for Drift. The incorrect inherited definition is created here; masking it later would leave phantom gameplay feature indices in the course contract. | Narrows Drift to its intended existing layout; circuit, stock, saves, records, and route points unchanged. | Drift/stock expansion and six-course/racing smokes. |
| `src/racing/trialsEnvironment.js` | Makes authored theme dressing reachable, reprojects terrain UVs, removes indoor Quarry clouds, and owns the new side-camera infrastructure group. These presentation layers and their cleanup are constructed here, so an adapter would duplicate the environment owner. | Presentation only; obstacle surfaces, checkpoints, scoring, and physics untouched. World-v3 modules stay behind the side-camera action plane. | Trials visual/lifecycle smokes, side-view Meadow capture, Quarry browser run, and explicit behind-plane assertions. |
| `src/racing/trialsMode.js` | Calls the environment disposer and exposes its snapshot for lifecycle/QA proof. Only the mode exit path can guarantee detach-before-lease-release ordering. | Diagnostics and cleanup only; track, vehicle, score, records, and controls unchanged. | Trials lifecycle smoke and repeated browser entry/exit. |
| `src/racing/worldLiveness.js` | New pure deterministic plan module for all non-frozen production environments. Keeping planning here avoids per-mode placement systems and keeps Node validation free of renderer dependencies. | Presentation plans only; no renderer, physics, timer, cache, or loader. | Determinism, exclusion, mode-kit, Draw-theme, rights, and density assertions. |
| `src/racing/worldLivenessRuntime.js` | New renderer attachment for leased clones, `InstancedMesh`, `THREE.LOD`, bounded ambient motion, and idempotent detach. The established environment owners call this one shared runtime rather than creating mode loaders/loops. | Borrowed lease resources only; detach does not dispose cached sources and release remains with the lease owner. | Standalone import-boundary check, lifecycle smokes, 25 transitions, WebGL/WebGPU captures. |

## Rebaseline rule

The frozen manifest may be regenerated only after the source paths above are
staged so newly added files are included by `git ls-files`, all named tests have
passed, and `docs/WORLD_ASSET_QA_REPORT.md` contains the final measured results.
The resulting baseline commit field may describe a dirty working tree; the file
hashes, not that label, are the enforcement mechanism.
