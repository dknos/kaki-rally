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

export const RAID_STAGES = Object.freeze({
  [WADI_OF_WHISKERS.id]: WADI_OF_WHISKERS,
});

export const RAID_STAGE_ORDER = Object.freeze([WADI_OF_WHISKERS.id]);

export function getRaidStage(id) {
  return RAID_STAGES[id] || RAID_STAGES[RAID_STAGE_ORDER[0]];
}

/**
 * Validate an authored blueprint against a built route.
 *
 * A stage is not accepted because it generated successfully. These are the
 * checks that catch an author's mistake before a player drives into it.
 *
 * @returns {{ ok: boolean, errors: string[], warnings: string[], measuredKm: number }}
 */
export function validateRaidStage(blueprint, route) {
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

  // Start and finish must be genuinely different places.
  const startToFinish = Math.hypot(route.finishX - route.startX, route.finishZ - route.startZ);
  if (startToFinish < route.totalMeters * 0.2) {
    errors.push(`start and finish are only ${Math.round(startToFinish)} m apart on a ${Math.round(route.totalMeters)} m stage`);
  }

  return { ok: errors.length === 0, errors, warnings, measuredKm };
}
