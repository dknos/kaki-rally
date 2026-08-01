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

Raid is reachable from `?mode=raid&play=1` on any origin, including the public
build. It is **not advertised**: the menu's card table is a frozen file with no
Raid entry, so only someone given the link arrives there, and its availability
label reads PREVIEW rather than READY. Kaki Catastrophe stays gated to an
explicit `dev=catastrophe` flag on localhost, unchanged.

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

### Landforms are structures, and still pure

The original seven zones are spectra — relief is noise summed in bands. Five
later zones are landforms: a canyon has an inside and an outside, a crater has a
centre, a spire has a footprint. Those need feature positions, which is exactly
the construct that usually reintroduces a seam. Three rules keep them pure:

- **Feature lattices are addressed by flooring the world position.** Two samples
  either side of a sector boundary scan the same 3x3 neighbourhood of cells and
  find the same feature points.
- **Nothing depends on WHICH feature is nearest.** Per-feature attributes — a
  crater's fracture count and phase — are only read inside that crater's own
  influence radius, and that radius is smaller than the 3x3 scan can miss.
  Overlapping features combine with the smooth union `a + b - ab`, never with
  `min`/`max`, so no crease forms where two of them meet. Anything keyed to
  nearest-feature identity would jump at a Voronoi boundary, which is a cliff
  the mesh renders as a crack.
- **A landform may not invent amplitude.** Coverage is always 0..1 and is
  multiplied by a share of the zone's declared `macroHeight` / `ridgeHeight`, so
  the relief bound the field tests hold every zone to still holds.

Two authoring consequences. A landform's amplitude comes from its own budget
rather than from wherever the noise lands, so measured relief barely moves with
the stage seed — across seven seeds the five landform zones varied by under 4 m,
where a noise zone's relief is a property of the seed. And because the field
cannot know where the route goes, a canyon has to be crossable *everywhere*: its
depth is modulated along its own length so it shallows to a saddle every few
hundred metres, which is both the place a driver can cross it and the place a
descent track would switchback down.

## Modules

| File | Responsibility |
| --- | --- |
| `raidSurfaceField.js` | Pure global field: gradient/fBm/ridged noise, twelve terrain zones (seven noise spectra, five landforms), ten surfaces with physical properties, height, normal, relief, surface classification. No dependencies. |
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

**Rift of Nine Tails**, 13.10 km measured, seed `0x4e494e45`.

| Route metres | Terrain | Corridor |
| --- | --- | --- |
| 0 – 2 280 | Spire forest | 260 → 220 m |
| 2 280 – 4 900 | Slot canyon, driven on the floor | 170 → 120 m |
| 4 900 – 6 850 | Canyon rim, out at a saddle | 140 → 190 m |
| 6 850 – 9 380 | Rift craters, through two centres | 300 → 260 m |
| 9 380 – 11 510 | Ruin terraces | 320 m |
| 11 510 – 13 099 | Hardpack run to the finish | 280 → 150 m |

Nine authored features: four tabletops, three gap jumps, a 10 m drop off the
rim, and a berm on the canyon's tightest corner. Minimum turn radius 57 m.
Steepest centreline grade 14% in the spire forest, 45% on the canyon floor, 80%
where the rim crosses a tributary gully.

### Authoring against a pure field

This stage is the first one where the difference matters, so it is worth stating
plainly: **a Raid stage cannot decide where a landform goes.** The terrain field
is a pure function of world metres and the seed, so the canyon, the crater
lattice and the spire plinths are already wherever the seed put them before a
single route control is written. Authoring is a search, not a drawing.

What that meant in practice, and what an editor has to redo if they change
`seed`:

* The canyon controls between 2.3 km and 4.9 km were read off a numerical trace
  of the zero set of the canyon locator field — Newton onto zero, step along the
  tangent, resample every 120 m. Nudging one of them sideways does not move the
  canyon; it moves the line off the floor and onto the wall.
* The canyon shallows to a saddle every few hundred metres. That is what makes
  the floor undulate by 30 m, and it is the only place a route can climb out
  without meeting a 47° wall: the climb-out at 4.9 km is at a saddle where
  `canyonDepthScale` reads 0.22, and it leaves on the OUTSIDE of the canyon's
  bend because the inside pinches the turn radius below the validator's limit.
* The rift band is aimed through two crater centres computed directly from the
  880 m crater lattice, so the route passes through a bowl rather than near one.
* The opening was optimised against the real terrain gradient rather than
  against plinth centres, because the grove density field turns most plinths
  into stumps and clearance from a lattice point is not what the driver meets.
  It brought the worst centreline grade in the first 2.3 km down from 246% to
  14%.

The measurement scripts that did this are throwaway; the numbers they produced
are in the blueprint's comments, which is where they belong.

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

`?mode=raid&play=1` opens Wadi of Whiskers, streams the
opening sectors, and hands over a drivable vehicle with a chase camera and a
`kkr-` HUD showing stage distance, distance remaining, speed, CAP and surface.

The vehicle is a Raid-owned fixed-step four-contact model. Yaw has angular
velocity and inertia rather than tracking the steering input, and drift is
driven by measured lateral slip rather than a held button, so countersteer
catches a real slide and holding slide while gripping earns nothing.

Terrain is drawn as one 768 m CPU-displaced patch that follows the vehicle and
reads the same provider the wheels do. It is deliberately simple rather than a
stand-in for a clipmap that pretends to be finished.

## Environment scatter

`assets/racing/raid/kaki-raid-environment-kit-v1.glb` is built by
`tools/blender/build-kaki-raid-environment-kit.py`: 13 original low-poly
assets — three boulders, two rock slabs, a spire, a mesa landmark, two scrubs,
two tussocks, deadwood, a Kaki navigation marker and two gravel clusters. The
`.blend` source ships beside it and the QA contact sheet is in
`docs/qa/assets/`. Nothing is downloaded or third-party, so the kit carries no
attribution burden.

`raidEnvironment.js` scatters them as instanced meshes. Placement is a pure
function of world position and the stage seed, exactly like the terrain, so the
same boulder is always in the same place and nothing reshuffles when the player
drives away and back. Assets are chosen by the surface underneath — tussock and
scrub on hardpack, stone clusters in the wadi, broken rock and slabs on the
shelf — density thins with distance, steep ground sheds loose scatter, and
rocks lean with the local gradient so nothing floats. Landmarks (mesas, spires)
sit on their own sparse 620 m lattice so they read as things to navigate by.

Cost is capped per quality tier (900 instances at low, 5000 at ultra) and is
bounded by the visible radius, not by how far the stage has been driven.

## Look

Four things carry the desert, chosen by comparing against concept key art:

- **Wind ripples** live in the normal map, not the geometry. A dune corrugation
  has a wavelength around a metre and the terrain grid samples every two, so
  ripples in the heightfield would alias into noise. A generated tiling normal
  map rotated to the stage wind reads correctly underfoot and dissolves into
  tone at distance. The first attempt tiled every 5.5 m, which put the crests
  30 cm apart and produced visible moiré; 22 m tiles fixed it.
- **Dust** is a fixed-capacity instanced pool in one draw call. Emission follows
  what the ground is doing — speed times surface dustiness, plus lateral slip —
  so loose sand throws a plume and salt barely smokes.
- **A low raking sun** with a 2048 shadow map that follows the vehicle. Long
  shadows are what make dune relief legible; an overhead light flattens the
  whole desert into one tone.
- **Warm haze**, with the sky and the fog sharing a colour so the horizon reads
  as distance rather than as an edge.

The hero vehicle is **Tipsy Tumbler**, the existing authored Kaki monster truck,
with the player's driver seated in it.

## Honest visual assessment

Looked at, not inferred from telemetry. `docs/qa/raid/` holds the captures.

It reads as a real, hazy, kilometre-scale desert: boulders and dry scrub give
the near field scale, tussock grass gives speed something to register against,
and a mesa and distant spires sit on the horizon to navigate by. The driver is
seated correctly and the HUD is readable.

It is still not finished. The dust plume reads as a pale smudge rather than a
churning wake, and it does not yet lift from individual wheels or persist as a
trail. The opening plateau is the flattest zone in the stage, so the first
minute still undersells the relief. There is no route evidence, no start/finish
control, no camp, and no vegetation variety beyond four species.

Measured against the concept key art it was aimed at, the ripples, haze,
lighting and HUD language land; the dust and the vehicle's ground interaction
do not.

Three bugs were found by looking at the first capture that every headless
assertion had passed straight through: the shell's menu hero was left standing
loose in the desert at menu scale because the vehicle builder was never given it
as a driver, wheel rest heights were read from an undefined field and became
NaN, and there was no sky behind the terrain.

## What is not built

Stated plainly, because a passing test suite is not a game:

- **No clipmap and no TSL terrain material.** The terrain patch is CPU-displaced
  and does not scale to the draw distance a finished stage wants.
- **No tyre tracks and no ruts.** The vehicle raises dust but leaves no mark.
- **No camps, start/finish control, or route evidence.**
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

## Authored terrain features

The zone field is stationary noise. It can say what *kind* of desert this is,
but it has no notion of *here*, so it cannot put a launch ramp at 5.4 km.
`raidTerrainFeatures.js` is the layer that can, without giving up the purity the
streaming design rests on.

A feature is an **additive relief field anchored to one world point**, exactly
zero outside its own radius. That makes it seam-safe for the same reason the
zone field is: neighbouring sectors evaluate the shared boundary from the same
world metres and the same feature record, so they agree bit for bit.

Three properties carry it:

- **Features are summed in array order**, and a feature outside its radius
  returns exactly `0`. Adding an exact zero cannot change a float sum, so a
  caller that pre-filters the list to a sector's bounds gets bit-identical
  results to one that scans the whole list. `selectRaidFeaturesNear` relies on
  this and `smoke-raid-jumps.mjs` proves it.
- **Relief is added to the height *and* the macro height.** `raidRelief` asks
  "how far above its own landform is this"; a ramp *is* its own landform, so
  adding to both leaves surface classification reading the surrounding desert
  rather than calling a 4 m ramp a wind-scoured crest.
- **A grooming pad**, slightly larger than the relief, damps the local noise
  under the feature and switches the surface to hardpack once it dominates
  (discretely at 0.5, as `blendRaidZones` switches identity at its midpoint).
  Without it a take-off face inherits the sand it stands in, and a powder ramp
  — grip 0.62, sinkage 0.56 — is precisely the "stopped dead" failure jumps
  exist to avoid.

Features are authored by **route distance** and resolved to world anchors once,
in `buildRaidRoute`. Everything downstream reads world metres only.

### The dimensions are solved, not chosen

`raidJumpFlight` is the closed form the sizing works from. The vehicle model is
2.5D — `velocityX`/`velocityZ` are horizontal and are not reduced by climbing —
so a launch is `vx = v`, `vy = eta * v * tan(lip)`, and

```
range = 2 * eta * v^2 * tan(lip) / g          g = 19.6, eta = 0.67
```

`eta` was **measured**, not assumed: bisected until the analytic touchdown
matched where the real `stepRaidVehicle` lands on a real generated ramp, through
the same lattice-snapped float32 sampling the provider hands physics. It holds
at 0.67 ± 0.03 across 110–140 km/h and 12–18°, and the smoke test re-derives it
(0.686) and fails if the suspension is retuned out from under the stages.

Two findings worth keeping, because both inverted the intuition:

- **A landing must not be cut along the flight path.** Solving it as a fixed
  point *diverges*: the steeper the landing falls away, the longer the
  trajectory takes to catch it. `raidDesignLanding` instead cuts the slope at a
  fixed fraction of the flight path angle measured where the flight would return
  to knuckle height over level ground, then solves the touchdown in closed form.
- **A landing slope only helps if its knuckle is near where the vehicle was
  going to land anyway.** With the knuckle at 58% of the range the "matched"
  landing hit *harder* than flat ground — 9.0 m/s into the suspension against
  8.0. At 78% it is 8.2 against 8.8. The smoke test asserts the strict
  comparison, so that mistake cannot come back.

### The vehicle could not jump

Building this surfaced two defects in `raidVehiclePhysics.js` that no authored
geometry could work around. Both are fixed:

- The body rests on the **floor clamp**, not the spring — equilibrium ride
  height works out below the floor — so the clamp is a kinematic constraint, and
  one that moves has to impart its own velocity. Without that term, ground
  rising under the wheels carried the body up while `velocityY` stayed pinned at
  zero: **0.00 m/s of vertical velocity across an entire 18 m ramp**, at any
  speed and any lip angle. A ramp was a conveyor belt.
- The **damper resisted absolute vertical speed** rather than suspension
  compression, subtracting ~66 m/s² at the lip, and with the ground falling away
  behind it yanked the body back down at several times gravity. It now damps
  compression rate, and the strut can only push.

Consequence to be aware of: the vehicle now gets air off natural crests too.
That is a feel change, not just a jump change.

### What this does not fix

The vehicle model applies **no longitudinal force from ground slope**. A run
that comes up short on a gap jump climbs the 63° far wall and drives away with
its speed intact — measured from 39 to 91 km/h. The terrain gap is real; the
punishment is not. Closing it means giving the model slope resistance.

`raidEnvironment.js` scatter is a pure function of world position and knows
nothing about features, so it will place boulders on a landing ramp.
`raidFeaturePadAt` is exported to serve as the exclusion mask; nothing reads it
yet.
