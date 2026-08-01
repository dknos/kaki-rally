#!/usr/bin/env node

// Kaki Rally Raid — authored terrain feature contract.
//
// The terrain zone field is stationary noise: it can say what KIND of desert
// this is, but it has no way to put a launch ramp at 5.4 km. Features are the
// layer that can, and they have to earn their place without giving up the one
// property the whole streaming design rests on — that the field is a pure
// function of global world metres.
//
// So this file asserts two different kinds of thing, and both matter:
//
//   * STRUCTURE. A feature must be seam-exact across sector boundaries, must
//     return the terrain to the base field outside its radius bit for bit, and
//     must survive being pre-filtered, reordered, and structured-cloned into a
//     worker without changing a single stored height.
//
//   * BALLISTICS. A jump that is seam-perfect and unrideable is not a jump. So
//     the gaps and landings are checked against the flight the REAL vehicle
//     model actually produces, flown through the same lattice-snapped sampling
//     the terrain provider hands physics — not against an idealisation of it.

import assert from 'node:assert/strict';

import {
  RAID_CELL_METRES,
  RAID_SECTOR_METRES,
  generateRaidSector,
  raidSectorOfWorld,
  sampleRaidFieldAt,
  serializeRaidRoute,
} from '../src/racing/raid/raidSectorGenerator.js';
import { buildRaidRoute, buildRaidRouteIndex } from '../src/racing/raid/raidRouteRuntime.js';
import { validateRaidStage } from '../src/racing/raid/raidStageBlueprints.js';
import { raidSurfaceByIndex } from '../src/racing/raid/raidSurfaceField.js';
import { createRaidVehicle, stepRaidVehicle } from '../src/racing/raid/raidVehiclePhysics.js';
import {
  RAID_GRAVITY,
  RAID_LAUNCH_EFFICIENCY,
  describeRaidFeature,
  evaluateRaidFeatures,
  raidFeatureMaxGradient,
  raidFeatureProfile,
  raidFeatureTouchdown,
  raidJumpFlight,
  selectRaidFeaturesNear,
} from '../src/racing/raid/raidTerrainFeatures.js';

let checks = 0;
function pass(message) {
  checks += 1;
  console.log(`  PASS  ${message}`);
}

console.log('Kaki Rally Raid terrain features');

// ---------------------------------------------------------------------------
// A test stage, authored here rather than in the shipped blueprints so the
// shipped stage stays featureless and its frozen baselines cannot move.
//
// The route runs dead straight along +X at z = 0, which puts feature-local `u`
// exactly on the world X axis and makes every number below readable. It crosses
// the sector boundaries at x = 512, 1024, 1536 and 2048, and the features are
// deliberately placed to STRADDLE them. Salt flat, because it is the flattest
// authored identity — the analytic ballistics assume a level base, so anything
// the feature does has to be the feature and not the desert.
const STRAIGHT_CONTROLS = [];
for (let x = 0; x <= 2600; x += 100) STRAIGHT_CONTROLS.push([x, 0]);

const FEATURE_SPECS = Object.freeze([
  { id: 'kick', type: 'kicker', atMeters: 520, designSpeedKmh: 120, lipDegrees: 14 },
  { id: 'table', type: 'tabletop', atMeters: 1020, designSpeedKmh: 125, lipDegrees: 15 },
  { id: 'gap', type: 'gap-jump', atMeters: 1540, designSpeedKmh: 130, lipDegrees: 16 },
  { id: 'cliff', type: 'drop', atMeters: 2050, designSpeedKmh: 110, dropHeight: 7 },
  { id: 'bank', type: 'berm', atMeters: 2530, height: 3.2, length: 80, side: 'right' },
]);

function testBlueprint(features) {
  return Object.freeze({
    id: 'jump-proving-ground',
    name: 'Jump proving ground',
    seed: 0x4a554d50,
    windAngle: 0.31,
    defaultCorridorWidth: 200,
    zoneBlendMetres: 320,
    routeControls: Object.freeze(STRAIGHT_CONTROLS.map((point) => Object.freeze(point))),
    zones: Object.freeze([{ atMeters: 0, zone: 'salt-flat' }]),
    corridors: Object.freeze([{ atMeters: 0, width: 200 }]),
    features,
  });
}

const route = buildRaidRoute(testBlueprint(FEATURE_SPECS));
const index = buildRaidRouteIndex(route);
// The identical stage with nothing authored on it. Every "returns to the base
// field" claim below is measured against this, not against a tolerance.
const bare = buildRaidRoute(testBlueprint(undefined));
const bareIndex = buildRaidRouteIndex(bare);

const byId = new Map(route.features.map((feature) => [feature.id, feature]));
for (const feature of route.features) console.log(`        ${describeRaidFeature(feature)}`);

// ---------------------------------------------------------------------------
// 1. Ballistics. The dimensions are derived from these numbers, so if they are
//    wrong every feature on every stage is wrong in the same direction.
{
  assert.equal(RAID_GRAVITY, 19.6, 'raid gravity moved; every authored jump is now mis-sized');

  // Closed form: horizontal speed survives the climb, vertical speed is what
  // the suspension delivers, so range = 2 * eta * v^2 * tan(lip) / g.
  for (const speedKmh of [100, 120, 140]) {
    for (const lipDegrees of [12, 15, 18]) {
      const flight = raidJumpFlight({ speedKmh, lipDegrees });
      const v = speedKmh / 3.6;
      const expected = (2 * RAID_LAUNCH_EFFICIENCY * v * v * Math.tan(lipDegrees * Math.PI / 180)) / RAID_GRAVITY;
      assert(
        Math.abs(flight.range - expected) < 1e-9,
        `flight range at ${speedKmh} km/h / ${lipDegrees} deg disagrees with the closed form`,
      );
      assert(flight.airTime > 0.35, `${speedKmh} km/h off a ${lipDegrees} deg lip is airborne for only ${flight.airTime.toFixed(2)} s`);
    }
  }
  // Range must scale with the square of speed: doubling speed quadruples it.
  const slow = raidJumpFlight({ speedKmh: 70, lipDegrees: 15 });
  const fast = raidJumpFlight({ speedKmh: 140, lipDegrees: 15 });
  assert(Math.abs(fast.range / slow.range - 4) < 1e-9, 'flight range does not scale with the square of speed');

  // And the band the stage is authored in has to be a usable size of jump.
  const band = raidJumpFlight({ speedKmh: 120, lipDegrees: 15 });
  assert(band.range > 15 && band.range < 40, `a 120 km/h / 15 deg jump flies ${band.range.toFixed(1)} m, which is not a rally-raid jump`);
  console.log(
    `        120 km/h on a 15 deg lip: ${band.vy.toFixed(1)} m/s up, ${band.airTime.toFixed(2)} s of air, `
    + `${band.range.toFixed(1)} m flown, ${band.apex.toFixed(1)} m apex`,
  );
}
pass('flight ballistics match the closed form, scale with the square of speed, and land in a rally-raid size band');

// ---------------------------------------------------------------------------
// 2. Relief returns to the base field outside the radius — exactly, not nearly.
{
  const scratch = { relief: 0, pad: 0, surface: null, looseness: 0 };
  let sampled = 0;
  for (const feature of route.features) {
    for (let angle = 0; angle < 32; angle += 1) {
      const theta = (angle / 32) * Math.PI * 2;
      for (const factor of [1.0000001, 1.05, 1.4, 3]) {
        const distance = feature.radius * factor;
        const x = feature.x + Math.cos(theta) * distance;
        const z = feature.z + Math.sin(theta) * distance;
        evaluateRaidFeatures(x, z, [feature], scratch);
        assert.equal(scratch.relief, 0, `${feature.id} still adds relief ${distance.toFixed(1)} m out (radius ${feature.radius.toFixed(1)} m)`);
        assert.equal(scratch.pad, 0, `${feature.id} still grooms ${distance.toFixed(1)} m out`);
        assert.equal(scratch.surface, null, `${feature.id} still imposes a surface ${distance.toFixed(1)} m out`);
        sampled += 1;
      }
      // Just inside the radius the feature is allowed to be zero too — the
      // radius bounds a rectangle — but it must never be non-finite.
      const inside = feature.radius * 0.98;
      evaluateRaidFeatures(feature.x + Math.cos(theta) * inside, feature.z + Math.sin(theta) * inside, [feature], scratch);
      assert(Number.isFinite(scratch.relief), `${feature.id} produced a non-finite relief inside its radius`);
    }
    // Every feature has to actually do something at its own anchor.
    evaluateRaidFeatures(feature.x, feature.z, [feature], scratch);
    const atAnchor = Math.abs(scratch.relief) + scratch.pad;
    assert(atAnchor > 0.1, `${feature.id} does nothing at its own anchor`);
  }
  pass(`relief and grooming are exactly zero outside every feature radius (${sampled} samples around ${route.features.length} features)`);
}

// ---------------------------------------------------------------------------
// 3. Terrain away from a feature is bit-identical to the same stage with no
//    features authored on it at all. This is the strongest possible form of
//    "it blends in": not a small delta, no delta.
{
  const featureSectors = new Set();
  for (const feature of route.features) {
    const { sectorX, sectorZ } = raidSectorOfWorld(feature.x, feature.z);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) featureSectors.add(`${sectorX + dx},${sectorZ + dz}`);
    }
  }
  // A sector nothing reaches must be byte-identical.
  let untouched = 0;
  for (const [sx, sz] of [[0, 4], [7, -3], [-2, 1], [12, 9]]) {
    assert(!featureSectors.has(`${sx},${sz}`), 'picked a sector a feature actually reaches');
    const withFeatures = generateRaidSector({ sectorX: sx, sectorZ: sz, route, index });
    const without = generateRaidSector({ sectorX: sx, sectorZ: sz, route: bare, index: bareIndex });
    assert.deepEqual(withFeatures.heights, without.heights, `sector ${sx},${sz} changed although no feature reaches it`);
    assert.deepEqual(withFeatures.surface, without.surface, `sector ${sx},${sz} surfaces changed although no feature reaches it`);
    assert.deepEqual(withFeatures.looseness, without.looseness, `sector ${sx},${sz} looseness changed although no feature reaches it`);
    untouched += 1;
  }

  // And inside a sector a feature DOES reach, the vertices beyond its radius
  // must still be untouched, while the vertices under it must have moved.
  const gap = byId.get('gap');
  const { sectorX, sectorZ } = raidSectorOfWorld(gap.x, gap.z);
  const withFeatures = generateRaidSector({ sectorX, sectorZ, route, index });
  const without = generateRaidSector({ sectorX, sectorZ, route: bare, index: bareIndex });
  let outsideChecked = 0;
  let movedVertices = 0;
  let biggestMove = 0;
  for (let row = 0; row < withFeatures.verts; row += 1) {
    const worldZ = withFeatures.originZ + row * withFeatures.cellMetres;
    for (let column = 0; column < withFeatures.verts; column += 1) {
      const worldX = withFeatures.originX + column * withFeatures.cellMetres;
      const i = row * withFeatures.verts + column;
      const delta = Math.abs(withFeatures.heights[i] - without.heights[i]);
      let reached = false;
      for (const feature of route.features) {
        const dx = worldX - feature.x;
        const dz = worldZ - feature.z;
        if (dx * dx + dz * dz <= feature.radiusSquared) reached = true;
      }
      if (!reached) {
        assert.equal(
          withFeatures.heights[i], without.heights[i],
          `vertex ${worldX},${worldZ} moved ${delta.toFixed(4)} m although it is outside every feature radius`,
        );
        outsideChecked += 1;
      } else if (delta > 0) {
        movedVertices += 1;
        biggestMove = Math.max(biggestMove, delta);
      }
    }
  }
  assert(movedVertices > 500, `the gap jump only moved ${movedVertices} vertices; it is not being built`);
  assert(biggestMove > 3, `the gap jump's deepest change is only ${biggestMove.toFixed(2)} m; it is not a big jump`);
  pass(
    `terrain outside a feature radius is bit-identical to the featureless stage `
    + `(${untouched} whole sectors, ${outsideChecked} vertices; ${movedVertices} vertices moved, up to ${biggestMove.toFixed(1)} m)`,
  );
}

// ---------------------------------------------------------------------------
// 4. Seam exactness across sector boundaries, with a feature straddling them.
//    This is the invariant the whole streaming design rests on, tested at the
//    only place a feature could break it.
{
  const straddled = new Set();
  for (const feature of route.features) {
    const { sectorX, sectorZ } = raidSectorOfWorld(feature.x, feature.z);
    straddled.add(`${sectorX},${sectorZ}`);
    // Prove the placement is not vacuous: the feature has to genuinely reach
    // into the neighbouring sector.
    const edgeX = (sectorX + 1) * RAID_SECTOR_METRES;
    assert(
      Math.abs(feature.x - edgeX) < feature.radius || Math.abs(feature.x - sectorX * RAID_SECTOR_METRES) < feature.radius,
      `${feature.id} does not straddle a sector boundary, so this test proves nothing about it`,
    );
  }
  assert(straddled.size >= 3, 'the test features do not spread across enough sectors');

  let compared = 0;
  for (const key of straddled) {
    const [sx, sz] = key.split(',').map(Number);
    const here = generateRaidSector({ sectorX: sx, sectorZ: sz, route, index });
    const east = generateRaidSector({ sectorX: sx + 1, sectorZ: sz, route, index });
    const north = generateRaidSector({ sectorX: sx, sectorZ: sz + 1, route, index });
    const west = generateRaidSector({ sectorX: sx - 1, sectorZ: sz, route, index });
    for (let i = 0; i < here.verts; i += 1) {
      assert.equal(here.heights[i * here.verts + (here.verts - 1)], east.heights[i * east.verts], `feature height seam east of ${key}`);
      assert.equal(here.surface[i * here.verts + (here.verts - 1)], east.surface[i * east.verts], `feature surface seam east of ${key}`);
      assert.equal(here.looseness[i * here.verts + (here.verts - 1)], east.looseness[i * east.verts], `feature looseness seam east of ${key}`);
      assert.equal(here.heights[(here.verts - 1) * here.verts + i], north.heights[i], `feature height seam north of ${key}`);
      assert.equal(here.heights[i * here.verts], west.heights[i * west.verts + (west.verts - 1)], `feature height seam west of ${key}`);
      compared += 4;
    }
  }
  pass(`every sector seam through a feature agrees exactly (${compared} boundary vertices across ${straddled.size} straddled sectors)`);
}

// ---------------------------------------------------------------------------
// 5. The single assertion that covers the whole divergence class: the streamed
//    payload and the physics fallback must agree at every vertex a feature
//    touches. If a pre-filter, an ordering, or a rounding ever differs between
//    the two paths, this is where it shows.
{
  const gap = byId.get('gap');
  const { sectorX, sectorZ } = raidSectorOfWorld(gap.x, gap.z);
  const payload = generateRaidSector({ sectorX, sectorZ, route, index });
  const scratch = { height: 0, macro: 0, surface: 0, looseness: 0 };
  let checkedVertices = 0;
  for (let row = 0; row < payload.verts; row += 4) {
    const worldZ = payload.originZ + row * payload.cellMetres;
    for (let column = 0; column < payload.verts; column += 4) {
      const worldX = payload.originX + column * payload.cellMetres;
      const i = row * payload.verts + column;
      const sampled = Math.fround(sampleRaidFieldAt(worldX, worldZ, route, index, scratch).height);
      assert.equal(
        payload.heights[i], sampled,
        `stored height and the physics fallback disagree at ${worldX},${worldZ}`,
      );
      assert.equal(payload.surface[i], scratch.surface, `stored surface and the fallback disagree at ${worldX},${worldZ}`);
      checkedVertices += 1;
    }
  }

  // Pre-filtering the feature list must be a no-op, not an approximation.
  const fx = { relief: 0, pad: 0, surface: null, looseness: 0 };
  const fxFiltered = { relief: 0, pad: 0, surface: null, looseness: 0 };
  let filterChecks = 0;
  for (let u = -180; u <= 180; u += 1.5) {
    const x = gap.x + u;
    const z = gap.z;
    const subset = selectRaidFeaturesNear(route.features, x - 1, z - 1, x + 1, z + 1);
    evaluateRaidFeatures(x, z, route.features, fx);
    evaluateRaidFeatures(x, z, subset, fxFiltered);
    assert.equal(fxFiltered.relief, fx.relief, `pre-filtering changed the relief at ${x.toFixed(1)}`);
    assert.equal(fxFiltered.pad, fx.pad, `pre-filtering changed the grooming at ${x.toFixed(1)}`);
    filterChecks += 1;
  }

  // A worker rebuilds everything from the cloned route. Same terrain, or the
  // streamed world disagrees with the one physics is standing on.
  const cloned = structuredClone(serializeRaidRoute(route));
  assert.equal(cloned.features.length, route.features.length, 'features did not survive structured cloning');
  const clonedIndex = buildRaidRouteIndex(cloned);
  const fromClone = generateRaidSector({ sectorX, sectorZ, route: cloned, index: clonedIndex });
  assert.deepEqual(fromClone.heights, payload.heights, 'a worker-cloned route builds different feature geometry');
  assert.deepEqual(fromClone.surface, payload.surface, 'a worker-cloned route builds different feature surfaces');

  // And generation order must not matter.
  const reverse = generateRaidSector({ sectorX, sectorZ, route, index });
  assert.deepEqual(reverse.heights, payload.heights, 'feature generation depends on order');
  pass(
    `the streamed payload, the physics fallback, a pre-filtered list and a worker clone all agree exactly `
    + `(${checkedVertices} vertices, ${filterChecks} filter comparisons)`,
  );
}

// ---------------------------------------------------------------------------
// 6. A kicker's take-off gradient has to be drivable — and the SAMPLED
//    heightfield, not just the analytic profile, has to deliver it. A ramp that
//    is right in float64 and rounded off by the 2 m grid launches nothing.
{
  const kicker = byId.get('kick');
  const gradient = raidFeatureMaxGradient(kicker, 0.25, kicker.uMin, 0);
  assert(
    gradient.riseDegrees >= 8 && gradient.riseDegrees <= 24,
    `the kicker's steepest rise is ${gradient.riseDegrees.toFixed(1)} deg, outside the drivable 8-24 deg band`,
  );
  assert(
    Math.abs(gradient.riseDegrees - kicker.lipDegrees) < 0.6,
    `the kicker face measures ${gradient.riseDegrees.toFixed(2)} deg but was authored at ${kicker.lipDegrees} deg`,
  );
  const straightFace = kicker.rampLength - kicker.filletLength;
  assert(
    straightFace >= RAID_CELL_METRES * 5,
    `the kicker's constant-gradient face is only ${straightFace.toFixed(1)} m, under ${RAID_CELL_METRES * 5} m of terrain grid`,
  );

  // Now measure the face as the terrain grid actually stores it, along the
  // centreline, over the middle of the straight section. Read through the
  // lattice-snapped float32 path rather than out of one payload, because the
  // kicker straddles a sector boundary — section 5 has already proved the two
  // are the same number at every vertex.
  const heightScratch = { height: 0, macro: 0, surface: 0, looseness: 0 };
  function storedHeight(worldX, worldZ) {
    const snappedX = Math.round(worldX / RAID_CELL_METRES) * RAID_CELL_METRES;
    const snappedZ = Math.round(worldZ / RAID_CELL_METRES) * RAID_CELL_METRES;
    return Math.fround(sampleRaidFieldAt(snappedX, snappedZ, route, index, heightScratch).height);
  }
  const faceStart = Math.round((-kicker.rampLength * 0.62) / RAID_CELL_METRES) * RAID_CELL_METRES;
  const faceEnd = Math.round((-kicker.rampLength * 0.18) / RAID_CELL_METRES) * RAID_CELL_METRES;
  const rise = storedHeight(kicker.x + faceEnd, kicker.z) - storedHeight(kicker.x + faceStart, kicker.z);
  const measured = Math.atan(rise / (faceEnd - faceStart)) * 180 / Math.PI;
  assert(
    Math.abs(measured - kicker.lipDegrees) < 1.2,
    `the STORED heightfield delivers a ${measured.toFixed(2)} deg take-off where ${kicker.lipDegrees} deg was authored`,
  );

  // Behind the lip there must be nothing: a kicker launches onto natural ground.
  assert.equal(raidFeatureProfile(kicker, kicker.uMax + 0.01), 0, 'a kicker leaves relief behind its back face');
  assert(kicker.landingLength === 0, 'a kicker should have no landing of its own');
  console.log(
    `        kicker: ${kicker.height.toFixed(1)} m over a ${kicker.rampLength.toFixed(1)} m face, `
    + `${straightFace.toFixed(1)} m of it at a constant ${measured.toFixed(2)} deg as stored`,
  );
}
pass('a kicker take-off is inside the drivable gradient band, in the profile and in the stored heightfield');

// ---------------------------------------------------------------------------
// 6b. A berm is the one feature whose shape lives in the CROSS axis, so none of
//     the along-track checks above say anything about it.
{
  const berm = byId.get('bank');
  const fx = { relief: 0, pad: 0, surface: null, looseness: 0 };
  function reliefAtOffset(offset) {
    evaluateRaidFeatures(
      berm.x + berm.rightX * offset, berm.z + berm.rightZ * offset, [berm], fx,
    );
    return fx.relief;
  }
  // Flush with the racing line on the inside, rising to a crest on the outside.
  assert.equal(reliefAtOffset(0), 0, 'the berm is not flush with the racing line at its inside edge');
  assert.equal(reliefAtOffset(-berm.bermOuter), 0, 'the berm banks the WRONG side of the turn');
  const crest = reliefAtOffset(berm.bermOuter);
  assert(
    Math.abs(crest - berm.height) < 0.05,
    `the berm crests at ${crest.toFixed(2)} m where ${berm.height.toFixed(2)} m was authored`,
  );
  // And it has to be a rideable bank, not a kerb: monotone up the face, and
  // never steeper than a vehicle can hold a line against.
  let previous = 0;
  let steepest = 0;
  const step = 0.25;
  for (let offset = berm.bermInner; offset <= berm.bermOuter; offset += step) {
    const here = reliefAtOffset(offset);
    assert(here >= previous - 1e-9, `the berm face dips at ${offset.toFixed(2)} m out`);
    steepest = Math.max(steepest, (here - previous) / step);
    previous = here;
  }
  const bankDegrees = Math.atan(steepest) * 180 / Math.PI;
  assert(bankDegrees > 12 && bankDegrees < 45, `the berm banks at ${bankDegrees.toFixed(1)} deg, which is a kerb rather than a bank`);
  console.log(
    `        berm: flush at the line, ${berm.height.toFixed(1)} m crest ${berm.bermOuter.toFixed(1)} m out, `
    + `steepest face ${bankDegrees.toFixed(1)} deg, ${berm.side > 0 ? 'right' : 'left'} side only`,
  );
}
pass('a berm banks the authored side only, is flush with the racing line, and crests at its authored height');

// ---------------------------------------------------------------------------
// 7. Landings are matched to the take-off, analytically. A gap must be cleared
//    at its design speed and the touchdown must land on the down-slope.
{
  for (const id of ['table', 'gap', 'cliff']) {
    const feature = byId.get(id);
    const landed = raidFeatureTouchdown(feature, feature.designSpeedKmh);
    assert(landed.clearsKnuckle, `${id} is NOT cleared at its own design speed of ${feature.designSpeedKmh} km/h`);
    assert(
      landed.landingFraction > 0.1 && landed.landingFraction < 0.95,
      `${id} touches down at ${(landed.landingFraction * 100).toFixed(0)}% of its landing slope`,
    );
    // Matched means the velocity that goes STRAIGHT into the suspension is
    // less than the same flight would have put in had the far side simply been
    // level. That is a strict comparison and it has teeth: a landing slope cut
    // too far uphill of the touchdown makes the impact WORSE, not better,
    // because it extends the flight into the steepening part of the parabola.
    assert(
      landed.normalImpactMs < landed.flatNormalImpactMs,
      `${id} lands ${landed.normalImpactMs.toFixed(1)} m/s into the suspension where level ground `
      + `would give ${landed.flatNormalImpactMs.toFixed(1)} m/s — the landing slope is making it worse`,
    );
    // A jump has to be genuinely soft. A drop is exempt and says why: a fall is
    // already steeper than any slope worth cutting, so its landing exists to
    // carry the speed away rather than to flatten an impact it cannot.
    if (id !== 'cliff') {
      assert(
        landed.normalImpactMs < 9,
        `${id} puts ${landed.normalImpactMs.toFixed(1)} m/s straight into the suspension`,
      );
    }
    console.log(
      `        ${id}: ${landed.airborneMetres.toFixed(1)} m of air at ${feature.designSpeedKmh} km/h, `
      + `down at ${(landed.landingFraction * 100).toFixed(0)}% of a ${feature.landingDegrees.toFixed(1)} deg landing, `
      + `${landed.normalImpactMs.toFixed(1)} m/s in (level ground would be ${landed.flatNormalImpactMs.toFixed(1)})`,
    );
  }

  // A gap jump has to be a genuine gap: real ground missing, not a dip.
  const gap = byId.get('gap');
  assert(gap.gapLength > 10, `the gap is only ${gap.gapLength.toFixed(1)} m; that is a bump, not a gap`);
  assert(gap.pitDepth > 0.5, 'the gap jump has no pit between the lip and the knuckle');
  const pitFloor = raidFeatureProfile(gap, gap.gapLength * 0.5);
  assert(pitFloor < -0.5, `the middle of the gap sits at ${pitFloor.toFixed(2)} m; there is nothing to clear`);
  // And it must NOT be clearable by someone who lifts off.
  const timid = raidFeatureTouchdown(gap, gap.designSpeedKmh * 0.55);
  assert(!timid.clearsKnuckle, 'the gap is cleared even at 55% of the design speed, so committing earns nothing');
  console.log(
    `        gap: ${gap.gapLength.toFixed(1)} m of missing ground, cleared at ${gap.designSpeedKmh} km/h `
    + `and NOT at ${Math.round(gap.designSpeedKmh * 0.55)} km/h`,
  );
}
pass('every landing is matched to its take-off, and the gap is cleared at its design speed but not below it');

// ---------------------------------------------------------------------------
// 8. The real vehicle, over the real terrain, through the real sampling path.
//
//    Everything above is geometry and closed-form ballistics. This drives
//    `stepRaidVehicle` at the physics rate over the streamed field, snapped to
//    the same 2 m lattice the terrain provider gives physics, and asks the only
//    question that actually matters: does it fly, and does it land?
{
  const scratch = { height: 0, macro: 0, surface: 0, looseness: 0 };
  const nodes = new Map();
  function node(x, z) {
    const key = `${x}|${z}`;
    let value = nodes.get(key);
    if (value === undefined) {
      value = Math.fround(sampleRaidFieldAt(x, z, route, index, scratch).height);
      nodes.set(key, value);
    }
    return value;
  }
  // Exactly what raidTerrainProvider does when a sector has not streamed in:
  // snap to the global vertex lattice, round each corner to float32 the way
  // storage will, and bilinearly interpolate.
  const provider = {
    heightAt(x, z) {
      const x0 = Math.floor(x / RAID_CELL_METRES) * RAID_CELL_METRES;
      const z0 = Math.floor(z / RAID_CELL_METRES) * RAID_CELL_METRES;
      const tx = (x - x0) / RAID_CELL_METRES;
      const tz = (z - z0) / RAID_CELL_METRES;
      const a = node(x0, z0);
      const b = node(x0 + RAID_CELL_METRES, z0);
      const c = node(x0, z0 + RAID_CELL_METRES);
      const d = node(x0 + RAID_CELL_METRES, z0 + RAID_CELL_METRES);
      return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
    },
    surfaceAt(x, z) {
      sampleRaidFieldAt(x, z, route, index, scratch);
      return raidSurfaceByIndex(scratch.surface);
    },
  };

  function drive(feature, speedKmh, { runIn = 150, ticks = 2400, gapFrom = 0, gapTo = 0 } = {}) {
    const startX = feature.x - runIn;
    const vehicle = createRaidVehicle({ x: startX, y: provider.heightAt(startX, feature.z), z: feature.z, yaw: 0 });
    const target = speedKmh / 3.6;
    vehicle.velocityX = target;
    const dt = 1 / 120;
    let airborneFrom = null;
    let longest = 0;
    let launchU = 0;
    let landU = 0;
    let peakHeight = 0;
    let impact = 0;
    let surfaceOnRamp = null;
    // Lowest the vehicle ever gets above the ground while crossing the gap.
    // "Did it clear" is a question about whether the wheels were ever down in
    // the pit, not about where the longest airborne span happened to end.
    let minGapClearance = Infinity;
    for (let step = 0; step < ticks; step += 1) {
      const speed = Math.hypot(vehicle.velocityX, vehicle.velocityZ);
      stepRaidVehicle(vehicle, dt, provider, {
        throttle: speed < target ? 1 : 0.02, steer: 0, slide: false, push: false,
      });
      const u = vehicle.x - feature.x;
      if (u > -feature.rampLength * 0.6 && u < -feature.rampLength * 0.2 && !surfaceOnRamp) {
        surfaceOnRamp = vehicle.surface?.id || null;
      }
      if (gapTo > gapFrom && u > gapFrom && u < gapTo) {
        minGapClearance = Math.min(minGapClearance, vehicle.y - provider.heightAt(vehicle.x, vehicle.z));
      }
      if (vehicle.airborne) {
        if (airborneFrom === null) airborneFrom = u;
        peakHeight = Math.max(peakHeight, vehicle.y - provider.heightAt(vehicle.x, vehicle.z));
      } else if (airborneFrom !== null) {
        if (u - airborneFrom > longest) {
          longest = u - airborneFrom;
          launchU = airborneFrom;
          landU = u;
          impact = vehicle.landingImpact;
        }
        airborneFrom = null;
      }
      if (u > feature.uMax + 90) break;
    }
    return {
      launchU, landU, airMetres: longest, peakHeight, impact, surfaceOnRamp, speedKmh, minGapClearance,
      finalSpeedKmh: Math.hypot(vehicle.velocityX, vehicle.velocityZ) * 3.6,
    };
  }

  // The kicker: it must genuinely leave the ground and stay off it.
  const kicker = byId.get('kick');
  const kicked = drive(kicker, kicker.designSpeedKmh);
  assert(
    kicked.airMetres > 12,
    `a ${kicker.designSpeedKmh} km/h run off the kicker flies only ${kicked.airMetres.toFixed(1)} m — the ramp is a conveyor belt`,
  );
  assert(kicked.peakHeight > 0.9, `the kicker only lifts the vehicle ${kicked.peakHeight.toFixed(2)} m off the ground`);
  assert.equal(kicked.surfaceOnRamp, 'hardpack', `the take-off face is ${kicked.surfaceOnRamp}, not the groomed hardpack it was authored as`);

  // The gap: airborne before the lip, still airborne past the knuckle, down on
  // the landing slope. This is the whole promise of the feature.
  const gap = byId.get('gap');
    // The window runs from the foot of the take-off's back face to the knuckle
  // itself, so it covers the pit floor AND the far wall, and starts after the
  // vehicle has actually left the lip. A gap jump is cleared if the vehicle is
  // still well above the ground the whole way to the knuckle; a run that comes
  // up short registers here as the wheels arriving on the floor or the wall.
  const gapWindow = { gapFrom: gap.backLength, gapTo: gap.gapLength };
  const flown = drive(gap, gap.designSpeedKmh, gapWindow);
  assert(
    flown.launchU < 4,
    `the vehicle only left the ground ${flown.launchU.toFixed(1)} m past the lip; it drove into the pit`,
  );
  assert(
    flown.landU > gap.gapLength,
    `a ${gap.designSpeedKmh} km/h run lands at ${flown.landU.toFixed(1)} m, short of the ${gap.gapLength.toFixed(1)} m knuckle — into the wall`,
  );
  assert(
    flown.minGapClearance > 1.5,
    `the vehicle passed within ${flown.minGapClearance.toFixed(2)} m of the ground inside the gap; it did not fly it`,
  );
  assert(
    flown.landU < gap.gapLength + gap.landingLength,
    `it overshoots the ${gap.landingLength.toFixed(0)} m landing slope, touching down at ${flown.landU.toFixed(1)} m`,
  );
  // Committing has to be rewarded: the vehicle must still be carrying speed.
  assert(
    flown.finalSpeedKmh > gap.designSpeedKmh * 0.75,
    `the landing scrubbed the run from ${gap.designSpeedKmh} to ${flown.finalSpeedKmh.toFixed(0)} km/h`,
  );

  // The analytic sizing tool has to predict what the vehicle actually does, or
  // the whole "sized from ballistics rather than guessed" claim is empty.
  const predicted = raidFeatureTouchdown(gap, gap.designSpeedKmh);
  const error = Math.abs(predicted.touchdownU - flown.landU) / Math.max(1, flown.landU);
  assert(
    error < 0.25,
    `the sizing tool predicts touchdown at ${predicted.touchdownU.toFixed(1)} m but the vehicle lands at ${flown.landU.toFixed(1)} m (${(error * 100).toFixed(0)}% out)`,
  );

  // A driver who lifts off must NOT fly it. Stated as an absolute AND as a
  // ratio so it cannot pass by accident.
  //
  // Recorded honestly, because the measurement showed it: this asserts that the
  // slow run FAILS TO FLY THE GAP, not that it is stopped by it. The vehicle
  // model applies no longitudinal force from ground slope, so a truck that
  // comes up short climbs the gap's sixty-three degree far wall and drives away
  // with its speed intact. Measured across 39-91 km/h: every slow run reaches
  // the knuckle with under 1.6 m of clearance and none of them is punished for
  // it. That is a vehicle-model gap, not a terrain one — the ground here really
  // is missing — and closing it means giving the model slope resistance, which
  // is a feel change well outside authoring terrain.
  const timid = drive(gap, gap.designSpeedKmh * 0.5, gapWindow);
  assert(
    timid.minGapClearance < 1.8,
    `at half the design speed the vehicle still flew the pit with ${timid.minGapClearance.toFixed(2)} m of clearance; committing earns nothing`,
  );
  assert(
    flown.minGapClearance > timid.minGapClearance * 2.2,
    `committing buys only ${(flown.minGapClearance / Math.max(0.01, timid.minGapClearance)).toFixed(1)}x the clearance of lifting off`,
  );

  console.log(
    `        driven: kicker ${kicked.airMetres.toFixed(1)} m of air ${kicked.peakHeight.toFixed(1)} m up · `
    + `gap launched at u=${flown.launchU.toFixed(1)}, cleared ${gap.gapLength.toFixed(1)} m, `
    + `down at u=${flown.landU.toFixed(1)} (predicted ${predicted.touchdownU.toFixed(1)}), `
    + `carrying ${flown.finalSpeedKmh.toFixed(0)} km/h with ${flown.minGapClearance.toFixed(1)} m under the wheels `
    + `· at half speed the clearance is ${timid.minGapClearance.toFixed(2)} m — it does not fly it`,
  );

  // Finally, the number the whole design table stands on.
  //
  // RAID_LAUNCH_EFFICIENCY is not a tuning knob and was not picked: it is the
  // value that makes the analytic sizing tool predict where the simulated
  // vehicle actually lands. So it is re-measured the same way it was set —
  // bisect the efficiency until the predicted touchdown matches the driven one
  // — and the constant has to still be in that neighbourhood. If someone
  // retunes the suspension, this is the assertion that says every authored jump
  // on every stage is now the wrong size.
  let low = 0.2;
  let high = 1.4;
  for (let iteration = 0; iteration < 36; iteration += 1) {
    const middle = (low + high) / 2;
    const predictedU = raidFeatureTouchdown(kicker, kicker.designSpeedKmh, { launchEfficiency: middle }).touchdownU;
    if (predictedU < kicked.landU) low = middle;
    else high = middle;
  }
  const measuredEta = (low + high) / 2;
  assert(
    Math.abs(measuredEta - RAID_LAUNCH_EFFICIENCY) < RAID_LAUNCH_EFFICIENCY * 0.3,
    `the vehicle's measured launch efficiency is ${measuredEta.toFixed(3)}, more than 30% from the authored `
    + `${RAID_LAUNCH_EFFICIENCY} — every jump on every stage is now sized wrong`,
  );
  console.log(
    `        launch efficiency: authored ${RAID_LAUNCH_EFFICIENCY}, measured ${measuredEta.toFixed(3)} `
    + `by matching the sizing tool to the driven touchdown`,
  );
}
pass('the real vehicle leaves a real ramp, clears the gap at its design speed, lands on the slope, and cannot clear it slowly');

// ---------------------------------------------------------------------------
// 9. The validator has to refuse authoring mistakes rather than shipping them.
{
  // The proving ground is deliberately a single terrain identity, which the
  // validator rejects for its own reasons; what has to be clean is everything
  // it says about the features.
  const good = validateRaidStage(testBlueprint(FEATURE_SPECS), route);
  const featureErrors = good.errors.filter((message) => /kick|table|gap|cliff|bank/.test(message));
  assert.deepEqual(featureErrors, [], `the proving ground's features should validate cleanly: ${featureErrors.join('; ')}`);

  function errorsFor(features) {
    const blueprint = testBlueprint(features);
    return validateRaidStage(blueprint, buildRaidRoute(blueprint)).errors.join(' | ');
  }
  // A gap wider than the design speed can carry.
  assert.match(
    errorsFor([{ id: 'toofar', type: 'gap-jump', atMeters: 900, designSpeedKmh: 90, lipDegrees: 14, gapLength: 70 }]),
    /does NOT clear/,
    'the validator accepted a gap the design speed cannot clear',
  );
  // A take-off face nothing can drive up.
  assert.match(
    errorsFor([{ id: 'wall', type: 'kicker', atMeters: 900, designSpeedKmh: 120, lipDegrees: 38 }]),
    /outside the drivable/,
    'the validator accepted a 38 degree take-off',
  );
  // Two features fighting over the same ground.
  assert.match(
    errorsFor([
      { id: 'a', type: 'tabletop', atMeters: 900, designSpeedKmh: 120, lipDegrees: 14 },
      { id: 'b', type: 'tabletop', atMeters: 930, designSpeedKmh: 120, lipDegrees: 14 },
    ]),
    /overlaps/,
    'the validator accepted two overlapping features',
  );
  // An unknown type is a typo, not a feature.
  assert.throws(
    () => buildRaidRoute(testBlueprint([{ type: 'megaramp', atMeters: 900 }])),
    /unknown raid feature type/,
    'an unknown feature type built silently',
  );
}
pass('the validator refuses unclearable gaps, undrivable faces, overlapping features and unknown types');

console.log(`\nKaki Rally Raid terrain features passed: ${checks} contracts`);
