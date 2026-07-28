import { getCourseFeature } from './courseFeatureCatalog.js';
import { createCourseFeaturePlacementId } from './courseFeaturePlacement.js';
import { getTrialsProfile } from './trialsPhysics.js';
import { sampleTrialsGround } from './trialsTracks.js';
import { sanitizeTrialsCourse } from './trialsWorkshopStorage.js';

export const TRIALS_TERRAIN_TOOLS = Object.freeze([
  Object.freeze({ id: 'gentle-hill', label: 'Gentle Hill', width: 72, height: 5.2 }),
  Object.freeze({ id: 'steep-climb', label: 'Steep Climb', width: 58, height: 10 }),
  Object.freeze({ id: 'kicker', label: 'Kicker', width: 7.2, height: 1.35, featureId: 'small-kicker' }),
  Object.freeze({ id: 'large-launch-ramp', label: 'Large Launch Ramp', width: 11.8, height: 2.85, featureId: 'large-launch-ramp' }),
  Object.freeze({ id: 'tabletop', label: 'Tabletop', width: 18, height: 2.15, featureId: 'tabletop' }),
  Object.freeze({ id: 'double-jump', label: 'Double Jump', width: 20, height: 2.35, featureId: 'double-jump' }),
  Object.freeze({ id: 'step-up', label: 'Step-Up', width: 15, height: 2.15, featureId: 'step-up' }),
  Object.freeze({ id: 'step-down', label: 'Step-Down', width: 15, height: 2.1, featureId: 'step-down' }),
  Object.freeze({ id: 'landing-downslope', label: 'Landing Downslope', width: 54, height: 7 }),
  Object.freeze({ id: 'roller-section', label: 'Roller Section', width: 68, height: 2.6 }),
  Object.freeze({ id: 'gap', label: 'Gap / Chasm', width: 24, height: 0 }),
  Object.freeze({ id: 'smooth', label: 'Smooth / Relax', width: 58, height: 0 }),
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function baseProfile(course, spacing = 10) {
  const points = [];
  for (let x = 0; x <= course.length + 0.001; x += spacing) {
    const ground = sampleTrialsGround({ ...course, featurePlacements: [], gaps: [] }, Math.min(x, course.length));
    points.push({ x: Math.min(x, course.length), y: ground?.height ?? 5 });
  }
  if (points.at(-1).x < course.length) {
    const ground = sampleTrialsGround({ ...course, featurePlacements: [], gaps: [] }, course.length);
    points.push({ x: course.length, y: ground?.height ?? 5 });
  }
  points[0].slope = 0;
  points.at(-1).slope = 0;
  return points;
}

export function applyTrialsTerrainStamp(input, {
  kind,
  x,
  width = null,
  strength = 1,
} = {}) {
  const { course } = sanitizeTrialsCourse(input);
  const tool = TRIALS_TERRAIN_TOOLS.find((entry) => entry.id === kind);
  if (!tool) return { course, changed: false, message: 'Unknown terrain tool.' };
  const center = clamp(Number(x) || 0, 12, course.length - 12);
  const brushWidth = tool.featureId
    ? clamp(Number(width) || tool.width, tool.width * 0.75, tool.width * 1.35)
    : clamp(Number(width) || tool.width, 12, 150);
  if (tool.featureId) {
    const validation = validateTrialsFeaturePlacement(course, {
      featureId: tool.featureId,
      x: center,
      scale: clamp(brushWidth / tool.width, 0.75, 1.35),
    });
    if (!validation.valid) {
      return { course, changed: false, message: validation.message };
    }
    const ordinal = course.featurePlacements.length;
    const placement = {
      id: createCourseFeaturePlacementId(tool.featureId, course.seed, ordinal),
      featureId: tool.featureId,
      source: 'manual',
      createdAt: 0,
      properties: {},
      anchor: {
        mode: 'trials',
        x: center,
        groundOffset: 0,
        facing: 1,
        scaleX: validation.scale,
        scaleY: validation.scale,
      },
    };
    const result = sanitizeTrialsCourse({
      ...course,
      featurePlacements: [...course.featurePlacements, placement],
    });
    return {
      ...result,
      changed: true,
      message: `${tool.label} stamped into the authoritative terrain profile.`,
    };
  }
  if (kind === 'gap') {
    const gap = {
      start: clamp(center - brushWidth * 0.5, 12, course.length - 14),
      end: clamp(center + brushWidth * 0.5, 14, course.length - 10),
      label: `Workshop Chasm ${course.gaps.length + 1}`,
    };
    return sanitizeTrialsCourse({
      ...course,
      gaps: [...course.gaps, gap],
    });
  }
  const points = baseProfile(course, clamp(brushWidth / 8, 5, 13));
  const amplitude = tool.height * clamp(Number(strength) || 1, 0.25, 1.8);
  for (const point of points) {
    const local = (point.x - center) / (brushWidth * 0.5);
    if (Math.abs(local) > 1) continue;
    const envelope = 0.5 + 0.5 * Math.cos(local * Math.PI);
    if (kind === 'gentle-hill') {
      point.y += amplitude * envelope;
    } else if (kind === 'steep-climb') {
      const ramp = smoothstep((local + 1) * 0.5);
      point.y += amplitude * ramp * envelope ** 0.28;
    } else if (kind === 'landing-downslope') {
      const downslope = 1 - smoothstep((local + 1) * 0.5);
      point.y += amplitude * downslope * envelope ** 0.25;
    } else if (kind === 'roller-section') {
      point.y += amplitude * Math.sin((local + 1) * Math.PI * 4) * envelope;
    }
  }
  if (kind === 'smooth') {
    for (let pass = 0; pass < 3; pass++) {
      const source = points.map((point) => ({ ...point }));
      for (let index = 1; index < points.length - 1; index++) {
        const distance = Math.abs(points[index].x - center);
        if (distance > brushWidth * 0.5) continue;
        const influence = (0.5 + 0.5 * Math.cos(distance / (brushWidth * 0.5) * Math.PI)) * 0.44;
        points[index].y = source[index].y * (1 - influence)
          + (source[index - 1].y + source[index + 1].y) * 0.5 * influence;
      }
    }
  }
  const result = sanitizeTrialsCourse({
    ...course,
    heightPoints: points,
  });
  return {
    ...result,
    changed: true,
    message: `${tool.label} applied.`,
  };
}

export function moveTrialsControlPoint(input, index, x, y) {
  const { course } = sanitizeTrialsCourse(input);
  const points = course.heightPoints.map((point) => ({ ...point }));
  const safeIndex = clamp(Math.trunc(index), 0, points.length - 1);
  const previousX = safeIndex > 0 ? points[safeIndex - 1].x + 2.5 : 0;
  const nextX = safeIndex < points.length - 1 ? points[safeIndex + 1].x - 2.5 : course.length;
  points[safeIndex].x = safeIndex === 0 ? 0
    : safeIndex === points.length - 1 ? course.length : clamp(Number(x) || 0, previousX, nextX);
  points[safeIndex].y = clamp(Number(y) || 0, 0, 92);
  delete points[safeIndex].slope;
  return sanitizeTrialsCourse({ ...course, heightPoints: points });
}

export function validateTrialsFeaturePlacement(input, {
  featureId,
  x,
  scale = 1,
  ignorePlacementId = '',
} = {}) {
  const { course } = sanitizeTrialsCourse(input);
  const feature = getCourseFeature(featureId);
  if (!feature || !feature.compatibleModes.includes('trials')) {
    return { valid: false, status: 'invalid', message: 'This stamp is unavailable in Trials.' };
  }
  const safeScale = clamp(Number(scale) || 1, 0.75, 1.35);
  const center = Number(x);
  if (!Number.isFinite(center)) {
    return { valid: false, status: 'invalid', message: 'Choose a position on the course.' };
  }
  const halfLength = Math.max(0.5, feature.footprint.length * safeScale * 0.5);
  const startX = center - halfLength;
  const endX = center + halfLength;
  if (startX < 2 || endX > course.length - 2) {
    return { valid: false, status: 'invalid', message: 'Outside build area.', startX, endX };
  }
  const startClearance = Math.max(12, Number(feature.placementRules?.startClearance) || 0);
  if (startX < course.spawn.x + startClearance) {
    return { valid: false, status: 'invalid', message: 'Too close to the start grid.', startX, endX };
  }
  if (featureId === 'trials-finish-gate') {
    if (center < course.spawn.x + 60) {
      return { valid: false, status: 'invalid', message: 'Finish must leave a meaningful run.', startX, endX };
    }
  } else if (Math.abs(center - course.finish) < Math.max(10, halfLength + 3)) {
    return { valid: false, status: 'invalid', message: 'Finish approach must remain clear.', startX, endX };
  }
  const gap = course.gaps.find((entry) => startX < entry.end && endX > entry.start);
  if (gap) {
    return {
      valid: false,
      status: 'invalid',
      message: `${feature.label} overlaps ${gap.label}; place ramps before the visible lip.`,
      startX,
      endX,
    };
  }
  const ground = sampleTrialsGround(course, center);
  if (!ground) {
    return { valid: false, status: 'invalid', message: 'No terrain under this stamp.', startX, endX };
  }
  const overlap = course.featurePlacements
    .filter((placement) => placement.id !== ignorePlacementId)
    .map((placement) => ({
      placement,
      feature: getCourseFeature(placement.featureId),
    }))
    .find(({ placement, feature: other }) => {
      if (!other) return false;
      const otherHalf = other.footprint.length * (placement.anchor.scaleX || 1) * 0.5;
      return startX < placement.anchor.x + otherHalf + 1.5
        && endX > placement.anchor.x - otherHalf - 1.5;
    });
  if (overlap) {
    return {
      valid: false,
      status: 'invalid',
      message: `Overlaps ${overlap.feature.label}.`,
      startX,
      endX,
      conflictId: overlap.placement.id,
    };
  }
  const nearestCheckpoint = course.checkpoints.find((checkpoint) => (
    Math.abs(checkpoint.x - center) < Math.max(8, halfLength + 3)
  ));
  if (nearestCheckpoint && featureId !== 'checkpoint-gate') {
    return {
      valid: false,
      status: 'invalid',
      message: 'Checkpoint restart zone must remain clear.',
      startX,
      endX,
    };
  }
  const placement = {
    id: createCourseFeaturePlacementId(featureId, course.seed, course.featurePlacements.length),
    featureId,
    anchor: {
      mode: 'trials',
      x: center,
      groundOffset: 0,
      facing: 1,
      rotationOffset: 0,
      scaleX: safeScale,
      scaleY: safeScale,
    },
  };
  return {
    valid: true,
    status: feature.category === 'jumps' ? 'warning' : 'valid',
    message: feature.category === 'jumps'
      ? 'Valid stamp; inspect both vehicle trajectories before saving.'
      : 'Valid placement.',
    startX,
    endX,
    ground,
    placement,
  };
}

function projectileAt(speed, takeoff, landingX, profile) {
  const angle = takeoff.angle;
  const vx = Math.max(0.1, speed * Math.cos(angle));
  const vy = speed * Math.sin(angle);
  const time = Math.max(0, (landingX - takeoff.x) / vx);
  return {
    time,
    x: landingX,
    y: takeoff.y + vy * time - 0.5 * profile.gravity * time * time,
    vx,
    vy: vy - profile.gravity * time,
  };
}

function requiredSpeedForJump(takeoff, landing, profile) {
  const safeAt = (speed) => {
    const flight = projectileAt(speed, takeoff, landing.x, profile);
    return flight.y >= landing.y - profile.rideHeight * 0.42;
  };
  if (!safeAt(profile.turboMaxSpeed * 1.04)) return Infinity;
  let low = 1;
  let high = profile.turboMaxSpeed * 1.04;
  for (let pass = 0; pass < 32; pass++) {
    const middle = (low + high) * 0.5;
    if (safeAt(middle)) high = middle;
    else low = middle;
  }
  return high;
}

export function predictTrialsJump(courseInput, {
  startX,
  endX,
  vehicle = 'monster',
  speed = null,
} = {}) {
  const course = courseInput;
  const profile = getTrialsProfile(vehicle);
  const takeoffGround = sampleTrialsGround({ ...course, gaps: [] }, Math.max(0, startX - 0.12));
  const landingGround = sampleTrialsGround({ ...course, gaps: [] }, Math.min(course.length, endX + 0.18));
  if (!takeoffGround || !landingGround || !(endX > startX)) {
    return {
      vehicle: profile.id,
      possible: false,
      message: 'Jump edges do not have valid terrain.',
    };
  }
  const takeoff = {
    x: startX,
    y: takeoffGround.height + profile.rideHeight,
    angle: takeoffGround.angle,
  };
  const landing = {
    x: endX,
    y: landingGround.height + profile.rideHeight,
    angle: landingGround.angle,
  };
  const requiredSpeed = requiredSpeedForJump(takeoff, landing, profile);
  const launchSpeed = Number.isFinite(speed)
    ? clamp(Number(speed), 1, profile.turboMaxSpeed * 1.08)
    : Math.min(profile.turboMaxSpeed, Math.max(profile.maxSpeed * 0.82, requiredSpeed));
  const flight = projectileAt(launchSpeed, takeoff, landing.x, profile);
  const landingAngle = Math.atan2(flight.vy, flight.vx);
  const angleError = Math.abs(landingAngle - landing.angle);
  const possible = Number.isFinite(requiredSpeed) && requiredSpeed <= profile.turboMaxSpeed * 1.02;
  const safe = possible
    && flight.y >= landing.y - profile.rideHeight * 0.42
    && angleError <= profile.cleanAngle * 1.25;
  const turboRequired = possible && requiredSpeed > profile.maxSpeed * 0.96;
  const points = Array.from({ length: 25 }, (_, index) => {
    const time = flight.time * index / 24;
    return {
      x: takeoff.x + flight.vx * time,
      y: takeoff.y + launchSpeed * Math.sin(takeoff.angle) * time
        - 0.5 * profile.gravity * time * time,
    };
  });
  return {
    vehicle: profile.id,
    possible,
    safe,
    turboRequired,
    requiredSpeed,
    launchSpeed,
    expectedRange: endX - startX,
    landingAngle,
    landingSlope: landing.angle,
    landingSafety: clamp(1 - angleError / Math.max(0.1, profile.crashAngle), 0, 1),
    lowSpeedRecovery: endX - startX <= profile.maxSpeed * 1.35,
    points,
    message: !possible
      ? 'Impossible even with turbo'
      : safe ? (turboRequired ? 'Safe with turbo' : 'Safe at course speed')
        : 'Reachable, but pitch control is critical',
  };
}

export function validateTrialsCourse(input) {
  const sanitized = sanitizeTrialsCourse(input);
  const course = sanitized.course;
  const issues = sanitized.warnings.map((message) => ({ severity: 'warning', message }));
  for (let index = 1; index < course.heightPoints.length; index++) {
    const a = course.heightPoints[index - 1];
    const b = course.heightPoints[index];
    const grade = Math.abs((b.y - a.y) / Math.max(0.1, b.x - a.x));
    if (grade > 1.28) {
      issues.push({
        severity: 'error',
        message: `Terrain wall near ${Math.round(a.x)} m exceeds the safe editor grade.`,
        x: a.x,
      });
    }
  }
  if (!sampleTrialsGround(course, course.spawn.x)) {
    issues.push({ severity: 'error', message: 'Start position has no ground.', x: course.spawn.x });
  }
  if (!sampleTrialsGround(course, course.finish)) {
    issues.push({ severity: 'error', message: 'Finish gate has no ground.', x: course.finish });
  }
  if (!course.featurePlacements.some((placement) => placement.featureId === 'trials-finish-gate')) {
    issues.push({ severity: 'error', message: 'Place a finish gate.' });
  }
  if (!course.checkpoints.length) {
    issues.push({ severity: 'error', message: 'Place at least one checkpoint.' });
  }
  for (const checkpoint of course.checkpoints) {
    if (checkpoint.x <= course.spawn.x + 15 || checkpoint.x >= course.finish - 10) {
      issues.push({ severity: 'error', message: 'Checkpoint must sit between the start and finish.', x: checkpoint.x });
    }
    if (!sampleTrialsGround(course, checkpoint.x)) {
      issues.push({ severity: 'error', message: 'Checkpoint is over a gap.', x: checkpoint.x });
    }
  }
  const featureIntervals = [];
  for (const placement of course.featurePlacements) {
    const feature = getCourseFeature(placement.featureId);
    if (!feature) continue;
    const radius = feature.footprint.length * placement.anchor.scaleX * 0.5;
    if (placement.anchor.x - radius < 2 || placement.anchor.x + radius > course.length - 2) {
      issues.push({ severity: 'error', message: `${feature.label} is outside the build area.`, x: placement.anchor.x });
    }
    const overlapping = featureIntervals.find((interval) => (
      placement.anchor.x - radius < interval.end
      && placement.anchor.x + radius > interval.start
      && !['checkpoint-gate', 'trials-finish-gate'].includes(placement.featureId)
    ));
    if (overlapping) {
      issues.push({ severity: 'error', message: `${feature.label} overlaps ${overlapping.label}.`, x: placement.anchor.x });
    }
    featureIntervals.push({
      start: placement.anchor.x - radius,
      end: placement.anchor.x + radius,
      label: feature.label,
    });
  }
  const gapJumps = course.gaps.map((gap) => ({
    id: `${Math.round(gap.start * 10)}-${Math.round(gap.end * 10)}`,
    label: gap.label,
    startX: gap.start,
    endX: gap.end,
    monster: predictTrialsJump(course, {
      startX: gap.start,
      endX: gap.end,
      vehicle: 'monster',
    }),
    buggy: predictTrialsJump(course, {
      startX: gap.start,
      endX: gap.end,
      vehicle: 'buggy',
    }),
  }));
  const rampJumps = course.featurePlacements
    .map((placement) => ({ placement, feature: getCourseFeature(placement.featureId) }))
    .filter(({ feature }) => feature?.category === 'jumps')
    .map(({ placement, feature }) => {
      const length = feature.footprint.length * placement.anchor.scaleX;
      const start = placement.anchor.x - length * 0.5;
      const double = feature.surfaceProfile?.kind === 'double';
      const takeoffX = double ? start + length * 0.31 : start + length;
      const targetFor = (vehicleId) => {
        if (double) return start + length * 0.66;
        const profile = getTrialsProfile(vehicleId);
        const ground = sampleTrialsGround(course, Math.max(0, takeoffX - 0.12));
        const speed = profile.maxSpeed * 0.78;
        const angle = ground?.angle || Math.atan(feature.surfaceProfile?.takeoffSlope || 0.25);
        const range = Math.max(
          8,
          speed * Math.cos(angle) * Math.max(0.3, 2 * speed * Math.sin(angle) / profile.gravity),
        );
        return Math.min(course.length - 2, takeoffX + range);
      };
      const monsterEnd = targetFor('monster');
      const buggyEnd = targetFor('buggy');
      return {
        id: placement.id,
        kind: 'ramp',
        label: feature.label,
        startX: takeoffX,
        endX: Math.max(monsterEnd, buggyEnd),
        monster: predictTrialsJump(course, {
          startX: takeoffX,
          endX: monsterEnd,
          vehicle: 'monster',
        }),
        buggy: predictTrialsJump(course, {
          startX: takeoffX,
          endX: buggyEnd,
          vehicle: 'buggy',
        }),
      };
    });
  const jumps = [...gapJumps, ...rampJumps];
  for (const jump of jumps) {
    const requiredVehicles = course.vehicleSupport === 'both'
      ? [jump.monster, jump.buggy]
      : [jump[course.vehicleSupport]];
    for (const result of requiredVehicles) {
      if (!result?.possible) {
        issues.push({
          severity: 'error',
          message: `${jump.label} is impossible for the ${result?.vehicle || course.vehicleSupport}.`,
          x: jump.startX,
        });
      } else if (!result.safe) {
        issues.push({
          severity: 'warning',
          message: `${jump.label} needs active pitch control for the ${result.vehicle}.`,
          x: jump.startX,
        });
      }
    }
  }
  const errors = issues.filter((issue) => issue.severity === 'error');
  return {
    valid: errors.length === 0,
    course,
    issues,
    errors,
    jumps,
    stats: {
      length: course.length,
      points: course.heightPoints.length,
      gaps: course.gaps.length,
      checkpoints: course.checkpoints.length,
      features: course.featurePlacements.length,
    },
  };
}
