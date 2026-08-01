// Kaki Rally Raid — deterministic terrain sector generator.
//
// A sector is a square tile of the desert, generated independently and in any
// order, on the main thread or in a worker. Correctness rests on two rules:
//
//  1. Every value is a pure function of GLOBAL world metres. Nothing is
//     computed from a sector-local coordinate, a grid index, or a neighbour's
//     result, so two sectors that share an edge produce identical values there
//     by construction rather than by a stitching pass.
//
//  2. The terrain zone field is sampled on a COARSE LATTICE THAT IS ALSO
//     GLOBAL. The coarse spacing divides the sector size exactly, so a sector's
//     boundary vertices land on shared coarse nodes and interpolate from the
//     same neighbours as the sector next door. A per-sector-local coarse grid
//     would reintroduce the seam the fine grid just avoided.
//
// The route is NOT graded into the terrain. A rally-raid corridor is a
// navigational instruction, not a road: the desert stays natural and the player
// picks a line through it. That is also why no per-vertex route query is needed
// on the fine grid.

import {
  RAID_ZONE_ORDER,
  blendRaidZones,
  classifyRaidSurface,
  clamp,
  getRaidZone,
  raidLooseness,
  raidRelief,
  raidSurfaceIndex,
  raidZoneHeightParts,
} from './raidSurfaceField.js';
import {
  buildRaidRouteIndex,
  nearestRaidRouteSample,
  raidRouteZoneAt,
} from './raidRouteRuntime.js';
import {
  EMPTY_FEATURES,
  RAID_FEATURE_PAD_SURFACE_THRESHOLD,
  applyRaidFeatures,
  evaluateRaidFeatures,
  selectRaidFeaturesNear,
} from './raidTerrainFeatures.js';

// Sector geometry. Both are powers of two so every vertex world coordinate is
// an exact integer at any distance from the origin.
export const RAID_SECTOR_METRES = 512;
export const RAID_SECTOR_CELLS = 256;
export const RAID_SECTOR_VERTS = RAID_SECTOR_CELLS + 1;
export const RAID_CELL_METRES = RAID_SECTOR_METRES / RAID_SECTOR_CELLS;

// Coarse zone lattice. 32 m divides 512 m exactly, so the lattice is global.
export const RAID_ZONE_LATTICE_METRES = 32;
const ZONE_LATTICE_CELLS = RAID_SECTOR_METRES / RAID_ZONE_LATTICE_METRES;
const ZONE_LATTICE_VERTS = ZONE_LATTICE_CELLS + 1;

const ZONE_COUNT = RAID_ZONE_ORDER.length;

export function raidSectorOfWorld(worldX, worldZ) {
  return {
    sectorX: Math.floor(worldX / RAID_SECTOR_METRES),
    sectorZ: Math.floor(worldZ / RAID_SECTOR_METRES),
  };
}

export function raidSectorKey(sectorX, sectorZ) {
  return `${sectorX}|${sectorZ}`;
}

// ---------------------------------------------------------------------------
// Zone weight field
// ---------------------------------------------------------------------------

// Terrain-zone weights at one coarse lattice node. The route decides which
// identity the desert has here, via the nearest point on it: a stage authored
// as "wadi from 2.3 km to 4.4 km" means the land around that stretch of route
// is wadi, however far off the corridor the player strays.
function zoneWeightsAt(worldX, worldZ, route, index, out, offset) {
  const sample = nearestRaidRouteSample(index, worldX, worldZ, { hintMeters: null });
  const zone = raidRouteZoneAt(route, sample.meters);
  for (let i = 0; i < ZONE_COUNT; i += 1) out[offset + i] = 0;
  const fromIndex = RAID_ZONE_ORDER.indexOf(zone.fromId);
  const toIndex = RAID_ZONE_ORDER.indexOf(zone.toId);
  if (fromIndex < 0 || toIndex < 0) {
    out[offset + RAID_ZONE_ORDER.indexOf('hardpack-plateau')] = 1;
    return;
  }
  out[offset + fromIndex] += 1 - zone.t;
  out[offset + toIndex] += zone.t;
}

// Build the coarse zone-weight lattice covering one sector, inclusive of both
// edges AND one node of margin beyond each edge.
//
// The margin is what lets the height apron be evaluated correctly. Clamping the
// lattice lookup at the sector edge instead would make an apron vertex use this
// sector's edge weights rather than the true weights one node further out, and
// the neighbouring sector — for which that same vertex is interior — would
// disagree. Every node here is addressed in global metres, so both sectors read
// the same nodes for the same world position.
const LATTICE_MARGIN_NODES = 1;
const LATTICE_VERTS = ZONE_LATTICE_VERTS + LATTICE_MARGIN_NODES * 2;
const LATTICE_MARGIN_METRES = LATTICE_MARGIN_NODES * RAID_ZONE_LATTICE_METRES;

function buildZoneLattice(sectorX, sectorZ, route, index) {
  const weights = new Float64Array(LATTICE_VERTS * LATTICE_VERTS * ZONE_COUNT);
  const originX = sectorX * RAID_SECTOR_METRES - LATTICE_MARGIN_NODES * RAID_ZONE_LATTICE_METRES;
  const originZ = sectorZ * RAID_SECTOR_METRES - LATTICE_MARGIN_NODES * RAID_ZONE_LATTICE_METRES;
  for (let row = 0; row < LATTICE_VERTS; row += 1) {
    const worldZ = originZ + row * RAID_ZONE_LATTICE_METRES;
    for (let column = 0; column < LATTICE_VERTS; column += 1) {
      const worldX = originX + column * RAID_ZONE_LATTICE_METRES;
      zoneWeightsAt(worldX, worldZ, route, index, weights, (row * LATTICE_VERTS + column) * ZONE_COUNT);
    }
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Sector generation
// ---------------------------------------------------------------------------

const ZONE_PARAMS = RAID_ZONE_ORDER.map((id) => getRaidZone(id));
const SCRATCH_WEIGHTS = new Float64Array(ZONE_COUNT);

/**
 * Generate one terrain sector.
 *
 * @returns {object} payload with transferable typed arrays
 */
export function generateRaidSector({
  sectorX,
  sectorZ,
  route,
  index = null,
  cells = RAID_SECTOR_CELLS,
}) {
  const routeIndex = index || buildRaidRouteIndex(route);
  const verts = cells + 1;
  const cellMetres = RAID_SECTOR_METRES / cells;
  const seed = route.seed | 0;
  const windAngle = route.windAngle;
  const originX = sectorX * RAID_SECTOR_METRES;
  const originZ = sectorZ * RAID_SECTOR_METRES;

  // Authored features that can reach this sector's apron. Filtering preserves
  // array order and drops only features that contribute an exact zero here, so
  // the result is bit-identical to scanning the whole list.
  const sectorFeatures = selectRaidFeaturesNear(
    route.features || EMPTY_FEATURES,
    originX - cellMetres, originZ - cellMetres,
    originX + RAID_SECTOR_METRES + cellMetres, originZ + RAID_SECTOR_METRES + cellMetres,
  );
  const hasFeatures = sectorFeatures.length > 0;

  const lattice = buildZoneLattice(sectorX, sectorZ, route, routeIndex);
  const heights = new Float32Array(verts * verts);
  const surface = new Uint8Array(verts * verts);
  const looseness = new Uint8Array(verts * verts);
  let minimum = Infinity;
  let maximum = -Infinity;

  // Pass one is evaluated on an apron one vertex wider than the sector on every
  // side. The apron exists so slope at a boundary vertex is a central
  // difference across the real neighbour rather than a one-sided guess — and
  // because the field is global, the apron values are exactly the neighbouring
  // sector's interior values, so the classification agrees from both sides.
  const apron = verts + 2;
  const apronHeight = new Float64Array(apron * apron);
  const apronMacro = new Float64Array(apron * apron);
  const dominantZone = new Uint8Array(verts * verts);
  const blendedRoughness = new Float32Array(verts * verts);
  const blendedRockiness = new Float32Array(verts * verts);
  const blendedSoftness = new Float32Array(verts * verts);
  // Feature channels are only allocated on a sector that actually holds one, so
  // a stage without features costs nothing at all.
  const featurePad = hasFeatures ? new Float32Array(verts * verts) : null;
  const featureSurface = hasFeatures ? new Uint8Array(verts * verts) : null;
  const featureLooseness = hasFeatures ? new Float32Array(verts * verts) : null;
  const featureFx = { relief: 0, pad: 0, surface: null, looseness: 0 };
  const featureState = { height: 0, macro: 0 };
  const parts = { macro: 0, height: 0 };

  for (let row = -1; row <= verts; row += 1) {
    const worldZ = originZ + row * cellMetres;
    // Lattice coordinates are offset by the margin, so an apron vertex outside
    // the sector still interpolates from the correct global nodes.
    const latticeZ = (row * cellMetres + LATTICE_MARGIN_METRES) / RAID_ZONE_LATTICE_METRES;
    const lz0 = clamp(Math.floor(latticeZ), 0, LATTICE_VERTS - 1);
    const lz1 = Math.min(LATTICE_VERTS - 1, lz0 + 1);
    const tz = latticeZ - lz0;

    for (let column = -1; column <= verts; column += 1) {
      const worldX = originX + column * cellMetres;
      const latticeX = (column * cellMetres + LATTICE_MARGIN_METRES) / RAID_ZONE_LATTICE_METRES;
      const lx0 = clamp(Math.floor(latticeX), 0, LATTICE_VERTS - 1);
      const lx1 = Math.min(LATTICE_VERTS - 1, lx0 + 1);
      const tx = latticeX - lx0;

      // Bilinear blend of the four surrounding coarse zone-weight vectors.
      const i00 = (lz0 * LATTICE_VERTS + lx0) * ZONE_COUNT;
      const i10 = (lz0 * LATTICE_VERTS + lx1) * ZONE_COUNT;
      const i01 = (lz1 * LATTICE_VERTS + lx0) * ZONE_COUNT;
      const i11 = (lz1 * LATTICE_VERTS + lx1) * ZONE_COUNT;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;

      let dominant = 0;
      let dominantWeight = -1;
      let height = 0;
      let macro = 0;
      let roughness = 0;
      let rockiness = 0;
      let softness = 0;
      for (let zone = 0; zone < ZONE_COUNT; zone += 1) {
        const weight = lattice[i00 + zone] * w00
          + lattice[i10 + zone] * w10
          + lattice[i01 + zone] * w01
          + lattice[i11 + zone] * w11;
        SCRATCH_WEIGHTS[zone] = weight;
        if (weight > dominantWeight) {
          dominantWeight = weight;
          dominant = zone;
        }
        // Skip the noise entirely for zones that contribute nothing here. In
        // practice one or two zones are active, so a seven-zone table costs
        // about the same as a single-zone field outside transitions.
        if (weight <= 1e-6) continue;
        const params = ZONE_PARAMS[zone];
        raidZoneHeightParts(worldX, worldZ, params, seed, windAngle, parts);
        height += parts.height * weight;
        macro += parts.macro * weight;
        roughness += params.roughness * weight;
        rockiness += params.rockiness * weight;
        softness += params.softness * weight;
      }

      if (hasFeatures) {
        evaluateRaidFeatures(worldX, worldZ, sectorFeatures, featureFx);
        featureState.height = height;
        featureState.macro = macro;
        applyRaidFeatures(featureState, featureFx);
        height = featureState.height;
        macro = featureState.macro;
      }

      const apronIndex = (row + 1) * apron + (column + 1);
      apronHeight[apronIndex] = height;
      apronMacro[apronIndex] = macro;

      if (row >= 0 && row < verts && column >= 0 && column < verts) {
        const vertexIndex = row * verts + column;
        if (hasFeatures) {
          featurePad[vertexIndex] = featureFx.pad;
          featureSurface[vertexIndex] = featureFx.surface ? raidSurfaceIndex(featureFx.surface) + 1 : 0;
          featureLooseness[vertexIndex] = featureFx.looseness;
        }
        const stored = Math.fround(height);
        heights[vertexIndex] = stored;
        if (stored < minimum) minimum = stored;
        if (stored > maximum) maximum = stored;
        dominantZone[vertexIndex] = dominant;
        blendedRoughness[vertexIndex] = roughness;
        blendedRockiness[vertexIndex] = rockiness;
        blendedSoftness[vertexIndex] = softness;
      }
    }
  }

  // Pass two: slope and local relief from the apron, then surface identity.
  const soloBlends = ZONE_PARAMS.map((zone) => blendRaidZones(zone.id, zone.id, 0));
  const classifyParams = {
    rockiness: 0, softness: 0, roughness: 0, ridgeHeight: 0, detailHeight: 0,
    baseSurface: 'hardpack', crestSurface: 'hardpack', hollowSurface: 'hardpack',
  };
  for (let row = 0; row < verts; row += 1) {
    const worldZ = originZ + row * cellMetres;
    for (let column = 0; column < verts; column += 1) {
      const worldX = originX + column * cellMetres;
      const vertexIndex = row * verts + column;
      const a = (row + 1) * apron + (column + 1);
      const west = apronHeight[a - 1];
      const east = apronHeight[a + 1];
      const south = apronHeight[a - apron];
      const north = apronHeight[a + apron];
      const slope = Math.hypot((east - west) / (2 * cellMetres), (north - south) / (2 * cellMetres));

      const zone = ZONE_PARAMS[dominantZone[vertexIndex]];
      const dominantBlend = soloBlends[dominantZone[vertexIndex]];
      classifyParams.rockiness = blendedRockiness[vertexIndex];
      classifyParams.softness = blendedSoftness[vertexIndex];
      classifyParams.roughness = blendedRoughness[vertexIndex];
      classifyParams.ridgeHeight = zone.ridgeHeight;
      classifyParams.detailHeight = zone.detailHeight;
      classifyParams.baseSurface = dominantBlend.baseSurface;
      classifyParams.crestSurface = dominantBlend.crestSurface;
      classifyParams.hollowSurface = dominantBlend.hollowSurface;

      const relief = raidRelief(apronHeight[a], apronMacro[a], classifyParams);
      let surfaceIndex = raidSurfaceIndex(
        classifyRaidSurface(worldX, worldZ, classifyParams, seed, { height: apronHeight[a], slope, relief }),
      );
      let settled = clamp(raidLooseness(worldX, worldZ, classifyParams, seed, relief), 0, 1);
      if (hasFeatures) {
        // A groomed pad is firm ground. Looseness blends continuously so the
        // ramp's approach firms up gradually; the discrete surface id switches
        // once the pad dominates, exactly as blendRaidZones switches identity
        // at its own midpoint. Without this a take-off face inherits whatever
        // sand it stands in, and a powder ramp stops the vehicle dead.
        const pad = featurePad[vertexIndex];
        if (pad > 0) {
          settled = clamp(settled + (featureLooseness[vertexIndex] - settled) * pad, 0, 1);
          if (pad >= RAID_FEATURE_PAD_SURFACE_THRESHOLD && featureSurface[vertexIndex] > 0) {
            surfaceIndex = featureSurface[vertexIndex] - 1;
          }
        }
      }
      surface[vertexIndex] = surfaceIndex;
      looseness[vertexIndex] = Math.round(settled * 255);
    }
  }

  return {
    schema: 1,
    stageId: route.stageId,
    seed: seed >>> 0,
    sectorX,
    sectorZ,
    cells,
    verts,
    cellMetres,
    originX,
    originZ,
    sectorMetres: RAID_SECTOR_METRES,
    minimum,
    maximum,
    heights,
    surface,
    looseness,
  };
}

/**
 * Evaluate the terrain field at one arbitrary world position, exactly as the
 * sector generator would.
 *
 * This is the authority fallback. If a fixed-step physics tick ever asks about
 * a point whose sector has not arrived, the answer must still be the RIGHT
 * answer — not a flat emergency plane and not a cheaper coarse approximation,
 * either of which would step the suspension the moment the real sector landed.
 *
 * It reproduces the generator's coarse-lattice interpolation by addressing the
 * same GLOBAL lattice nodes directly, so the value it returns equals the
 * streamed payload's to within the float32 rounding the payload stores.
 */
export function sampleRaidFieldAt(worldX, worldZ, route, index, target = { height: 0, macro: 0, surface: 0, looseness: 0 }) {
  const routeIndex = index || buildRaidRouteIndex(route);
  const lattice = RAID_ZONE_LATTICE_METRES;
  const lx = Math.floor(worldX / lattice);
  const lz = Math.floor(worldZ / lattice);
  const tx = worldX / lattice - lx;
  const tz = worldZ / lattice - lz;

  const corners = SAMPLE_CORNERS;
  zoneWeightsAt(lx * lattice, lz * lattice, route, routeIndex, corners, 0);
  zoneWeightsAt((lx + 1) * lattice, lz * lattice, route, routeIndex, corners, ZONE_COUNT);
  zoneWeightsAt(lx * lattice, (lz + 1) * lattice, route, routeIndex, corners, ZONE_COUNT * 2);
  zoneWeightsAt((lx + 1) * lattice, (lz + 1) * lattice, route, routeIndex, corners, ZONE_COUNT * 3);
  const w00 = (1 - tx) * (1 - tz);
  const w10 = tx * (1 - tz);
  const w01 = (1 - tx) * tz;
  const w11 = tx * tz;

  const seed = route.seed | 0;
  const windAngle = route.windAngle;
  const parts = { macro: 0, height: 0 };
  let height = 0;
  let macro = 0;
  let roughness = 0;
  let rockiness = 0;
  let softness = 0;
  let dominant = 0;
  let dominantWeight = -1;
  for (let zone = 0; zone < ZONE_COUNT; zone += 1) {
    const weight = corners[zone] * w00
      + corners[ZONE_COUNT + zone] * w10
      + corners[ZONE_COUNT * 2 + zone] * w01
      + corners[ZONE_COUNT * 3 + zone] * w11;
    if (weight > dominantWeight) {
      dominantWeight = weight;
      dominant = zone;
    }
    if (weight <= 1e-6) continue;
    const params = ZONE_PARAMS[zone];
    raidZoneHeightParts(worldX, worldZ, params, seed, windAngle, parts);
    height += parts.height * weight;
    macro += parts.macro * weight;
    roughness += params.roughness * weight;
    rockiness += params.rockiness * weight;
    softness += params.softness * weight;
  }

  const features = route.features || EMPTY_FEATURES;
  if (features.length > 0) {
    evaluateRaidFeatures(worldX, worldZ, features, SAMPLE_FX);
    SAMPLE_STATE.height = height;
    SAMPLE_STATE.macro = macro;
    applyRaidFeatures(SAMPLE_STATE, SAMPLE_FX);
    height = SAMPLE_STATE.height;
    macro = SAMPLE_STATE.macro;
  }

  const zoneParams = ZONE_PARAMS[dominant];
  const classifyParams = {
    rockiness,
    softness,
    roughness,
    ridgeHeight: zoneParams.ridgeHeight,
    detailHeight: zoneParams.detailHeight,
    baseSurface: zoneParams.baseSurface,
    crestSurface: zoneParams.crestSurface,
    hollowSurface: zoneParams.hollowSurface,
  };
  const relief = raidRelief(height, macro, classifyParams);
  target.height = height;
  target.macro = macro;
  let surfaceIndex = raidSurfaceIndex(
    classifyRaidSurface(worldX, worldZ, classifyParams, seed, { height, slope: 0, relief }),
  );
  let settled = clamp(raidLooseness(worldX, worldZ, classifyParams, seed, relief), 0, 1);
  if (features.length > 0 && SAMPLE_FX.pad > 0) {
    settled = clamp(settled + (SAMPLE_FX.looseness - settled) * SAMPLE_FX.pad, 0, 1);
    if (SAMPLE_FX.pad >= RAID_FEATURE_PAD_SURFACE_THRESHOLD && SAMPLE_FX.surface) {
      surfaceIndex = raidSurfaceIndex(SAMPLE_FX.surface);
    }
  }
  target.surface = surfaceIndex;
  target.looseness = settled;
  return target;
}

const SAMPLE_CORNERS = new Float64Array(ZONE_COUNT * 4);
const SAMPLE_FX = { relief: 0, pad: 0, surface: null, looseness: 0 };
const SAMPLE_STATE = { height: 0, macro: 0 };

/** Byte cost of one sector payload, for the memory budget diagnostics. */
export function raidSectorBytes(cells = RAID_SECTOR_CELLS) {
  const verts = cells + 1;
  return verts * verts * (4 + 1 + 1);
}

/**
 * Route data reduced to structured-cloneable form for a worker. The typed
 * arrays clone directly; the frozen wrapper and zone objects do not.
 */
export function serializeRaidRoute(route) {
  return {
    stageId: route.stageId,
    seed: route.seed,
    windAngle: route.windAngle,
    spacing: route.spacing,
    count: route.count,
    x: route.x,
    z: route.z,
    yaw: route.yaw,
    meters: route.meters,
    corridor: route.corridor,
    totalMeters: route.totalMeters,
    officialDistanceKm: route.officialDistanceKm,
    zones: route.zones.map((band) => ({ atMeters: band.atMeters, zone: band.zone })),
    zoneBlendMetres: route.zoneBlendMetres,
    // Plain objects of numbers and strings: structured-cloneable as-is, so a
    // worker builds exactly the same features from exactly the same record.
    features: (route.features || []).map((feature) => ({ ...feature })),
    startX: route.startX,
    startZ: route.startZ,
    startYaw: route.startYaw,
    finishX: route.finishX,
    finishZ: route.finishZ,
  };
}
