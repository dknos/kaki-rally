// Kaki Rally Raid — metre-native route runtime.
//
// A rally-raid stage is measured in kilometres, not laps or normalised
// progress. Everything downstream — roadbook notes, the tripmaster, waypoint
// validation, terrain zone pacing, penalties, and the finish control — reads
// distance in metres off this runtime, so the route is resampled to a uniform
// arc-length spacing once and then indexed for cheap nearest queries.
//
// Two rules this module exists to enforce:
//
//  1. Route progress may never jump forward just because the vehicle happens to
//     be geographically near a later segment. Stages fold back on themselves in
//     canyons and switchbacks, so the nearest-sample query is windowed around
//     the last plausible position by default. An unwindowed search exists, but
//     only for resume and recovery, and it never advances official progress.
//
//  2. The route is a navigational corridor, not a road. Corridor width is
//     authored per stage and is used to condition terrain and to judge how far
//     off-route the vehicle is, never to build a collidable ribbon.
//
// Pure JavaScript with no renderer dependency, so the whole runtime is testable
// headlessly in Node.

import { clamp, mix, smoothstep } from './raidSurfaceField.js';
import { resolveRaidFeatures } from './raidTerrainFeatures.js';

// Uniform arc-length spacing of resampled route points, in metres. Eight metres
// keeps a 24 km stage at 3000 samples — small enough to hold in typed arrays and
// scan cheaply, fine enough that yaw and corridor width read smoothly.
export const RAID_ROUTE_SPACING = 8;

// Spatial index cell size, in metres.
const INDEX_CELL = 96;

// How far ahead and behind the last known reference the windowed nearest query
// looks. Wide enough to survive a fast crash-and-recover, narrow enough that a
// parallel track 400 m away across a wadi cannot capture progress.
export const RAID_ROUTE_WINDOW_METRES = 900;

// ---------------------------------------------------------------------------
// Spline
// ---------------------------------------------------------------------------

// Centripetal Catmull-Rom. Centripetal parameterisation is what stops the
// authored control polygon from forming cusps or self-intersections on the
// tight canyon turns, which would put a kink in the measured distance.
function catmullRomKnot(previous, x0, z0, x1, z1, alpha = 0.5) {
  const distance = Math.hypot(x1 - x0, z1 - z0);
  return previous + Math.pow(Math.max(distance, 1e-6), alpha);
}

function catmullRomPoint(p0, p1, p2, p3, t0, t1, t2, t3, t, target) {
  const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / (t1 - t0);
  const a1z = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / (t1 - t0);
  const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / (t2 - t1);
  const a2z = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / (t2 - t1);
  const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / (t3 - t2);
  const a3z = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / (t3 - t2);
  const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
  const b1z = ((t2 - t) * a1z + (t - t0) * a2z) / (t2 - t0);
  const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
  const b2z = ((t3 - t) * a2z + (t - t1) * a3z) / (t3 - t1);
  target[0] = ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1);
  target[1] = ((t2 - t) * b1z + (t - t1) * b2z) / (t2 - t1);
  return target;
}

// Densely sample the authored control polygon, then resample that polyline at a
// uniform arc-length spacing. Two passes rather than one because a spline's
// parameter is not its arc length, and the tripmaster must read true metres.
function resampleRoute(controlPoints, spacing) {
  if (controlPoints.length < 2) throw new Error('A Raid route needs at least two control points');

  // Duplicate the endpoints so the spline reaches its first and last control.
  const points = [
    controlPoints[0],
    ...controlPoints,
    controlPoints[controlPoints.length - 1],
  ];

  const dense = [];
  const scratch = [0, 0];
  for (let segment = 1; segment + 2 < points.length; segment += 1) {
    const p0 = points[segment - 1];
    const p1 = points[segment];
    const p2 = points[segment + 1];
    const p3 = points[segment + 2];
    const t0 = 0;
    const t1 = catmullRomKnot(t0, p0[0], p0[1], p1[0], p1[1]);
    const t2 = catmullRomKnot(t1, p1[0], p1[1], p2[0], p2[1]);
    const t3 = catmullRomKnot(t2, p2[0], p2[1], p3[0], p3[1]);
    // Enough steps that the densely sampled polyline is a faithful stand-in for
    // the curve even on a long, straight salt-flat leg.
    const steps = Math.max(24, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2));
    for (let step = 0; step < steps; step += 1) {
      const t = mix(t1, t2, step / steps);
      catmullRomPoint(p0, p1, p2, p3, t0, t1, t2, t3, t, scratch);
      dense.push([scratch[0], scratch[1]]);
    }
  }
  dense.push([
    controlPoints[controlPoints.length - 1][0],
    controlPoints[controlPoints.length - 1][1],
  ]);

  // Uniform arc-length resample.
  const samplesX = [dense[0][0]];
  const samplesZ = [dense[0][1]];
  let carried = 0;
  for (let index = 1; index < dense.length; index += 1) {
    const ax = dense[index - 1][0];
    const az = dense[index - 1][1];
    const bx = dense[index][0];
    const bz = dense[index][1];
    const segmentLength = Math.hypot(bx - ax, bz - az);
    if (!(segmentLength > 1e-9)) continue;
    let travelled = carried;
    while (travelled + spacing <= segmentLength) {
      travelled += spacing;
      const t = travelled / segmentLength;
      samplesX.push(mix(ax, bx, t));
      samplesZ.push(mix(az, bz, t));
    }
    carried = travelled - segmentLength;
  }
  // Always land the true finish on a sample so the finish control sits at the
  // stage's measured distance rather than up to one spacing short of it.
  const lastX = dense[dense.length - 1][0];
  const lastZ = dense[dense.length - 1][1];
  if (Math.hypot(lastX - samplesX[samplesX.length - 1], lastZ - samplesZ[samplesZ.length - 1]) > spacing * 0.25) {
    samplesX.push(lastX);
    samplesZ.push(lastZ);
  }
  return { samplesX, samplesZ };
}

// ---------------------------------------------------------------------------
// Route construction
// ---------------------------------------------------------------------------

function interpolateBands(bands, meters, key, fallback) {
  if (!bands?.length) return fallback;
  if (meters <= bands[0].atMeters) return bands[0][key];
  for (let index = 1; index < bands.length; index += 1) {
    if (meters > bands[index].atMeters) continue;
    const previous = bands[index - 1];
    const next = bands[index];
    const span = Math.max(1e-6, next.atMeters - previous.atMeters);
    return mix(previous[key], next[key], smoothstep(0, 1, (meters - previous.atMeters) / span));
  }
  return bands[bands.length - 1][key];
}

/**
 * Build the metre-native runtime for a stage blueprint.
 *
 * @param {object} blueprint stage blueprint (see raidStageBlueprints.js)
 * @returns {object} frozen route runtime
 */
export function buildRaidRoute(blueprint) {
  const spacing = Number(blueprint.routeSpacing) || RAID_ROUTE_SPACING;
  const { samplesX, samplesZ } = resampleRoute(blueprint.routeControls, spacing);
  const count = samplesX.length;
  if (count < 2) throw new Error('A Raid route resampled to fewer than two samples');

  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const yaw = new Float64Array(count);
  const meters = new Float64Array(count);
  const corridor = new Float64Array(count);

  for (let index = 0; index < count; index += 1) {
    x[index] = samplesX[index];
    z[index] = samplesZ[index];
  }
  // True cumulative distance along the resampled polyline. Not index*spacing:
  // the final sample is deliberately off-grid so the finish lands exactly.
  meters[0] = 0;
  for (let index = 1; index < count; index += 1) {
    meters[index] = meters[index - 1] + Math.hypot(x[index] - x[index - 1], z[index] - z[index - 1]);
  }
  for (let index = 0; index < count; index += 1) {
    const previous = Math.max(0, index - 1);
    const next = Math.min(count - 1, index + 1);
    yaw[index] = Math.atan2(z[next] - z[previous], x[next] - x[previous]);
  }

  const corridorBands = [...(blueprint.corridors || [])].sort((a, b) => a.atMeters - b.atMeters);
  const defaultCorridor = Number(blueprint.defaultCorridorWidth) || 160;
  for (let index = 0; index < count; index += 1) {
    corridor[index] = interpolateBands(corridorBands, meters[index], 'width', defaultCorridor);
  }

  const totalMeters = meters[count - 1];
  const zones = [...(blueprint.zones || [])].sort((a, b) => a.atMeters - b.atMeters);
  if (!zones.length) zones.push({ atMeters: 0, zone: 'hardpack-plateau' });
  if (zones[0].atMeters > 0) zones.unshift({ atMeters: 0, zone: zones[0].zone });

  // Authored terrain features are placed by ROUTE DISTANCE so authoring stays
  // metre-native, and resolved to world anchors exactly once, here. Everything
  // downstream — the sector generator, the worker, the physics fallback — reads
  // world metres only, which is what keeps the field pure.
  const features = resolveRaidFeatures(blueprint.features, {
    count, x, z, yaw, meters, spacing,
  });

  return Object.freeze({
    stageId: blueprint.id,
    seed: blueprint.seed >>> 0,
    windAngle: Number(blueprint.windAngle) || 0,
    spacing,
    count,
    x,
    z,
    yaw,
    meters,
    corridor,
    totalMeters,
    officialDistanceKm: Math.round((totalMeters / 1000) * 100) / 100,
    zones: Object.freeze(zones.map((band) => Object.freeze({ ...band }))),
    zoneBlendMetres: Number(blueprint.zoneBlendMetres) || 320,
    features,
    startX: x[0],
    startZ: z[0],
    startYaw: yaw[0],
    finishX: x[count - 1],
    finishZ: z[count - 1],
  });
}

// ---------------------------------------------------------------------------
// Terrain zone pacing
// ---------------------------------------------------------------------------

/**
 * Which terrain zone pair, and blend amount, applies at a route distance.
 * Returns ids plus t so callers can build a blend without importing the tables.
 */
export function raidRouteZoneAt(route, meters) {
  const bands = route.zones;
  const blend = route.zoneBlendMetres;
  let bandIndex = 0;
  for (let index = 1; index < bands.length; index += 1) {
    if (meters >= bands[index].atMeters) bandIndex = index;
    else break;
  }
  const current = bands[bandIndex];
  const next = bands[bandIndex + 1];
  if (!next) return { fromId: current.zone, toId: current.zone, t: 0 };
  // The transition is centred on the authored boundary so neither zone gets
  // clipped, and it is wide enough that no single sector spans the whole blend.
  const half = blend * 0.5;
  const start = next.atMeters - half;
  if (meters <= start) return { fromId: current.zone, toId: current.zone, t: 0 };
  const t = clamp((meters - start) / Math.max(1e-6, blend), 0, 1);
  return { fromId: current.zone, toId: next.zone, t };
}

// ---------------------------------------------------------------------------
// Spatial index
// ---------------------------------------------------------------------------

function cellKey(cx, cz) {
  // Pack two signed cell coordinates into one integer key. The stage is bounded
  // well inside +/- 2^15 cells (about 3100 km), so this cannot collide.
  return ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff);
}

/**
 * Uniform-grid index over route samples. Built once per stage; queried at the
 * physics rate, so it must never scan the whole route.
 */
export function buildRaidRouteIndex(route) {
  const buckets = new Map();
  for (let index = 0; index < route.count; index += 1) {
    const cx = Math.floor(route.x[index] / INDEX_CELL);
    const cz = Math.floor(route.z[index] / INDEX_CELL);
    const key = cellKey(cx, cz);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(index);
  }
  return Object.freeze({ cell: INDEX_CELL, buckets, route });
}

function projectOntoSegment(route, index, worldX, worldZ, result) {
  const next = Math.min(route.count - 1, index + 1);
  if (next === index) {
    result.meters = route.meters[index];
    result.x = route.x[index];
    result.z = route.z[index];
    result.yaw = route.yaw[index];
    result.distance = Math.hypot(worldX - result.x, worldZ - result.z);
    result.index = index;
    result.amount = 0;
    return result;
  }
  const ax = route.x[index];
  const az = route.z[index];
  const bx = route.x[next];
  const bz = route.z[next];
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared > 1e-12
    ? clamp(((worldX - ax) * dx + (worldZ - az) * dz) / lengthSquared, 0, 1)
    : 0;
  const px = ax + dx * t;
  const pz = az + dz * t;
  result.index = index;
  result.amount = t;
  result.x = px;
  result.z = pz;
  result.yaw = mixAngle(route.yaw[index], route.yaw[next], t);
  result.meters = mix(route.meters[index], route.meters[next], t);
  result.distance = Math.hypot(worldX - px, worldZ - pz);
  return result;
}

// Shortest-arc angle interpolation, so a route that crosses the +/-pi seam does
// not spin the CAP display through a full turn.
export function mixAngle(a, b, t) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

const NEAREST_SCRATCH = {
  index: 0, amount: 0, x: 0, z: 0, yaw: 0, meters: 0, distance: 0,
};

function betterOf(candidate, best) {
  if (!best || candidate.distance < best.distance) {
    return {
      index: candidate.index,
      amount: candidate.amount,
      x: candidate.x,
      z: candidate.z,
      yaw: candidate.yaw,
      meters: candidate.meters,
      distance: candidate.distance,
    };
  }
  return best;
}

/**
 * Nearest point on the route.
 *
 * `hintMeters` restricts the search to a window around the last plausible
 * reference. That windowing is what makes progress trustworthy on a route that
 * crosses itself: without it, driving under a switchback would teleport the
 * tripmaster kilometres forward. Pass `hintMeters: null` for the unwindowed
 * search used by resume and recovery, which callers must never feed straight
 * into official progress.
 */
export function nearestRaidRouteSample(index_, worldX, worldZ, {
  hintMeters = null,
  windowMetres = RAID_ROUTE_WINDOW_METRES,
} = {}) {
  const route = index_.route;
  let best = null;

  if (Number.isFinite(hintMeters)) {
    // Windowed scan in metre space. Sample spacing is uniform, so the window
    // maps to a bounded index range regardless of stage length.
    const span = Math.ceil(windowMetres / route.spacing);
    const centre = clamp(Math.round(hintMeters / route.spacing), 0, route.count - 1);
    const from = Math.max(0, centre - span);
    const to = Math.min(route.count - 1, centre + span);
    for (let i = from; i <= to; i += 1) {
      best = betterOf(projectOntoSegment(route, i, worldX, worldZ, NEAREST_SCRATCH), best);
    }
    return best;
  }

  // Unwindowed: expand rings of index cells until a hit is found, then check
  // one ring further so a sample just across a cell border cannot be missed.
  const cx = Math.floor(worldX / index_.cell);
  const cz = Math.floor(worldZ / index_.cell);
  // Expand Chebyshev rings of cells outward. Any cell at ring r+1 is at least
  // r * cell away from the query, so once the best match so far is closer than
  // that bound no further ring can beat it. Stopping at "the first ring that
  // contained anything" would be wrong: a query 2 km off-route can find a
  // distant sample in an early ring while the true nearest sits one ring out.
  //
  // The ring walk is capped deliberately. Its cost grows as the square of the
  // ring while a full scan of the route is linear in sample count, so for a
  // query far off-route — which is exactly what the sector generator asks about
  // when it classifies terrain kilometres from the corridor — the exhaustive
  // scan is both cheaper and exact. A 12 km stage is only ~1550 samples.
  const MAX_RING = 4;
  let conclusive = false;
  for (let ring = 0; ring <= MAX_RING; ring += 1) {
    if (best && (ring - 1) * index_.cell > best.distance) {
      conclusive = true;
      break;
    }
    for (let dz = -ring; dz <= ring; dz += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
        const bucket = index_.buckets.get(cellKey(cx + dx, cz + dz));
        if (!bucket) continue;
        for (const i of bucket) {
          best = betterOf(projectOntoSegment(route, Math.max(0, i - 1), worldX, worldZ, NEAREST_SCRATCH), best);
          best = betterOf(projectOntoSegment(route, i, worldX, worldZ, NEAREST_SCRATCH), best);
        }
      }
    }
  }
  if (!conclusive) {
    for (let i = 0; i < route.count; i += 1) {
      best = betterOf(projectOntoSegment(route, i, worldX, worldZ, NEAREST_SCRATCH), best);
    }
  }
  return best;
}

/**
 * Signed lateral offset from the route centreline, in metres. Positive is to
 * the right of the direction of travel.
 */
export function raidRouteLateral(sample, worldX, worldZ) {
  const rightX = Math.sin(sample.yaw);
  const rightZ = -Math.cos(sample.yaw);
  return (worldX - sample.x) * rightX + (worldZ - sample.z) * rightZ;
}

/** Authored corridor half-width, in metres, at a route distance. */
export function raidCorridorHalfWidth(route, meters) {
  const index = clamp(Math.round(meters / route.spacing), 0, route.count - 1);
  return route.corridor[index] * 0.5;
}
