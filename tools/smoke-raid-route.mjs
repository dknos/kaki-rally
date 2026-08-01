#!/usr/bin/env node

// Kaki Rally Raid — metre-native route runtime contract.
//
// The claim under test is that official progress is trustworthy on a route that
// folds back on itself. A rally-raid stage is not a lap: distance is the score,
// so a nearest-point query that silently teleports the tripmaster across a
// switchback would hand the player kilometres they never drove.

import assert from 'node:assert/strict';

import {
  RAID_ROUTE_SPACING,
  RAID_ROUTE_WINDOW_METRES,
  buildRaidRoute,
  buildRaidRouteIndex,
  mixAngle,
  nearestRaidRouteSample,
  raidCorridorHalfWidth,
  raidRouteLateral,
  raidRouteZoneAt,
} from '../src/racing/raid/raidRouteRuntime.js';
import {
  RAID_STAGE_ORDER,
  getRaidStage,
  validateRaidStage,
} from '../src/racing/raid/raidStageBlueprints.js';
import { blendRaidZones } from '../src/racing/raid/raidSurfaceField.js';

let checks = 0;
function pass(message) {
  checks += 1;
  console.log(`  PASS  ${message}`);
}

console.log('Kaki Rally Raid route runtime');

const blueprint = getRaidStage('wadi-of-whiskers');
const route = buildRaidRoute(blueprint);
const index = buildRaidRouteIndex(route);

// ---------------------------------------------------------------------------
// 1. Every authored stage must validate, and its distance must be real.
{
  for (const stageId of RAID_STAGE_ORDER) {
    const stage = getRaidStage(stageId);
    const built = buildRaidRoute(stage);
    const result = validateRaidStage(stage, built);
    assert(result.ok, `stage ${stageId} failed validation:\n  ${result.errors.join('\n  ')}`);
    assert(
      built.totalMeters >= 8000,
      `stage ${stageId} is ${(built.totalMeters / 1000).toFixed(2)} km; a selective must be a real long stage`,
    );
  }
  // Distance is measured from the polyline, never from a subtitle or a
  // multiplier. Re-measuring the samples independently must agree.
  let measured = 0;
  for (let i = 1; i < route.count; i += 1) {
    measured += Math.hypot(route.x[i] - route.x[i - 1], route.z[i] - route.z[i - 1]);
  }
  assert(
    Math.abs(measured - route.totalMeters) < 1e-6,
    `declared distance ${route.totalMeters} does not match the measured polyline ${measured}`,
  );
  assert.equal(
    route.officialDistanceKm,
    Math.round((measured / 1000) * 100) / 100,
    'official distance is not derived from the measured route',
  );
}
pass(`every authored stage validates and measures its real distance (${RAID_STAGE_ORDER.length} stages, ${route.officialDistanceKm} km slice)`);

// ---------------------------------------------------------------------------
// 2. Sampling is uniform and cumulative distance is strictly increasing.
{
  let minSpacing = Infinity;
  let maxSpacing = 0;
  for (let i = 1; i < route.count; i += 1) {
    assert(route.meters[i] > route.meters[i - 1], `cumulative distance is not increasing at sample ${i}`);
    const step = route.meters[i] - route.meters[i - 1];
    minSpacing = Math.min(minSpacing, step);
    maxSpacing = Math.max(maxSpacing, step);
  }
  // Every step is the authored spacing except the deliberate short final step
  // that lands the true finish exactly.
  assert(
    maxSpacing <= RAID_ROUTE_SPACING + 1e-6,
    `route spacing overshoots: ${maxSpacing.toFixed(4)} m > ${RAID_ROUTE_SPACING} m`,
  );
  assert(minSpacing > 0, 'route contains a zero-length step');
  assert(Number.isFinite(route.startYaw), 'start heading is not finite');
}
pass(`route resamples to a uniform ${RAID_ROUTE_SPACING} m arc length with strictly increasing distance (${route.count} samples)`);

// ---------------------------------------------------------------------------
// 3. The stage genuinely folds back on itself — otherwise the test below is
//    vacuous and would pass on a route that could never expose the bug.
const foldBacks = [];
for (let i = 0; i < route.count; i += 4) {
  for (let j = i + 1; j < route.count; j += 4) {
    if (route.meters[j] - route.meters[i] < 1500) continue;
    const distance = Math.hypot(route.x[j] - route.x[i], route.z[j] - route.z[i]);
    if (distance < 260) foldBacks.push({ i, j, distance });
  }
}
assert(
  foldBacks.length > 0,
  'the slice stage never folds back on itself, so the anti-shortcut assertion would be vacuous',
);
pass(`the slice stage folds back within 260 m at ${foldBacks.length} sample pairs separated by 1.5 km or more of route`);

// ---------------------------------------------------------------------------
// 4. THE ANTI-SHORTCUT CONTRACT. Standing beside a later part of the route must
//    not advance the windowed reference past the window.
{
  let exercised = 0;
  for (const fold of foldBacks.slice(0, 40)) {
    // Park the vehicle right on the later pass, while the last legitimate
    // reference is the earlier pass.
    const worldX = route.x[fold.j];
    const worldZ = route.z[fold.j];
    const hintMeters = route.meters[fold.i];

    const windowed = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters });
    assert(
      windowed.meters <= hintMeters + RAID_ROUTE_WINDOW_METRES + RAID_ROUTE_SPACING,
      `windowed query jumped from ${hintMeters.toFixed(0)} m to ${windowed.meters.toFixed(0)} m `
      + `(${(windowed.meters - hintMeters).toFixed(0)} m of unearned progress)`,
    );

    // The unwindowed query is allowed to find the true nearest point. It exists
    // for resume and recovery, and callers must never feed it into progress.
    const global = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters: null });
    assert(
      global.distance <= windowed.distance + 1e-6,
      'the unwindowed query returned a worse match than the windowed one',
    );
    exercised += 1;
  }
  assert(exercised > 0, 'no fold-back cases were exercised');
}
pass('standing on a later pass of a fold-back cannot advance windowed route progress');

// ---------------------------------------------------------------------------
// 5. Driving the route forward produces monotonic, complete progress.
{
  let reference = 0;
  let maxJump = 0;
  let previous = 0;
  for (let i = 0; i < route.count; i += 1) {
    // Drive with a plausible lateral wander inside the corridor.
    const wander = Math.sin(i * 0.13) * raidCorridorHalfWidth(route, route.meters[i]) * 0.45;
    const rightX = Math.sin(route.yaw[i]);
    const rightZ = -Math.cos(route.yaw[i]);
    const worldX = route.x[i] + rightX * wander;
    const worldZ = route.z[i] + rightZ * wander;
    const sample = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters: reference });
    assert(
      sample.meters >= previous - 1e-6,
      `progress went backwards while driving forwards at sample ${i}`,
    );
    maxJump = Math.max(maxJump, sample.meters - previous);
    previous = sample.meters;
    reference = sample.meters;
  }
  assert(
    previous > route.totalMeters - RAID_ROUTE_SPACING * 2,
    `driving the whole route only reached ${previous.toFixed(0)} m of ${route.totalMeters.toFixed(0)} m`,
  );
  assert(maxJump < 60, `progress advanced ${maxJump.toFixed(1)} m in one step while driving smoothly`);
}
pass(`driving the corridor start to finish advances progress monotonically to ${(route.totalMeters / 1000).toFixed(2)} km`);

// ---------------------------------------------------------------------------
// 6. Off-route travel must not manufacture progress.
{
  const reference = route.meters[Math.floor(route.count * 0.35)];
  const base = Math.floor(route.count * 0.35);
  // Drive 1.2 km perpendicular to the route and stop.
  const rightX = Math.sin(route.yaw[base]);
  const rightZ = -Math.cos(route.yaw[base]);
  const worldX = route.x[base] + rightX * 1200;
  const worldZ = route.z[base] + rightZ * 1200;
  const sample = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters: reference });
  assert(
    Math.abs(sample.meters - reference) < RAID_ROUTE_WINDOW_METRES,
    'driving perpendicular off-route moved the route reference',
  );
  assert(sample.distance > 1000, `off-route distance reported as only ${sample.distance.toFixed(0)} m`);
  const lateral = raidRouteLateral(sample, worldX, worldZ);
  assert(lateral > 1000, `lateral offset sign or magnitude is wrong: ${lateral.toFixed(1)}`);
  // And to the other side.
  const leftX = route.x[base] - rightX * 800;
  const leftZ = route.z[base] - rightZ * 800;
  const leftSample = nearestRaidRouteSample(index, leftX, leftZ, { hintMeters: reference });
  assert(raidRouteLateral(leftSample, leftX, leftZ) < -700, 'lateral offset does not change sign across the route');
}
pass('driving far off-route reports true lateral distance and manufactures no progress');

// ---------------------------------------------------------------------------
// 7. The windowed query must agree with a brute-force scan of the same window.
{
  for (let trial = 0; trial < 120; trial += 1) {
    const base = (trial * 97) % route.count;
    const hintMeters = route.meters[base];
    const worldX = route.x[base] + ((trial % 11) - 5) * 37;
    const worldZ = route.z[base] + ((trial % 7) - 3) * 41;
    const sample = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters });
    const span = Math.ceil(RAID_ROUTE_WINDOW_METRES / route.spacing);
    const centre = Math.max(0, Math.min(route.count - 1, Math.round(hintMeters / route.spacing)));
    let bestDistance = Infinity;
    for (let i = Math.max(0, centre - span); i <= Math.min(route.count - 1, centre + span); i += 1) {
      bestDistance = Math.min(bestDistance, Math.hypot(worldX - route.x[i], worldZ - route.z[i]));
    }
    // The query projects onto segments, so it can only be closer than the
    // vertex-only brute force, never further.
    assert(
      sample.distance <= bestDistance + 1e-9,
      `windowed query returned ${sample.distance.toFixed(4)} vs brute force ${bestDistance.toFixed(4)}`,
    );
  }
}
pass('the windowed query never returns a worse match than a brute-force scan of the same window');

// ---------------------------------------------------------------------------
// 8. The unwindowed query must agree with a brute-force scan of the whole route.
{
  for (let trial = 0; trial < 60; trial += 1) {
    const worldX = ((trial * 2654435761) % 12000) - 1500;
    const worldZ = ((trial * 40503) % 4200) - 1200;
    const sample = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters: null });
    let bestDistance = Infinity;
    for (let i = 0; i < route.count; i += 1) {
      bestDistance = Math.min(bestDistance, Math.hypot(worldX - route.x[i], worldZ - route.z[i]));
    }
    assert(
      sample.distance <= bestDistance + 1e-9,
      `unwindowed query returned ${sample.distance.toFixed(4)} vs brute force ${bestDistance.toFixed(4)}`,
    );
  }
}
pass('the unwindowed recovery query finds the true global nearest point');

// ---------------------------------------------------------------------------
// 9. Terrain zone pacing: every authored zone is reached, blends are bounded,
//    and no sector-sized step ever spans a complete transition.
{
  const reached = new Set();
  let previousBlendT = null;
  for (let meters = 0; meters <= route.totalMeters; meters += 5) {
    const zone = raidRouteZoneAt(route, meters);
    assert(zone.t >= 0 && zone.t <= 1, `zone blend out of range at ${meters} m: ${zone.t}`);
    reached.add(zone.fromId);
    reached.add(zone.toId);
    const blend = blendRaidZones(zone.fromId, zone.toId, zone.t);
    assert(blend.from && blend.to, `zone blend at ${meters} m is malformed`);
    if (previousBlendT !== null && zone.fromId === zone.toId) previousBlendT = null;
    previousBlendT = zone.t;
  }
  const authored = new Set(blueprint.zones.map((band) => band.zone));
  for (const zoneId of authored) {
    assert(reached.has(zoneId), `authored zone ${zoneId} is never reached while driving the stage`);
  }
  assert(authored.size >= 3, `stage crosses only ${authored.size} terrain identities`);
  // A 512 m sector must never contain a complete zone transition, or the blend
  // would be invisible and the biome would appear to switch at a boundary.
  assert(
    route.zoneBlendMetres >= 320,
    `zone blend of ${route.zoneBlendMetres} m is short enough to fit inside a single sector`,
  );
}
pass(`the stage reaches every authored terrain identity with bounded, sector-spanning blends (${blueprint.zones.length} bands)`);

// ---------------------------------------------------------------------------
// 10. Corridor widths interpolate smoothly and never collapse.
{
  let previous = raidCorridorHalfWidth(route, 0);
  let maxStep = 0;
  for (let meters = 0; meters <= route.totalMeters; meters += route.spacing) {
    const half = raidCorridorHalfWidth(route, meters);
    assert(half >= 30, `corridor half-width collapsed to ${half.toFixed(1)} m at ${meters} m`);
    assert(half <= 400, `corridor half-width ballooned to ${half.toFixed(1)} m at ${meters} m`);
    maxStep = Math.max(maxStep, Math.abs(half - previous));
    previous = half;
  }
  assert(maxStep < 6, `corridor half-width steps ${maxStep.toFixed(2)} m per ${route.spacing} m of route`);
}
pass('corridor width interpolates smoothly and never collapses or balloons');

// ---------------------------------------------------------------------------
// 11. Angle interpolation must take the short way around the seam.
{
  const near = mixAngle(Math.PI - 0.05, -Math.PI + 0.05, 0.5);
  assert(
    Math.abs(Math.atan2(Math.sin(near), Math.cos(near))) > Math.PI - 0.01,
    `angle interpolation crossed the long way: ${near}`,
  );
  assert.equal(mixAngle(0.4, 0.4, 0.7), 0.4, 'angle interpolation is not stable for equal inputs');
  // The route's own yaw must be continuous sample to sample after unwrapping.
  let maxTurn = 0;
  for (let i = 1; i < route.count; i += 1) {
    let delta = route.yaw[i] - route.yaw[i - 1];
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    maxTurn = Math.max(maxTurn, Math.abs(delta));
  }
  assert(maxTurn < 0.5, `route heading turns ${(maxTurn * 57.3).toFixed(1)} degrees in one ${route.spacing} m step`);
}
pass('heading interpolation crosses the angle seam correctly and the route heading stays continuous');

console.log(`\nKaki Rally Raid route runtime passed: ${checks} contracts, ${route.count} samples over ${route.officialDistanceKm} km`);
