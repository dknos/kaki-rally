// Kaki Rally Raid — authored terrain features.
//
// The zone field in raidSurfaceField.js says what KIND of desert this is. It
// cannot say "there is a launch ramp here", because it has no notion of "here":
// it is stationary noise, and noise cannot be aimed. A stage that wants a jump
// at 5.4 km needs a second layer that is a function of a specific place.
//
// A feature is therefore an ADDITIVE RELIEF FIELD anchored to one world point:
//
//     relief(worldX, worldZ) = profile(u, v)   with u, v measured from the
//                                              anchor in the route's frame
//
// and it is exactly zero outside its own radius. That single property is what
// makes it seam-safe by construction, for exactly the same reason the zone
// field is: two neighbouring sectors evaluate the shared boundary from the same
// world metres and the same feature record, so they agree bit for bit. There is
// no sector-local state, no iteration order, and nothing to stitch.
//
// Three consequences worth stating, because they are load-bearing:
//
//  * Features are summed in ARRAY ORDER. A feature outside its radius returns
//    exactly 0 and is skipped, and skipping an exact zero cannot change a
//    float sum, so a caller that pre-filters the list to a sector's bounds gets
//    bit-identical results to a caller that scans the whole list.
//  * Relief is added to BOTH the height and the macro height. `raidRelief`
//    asks "how far is this above its own landform", and a ramp is its own
//    landform — adding to macro as well leaves surface classification reading
//    the surrounding desert instead of calling a 4 m ramp a scoured crest.
//  * A feature also carries a GROOMING PAD, slightly larger than the relief
//    itself, that damps the local noise underneath it and overrides the surface
//    to something firm. Without it a ramp inherits the sand it stands in, and
//    a take-off face made of powder (grip 0.62, sinkage 0.56) is the exact
//    failure the jumps exist to avoid.
//
// Dimensions are not authored by eye. Everything is derived from the ballistics
// of the vehicle model in raidVehiclePhysics.js — see raidJumpFlight below.

import { clamp, mix, smoothstep } from './raidSurfaceField.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Ballistics
// ---------------------------------------------------------------------------

/**
 * Raid gravity, in m/s^2.
 *
 * Roughly twice earth gravity. Rally raid is driven at 100-140 km/h and a real
 * 9.81 would put a 15 degree lip 78 m downrange, which is longer than most
 * authored features and reads as floating. raidVehiclePhysics.js imports this
 * constant rather than declaring its own so the numbers a jump is sized from
 * can never drift away from the numbers the vehicle is flown with.
 */
export const RAID_GRAVITY = 19.6;

/**
 * How much of the ideal ramp-rate vertical velocity the suspension actually
 * delivers at the lip.
 *
 * The vehicle model is 2.5D: `velocityX`/`velocityZ` are horizontal and are NOT
 * reduced by climbing a ramp. Vertical velocity is produced entirely by the
 * suspension spring chasing the rising ground, and the damper (-7.4 * vY)
 * actively fights it the whole way up. So the launch is
 *
 *     vx = v                       (full road speed, unchanged by the climb)
 *     vy = efficiency * v * tan(lipDegrees)
 *
 * rather than the textbook `v * sin(theta)` / `v * cos(theta)` pair.
 *
 * This number is MEASURED, not assumed: tools/smoke-raid-jumps.mjs flies the
 * real `stepRaidVehicle` off a real generated kicker, through the same
 * lattice-snapped sampling the terrain provider gives physics, and asserts the
 * measured efficiency still brackets this value. See docs note in that test.
 */
export const RAID_LAUNCH_EFFICIENCY = 0.67;

/**
 * How much of the flight path angle a landing slope is cut at.
 *
 * A landing must NOT be cut along the flight path. The intuition that it should
 * is wrong here, and wrong in an unstable direction: the steeper the landing
 * falls away, the longer the trajectory takes to catch it, so "match the slope
 * to the flight path where it lands" is a positive feedback loop that runs off
 * to a cliff. Solving it as a fixed point diverges — measured, on the first
 * implementation of this file.
 *
 * So the slope is cut at a fixed fraction of the flight path angle measured
 * where the flight would return to knuckle height over level ground. The
 * remaining fraction is the impact, which is exactly what a landing is for:
 * absorbing most of the descent while leaving enough to feel.
 */
export const RAID_LANDING_MATCH = 0.7;

/** Steepest landing slope worth cutting. Beyond this a landing reads as a hole. */
export const RAID_MAX_LANDING_DEGREES = 26;

/**
 * Deepest a landing slope may sink below the knuckle, in metres.
 *
 * A landing slope has to end somewhere, and every metre it descends is a metre
 * the long runout has to climb back. Without this bound a fast drop asks for a
 * forty-metre trench in the middle of the desert.
 */
export const RAID_MAX_LANDING_SINK = 9;

/**
 * Ballistics of one launch.
 *
 * @param {object}  options
 * @param {number}  options.speedKmh          road speed at the lip
 * @param {number}  options.lipDegrees        take-off face angle
 * @param {number} [options.launchEfficiency] suspension delivery, see above
 * @param {number} [options.gravity]
 * @returns {{speedMs:number, vx:number, vy:number, airTime:number, range:number,
 *            apex:number, launchDegrees:number, impactDegrees:number}}
 *          `range` is the horizontal distance flown before returning to lip
 *          height; `impactDegrees` is the flight path angle there.
 */
export function raidJumpFlight({
  speedKmh = 120,
  lipDegrees = 14,
  launchEfficiency = RAID_LAUNCH_EFFICIENCY,
  gravity = RAID_GRAVITY,
} = {}) {
  const speedMs = Math.max(1e-3, speedKmh / 3.6);
  const vx = speedMs;
  const vy = Math.max(0, launchEfficiency * speedMs * Math.tan(clamp(lipDegrees, 0, 60) * DEG));
  const airTime = (2 * vy) / gravity;
  return Object.freeze({
    speedMs,
    vx,
    vy,
    airTime,
    range: vx * airTime,
    apex: (vy * vy) / (2 * gravity),
    launchDegrees: Math.atan2(vy, vx) * RAD,
    impactDegrees: Math.atan2(vy, vx) * RAD,
  });
}

/**
 * Height of a ballistic flight above the lip, at a horizontal distance from it.
 * Exported because the validator and the smoke test both need to intersect a
 * trajectory with an authored profile.
 */
export function raidFlightHeight(flight, lipHeight, distance) {
  const { vx, vy } = flight;
  return lipHeight + distance * (vy / vx) - (RAID_GRAVITY * distance * distance) / (2 * vx * vx);
}

/**
 * Design a landing for a flight.
 *
 * Given where the far knuckle is and how high it stands, work out how steeply
 * to cut the slope behind it and how long that slope has to be so a run at the
 * design speed touches down partway down it rather than onto its lip or past
 * its bottom.
 *
 * Everything here is a closed-form solve of the parabola against a straight
 * slope. Nothing is iterated, and nothing is guessed.
 *
 * @returns {{degrees:number, tan:number, length:number, touchdownDistance:number,
 *            flatTouchdown:number, sink:number}}
 */
export function raidDesignLanding({
  flight,
  lipHeight = 0,
  knuckleDistance = 0,
  knuckleHeight = 0,
  touchdownFraction = 0.5,
  match = RAID_LANDING_MATCH,
  maxSink = RAID_MAX_LANDING_SINK,
  gravity = RAID_GRAVITY,
}) {
  const { vx, vy } = flight;
  const k = vy / vx;
  const q = gravity / (2 * vx * vx);

  // Where the flight would return to knuckle height over level ground, and how
  // steeply it is descending when it gets there.
  const drop = lipHeight - knuckleHeight;
  const flatTouchdown = (k + Math.sqrt(Math.max(0, k * k + 4 * q * drop))) / (2 * q);
  const flatTan = Math.max(0, 2 * q * flatTouchdown - k);

  const degrees = clamp(Math.atan(flatTan * match) * RAD, 4, RAID_MAX_LANDING_DEGREES);
  const tan = Math.tan(degrees * DEG);

  // Touchdown on that slope: q x^2 - (k + tan) x - (lipHeight - knuckleHeight
  // - knuckleDistance * tan) = 0, taking the far root.
  const b = k + tan;
  const c = -(drop - knuckleDistance * tan);
  const discriminant = Math.max(0, b * b - 4 * q * c);
  const touchdownDistance = Math.max(knuckleDistance + 1, (b + Math.sqrt(discriminant)) / (2 * q));

  // Long enough that the design-speed touchdown falls where it was meant to,
  // but never deeper than the runout can honestly recover.
  const wanted = (touchdownDistance - knuckleDistance) / clamp(touchdownFraction, 0.2, 0.95);
  const length = Math.min(wanted, maxSink / Math.max(tan, 1e-6));
  return { degrees, tan, length, touchdownDistance, flatTouchdown, sink: length * tan };
}

// ---------------------------------------------------------------------------
// Profile primitives
// ---------------------------------------------------------------------------

// A straight take-off face with a filleted toe, in metres.
//
// Two things this has to get right, and the obvious constructions get both
// wrong:
//
//  * The face must have the AUTHORED constant gradient at its top. A smoothstep
//    ramp has zero gradient at its top, so it would launch nothing at all.
//  * The toe must never be STEEPER than the face. Multiplying a linear ramp by
//    a smoothstep looks like a fillet and is not: its gradient peaks at 1.5x
//    the face angle in the middle of the toe, so a 14 degree kicker measured
//    22.7 degrees at its steepest. Found by measuring the generated
//    heightfield, not by reading the code.
//
// So the toe is a parabola whose gradient rises linearly from zero to exactly
// the face gradient, and the face continues from there. Monotone, C1 at the
// join, and never steeper than authored anywhere.
function rampFace(u, toeAt, gradient, fillet) {
  const d = u - toeAt;
  if (d <= 0) return 0;
  if (d < fillet) return (gradient * d * d) / (2 * fillet);
  return gradient * (d - fillet * 0.5);
}

// Smooth 0..1 ramp with zero gradient at both ends.
function easeBetween(a, b, value) {
  return smoothstep(a, b, value);
}

// The landing of every jump type: a straight slope falling away from a knuckle
// at the matched angle, then a long gentle runout back to the base field.
//
// The runout is what lets a landing be a real down-slope while the feature
// still returns to zero. Cutting a 20 m landing at 17 degrees ends 3 m below
// grade; recovering that over 70 m is a 4% rise nobody can feel, and it is the
// only honest way for a purely additive feature to give the player a descent.
function landingTail(feature, distance) {
  if (distance <= 0) return feature.knuckleHeight;
  if (distance < feature.landingLength) {
    return feature.knuckleHeight - distance * feature.landingTan;
  }
  const floor = feature.knuckleHeight - feature.landingLength * feature.landingTan;
  const runout = (distance - feature.landingLength) / feature.runoutLength;
  if (runout >= 1) return 0;
  return floor * (1 - easeBetween(0, 1, runout));
}

/**
 * Centreline profile of a feature, in metres of added relief, at an along-track
 * offset `u` from its anchor. Positive `u` is in the direction of travel.
 *
 * Exported because a trajectory has to be intersected with the real authored
 * geometry rather than with an idealisation of it.
 */
export function raidFeatureProfile(feature, u) {
  if (u <= feature.uMin || u >= feature.uMax) return 0;
  switch (feature.type) {
    case 'kicker': {
      if (u < 0) return rampFace(u, feature.uMin, feature.rampGradient, feature.filletLength);
      if (u < feature.lipLength) return feature.height;
      return feature.height * (1 - easeBetween(0, feature.backLength, u - feature.lipLength));
    }
    case 'tabletop': {
      if (u < 0) return rampFace(u, feature.uMin, feature.rampGradient, feature.filletLength);
      if (u < feature.tableLength) return feature.height;
      return landingTail(feature, u - feature.tableLength);
    }
    case 'gap-jump': {
      if (u < 0) return rampFace(u, feature.uMin, feature.rampGradient, feature.filletLength);
      if (u < feature.backLength) {
        return mix(feature.height, -feature.pitDepth, easeBetween(0, feature.backLength, u));
      }
      const wallStart = feature.gapLength - feature.wallLength;
      if (u < wallStart) return -feature.pitDepth;
      if (u < feature.gapLength) {
        return mix(-feature.pitDepth, feature.knuckleHeight, easeBetween(wallStart, feature.gapLength, u));
      }
      return landingTail(feature, u - feature.gapLength);
    }
    case 'drop': {
      if (u < feature.wallLength) {
        return mix(0, -feature.dropHeight, easeBetween(0, feature.wallLength, u));
      }
      return landingTail(feature, u - feature.wallLength);
    }
    default:
      return 0;
  }
}

// Cross-track envelope of a jump: full height down the middle, tapering to
// exactly zero at the half width. Smoothstep, so the shoulders are C1 and the
// ramp does not read as an extruded slab.
function crossEnvelope(feature, v) {
  const distance = Math.abs(v);
  if (distance >= feature.halfWidth) return 0;
  return easeBetween(feature.halfWidth, feature.halfWidth - feature.edgeFade, distance);
}

// A berm is a banked wall, so its shape lives in the CROSS axis: flush with the
// racing line at the inside, rising to a crest, falling away behind.
function bermCross(feature, v) {
  const outward = v * feature.side;
  if (outward <= feature.bermInner) return 0;
  if (outward >= feature.bermOuter + feature.bermBack) return 0;
  const bank = easeBetween(feature.bermInner, feature.bermOuter, outward);
  const back = easeBetween(feature.bermOuter + feature.bermBack, feature.bermOuter, outward);
  return feature.height * bank * back;
}

// Along-track window for a berm, and for every feature's grooming pad.
function window01(value, low, high, fade) {
  if (value <= low || value >= high) return 0;
  return easeBetween(low, low + fade, value) * easeBetween(high, high - fade, value);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const LOCAL = { u: 0, v: 0 };

function toLocal(feature, worldX, worldZ) {
  const dx = worldX - feature.x;
  const dz = worldZ - feature.z;
  LOCAL.u = dx * feature.forwardX + dz * feature.forwardZ;
  LOCAL.v = dx * feature.rightX + dz * feature.rightZ;
  return LOCAL;
}

/** Added relief of one feature, in metres, at a world position. Exactly 0 outside its radius. */
export function raidFeatureReliefAt(feature, worldX, worldZ) {
  const dx = worldX - feature.x;
  const dz = worldZ - feature.z;
  if (dx * dx + dz * dz > feature.radiusSquared) return 0;
  const local = toLocal(feature, worldX, worldZ);
  if (feature.type === 'berm') {
    const along = window01(local.u, feature.uMin, feature.uMax, feature.alongFade);
    if (along <= 0) return 0;
    return bermCross(feature, local.v) * along;
  }
  const cross = crossEnvelope(feature, local.v);
  if (cross <= 0) return 0;
  return raidFeatureProfile(feature, local.u) * cross;
}

/** Grooming-pad weight of one feature, 0..1. Exactly 0 outside its radius. */
export function raidFeaturePadAt(feature, worldX, worldZ) {
  const dx = worldX - feature.x;
  const dz = worldZ - feature.z;
  if (dx * dx + dz * dz > feature.radiusSquared) return 0;
  const local = toLocal(feature, worldX, worldZ);
  const along = window01(local.u, feature.padMin, feature.padMax, feature.padFade);
  if (along <= 0) return 0;
  const across = easeBetween(feature.padHalfWidth, feature.padHalfWidth - feature.padFade, Math.abs(local.v));
  return along * across;
}

/**
 * Combined effect of a feature list at one world position.
 *
 * `relief` is summed in array order; `pad` takes the strongest feature rather
 * than a sum so it stays inside 0..1 where two features overlap. Both are
 * exactly zero when nothing reaches this point, which is what lets a caller
 * skip the whole feature layer without changing a single bit of the result.
 *
 * @param {number} worldX
 * @param {number} worldZ
 * @param {ReadonlyArray<object>} features resolved features (see resolveRaidFeatures)
 * @param {{relief:number, pad:number, surface:(string|null), looseness:number}} [target]
 */
export function evaluateRaidFeatures(worldX, worldZ, features, target = {
  relief: 0, pad: 0, surface: null, looseness: 0,
}) {
  target.relief = 0;
  target.pad = 0;
  target.surface = null;
  target.looseness = 0;
  if (!features || features.length === 0) return target;
  let bestPad = 0;
  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i];
    const dx = worldX - feature.x;
    const dz = worldZ - feature.z;
    if (dx * dx + dz * dz > feature.radiusSquared) continue;
    target.relief += raidFeatureReliefAt(feature, worldX, worldZ);
    const pad = raidFeaturePadAt(feature, worldX, worldZ);
    if (pad > target.pad) target.pad = pad;
    if (pad > bestPad && feature.surface) {
      bestPad = pad;
      target.surface = feature.surface;
      target.looseness = feature.looseness;
    }
  }
  return target;
}

/**
 * How hard the grooming pad damps the local noise it sits on. 1 would erase the
 * desert under the feature entirely; leaving a sixth of it keeps the ramp part
 * of the landscape instead of a moulding dropped onto it.
 */
export const RAID_FEATURE_PAD_DAMPING = 0.84;

/** Surface a feature pad imposes once it dominates. Discrete, like blendRaidZones. */
export const RAID_FEATURE_PAD_SURFACE_THRESHOLD = 0.5;

/**
 * Fold a feature evaluation into an already-computed zone height.
 *
 * Relief goes into the macro height as well as the height, so `raidRelief` and
 * therefore surface classification see the desert around the feature rather
 * than reading a ramp as a wind-scoured crest.
 *
 * @param {{height:number, macro:number}} state mutated in place
 * @param {{relief:number, pad:number}} evaluated
 */
export function applyRaidFeatures(state, evaluated) {
  if (evaluated.relief === 0 && evaluated.pad === 0) return state;
  const damping = 1 - RAID_FEATURE_PAD_DAMPING * evaluated.pad;
  state.height = state.macro + (state.height - state.macro) * damping + evaluated.relief;
  state.macro += evaluated.relief;
  return state;
}

/**
 * Features whose radius can reach an axis-aligned world box.
 *
 * Filtering preserves array order, and everything it removes contributes
 * exactly 0 relief and 0 pad inside the box, so a sector generated from the
 * filtered list is bit-identical to one generated from the whole list.
 */
export function selectRaidFeaturesNear(features, minX, minZ, maxX, maxZ) {
  if (!features || features.length === 0) return features || EMPTY_FEATURES;
  const selected = [];
  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i];
    const nearX = clamp(feature.x, minX, maxX);
    const nearZ = clamp(feature.z, minZ, maxZ);
    const dx = feature.x - nearX;
    const dz = feature.z - nearZ;
    if (dx * dx + dz * dz <= feature.radiusSquared) selected.push(feature);
  }
  return selected.length === features.length ? features : selected;
}

export const EMPTY_FEATURES = Object.freeze([]);

// ---------------------------------------------------------------------------
// Authoring: route distance in, world anchor out
// ---------------------------------------------------------------------------

function sampleRouteAt(route, meters) {
  const count = route.count;
  const target = clamp(meters, 0, route.meters[count - 1]);
  let low = 0;
  let high = count - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (route.meters[middle] <= target) low = middle;
    else high = middle;
  }
  const span = Math.max(1e-9, route.meters[high] - route.meters[low]);
  const t = clamp((target - route.meters[low]) / span, 0, 1);
  let delta = route.yaw[high] - route.yaw[low];
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return {
    x: mix(route.x[low], route.x[high], t),
    z: mix(route.z[low], route.z[high], t),
    yaw: route.yaw[low] + delta * t,
  };
}

// Feature defaults, all derived from the ballistics rather than chosen by eye.
// The fractions of `range` are the authoring judgement; the range itself is not.
const DESIGN = Object.freeze({
  // Take-off height as a fraction of the flight range, bounded so a slow
  // feature is still a feature and a fast one is not a mountain.
  takeoffHeightOfRange: 0.22,
  takeoffHeightMin: 2.8,
  takeoffHeightMax: 5.6,
  // Where the far knuckle sits, as a fraction of the flight range.
  //
  // This is high on purpose, and the first version of this file had it at 0.58,
  // which was WRONG in a way worth recording. Putting the knuckle far short of
  // where the flight would land means the landing slope starts a long way
  // uphill of the touchdown, so cutting it away only extends the flight into
  // the part where it is steepening fastest — and the "matched" landing ends up
  // hitting HARDER than flat ground would have. Measured: 9.0 m/s into the
  // suspension against 8.0 m/s on the flat. A landing slope only helps when its
  // knuckle is near where the vehicle was going to land anyway.
  gapOfRange: 0.78,
  // Length of the table on a tabletop, for the same reason — but a little
  // shorter, because coming up short here is meant to be survivable.
  tableOfRange: 0.72,
  // Where on the landing slope a design-speed run is meant to touch down. Half
  // way: the front half absorbs a driver who lifted, the back half a driver who
  // arrived faster than the feature was authored for.
  touchdownFraction: 0.5,
  // How far the far knuckle sits BELOW the trajectory as it passes over. This,
  // not a fraction of the take-off height, is what decides the knuckle: a
  // knuckle set by proportion either grazes the flight or disappears under it.
  knuckleClearance: 1.6,
  pitOfTakeoff: 0.32,
  // A drop is a fall, not a launch, so its flight is already steep — steeper
  // than any landing slope worth cutting. Cutting one to "match" it only pushes
  // the touchdown further out into a steeper part of the same parabola and
  // lands harder. So a drop gets a deliberately shallow landing: it is there to
  // let the vehicle carry its speed away, not to flatten an impact it cannot.
  dropLandingMatch: 0.25,
  dropTouchdownFraction: 0.8,
  filletFraction: 0.24,
  width: 34,
  edgeFadeOfWidth: 0.34,
  padMargin: 12,
  padFade: 11,
  lipLength: 2.6,
});

function resolveLanding(feature, flight, knuckleDistance, knuckleHeight, lipHeight, overrideLength, touchdownFraction, match) {
  const design = raidDesignLanding({
    flight, lipHeight, knuckleDistance, knuckleHeight, touchdownFraction, match,
  });
  feature.landingDegrees = design.degrees;
  feature.landingTan = design.tan;
  feature.landingLength = overrideLength || design.length;
  const floor = knuckleHeight - feature.landingLength * feature.landingTan;
  // Recover to grade at no more than 5%: a smoothstep's steepest point is
  // 1.5 * depth / runout, so 30 m of runout per metre of depth.
  feature.runoutLength = floor < 0 ? clamp(30 * -floor, 24, 200) : 18;
  feature.nominalTouchdown = design.touchdownDistance;
  return floor;
}

/**
 * Resolve one authored feature spec against a built route.
 *
 * @param {object} spec   { type, atMeters, ... } — see RAID_FEATURE_TYPES
 * @param {object} route  anything with count/x/z/yaw/meters (the route runtime)
 * @param {number} ordinal index, used only for a default id
 */
export function resolveRaidFeature(spec, route, ordinal = 0) {
  const type = String(spec.type || '');
  const atMeters = Number(spec.atMeters) || 0;
  const anchor = sampleRouteAt(route, atMeters);
  const forwardX = Math.cos(anchor.yaw);
  const forwardZ = Math.sin(anchor.yaw);
  // Right of the direction of travel, matching raidRouteLateral's convention.
  const rightX = Math.sin(anchor.yaw);
  const rightZ = -Math.cos(anchor.yaw);
  const offset = Number(spec.offset) || 0;

  const designSpeedKmh = Number(spec.designSpeedKmh) || 120;
  // Only a sanity clamp, wide on purpose. Narrowing it to the drivable band
  // here would silently REPAIR an authoring mistake — a 38 degree lip would
  // quietly become a 24 degree one — and the validator would then have nothing
  // to complain about. Refusing bad authoring is the validator's job.
  const lipDegrees = clamp(Number(spec.lipDegrees) || 14, 1, 60);
  const flight = raidJumpFlight({ speedKmh: designSpeedKmh, lipDegrees });
  const range = flight.range;

  const width = Number(spec.width) || DESIGN.width;
  const feature = {
    id: String(spec.id || `${type}-${ordinal}`),
    type,
    atMeters,
    offset,
    x: anchor.x + rightX * offset,
    z: anchor.z + rightZ * offset,
    yaw: anchor.yaw,
    forwardX,
    forwardZ,
    rightX,
    rightZ,
    designSpeedKmh,
    lipDegrees,
    designRange: range,
    halfWidth: width * 0.5,
    edgeFade: width * 0.5 * DESIGN.edgeFadeOfWidth,
    filletFraction: DESIGN.filletFraction,
    filletLength: 0,
    rampGradient: 0,
    height: 0,
    rampLength: 0,
    lipLength: 0,
    backLength: 0,
    tableLength: 0,
    gapLength: 0,
    pitDepth: 0,
    wallLength: 0,
    knuckleHeight: 0,
    dropHeight: 0,
    landingLength: 0,
    landingDegrees: 0,
    landingTan: 0,
    runoutLength: 0,
    nominalTouchdown: 0,
    side: spec.side === 'left' ? -1 : 1,
    bermInner: 0,
    bermOuter: 0,
    bermBack: 0,
    alongFade: 0,
    uMin: 0,
    uMax: 0,
    padMin: 0,
    padMax: 0,
    padHalfWidth: 0,
    padFade: DESIGN.padFade,
    radius: 0,
    radiusSquared: 0,
    surface: spec.surface === null ? null : (spec.surface || 'hardpack'),
    looseness: Number.isFinite(spec.looseness) ? spec.looseness : 0.12,
  };

  const takeoffHeight = Number(spec.height)
    || clamp(range * DESIGN.takeoffHeightOfRange, DESIGN.takeoffHeightMin, DESIGN.takeoffHeightMax);
  // The face runs at exactly tan(lip); the toe adds half its own length to the
  // ramp so the top still arrives at the authored height.
  const faceGradient = Math.tan(lipDegrees * DEG);
  const faceLength = takeoffHeight / faceGradient;
  const filletLength = faceLength * DESIGN.filletFraction;
  feature.rampGradient = faceGradient;
  feature.filletLength = filletLength;
  const rampLength = faceLength + filletLength * 0.5;

  switch (type) {
    case 'kicker': {
      feature.height = takeoffHeight;
      feature.rampLength = rampLength;
      feature.lipLength = DESIGN.lipLength;
      feature.backLength = Math.max(3, takeoffHeight * 1.15);
      feature.uMin = -feature.rampLength;
      feature.uMax = feature.lipLength + feature.backLength;
      break;
    }
    case 'tabletop': {
      feature.height = takeoffHeight;
      feature.rampLength = rampLength;
      feature.tableLength = Number(spec.tableLength) || range * DESIGN.tableOfRange;
      feature.knuckleHeight = takeoffHeight;
      resolveLanding(
        feature, flight, feature.tableLength, feature.knuckleHeight, takeoffHeight,
        Number(spec.landingLength) || 0, DESIGN.touchdownFraction,
      );
      feature.uMin = -feature.rampLength;
      feature.uMax = feature.tableLength + feature.landingLength + feature.runoutLength;
      break;
    }
    case 'gap-jump': {
      feature.height = takeoffHeight;
      feature.rampLength = rampLength;
      feature.pitDepth = takeoffHeight * DESIGN.pitOfTakeoff;
      feature.gapLength = Number(spec.gapLength) || range * DESIGN.gapOfRange;
      feature.backLength = (takeoffHeight + feature.pitDepth) * 0.85;
      // The knuckle is set by the TRAJECTORY, not by a proportion of the ramp:
      // it stands a fixed clearance below where the flight actually passes, so
      // a committed run always crosses it with room and a lifted one does not.
      const overhead = raidFlightHeight(flight, takeoffHeight, feature.gapLength);
      feature.knuckleHeight = clamp(
        overhead - DESIGN.knuckleClearance, takeoffHeight * 0.45, takeoffHeight * 1.05,
      );
      feature.wallLength = (feature.pitDepth + feature.knuckleHeight) * 0.5;
      // The pit has to have a floor: if the two faces meet, the "gap" is a
      // notch and the jump is not a jump.
      const minimumGap = (feature.backLength + feature.wallLength) * 1.25;
      feature.gapLength = Math.max(feature.gapLength, minimumGap);
      resolveLanding(
        feature, flight, feature.gapLength, feature.knuckleHeight, takeoffHeight,
        Number(spec.landingLength) || 0, DESIGN.touchdownFraction,
      );
      feature.uMin = -feature.rampLength;
      feature.uMax = feature.gapLength + feature.landingLength + feature.runoutLength;
      break;
    }
    case 'drop': {
      feature.dropHeight = Number(spec.dropHeight) || Number(spec.height) || 6;
      feature.wallLength = Math.max(2.5, feature.dropHeight * 0.55);
      feature.knuckleHeight = -feature.dropHeight;
      // Rolling off an edge launches nothing upward, so the flight that has to
      // be caught is a pure fall at road speed.
      const fallFlight = raidJumpFlight({ speedKmh: designSpeedKmh, lipDegrees: 0 });
      // A fall lands steeply and travels a long way doing it, so a drop takes
      // the touchdown deeper into its slope than a jump does: the alternative
      // is a trench the runout cannot climb back out of.
      resolveLanding(
        feature, fallFlight, feature.wallLength, feature.knuckleHeight, 0,
        Number(spec.landingLength) || 0, DESIGN.dropTouchdownFraction, DESIGN.dropLandingMatch,
      );
      feature.uMin = 0;
      feature.uMax = feature.wallLength + feature.landingLength + feature.runoutLength;
      break;
    }
    case 'berm': {
      feature.height = Number(spec.height) || 3;
      const length = Number(spec.length) || 70;
      feature.bermInner = Number(spec.inner) || feature.halfWidth * 0.45;
      feature.bermOuter = Number(spec.outer) || feature.halfWidth;
      feature.bermBack = Number(spec.back) || Math.max(3, feature.height * 1.6);
      feature.alongFade = Math.min(length * 0.45, 18);
      feature.uMin = -length * 0.5;
      feature.uMax = length * 0.5;
      break;
    }
    default:
      throw new Error(`unknown raid feature type: ${type}`);
  }

  feature.padMin = feature.uMin - DESIGN.padMargin;
  feature.padMax = feature.uMax + DESIGN.padMargin;
  feature.padHalfWidth = (type === 'berm'
    ? feature.bermOuter + feature.bermBack
    : feature.halfWidth) + DESIGN.padMargin;
  const reachU = Math.max(Math.abs(feature.padMin), Math.abs(feature.padMax));
  feature.radius = Math.hypot(reachU, feature.padHalfWidth);
  feature.radiusSquared = feature.radius * feature.radius;
  return Object.freeze(feature);
}

/**
 * Resolve every authored feature on a stage.
 *
 * @param {ReadonlyArray<object>|null} specs blueprint `features` array
 * @param {object} route built route runtime
 * @returns {ReadonlyArray<object>} frozen, structured-cloneable feature records
 */
export function resolveRaidFeatures(specs, route) {
  if (!specs || specs.length === 0) return EMPTY_FEATURES;
  const sorted = [...specs].sort((a, b) => (Number(a.atMeters) || 0) - (Number(b.atMeters) || 0));
  return Object.freeze(sorted.map((spec, ordinal) => resolveRaidFeature(spec, route, ordinal)));
}

// ---------------------------------------------------------------------------
// Analysis: does this actually work?
// ---------------------------------------------------------------------------

/**
 * Fly a feature at a speed and report where the trajectory meets the ground.
 *
 * This intersects the parabola with the FEATURE'S OWN authored centreline
 * profile, marched at 10 cm, rather than with an idealised flat plane — so what
 * comes back is where the vehicle actually lands on the thing that was built,
 * including landing on the table of a tabletop or into the wall of a gap jump.
 *
 * @returns {{lipU:number, lipHeight:number, touchdownU:number, touchdownHeight:number,
 *            airborneMetres:number, flight:object, clearsKnuckle:boolean,
 *            knuckleU:number, landingFraction:number, impactDegrees:number,
 *            normalImpactMs:number}}
 *          `landingFraction` is where on the landing slope the touchdown fell:
 *          0 at the knuckle, 1 at the bottom of the matched slope.
 */
export function raidFeatureTouchdown(feature, speedKmh, {
  launchEfficiency = RAID_LAUNCH_EFFICIENCY,
  step = 0.1,
} = {}) {
  const lipDegrees = feature.type === 'drop' ? 0 : feature.lipDegrees;
  const flight = raidJumpFlight({ speedKmh, lipDegrees, launchEfficiency });
  const lipU = feature.type === 'drop' ? 0 : (feature.type === 'kicker' ? feature.lipLength : 0);
  const lipHeight = raidFeatureProfile(feature, Math.max(feature.uMin + 1e-6, lipU - 1e-6));
  const knuckleU = feature.type === 'gap-jump'
    ? feature.gapLength
    : (feature.type === 'tabletop' ? feature.tableLength : feature.wallLength);

  // March forward until the parabola meets the authored ground. The vehicle is
  // a body, not a point, so touchdown is taken at wheel contact height.
  let touchdownU = lipU;
  let touchdownHeight = lipHeight;
  const limit = feature.uMax + 160;
  for (let u = lipU + step; u <= limit; u += step) {
    const air = raidFlightHeight(flight, lipHeight, u - lipU);
    const ground = raidFeatureProfile(feature, u);
    touchdownU = u;
    touchdownHeight = ground;
    if (air <= ground) break;
  }
  // Cleared means the trajectory was still above the profile at the knuckle.
  const clearsKnuckle = feature.type === 'kicker' ? true : touchdownU > knuckleU;

  const flown = touchdownU - lipU;
  const descentTan = (RAID_GRAVITY * flown) / (flight.vx * flight.vx) - flight.vy / flight.vx;
  const impactDegrees = Math.atan(descentTan) * RAD;
  const slopeDegrees = touchdownU > knuckleU && touchdownU < knuckleU + feature.landingLength
    ? feature.landingDegrees
    : 0;
  const relativeDegrees = impactDegrees - slopeDegrees;
  const impactSpeed = Math.hypot(flight.vx, flight.vx * descentTan);
  // What the SAME flight would put straight into the suspension if the far side
  // were level at the knuckle's height instead of cut away. On a horizontal
  // plane the normal component is just the vertical velocity, so this is the
  // honest "what did the landing slope buy" baseline.
  const k = flight.vy / flight.vx;
  const q = RAID_GRAVITY / (2 * flight.vx * flight.vx);
  const fall = lipHeight - (feature.type === 'kicker' ? 0 : feature.knuckleHeight);
  const flatDistance = (k + Math.sqrt(Math.max(0, k * k + 4 * q * fall))) / (2 * q);
  const flatNormalImpactMs = Math.max(0, flight.vx * (2 * q * flatDistance - k));
  return {
    flatNormalImpactMs,
    flatDistance,
    lipU,
    lipHeight,
    touchdownU,
    touchdownHeight,
    airborneMetres: flown,
    flight,
    clearsKnuckle,
    knuckleU,
    landingFraction: feature.landingLength > 0
      ? (touchdownU - knuckleU) / feature.landingLength
      : 0,
    impactDegrees,
    relativeImpactDegrees: relativeDegrees,
    normalImpactMs: Math.abs(impactSpeed * Math.sin(relativeDegrees * DEG)),
  };
}

/**
 * Steepest gradient on a stretch of a feature's centreline, and where it occurs.
 *
 * The range matters. Asked about a whole gap jump this reports the far wall at
 * seventy degrees, which is not a defect — a wall is exactly what the far side
 * of a gap is meant to be. The drivability question is only ever about the
 * TAKE-OFF face, so the validator asks about `[uMin, 0]`.
 */
export function raidFeatureMaxGradient(feature, step = 0.25, from = feature.uMin, to = feature.uMax) {
  let maxRise = 0;
  let maxFall = 0;
  let atRise = 0;
  for (let u = from; u <= to; u += step) {
    const a = raidFeatureProfile(feature, u);
    const b = raidFeatureProfile(feature, u + step);
    const gradient = (b - a) / step;
    if (gradient > maxRise) {
      maxRise = gradient;
      atRise = u;
    }
    if (gradient < maxFall) maxFall = gradient;
  }
  return {
    riseGradient: maxRise,
    riseDegrees: Math.atan(maxRise) * RAD,
    riseAt: atRise,
    fallGradient: maxFall,
    fallDegrees: Math.atan(-maxFall) * RAD,
  };
}

/** Human-readable dimensions, for authoring notes and test output. */
export function describeRaidFeature(feature) {
  const parts = [`${feature.type} @ ${Math.round(feature.atMeters)} m`];
  if (feature.type === 'berm') {
    parts.push(`${feature.height.toFixed(1)} m bank, ${(feature.uMax - feature.uMin).toFixed(0)} m long, ${feature.side > 0 ? 'right' : 'left'}`);
  } else if (feature.type === 'drop') {
    parts.push(`${feature.dropHeight.toFixed(1)} m drop, ${feature.landingLength.toFixed(0)} m landing at ${feature.landingDegrees.toFixed(1)} deg`);
  } else {
    parts.push(`${feature.height.toFixed(1)} m lip at ${feature.lipDegrees.toFixed(0)} deg`);
    parts.push(`design ${feature.designSpeedKmh} km/h flies ${feature.designRange.toFixed(1)} m`);
    if (feature.gapLength) parts.push(`gap ${feature.gapLength.toFixed(1)} m`);
    if (feature.tableLength) parts.push(`table ${feature.tableLength.toFixed(1)} m`);
    if (feature.landingLength) parts.push(`landing ${feature.landingLength.toFixed(0)} m at ${feature.landingDegrees.toFixed(1)} deg`);
  }
  parts.push(`footprint ${(feature.uMax - feature.uMin).toFixed(0)} m`);
  return parts.join(' · ');
}

export const RAID_FEATURE_TYPES = Object.freeze([
  'kicker', 'tabletop', 'gap-jump', 'drop', 'berm',
]);
