const QUALITY = Object.freeze({
  low: Object.freeze({ firstLod: 1, repeatLod: 2, microLimit: 8, shadows: false, far: 180 }),
  medium: Object.freeze({ firstLod: 0, repeatLod: 1, microLimit: 16, shadows: false, far: 280 }),
  high: Object.freeze({ firstLod: 0, repeatLod: 0, microLimit: 28, shadows: true, far: 420 }),
  ultra: Object.freeze({ firstLod: 0, repeatLod: 0, microLimit: 36, shadows: true, far: 520 }),
});

const WORLD_KITS = Object.freeze({
  roadside: Object.freeze({ assetId: 'roadsideWorldKitV3', code: 'ROADSIDE' }),
  industrial: Object.freeze({ assetId: 'industrialWorldKitV1', code: 'INDUSTRIAL' }),
  stadium: Object.freeze({ assetId: 'stadiumWorldKitV1', code: 'STADIUM' }),
  monster: Object.freeze({ assetId: 'monsterEventWorldKitV2', code: 'MONSTER' }),
  desert: Object.freeze({ assetId: 'desertServiceWorldKitV1', code: 'DESERT' }),
  trials: Object.freeze({ assetId: 'trialsWorldKitV1', code: 'TRIALS' }),
  raceday: Object.freeze({ assetId: 'raceDayWorldKitV1', code: 'RACEDAY' }),
});

const COURSE_IDENTITY = Object.freeze({
  forest: Object.freeze([
    ['POST_DEPOT', 0.04, 27, 1.08],
    ['SERVICE_BRIDGE', 0.23, -18, 0.95],
    ['MARSHAL_SHELTER', 0.48, 15, 0.92],
    ['SERVICE_SHED', 0.72, -24, 0.92],
  ]),
  twilight: Object.freeze([
    ['MUNICIPAL_GUARDHOUSE', 0.10, -22, 1.08],
    ['RETAINING_WALL', 0.31, 17, 0.96],
    ['SERVICE_SHED', 0.56, -25, 0.88],
    ['CONCRETE_BARRIER', 0.78, 13, 0.96],
  ]),
  cinder: Object.freeze([
    ['KILN_SHED', 0.08, 29, 1.1],
    ['QUARRY_CONVEYOR', 0.39, -24, 1.06],
    ['RETAINING_WALL', 0.62, 17, 1.05],
    ['SERVICE_SHED', 0.84, -24, 0.9],
  ]),
  void: Object.freeze([
    ['TOLL_PLAZA', 0.04, 0, 1.04, 'overhead'],
    ['MUNICIPAL_GUARDHOUSE', 0.10, 16, 0.96],
    ['RETAINING_WALL', 0.38, -17, 1.08],
    ['SERVICE_SHED', 0.72, 25, 0.86],
  ]),
  cave: Object.freeze([
    ['GLASS_LAB', 0.08, 28, 1.05],
    ['SERVICE_BRIDGE', 0.34, -20, 1.0],
    ['UTILITY_BOX', 0.55, 13, 1.0],
    ['MARSHAL_SHELTER', 0.78, -16, 0.9],
  ]),
  kakiland: Object.freeze([
    ['QUARRY_CONVEYOR', 0.07, 27, 1.08],
    ['RETAINING_WALL', 0.31, -17, 1.06],
    ['CULVERT', 0.57, 18, 1.0],
    ['SERVICE_SHED', 0.79, -25, 0.88],
  ]),
});

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || 'kaki');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createWorldSeed(seed) {
  let value = (Number.isFinite(seed) ? seed : hashString(seed)) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function worldLivenessTierFor(quality) {
  return QUALITY[String(quality || '').toLowerCase()] || QUALITY.high;
}

function samplePlacement(samples, fraction, offset, heightAt, extra = {}) {
  const count = samples.length;
  const index = Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
  const point = samples[index];
  const previous = samples[(index - 1 + count) % count];
  const next = samples[(index + 1) % count];
  const tx = next.x - previous.x;
  const tz = next.z - previous.z;
  const length = Math.hypot(tx, tz) || 1;
  const nx = Number.isFinite(point.normal?.x) ? point.normal.x : -tz / length;
  const nz = Number.isFinite(point.normal?.z) ? point.normal.z : tx / length;
  const x = point.x + nx * offset;
  const z = point.z + nz * offset;
  const ground = typeof heightAt === 'function' ? heightAt(x, z) : Number(point.y) || 0;
  // Builder façades face local +Z after Blender's Z-up to glTF Y-up export.
  // A prop on the left of travel must turn right toward the route (and vice
  // versa); the previous signs pointed every façade away and exposed its flat
  // service back to the player.
  const facingTrack = Math.atan2(tx, tz) + (offset >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
  return {
    x,
    y: ground,
    z,
    yaw: extra.yaw ?? facingTrack,
    routeFraction: fraction,
    roadOffset: Math.abs(offset),
    side: Math.sign(offset),
    overhead: extra.overhead === true,
  };
}

export function placementClearsRoute(placement, trackWidth = 9, margin = 4.5) {
  return !!placement?.overhead || Number(placement?.roadOffset) >= trackWidth * 0.5 + margin;
}

function addRoutePlacement(target, samples, heightAt, trackWidth, definition, options = {}) {
  const [asset, fraction, offset, scale = 1, flag = ''] = definition;
  const placement = {
    asset,
    scale,
    ...samplePlacement(samples, fraction, offset, heightAt, { overhead: flag === 'overhead' }),
    ...options,
  };
  if (options.repeat) {
    const variation = hashString(`${asset}:${fraction}:${offset}`);
    placement.scale *= 0.95 + (variation & 7) * 0.0125;
    placement.yaw += (((variation >>> 8) % 9) - 4) * 0.006;
    placement.materialVariant = (variation >>> 16) % 3;
  }
  if (!placementClearsRoute(placement, trackWidth, 4.5)) return false;
  target.push(placement);
  return true;
}

function drawKitForTheme(themeId) {
  if (themeId === 'industrial') return 'industrial';
  if (themeId === 'desert') return 'desert';
  if (themeId === 'neon' || themeId === 'dirt') return 'stadium';
  return 'roadside';
}

/** Deterministic, exclusion-aware composition for circuit, drift, stock and Draw. */
export function createRacingWorldPlan({ course, mode, samples, heightAt, quality = 'high' }) {
  if (!course?.id || !Array.isArray(samples) || samples.length < 8) return [];
  const trackWidth = Number(course.trackWidth) || 9;
  const plans = [];
  let kitName = 'roadside';
  const placements = [];
  const shared = [];

  if (mode === 'drift') {
    kitName = 'industrial';
    [
      ['WAREHOUSE_FACADE', .04, -32, 1.12], ['LOADING_DOCK', .13, -20, 1.04],
      ['WAREHOUSE_FACADE', .39, -32, 1.08], ['PIPE_RACK', .43, 22, 1.08],
      ['TANK_PAIR', .50, -26, 1.10], ['YARD_OFFICE', .63, 24, 1.04],
      ['SERVICE_CANOPY', .78, -22, 1.02], ['GUARD_BOOTH', .92, 18, .96],
    ].forEach((entry) => addRoutePlacement(placements, samples, heightAt, trackWidth, entry));
    for (const fraction of [.09, .22, .36, .50, .64, .78, .91]) {
      addRoutePlacement(placements, samples, heightAt, trackWidth, ['FLOODLIGHT', fraction, fraction % .2 > .1 ? 16 : -16, .96], { repeat: true, animated: 'beacon' });
    }
    for (const fraction of [.10, .17, .25, .32, .47, .56, .69, .84, .94]) {
      addRoutePlacement(placements, samples, heightAt, trackWidth, ['YARD_FENCE', fraction, fraction > .5 ? -13 : 13, 1], { repeat: true });
    }
  } else if (mode === 'stock') {
    kitName = 'stadium';
    // Thunderbowl runs counter-clockwise, so negative normal offsets establish
    // a continuous exterior spectator ring. The infield is reserved for pits,
    // timing and maintenance rather than alternating stands in and out.
    for (const fraction of [.03, .15, .27, .39, .51, .63, .75, .87]) {
      addRoutePlacement(placements, samples, heightAt, trackWidth, ['GRANDSTAND_BAY', fraction, -20.5, 1.08], { repeat: true });
    }
    [
      ['PRESS_BOX', .17, -28, 1.12], ['SCOREBOARD', .46, 24, 1.16],
      ['PIT_GARAGE', .67, 20, 1.08], ['ENTRY_TUNNEL', .89, -24, 1.10],
      ['MAINTENANCE_SHED', .34, 21, 1.0], ['TIMING_TOWER', .04, 20, 1.04],
    ].forEach((entry) => addRoutePlacement(placements, samples, heightAt, trackWidth, entry));
    for (const [index, fraction] of [.02, .25, .50, .75].entries()) {
      addRoutePlacement(
        placements,
        samples,
        heightAt,
        trackWidth,
        ['LIGHT_MAST', fraction, -29, 1.0],
        index === 0 ? { animated: 'beacon' } : { repeat: true },
      );
    }
    for (let index = 0; index < 20; index += 1) {
      addRoutePlacement(placements, samples, heightAt, trackWidth, ['CATCH_FENCE', index / 20, -12.5, 1], { repeat: true });
    }
    for (const fraction of [.08, .20, .32, .44, .56, .68, .80, .92]) {
      addRoutePlacement(placements, samples, heightAt, trackWidth, ['PIT_WALL', fraction, 12.5, 1], { repeat: true });
    }
  } else if (mode === 'draw') {
    kitName = drawKitForTheme(course.drawThemeId);
    const themeCompositions = {
      industrial: [['WAREHOUSE_FACADE', .09, 28, 1], ['PIPE_RACK', .43, -22, .9], ['YARD_OFFICE', .75, 25, .9]],
      desert: [['BIVOUAC_CANOPY', .08, 22, 1], ['WATER_TANK', .42, -24, .9], ['TIMING_SHELTER', .76, 18, .9]],
      stadium: [['GRANDSTAND_BAY', .12, 27, .92], ['SCOREBOARD', .49, -28, .9], ['PIT_GARAGE', .78, 26, .9]],
      roadside: [['SERVICE_SHED', .1, 24, .92], ['MARSHAL_SHELTER', .44, -16, .86], ['SERVICE_BRIDGE', .76, 21, .9]],
    };
    (themeCompositions[kitName] || themeCompositions.roadside).forEach((entry) => (
      addRoutePlacement(placements, samples, heightAt, trackWidth, entry)
    ));
  } else {
    (COURSE_IDENTITY[course.id] || COURSE_IDENTITY.forest).forEach((entry) => (
      addRoutePlacement(placements, samples, heightAt, trackWidth, entry)
    ));
    const repeatAsset = course.id === 'forest' ? 'TIMBER_FENCE'
      : course.id === 'kakiland' ? 'RETAINING_WALL'
        : 'GUARDRAIL_STRAIGHT';
    for (const fraction of [.14, .20, .37, .43, .61, .67, .84, .9]) {
      addRoutePlacement(placements, samples, heightAt, trackWidth, [repeatAsset, fraction, fraction % .3 > .15 ? 13 : -13, .94], { repeat: true });
    }
  }

  const tier = worldLivenessTierFor(quality);
  for (const fraction of [.01, .25, .5, .75]) {
    addRoutePlacement(shared, samples, heightAt, trackWidth, ['FLAG', fraction, fraction < .5 ? 13 : -13, .9], { animated: 'wind' });
  }
  for (const fraction of [.18, .39, .63, .86].slice(0, Math.max(2, Math.round(tier.microLimit / 7)))) {
    addRoutePlacement(shared, samples, heightAt, trackWidth, ['MARSHAL_POST', fraction, fraction % .4 > .2 ? 14 : -14, .85], { repeat: true });
  }
  plans.push({ kit: WORLD_KITS[kitName], placements });
  plans.push({ kit: WORLD_KITS.raceday, placements: shared });
  return plans;
}

function freePlacement(asset, x, y, z, yaw = 0, scale = 1, options = {}) {
  return { asset, x, y, z, yaw, scale, roadOffset: Infinity, ...options };
}

export function createMonsterWorldPlan(definition) {
  const bounds = definition?.bounds || { minX: -88, maxX: 88, minZ: -68, maxZ: 68 };
  const west = bounds.minX - 13;
  const east = bounds.maxX + 13;
  const north = bounds.minZ - 14;
  const south = bounds.maxZ + 14;
  return [
    { kit: WORLD_KITS.monster, placements: [
      freePlacement('ENTRY_TUNNEL', 0, 0, south, Math.PI, 1.08),
      freePlacement('EVENT_GRANDSTAND', west, 0, -28, Math.PI * .5, 1.05),
      freePlacement('EVENT_GRANDSTAND', east, 0, 28, -Math.PI * .5, 1.05),
      freePlacement('SCOREBOARD', 0, 0, north, 0, 1.08, { animated: 'beacon' }),
      freePlacement('EVENT_TENT', west + 10, 0, south - 8, Math.PI * .35, .95),
      freePlacement('CONCESSION', east - 9, 0, south - 7, -Math.PI * .35, .92),
      freePlacement('STAGING_PLATFORM', east - 6, 0, north + 12, -Math.PI * .5, .92),
      freePlacement('LIGHT_MAST', west + 5, 0, north + 6, 0, .9, { animated: 'beacon' }),
      freePlacement('LIGHT_MAST', east - 5, 0, south - 6, Math.PI, .9, { animated: 'beacon' }),
    ] },
    { kit: WORLD_KITS.raceday, placements: [
      freePlacement('FLAG', -18, 0, south - 5, Math.PI, .92, { animated: 'wind' }),
      freePlacement('FLAG', 18, 0, south - 5, Math.PI, .92, { animated: 'wind' }),
      freePlacement('TOOL_CABINET', east - 9, 0, north + 18, -Math.PI * .5, .9),
      freePlacement('FIRE_EXTINGUISHER', east - 12, 0, north + 18, -Math.PI * .5, .9),
    ] },
  ];
}

export function createDuneWorldPlan({ event, samples, heightAt, quality = 'high' }) {
  if (!event || !Array.isArray(samples) || samples.length < 4) return [];
  const trackWidth = Number(event.routeWidth) || 22;
  const identities = {
    whiskerwind: [
      ['BIVOUAC_CANOPY', .02, 42, 1.05], ['TIMING_SHELTER', .08, -34, .95],
      ['WATER_TANK', .31, 45, .92], ['OBSERVATION_PLATFORM', .68, -48, .96],
    ],
    sunspine: [
      ['RADIO_MAST', .08, 52, 1.0], ['SOLAR_ARRAY', .27, -44, .98],
      ['WAYPOINT_POST', .56, 31, 1.0], ['FIELD_OFFICE', .82, -46, .92],
    ],
    mirage: [
      ['TIMING_SHELTER', .03, 36, 1.0], ['WATER_TANK', .36, -48, .95],
      ['BIVOUAC_CANOPY', .62, 45, .98], ['PORTABLE_LIGHT', .88, -38, .92],
    ],
    litterbox: [
      ['RECOVERY_RACK', .06, 38, 1.0], ['GENERATOR', .28, -40, .95],
      ['OBSERVATION_PLATFORM', .54, 48, 1.0], ['FIELD_OFFICE', .8, -45, .9],
    ],
  };
  const placements = [];
  const source = identities[event.id] || identities.whiskerwind;
  source.forEach((entry) => addRoutePlacement(placements, samples, heightAt, trackWidth, entry));
  for (const fraction of [.12, .42, .72]) {
    addRoutePlacement(placements, samples, heightAt, trackWidth, ['WAYPOINT_POST', fraction, fraction < .5 ? -30 : 30, .9], { repeat: true });
  }
  const flags = [];
  const tier = worldLivenessTierFor(quality);
  for (const fraction of [.04, .48, .92].slice(0, tier.microLimit > 10 ? 3 : 2)) {
    addRoutePlacement(flags, samples, heightAt, trackWidth, ['WINDSOCK', fraction, fraction < .5 ? 34 : -34, .88], { animated: 'wind' });
  }
  return [
    { kit: WORLD_KITS.desert, placements },
    { kit: WORLD_KITS.raceday, placements: flags },
  ];
}

export function createTrialsWorldPlan({ track, groundAt }) {
  if (!track || typeof groundAt !== 'function') return [];
  const id = track.themeId || track.sourceOfficialId || track.id || 'meadow';
  const identities = {
    meadow: [
      ['VIEWING_STAND', .03, -13, .9], ['STEEL_PLATFORM', .39, -10.5, .86],
      ['BRIDGE', .67, -14.5, .9], ['CHAMPIONSHIP_ARCH', .9, -11.5, .88],
    ],
    quarry: [
      ['CULVERT_PIPE', .03, -10.5, .95], ['SCAFFOLD_BAY', .34, -14, .95],
      ['QUARRY_SHED', .58, -11.5, .9], ['CATWALK', .78, -15, .92],
    ],
    crown: [
      ['CHAMPIONSHIP_ARCH', .03, -11, 1.02], ['VIEWING_STAND', .32, -14.5, .94],
      ['STEEL_PLATFORM', .57, -10.5, .92], ['CHAMPIONSHIP_ARCH', .88, -13.5, 1.04],
    ],
  };
  const placements = (identities[id] || identities.meadow).map(([asset, fraction, z, scale]) => {
    const x = Math.max(16, Math.min(track.length - 10, track.length * fraction));
    const ground = groundAt(x);
    return freePlacement(asset, x, ground?.height || 0, z, 0, scale);
  });
  const shared = [0.05, .5, .94].map((fraction, index) => {
    const x = Math.max(12, Math.min(track.length - 8, track.length * fraction));
    return freePlacement(
      'FLAG',
      x,
      groundAt(x)?.height || 0,
      index % 2 ? 7.5 : -7.5,
      index % 2 ? Math.PI : 0,
      .82,
      index === 1 ? { animated: 'wind' } : { repeat: true },
    );
  });
  return [
    { kit: WORLD_KITS.trials, placements },
    { kit: WORLD_KITS.raceday, placements: shared },
  ];
}

export function createRaidWorldPlan({ startX, startZ, heightAt }) {
  const y = (x, z) => typeof heightAt === 'function' ? heightAt(x, z) : 0;
  const placements = [
    freePlacement('BIVOUAC_CANOPY', startX + 42, y(startX + 42, startZ + 22), startZ + 22, -.5, 1.0),
    freePlacement('FIELD_OFFICE', startX - 46, y(startX - 46, startZ + 24), startZ + 24, .45, .92),
    freePlacement('RADIO_MAST', startX + 58, y(startX + 58, startZ - 36), startZ - 36, 0, .96),
    freePlacement('SOLAR_ARRAY', startX - 52, y(startX - 52, startZ - 30), startZ - 30, .3, .94),
    freePlacement('WATER_TANK', startX + 34, y(startX + 34, startZ + 45), startZ + 45, -.35, .9),
    freePlacement('RECOVERY_RACK', startX - 32, y(startX - 32, startZ + 43), startZ + 43, .4, .9),
  ];
  const flags = [
    freePlacement('WINDSOCK', startX + 27, y(startX + 27, startZ + 27), startZ + 27, 0, .85, { animated: 'wind' }),
    freePlacement('FLAG', startX - 27, y(startX - 27, startZ + 27), startZ + 27, 0, .85, { animated: 'wind' }),
  ];
  return [
    { kit: WORLD_KITS.desert, placements },
    { kit: WORLD_KITS.raceday, placements: flags },
  ];
}

export { QUALITY as WORLD_LIVENESS_QUALITY, WORLD_KITS };
