# Kaki Rally Raid — architecture

Kaki Rally Raid (Desert Expedition) is a new, additive, development-gated
racing discipline. It shares the Kaki Rally shell — one canvas, one renderer,
one scene, one animation loop — and owns everything else.

**Status: the mode opens, streams, drives, and exits without leaking.** It is a
vertical slice, not a finished discipline: there is no clipmap, no TSL terrain
material, no environment art, no roadbook UI, no rivals and no audio. See
*What is not built* at the end; nothing in this document describes code that
does not exist.

## Isolation

Raid is reached only from `?mode=raid&play=1&dev=1` on localhost. Off localhost,
or without `dev=1`, the router resolves the mode to `null` and the player lands
on the menu.

Dependencies flow one way:

```
Raid  ──▶  stable shared service   (allowed)
mode  ──▶  Raid                    (never)
```

`tools/smoke-raid-isolation.mjs` asserts eleven contracts on every test run,
including that no production module imports `src/racing/raid/**`, that Raid
imports no other mode's internals, that storage namespaces are disjoint in both
directions, and — behaviourally, not by regex — that both development gates
refuse ungated routes and neither cancels the other.

`docs/raid/FROZEN_BOUNDARIES.json` digests 150 files that must stay
byte-identical, and `npm run raid:boundaries -- --check` fails a wave if any of
them moves.

## The one decision everything else rests on

**The terrain field is a pure function of global world metres.**

A 12 km stage is streamed as independent 512 m sectors, generated out of order,
on workers, possibly minutes apart. Those sectors only form a seamless world if
neighbours agree exactly on their shared edge. Two ways to get that:

1. Generate sectors from local coordinates and stitch the seams afterwards.
2. Make the field global and pure, so the shared edge is the *same computation*
   evaluated twice.

This uses (2). Seam equality is then true by construction, and the seam tests
are a regression guard rather than the mechanism.

Three properties make it airtight:

- **Sector size and cell size are powers of two** (512 m / 256 cells / 2 m), so
  every vertex world coordinate is an exact integer at any distance. There is no
  float drift to accumulate — verified out to 25 km, with the noise lattice
  bound checked to 123 km.
- **The coarse terrain-zone lattice is also global** (32 m, which divides 512 m
  exactly). A per-sector-local coarse grid would reintroduce the seam the fine
  grid just avoided.
- **The height apron used for slope extends one vertex beyond the sector**, and
  the zone lattice carries one node of margin so the apron is evaluated
  correctly rather than clamped. The apron values are exactly the neighbouring
  sector's interior values, so surface classification agrees from both sides.

### Zone blending mixes fields, not parameters

Terrain identities are authored along the route in metres and blended over
340 m. The blend interpolates the two zones' **evaluated heights**, not their
parameters.

Interpolating a scale parameter — `macroScale`, `ridgeWavelength`,
`detailScale` — divides the world coordinate, so it slides the noise sample
point in proportion to distance from the origin. At 5 km a 1% wavelength change
moves the ridge phase by tens of metres and the whole landscape visibly swims
across a zone transition. A test caught this at 3.3 m of relief movement per
0.5% of the transition; mixing results is continuous by construction and costs a
second evaluation only inside a transition band.

## Modules

| File | Responsibility |
| --- | --- |
| `raidSurfaceField.js` | Pure global field: gradient/fBm/ridged noise, seven terrain zones, seven surfaces with physical properties, height, normal, relief, surface classification. No dependencies. |
| `raidRouteRuntime.js` | Metre-native route: centripetal Catmull-Rom resampled to uniform 8 m arc length, cumulative distance, corridor widths, zone pacing, uniform-grid spatial index, windowed and unwindowed nearest-point queries. |
| `raidStageBlueprints.js` | Stage data plus a validator that rejects authoring mistakes (distance drift, too few terrain identities, zone bands shorter than the blend, hairpins tighter than 25 m, collapsed corridors, empty distance, start and finish too close). |
| `raidSectorGenerator.js` | Generates one sector payload — heights (float32), surface ids and looseness (uint8) — plus `sampleRaidFieldAt` for exact single-point evaluation, and route serialisation for workers. |
| `raidSectorWorker.js` | Module worker: holds the route, generates sectors, honours cancellation, transfers buffers rather than copying them. |
| `raidTerrainProvider.js` | The streamed authority. Residency rings, LRU eviction that pins the wanted set, cancellation on focus change, and the physics-facing `heightAt` / `normalAt` / `surfaceAt` / `containsAuthority`. |

## The streaming contract

The provider is the single authority both physics and rendering read, so there
is no second terrain definition to drift out of agreement.

- **Resident cost is bounded by the ring, not by stage length.** A 24 km stage
  and a 6 km stage hold the same amount of terrain at any instant. Measured peak
  on the 12.4 km stage: 42 resident sectors, with no upward trend across the
  drive.

  This is true of *residency*, not of *generation*. Each sector builds a coarse
  zone lattice by asking the route which identity the land has, and that query
  falls back to a linear scan beyond four index rings — so generation time per
  sector grows with route sample count. At 1553 samples it is ~69 ms; a 24 km
  stage would roughly double it. That is a worker cost, not a frame cost, but it
  is not distance-independent and should not be described as such.
- **`retain` must exceed the largest set `updateFocus` can request**
  (`(2·safety+1)² + 3·ahead`). Sizing it below that made the cache evict the
  sector under the wheels and regenerate it immediately — the symptom was not a
  crash but 1623 physics samples silently falling back over one drive.
- **Physics never awaits and never generates inline.** Authority is established
  by an awaited `preloadAround` before control is handed over.
- **The fallback is lattice-exact, not analytic.** Evaluating the continuous
  field at the query point is *not* good enough: a resident sector answers with
  a bilinear blend of stored float32 vertices, and the gap between those reaches
  0.4 m in rocky terrain where the highest-frequency octave is only a few cells
  wide. The fallback therefore snaps to the same global vertex lattice,
  evaluates the four surrounding vertices, rounds each to float32 the way
  storage will, and interpolates. A late sector now moves the ground by under
  1 mm instead of 400 mm.

## The route is a corridor, not a road

The route is **not graded into the terrain**. A rally-raid corridor is a
navigational instruction; the desert stays natural and the player picks a line
through it. That is also why the fine grid needs no per-vertex route query — the
route only decides which terrain *identity* the land around it has, sampled on
the coarse lattice.

### Progress cannot be shortcut

Stages fold back on themselves. The nearest-point query is therefore **windowed**
to ±900 m around the last plausible reference by default. An unwindowed search
exists for resume and recovery and must never feed official progress.

The shipped stage folds back within 260 m at 419 sample pairs that are more than
1.5 km apart along the route, so the assertion is not vacuous. Standing on the
later pass cannot advance the windowed reference.

## The stage

**Wadi of Whiskers**, 12.41 km measured from the polyline — not from a subtitle,
a multiplier, or a scaled timer.

| Route metres | Terrain | Corridor |
| --- | --- | --- |
| 0 – 2 280 | Hardpack plateau | 260 → 320 m |
| 2 280 – 4 440 | Wadi gravel | 130 → 110 m |
| 4 440 – 8 170 | Rock shelf, folding back twice | 95 → 120 → 100 m |
| 8 170 – 11 230 | Rolling dunes | 200 → 340 m |
| 11 230 – 12 413 | Hardpack run-in to camp | 220 → 130 m |

Crosses 30 sectors spanning 27.7 m of elevation, presenting hardpack, gravel,
rock, compacted sand and loose sand along the driving line. Minimum turn radius
45.6 m. Four terrain identities, five bands.

## Measured results

| Property | Result |
| --- | --- |
| Sector seams (heights, surface, looseness) | 0 mismatches across a 3×3 block, all four-sector corners, every zone transition, and out to 25 km |
| Physics/render height delta at vertices | **0** |
| Ground movement when a late sector arrives | < 1 mm |
| Largest terrain step in 0.5 m of travel over 12.41 km | 0.230 m (no boundary signature) |
| Soak resolution caveat | the full-stage drive ran at 64 cells (8 m) so it completes in seconds; the residency, authority and no-step *behaviour* is resolution-independent, and the seam and physics/render guarantees are verified separately at the production 256 cells (2 m) |
| Physics samples outside loaded terrain over a full drive | **0** |
| Peak resident sectors | 42 (high tier), measured; no upward trend with distance |
| Resident terrain at production resolution | low 20 × 387 KiB = **7.6 MiB** / 32 MiB budget · medium 26 = **9.8 MiB** / 48 MiB · high 42 = **15.9 MiB** / 80 MiB · ultra 52 = **19.7 MiB** / 128 MiB |
| Sector payload | 387 KiB at 512 m / 2 m cells |
| Sector generation | ~69 ms at production resolution, in a worker |

## What the mode does today

`?mode=raid&play=1&dev=1` on localhost opens Wadi of Whiskers, streams the
opening sectors, and hands over a drivable vehicle with a chase camera and a
`kkr-` HUD showing stage distance, distance remaining, speed, CAP and surface.

The vehicle is a Raid-owned fixed-step four-contact model. Yaw has angular
velocity and inertia rather than tracking the steering input, and drift is
driven by measured lateral slip rather than a held button, so countersteer
catches a real slide and holding slide while gripping earns nothing.

Terrain is drawn as one 768 m CPU-displaced patch that follows the vehicle and
reads the same provider the wheels do. It is deliberately simple rather than a
stand-in for a clipmap that pretends to be finished.

## Honest visual assessment

Looked at, not inferred from telemetry. `docs/qa/raid/` holds the captures.

It reads as a real, hazy, kilometre-scale desert with a correctly seated driver
and a readable HUD. It is also **empty and visually flat**: there is no
environment scatter, no rocks, no landmarks, no dust, and no route evidence, and
the opening plateau is the flattest zone in the stage so the first minute
undersells the relief the field actually contains. Against the §44 scorecard
this would not pass "environment art" or "sense of scale" today.

Three bugs were found by looking at the first capture that every headless
assertion had passed straight through: the shell's menu hero was left standing
loose in the desert at menu scale because the vehicle builder was never given it
as a driver, wheel rest heights were read from an undefined field and became
NaN, and there was no sky behind the terrain.

## What is not built

Stated plainly, because a passing test suite is not a game:

- **No clipmap and no TSL terrain material.** The terrain patch is CPU-displaced
  and does not scale to the draw distance a finished stage wants.
- **No environment art.** No scatter, rocks, landmarks, camps, or start/finish
  control. The desert is empty.
- **No roadbook, tripmaster, CAP target, waypoints, penalties, recovery,
  records, rivals, service, condition, dust, or audio.**
- **No finish.** Reaching the end of the route does nothing.
- Waves 4–8 (feel pass, condition, campaign, art, release QA) are not started.

### The blocker Wave 1 will hit first

`tools/smoke-standalone-boundaries.mjs:63-68` allows exactly **one** lazy
production import, by exact string equality:

```js
assert.equal(
  `${relative(file)}:${specifier}`,
  'src/app/rallyApp.js:../racing/crash/crashMode.js',
  `unapproved lazy production import: ...`,
);
```

Adding Raid's `import('../racing/raid/raidMode.js')` to the shell fails this the
moment it lands. The fix is to widen that closed set to two documented entries —
keeping exact matching and the same strictness — and to add the file to the seam
list as an eighth entry. That is extending an allow-list, not weakening a test;
anything that relaxed it to a pattern match would be.

Verified by hand at the line numbers above.

The route runtime, terrain authority and stage data these systems need are in
place and proven; the systems themselves are not.
