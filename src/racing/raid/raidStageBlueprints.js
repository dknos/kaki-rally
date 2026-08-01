// Kaki Rally Raid — stage blueprints.
//
// A blueprint is data, not code. It declares where the route goes, which
// terrain identities it crosses and where, how wide the navigational corridor
// is, and what the stage is supposed to feel like. The runtime measures the
// real distance from the resampled polyline; the blueprint's `targetDistanceKm`
// is an authoring intent that the validator checks the result against, never a
// number shown to the player.
//
// Coordinates are world metres. The stage starts near the origin and runs
// north-east so that the streaming provider is exercised across many sectors
// and far from the origin in both axes.

import { RAID_ZONE_ORDER } from './raidSurfaceField.js';
import {
  RAID_FEATURE_TYPES,
  describeRaidFeature,
  raidFeatureMaxGradient,
  raidFeatureTouchdown,
} from './raidTerrainFeatures.js';

// Steepest take-off face a rally-raid truck can meet at speed without the
// contact simply stopping it. A 24 degree face is already a wall at 120 km/h.
const MAX_TAKEOFF_DEGREES = 24;
// Shallowest lip that still throws the vehicle rather than merely unloading it.
const MIN_TAKEOFF_DEGREES = 8;
// How far into the matched landing slope a design-speed flight should touch
// down. Landing before the knuckle is a case, landing past the bottom of the
// slope is flat ground.
const LANDING_WINDOW = Object.freeze({ low: 0.1, high: 0.95 });

// Kaki Rally Raid, Stage 1. A wadi crossing: leave the start control on open
// hardpack, drop into a gravel wadi that winds between shelves, climb a broken
// rock section that folds back on itself twice, cross a dune field, then run
// into the finish camp on fast hardpack.
//
// The fold-backs are deliberate. A route that crosses its own neighbourhood is
// the case where a naive nearest-point progress query teleports the tripmaster
// forward, so the stage that ships first is the one that proves the windowed
// query works.
const WADI_OF_WHISKERS = Object.freeze({
  id: 'wadi-of-whiskers',
  name: 'Wadi of Whiskers',
  discipline: 'selective',
  seed: 0x57414449,
  windAngle: 0.62,
  targetDistanceKm: 12.4,
  expectedMinutes: [9, 14],
  timeOfDay: 'morning',
  summary: 'Open hardpack into a winding gravel wadi, a folded rock shelf, a dune crossing, and a fast run into camp.',
  defaultCorridorWidth: 220,
  zoneBlendMetres: 340,
  routeControls: Object.freeze([
    // Start control and the opening plateau.
    [0, 0], [360, -50], [730, 30], [1110, -30], [1480, 80], [1860, 20],
    // Into the wadi.
    [2180, -150], [2450, -390], [2780, -530], [3140, -440], [3420, -220],
    [3660, 50], [3880, 320],
    // Rock shelf: climb north-east up the terraces.
    [3990, 660], [4110, 1010], [4240, 1350], [4380, 1690], [4520, 2030],
    // Turn at the head of the shelf.
    [4670, 2130], [4770, 1980], [4690, 1790],
    // And come back down a parallel terrace roughly 200 m to the west. The
    // outbound and return legs are over 1.9 km apart along the route but within
    // sight of each other, which is exactly the geometry that breaks a naive
    // nearest-point progress query.
    [4550, 1620], [4410, 1280], [4280, 940], [4140, 600],
    // Out of the shelf, crossing back over the wadi exit, into the dunes.
    [4170, 410], [4340, 320], [4600, 360], [4910, 480],
    [5280, 650], [5670, 850], [6070, 1010], [6460, 1090],
    // Run-in to the finish camp.
    [6850, 1110], [7240, 1070], [7630, 1020], [8030, 1010],
  ]),
  // Terrain identities, authored by route distance. The runtime blends across
  // zoneBlendMetres centred on each boundary.
  zones: Object.freeze([
    { atMeters: 0, zone: 'hardpack-plateau' },
    { atMeters: 2280, zone: 'wadi-gravel' },
    { atMeters: 4440, zone: 'rock-shelf' },
    { atMeters: 8170, zone: 'rolling-dunes' },
    { atMeters: 11230, zone: 'hardpack-plateau' },
  ]),
  // Corridor width in metres. Wide on the plateau, naturally constrained in the
  // wadi and on the shelf terraces, opening across the dunes, visibly
  // controlled on the camp approach.
  corridors: Object.freeze([
    { atMeters: 0, width: 260 },
    { atMeters: 1400, width: 320 },
    { atMeters: 2400, width: 130 },
    { atMeters: 3600, width: 110 },
    { atMeters: 4600, width: 95 },
    { atMeters: 6300, width: 120 },
    { atMeters: 7500, width: 100 },
    { atMeters: 8400, width: 200 },
    { atMeters: 9200, width: 340 },
    { atMeters: 10600, width: 300 },
    { atMeters: 11400, width: 220 },
    { atMeters: 12200, width: 130 },
  ]),
});

// Kaki Rally Raid, Stage 2. The landform stage: a hoodoo forest, the floor of a
// slot canyon, the rim above it, a field of rift craters, the ruin terraces, and
// a flat-out run home.
//
// The important thing about this stage, and the reason its route controls look
// like measurements rather than like drawing, is that MOST OF IT WAS NOT
// AUTHORED. The terrain field is a pure function of world metres and the seed,
// so a stage cannot decide where a canyon goes: it can only find the one the
// seed already made and drive down it. The canyon controls between 2.3 km and
// 4.9 km are read off a numerical trace of the zero set of the canyon locator
// field, resampled every 120 m; the rift band is aimed through two crater
// centres computed from the 880 m crater lattice; the approach through the
// spire forest was optimised against the real terrain gradient so the opening
// threads BETWEEN the plinths instead of climbing one.
//
// Three consequences an editor should know before moving a control:
//
//  * Moving a canyon control sideways does not move the canyon. It moves the
//    line off the floor and onto the wall.
//  * The canyon shallows to a saddle every few hundred metres, which is what
//    makes the floor undulate by 30 m and what the climb-out at 4.9 km uses.
//    That saddle is a property of the seed, not of the route.
//  * Changing `seed` invalidates every coordinate in this blueprint.
const RIFT_OF_NINE_TAILS = Object.freeze({
  id: 'rift-of-nine-tails',
  name: 'Rift of Nine Tails',
  discipline: 'marathon',
  seed: 0x4e494e45,
  windAngle: 0.94,
  targetDistanceKm: 13.1,
  expectedMinutes: [11, 17],
  timeOfDay: 'afternoon',
  summary: 'A hoodoo forest, the floor of a slot canyon, the rim above it, a field of glowing rift craters, the ruin terraces, and a flat-out run home.',
  defaultCorridorWidth: 220,
  zoneBlendMetres: 340,
  routeControls: Object.freeze([
    // Start control, threading between the plinths of the spire forest.
    [-700, -90], [-517, -79], [-340, -61], [-164, -41], [6, 17],
    [164, 90], [330, 140], [487, 209], [637, 276], [768, 358],
    [893, 450], [1000, 545], [1104, 646], [1210, 736], [1290, 850],
    // Down into the canyon head and along the floor. Traced off the canyon
    // locator's zero set; these are measurements, not drawing.
    [1544, 1059], [1601, 1163], [1612, 1282], [1601, 1402], [1611, 1520],
    [1713, 1566], [1819, 1514], [1903, 1429], [2013, 1383], [2132, 1371],
    [2251, 1353], [2357, 1299], [2454, 1228], [2558, 1169], [2672, 1132],
    [2792, 1119], [2912, 1121], [3031, 1134], [3147, 1163], [3256, 1212],
    // Out at the saddle, on the outside of the canyon's bend, onto the rim.
    [3335, 1337], [3414, 1420], [3557, 1448], [3700, 1404], [3800, 1380],
    // Along the rim, crossing two tributary gullies, with the chasm to the right.
    [3950, 1250], [4090, 1060], [4180, 930], [4300, 845], [4460, 765],
    [4620, 685], [4780, 605],
    // Across the sand and straight through two crater centres.
    [5060, 560], [5350, 505], [5620, 455], [5809, 418], [6060, 440],
    [6320, 510], [6520, 590], [6725, 671], [6960, 800], [7170, 980],
    // Up onto the ruin terraces.
    [7400, 1150], [7700, 1270], [8000, 1330], [8300, 1340], [8600, 1300],
    [8900, 1230], [9200, 1160],
    // Flat out to the finish control.
    [9520, 1130], [9840, 1150], [10160, 1190], [10480, 1200], [10780, 1170],
  ]),
  zones: Object.freeze([
    { atMeters: 0, zone: 'spire-forest' },
    { atMeters: 2280, zone: 'slot-canyon' },
    { atMeters: 4900, zone: 'canyon-rim' },
    { atMeters: 6850, zone: 'rift-crater' },
    { atMeters: 9380, zone: 'ruin-flat' },
    { atMeters: 11510, zone: 'hardpack-plateau' },
  ]),
  corridors: Object.freeze([
    { atMeters: 0, width: 260 },
    { atMeters: 1200, width: 220 },
    { atMeters: 2200, width: 170 },
    { atMeters: 2700, width: 120 },
    { atMeters: 4700, width: 140 },
    { atMeters: 5200, width: 190 },
    { atMeters: 6900, width: 300 },
    { atMeters: 7900, width: 260 },
    { atMeters: 9500, width: 320 },
    { atMeters: 11500, width: 280 },
    { atMeters: 12900, width: 150 },
  ]),
  // Jumps. Every one of these stands on ground measured flat over its own
  // footprint first: a feature is ADDITIVE relief, so a ramp authored on a 20%
  // slope is a ramp on a 20% slope. Speeds are under what the truck actually
  // reaches on the approach surface, which the ballistics cannot check.
  features: Object.freeze([
    { type: 'tabletop', id: 'kitten-hop', atMeters: 1500, designSpeedKmh: 130, lipDegrees: 14 },
    { type: 'gap-jump', id: 'first-claw', atMeters: 2820, designSpeedKmh: 135, lipDegrees: 17 },
    { type: 'berm', id: 'saddle-berm', atMeters: 3120, side: 'left', height: 3.4, length: 86 },
    { type: 'tabletop', id: 'canyon-table', atMeters: 3700, designSpeedKmh: 140, lipDegrees: 16 },
    { type: 'drop', id: 'rim-fall', atMeters: 5100, dropHeight: 10, designSpeedKmh: 145 },
    { type: 'tabletop', id: 'rim-table', atMeters: 6500, designSpeedKmh: 158, lipDegrees: 17 },
    // The signature. A 12 m ramp at the drivable limit of lip angle, thrown
    // across the sand towards the first crater. A committed run is eighteen
    // metres above the desert at apex; a lifted one lands in the pit.
    { type: 'gap-jump', id: 'nine-tails-leap', atMeters: 7320, designSpeedKmh: 175, lipDegrees: 23, height: 12, width: 48 },
    { type: 'gap-jump', id: 'crack-jump', atMeters: 8420, designSpeedKmh: 162, lipDegrees: 18 },
    { type: 'tabletop', id: 'colosseum-table', atMeters: 10250, designSpeedKmh: 175, lipDegrees: 18 },
  ]),
});

export const RAID_STAGES = Object.freeze({
  [WADI_OF_WHISKERS.id]: WADI_OF_WHISKERS,
  [RIFT_OF_NINE_TAILS.id]: RIFT_OF_NINE_TAILS,
});

export const RAID_STAGE_ORDER = Object.freeze([WADI_OF_WHISKERS.id, RIFT_OF_NINE_TAILS.id]);

export function getRaidStage(id) {
  return RAID_STAGES[id] || RAID_STAGES[RAID_STAGE_ORDER[0]];
}

// Corridor half width at a route distance. Duplicated here rather than imported
// so the validator stays a pure reader of the built route.
function raidCorridorHalfWidthAt(route, meters) {
  const index = Math.max(0, Math.min(route.count - 1, Math.round(meters / route.spacing)));
  return route.corridor[index] * 0.5;
}

/**
 * Validate an authored blueprint against a built route.
 *
 * A stage is not accepted because it generated successfully. These are the
 * checks that catch an author's mistake before a player drives into it.
 *
 * @param {object} blueprint
 * @param {object} route built route runtime (carries the resolved features)
 * @param {{ sampleHeight?: (x: number, z: number) => number }} [options]
 *        `sampleHeight` lets the validator look at the ground a kicker throws
 *        the player onto. Passed in rather than imported so this module keeps
 *        no dependency on the sector generator.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], measuredKm: number }}
 */
export function validateRaidStage(blueprint, route, { sampleHeight = null } = {}) {
  const errors = [];
  const warnings = [];
  const measuredKm = route.totalMeters / 1000;

  if (!blueprint.routeControls || blueprint.routeControls.length < 4) {
    errors.push('a stage needs at least four route controls');
  }

  // Measured distance must match the authoring intent within 10%.
  const target = Number(blueprint.targetDistanceKm) || 0;
  if (target > 0 && Math.abs(measuredKm - target) / target > 0.1) {
    errors.push(
      `measured distance ${measuredKm.toFixed(2)} km is more than 10% from the authored target ${target} km`,
    );
  }

  // Terrain variety: the spec requires at least three identities per stage.
  const zoneIds = new Set(blueprint.zones.map((band) => band.zone));
  if (zoneIds.size < 3) errors.push(`stage crosses only ${zoneIds.size} terrain identities; at least three are required`);
  for (const band of blueprint.zones) {
    if (!RAID_ZONE_ORDER.includes(band.zone)) errors.push(`unknown terrain zone: ${band.zone}`);
    if (band.atMeters > route.totalMeters) {
      errors.push(`zone band at ${band.atMeters} m starts past the ${Math.round(route.totalMeters)} m finish`);
    }
  }
  // Zone bands must be long enough that the blend does not swallow them whole.
  for (let index = 1; index < blueprint.zones.length; index += 1) {
    const span = blueprint.zones[index].atMeters - blueprint.zones[index - 1].atMeters;
    if (span < route.zoneBlendMetres * 1.5) {
      errors.push(
        `zone band ${blueprint.zones[index - 1].zone} is ${Math.round(span)} m long, `
        + `shorter than 1.5x the ${route.zoneBlendMetres} m blend`,
      );
    }
  }

  // Empty distance: a stage must not run for kilometres without a change of
  // identity or corridor. Beats are what stop a long stage becoming noise.
  const beats = [...blueprint.zones.map((b) => b.atMeters), ...(blueprint.corridors || []).map((c) => c.atMeters)]
    .filter((value) => value > 0 && value < route.totalMeters)
    .sort((a, b) => a - b);
  let previousBeat = 0;
  for (const beat of [...beats, route.totalMeters]) {
    if (beat - previousBeat > 2600) {
      warnings.push(`${Math.round(beat - previousBeat)} m of unchanging stage between ${Math.round(previousBeat)} m and ${Math.round(beat)} m`);
    }
    previousBeat = beat;
  }

  // Gradient sanity along the centreline: a route control that climbs a cliff
  // is an authoring error, not a challenge.
  let maxTurnPerMetre = 0;
  for (let index = 1; index < route.count - 1; index += 1) {
    let delta = route.yaw[index + 1] - route.yaw[index - 1];
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    maxTurnPerMetre = Math.max(maxTurnPerMetre, Math.abs(delta) / (route.spacing * 2));
  }
  // A 25 m radius is already a first-gear hairpin for a rally-raid truck.
  if (maxTurnPerMetre > 1 / 25) {
    errors.push(`route contains a turn tighter than a 25 m radius (${(1 / maxTurnPerMetre).toFixed(1)} m)`);
  }

  // Corridor sanity.
  for (const corridor of blueprint.corridors || []) {
    if (!(corridor.width >= 60)) errors.push(`corridor at ${corridor.atMeters} m is narrower than 60 m`);
    if (corridor.width > 600) warnings.push(`corridor at ${corridor.atMeters} m is wider than 600 m`);
  }

  // Authored terrain features. Everything here is checked against the RESOLVED
  // geometry rather than the spec, because the spec is mostly derived: an
  // author writes a speed and a lip angle, and the ballistics do the rest.
  const features = route.features || [];
  for (const feature of features) {
    const where = `${feature.id} (${feature.type} at ${Math.round(feature.atMeters)} m)`;
    if (!RAID_FEATURE_TYPES.includes(feature.type)) {
      errors.push(`${where}: unknown feature type`);
      continue;
    }
    if (feature.atMeters < 0 || feature.atMeters > route.totalMeters) {
      errors.push(`${where}: placed outside the ${Math.round(route.totalMeters)} m stage`);
    }
    // The feature has to fit inside the navigational corridor, or the player is
    // being asked to hit something they were never steered towards.
    const halfCorridor = raidCorridorHalfWidthAt(route, feature.atMeters);
    if (feature.padHalfWidth > halfCorridor * 1.35) {
      warnings.push(
        `${where}: ${(feature.padHalfWidth * 2).toFixed(0)} m wide inside a `
        + `${(halfCorridor * 2).toFixed(0)} m corridor`,
      );
    }
    if (feature.type === 'berm') continue;

    if (feature.type !== 'drop') {
      if (feature.lipDegrees > MAX_TAKEOFF_DEGREES || feature.lipDegrees < MIN_TAKEOFF_DEGREES) {
        errors.push(
          `${where}: ${feature.lipDegrees.toFixed(1)} deg lip is outside the drivable `
          + `${MIN_TAKEOFF_DEGREES}-${MAX_TAKEOFF_DEGREES} deg band`,
        );
      }
      // Only the take-off face. A gap jump's far wall is deliberately vertical.
      const gradient = raidFeatureMaxGradient(feature, 0.25, feature.uMin, 0);
      if (gradient.riseDegrees > MAX_TAKEOFF_DEGREES + 1) {
        errors.push(
          `${where}: the steepest rise on it is ${gradient.riseDegrees.toFixed(1)} deg, `
          + `which is a wall rather than a take-off`,
        );
      }
    }

    // Does a driver who commits at the design speed actually land well?
    const landed = raidFeatureTouchdown(feature, feature.designSpeedKmh);
    if (feature.type === 'gap-jump' && !landed.clearsKnuckle) {
      errors.push(
        `${where}: a ${feature.designSpeedKmh} km/h run does NOT clear the `
        + `${feature.gapLength.toFixed(1)} m gap — it lands ${(feature.gapLength - landed.touchdownU).toFixed(1)} m short, into the wall`,
      );
    }
    if (feature.landingLength > 0) {
      if (landed.landingFraction < LANDING_WINDOW.low || landed.landingFraction > LANDING_WINDOW.high) {
        warnings.push(
          `${where}: a design-speed run touches down at ${(landed.landingFraction * 100).toFixed(0)}% `
          + `of the landing slope, outside the ${LANDING_WINDOW.low * 100}-${LANDING_WINDOW.high * 100}% window`,
        );
      }
      if (landed.normalImpactMs > 6) {
        warnings.push(
          `${where}: ${landed.normalImpactMs.toFixed(1)} m/s straight into the suspension on landing`,
        );
      }
    } else if (feature.type === 'kicker' && sampleHeight) {
      // A kicker has nothing after it on purpose, so it must be authored where
      // the desert already falls away. Look at the ground it throws onto.
      const lipX = feature.x + feature.forwardX * feature.lipLength;
      const lipZ = feature.z + feature.forwardZ * feature.lipLength;
      const landX = feature.x + feature.forwardX * landed.touchdownU;
      const landZ = feature.z + feature.forwardZ * landed.touchdownU;
      const rise = sampleHeight(landX, landZ) - (sampleHeight(lipX, lipZ) - feature.height);
      if (rise > 1.5) {
        warnings.push(
          `${where}: throws the player ${landed.airborneMetres.toFixed(0)} m onto ground `
          + `${rise.toFixed(1)} m HIGHER than the take-off stands on — a kicker has no landing of its own`,
        );
      }
    }
  }
  // Two features that overlap fight over the same ground and neither reads as
  // authored. Compared along the route, which is the axis they are placed on.
  for (let index = 1; index < features.length; index += 1) {
    const previous = features[index - 1];
    const current = features[index];
    const previousEnd = previous.atMeters + previous.padMax;
    const currentStart = current.atMeters + current.padMin;
    if (currentStart < previousEnd) {
      errors.push(
        `${current.id} overlaps ${previous.id} by ${(previousEnd - currentStart).toFixed(0)} m along the route`,
      );
    }
  }
  if (features.length) {
    for (const feature of features) warnings.push(`feature: ${describeRaidFeature(feature)}`);
  }

  // Start and finish must be genuinely different places.
  const startToFinish = Math.hypot(route.finishX - route.startX, route.finishZ - route.startZ);
  if (startToFinish < route.totalMeters * 0.2) {
    errors.push(`start and finish are only ${Math.round(startToFinish)} m apart on a ${Math.round(route.totalMeters)} m stage`);
  }

  return { ok: errors.length === 0, errors, warnings, measuredKm };
}
