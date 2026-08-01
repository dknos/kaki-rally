#!/usr/bin/env node

// Kaki Rally Raid — terrain sector seam contract.
//
// Sectors are generated independently, out of order, on workers, and possibly
// minutes apart. A 12 km stage crosses dozens of them, so a single mismatched
// boundary vertex is a visible crack and a physics step the suspension reads as
// a kerb. These assertions cover the guarantee at the level the player meets it:
// generated payloads, not just the underlying field.

import assert from 'node:assert/strict';

import {
  RAID_CELL_METRES,
  RAID_SECTOR_CELLS,
  RAID_SECTOR_METRES,
  RAID_SECTOR_VERTS,
  RAID_ZONE_LATTICE_METRES,
  generateRaidSector,
  raidSectorBytes,
  raidSectorKey,
  raidSectorOfWorld,
  serializeRaidRoute,
} from '../src/racing/raid/raidSectorGenerator.js';
import { buildRaidRoute, buildRaidRouteIndex } from '../src/racing/raid/raidRouteRuntime.js';
import { getRaidStage } from '../src/racing/raid/raidStageBlueprints.js';
import { RAID_SURFACE_ORDER, raidSurfaceByIndex } from '../src/racing/raid/raidSurfaceField.js';

let checks = 0;
function pass(message) {
  checks += 1;
  console.log(`  PASS  ${message}`);
}

console.log('Kaki Rally Raid terrain sectors');

const route = buildRaidRoute(getRaidStage('wadi-of-whiskers'));
const index = buildRaidRouteIndex(route);
const cache = new Map();
function sector(sectorX, sectorZ) {
  const key = raidSectorKey(sectorX, sectorZ);
  if (!cache.has(key)) cache.set(key, generateRaidSector({ sectorX, sectorZ, route, index }));
  return cache.get(key);
}

// ---------------------------------------------------------------------------
// 1. Geometry invariants that make seams exact by construction.
{
  assert.equal(RAID_SECTOR_METRES / RAID_SECTOR_CELLS, RAID_CELL_METRES, 'cell size is inconsistent');
  assert.equal(RAID_SECTOR_METRES % RAID_ZONE_LATTICE_METRES, 0, 'the coarse zone lattice does not divide the sector');
  assert.equal(Math.log2(RAID_SECTOR_METRES) % 1, 0, 'sector size is not a power of two');
  assert.equal(Math.log2(RAID_SECTOR_CELLS) % 1, 0, 'sector cell count is not a power of two');
  assert.equal(RAID_SECTOR_VERTS, RAID_SECTOR_CELLS + 1, 'sectors do not share a boundary vertex row');
  // Sector lookup must round toward negative infinity so the tile left of the
  // origin is -1 rather than 0.
  assert.deepEqual(raidSectorOfWorld(-1, -1), { sectorX: -1, sectorZ: -1 });
  assert.deepEqual(raidSectorOfWorld(0, 0), { sectorX: 0, sectorZ: 0 });
  assert.deepEqual(raidSectorOfWorld(RAID_SECTOR_METRES, 0), { sectorX: 1, sectorZ: 0 });
  assert.deepEqual(raidSectorOfWorld(-0.001, 0), { sectorX: -1, sectorZ: 0 });
}
pass(`sector geometry is power-of-two aligned and shares boundary vertices (${RAID_SECTOR_METRES} m / ${RAID_SECTOR_CELLS} cells / ${RAID_CELL_METRES} m)`);

// ---------------------------------------------------------------------------
// 2. Every shared edge in a 3x3 block must be bit-identical, in every channel.
{
  const blockOriginX = 4;
  const blockOriginZ = 1;
  let comparedVertices = 0;
  for (let dz = 0; dz < 3; dz += 1) {
    for (let dx = 0; dx < 3; dx += 1) {
      const here = sector(blockOriginX + dx, blockOriginZ + dz);
      const verts = here.verts;

      if (dx < 2) {
        const east = sector(blockOriginX + dx + 1, blockOriginZ + dz);
        for (let row = 0; row < verts; row += 1) {
          const a = row * verts + (verts - 1);
          const b = row * verts;
          assert.equal(here.heights[a], east.heights[b], `height seam east of sector ${dx},${dz} row ${row}`);
          assert.equal(here.surface[a], east.surface[b], `surface seam east of sector ${dx},${dz} row ${row}`);
          assert.equal(here.looseness[a], east.looseness[b], `looseness seam east of sector ${dx},${dz} row ${row}`);
          comparedVertices += 1;
        }
      }
      if (dz < 2) {
        const north = sector(blockOriginX + dx, blockOriginZ + dz + 1);
        for (let column = 0; column < verts; column += 1) {
          const a = (verts - 1) * verts + column;
          assert.equal(here.heights[a], north.heights[column], `height seam north of sector ${dx},${dz} column ${column}`);
          assert.equal(here.surface[a], north.surface[column], `surface seam north of sector ${dx},${dz} column ${column}`);
          assert.equal(here.looseness[a], north.looseness[column], `looseness seam north of sector ${dx},${dz} column ${column}`);
          comparedVertices += 1;
        }
      }
    }
  }
  // Corner agreement: the vertex shared by four sectors must be one value.
  const a = sector(blockOriginX, blockOriginZ);
  const b = sector(blockOriginX + 1, blockOriginZ);
  const c = sector(blockOriginX, blockOriginZ + 1);
  const d = sector(blockOriginX + 1, blockOriginZ + 1);
  const last = a.verts - 1;
  const corner = a.heights[last * a.verts + last];
  assert.equal(b.heights[last * b.verts + 0], corner, 'four-sector corner disagrees (east)');
  assert.equal(c.heights[0 * c.verts + last], corner, 'four-sector corner disagrees (north)');
  assert.equal(d.heights[0], corner, 'four-sector corner disagrees (diagonal)');
  pass(`every shared edge and corner in a 3x3 sector block agrees exactly (${comparedVertices} boundary vertices, 3 channels)`);
}

// ---------------------------------------------------------------------------
// 3. Seams must hold far from the origin, where float error would show first,
//    and across a terrain zone transition, where two fields are being mixed.
{
  // Out to roughly 25 km in both axes: twice the stage's own extent, which is
  // as far as a lost player could plausibly wander before extraction.
  const FAR_PAIRS = [
    [23, -17], [46, 41], [-47, -40],
  ];
  let compared = 0;
  for (const [sx, sz] of FAR_PAIRS) {
    const here = generateRaidSector({ sectorX: sx, sectorZ: sz, route, index });
    const east = generateRaidSector({ sectorX: sx + 1, sectorZ: sz, route, index });
    for (let row = 0; row < here.verts; row += 1) {
      assert.equal(
        here.heights[row * here.verts + (here.verts - 1)],
        east.heights[row * east.verts],
        `far seam mismatch at sector ${sx},${sz} row ${row} (${sx * RAID_SECTOR_METRES / 1000} km out)`,
      );
      compared += 1;
    }
  }
  // Zone transitions are authored at 2280 m, 4440 m, 8170 m and 11230 m. Find
  // the sectors those fall in and check their seams explicitly.
  const transitionSectors = new Set();
  for (const band of route.zones.slice(1)) {
    const at = Math.max(0, Math.min(route.count - 1, Math.round(band.atMeters / route.spacing)));
    const { sectorX, sectorZ } = raidSectorOfWorld(route.x[at], route.z[at]);
    transitionSectors.add(`${sectorX},${sectorZ}`);
  }
  assert(transitionSectors.size >= 3, 'could not locate the stage zone transitions');
  for (const key of transitionSectors) {
    const [sx, sz] = key.split(',').map(Number);
    const here = sector(sx, sz);
    const east = sector(sx + 1, sz);
    const north = sector(sx, sz + 1);
    for (let i = 0; i < here.verts; i += 1) {
      assert.equal(
        here.heights[i * here.verts + (here.verts - 1)],
        east.heights[i * east.verts],
        `zone-transition seam mismatch east of sector ${sx},${sz}`,
      );
      assert.equal(
        here.heights[(here.verts - 1) * here.verts + i],
        north.heights[i],
        `zone-transition seam mismatch north of sector ${sx},${sz}`,
      );
      compared += 2;
    }
  }
  pass(`seams hold out to 25 km from the origin and across every zone transition (${compared} boundary vertices, ${transitionSectors.size} transition sectors)`);
}

// ---------------------------------------------------------------------------
// 4. Generation must be deterministic and order-independent. A worker pool
//    completes sectors in whatever order it finishes them.
{
  const forward = [];
  for (const [sx, sz] of [[2, 0], [3, 0], [4, 0], [5, 1]]) {
    forward.push(generateRaidSector({ sectorX: sx, sectorZ: sz, route, index }));
  }
  const reverse = [];
  for (const [sx, sz] of [[5, 1], [4, 0], [3, 0], [2, 0]]) {
    reverse.unshift(generateRaidSector({ sectorX: sx, sectorZ: sz, route, index }));
  }
  for (let i = 0; i < forward.length; i += 1) {
    assert.deepEqual(forward[i].heights, reverse[i].heights, 'sector heights depend on generation order');
    assert.deepEqual(forward[i].surface, reverse[i].surface, 'sector surfaces depend on generation order');
    assert.deepEqual(forward[i].looseness, reverse[i].looseness, 'sector looseness depends on generation order');
  }
  // A rebuilt route index must not change the result either, since resume
  // reconstructs everything from the stage seed.
  const rebuiltIndex = buildRaidRouteIndex(buildRaidRoute(getRaidStage('wadi-of-whiskers')));
  const rebuilt = generateRaidSector({ sectorX: 4, sectorZ: 0, route, index: rebuiltIndex });
  assert.deepEqual(rebuilt.heights, forward[2].heights, 'sector generation depends on route index identity');
}
pass('sector generation is deterministic and independent of order and index identity');

// ---------------------------------------------------------------------------
// 5. Payload sanity: finite, bounded, correctly sized, and within budget.
{
  const payload = sector(4, 1);
  assert.equal(payload.heights.length, payload.verts * payload.verts, 'height array is the wrong size');
  assert.equal(payload.surface.length, payload.verts * payload.verts, 'surface array is the wrong size');
  assert(payload.heights instanceof Float32Array, 'heights are not a Float32Array');
  for (let i = 0; i < payload.heights.length; i += 1) {
    assert(Number.isFinite(payload.heights[i]), `non-finite height at index ${i}`);
  }
  assert(Number.isFinite(payload.minimum) && Number.isFinite(payload.maximum), 'payload bounds are not finite');
  assert(payload.maximum >= payload.minimum, 'payload bounds are inverted');
  const observedSurfaces = new Set();
  for (let i = 0; i < payload.surface.length; i += 1) {
    const surface = raidSurfaceByIndex(payload.surface[i]);
    assert(surface, `unknown surface index ${payload.surface[i]}`);
    observedSurfaces.add(surface.id);
    assert(payload.surface[i] < RAID_SURFACE_ORDER.length, 'surface index out of range');
  }
  assert(observedSurfaces.size >= 2, `a whole sector reported only ${observedSurfaces.size} surface identity`);
  // Memory budget: the low quality tier allows 32 MiB of active terrain, so a
  // single sector must stay small enough for a useful residency ring.
  const bytes = raidSectorBytes();
  assert.equal(bytes, payload.verts * payload.verts * 6, 'declared sector cost disagrees with the payload');
  assert(bytes < 512 * 1024, `a sector costs ${(bytes / 1024).toFixed(0)} KiB, too much for a residency ring`);
  const residency = 16;
  assert(
    bytes * residency < 32 * 1024 * 1024,
    `${residency} resident sectors would cost ${(bytes * residency / 1024 / 1024).toFixed(1)} MiB, over the low-tier budget`,
  );
}
pass(`sector payloads are finite, varied, and ${(raidSectorBytes() / 1024).toFixed(0)} KiB each (16 resident = ${(raidSectorBytes() * 16 / 1024 / 1024).toFixed(1)} MiB)`);

// ---------------------------------------------------------------------------
// 6. Relief must be real. A "streamed desert" that is actually flat would pass
//    every seam test above while being nothing to drive on.
{
  const RELIEF_BANDS = {
    'salt-flat': [0.4, 4],
    'hardpack-plateau': [4, 14],
    'rolling-dunes': [9, 26],
    'dune-sea': [22, 52],
    'wadi-gravel': [7, 22],
    'rock-shelf': [15, 42],
    'powder-basin': [2.5, 10],
  };
  // Drive the stage and confirm the terrain under the route actually changes.
  let stageMin = Infinity;
  let stageMax = -Infinity;
  const visited = new Set();
  for (let i = 0; i < route.count; i += 12) {
    const { sectorX, sectorZ } = raidSectorOfWorld(route.x[i], route.z[i]);
    const key = raidSectorKey(sectorX, sectorZ);
    if (visited.has(key)) continue;
    visited.add(key);
    const payload = sector(sectorX, sectorZ);
    stageMin = Math.min(stageMin, payload.minimum);
    stageMax = Math.max(stageMax, payload.maximum);
  }
  assert(
    stageMax - stageMin > 18,
    `the whole stage only spans ${(stageMax - stageMin).toFixed(1)} m of elevation; it is not a desert crossing`,
  );
  assert(visited.size >= 12, `the route only crosses ${visited.size} sectors; the stage is not long enough to stream`);
  console.log(
    `        stage crosses ${visited.size} sectors spanning ${(stageMax - stageMin).toFixed(1)} m of elevation`,
  );
  // And each authored zone must deliver relief in its intended band.
  const { getRaidZone, raidZoneHeight } = await import('../src/racing/raid/raidSurfaceField.js');
  for (const [zoneId, [low, high]] of Object.entries(RELIEF_BANDS)) {
    const zone = getRaidZone(zoneId);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const [ox, oz] of [[0, 0], [3000, 4000], [-5120, 2048], [8000, -3000]]) {
      for (let r = 0; r <= 128; r += 1) {
        for (let c = 0; c <= 128; c += 1) {
          const h = raidZoneHeight(ox + c * 4, oz + r * 4, zone, route.seed, route.windAngle);
          minimum = Math.min(minimum, h);
          maximum = Math.max(maximum, h);
        }
      }
    }
    const relief = maximum - minimum;
    assert(
      relief >= low && relief <= high,
      `${zoneId} delivers ${relief.toFixed(1)} m of relief, outside its authored ${low}..${high} m band`,
    );
  }
}
pass('the stage has real elevation and every zone stays inside its authored relief band');

// ---------------------------------------------------------------------------
// 7. Route serialisation for workers must survive structured cloning.
{
  const serialized = serializeRaidRoute(route);
  const cloned = structuredClone(serialized);
  assert.equal(cloned.count, route.count, 'route sample count did not survive cloning');
  assert.equal(cloned.totalMeters, route.totalMeters, 'route distance did not survive cloning');
  assert(cloned.x instanceof Float64Array, 'route x did not survive cloning as a typed array');
  assert.equal(cloned.zones.length, route.zones.length, 'zone bands did not survive cloning');
  // A sector generated from the cloned route must be identical.
  const clonedIndex = buildRaidRouteIndex(cloned);
  const fromClone = generateRaidSector({ sectorX: 4, sectorZ: 1, route: cloned, index: clonedIndex });
  assert.deepEqual(fromClone.heights, sector(4, 1).heights, 'a worker-cloned route generates different terrain');
}
pass('route data survives structured cloning and generates identical terrain in a worker');

console.log(`\nKaki Rally Raid terrain sectors passed: ${checks} contracts`);
