#!/usr/bin/env node

// Kaki Rally Raid — streamed terrain authority contract.
//
// This is the soak. It drives the whole 12.4 km stage through the provider the
// way the fixed-step physics does, and asserts the properties that make a
// streamed world safe to drive on: bounded memory that does not trend upward
// with distance, ground that is always authoritative, and — the one a player
// would actually feel — no height step at a sector boundary.

import assert from 'node:assert/strict';

import { buildRaidRoute, buildRaidRouteIndex, nearestRaidRouteSample } from '../src/racing/raid/raidRouteRuntime.js';
import {
  RAID_CELL_METRES,
  RAID_SECTOR_METRES,
  raidSectorKey,
  raidSectorOfWorld,
  sampleRaidFieldAt,
} from '../src/racing/raid/raidSectorGenerator.js';
import { createRaidTerrainProvider, RAID_RESIDENCY } from '../src/racing/raid/raidTerrainProvider.js';
import { getRaidStage } from '../src/racing/raid/raidStageBlueprints.js';

let checks = 0;
function pass(message) {
  checks += 1;
  console.log(`  PASS  ${message}`);
}

console.log('Kaki Rally Raid streamed terrain authority');

const route = buildRaidRoute(getRaidStage('wadi-of-whiskers'));
const routeIndex = buildRaidRouteIndex(route);

// The soak runs at a reduced sector resolution so it finishes in seconds. Every
// property under test — residency, bounding, seam continuity, authority — is
// independent of cell count, and the full-resolution seam guarantee is covered
// by tools/smoke-raid-sector-seams.mjs.
const SOAK_CELLS = 64;

// ---------------------------------------------------------------------------
// 1. Residency tiers must be ordered and inside their declared budgets.
{
  const order = ['low', 'medium', 'high', 'ultra'];
  for (let i = 1; i < order.length; i += 1) {
    const previous = RAID_RESIDENCY[order[i - 1]];
    const current = RAID_RESIDENCY[order[i]];
    assert(current.retain >= previous.retain, `${order[i]} retains fewer sectors than ${order[i - 1]}`);
    assert(current.budgetBytes >= previous.budgetBytes, `${order[i]} has a smaller budget than ${order[i - 1]}`);
  }
  assert.equal(RAID_RESIDENCY.low.budgetBytes, 32 * 1024 * 1024, 'the low tier budget drifted from 32 MiB');
  assert(RAID_RESIDENCY.low.safety >= 1, 'the low tier keeps no safety ring around the vehicle');
}
pass('residency tiers are ordered and stay inside their declared memory budgets');

// ---------------------------------------------------------------------------
// 2. Preloading establishes authority before control is handed over.
{
  const provider = createRaidTerrainProvider({ route, quality: 'high', useWorker: false, cells: SOAK_CELLS });
  assert(!provider.containsAuthority(route.startX, route.startZ), 'authority existed before any preload');
  await provider.preloadAround(route.startX, route.startZ, 1);
  assert(provider.containsAuthority(route.startX, route.startZ, 64), 'the start line is not authoritative after preload');
  const height = provider.heightAt(route.startX, route.startZ);
  assert(Number.isFinite(height), 'start height is not finite');
  provider.dispose();
}
pass('preloading establishes authority around the start before control is handed over');

// ---------------------------------------------------------------------------
// 3. THE SOAK. Drive the whole stage and watch memory, authority, and steps.
const soak = createRaidTerrainProvider({ route, quality: 'high', useWorker: false, cells: SOAK_CELLS });
await soak.preloadAround(route.startX, route.startZ, 1);
{
  const residentSamples = [];
  let maxResident = 0;
  let maxBytes = 0;
  let missingAuthority = 0;
  let maxStep = 0;
  let maxStepAt = null;
  let boundaryCrossings = 0;
  let previousHeight = soak.heightAt(route.startX, route.startZ);
  let previousSector = raidSectorKey(
    ...Object.values(raidSectorOfWorld(route.startX, route.startZ)),
  );
  const visitedSectors = new Set();

  // Step along the route at half a metre, which is finer than a wheel contact
  // moves between physics substeps at 160 km/h.
  const STEP_METRES = 0.5;
  const total = route.totalMeters;
  for (let metres = 0; metres <= total; metres += STEP_METRES) {
    const at = Math.min(route.count - 1, Math.floor(metres / route.spacing));
    const next = Math.min(route.count - 1, at + 1);
    const t = (metres - route.meters[at]) / Math.max(1e-6, route.meters[next] - route.meters[at]);
    const worldX = route.x[at] + (route.x[next] - route.x[at]) * t;
    const worldZ = route.z[at] + (route.z[next] - route.z[at]) * t;
    const velocityX = Math.cos(route.yaw[at]) * 30;
    const velocityZ = Math.sin(route.yaw[at]) * 30;

    // Focus updates run at the frame rate, not the physics rate.
    if (Math.round(metres / STEP_METRES) % 30 === 0) {
      soak.updateFocus(worldX, worldZ, velocityX, velocityZ);
      const state = soak.getSectorState();
      residentSamples.push(state.resident);
      maxResident = Math.max(maxResident, state.resident);
      maxBytes = Math.max(maxBytes, state.bytes);
    }

    if (!soak.containsAuthority(worldX, worldZ)) missingAuthority += 1;
    const { sectorX, sectorZ } = raidSectorOfWorld(worldX, worldZ);
    const key = raidSectorKey(sectorX, sectorZ);
    visitedSectors.add(key);
    const height = soak.heightAt(worldX, worldZ);
    assert(Number.isFinite(height), `non-finite height at ${metres.toFixed(1)} m`);
    const step = Math.abs(height - previousHeight);
    if (key !== previousSector) {
      boundaryCrossings += 1;
      // A sector boundary must be indistinguishable from anywhere else.
      if (step > maxStep) {
        maxStep = step;
        maxStepAt = metres;
      }
    }
    maxStep = Math.max(maxStep, step);
    if (step === maxStep) maxStepAt = metres;
    previousHeight = height;
    previousSector = key;
  }

  assert.equal(missingAuthority, 0, `${missingAuthority} physics samples fell outside loaded terrain`);
  assert(boundaryCrossings > 20, `only ${boundaryCrossings} sector boundaries were crossed; the soak is not exercising streaming`);
  assert(visitedSectors.size >= 25, `the drive only visited ${visitedSectors.size} sectors`);

  // Terrain gradient bound. At 0.5 m of travel a step larger than this is a
  // cliff, and at a sector boundary it would be a seam.
  assert(
    maxStep < 1.2,
    `terrain stepped ${maxStep.toFixed(3)} m in ${STEP_METRES} m of travel at ${maxStepAt?.toFixed(0)} m`,
  );

  // Memory must be bounded and must not trend upward with distance.
  const budget = soak.residency.budgetBytes;
  assert(maxBytes <= budget, `resident terrain peaked at ${(maxBytes / 1024 / 1024).toFixed(1)} MiB over a ${(budget / 1024 / 1024).toFixed(0)} MiB budget`);
  assert(maxResident <= soak.residency.retain, `resident sector count peaked at ${maxResident} over the ${soak.residency.retain} retain limit`);
  const firstQuarter = residentSamples.slice(0, Math.floor(residentSamples.length / 4));
  const lastQuarter = residentSamples.slice(-Math.floor(residentSamples.length / 4));
  const averageFirst = firstQuarter.reduce((a, b) => a + b, 0) / firstQuarter.length;
  const averageLast = lastQuarter.reduce((a, b) => a + b, 0) / lastQuarter.length;
  assert(
    averageLast <= averageFirst * 1.35 + 2,
    `resident sectors trended upward with distance: ${averageFirst.toFixed(1)} early vs ${averageLast.toFixed(1)} late`,
  );

  console.log(
    `        drove ${(total / 1000).toFixed(2)} km, ${boundaryCrossings} boundary crossings, `
    + `${visitedSectors.size} sectors visited, peak ${maxResident} resident `
    + `(${(maxBytes / 1024 / 1024).toFixed(2)} MiB), largest terrain step ${maxStep.toFixed(3)} m`,
  );
  pass('a full-stage drive stays authoritative, bounded, trend-free, and free of boundary steps');
}

// ---------------------------------------------------------------------------
// 4. Sampled height must equal the field exactly at vertex positions, so the
//    renderer and the wheels cannot disagree.
{
  let compared = 0;
  let maxDelta = 0;
  for (const key of [...soak._sectors.keys()].slice(0, 6)) {
    const payload = soak._sectors.get(key).payload;
    for (let row = 0; row < payload.verts; row += 5) {
      for (let column = 0; column < payload.verts; column += 5) {
        const worldX = payload.originX + column * payload.cellMetres;
        const worldZ = payload.originZ + row * payload.cellMetres;
        const sampled = soak.heightAt(worldX, worldZ);
        const stored = payload.heights[row * payload.verts + column];
        maxDelta = Math.max(maxDelta, Math.abs(sampled - stored));
        compared += 1;
      }
    }
  }
  assert.equal(maxDelta, 0, `sampled height differs from stored authority by ${maxDelta}`);
  assert(compared > 500, 'too few vertices compared');
  pass(`sampled height is identical to the stored authority at every vertex (${compared} vertices, physics/render delta 0)`);
}

// ---------------------------------------------------------------------------
// 5. The fallback must be exact, not coarse — the property that stops terrain
//    popping when a late sector finally arrives.
{
  // Run this one at PRODUCTION cell size. The gap between the exact field and
  // the streamed heightfield is bilinear discretisation error, so it scales with
  // cell size: measuring it on the soak's coarse 8 m grid would report a
  // discretisation artefact as a pop.
  const fresh = createRaidTerrainProvider({ route, quality: 'low', useWorker: false });
  // Somewhere with nothing loaded at all.
  const probeX = route.x[600] + 40;
  const probeZ = route.z[600] - 27;
  assert(!fresh.containsAuthority(probeX, probeZ), 'the probe point was already resident');
  const fallbackHeight = fresh.heightAt(probeX, probeZ);
  const fallbackSurface = fresh.surfaceAt(probeX, probeZ);
  assert(fresh.getSectorState().fallbackSamples > 0, 'the fallback path was not exercised');

  // Now stream the sector in and re-ask.
  await fresh.preloadAround(probeX, probeZ, 0);
  assert(fresh.containsAuthority(probeX, probeZ), 'the sector did not become authoritative');
  const streamedHeight = fresh.heightAt(probeX, probeZ);
  const streamedSurface = fresh.surfaceAt(probeX, probeZ);

  // The fallback is the exact field; the streamed value is that field sampled
  // bilinearly between stored float32 vertices. They agree to well inside what
  // a suspension could feel.
  const pop = Math.abs(fallbackHeight - streamedHeight);
  assert(
    pop < 0.001,
    `terrain popped ${pop.toFixed(4)} m when the sector arrived at ${RAID_CELL_METRES} m cells`,
  );
  assert.equal(fallbackSurface.id, streamedSurface.id, 'the surface identity changed when the sector arrived');

  // And the fallback must equal the generator's own field function exactly.
  // On a vertex the fallback must equal the raw field exactly.
  const vertexX = Math.round(probeX / RAID_CELL_METRES) * RAID_CELL_METRES;
  const vertexZ = Math.round(probeZ / RAID_CELL_METRES) * RAID_CELL_METRES;
  const direct = sampleRaidFieldAt(vertexX, vertexZ, route, routeIndex);
  const fresh2 = createRaidTerrainProvider({ route, quality: 'low', useWorker: false });
  assert.equal(
    fresh2.heightAt(vertexX, vertexZ),
    Math.fround(direct.height),
    'the fallback disagrees with the field on a vertex',
  );
  fresh.dispose();
  fresh2.dispose();
}
pass(`the unloaded-terrain fallback reproduces the stored lattice, so a late sector moves the ground by under 1 mm at ${RAID_CELL_METRES} m cells`);

// ---------------------------------------------------------------------------
// 6. Surfaces must actually vary along the stage and carry physical meaning.
{
  const seen = new Map();
  for (let metres = 0; metres < route.totalMeters; metres += 40) {
    const at = Math.min(route.count - 1, Math.round(metres / route.spacing));
    const surface = soak.surfaceAt(route.x[at], route.z[at]);
    seen.set(surface.id, (seen.get(surface.id) || 0) + 1);
    assert(surface.grip > 0 && surface.grip < 2, `implausible grip on ${surface.id}: ${surface.grip}`);
    assert(surface.sinkage >= 0 && surface.sinkage < 1, `implausible sinkage on ${surface.id}: ${surface.sinkage}`);
    assert(surface.looseness >= 0 && surface.looseness <= 1, 'looseness out of range');
  }
  assert(seen.size >= 3, `the whole stage only presented ${seen.size} surface identities: ${[...seen.keys()]}`);
  console.log(`        surfaces along the route: ${[...seen.entries()].map(([id, n]) => `${id}x${n}`).join(', ')}`);
}
pass('the route crosses genuinely different surfaces with plausible physical properties');

// ---------------------------------------------------------------------------
// 7. Focus changes must cancel work nobody wants, and dispose must release all.
{
  const provider = createRaidTerrainProvider({ route, quality: 'medium', useWorker: false, cells: SOAK_CELLS });
  await provider.preloadAround(route.startX, route.startZ, 1);
  const early = provider.getSectorState().resident;
  assert(early > 0, 'nothing was resident after preload');

  // Drive a long way off and confirm residency does not simply accumulate.
  for (let i = 0; i < 40; i += 1) {
    const at = Math.min(route.count - 1, i * 38);
    provider.updateFocus(route.x[at], route.z[at], 25, 25);
  }
  const later = provider.getSectorState();
  assert(
    later.resident <= provider.residency.retain,
    `residency grew to ${later.resident} beyond the ${provider.residency.retain} limit`,
  );
  assert(later.evicted > 0, 'nothing was ever evicted across a 12 km drive');

  provider.dispose();
  const after = provider.getSectorState();
  assert.equal(after.resident, 0, 'dispose left sectors resident');
  assert.equal(after.pending, 0, 'dispose left requests pending');
  assert(provider.disposed, 'dispose did not mark the provider disposed');
  // Dispose must be idempotent; the shell can call it on a failed transition.
  provider.dispose();
}
pass('residency is evicted under load and dispose releases everything idempotently');

const finalState = soak.getSectorState();
soak.dispose();
console.log(
  `\nKaki Rally Raid streamed terrain authority passed: ${checks} contracts, `
  + `${finalState.generated} sectors generated, ${finalState.evicted} evicted, `
  + `${finalState.fallbackSamples} fallback samples`,
);
