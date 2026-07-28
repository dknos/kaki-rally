import { getCourseFeature } from './courseFeatureCatalog.js';
import {
  resolveCircuitPlacement,
  sanitizeCourseFeaturePlacement,
} from './courseFeaturePlacement.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mod1(value) {
  const wrapped = Number(value) % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function cyclicDistance(a, b) {
  const direct = Math.abs(mod1(a) - mod1(b));
  return Math.min(direct, 1 - direct);
}

function featureLongitudinalRadius(feature, anchor) {
  return feature.footprint.length * (anchor.scaleZ || 1) * 0.5;
}

function featureLateralRadius(feature, anchor) {
  return feature.footprint.width * (anchor.scaleX || 1) * 0.5;
}

function bridgeConflict(placement, feature, overpasses, routeLength) {
  if (feature.placementRules.bridgePolicy === 'allow') return null;
  for (const bridge of overpasses || []) {
    for (const fraction of [bridge.canonicalFraction, bridge.canonicalUnderFraction]) {
      if (!Number.isFinite(fraction)) continue;
      const separation = cyclicDistance(placement.anchor.fraction, fraction) * routeLength;
      const reserve = Number(bridge.approachLength) || 32;
      if (separation < reserve + featureLongitudinalRadius(feature, placement.anchor) + 2) {
        return 'Bridge approach must remain clear';
      }
    }
  }
  return null;
}

function exclusionConflict(placement, feature, fractions, routeLength, label, extra = 0) {
  const radius = featureLongitudinalRadius(feature, placement.anchor)
    + Number(extra || feature.placementRules[`${label}Clearance`] || 0);
  for (const fraction of fractions || []) {
    if (cyclicDistance(placement.anchor.fraction, fraction) * routeLength < radius) {
      return `Too close to ${label === 'start' ? 'start grid' : label}`;
    }
  }
  return null;
}

function overlapConflict(placement, feature, placements, routeLength) {
  for (const other of placements || []) {
    if (!other?.anchor || other.anchor.mode !== 'spline' || other.id === placement.id) continue;
    const otherFeature = getCourseFeature(other.featureId);
    if (!otherFeature) continue;
    const along = cyclicDistance(placement.anchor.fraction, other.anchor.fraction) * routeLength;
    const alongLimit = featureLongitudinalRadius(feature, placement.anchor)
      + featureLongitudinalRadius(otherFeature, other.anchor) + 0.75;
    if (along >= alongLimit) continue;
    const lateral = Math.abs(placement.anchor.lateralOffset - other.anchor.lateralOffset);
    const lateralLimit = featureLateralRadius(feature, placement.anchor)
      + featureLateralRadius(otherFeature, other.anchor) + 0.35;
    if (lateral < lateralLimit) return `Overlaps ${otherFeature.label}`;
  }
  return null;
}

export function predictCircuitJump(feature, {
  speed = null,
  gravity = 23,
  landingPitch = 0,
} = {}) {
  if (!feature?.surfaceProfile || !['kicker', 'launch', 'tabletop', 'double', 'step-up', 'step-down'].includes(feature.surfaceProfile.kind)) {
    return null;
  }
  const minimumSpeed = Number(feature.aiBehavior.minimumSpeed) || 10;
  const launchSpeed = Math.max(minimumSpeed, Number(speed) || Number(feature.aiBehavior.targetSpeed) || minimumSpeed);
  const slope = Math.max(0.08, Number(feature.surfaceProfile.takeoffSlope) || 0.28);
  const angle = Math.atan(slope);
  const vx = launchSpeed * Math.cos(angle);
  const vy = launchSpeed * Math.sin(angle) + 0.85;
  const flightTime = Math.max(0.08, 2 * vy / Math.max(1, gravity));
  const range = vx * flightTime;
  const landingAngle = Math.atan2(vy - gravity * flightTime, vx);
  const safety = clamp(1 - Math.abs(landingAngle - Number(landingPitch || 0)) / 0.72, 0, 1);
  return {
    minimumSpeed,
    launchSpeed,
    range,
    flightTime,
    landingAngle,
    landingSafety: safety,
    safe: safety >= 0.3 && range >= feature.footprint.length * 0.42,
    points: Array.from({ length: 17 }, (_, index) => {
      const time = flightTime * index / 16;
      return {
        distance: vx * time,
        height: vy * time - 0.5 * gravity * time * time,
      };
    }),
  };
}

export function validateCircuitFeaturePlacement(input, {
  samples = [],
  routeLength = 0,
  trackWidth = 9.2,
  startFraction = 0,
  reverse = false,
  overpasses = [],
  placements = [],
  checkpointFractions = [],
  respawnFractions = [],
  buildBounds = null,
} = {}) {
  const sanitized = sanitizeCourseFeaturePlacement(input, { mode: 'spline' });
  if (!sanitized.placement) {
    return { valid: false, warning: false, message: sanitized.warning, placement: null, world: null };
  }
  const placement = sanitized.placement;
  const feature = getCourseFeature(placement.featureId);
  const world = resolveCircuitPlacement(placement, samples, { startFraction, reverse });
  if (!world) return { valid: false, warning: false, message: 'Outside build area', placement, world: null };
  const messages = [];
  const halfRoad = trackWidth * 0.5;
  const halfFeature = featureLateralRadius(feature, placement.anchor);
  const laneCoverage = Math.max(0, halfFeature * 2 - Math.max(0, Math.abs(placement.anchor.lateralOffset) - halfRoad)) / Math.max(0.1, trackWidth);
  if (feature.placementRules.requireRoad && Math.abs(placement.anchor.lateralOffset) > halfRoad + halfFeature * 0.45) {
    messages.push('Outside build area');
  }
  if (!feature.placementRules.allowShoulder && laneCoverage > feature.placementRules.maxRoadCoverage) {
    messages.push('Blocks every AI lane');
  }
  if (
    feature.category === 'jumps'
    && trackWidth < feature.footprint.width * (placement.anchor.scaleX || 1) * 0.86
  ) messages.push('Road too narrow');
  const startConflict = exclusionConflict(
    placement,
    feature,
    [startFraction],
    routeLength,
    'start',
    feature.placementRules.startClearance,
  );
  if (startConflict) messages.push(startConflict);
  const checkpointConflict = exclusionConflict(
    placement,
    feature,
    checkpointFractions,
    routeLength,
    'checkpoint',
  );
  if (checkpointConflict) messages.push(checkpointConflict);
  const respawnConflict = exclusionConflict(
    placement,
    feature,
    respawnFractions,
    routeLength,
    'respawn',
  );
  if (respawnConflict) messages.push(respawnConflict);
  const bridgeMessage = bridgeConflict(placement, feature, overpasses, routeLength);
  if (bridgeMessage) messages.push(bridgeMessage);
  const overlapMessage = overlapConflict(placement, feature, placements, routeLength);
  if (overlapMessage) messages.push(overlapMessage);
  if (buildBounds && (
    world.x < buildBounds.minX
    || world.x > buildBounds.maxX
    || world.z < buildBounds.minZ
    || world.z > buildBounds.maxZ
  )) messages.push('Outside build area');
  const trajectory = predictCircuitJump(feature);
  if (feature.category === 'jumps' && (!trajectory || !trajectory.safe)) messages.push('No safe landing zone');
  const uniqueMessages = [...new Set(messages)];
  const hard = uniqueMessages.filter((message) => message !== 'Blocks every AI lane');
  return {
    valid: hard.length === 0,
    warning: hard.length === 0 && uniqueMessages.length > 0,
    message: uniqueMessages[0] || 'Valid placement',
    messages: uniqueMessages,
    placement,
    feature,
    world,
    laneCoverage: clamp(laneCoverage, 0, 1.5),
    trajectory,
  };
}
