/**
 * Shared, renderer-free catalog for circuit Workshop and custom Trials.
 *
 * Entries in COURSE_FEATURE_CATALOG are production palette entries: each maps
 * to an authored node in the shared GLB kit and to a complete runtime behavior.
 * Keeping this data renderer-free lets storage, validation, browser tooling,
 * and both mode adapters agree without importing Three.js.
 */

export const COURSE_FEATURE_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'jumps', label: 'Jumps', shortLabel: 'JUMPS' }),
  Object.freeze({ id: 'utilities', label: 'Road utilities', shortLabel: 'TOOLS' }),
  Object.freeze({ id: 'hazards', label: 'Surfaces & hazards', shortLabel: 'HAZARDS' }),
  Object.freeze({ id: 'destructibles', label: 'Destructibles', shortLabel: 'SMASH' }),
  Object.freeze({ id: 'scenery', label: 'Scenery', shortLabel: 'DRESS' }),
  Object.freeze({ id: 'challenges', label: 'Kaki challenges', shortLabel: 'CHALLENGE' }),
]);

export const COURSE_FEATURE_THUMBNAIL_ATLAS =
  'assets/racing/workshop/kaki-course-feature-thumbnails-v1.webp';

const MODE_CIRCUIT = Object.freeze(['circuit']);
const MODE_SHARED = Object.freeze(['circuit', 'trials']);

const DEFAULT_LOD = Object.freeze({
  highDistance: 54,
  mediumDistance: 108,
  cullDistance: 220,
  lowQualityDensity: 0.62,
});

const DEFAULT_ADJUSTMENTS = Object.freeze({
  rotationOffset: Object.freeze({ min: -Math.PI, max: Math.PI, step: Math.PI / 12 }),
  lateralOffset: Object.freeze({ min: -20, max: 20, step: 0.25 }),
  scale: Object.freeze({ min: 0.75, max: 1.35, step: 0.05, uniform: true }),
  flip: true,
});

function entry({
  id,
  label,
  category,
  node,
  modes = MODE_SHARED,
  footprint = [4, 4],
  anchors = ['spline', 'trials'],
  rules = {},
  collision = { kind: 'none' },
  surface = null,
  ai = { behavior: 'ignore' },
  gameplay = null,
  score = null,
  adjustable = DEFAULT_ADJUSTMENTS,
  themeVariants = true,
  frame,
}) {
  return Object.freeze({
    id,
    label,
    category,
    compatibleModes: modes,
    assetId: 'courseWorkshopKit',
    assetNode: node,
    previewAsset: COURSE_FEATURE_THUMBNAIL_ATLAS,
    previewFrame: frame,
    footprint: Object.freeze({
      width: footprint[0],
      length: footprint[1],
      clearanceHeight: footprint[2] || 3,
    }),
    allowedAnchors: Object.freeze([...anchors]),
    placementRules: Object.freeze({
      startClearance: 22,
      checkpointClearance: 10,
      respawnClearance: 12,
      bridgePolicy: 'clear',
      requireRoad: category !== 'scenery',
      maxRoadCoverage: category === 'hazards'
        ? 0.92
        : ['jumps', 'utilities', 'challenges'].includes(category) ? 1.05 : 0.78,
      ...rules,
    }),
    adjustableProperties: adjustable,
    collisionProfile: Object.freeze({ ...collision }),
    surfaceProfile: surface ? Object.freeze({ ...surface }) : null,
    aiBehavior: Object.freeze({ ...ai }),
    gameplayEffect: gameplay ? Object.freeze({ ...gameplay }) : null,
    scoreEffect: score ? Object.freeze({ ...score }) : null,
    lodProfile: DEFAULT_LOD,
    themeVariants,
    productionReady: true,
  });
}

const catalog = [
  // Jumps: all seven profiles participate in the circuit/trials ground query.
  entry({ id: 'small-kicker', label: 'Small Kicker', category: 'jumps', node: 'feature_small_kicker', footprint: [7.4, 7.2, 2.8], surface: { kind: 'kicker', height: 1.35, takeoffSlope: 0.34 }, collision: { kind: 'surface' }, ai: { behavior: 'jump', minimumSpeed: 10, targetSpeed: 15.5 }, frame: 0 }),
  entry({ id: 'large-launch-ramp', label: 'Large Launch Ramp', category: 'jumps', node: 'feature_large_launch', footprint: [8.4, 11.8, 4.6], surface: { kind: 'launch', height: 2.85, takeoffSlope: 0.48 }, collision: { kind: 'surface' }, ai: { behavior: 'jump', minimumSpeed: 14, targetSpeed: 19.5 }, frame: 1 }),
  entry({ id: 'tabletop', label: 'Tabletop', category: 'jumps', node: 'feature_tabletop', footprint: [8.4, 18, 4], surface: { kind: 'tabletop', height: 2.15, takeoffSlope: 0.34, plateau: 0.34 }, collision: { kind: 'surface' }, ai: { behavior: 'jump', minimumSpeed: 11, targetSpeed: 17 }, frame: 2 }),
  entry({ id: 'double-jump', label: 'Double Jump', category: 'jumps', node: 'feature_double_jump', footprint: [8.2, 20, 4.6], surface: { kind: 'double', height: 2.35, takeoffSlope: 0.42, gap: 5.2 }, collision: { kind: 'surface' }, ai: { behavior: 'jump', minimumSpeed: 15, targetSpeed: 20 }, frame: 3 }),
  entry({ id: 'roller-bumps', label: 'Roller Bumps', category: 'jumps', node: 'feature_rollers', footprint: [8, 16, 2.5], surface: { kind: 'rollers', height: 0.72, count: 4 }, collision: { kind: 'surface' }, ai: { behavior: 'terrain', targetSpeed: 13.5 }, frame: 4 }),
  entry({ id: 'step-up', label: 'Step-Up', category: 'jumps', node: 'feature_step_up', footprint: [8.2, 15, 4], surface: { kind: 'step-up', height: 2.15, takeoffSlope: 0.37 }, collision: { kind: 'surface' }, ai: { behavior: 'jump', minimumSpeed: 12, targetSpeed: 17 }, frame: 5 }),
  entry({ id: 'step-down', label: 'Step-Down', category: 'jumps', node: 'feature_step_down', footprint: [8.2, 15, 4], surface: { kind: 'step-down', height: 2.1, takeoffSlope: 0.3 }, collision: { kind: 'surface' }, ai: { behavior: 'jump', minimumSpeed: 10, targetSpeed: 16 }, frame: 6 }),

  // Utilities and Kaki challenge gates.
  entry({ id: 'boost-pad', label: 'Boost Pad', category: 'utilities', node: 'feature_boost_pad', modes: MODE_CIRCUIT, footprint: [7.4, 4.4, 1], collision: { kind: 'trigger' }, gameplay: { kind: 'boost', amount: 2 }, ai: { behavior: 'prefer' }, frame: 7 }),
  entry({ id: 'repair-bay', label: 'Repair Bay', category: 'utilities', node: 'feature_repair_bay', modes: MODE_CIRCUIT, footprint: [6.8, 9.5, 3.6], rules: { allowShoulder: true, maxRoadCoverage: 0.42 }, collision: { kind: 'trigger' }, gameplay: { kind: 'repair', rate: 27 }, ai: { behavior: 'ignore' }, frame: 8 }),
  entry({ id: 'checkpoint-gate', label: 'Checkpoint Gate', category: 'utilities', node: 'feature_checkpoint_gate', footprint: [13, 3, 5.5], rules: { checkpointClearance: 0 }, collision: { kind: 'trigger' }, gameplay: { kind: 'checkpoint' }, ai: { behavior: 'center' }, frame: 9 }),
  entry({ id: 'speed-trap', label: 'Speed Trap', category: 'challenges', node: 'feature_speed_trap', footprint: [12, 3, 5.4], collision: { kind: 'trigger' }, gameplay: { kind: 'speed-trap' }, score: { kind: 'speed', multiplier: 45 }, ai: { behavior: 'center' }, frame: 10 }),
  entry({ id: 'drift-zone', label: 'Drift Zone', category: 'challenges', node: 'feature_drift_zone', modes: MODE_CIRCUIT, footprint: [8.5, 18, 1], collision: { kind: 'trigger' }, gameplay: { kind: 'drift-zone' }, score: { kind: 'drift', multiplier: 1.25 }, ai: { behavior: 'line' }, frame: 11 }),
  entry({ id: 'jump-distance-gate', label: 'Jump Distance Gate', category: 'challenges', node: 'feature_jump_gate', footprint: [13, 3, 6], collision: { kind: 'trigger' }, gameplay: { kind: 'jump-distance' }, score: { kind: 'air-distance', multiplier: 32 }, ai: { behavior: 'center' }, frame: 12 }),
  entry({ id: 'crown-jump-ring', label: 'Crown Jump Ring', category: 'challenges', node: 'feature_crown_ring', footprint: [9, 3, 8], rules: { allowAirAnchor: true }, collision: { kind: 'trigger' }, gameplay: { kind: 'jump-ring' }, score: { kind: 'precision-air', points: 750 }, ai: { behavior: 'optional' }, frame: 13 }),
  entry({ id: 'precision-landing', label: 'Precision Landing Zone', category: 'challenges', node: 'feature_landing_zone', footprint: [8, 10, 1], collision: { kind: 'trigger' }, gameplay: { kind: 'landing-zone' }, score: { kind: 'landing', points: 600 }, ai: { behavior: 'center' }, frame: 14 }),
  entry({ id: 'turbo-gate', label: 'Turbo Gate', category: 'challenges', node: 'feature_turbo_gate', footprint: [12, 3, 5.7], collision: { kind: 'trigger' }, gameplay: { kind: 'turbo-refill' }, score: { kind: 'speed', points: 180 }, ai: { behavior: 'center' }, frame: 15 }),
  entry({ id: 'trials-finish-gate', label: 'Finish Gate', category: 'utilities', node: 'feature_checkpoint_gate', modes: Object.freeze(['trials']), anchors: ['trials'], footprint: [13, 3, 5.5], rules: { checkpointClearance: 0, startClearance: 18 }, collision: { kind: 'trigger' }, gameplay: { kind: 'finish' }, ai: { behavior: 'center' }, frame: 9 }),
  entry({ id: 'trials-time-bonus', label: 'Time Bonus', category: 'utilities', node: 'feature_turbo_gate', modes: Object.freeze(['trials']), anchors: ['trials'], footprint: [12, 3, 5.7], collision: { kind: 'trigger' }, gameplay: { kind: 'time-bonus', amount: 4 }, score: { kind: 'time-credit', points: 220 }, ai: { behavior: 'center' }, frame: 15 }),
  entry({ id: 'trials-style-gate', label: 'Style Gate', category: 'challenges', node: 'feature_jump_gate', modes: Object.freeze(['trials']), anchors: ['trials'], footprint: [13, 3, 6], collision: { kind: 'trigger' }, gameplay: { kind: 'style-gate', multiplier: 1.35 }, score: { kind: 'style', points: 260 }, ai: { behavior: 'center' }, frame: 12 }),
  entry({ id: 'trials-destruction-gate', label: 'Destruction Combo Gate', category: 'challenges', node: 'feature_jump_gate', modes: Object.freeze(['trials']), anchors: ['trials'], footprint: [13, 3, 6], collision: { kind: 'trigger' }, gameplay: { kind: 'destruction-combo', multiplier: 1.5 }, score: { kind: 'smash-chain', points: 320 }, ai: { behavior: 'center' }, frame: 12 }),

  // Surface hazards derive visible mesh and driving response from one footprint.
  entry({ id: 'mud-patch', label: 'Mud Patch', category: 'hazards', node: 'feature_mud_patch', footprint: [7.2, 8.5, 0.3], collision: { kind: 'surface' }, surface: { kind: 'material', grip: 0.58, drag: 1.15, surface: 'workshop-mud' }, ai: { behavior: 'avoid', cost: 0.62 }, frame: 16 }),
  entry({ id: 'deep-gravel', label: 'Deep Gravel', category: 'hazards', node: 'feature_gravel', footprint: [7.2, 8.5, 0.35], collision: { kind: 'surface' }, surface: { kind: 'material', grip: 0.66, drag: 0.72, surface: 'workshop-gravel' }, ai: { behavior: 'avoid', cost: 0.44 }, frame: 17 }),
  entry({ id: 'ice-patch', label: 'Ice / Snow Patch', category: 'hazards', node: 'feature_ice', footprint: [7.2, 8.5, 0.25], collision: { kind: 'surface' }, surface: { kind: 'material', grip: 0.24, drag: 0.05, surface: 'workshop-ice' }, ai: { behavior: 'avoid', cost: 0.78 }, frame: 18 }),
  entry({ id: 'oil-slick', label: 'Oil Slick', category: 'hazards', node: 'feature_oil', modes: MODE_CIRCUIT, footprint: [5.5, 6.2, 0.2], collision: { kind: 'surface' }, surface: { kind: 'material', grip: 0.18, drag: 0.02, surface: 'workshop-oil' }, ai: { behavior: 'avoid', cost: 0.9 }, frame: 19 }),
  entry({ id: 'water-splash', label: 'Water Splash', category: 'hazards', node: 'feature_water', footprint: [7.2, 8.5, 0.25], collision: { kind: 'surface' }, surface: { kind: 'material', grip: 0.72, drag: 0.34, surface: 'workshop-water' }, ai: { behavior: 'line', cost: 0.12 }, gameplay: { kind: 'splash-vfx' }, frame: 20 }),
  entry({ id: 'rumble-strip', label: 'Rumble Strip', category: 'hazards', node: 'feature_rumble', footprint: [2.2, 10, 0.25], rules: { allowShoulder: true, maxRoadCoverage: 0.28 }, collision: { kind: 'surface' }, surface: { kind: 'rumble', grip: 0.88, drag: 0.12, surface: 'workshop-rumble' }, ai: { behavior: 'line' }, frame: 21 }),
  entry({ id: 'cone-chicane', label: 'Cone Chicane', category: 'hazards', node: 'feature_cone_chicane', footprint: [7.4, 12, 1.4], collision: { kind: 'soft-obstacles', radius: 0.42, count: 7 }, ai: { behavior: 'slalom', minimumOpenLane: 2.8 }, frame: 22 }),
  entry({ id: 'barrier-chicane', label: 'Barrier Chicane', category: 'hazards', node: 'feature_barrier_chicane', footprint: [7.4, 14, 1.8], collision: { kind: 'obstacles', radius: 1.3, count: 3 }, ai: { behavior: 'slalom', minimumOpenLane: 3.1 }, frame: 23 }),
  entry({ id: 'tire-wall', label: 'Tire Wall', category: 'hazards', node: 'feature_tire_wall', footprint: [6.8, 2.2, 2.1], rules: { allowShoulder: true }, collision: { kind: 'destructible', radius: 2.8, durability: 70 }, ai: { behavior: 'avoid', cost: 1 }, frame: 24 }),

  // Shared smashables. Physics adapters can pool the same authored nodes.
  entry({ id: 'wooden-crates', label: 'Wooden Crates', category: 'destructibles', node: 'feature_crates', footprint: [4.6, 3.8, 3], collision: { kind: 'destructible', radius: 2.2, durability: 32 }, ai: { behavior: 'avoid', cost: 0.8 }, score: { kind: 'smash', points: 90 }, frame: 25 }),
  entry({ id: 'hay-bales', label: 'Hay Bales', category: 'destructibles', node: 'feature_hay_bales', footprint: [5.4, 3.2, 2.4], collision: { kind: 'destructible', radius: 2.5, durability: 24 }, ai: { behavior: 'avoid', cost: 0.55 }, score: { kind: 'smash', points: 70 }, frame: 26 }),
  entry({ id: 'barrel-stack', label: 'Barrel Stack', category: 'destructibles', node: 'feature_barrels', footprint: [4.3, 3.5, 3.4], collision: { kind: 'destructible', radius: 2.1, durability: 38 }, ai: { behavior: 'avoid', cost: 0.75 }, score: { kind: 'smash', points: 110 }, frame: 27 }),
  entry({ id: 'rock-pile', label: 'Rock Pile', category: 'destructibles', node: 'feature_rocks', footprint: [5.3, 4.5, 2.7], collision: { kind: 'obstacles', radius: 2.5 }, ai: { behavior: 'avoid', cost: 1 }, score: { kind: 'smash', points: 130 }, frame: 28 }),
  entry({ id: 'toy-cars', label: 'Toy Cars', category: 'destructibles', node: 'feature_toy_cars', footprint: [5.8, 4.4, 2.3], collision: { kind: 'destructible', radius: 2.6, durability: 44 }, ai: { behavior: 'avoid', cost: 0.82 }, score: { kind: 'smash', points: 140 }, frame: 29 }),
  entry({ id: 'kaki-delivery-cart', label: 'Kaki Delivery Cart', category: 'destructibles', node: 'feature_delivery_cart', footprint: [4.8, 5.5, 3.5], collision: { kind: 'destructible', radius: 2.3, durability: 58 }, ai: { behavior: 'avoid', cost: 0.9 }, score: { kind: 'smash', points: 220 }, frame: 30 }),
  entry({ id: 'ore-cart', label: 'Ore Cart', category: 'destructibles', node: 'feature_delivery_cart', modes: Object.freeze(['trials']), anchors: ['trials'], footprint: [4.8, 5.5, 3.5], collision: { kind: 'destructible', radius: 2.3, durability: 62 }, ai: { behavior: 'avoid', cost: 0.92 }, score: { kind: 'smash', points: 230 }, frame: 30 }),
  entry({ id: 'crown-targets', label: 'Crown Targets', category: 'destructibles', node: 'feature_crown_targets', footprint: [6, 3, 4.2], collision: { kind: 'destructible', radius: 2.8, durability: 28 }, ai: { behavior: 'optional' }, score: { kind: 'smash', points: 300 }, frame: 31 }),
  entry({ id: 'smash-target-chain', label: 'Smash Target Chain', category: 'destructibles', node: 'feature_smash_chain', footprint: [7.2, 14, 3.8], collision: { kind: 'destructible-chain', radius: 1.2, count: 5, durability: 20 }, ai: { behavior: 'optional' }, score: { kind: 'smash-chain', points: 500 }, frame: 32 }),

  // Roadside dressing is shoulder anchored and never blocks the racing lane.
  entry({ id: 'direction-signs', label: 'Direction Signs', category: 'scenery', node: 'feature_direction_signs', footprint: [4.5, 2.5, 3.6], rules: { requireRoad: false, allowShoulder: true, startClearance: 10 }, collision: { kind: 'soft-obstacles' }, ai: { behavior: 'ignore' }, frame: 33 }),
  entry({ id: 'billboard', label: 'Billboard', category: 'scenery', node: 'feature_billboard', modes: MODE_CIRCUIT, footprint: [8.5, 2.5, 6.2], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'scenery' }, ai: { behavior: 'ignore' }, frame: 34 }),
  entry({ id: 'floodlights', label: 'Floodlights', category: 'scenery', node: 'feature_floodlights', footprint: [5, 3, 8.8], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'scenery' }, gameplay: { kind: 'local-light' }, ai: { behavior: 'ignore' }, frame: 35 }),
  entry({ id: 'crowd-section', label: 'Crowd Section', category: 'scenery', node: 'feature_crowd', modes: MODE_CIRCUIT, footprint: [12, 5.5, 4.4], rules: { requireRoad: false, allowShoulder: true, startClearance: 12 }, collision: { kind: 'scenery' }, gameplay: { kind: 'spectator-reaction' }, ai: { behavior: 'ignore' }, frame: 36 }),
  entry({ id: 'grandstand', label: 'Grandstand Module', category: 'scenery', node: 'feature_grandstand', modes: MODE_CIRCUIT, footprint: [15, 8, 8], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'scenery' }, gameplay: { kind: 'spectator-reaction' }, ai: { behavior: 'ignore' }, frame: 37 }),
  entry({ id: 'foliage-group', label: 'Trees / Foliage Group', category: 'scenery', node: 'feature_foliage', footprint: [9, 8, 8], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'scenery' }, ai: { behavior: 'ignore' }, frame: 38 }),
  entry({ id: 'rally-flags', label: 'Flags', category: 'scenery', node: 'feature_flags', footprint: [5, 2, 5.5], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'soft-obstacles' }, gameplay: { kind: 'wind-animation' }, ai: { behavior: 'ignore' }, frame: 39 }),
  entry({ id: 'construction-equipment', label: 'Construction Equipment', category: 'scenery', node: 'feature_construction', footprint: [9, 6, 6], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'scenery' }, ai: { behavior: 'ignore' }, frame: 40 }),
  entry({ id: 'theme-landmark', label: 'Theme Landmark', category: 'scenery', node: 'feature_landmark', modes: MODE_CIRCUIT, footprint: [13, 10, 10], rules: { requireRoad: false, allowShoulder: true }, collision: { kind: 'scenery' }, gameplay: { kind: 'theme-variant' }, ai: { behavior: 'ignore' }, frame: 41 }),
];

export const COURSE_FEATURE_CATALOG = Object.freeze(
  Object.fromEntries(catalog.map((feature) => [feature.id, feature])),
);

export const COURSE_FEATURE_ORDER = Object.freeze(catalog.map((feature) => feature.id));

export function getCourseFeature(id) {
  return COURSE_FEATURE_CATALOG[id] || null;
}

export function listCourseFeatures({
  mode = 'circuit',
  category = null,
  productionOnly = true,
} = {}) {
  return catalog.filter((feature) => (
    (!productionOnly || feature.productionReady)
    && feature.compatibleModes.includes(mode)
    && (!category || feature.category === category)
  ));
}
