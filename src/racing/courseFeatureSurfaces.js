import { resolveCircuitPlacements } from './courseFeaturePlacement.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothstepDerivative(value) {
  const t = clamp(value, 0, 1);
  return 6 * t * (1 - t);
}

function rampRise(t, exponent = 1.65) {
  const value = clamp(t, 0, 1);
  return value ** exponent;
}

function rampRiseDerivative(t, exponent = 1.65) {
  const value = clamp(t, 0.0001, 1);
  return exponent * value ** (exponent - 1);
}

/**
 * Sample one authored feature profile. `t` travels from the visible entrance
 * to exit, so the renderer and contact query can consume the same numbers.
 */
export function sampleCourseFeatureSurface(profile, t) {
  const value = clamp(t, 0, 1);
  const height = Math.max(0, Number(profile?.height) || 0);
  switch (profile?.kind) {
    case 'kicker':
    case 'launch': {
      return {
        hasSurface: true,
        height: height * rampRise(value),
        normalizedSlope: height * rampRiseDerivative(value),
        takeoff: value >= 0.91,
      };
    }
    case 'tabletop': {
      if (value < 0.3) {
        const local = value / 0.3;
        return {
          hasSurface: true,
          height: height * smoothstep(local),
          normalizedSlope: height * smoothstepDerivative(local) / 0.3,
          takeoff: value >= 0.265,
        };
      }
      if (value <= 0.67) return { hasSurface: true, height, normalizedSlope: 0, takeoff: false };
      const local = (value - 0.67) / 0.33;
      return {
        hasSurface: true,
        height: height * (1 - smoothstep(local)),
        normalizedSlope: -height * smoothstepDerivative(local) / 0.33,
        takeoff: false,
      };
    }
    case 'double': {
      if (value < 0.31) {
        const local = value / 0.31;
        return {
          hasSurface: true,
          height: height * rampRise(local),
          normalizedSlope: height * rampRiseDerivative(local) / 0.31,
          takeoff: value >= 0.275,
        };
      }
      if (value < 0.66) return { hasSurface: false, height: 0, normalizedSlope: 0, takeoff: false };
      const local = (value - 0.66) / 0.34;
      return {
        hasSurface: true,
        height: height * (1 - smoothstep(local)),
        normalizedSlope: -height * smoothstepDerivative(local) / 0.34,
        takeoff: false,
      };
    }
    case 'rollers': {
      const count = Math.max(2, Math.round(Number(profile.count) || 4));
      const wave = Math.sin(value * Math.PI * count);
      const heightValue = height * wave * wave;
      const derivative = height * Math.sin(value * Math.PI * count * 2) * Math.PI * count;
      return { hasSurface: true, height: heightValue, normalizedSlope: derivative, takeoff: false };
    }
    case 'step-up': {
      if (value < 0.42) {
        const local = value / 0.42;
        return {
          hasSurface: true,
          height: height * rampRise(local),
          normalizedSlope: height * rampRiseDerivative(local) / 0.42,
          takeoff: value >= 0.38,
        };
      }
      if (value < 0.62) return { hasSurface: true, height, normalizedSlope: 0, takeoff: false };
      const local = (value - 0.62) / 0.38;
      return {
        hasSurface: true,
        height: height * (1 - smoothstep(local)),
        normalizedSlope: -height * smoothstepDerivative(local) / 0.38,
        takeoff: false,
      };
    }
    case 'step-down': {
      if (value < 0.24) {
        const local = value / 0.24;
        return {
          hasSurface: true,
          height: height * smoothstep(local),
          normalizedSlope: height * smoothstepDerivative(local) / 0.24,
          takeoff: value >= 0.21,
        };
      }
      if (value < 0.48) return { hasSurface: true, height, normalizedSlope: 0, takeoff: false };
      const local = (value - 0.48) / 0.52;
      return {
        hasSurface: true,
        height: height * (1 - smoothstep(local)),
        normalizedSlope: -height * smoothstepDerivative(local) / 0.52,
        takeoff: false,
      };
    }
    default:
      return { hasSurface: true, height: 0, normalizedSlope: 0, takeoff: false };
  }
}

export function buildCircuitFeatureRuntime(placements, samples, course = {}) {
  return resolveCircuitPlacements(placements, samples, {
    startFraction: course.startFraction || course.drawDraft?.startFraction || 0,
    reverse: course.drawDirection === 'reverse' || !!course.drawDraft?.reverse,
  }).map((runtime) => {
    const feature = runtime.feature;
    const length = feature.footprint.length * runtime.scale.z;
    const width = feature.footprint.width * runtime.scale.x;
    const yaw = runtime.yaw;
    const collisionKind = feature.collisionProfile?.kind || 'none';
    const componentCount = Math.max(1, Math.min(12, Math.round(
      Number(feature.collisionProfile?.count) || 1,
    )));
    const componentRadius = Math.max(
      0.25,
      Number(feature.collisionProfile?.radius)
        || Math.min(width, length) * 0.38,
    );
    const components = [];
    for (let index = 0; index < componentCount; index++) {
      const amount = componentCount === 1 ? 0.5 : index / (componentCount - 1);
      const alternating = index % 2 ? 1 : -1;
      components.push({
        index,
        longitudinal: componentCount === 1 ? 0 : (amount - 0.5) * length * 0.72,
        lateral: ['soft-obstacles', 'obstacles'].includes(collisionKind) && componentCount > 1
          ? alternating * width * 0.27
          : 0,
        radius: componentRadius,
        durability: Math.max(1, Number(feature.collisionProfile?.durability) || 1),
        health: Math.max(1, Number(feature.collisionProfile?.durability) || 1),
        destroyed: false,
      });
    }
    return {
      ...runtime,
      length,
      width,
      forward: { x: Math.sin(yaw), z: Math.cos(yaw) },
      right: { x: Math.cos(yaw), z: -Math.sin(yaw) },
      surfaceProfile: feature.surfaceProfile,
      collisionProfile: feature.collisionProfile,
      gameplayEffect: feature.gameplayEffect,
      collisionComponents: components,
      interactionState: {
        insideCars: new Set(),
        lastHitByCar: new Map(),
        destroyed: false,
      },
    };
  });
}

function localCoordinates(runtime, x, z) {
  const dx = x - runtime.x;
  const dz = z - runtime.z;
  return {
    longitudinal: dx * runtime.forward.x + dz * runtime.forward.z,
    lateral: dx * runtime.right.x + dz * runtime.right.z,
  };
}

function rampContact(runtime, coordinates, car) {
  if (!runtime.surfaceProfile || ![
    'kicker',
    'launch',
    'tabletop',
    'double',
    'rollers',
    'step-up',
    'step-down',
  ].includes(runtime.surfaceProfile.kind)) return null;
  const t = coordinates.longitudinal / runtime.length + 0.5;
  if (t < 0 || t > 1 || Math.abs(coordinates.lateral) > runtime.width * 0.5) return null;
  const sampled = sampleCourseFeatureSurface(runtime.surfaceProfile, t);
  if (!sampled.hasSurface) return {
    kind: 'ramp-gap',
    runtime,
    hasSurface: false,
    local: coordinates,
    t,
  };
  const slope = sampled.normalizedSlope / Math.max(0.1, runtime.length);
  const alongVelocity = Number(car?.vx || 0) * runtime.forward.x + Number(car?.vz || 0) * runtime.forward.z;
  const previous = car ? localCoordinates(
    runtime,
    Number(car.previousX ?? car.x),
    Number(car.previousZ ?? car.z),
  ) : coordinates;
  const previousT = previous.longitudinal / runtime.length + 0.5;
  const sweptTakeoff = sampled.takeoff || (
    alongVelocity > 0
    && previousT < 0.92
    && t >= 0.92
  );
  return {
    kind: 'ramp',
    runtime,
    hasSurface: true,
    local: coordinates,
    t,
    groundHeight: runtime.baseGroundHeight + sampled.height * runtime.scale.y,
    groundPitch: Math.atan(slope * runtime.scale.y),
    takeoffSlope: Math.max(0, slope * runtime.scale.y),
    takeoff: sweptTakeoff && alongVelocity > 4 && Math.abs(coordinates.lateral) <= runtime.width * 0.46,
    alongVelocity,
  };
}

function triggerContact(runtime, coordinates) {
  if (
    Math.abs(coordinates.longitudinal) > runtime.length * 0.5
    || Math.abs(coordinates.lateral) > runtime.width * 0.5
  ) return null;
  const surface = runtime.surfaceProfile;
  return {
    kind: surface?.kind === 'material' || surface?.kind === 'rumble' ? 'material' : 'trigger',
    runtime,
    hasSurface: false,
    local: coordinates,
    t: coordinates.longitudinal / runtime.length + 0.5,
    surface: surface?.surface || '',
    grip: surface?.grip,
    drag: surface?.drag,
    gameplayEffect: runtime.gameplayEffect,
  };
}

export function queryCircuitFeatureContact(runtimes, car) {
  let selectedRamp = null;
  const triggers = [];
  for (const runtime of runtimes || []) {
    const coordinates = localCoordinates(runtime, Number(car.x) || 0, Number(car.z) || 0);
    const ramp = rampContact(runtime, coordinates, car);
    if (ramp) {
      if (
        ramp.hasSurface
        && (!selectedRamp || ramp.groundHeight > selectedRamp.groundHeight)
      ) selectedRamp = ramp;
      else if (!ramp.hasSurface) triggers.push(ramp);
      continue;
    }
    const trigger = triggerContact(runtime, coordinates);
    if (trigger) triggers.push(trigger);
  }
  return { ramp: selectedRamp, triggers };
}

function collisionNormal(runtime, coordinates, component) {
  const localX = coordinates.lateral - component.lateral;
  const localZ = coordinates.longitudinal - component.longitudinal;
  const distance = Math.hypot(localX, localZ);
  const localNormalX = distance > 0.0001 ? localX / distance : 1;
  const localNormalZ = distance > 0.0001 ? localZ / distance : 0;
  return {
    x: runtime.right.x * localNormalX + runtime.forward.x * localNormalZ,
    z: runtime.right.z * localNormalX + runtime.forward.z * localNormalZ,
    distance,
  };
}

/**
 * Resolve discrete, pooled Workshop interactions without coupling the catalog
 * to the renderer or audio system. The caller applies damage/VFX and can hide
 * an authored clone when a destructible is exhausted.
 */
export function resolveCircuitFeatureInteractions(
  runtimes,
  car,
  {
    carId = 'car',
    now = 0,
    carRadius = 1.05,
    landed = false,
  } = {},
) {
  const triggered = [];
  const collisions = [];
  const destroyed = [];
  for (const runtime of runtimes || []) {
    const state = runtime.interactionState;
    if (!state) continue;
    const coordinates = localCoordinates(runtime, Number(car.x) || 0, Number(car.z) || 0);
    const insideFootprint = (
      Math.abs(coordinates.longitudinal) <= runtime.length * 0.5
      && Math.abs(coordinates.lateral) <= runtime.width * 0.5
    );
    const effectKind = runtime.gameplayEffect?.kind || '';
    const triggerEligible = effectKind === 'jump-ring'
      ? !car.grounded && Number(car.y) >= runtime.y + 1.1
      : effectKind === 'landing-zone' ? !!landed : true;
    if (insideFootprint && triggerEligible && !state.insideCars.has(carId)) {
      state.insideCars.add(carId);
      if (runtime.gameplayEffect || runtime.feature.scoreEffect) {
        triggered.push({
          runtime,
          effect: runtime.gameplayEffect,
          score: runtime.feature.scoreEffect,
          coordinates,
        });
      }
    } else if (!insideFootprint) {
      state.insideCars.delete(carId);
    }
    if (state.destroyed || !car.grounded) continue;
    const collisionKind = runtime.collisionProfile?.kind || 'none';
    if (![
      'soft-obstacles',
      'obstacles',
      'destructible',
      'destructible-chain',
    ].includes(collisionKind)) continue;
    for (const component of runtime.collisionComponents || []) {
      if (component.destroyed) continue;
      const normal = collisionNormal(runtime, coordinates, component);
      const contactDistance = component.radius + carRadius;
      if (normal.distance >= contactDistance) continue;
      const lastHit = state.lastHitByCar.get(`${carId}:${component.index}`) || -Infinity;
      if (now - lastHit < 0.18) continue;
      state.lastHitByCar.set(`${carId}:${component.index}`, now);
      const outwardSpeed = Number(car.vx || 0) * normal.x + Number(car.vz || 0) * normal.z;
      const impactSpeed = Math.max(
        0,
        -(outwardSpeed),
        Math.hypot(Number(car.vx) || 0, Number(car.vz) || 0) * 0.54,
      );
      const destructible = collisionKind === 'destructible' || collisionKind === 'destructible-chain';
      if (destructible && impactSpeed > 3.2) {
        component.health -= impactSpeed * (collisionKind === 'destructible-chain' ? 4.8 : 5.6);
        if (component.health <= 0) {
          component.destroyed = true;
          destroyed.push({
            runtime,
            component,
            impactSpeed,
            complete: runtime.collisionComponents.every((item) => item.destroyed),
          });
        }
      }
      collisions.push({
        runtime,
        component,
        collisionKind,
        normal,
        penetration: Math.max(0, contactDistance - normal.distance),
        impactSpeed,
        destructible,
        destroyed: component.destroyed,
      });
      // One coarse component contact per feature and step is enough; resolving
      // several overlapping radii would multiply the impulse unnaturally.
      break;
    }
    if (runtime.collisionComponents.length && runtime.collisionComponents.every((item) => item.destroyed)) {
      state.destroyed = true;
    }
  }
  return { triggered, collisions, destroyed };
}

export function applyCircuitFeatureAwareness(aiPath, runtimes, routeLength = 1) {
  if (!Array.isArray(aiPath) || !aiPath.length) return aiPath;
  for (const point of aiPath) {
    delete point.featureId;
    delete point.featureLaneOffset;
  }
  for (const runtime of runtimes || []) {
    const feature = runtime.feature;
    const center = runtime.fraction * aiPath.length;
    const halfWindow = Math.max(2, Math.ceil(
      (feature.footprint.length * runtime.scale.z + 16)
      / Math.max(0.1, routeLength / aiPath.length),
    ));
    for (let offset = -halfWindow; offset <= halfWindow; offset++) {
      const index = (Math.round(center) + offset + aiPath.length) % aiPath.length;
      const point = aiPath[index];
      point.featureId = runtime.id;
      if (feature.aiBehavior.behavior === 'jump') {
        point.targetSpeed = Math.max(
          Number(feature.aiBehavior.minimumSpeed) || 9,
          Math.min(Number(feature.aiBehavior.targetSpeed) || 18, point.targetSpeed + 2.5),
        );
      } else if (['avoid', 'slalom'].includes(feature.aiBehavior.behavior)) {
        const direction = runtime.placement.anchor.lateralOffset >= 0 ? -1 : 1;
        point.featureLaneOffset = direction * Math.min(2.2, Math.max(1.1, runtime.width * 0.34));
        point.targetSpeed = Math.min(point.targetSpeed, feature.aiBehavior.behavior === 'slalom' ? 13.5 : 16);
      }
    }
  }
  return aiPath;
}
