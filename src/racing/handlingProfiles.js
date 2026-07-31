import { RACE_TUNING } from './physics.js';
import { getDriftCarProfile } from './drift/driftAttack.js';

function freezeCurve(points) {
  return Object.freeze(points.map((point) => Object.freeze([...point])));
}

function profile(id, values) {
  return Object.freeze({
    ...RACE_TUNING,
    id,
    ...values,
    accelerationCurve: freezeCurve(values.accelerationCurve || RACE_TUNING.accelerationCurve),
  });
}

/**
 * Editable deterministic handling profiles for the shared circuit integrator.
 * Modes share telemetry and lifecycle, not one undifferentiated vehicle feel.
 */
export const RALLY_HANDLING_PROFILES = Object.freeze({
  circuit: profile('off-road-gp-balanced', {
    acceleration: 20.5,
    accelerationCurve: [[0, 1.12], [0.34, 1], [0.72, 0.64], [1, 0.3]],
    maxSpeed: 25,
    steeringResponse: 12.5,
    steeringReturn: 16,
    steerRate: 1.82,
    highSpeedSteerScale: 0.5,
    roadGrip: 10.4,
    offroadGrip: 5.65,
    rollingResistance: 0.5,
    aerodynamicDrag: 0.0082,
    engineBraking: 0.18,
  }),
  drift: profile('drift-attack-linked', {
    acceleration: 20,
    accelerationCurve: [[0, 1.08], [0.42, 1], [0.78, 0.7], [1, 0.34]],
    maxSpeed: 26,
    boostSpeed: 34,
    boostAcceleration: 27,
    steeringResponse: 14,
    steeringReturn: 11,
    steerRate: 1.88,
    driftSteerRate: 2.55,
    highSpeedSteerScale: 0.67,
    roadGrip: 8.9,
    driftGrip: 1.86,
    driftLateralBuild: 0.78,
    handbrakeLateralBuild: 1.08,
    rollingResistance: 0.42,
    aerodynamicDrag: 0.0072,
    engineBraking: 0.11,
  }),
  stock: profile('stock-cup-pack', {
    acceleration: 18.4,
    accelerationCurve: [[0, 1.06], [0.38, 1], [0.76, 0.68], [1, 0.31]],
    maxSpeed: 27,
    boostSpeed: 31,
    steeringResponse: 9,
    steeringReturn: 13,
    steerRate: 1.62,
    driftSteerRate: 1.82,
    highSpeedSteerScale: 0.42,
    roadGrip: 11.8,
    driftGrip: 3.3,
    driftLateralBuild: 0.42,
    rollingResistance: 0.55,
    aerodynamicDrag: 0.0075,
    engineBraking: 0.14,
    draftAcceleration: 8.8,
    collisionMass: 1.25,
  }),
  draw: profile('workshop-rally-balanced', {
    acceleration: 20.5,
    maxSpeed: 25,
    steeringResponse: 12.5,
    steeringReturn: 16,
    steerRate: 1.82,
    highSpeedSteerScale: 0.5,
    roadGrip: 10.4,
    offroadGrip: 5.65,
  }),
});

export function getRallyHandlingProfile(mode = 'circuit', variant = null) {
  const base = RALLY_HANDLING_PROFILES[mode] || RALLY_HANDLING_PROFILES.circuit;
  if (mode !== 'drift' || !variant) return base;
  const car = getDriftCarProfile(variant);
  return profile(`drift-${car.id}`, {
    ...base,
    ...car.tuning,
    id: `drift-${car.id}`,
    accelerationCurve: base.accelerationCurve,
  });
}
