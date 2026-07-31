/**
 * Kaki Rally Raid content contracts.
 *
 * This file is deliberately data-first. The Dune Run runtime remains the
 * owner of heightfields, four-wheel contact, deformation, ghosts, cameras,
 * and cleanup; Rally Raid only supplies authored stages, vehicle identity,
 * and the roadbook rules layered over those proven systems.
 */

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freeze(entry)));
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
}

function stage(id, values = {}) {
  return freeze({
    id,
    routeType: 'point-to-point',
    laps: 1,
    checkpointSpacing: 58,
    routeWidth: 20,
    worldSize: 960,
    heightResolution: 513,
    startYaw: 0,
    weather: 'clear',
    timeOfDay: 'afternoon',
    terrain: {
      macroHeight: 18,
      ridgeHeight: 12,
      mediumHeight: 5.2,
      rippleHeight: 0.3,
      basinBias: 0,
      windAngle: 0.3,
      routeConditioning: 0.34,
      looseSand: 0.68,
      ...values.terrain,
    },
    palette: {
      skyTop: 0x6e9fbe,
      horizon: 0xf0c38d,
      fog: 0xd8a674,
      sun: 0xffd49a,
      sandLight: 0xdca364,
      sandDark: 0x7f5138,
      packed: 0x98654a,
      track: 0x493447,
      accent: 0xffcf5b,
      ...values.palette,
    },
    medals: { S: 82, A: 99, B: 124, ...values.medals },
    route: values.route || [],
    routeProfile: values.routeProfile || { stamps: [] },
    landmarks: values.landmarks || [],
    roadbook: values.roadbook || {},
    isRallyRaid: true,
    ...values,
    terrain: {
      macroHeight: 18,
      ridgeHeight: 12,
      mediumHeight: 5.2,
      rippleHeight: 0.3,
      basinBias: 0,
      windAngle: 0.3,
      routeConditioning: 0.34,
      looseSand: 0.68,
      ...values.terrain,
    },
    palette: {
      skyTop: 0x6e9fbe,
      horizon: 0xf0c38d,
      fog: 0xd8a674,
      sun: 0xffd49a,
      sandLight: 0xdca364,
      sandDark: 0x7f5138,
      packed: 0x98654a,
      track: 0x493447,
      accent: 0xffcf5b,
      ...values.palette,
    },
    medals: { S: 82, A: 99, B: 124, ...values.medals },
  });
}

export const RALLY_RAID_VEHICLES = freeze({
  buggy: {
    id: 'buggy',
    name: 'Kaki Skimmer 2WD',
    shortName: 'Skimmer',
    archetype: 'LIGHTWEIGHT BUGGY',
    description: 'A nimble rear-drive sand skimmer: quick to rotate, quick to recover, nervous over a broken landing.',
    color: 0xff7b5f,
    accent: 0xffd45c,
    drive: '2WD',
    mass: 1.12,
    stability: 0.78,
    tuning: {
      acceleration: 20.4,
      reverseAcceleration: 12.2,
      brake: 28.4,
      rollingResistance: 0.42,
      aerodynamicDrag: 0.0046,
      engineBraking: 0.08,
      roadGrip: 8.3,
      offroadGrip: 6.3,
      driftGrip: 2.1,
      surfaceDragScale: 0.58,
      surfaceResponse: 6.4,
      steerRate: 1.92,
      driftSteerRate: 2.28,
      steeringResponse: 11.4,
      steeringReturn: 14.2,
      maxSpeed: 33.2,
      reverseSpeed: 9.2,
      offroadSpeed: 30.8,
      boostSpeed: 39.4,
      boostAcceleration: 28.2,
      gravity: 17.6,
      airPitchControl: 8.8,
      airRollControl: 10.1,
      highSpeedSteerScale: 0.57,
      lowSpeedTorque: 0.5,
      suspensionSpring: 45,
      suspensionDamping: 8.3,
      powertrain: {
        peakTorque: 780,
        gearRatios: [3.72, 2.38, 1.68, 1.24, 0.96],
        shiftSpeeds: [12.1, 18.9, 25.4, 31.9],
        finalDrive: 16.8,
        tractionLimit: 10.2,
        mass: 1120,
      },
    },
    contact: {
      wheelbase: 2.82,
      trackWidth: 1.72,
      wheelRadius: 0.49,
      tireWidth: 0.58,
      suspensionTravel: 0.74,
      suspensionRest: 0.35,
      contactSpring: 42,
      contactDamping: 8.2,
      maxClimbHeight: 1.12,
    },
  },
  prototype: {
    id: 'prototype',
    name: 'Kaki Atlas 4×4',
    shortName: 'Atlas',
    archetype: 'BALANCED 4×4 PROTOTYPE',
    description: 'The all-round expedition tool: four driven wheels, calm landings, and enough pace to make every surface useful.',
    color: 0x4b9f9c,
    accent: 0xffcf5b,
    drive: '4WD',
    mass: 1.68,
    stability: 1.04,
    tuning: {
      acceleration: 18.8,
      reverseAcceleration: 11.1,
      brake: 30.2,
      rollingResistance: 0.54,
      aerodynamicDrag: 0.0054,
      engineBraking: 0.11,
      roadGrip: 8.8,
      offroadGrip: 7.35,
      driftGrip: 2.5,
      surfaceDragScale: 0.68,
      surfaceResponse: 5.6,
      steerRate: 1.66,
      driftSteerRate: 2.02,
      steeringResponse: 10.2,
      steeringReturn: 12.8,
      maxSpeed: 32.4,
      reverseSpeed: 8.6,
      offroadSpeed: 29.7,
      boostSpeed: 38.1,
      boostAcceleration: 27.2,
      gravity: 17.2,
      airPitchControl: 7.3,
      airRollControl: 7.8,
      highSpeedSteerScale: 0.52,
      lowSpeedTorque: 0.42,
      suspensionSpring: 54,
      suspensionDamping: 10.5,
      powertrain: {
        peakTorque: 1260,
        gearRatios: [3.48, 2.29, 1.64, 1.22, 0.93],
        shiftSpeeds: [11.8, 18.3, 24.8, 31.2],
        finalDrive: 17.5,
        tractionLimit: 15.3,
        mass: 1680,
      },
    },
    contact: {
      wheelbase: 3.16,
      trackWidth: 1.9,
      wheelRadius: 0.58,
      tireWidth: 0.7,
      suspensionTravel: 0.86,
      suspensionRest: 0.38,
      contactSpring: 54,
      contactDamping: 10.4,
      maxClimbHeight: 1.42,
    },
  },
  truck: {
    id: 'truck',
    name: 'Kaki Colossus T5',
    shortName: 'Colossus',
    archetype: 'HEAVY RALLY TRUCK',
    description: 'A long-wheelbase service truck with locomotive torque, huge travel, and consequences for every bad line.',
    color: 0x9b586a,
    accent: 0x75e3d3,
    drive: '4WD',
    mass: 6.2,
    stability: 1.24,
    tuning: {
      acceleration: 13.5,
      reverseAcceleration: 8.6,
      brake: 34.5,
      rollingResistance: 0.88,
      aerodynamicDrag: 0.0072,
      engineBraking: 0.18,
      roadGrip: 8.1,
      offroadGrip: 6.9,
      driftGrip: 2.9,
      surfaceDragScale: 0.92,
      surfaceResponse: 4.25,
      steerRate: 1.2,
      driftSteerRate: 1.48,
      steeringResponse: 8.4,
      steeringReturn: 10.6,
      maxSpeed: 27.5,
      reverseSpeed: 7.2,
      offroadSpeed: 24.9,
      boostSpeed: 32.8,
      boostAcceleration: 23.6,
      gravity: 18.4,
      airPitchControl: 4.6,
      airRollControl: 4.2,
      highSpeedSteerScale: 0.42,
      lowSpeedTorque: 0.34,
      suspensionSpring: 72,
      suspensionDamping: 14.2,
      powertrain: {
        peakTorque: 3980,
        gearRatios: [4.1, 2.66, 1.86, 1.31, 0.98],
        shiftSpeeds: [9.9, 15.5, 21.1, 26.4],
        finalDrive: 19.2,
        tractionLimit: 34.5,
        mass: 6200,
      },
    },
    contact: {
      wheelbase: 4.28,
      trackWidth: 2.08,
      wheelRadius: 0.82,
      tireWidth: 0.9,
      suspensionTravel: 0.96,
      suspensionRest: 0.42,
      contactSpring: 68,
      contactDamping: 13.6,
      maxClimbHeight: 1.72,
    },
  },
});

export const RALLY_RAID_VEHICLE_ORDER = Object.freeze(['buggy', 'prototype', 'truck']);

export function getRallyRaidVehicle(id = 'prototype') {
  return RALLY_RAID_VEHICLES[id] || RALLY_RAID_VEHICLES.prototype;
}

export const ROADBOOK_ASSISTS = freeze({
  sport: {
    id: 'sport',
    name: 'Sport',
    description: 'Generous gate markers, roadbook calls, and a forgiving route ribbon.',
    routeReveal: true,
    gateAssist: true,
  },
  rally: {
    id: 'rally',
    name: 'Rally',
    description: 'Roadbook and heading calls with limited route revelation.',
    routeReveal: false,
    gateAssist: true,
  },
  navigator: {
    id: 'navigator',
    name: 'Navigator',
    description: 'Roadbook, CAP, terrain symbols, and waypoint validation only.',
    routeReveal: false,
    gateAssist: false,
  },
});

export const ROADBOOK_ASSIST_ORDER = Object.freeze(['sport', 'rally', 'navigator']);

export const RALLY_RAID_STAGE_ORDER = Object.freeze([
  'raid-prologue',
  'raid-wadi-crossing',
  'raid-saltline',
  'raid-night-ridge',
]);

export const RALLY_RAID_STAGES = freeze({
  'raid-prologue': stage('raid-prologue', {
    name: 'Rally Raid Prologue',
    shortName: 'Prologue',
    subtitle: 'ROADBOOK · QUALIFIER · 14 KM',
    description: 'A compact qualifier that teaches CAP calls, crest rhythm, and choosing hardpack over the obvious dune line.',
    checkpointSpacing: 54,
    routeWidth: 21,
    worldSize: 832,
    seed: 0x5250524f,
    startYaw: 0.4,
    weather: 'clear',
    timeOfDay: 'dawn',
    terrain: {
      macroHeight: 15,
      ridgeHeight: 10,
      mediumHeight: 4.2,
      rippleHeight: 0.24,
      routeConditioning: 0.48,
      looseSand: 0.56,
      windAngle: 0.24,
    },
    palette: {
      skyTop: 0x506f9b,
      horizon: 0xf3a36f,
      fog: 0xb9785d,
      sun: 0xffb875,
      sandLight: 0xc98b59,
      sandDark: 0x623e37,
      packed: 0x8d5d4b,
      accent: 0x74e7da,
    },
    medals: { S: 68, A: 82, B: 104 },
    route: [
      [-292, -146], [-236, -126], [-176, -88], [-110, -106],
      [-44, -62], [18, -6], [76, 32], [138, 15],
      [198, 58], [254, 94], [310, 142],
    ],
    routeProfile: {
      smoothingMeters: 38,
      strength: 0.8,
      lineWidth: 6,
      stamps: [
        { id: 'prologue-crest', label: 'Crest', fraction: 0.22, radius: 0.075, elevation: 4.8, bank: 0.02 },
        { id: 'prologue-wadi', label: 'Wadi dip', fraction: 0.43, radius: 0.07, elevation: -2.4, bank: -0.035 },
        { id: 'prologue-catch', label: 'Hardpack catch', fraction: 0.67, radius: 0.08, elevation: 4.1, bank: 0.03 },
        { id: 'prologue-beacon', label: 'Beacon bend', fraction: 0.78, radius: 0.07, elevation: 3.1, bank: -0.02 },
        { id: 'prologue-gully', label: 'Gully exit', fraction: 0.84, radius: 0.05, elevation: -0.7, bank: 0.018 },
        { id: 'prologue-finish', label: 'Finish shelf', fraction: 0.9, radius: 0.07, elevation: 2.1, bank: -0.018 },
        { id: 'prologue-camp', label: 'Camp approach', fraction: 0.96, radius: 0.045, elevation: 0.5, bank: 0.01 },
      ],
    },
    landmarks: ['prologue-gate', 'ridge-camp', 'wind-towers'],
    roadbook: {
      notes: [
        { fraction: 0.1, symbol: 'CAP', instruction: 'CAP 062 · keep hardpack', hazard: 'hardpack', speedLimit: 25 },
        { fraction: 0.24, symbol: 'C', instruction: 'Crest · light', hazard: 'crest' },
        { fraction: 0.43, symbol: 'W', instruction: 'Wadi · left entry', hazard: 'wadi' },
        { fraction: 0.66, symbol: 'R2', instruction: 'R2 opens · cut late', hazard: 'rocks' },
        { fraction: 0.86, symbol: 'FIN', instruction: 'Finish · service camp', hazard: 'finish' },
      ],
    },
  }),
  'raid-wadi-crossing': stage('raid-wadi-crossing', {
    name: 'Wadi of Whiskers',
    shortName: 'Wadi Crossing',
    subtitle: 'SELECTIVE 01 · ROCK / SAND',
    description: 'A broken wash where the stable 4×4 can carry speed through rock gardens and the Skimmer must pick every landing.',
    checkpointSpacing: 62,
    routeWidth: 19,
    worldSize: 1024,
    seed: 0x57414449,
    startYaw: 0.22,
    terrain: {
      macroHeight: 23,
      ridgeHeight: 15,
      mediumHeight: 6.1,
      rippleHeight: 0.44,
      basinBias: -2.1,
      routeConditioning: 0.24,
      looseSand: 0.72,
      windAngle: 0.5,
    },
    palette: {
      skyTop: 0x779fbd,
      horizon: 0xf0c18b,
      fog: 0xd1a06f,
      sun: 0xffd39d,
      sandLight: 0xc9925c,
      sandDark: 0x694636,
      packed: 0x805747,
      accent: 0xffce57,
    },
    medals: { S: 95, A: 114, B: 142 },
    route: [
      [-382, -224], [-327, -175], [-276, -124], [-221, -92],
      [-164, -118], [-108, -72], [-52, -26], [8, -42],
      [64, 8], [126, 76], [188, 62], [246, 105],
      [312, 146], [382, 211],
    ],
    routeProfile: {
      smoothingMeters: 45,
      strength: 0.8,
      lineWidth: 5.4,
      stamps: [
        { id: 'wadi-entry', label: 'Wadi entry', fraction: 0.16, radius: 0.075, elevation: -2.8, bank: 0.03 },
        { id: 'rock-garden', label: 'Rock garden', fraction: 0.33, radius: 0.06, elevation: 3.4, bank: -0.02 },
        { id: 'wash-drop', label: 'Wash drop', fraction: 0.48, radius: 0.07, elevation: -4.1, bank: 0.02 },
        { id: 'wash-rise', label: 'Wash rise', fraction: 0.58, radius: 0.07, elevation: 5.2, bank: -0.04 },
        { id: 'wadi-exit', label: 'Wadi exit', fraction: 0.78, radius: 0.08, elevation: 2.8, bank: 0.035 },
        { id: 'wadi-shelf', label: 'Wadi shelf', fraction: 0.86, radius: 0.06, elevation: 1.6, bank: -0.025 },
        { id: 'wadi-finish', label: 'Finish catch', fraction: 0.94, radius: 0.05, elevation: 1.2, bank: 0.015 },
      ],
    },
    landmarks: ['wadi-arches', 'rock-shelf', 'service-camp'],
    roadbook: {
      notes: [
        { fraction: 0.08, symbol: 'R3', instruction: 'R3 over crest · brake', hazard: 'crest', speedLimit: 22 },
        { fraction: 0.2, symbol: 'W', instruction: 'Wadi · stay center', hazard: 'wadi' },
        { fraction: 0.36, symbol: '!', instruction: 'Rocks · narrow', hazard: 'rocks', speedLimit: 18 },
        { fraction: 0.5, symbol: 'C', instruction: 'Drop / rise · commit', hazard: 'drop' },
        { fraction: 0.75, symbol: 'L2', instruction: 'L2 opens · outside', hazard: 'loose-sand' },
        { fraction: 0.91, symbol: 'FIN', instruction: 'Finish · wadi exit', hazard: 'finish' },
      ],
    },
  }),
  'raid-saltline': stage('raid-saltline', {
    name: 'Saltline Express',
    shortName: 'Saltline',
    subtitle: 'SELECTIVE 02 · HARDPACK / SPEED',
    description: 'A long salt-flat transfer where heading discipline, speed-control zones, and clean suspension landings decide the clock.',
    checkpointSpacing: 78,
    routeWidth: 24,
    worldSize: 1152,
    seed: 0x53414c54,
    startYaw: 0.16,
    timeOfDay: 'noon',
    weather: 'heat',
    terrain: {
      macroHeight: 12,
      ridgeHeight: 8,
      mediumHeight: 3.4,
      rippleHeight: 0.18,
      routeConditioning: 0.64,
      looseSand: 0.48,
      windAngle: 0.1,
    },
    palette: {
      skyTop: 0x71c6dd,
      horizon: 0xf5dfbb,
      fog: 0xe1c18f,
      sun: 0xffe7ac,
      sandLight: 0xe1c58e,
      sandDark: 0x92775b,
      packed: 0xb19873,
      accent: 0xff7eb7,
    },
    medals: { S: 88, A: 104, B: 128 },
    route: [
      [-488, -84], [-407, -66], [-326, -38], [-244, -58],
      [-158, -12], [-70, 4], [22, -19], [116, 13],
      [208, 44], [304, 28], [397, 76], [488, 126],
    ],
    routeProfile: {
      smoothingMeters: 58,
      strength: 0.78,
      lineWidth: 7,
      stamps: [
        { id: 'salt-launch', label: 'Salt launch', fraction: 0.18, radius: 0.075, elevation: 3.1, bank: 0.015 },
        { id: 'heat-haze', label: 'Heat haze', fraction: 0.38, radius: 0.09, elevation: -1.6, bank: -0.018 },
        { id: 'salt-midcrest', label: 'Midway crest', fraction: 0.46, radius: 0.08, elevation: 4.6, bank: 0.018 },
        { id: 'salt-crest', label: 'Salt crest', fraction: 0.58, radius: 0.075, elevation: 4.4, bank: 0.02 },
        { id: 'salt-mirage', label: 'Mirage marker', fraction: 0.71, radius: 0.07, elevation: 2.7, bank: 0.012 },
        { id: 'finish-rise', label: 'Finish rise', fraction: 0.84, radius: 0.08, elevation: 3.2, bank: -0.02 },
        { id: 'salt-beacon', label: 'Beacon shelf', fraction: 0.9, radius: 0.07, elevation: 2.1, bank: 0.012 },
        { id: 'salt-camp', label: 'Salt camp', fraction: 0.96, radius: 0.045, elevation: 0.4, bank: -0.008 },
      ],
    },
    landmarks: ['salt-obelisk', 'mirage-needles', 'finish-camp'],
    roadbook: {
      notes: [
        { fraction: 0.1, symbol: 'CAP', instruction: 'CAP 084 · flat out', hazard: 'salt', speedLimit: 29 },
        { fraction: 0.34, symbol: 'SC', instruction: 'Speed control · 18', hazard: 'speed-zone', speedLimit: 18, speedZone: [0.34, 0.46] },
        { fraction: 0.56, symbol: 'CAP', instruction: 'CAP 072 · crest light', hazard: 'crest' },
        { fraction: 0.73, symbol: 'L1', instruction: 'L1 · late apex', hazard: 'hardpack' },
        { fraction: 0.9, symbol: 'FIN', instruction: 'Finish · salt camp', hazard: 'finish' },
      ],
    },
  }),
  'raid-night-ridge': stage('raid-night-ridge', {
    name: 'Night Ridge Relay',
    shortName: 'Night Ridge',
    subtitle: 'SELECTIVE 03 · DUSK / CRESTS',
    description: 'The expedition finale: low sun, blind ridge calls, and a narrow finish shelf where the truck earns its time back.',
    checkpointSpacing: 60,
    routeWidth: 18,
    worldSize: 1000,
    seed: 0x4e495445,
    startYaw: 0.35,
    timeOfDay: 'sunset',
    terrain: {
      macroHeight: 27,
      ridgeHeight: 19,
      mediumHeight: 6.8,
      rippleHeight: 0.36,
      routeConditioning: 0.26,
      looseSand: 0.73,
      windAngle: 0.7,
    },
    palette: {
      skyTop: 0x4e5e91,
      horizon: 0xe48a63,
      fog: 0x9b5c58,
      sun: 0xffa161,
      sandLight: 0xb87751,
      sandDark: 0x4d3340,
      packed: 0x704a48,
      accent: 0x74e8dc,
    },
    medals: { S: 102, A: 122, B: 151 },
    route: [
      [-372, -206], [-320, -158], [-263, -132], [-210, -76],
      [-151, -101], [-94, -49], [-34, -2], [28, 46],
      [83, 24], [139, 74], [202, 122], [269, 105],
      [333, 156], [390, 222],
    ],
    routeProfile: {
      smoothingMeters: 42,
      strength: 0.84,
      lineWidth: 5.1,
      stamps: [
        { id: 'night-crest-one', label: 'Blind crest', fraction: 0.2, radius: 0.065, elevation: 5.8, bank: 0.02 },
        { id: 'night-catch-one', label: 'Dark landing', fraction: 0.29, radius: 0.08, elevation: -3.2, bank: -0.025 },
        { id: 'night-ridge', label: 'Ridge spine', fraction: 0.51, radius: 0.06, elevation: 7.2, bank: 0.035 },
        { id: 'night-wash', label: 'Wash exit', fraction: 0.68, radius: 0.085, elevation: -3.8, bank: -0.04 },
        { id: 'night-beacon-rise', label: 'Beacon rise', fraction: 0.76, radius: 0.06, elevation: 3.2, bank: 0.02 },
        { id: 'night-finish', label: 'Finish shelf', fraction: 0.9, radius: 0.075, elevation: 2.4, bank: 0.02 },
        { id: 'night-camp', label: 'Camp lights', fraction: 0.96, radius: 0.045, elevation: 0.7, bank: -0.01 },
      ],
    },
    landmarks: ['night-beacon', 'ridge-camp', 'kaki-obelisk'],
    roadbook: {
      notes: [
        { fraction: 0.09, symbol: 'R2', instruction: 'R2 over blind crest', hazard: 'blind-crest', speedLimit: 21 },
        { fraction: 0.27, symbol: 'C', instruction: 'Crest / catch · straight', hazard: 'landing' },
        { fraction: 0.49, symbol: 'L3', instruction: 'L3 tightens · ridge', hazard: 'ridge', speedLimit: 19 },
        { fraction: 0.67, symbol: 'W', instruction: 'Wash · stay high', hazard: 'wash' },
        { fraction: 0.82, symbol: 'CAP', instruction: 'CAP 118 · beacon', hazard: 'night' },
        { fraction: 0.93, symbol: 'FIN', instruction: 'Finish · expedition', hazard: 'finish' },
      ],
    },
  }),
});

export const RALLY_RAID_EXPEDITION = freeze({
  id: 'kaki-rally-raid-expedition',
  name: 'Kaki Rally Raid Expedition',
  stages: RALLY_RAID_STAGE_ORDER,
  service: {
    push: { id: 'push', name: 'Push on', time: 0, description: 'Keep the damage and leave immediately.' },
    repair: { id: 'repair', name: 'Service', time: 18, description: 'Repair the truck and reset reliability for the next selective.' },
  },
});

export const RALLY_RAID_PROGRESS_KEY = 'kks_rally_raid_progress_v1';
export const RALLY_RAID_PROGRESS_SCHEMA = 1;

function emptyExpeditionProgress(vehicleId = 'prototype') {
  return {
    schema: RALLY_RAID_PROGRESS_SCHEMA,
    vehicleId,
    completedStages: [],
    cumulativeTime: 0,
    serviceSeconds: 0,
    damage: 0,
    lastStageId: '',
    lastService: '',
    updatedAt: '',
  };
}

export function readRallyRaidProgress(vehicleId = 'prototype', storage = globalThis.localStorage) {
  const fallback = emptyExpeditionProgress(vehicleId);
  try {
    const raw = storage?.getItem?.(RALLY_RAID_PROGRESS_KEY);
    if (!raw) return fallback;
    const source = JSON.parse(raw);
    const completedStages = Array.isArray(source.completedStages)
      ? source.completedStages.filter((id) => RALLY_RAID_STAGE_ORDER.includes(id))
      : [];
    return {
      ...fallback,
      ...source,
      vehicleId: String(source.vehicleId || vehicleId),
      completedStages: [...new Set(completedStages)],
      cumulativeTime: Math.max(0, Number(source.cumulativeTime) || 0),
      serviceSeconds: Math.max(0, Number(source.serviceSeconds) || 0),
      damage: clamp(Number(source.damage) || 0, 0, 100),
      lastStageId: RALLY_RAID_STAGE_ORDER.includes(source.lastStageId) ? source.lastStageId : '',
      lastService: ['push', 'repair'].includes(source.lastService) ? source.lastService : '',
    };
  } catch (_) {
    return fallback;
  }
}

export function writeRallyRaidProgress(progress, storage = globalThis.localStorage) {
  const source = progress || emptyExpeditionProgress();
  const sanitized = {
    ...emptyExpeditionProgress(source.vehicleId),
    ...source,
    completedStages: [...new Set((source.completedStages || []).filter((id) => RALLY_RAID_STAGE_ORDER.includes(id)))],
    cumulativeTime: Math.max(0, Number(source.cumulativeTime) || 0),
    serviceSeconds: Math.max(0, Number(source.serviceSeconds) || 0),
    damage: clamp(Number(source.damage) || 0, 0, 100),
    updatedAt: new Date().toISOString(),
  };
  storage?.setItem?.(RALLY_RAID_PROGRESS_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function recordRallyRaidStage({
  progress,
  stageId,
  vehicleId = 'prototype',
  stageTime = 0,
  recoveries = 0,
  serviceId = 'push',
} = {}, storage = globalThis.localStorage) {
  const next = readRallyRaidProgress(vehicleId, storage);
  const base = progress || next;
  if (base.vehicleId !== vehicleId) {
    Object.assign(base, emptyExpeditionProgress(vehicleId));
  }
  if (!RALLY_RAID_STAGE_ORDER.includes(stageId) || base.completedStages.includes(stageId)) {
    return writeRallyRaidProgress(base, storage);
  }
  const service = RALLY_RAID_EXPEDITION.service[serviceId] || RALLY_RAID_EXPEDITION.service.push;
  base.vehicleId = vehicleId;
  base.completedStages = [...base.completedStages, stageId];
  base.cumulativeTime += Math.max(0, Number(stageTime) || 0) + service.time;
  base.serviceSeconds += service.time;
  base.damage = serviceId === 'repair'
    ? 0
    : clamp(base.damage + Math.max(0, Number(recoveries) || 0) * 4.5 + 2.5, 0, 100);
  base.lastStageId = stageId;
  base.lastService = service.id;
  return writeRallyRaidProgress(base, storage);
}

export function nextRallyRaidStage(progress) {
  const completed = new Set(progress?.completedStages || []);
  return RALLY_RAID_STAGE_ORDER.find((id) => !completed.has(id)) || null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function wrapDegrees(value) {
  return ((Number(value) || 0) % 360 + 360) % 360;
}

function routeLength(routeRuntime) {
  const samples = routeRuntime?.samples || [];
  if (samples.length < 2) return 1;
  let length = 0;
  for (let index = 1; index < samples.length; index += 1) {
    length += Math.hypot(
      samples[index].x - samples[index - 1].x,
      samples[index].z - samples[index - 1].z,
    );
  }
  return Math.max(1, length);
}

function sampleAtProgress(routeRuntime, progress) {
  const samples = routeRuntime?.samples || [];
  if (!samples.length) return { x: 0, z: 0, yaw: 0, progress: 0 };
  const target = clamp(progress, 0, 1);
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) * 0.5);
    if ((samples[middle].progress || 0) < target) low = middle + 1;
    else high = middle;
  }
  return samples[Math.min(samples.length - 1, low)];
}

function noteWithRuntimeData(note, routeRuntime, index, totalLength) {
  const sample = sampleAtProgress(routeRuntime, note.fraction);
  return {
    ...note,
    id: note.id || `roadbook-${index + 1}`,
    index,
    fraction: clamp(note.fraction, 0.01, 0.985),
    cap: Math.round(wrapDegrees((Number(sample.yaw) || 0) * 180 / Math.PI)),
    distanceMeters: Math.round((1 - clamp(note.fraction, 0, 1)) * totalLength),
    x: sample.x,
    z: sample.z,
    gateWidth: Number(note.gateWidth) || 13,
    speedZone: Array.isArray(note.speedZone) ? note.speedZone : null,
  };
}

export function buildRoadbookNotes(eventDefinition, routeRuntime) {
  const source = Array.isArray(eventDefinition?.roadbook?.notes)
    ? eventDefinition.roadbook.notes
    : [];
  const totalLength = routeLength(routeRuntime);
  return source
    .map((note, index) => noteWithRuntimeData(note, routeRuntime, index, totalLength))
    .sort((left, right) => left.fraction - right.fraction);
}

export function createRoadbookState(eventDefinition, routeRuntime, assist = 'rally') {
  const selected = ROADBOOK_ASSISTS[assist] || ROADBOOK_ASSISTS.rally;
  const notes = buildRoadbookNotes(eventDefinition, routeRuntime);
  return {
    assist: selected.id,
    routeReveal: selected.routeReveal,
    gateAssist: selected.gateAssist,
    notes,
    nextIndex: 0,
    validated: 0,
    missed: 0,
    penaltySeconds: 0,
    speedPenaltySeconds: 0,
    speedZoneViolations: {},
    activeSpeedZone: null,
    speedViolationTime: 0,
    lastEvent: '',
    lastEventTime: 0,
    callout: '',
    calloutTime: 0,
    finished: false,
    routeLength: routeLength(routeRuntime),
    events: [],
  };
}

function addRoadbookPenalty(state, seconds, reason, note) {
  const value = Math.max(1, Math.round(Number(seconds) || 1));
  state.penaltySeconds += value;
  if (reason === 'speed-control') state.speedPenaltySeconds += value;
  state.lastEvent = `${reason === 'speed-control' ? 'SPEED CONTROL' : 'MISSED WAYPOINT'} +${value}s`;
  state.lastEventTime = 1.35;
  state.callout = state.lastEvent;
  state.calloutTime = 1.35;
  state.events.push({
    type: 'penalty',
    seconds: value,
    reason,
    noteId: note?.id || '',
  });
  return value;
}

export function stepRoadbook(state, eventDefinition, routeRuntime, kart, race, dt) {
  if (!state || state.finished || !(dt > 0)) return state?.events || [];
  state.events.length = 0;
  state.lastEventTime = Math.max(0, state.lastEventTime - dt);
  state.calloutTime = Math.max(0, state.calloutTime - dt);
  const progress = clamp(race?.routeProgress, 0, 1);

  while (state.nextIndex < state.notes.length) {
    const note = state.notes[state.nextIndex];
    const distance = Math.hypot((kart?.x || 0) - note.x, (kart?.z || 0) - note.z);
    if (progress >= note.fraction - 0.018 && distance <= note.gateWidth * (state.gateAssist ? 1.2 : 0.92)) {
      state.validated += 1;
      state.lastEvent = `WAYPOINT ${state.validated}/${state.notes.length}`;
      state.lastEventTime = 1.05;
      state.callout = `${note.symbol} · ${note.instruction}`;
      state.calloutTime = 1.25;
      state.events.push({ type: 'validated', note });
      state.nextIndex += 1;
      continue;
    }
    if (progress > note.fraction + 0.055) {
      state.missed += 1;
      addRoadbookPenalty(state, 8, 'waypoint', note);
      state.events.push({ type: 'missed', note });
      state.nextIndex += 1;
      continue;
    }
    break;
  }

  const activeNote = state.notes[state.nextIndex];
  for (const note of state.notes) {
    if (!note.speedZone || state.speedZoneViolations[note.id]) continue;
    const [start, end] = note.speedZone;
    if (progress >= start && progress <= end) {
      if (state.activeSpeedZone !== note.id) {
        state.activeSpeedZone = note.id;
        state.speedViolationTime = 0;
      }
      if ((kart?.speed || 0) > (Number(note.speedLimit) || Infinity)) {
        state.speedViolationTime += dt;
      }
    } else if (state.activeSpeedZone === note.id && progress > end) {
      if (state.speedViolationTime > 0.18) {
        const seconds = Math.ceil(state.speedViolationTime * 3);
        addRoadbookPenalty(state, seconds, 'speed-control', note);
      }
      state.speedZoneViolations[note.id] = true;
      state.activeSpeedZone = null;
      state.speedViolationTime = 0;
    }
  }

  if (activeNote && state.lastEventTime <= 0 && progress >= activeNote.fraction - 0.12) {
    state.callout = `${activeNote.symbol} · ${activeNote.instruction}`;
    state.calloutTime = 0.32;
  }
  if (race?.finished) finishRoadbook(state);
  return state.events;
}

export function finishRoadbook(state) {
  if (!state || state.finished) return state;
  state.events.length = 0;
  while (state.nextIndex < state.notes.length) {
    state.missed += 1;
    addRoadbookPenalty(state, 8, 'waypoint', state.notes[state.nextIndex]);
    state.nextIndex += 1;
  }
  state.finished = true;
  return state;
}

export function roadbookSnapshot(state, race = null) {
  if (!state) return null;
  const note = state.notes[state.nextIndex] || null;
  return {
    assist: state.assist,
    routeReveal: state.routeReveal,
    gateAssist: state.gateAssist,
    next: note
      ? {
          id: note.id,
          index: note.index,
          symbol: note.symbol || 'CAP',
          instruction: note.instruction || '',
          hazard: note.hazard || '',
          cap: note.cap,
          distanceMeters: Math.max(0, Math.round((note.fraction - clamp(race?.routeProgress, 0, 1)) * state.routeLength)),
          speedLimit: note.speedLimit || null,
          speedZone: note.speedZone || null,
        }
      : null,
    total: state.notes.length,
    validated: state.validated,
    missed: state.missed,
    penaltySeconds: state.penaltySeconds,
    speedPenaltySeconds: state.speedPenaltySeconds,
    activeSpeedZone: state.activeSpeedZone,
    status: state.finished ? 'FINISHED' : state.lastEventTime > 0 ? state.lastEvent : 'READ AHEAD',
    callout: state.calloutTime > 0 ? state.callout : '',
    complete: state.finished,
  };
}
