const TAU = Math.PI * 2;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrapFraction(value) {
  return ((Number(value) || 0) % 1 + 1) % 1;
}

function freezePoints(points) {
  return Object.freeze(points.map((point) => Object.freeze([...point])));
}

function freezeRouteProfile(profile = {}) {
  return Object.freeze({
    smoothingMeters: clamp(Number(profile.smoothingMeters) || 30, 12, 72),
    strength: clamp(Number(profile.strength) || 0.68, 0.42, 0.9),
    lineWidth: clamp(Number(profile.lineWidth) || 5.5, 3.5, 9),
    stamps: Object.freeze((profile.stamps || []).map((stamp, index) => Object.freeze({
      id: String(stamp.id || `rhythm-${index + 1}`),
      label: String(stamp.label || ''),
      fraction: wrapFraction(stamp.fraction),
      radius: clamp(Number(stamp.radius) || 0.06, 0.025, 0.18),
      elevation: clamp(Number(stamp.elevation) || 0, -8, 12),
      bank: clamp(Number(stamp.bank) || 0, -0.12, 0.12),
    }))),
  });
}

function event(id, values) {
  return Object.freeze({
    id,
    routeType: 'point-to-point',
    laps: 1,
    checkpointSpacing: 62,
    routeWidth: 18,
    seed: 1,
    worldSize: 768,
    heightResolution: 513,
    startYaw: 0,
    weather: 'clear',
    timeOfDay: 'afternoon',
    terrain: Object.freeze({
      macroHeight: 18,
      ridgeHeight: 11,
      mediumHeight: 4.8,
      rippleHeight: 0.34,
      basinBias: 0,
      windAngle: 0.44,
      routeConditioning: 0.42,
      looseSand: 0.68,
      ...values.terrain,
    }),
    palette: Object.freeze({
      skyTop: 0x74b8d8,
      horizon: 0xf3c990,
      fog: 0xd7a873,
      sun: 0xffd59b,
      sandLight: 0xdca15f,
      sandDark: 0x8f5b37,
      packed: 0x9e6945,
      accent: 0x6ee7e2,
      ...values.palette,
    }),
    medals: Object.freeze({ S: 70, A: 84, B: 105, ...values.medals }),
    route: freezePoints(values.route),
    landmarks: Object.freeze([...(values.landmarks || [])]),
    ...values,
    terrain: Object.freeze({
      macroHeight: 18,
      ridgeHeight: 11,
      mediumHeight: 4.8,
      rippleHeight: 0.34,
      basinBias: 0,
      windAngle: 0.44,
      routeConditioning: 0.42,
      looseSand: 0.68,
      ...values.terrain,
    }),
    palette: Object.freeze({
      skyTop: 0x74b8d8,
      horizon: 0xf3c990,
      fog: 0xd7a873,
      sun: 0xffd59b,
      sandLight: 0xdca15f,
      sandDark: 0x8f5b37,
      packed: 0x9e6945,
      accent: 0x6ee7e2,
      ...values.palette,
    }),
    medals: Object.freeze({ S: 70, A: 84, B: 105, ...values.medals }),
    route: freezePoints(values.route),
    landmarks: Object.freeze([...(values.landmarks || [])]),
    routeProfile: freezeRouteProfile(values.routeProfile),
  });
}

export const DUNE_EVENTS = Object.freeze({
  whiskerwind: event('whiskerwind', {
    name: 'Whiskerwind Circuit',
    shortName: 'Whiskerwind',
    subtitle: 'ROLLING DUNES · TWO LAPS',
    description: 'Flow through banked bowls, a hero crest, and rolling rhythm dunes while choosing the packed ribbon or softer passing lines.',
    routeType: 'circuit',
    laps: 2,
    checkpointSpacing: 54,
    routeWidth: 24,
    seed: 0x4b414b49,
    worldSize: 704,
    timeOfDay: 'sunset',
    startYaw: 0.54,
    terrain: {
      macroHeight: 13,
      ridgeHeight: 8,
      mediumHeight: 3.8,
      rippleHeight: 0.28,
      windAngle: 0.56,
      routeConditioning: 0.52,
      looseSand: 0.58,
    },
    palette: {
      skyTop: 0x6f91b8,
      horizon: 0xffb66f,
      fog: 0xd58c54,
      sun: 0xffc575,
      sandLight: 0xe2a45d,
      sandDark: 0x8e5337,
      packed: 0x9a6445,
      accent: 0x70f0dc,
    },
    medals: { S: 112, A: 132, B: 158 },
    route: [
      [-155, -78], [-82, -144], [28, -154], [124, -104],
      [166, -12], [127, 91], [42, 145], [-69, 138],
      [-151, 70], [-181, -8],
    ],
    routeProfile: {
      smoothingMeters: 34,
      strength: 0.74,
      lineWidth: 6.2,
      stamps: [
        { id: 'opening-roller', label: 'Opening roller', fraction: 0.08, radius: 0.052, elevation: 1.8, bank: 0.025 },
        { id: 'west-bowl', label: 'West bowl', fraction: 0.19, radius: 0.072, elevation: -1.5, bank: -0.055 },
        { id: 'cat-ear-rise', label: 'Cat-ear rise', fraction: 0.31, radius: 0.068, elevation: 3.2, bank: -0.025 },
        { id: 'hero-crest', label: 'Whiskerwind launch', fraction: 0.43, radius: 0.06, elevation: 5.2, bank: 0.018 },
        { id: 'hero-landing', label: 'Whiskerwind landing', fraction: 0.51, radius: 0.07, elevation: -1.8, bank: 0.01 },
        { id: 'oasis-sweeper', label: 'Oasis sweeper', fraction: 0.64, radius: 0.09, elevation: 1.4, bank: 0.07 },
        { id: 'back-rhythm', label: 'Back rhythm', fraction: 0.77, radius: 0.058, elevation: 3.4, bank: -0.05 },
        { id: 'home-bowl', label: 'Home bowl', fraction: 0.9, radius: 0.07, elevation: -0.8, bank: 0.045 },
      ],
    },
    landmarks: ['cat-ear-mesa', 'service-camp', 'oasis'],
  }),
  sunspine: event('sunspine', {
    name: 'Sunspine Ridge Run',
    shortName: 'Sunspine',
    subtitle: 'RIDGE RALLY · POINT TO POINT',
    description: 'Climb a readable three-stage ridge, commit across the Sunspine transfer, and settle into a long lee-side landing.',
    routeType: 'point-to-point',
    checkpointSpacing: 58,
    routeWidth: 19,
    seed: 0x53554e31,
    worldSize: 896,
    timeOfDay: 'afternoon',
    startYaw: 0.38,
    terrain: {
      macroHeight: 23,
      ridgeHeight: 17,
      mediumHeight: 5.6,
      rippleHeight: 0.32,
      windAngle: 0.29,
      routeConditioning: 0.3,
      looseSand: 0.7,
    },
    palette: {
      skyTop: 0x64bce0,
      horizon: 0xf7d0a0,
      fog: 0xdcb07c,
      sun: 0xffdc9a,
      sandLight: 0xe1af70,
      sandDark: 0x825137,
      packed: 0x9c6b4a,
      accent: 0xffd45d,
    },
    medals: { S: 76, A: 91, B: 112 },
    route: [
      [-334, -196], [-286, -165], [-239, -116], [-194, -70],
      [-137, -29], [-76, 5], [-18, 54], [43, 91],
      [103, 66], [158, 87], [211, 132], [278, 169],
      [345, 218],
    ],
    routeProfile: {
      smoothingMeters: 46,
      strength: 0.82,
      lineWidth: 5.4,
      stamps: [
        { id: 'windward-step', label: 'Windward step', fraction: 0.13, radius: 0.06, elevation: 2.2, bank: 0.025 },
        { id: 'first-transfer', label: 'First transfer', fraction: 0.27, radius: 0.07, elevation: 5.1, bank: -0.035 },
        { id: 'first-landing', label: 'First landing', fraction: 0.35, radius: 0.075, elevation: -2.2, bank: -0.02 },
        { id: 'sunspine-launch', label: 'Sunspine launch', fraction: 0.5, radius: 0.064, elevation: 8.2, bank: 0.02 },
        { id: 'sunspine-landing', label: 'Sunspine landing', fraction: 0.59, radius: 0.085, elevation: -3.1, bank: 0.035 },
        { id: 'ridge-kicker', label: 'Ridge kicker', fraction: 0.72, radius: 0.06, elevation: 5.3, bank: -0.045 },
        { id: 'lee-catch', label: 'Lee catch', fraction: 0.81, radius: 0.08, elevation: -1.8, bank: -0.02 },
        { id: 'finish-shelf', label: 'Finish shelf', fraction: 0.92, radius: 0.07, elevation: 1.5, bank: 0.035 },
      ],
    },
    landmarks: ['sunspine-arch', 'wind-towers', 'ridge-camp'],
  }),
  mirage: event('mirage', {
    name: 'Mirage Mile',
    shortName: 'Mirage Mile',
    subtitle: 'HARDPACK SPRINT · GHOST TRIAL',
    description: 'Link fast packed shelves, a shallow basin cut, and three low record-line crests built for ghosts and clean landings.',
    routeType: 'point-to-point',
    checkpointSpacing: 72,
    routeWidth: 22,
    seed: 0x4d495231,
    worldSize: 1024,
    timeOfDay: 'noon',
    weather: 'heat',
    startYaw: 0.17,
    terrain: {
      macroHeight: 16,
      ridgeHeight: 9,
      mediumHeight: 4.2,
      rippleHeight: 0.24,
      windAngle: 0.12,
      routeConditioning: 0.58,
      looseSand: 0.64,
    },
    palette: {
      skyTop: 0x6cc8e5,
      horizon: 0xf4dfb9,
      fog: 0xe7bd86,
      sun: 0xffe8b5,
      sandLight: 0xe8b773,
      sandDark: 0x98623e,
      packed: 0xa7764f,
      accent: 0xff79b4,
    },
    medals: { S: 64, A: 77, B: 94 },
    route: [
      [-420, -112], [-356, -62], [-292, -70], [-226, -112],
      [-154, -88], [-80, -34], [-4, -56], [78, -21],
      [166, 4], [252, 54], [342, 63], [426, 128],
    ],
    routeProfile: {
      smoothingMeters: 52,
      strength: 0.78,
      lineWidth: 6.8,
      stamps: [
        { id: 'launch-shelf', label: 'Launch shelf', fraction: 0.14, radius: 0.065, elevation: 1.7, bank: 0.03 },
        { id: 'mirage-cut', label: 'Mirage basin cut', fraction: 0.26, radius: 0.085, elevation: -1.5, bank: -0.04 },
        { id: 'record-crest-one', label: 'Record crest one', fraction: 0.4, radius: 0.06, elevation: 2.7, bank: -0.02 },
        { id: 'record-catch-one', label: 'Record catch one', fraction: 0.49, radius: 0.072, elevation: -1.1, bank: 0.035 },
        { id: 'record-crest-two', label: 'Record crest two', fraction: 0.62, radius: 0.058, elevation: 3.1, bank: 0.045 },
        { id: 'record-catch-two', label: 'Record catch two', fraction: 0.71, radius: 0.072, elevation: -1.2, bank: -0.035 },
        { id: 'final-crest', label: 'Final crest', fraction: 0.84, radius: 0.064, elevation: 2.4, bank: -0.025 },
      ],
    },
    landmarks: ['mirage-needles', 'oasis', 'finish-camp'],
  }),
  litterbox: event('litterbox', {
    name: 'The Big Litterbox',
    shortName: 'Big Litterbox',
    subtitle: 'FREERIDE · NO CLOCK',
    description: 'A connected freeride playground with two bowls, catchable transfers, a ridge line, and room to improvise between them.',
    routeType: 'freeride',
    laps: 0,
    checkpointSpacing: 0,
    routeWidth: 30,
    seed: 0x4c495454,
    worldSize: 832,
    timeOfDay: 'sandstorm',
    weather: 'sandstorm',
    startYaw: 0,
    terrain: {
      macroHeight: 21,
      ridgeHeight: 13,
      mediumHeight: 6.2,
      rippleHeight: 0.38,
      basinBias: -2.4,
      windAngle: 0.78,
      routeConditioning: 0.16,
      looseSand: 0.76,
    },
    palette: {
      skyTop: 0xa97552,
      horizon: 0xd5a16c,
      fog: 0xb97b4c,
      sun: 0xffc878,
      sandLight: 0xc98a50,
      sandDark: 0x6f412e,
      packed: 0x8a583b,
      accent: 0x77e4d4,
    },
    medals: { S: 18000, A: 11000, B: 6000 },
    route: [
      [-126, -42], [-78, -96], [-18, -126], [66, -116],
      [132, -72], [151, -8], [118, 66], [54, 119],
      [-18, 135], [-92, 102], [-143, 42], [-151, -15],
    ],
    routeProfile: {
      smoothingMeters: 36,
      strength: 0.84,
      lineWidth: 7.5,
      stamps: [
        { id: 'litter-bowl-entry', label: 'Litter bowl entry', fraction: 0.08, radius: 0.075, elevation: -2.2, bank: 0.045 },
        { id: 'bowl-lip', label: 'Bowl lip', fraction: 0.18, radius: 0.06, elevation: 4.2, bank: 0.02 },
        { id: 'halfpipe-catch', label: 'Halfpipe catch', fraction: 0.29, radius: 0.085, elevation: -2.8, bank: -0.055 },
        { id: 'shelf-transfer', label: 'Shelf transfer', fraction: 0.4, radius: 0.065, elevation: 6.2, bank: -0.025 },
        { id: 'shelf-landing', label: 'Shelf landing', fraction: 0.5, radius: 0.09, elevation: -2.4, bank: 0.035 },
        { id: 'ridge-line', label: 'Ridge line', fraction: 0.63, radius: 0.075, elevation: 3.6, bank: 0.06 },
        { id: 'big-transfer', label: 'Big transfer', fraction: 0.76, radius: 0.065, elevation: 6.8, bank: -0.03 },
        { id: 'home-catch', label: 'Home catch', fraction: 0.87, radius: 0.09, elevation: -2.1, bank: -0.045 },
      ],
    },
    landmarks: ['litter-bowl', 'rock-shelf', 'service-camp', 'oasis'],
  }),
});

export const DUNE_EVENT_ORDER = Object.freeze([
  'whiskerwind',
  'sunspine',
  'mirage',
  'litterbox',
]);

export function getDuneEvent(id = 'whiskerwind') {
  return DUNE_EVENTS[id] || DUNE_EVENTS.whiskerwind;
}

const DRAW_SAND_PALETTES = Object.freeze([
  Object.freeze({
    id: 'golden',
    sandLight: 0xe0a45f,
    sandDark: 0x875039,
    packed: 0x996345,
    horizon: 0xf3c17c,
    fog: 0xd79f69,
  }),
  Object.freeze({
    id: 'rose',
    sandLight: 0xd89568,
    sandDark: 0x77463f,
    packed: 0x915b4d,
    horizon: 0xf0b28f,
    fog: 0xc98b72,
  }),
  Object.freeze({
    id: 'pale',
    sandLight: 0xe1bd86,
    sandDark: 0x8b6548,
    packed: 0xa47b58,
    horizon: 0xf1d4a4,
    fog: 0xd6b483,
  }),
]);

function drawRuntimeFraction(authoredFraction, startFraction, reverse) {
  return reverse
    ? wrapFraction(1 - wrapFraction(startFraction) - wrapFraction(authoredFraction))
    : wrapFraction(wrapFraction(authoredFraction) - wrapFraction(startFraction));
}

function drawRoutePoints(course) {
  const source = Array.isArray(course?.points)
    ? course.points.filter((point) => (
        Array.isArray(point)
        && Number.isFinite(Number(point[0]))
        && Number.isFinite(Number(point[1]))
      ))
    : [];
  if (source.length < 4) throw new Error('A Dune Workshop route needs at least four valid points');
  const stride = Math.max(1, Math.ceil(source.length / 56));
  const selected = [];
  for (let index = 0; index < source.length; index += stride) selected.push(source[index]);
  if (selected.length < 4) selected.push(...source.slice(selected.length, 4));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of selected) {
    minX = Math.min(minX, Number(point[0]));
    maxX = Math.max(maxX, Number(point[0]));
    minZ = Math.min(minZ, Number(point[1]));
    maxZ = Math.max(maxZ, Number(point[1]));
  }
  const centerX = (minX + maxX) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const span = Math.max(48, maxX - minX, maxZ - minZ);
  const targetSpan = clamp(span * 1.82, 248, 760);
  const scale = targetSpan / span;
  return {
    route: selected.map((point) => [
      (Number(point[0]) - centerX) * scale,
      (Number(point[1]) - centerZ) * scale,
    ]),
    span: targetSpan,
    scale,
  };
}

/**
 * Adapt a validated Kaki Course Workshop circuit into a first-class Dune Run
 * event. Its route, height stamps, checkpoints, recovery and ghosts all consume
 * this one serializable definition, including inside the heightfield worker.
 */
export function createDrawDuneEvent(course, draft = course?.drawDraft || {}) {
  if (!course?.isDrawTrack || course.drawThemeId !== 'dune') {
    throw new Error('Only a validated Dune Workshop course can become a Dune Run event');
  }
  const seed = (Number(course.seed ?? draft.seed) || 0x4b414b49) >>> 0;
  const routeData = drawRoutePoints(course);
  const modifiers = { ...(course.drawModifiers || draft.modifiers || {}) };
  const reverse = course.drawDirection === 'reverse' || !!draft.reverse;
  const startFraction = Number(draft.startFraction) || 0;
  const sand = DRAW_SAND_PALETTES[seed % DRAW_SAND_PALETTES.length];
  const storm = !!modifiers.rain;
  const sunset = !!modifiers.nightRace;
  const safeTrackId = String(course.customTrackId || draft.id || seed.toString(36))
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 64);
  const featurePlacements = (course.featurePlacements || []).slice(0, 96).map((placement) => Object.freeze({
    id: String(placement.id || placement.featureId || 'dune-feature').slice(0, 96),
    featureId: String(placement.featureId || '').slice(0, 80),
    fraction: drawRuntimeFraction(placement.anchor?.fraction, startFraction, reverse),
    lateralOffset: (Number(placement.anchor?.lateralOffset) || 0) * routeData.scale,
    rotationOffset: Number(placement.anchor?.rotationOffset) || 0,
    facing: placement.anchor?.facing === 'backward' ? 'backward' : 'forward',
    scaleX: Number(placement.anchor?.scaleX) || 1,
    scaleY: Number(placement.anchor?.scaleY) || 1,
    scaleZ: Number(placement.anchor?.scaleZ) || 1,
    source: String(placement.source || 'manual').slice(0, 24),
  }));
  const elevationProfile = Object.freeze({
    version: 1,
    stamps: Object.freeze((course.elevationProfile?.stamps || []).slice(0, 32).map((stamp) => Object.freeze({
      id: String(stamp.id || 'dune-height').slice(0, 48),
      fraction: wrapFraction(stamp.fraction),
      radius: clamp(Number(stamp.radius) || 0.1, 0.02, 0.28),
      elevation: clamp(Number(stamp.elevation) || 0, -5, 14),
      bank: clamp(Number(stamp.bank) || 0, -0.24, 0.24),
    }))),
  });
  const estimatedLap = Math.max(24, Number(course.drawStats?.estimatedLapTime) || 55);
  const laps = clamp(Math.round(Number(course.laps) || 2), 1, 5);
  const routeWidth = clamp((Number(course.trackWidth) || 9.2) * routeData.scale * 0.92, 17, 34);
  const timeOfDay = sunset ? 'sunset' : (seed & 1) ? 'afternoon' : 'noon';
  const worldSize = clamp(Math.ceil((routeData.span + 300) / 32) * 32, 576, 1152);
  const terrain = Object.freeze({
    macroHeight: 15 + (seed % 5),
    ridgeHeight: 9 + ((seed >>> 3) % 4),
    mediumHeight: 4.2 + ((seed >>> 6) % 5) * 0.25,
    rippleHeight: 0.25 + ((seed >>> 10) % 4) * 0.025,
    basinBias: 0,
    windAngle: ((seed % 6283) / 1000) % TAU,
    routeConditioning: 0.38,
    looseSand: 0.64 + ((seed >>> 14) % 5) * 0.025,
  });
  const palette = Object.freeze({
    skyTop: storm ? 0xa87353 : sunset ? 0x6c87ad : 0x68b7d8,
    horizon: sand.horizon,
    fog: storm ? 0xb87950 : sand.fog,
    sun: sunset ? 0xffc06f : 0xffdc9e,
    sandLight: sand.sandLight,
    sandDark: sand.sandDark,
    packed: sand.packed,
    accent: 0x6ee7d8,
  });
  return Object.freeze({
    id: `draw-${safeTrackId || seed.toString(36)}`,
    name: String(course.name || 'My Dune Run').slice(0, 42),
    shortName: String(course.name || 'My Dune Run').slice(0, 24),
    subtitle: 'DRAWN DUNES · DEFORMABLE CIRCUIT',
    description: 'A player-authored monster-truck route conditioned into a deterministic deformable dune field.',
    routeType: 'circuit',
    laps,
    checkpointSpacing: clamp(routeData.span / 5, 48, 76),
    routeWidth,
    seed,
    worldSize,
    heightResolution: worldSize > 960 ? 513 : 513,
    startYaw: 0,
    weather: storm ? 'sandstorm' : 'clear',
    timeOfDay,
    terrain,
    palette,
    medals: Object.freeze({
      S: estimatedLap * laps * 1.08,
      A: estimatedLap * laps * 1.24,
      B: estimatedLap * laps * 1.46,
    }),
    route: freezePoints(routeData.route),
    landmarks: Object.freeze(['drawn-rally-camp', 'drawn-oasis', sand.id]),
    isDrawTrack: true,
    customTrackId: safeTrackId,
    drawSandVariant: sand.id,
    drawFeaturePlacements: Object.freeze(featurePlacements),
    drawElevationProfile: elevationProfile,
  });
}

function catmull(value0, value1, value2, value3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * value1)
    + (-value0 + value2) * t
    + (2 * value0 - 5 * value1 + 4 * value2 - value3) * t2
    + (-value0 + 3 * value1 - 3 * value2 + value3) * t3
  );
}

function controlPoint(points, index, loop) {
  if (loop) return points[(index % points.length + points.length) % points.length];
  return points[Math.max(0, Math.min(points.length - 1, index))];
}

/**
 * Build an evenly spaced, deterministic route shared by terrain conditioning,
 * checkpoints, ghosts, recovery and presentation.
 */
export function sampleDuneRoute(eventDefinition, spacing = 4) {
  const definition = typeof eventDefinition === 'string'
    ? getDuneEvent(eventDefinition)
    : eventDefinition;
  const points = definition.route;
  const loop = definition.routeType === 'circuit' || definition.routeType === 'freeride';
  const dense = [];
  const segmentCount = loop ? points.length : points.length - 1;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const p0 = controlPoint(points, segment - 1, loop);
    const p1 = controlPoint(points, segment, loop);
    const p2 = controlPoint(points, segment + 1, loop);
    const p3 = controlPoint(points, segment + 2, loop);
    for (let step = 0; step < 24; step += 1) {
      const t = step / 24;
      dense.push({
        x: catmull(p0[0], p1[0], p2[0], p3[0], t),
        z: catmull(p0[1], p1[1], p2[1], p3[1], t),
      });
    }
  }
  if (!loop) {
    const final = points[points.length - 1];
    dense.push({ x: final[0], z: final[1] });
  } else {
    dense.push({ ...dense[0] });
  }

  const samples = [{ ...dense[0], distance: 0, progress: 0, yaw: 0 }];
  let carried = 0;
  let total = 0;
  for (let index = 1; index < dense.length; index += 1) {
    const previous = dense[index - 1];
    const current = dense[index];
    const segmentLength = Math.hypot(current.x - previous.x, current.z - previous.z);
    total += segmentLength;
    let remaining = segmentLength;
    while (carried + remaining >= spacing && segmentLength > 1e-8) {
      const need = spacing - carried;
      const consumed = segmentLength - remaining + need;
      const amount = consumed / segmentLength;
      const x = previous.x + (current.x - previous.x) * amount;
      const z = previous.z + (current.z - previous.z) * amount;
      samples.push({ x, z, distance: total - segmentLength + consumed, progress: 0, yaw: 0 });
      remaining -= need;
      carried = 0;
    }
    carried += remaining;
  }
  if (!loop) {
    const lastDense = dense[dense.length - 1];
    const last = samples[samples.length - 1];
    if (Math.hypot(lastDense.x - last.x, lastDense.z - last.z) > spacing * 0.2) {
      samples.push({ x: lastDense.x, z: lastDense.z, distance: total, progress: 1, yaw: 0 });
    }
  }
  const length = samples.at(-1)?.distance || total || 1;
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    samples[index].progress = samples[index].distance / length;
    samples[index].yaw = Math.atan2(next.x - previous.x, next.z - previous.z);
    samples[index].index = index;
  }
  return {
    samples,
    length,
    loop,
    spacing,
  };
}

export function buildDuneCheckpoints(eventDefinition, routeRuntime) {
  const definition = typeof eventDefinition === 'string'
    ? getDuneEvent(eventDefinition)
    : eventDefinition;
  if (definition.routeType === 'freeride' || !(definition.checkpointSpacing > 0)) return [];
  const checkpoints = [];
  const samples = routeRuntime.samples;
  const count = Math.max(3, Math.ceil(routeRuntime.length / definition.checkpointSpacing));
  const maximum = routeRuntime.loop ? count - 1 : count;
  for (let index = 0; index <= maximum; index += 1) {
    const progress = index / count;
    const sampleIndex = Math.min(samples.length - 1, Math.round(progress * (samples.length - 1)));
    const sample = samples[sampleIndex];
    checkpoints.push(Object.freeze({
      id: index === maximum && !routeRuntime.loop ? 'finish' : `gate-${index}`,
      index,
      progress,
      x: sample.x,
      z: sample.z,
      yaw: sample.yaw,
      width: definition.routeWidth * 0.9,
      finish: index === maximum && !routeRuntime.loop,
    }));
  }
  return checkpoints;
}

export function nearestDuneRouteSample(routeRuntime, x, z, preferredIndex = 0, radius = 32) {
  const samples = routeRuntime.samples;
  if (!samples.length) return { index: 0, distance: Infinity, progress: 0, sample: null };
  const loop = routeRuntime.loop;
  const center = Math.max(0, Math.min(samples.length - 1, Math.round(preferredIndex)));
  const searchAll = radius * 2 + 1 >= samples.length;
  let bestIndex = center;
  let bestDistanceSq = Infinity;
  const start = searchAll ? 0 : -radius;
  const end = searchAll ? samples.length - 1 : radius;
  for (let offset = start; offset <= end; offset += 1) {
    let index = searchAll ? offset : center + offset;
    if (loop) index = (index % samples.length + samples.length) % samples.length;
    else if (index < 0 || index >= samples.length) continue;
    const sample = samples[index];
    const dx = x - sample.x;
    const dz = z - sample.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  }
  const sample = samples[bestIndex];
  return {
    index: bestIndex,
    distance: Math.sqrt(bestDistanceSq),
    progress: sample.progress,
    sample,
  };
}

export function wrappedDuneProgressDelta(previous, next) {
  let delta = next - previous;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;
  return delta;
}

export function duneWindVector(eventDefinition, target = { x: 0, z: 0 }) {
  const definition = typeof eventDefinition === 'string'
    ? getDuneEvent(eventDefinition)
    : eventDefinition;
  const angle = definition.terrain.windAngle % TAU;
  target.x = Math.cos(angle);
  target.z = Math.sin(angle);
  return target;
}
