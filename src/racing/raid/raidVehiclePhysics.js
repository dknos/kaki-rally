// Kaki Rally Raid — vehicle physics.
//
// A fixed-step, four-contact model reading the streamed terrain authority. It
// is deliberately Raid-owned rather than an adaptation of the Dune model, both
// because Dune is frozen and because rally raid wants different behaviour:
// heavy, stable at speed, long to stop, and rewarding of momentum on soft sand.
//
// The two properties that matter most for feel, and that a simpler model would
// get wrong:
//
//  * Yaw has angular velocity and inertia. Steering applies a yaw torque; it
//    does not teleport the heading. That is what makes the vehicle feel like it
//    weighs two tonnes instead of like a cursor.
//  * Drift is driven by ACTUAL lateral slip, not by holding a button. Holding
//    slide while gripping earns nothing, and countersteer genuinely catches a
//    slide because it opposes the measured slip rather than a state flag.

import { clamp } from './raidSurfaceField.js';
import { RAID_GRAVITY } from './raidTerrainFeatures.js';

// Imported rather than declared so the constant a jump is SIZED from and the
// constant the vehicle is FLOWN with cannot drift apart.
const GRAVITY = RAID_GRAVITY;

// Largest upward velocity the ground itself may impart, in m/s. See the ground
// constraint in the vertical section below.
const MAX_GROUND_LAUNCH = 14;

// Wheel offsets in vehicle-local metres: forward (+) and right (+).
const WHEEL_LAYOUT = Object.freeze([
  { forward: 1.42, right: -0.86 },
  { forward: 1.42, right: 0.86 },
  { forward: -1.42, right: -0.86 },
  { forward: -1.42, right: 0.86 },
]);

const SUSPENSION_TRAVEL = 0.42;
const SUSPENSION_STIFFNESS = 46;
const SUSPENSION_DAMPING = 7.4;

export function createRaidVehicle({ x, y, z, yaw, wheelRadius = 0.46 }) {
  return {
    x,
    y: y + wheelRadius + 0.35,
    z,
    yaw,
    pitch: 0,
    roll: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
    yawRate: 0,
    wheelRadius,
    wheelSpin: 0,
    airborne: false,
    airborneTime: 0,
    landingImpact: 0,
    contacts: 0,
    surface: null,
    slip: 0,
    drifting: false,
    // Ground height under the vehicle on the previous grounded tick. NaN means
    // "no previous contact", which is how the first tick and every touchdown
    // after a flight avoid reading a stale value as a launch.
    previousGround: NaN,
    wheels: WHEEL_LAYOUT.map(() => ({ compression: 0, velocity: 0, grounded: false, load: 0 })),
    scratchSurface: {},
  };
}

export function stepRaidVehicle(vehicle, dt, provider, controls) {
  const cos = Math.cos(vehicle.yaw);
  const sin = Math.sin(vehicle.yaw);
  // Forward and right unit vectors on the ground plane.
  const forwardX = cos;
  const forwardZ = sin;
  const rightX = sin;
  const rightZ = -cos;

  // --- Wheel contacts -----------------------------------------------------
  let contacts = 0;
  let averageGround = 0;
  let pitchTorque = 0;
  let rollTorque = 0;
  for (let index = 0; index < vehicle.wheels.length; index += 1) {
    const layout = WHEEL_LAYOUT[index];
    const wheel = vehicle.wheels[index];
    const wheelX = vehicle.x + forwardX * layout.forward + rightX * layout.right;
    const wheelZ = vehicle.z + forwardZ * layout.forward + rightZ * layout.right;
    const ground = provider.heightAt(wheelX, wheelZ);
    const restY = ground + vehicle.wheelRadius;
    const penetration = restY + SUSPENSION_TRAVEL - vehicle.y;
    if (penetration > 0) {
      const compression = clamp(penetration, 0, SUSPENSION_TRAVEL * 1.6);
      wheel.velocity = (compression - wheel.compression) / Math.max(dt, 1e-6);
      wheel.compression = compression;
      wheel.grounded = true;
      wheel.load = compression * SUSPENSION_STIFFNESS + Math.max(0, wheel.velocity) * SUSPENSION_DAMPING;
      contacts += 1;
      averageGround += ground;
      // Load imbalance across the axles and sides is what pitches and rolls the
      // body, so a crest lifts the nose without any scripted animation.
      pitchTorque -= layout.forward * wheel.load;
      rollTorque += layout.right * wheel.load;
    } else {
      wheel.compression = 0;
      wheel.velocity = 0;
      wheel.grounded = false;
      wheel.load = 0;
    }
  }
  vehicle.contacts = contacts;
  const grounded = contacts > 0;
  vehicle.airborne = !grounded;

  // --- Vertical -----------------------------------------------------------
  vehicle.velocityY -= GRAVITY * dt;
  // Rate the ground under the vehicle is itself rising or falling, in m/s. Both
  // the damper and the floor constraint below need it, and both were wrong
  // without it.
  let groundRate = 0;
  if (grounded) {
    averageGround /= contacts;
    groundRate = Number.isFinite(vehicle.previousGround)
      ? clamp((averageGround - vehicle.previousGround) / Math.max(dt, 1e-6), -MAX_GROUND_LAUNCH, MAX_GROUND_LAUNCH)
      : 0;
    const restY = averageGround + vehicle.wheelRadius + SUSPENSION_TRAVEL * 0.5;
    const spring = (restY - vehicle.y) * SUSPENSION_STIFFNESS;
    // A damper resists the rate the suspension is COMPRESSING, not the
    // vehicle's absolute vertical speed. When ground rising under the wheels
    // carries the whole vehicle up, the suspension is not moving at all and the
    // damper must produce nothing. Damping absolute velocity instead subtracts
    // 66 m/s^2 from a 15 degree take-off at exactly the moment the lip arrives,
    // which is most of the reason a ramp used to launch nothing.
    const damper = -(vehicle.velocityY - groundRate) * SUSPENSION_DAMPING;
    // A strut PUSHES the chassis up. It cannot pull it down, because past full
    // droop the wheel simply leaves the ground. Without this clamp, ground
    // falling away behind a lip makes `groundRate` large and negative, the
    // damper reads that as violent extension, and it yanks the body back down
    // with several times gravity exactly when the vehicle should be leaving.
    vehicle.velocityY += Math.max(0, spring + damper) * dt;
    if (vehicle.airborneTime > 0.25) {
      vehicle.landingImpact = Math.max(vehicle.landingImpact, Math.abs(vehicle.velocityY));
    }
    vehicle.airborneTime = 0;
  } else {
    vehicle.airborneTime += dt;
  }
  vehicle.landingImpact *= Math.exp(-3.2 * dt);
  vehicle.y += vehicle.velocityY * dt;
  if (grounded) {
    // The body rests ON this clamp, not on the spring. Equilibrium ride height
    // works out below the floor, so the suspension never carries the load and
    // the clamp is what actually holds the vehicle up.
    //
    // That makes the clamp a kinematic constraint, and a kinematic constraint
    // that MOVES has to impart its own velocity. Without that term, ground
    // rising under the wheels carries the body up while leaving velocityY
    // pinned at zero — a take-off ramp becomes a conveyor belt that launches
    // nothing at all, at any speed and any lip angle. Measured before this
    // term existed: 0.00 m/s of vertical velocity across an entire 18 m ramp.
    //
    // MAX_GROUND_LAUNCH is a deliberate limit rather than a tuning knob: a gap
    // jump's far wall rises at sixty-odd degrees, and a vehicle that noses into
    // one would otherwise be flung by a pure position derivative.
    const floor = averageGround + vehicle.wheelRadius - 0.05;
    if (vehicle.y < floor) {
      vehicle.y = floor;
      vehicle.velocityY = Math.max(vehicle.velocityY, Math.max(0, groundRate));
    }
    vehicle.previousGround = averageGround;
  } else {
    // A stale reading across a flight would read as a launch on touchdown.
    vehicle.previousGround = NaN;
  }

  // --- Surface ------------------------------------------------------------
  const surface = provider.surfaceAt(vehicle.x, vehicle.z, vehicle.scratchSurface);
  vehicle.surface = surface;

  // --- Longitudinal -------------------------------------------------------
  const speed = Math.hypot(vehicle.velocityX, vehicle.velocityZ);
  const forwardSpeed = vehicle.velocityX * forwardX + vehicle.velocityZ * forwardZ;
  const lateralSpeed = vehicle.velocityX * rightX + vehicle.velocityZ * rightZ;

  const traction = grounded ? (contacts / 4) * surface.grip : 0;
  const push = controls.push ? 1.34 : 1;
  const drive = controls.throttle > 0
    ? controls.throttle * 15.5 * push * traction
    : controls.throttle * 12 * traction;
  // Sinkage is what makes deep sand punish a stopped vehicle and reward
  // momentum: rolling resistance climbs as speed falls.
  const sinkDrag = surface.sinkage * (2.6 + clamp(14 / Math.max(speed, 1.6), 0, 7)) * traction;
  const drag = surface.drag * speed * 0.42 + 0.0032 * speed * speed;

  let newForward = forwardSpeed + (drive - Math.sign(forwardSpeed) * (sinkDrag + drag)) * dt;
  if (Math.abs(forwardSpeed) < 0.4 && Math.abs(controls.throttle) < 0.05) newForward *= 0.86;

  // --- Lateral and yaw ----------------------------------------------------
  // Grip resists lateral velocity. Slide releases some of it. What remains is
  // real, measured slip.
  const slideRelease = controls.slide ? 0.42 : 1;
  const lateralGrip = clamp(traction * 9.5 * slideRelease, 0, 34);
  let newLateral = lateralSpeed - lateralSpeed * clamp(lateralGrip * dt, 0, 1);

  // Recovering lateral energy into forward motion is what makes a caught slide
  // feel fast on salt and dead in powder.
  const recovered = (lateralSpeed - newLateral) * surface.momentum * 0.32;
  newForward += Math.abs(recovered) * Math.sign(newForward || 1) * 0.5;

  vehicle.slip = Math.abs(newLateral);
  vehicle.drifting = grounded && vehicle.slip > 2.4;

  // Yaw torque from steering, scaled by speed so the vehicle is not twitchy at
  // a standstill and stays stable flat out.
  const steerAuthority = traction * clamp(Math.abs(newForward) / 12, 0, 1) * (1 - clamp(Math.abs(newForward) / 92, 0, 0.55));
  const steerTorque = controls.steer * steerAuthority * 3.05 * Math.sign(newForward || 1);
  // Slip generates a restoring torque, so countersteer catches a real slide.
  const slipTorque = -newLateral * traction * 0.115;
  const yawDamping = vehicle.yawRate * (2.5 + traction * 2.2);
  vehicle.yawRate += (steerTorque + slipTorque - yawDamping) * dt;
  vehicle.yawRate = clamp(vehicle.yawRate, -2.1, 2.1);
  if (!grounded) vehicle.yawRate *= Math.exp(-0.5 * dt);
  vehicle.yaw += vehicle.yawRate * dt;

  // --- Integrate ----------------------------------------------------------
  const yawCos = Math.cos(vehicle.yaw);
  const yawSin = Math.sin(vehicle.yaw);
  vehicle.velocityX = yawCos * newForward + yawSin * newLateral;
  vehicle.velocityZ = yawSin * newForward - yawCos * newLateral;
  vehicle.x += vehicle.velocityX * dt;
  vehicle.z += vehicle.velocityZ * dt;
  vehicle.wheelSpin = (newForward / Math.max(vehicle.wheelRadius, 0.1)) * dt;

  // --- Body attitude ------------------------------------------------------
  const totalLoad = Math.max(1e-3, vehicle.wheels.reduce((sum, wheel) => sum + wheel.load, 0));
  const targetPitch = clamp(pitchTorque / totalLoad * 0.24, -0.35, 0.35);
  const targetRoll = clamp(rollTorque / totalLoad * 0.2 - newLateral * 0.012, -0.3, 0.3);
  const attitudeBlend = 1 - Math.exp(-9 * dt);
  vehicle.pitch += (targetPitch - vehicle.pitch) * attitudeBlend;
  vehicle.roll += (targetRoll - vehicle.roll) * attitudeBlend;

  return vehicle;
}
