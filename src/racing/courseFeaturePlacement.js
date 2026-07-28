import {
  COURSE_FEATURE_CATALOG,
  getCourseFeature,
} from './courseFeatureCatalog.js';

const MAX_CIRCUIT_FEATURES = 320;
const MAX_TRIALS_FEATURES = 240;
const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function mod1(value) {
  const wrapped = finite(value) % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}

function normalizedAngle(value) {
  let angle = finite(value) % TAU;
  if (angle > Math.PI) angle -= TAU;
  if (angle < -Math.PI) angle += TAU;
  return angle;
}

function safePlacementId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 96);
}

function clampScale(feature, value) {
  const range = feature.adjustableProperties?.scale || { min: 1, max: 1 };
  return clamp(finite(value, 1), range.min, range.max);
}

export function createCourseFeaturePlacementId(featureId, seed = Date.now(), ordinal = 0) {
  const value = (Math.imul((Number(seed) || 1) >>> 0, 2654435761) ^ Math.imul(ordinal + 1, 2246822519)) >>> 0;
  return `placed-${String(featureId || 'feature').slice(0, 28)}-${value.toString(36)}`;
}

export function sanitizeCourseFeaturePlacement(input = {}, {
  mode = null,
  fallbackId = '',
} = {}) {
  const featureId = String(input.featureId || input.catalogId || '').slice(0, 80);
  const feature = getCourseFeature(featureId);
  if (!feature) return { placement: null, warning: `Unknown course feature "${featureId || 'missing'}" was ignored.` };
  const anchorInput = input.anchor || input;
  const anchorMode = String(anchorInput.mode || mode || 'spline');
  if (!feature.allowedAnchors.includes(anchorMode)) {
    return { placement: null, warning: `${feature.label} cannot use a ${anchorMode} anchor.` };
  }
  if (mode && !feature.compatibleModes.includes(mode === 'spline' ? 'circuit' : mode)) {
    return { placement: null, warning: `${feature.label} is unavailable in ${mode}.` };
  }
  let anchor;
  if (anchorMode === 'spline') {
    anchor = {
      mode: 'spline',
      fraction: mod1(anchorInput.fraction),
      lateralOffset: clamp(finite(anchorInput.lateralOffset), -32, 32),
      facing: anchorInput.facing === 'backward' || anchorInput.facing === -1 ? 'backward' : 'forward',
      rotationOffset: normalizedAngle(anchorInput.rotationOffset),
      scaleX: clampScale(feature, anchorInput.scaleX),
      scaleY: clampScale(feature, anchorInput.scaleY),
      scaleZ: clampScale(feature, anchorInput.scaleZ),
    };
  } else if (anchorMode === 'trials') {
    anchor = {
      mode: 'trials',
      x: clamp(finite(anchorInput.x), 0, 5000),
      groundOffset: clamp(finite(anchorInput.groundOffset), -8, 40),
      facing: anchorInput.facing === -1 || anchorInput.facing === 'backward' ? -1 : 1,
      rotationOffset: normalizedAngle(anchorInput.rotationOffset),
      scaleX: clampScale(feature, anchorInput.scaleX),
      scaleY: clampScale(feature, anchorInput.scaleY),
    };
  } else if (anchorMode === 'trials-range') {
    const startX = clamp(finite(anchorInput.startX), 0, 5000);
    const endX = clamp(finite(anchorInput.endX), 0, 5000);
    anchor = {
      mode: 'trials-range',
      startX: Math.min(startX, endX),
      endX: Math.max(startX, endX),
    };
  } else {
    return { placement: null, warning: `Unsupported course anchor mode "${anchorMode}".` };
  }
  const id = safePlacementId(input.id || fallbackId)
    || createCourseFeaturePlacementId(featureId, input.seed, input.ordinal);
  return {
    placement: {
      id,
      featureId,
      anchor,
      source: input.source === 'auto-dress' || input.source === 'auto-fill'
        ? input.source
        : 'manual',
      createdAt: Math.max(0, Math.round(finite(input.createdAt))),
      properties: input.properties && typeof input.properties === 'object'
        ? Object.fromEntries(
          Object.entries(input.properties)
            .filter(([key, value]) => key.length <= 40 && ['string', 'number', 'boolean'].includes(typeof value))
            .slice(0, 16),
        )
        : {},
    },
    warning: '',
  };
}

export function sanitizeCourseFeaturePlacements(input = [], {
  mode = null,
  limit = null,
} = {}) {
  const values = Array.isArray(input) ? input : [];
  const effectiveLimit = Math.min(
    400,
    Math.max(0, Number(limit) || (mode === 'trials' ? MAX_TRIALS_FEATURES : MAX_CIRCUIT_FEATURES)),
  );
  const placements = [];
  const warnings = [];
  const ids = new Set();
  for (let index = 0; index < values.length && placements.length < effectiveLimit; index++) {
    const result = sanitizeCourseFeaturePlacement(values[index], {
      mode,
      fallbackId: `placed-${index.toString(36)}`,
    });
    if (result.warning) warnings.push(result.warning);
    if (!result.placement) continue;
    let id = result.placement.id;
    if (ids.has(id)) {
      id = `${id.slice(0, 86)}-${index.toString(36)}`;
      warnings.push(`Duplicate feature placement id was reassigned to "${id}".`);
    }
    ids.add(id);
    placements.push({ ...result.placement, id });
  }
  if (values.length > effectiveLimit) {
    warnings.push(`Feature count was limited to ${effectiveLimit}; ${values.length - effectiveLimit} excess placements were ignored.`);
  }
  return { placements, warnings };
}

/**
 * Convert a stable authored fraction to the generated runtime route.
 * Facing stays relative to travel: reversing a course flips a forward-facing
 * stamp with the road rather than leaving an arrow pointing against traffic.
 */
export function circuitRuntimeFraction(authoredFraction, {
  startFraction = 0,
  reverse = false,
} = {}) {
  return reverse
    ? mod1(1 - mod1(startFraction) - mod1(authoredFraction))
    : mod1(mod1(authoredFraction) - mod1(startFraction));
}

export function resolveCircuitPlacement(placement, samples, {
  startFraction = 0,
  reverse = false,
} = {}) {
  if (!placement?.anchor || placement.anchor.mode !== 'spline' || !samples?.length) return null;
  const fraction = circuitRuntimeFraction(placement.anchor.fraction, { startFraction, reverse });
  const scaled = fraction * samples.length;
  const index = Math.floor(scaled) % samples.length;
  const nextIndex = (index + 1) % samples.length;
  const amount = scaled - Math.floor(scaled);
  const sample = samples[index];
  const next = samples[nextIndex];
  const tangentX = finite(sample.tangent?.x, next.x - sample.x);
  const tangentY = finite(sample.tangent?.y, finite(next.y) - finite(sample.y));
  const tangentZ = finite(sample.tangent?.z, next.z - sample.z);
  const horizontalLength = Math.hypot(tangentX, tangentZ) || 1;
  const forwardSign = placement.anchor.facing === 'backward' ? -1 : 1;
  const roadForward = {
    x: tangentX / horizontalLength,
    y: tangentY / horizontalLength,
    z: tangentZ / horizontalLength,
  };
  const roadRight = { x: -roadForward.z, y: 0, z: roadForward.x };
  const forward = {
    x: roadForward.x * forwardSign,
    y: roadForward.y * forwardSign,
    z: roadForward.z * forwardSign,
  };
  const right = { x: -forward.z, y: 0, z: forward.x };
  const lateral = placement.anchor.lateralOffset;
  const baseY = finite(sample.y) * (1 - amount) + finite(next.y) * amount;
  const x = finite(sample.x) * (1 - amount) + finite(next.x) * amount + roadRight.x * lateral;
  const z = finite(sample.z) * (1 - amount) + finite(next.z) * amount + roadRight.z * lateral;
  return {
    id: placement.id,
    featureId: placement.featureId,
    feature: COURSE_FEATURE_CATALOG[placement.featureId],
    placement,
    fraction,
    index,
    amount,
    x,
    y: baseY,
    z,
    yaw: Math.atan2(forward.x, forward.z) + placement.anchor.rotationOffset,
    forward,
    right,
    roadForward,
    roadRight,
    baseGroundHeight: baseY,
    baseGroundPitch: Math.atan2(tangentY, horizontalLength),
    scale: {
      x: placement.anchor.scaleX,
      y: placement.anchor.scaleY,
      z: placement.anchor.scaleZ,
    },
  };
}

export function resolveCircuitPlacements(placements, samples, options = {}) {
  return (placements || [])
    .map((placement) => resolveCircuitPlacement(placement, samples, options))
    .filter(Boolean);
}

export function mirrorCircuitPlacement(placement) {
  if (placement?.anchor?.mode !== 'spline') return placement;
  return {
    ...placement,
    anchor: {
      ...placement.anchor,
      lateralOffset: placement.anchor.lateralOffset,
      rotationOffset: placement.anchor.rotationOffset,
    },
  };
}
