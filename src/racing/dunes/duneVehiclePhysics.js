import {
  clamp,
  createKartState,
  normalizeAngle,
  stepKart,
} from '../physics.js';
import {
  MONSTER_TUNING,
  getMonsterVehicleProfile,
} from '../monsterScoring.js';
import {
  MONSTER_WHEEL_LAYOUT,
  initializeMonsterVehiclePhysics,
} from '../monsterVehiclePhysics.js';
import { createDuneDeformationBrushBuffer } from './duneDeformation.js';
import { RALLY_RAID_VEHICLES } from './duneRallyRaid.js';

const TWO_PI = Math.PI * 2;
const DEFAULT_TIRE_WIDTH = 0.72;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function approach(current, target, rate, dt) {
  return target + (current - target) * Math.exp(-rate * dt);
}

function duneTuning(id, values = {}) {
  return Object.freeze({
    ...MONSTER_TUNING,
    id,
    acceleration: 17.4,
    reverseAcceleration: 10.8,
    brake: 29,
    rollingResistance: 0.56,
    aerodynamicDrag: 0.0058,
    engineBraking: 0.12,
    roadGrip: 8.25,
    offroadGrip: 6.85,
    driftGrip: 2.42,
    surfaceDragScale: 0.72,
    surfaceResponse: 5.2,
    steerRate: 1.66,
    driftSteerRate: 2.08,
    steeringResponse: 9.8,
    steeringReturn: 12.6,
    maxSpeed: 31.5,
    reverseSpeed: 8.2,
    offroadSpeed: 28.5,
    boostSpeed: 37.5,
    boostAcceleration: 27,
    gravity: 17.2,
    airPitchControl: 7.1,
    airRollControl: 8.4,
    highSpeedSteerScale: 0.54,
    lowSpeedTorque: 0.42,
    suspensionSpring: 48,
    suspensionDamping: 9.4,
    powertrain: Object.freeze({
      ...MONSTER_TUNING.powertrain,
      peakTorque: 1840,
      gearRatios: Object.freeze([3.35, 2.22, 1.61, 1.2, 0.93]),
      shiftSpeeds: Object.freeze([11.8, 18.1, 24.9, 31.1]),
      finalDrive: 18.4,
      tractionLimit: 17.8,
    }),
    ...values,
  });
}

export const DUNE_VEHICLE_TUNING = Object.freeze({
  meowster: duneTuning('dune-meowster-torque'),
  cyber: duneTuning('dune-cyber-heavy-torque', {
    acceleration: 16.7,
    steerRate: 1.5,
    driftSteerRate: 1.78,
    maxSpeed: 29.2,
    offroadSpeed: 27.2,
    suspensionSpring: 55,
    suspensionDamping: 10.6,
    highSpeedSteerScale: 0.49,
    powertrain: Object.freeze({
      ...MONSTER_TUNING.powertrain,
      peakTorque: 2050,
      mass: 6500,
      gearRatios: Object.freeze([3.48, 2.3, 1.64, 1.2, 0.91]),
      shiftSpeeds: Object.freeze([11.2, 17.3, 23.9, 29.2]),
      finalDrive: 18.7,
      tractionLimit: 18.2,
    }),
  }),
  tipsy: duneTuning('dune-tipsy-lively-torque', {
    acceleration: 17.8,
    steerRate: 1.74,
    driftSteerRate: 2.18,
    maxSpeed: 31,
    offroadSpeed: 28,
    suspensionSpring: 49,
    suspensionDamping: 9.2,
  }),
});

const PROFILE_CACHE = Object.freeze(Object.fromEntries([
  ...Object.keys(DUNE_VEHICLE_TUNING).map((id) => {
    const base = getMonsterVehicleProfile(id);
    return [id, Object.freeze({
      ...base,
      mode: 'dunes',
      tuning: DUNE_VEHICLE_TUNING[id],
      tireWidth: id === 'cyber' ? 0.76 : id === 'tipsy' ? 0.7 : DEFAULT_TIRE_WIDTH,
      contact: Object.freeze({
        ...base.contact,
        contactSpring: id === 'cyber' ? 54 : id === 'tipsy' ? 47 : 46,
        contactDamping: id === 'cyber' ? 10.8 : id === 'tipsy' ? 9.1 : 9.6,
        suspensionTravel: id === 'cyber' ? 0.67 : id === 'tipsy' ? 0.74 : 0.8,
        suspensionRest: id === 'cyber' ? 0.33 : id === 'tipsy' ? 0.36 : 0.39,
      }),
    })];
  }),
  ...Object.entries(RALLY_RAID_VEHICLES).map(([id, raid]) => {
    const base = getMonsterVehicleProfile('meowster');
    const tuning = duneTuning(`raid-${id}`, {
      ...raid.tuning,
      powertrain: Object.freeze({
        ...MONSTER_TUNING.powertrain,
        ...(raid.tuning?.powertrain || {}),
      }),
    });
    return [id, Object.freeze({
      ...base,
      id,
      name: raid.name,
      traits: Object.freeze([raid.archetype, raid.drive, raid.description]),
      mass: raid.mass,
      stability: raid.stability,
      mode: 'rally-raid',
      tuning,
      tireWidth: raid.contact.tireWidth,
      contact: Object.freeze({
        ...base.contact,
        ...raid.contact,
      }),
    })];
  }),
]));

export function getDuneVehicleProfile(id = 'meowster') {
  return PROFILE_CACHE[id] || PROFILE_CACHE.meowster;
}

function createWheelSample(layout, profile) {
  const localX = layout.side * profile.contact.trackWidth * 0.5;
  const localZ = layout.axle * profile.contact.wheelbase * 0.5;
  return {
    id: layout.id,
    wheelIndex: MONSTER_WHEEL_LAYOUT.indexOf(layout),
    side: layout.side,
    axle: layout.axle,
    sideName: layout.sideName,
    axleName: layout.axleName,
    localX,
    localZ,
    worldX: 0,
    worldZ: 0,
    previousWorldX: 0,
    previousWorldZ: 0,
    rootContactHeight: 0,
    sinkage: 0,
    rollingResistance: 0,
    longitudinalSlip: 0,
    lateralSlip: 0,
    normalLoad: 0.78,
    steerAngle: 0,
    support: {
      height: 0,
      surfaceHeight: 0,
      baseHeight: 0,
      deformation: 0,
      normal: { x: 0, y: 1, z: 0 },
      slope: 0,
      looseness: 0.65,
      compaction: 0,
      surface: 'dune-sand',
      surfaceGrip: 0.8,
      surfaceDrag: 0.5,
      unsupported: false,
      targetId: '',
      targetKind: '',
    },
    sweptContact: {
      type: 'ground-below',
      targetId: '',
      targetKind: '',
    },
  };
}

function createContactRuntime(profile) {
  const runtime = {
    profile,
    kart: null,
    surfaceField: null,
    wheels: MONSTER_WHEEL_LAYOUT.map((layout) => createWheelSample(layout, profile)),
    height: 0,
    fittedHeight: 0,
    landingHeight: 0,
    pitch: 0,
    roll: 0,
    normal: { x: 0, y: 1, z: 0 },
    surface: 'dune-sand',
    surfaceGrip: 0.8,
    surfaceDrag: 0.5,
    looseness: 0.65,
    compaction: 0,
    wheelSupport: null,
    groundHeight: 0,
    groundPitch: 0,
    groundRoll: 0,
    groundNormal: null,
    onRoad: false,
    obstacleContact: false,
    contactType: 'ground-below',
    sandResistance: 0,
    averageSinkage: 0,
  };
  runtime.wheelSupport = runtime;
  runtime.groundNormal = runtime.normal;
  runtime.sampleGround = () => {
    sampleDuneVehicleContact(runtime.kart, runtime.surfaceField, runtime);
    return runtime;
  };
  return runtime;
}

function wheelWorldPosition(kart, localX, localZ, previous, target) {
  const yaw = previous ? finite(kart.previousYaw, kart.yaw) : finite(kart.yaw);
  const centerX = previous ? finite(kart.previousX, kart.x) : finite(kart.x);
  const centerZ = previous ? finite(kart.previousZ, kart.z) : finite(kart.z);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  target.x = centerX + localX * cos + localZ * sin;
  target.z = centerZ - localX * sin + localZ * cos;
}

const _pointScratch = { x: 0, z: 0 };

/**
 * Sample all four tires from the same authority used by terrain rendering.
 * The provided runtime is mutated in place and is also the normal `stepKart`
 * contact object.
 */
export function sampleDuneVehicleContact(kart, surfaceField, runtime) {
  if (!kart || !surfaceField || !runtime?.wheels) return runtime;
  runtime.kart = kart;
  runtime.surfaceField = surfaceField;
  const profile = runtime.profile;
  const contact = profile.contact;
  let front = 0;
  let rear = 0;
  let left = 0;
  let right = 0;
  let fittedHeight = 0;
  let landingHeight = -Infinity;
  let grip = 0;
  let drag = 0;
  let looseness = 0;
  let compaction = 0;
  let resistance = 0;
  let sinkageTotal = 0;
  for (let index = 0; index < runtime.wheels.length; index += 1) {
    const sample = runtime.wheels[index];
    wheelWorldPosition(kart, sample.localX, sample.localZ, false, _pointScratch);
    sample.worldX = _pointScratch.x;
    sample.worldZ = _pointScratch.z;
    wheelWorldPosition(kart, sample.localX, sample.localZ, true, _pointScratch);
    sample.previousWorldX = _pointScratch.x;
    sample.previousWorldZ = _pointScratch.z;
    const support = surfaceField.surfaceAt(sample.worldX, sample.worldZ, sample.support);
    support.surfaceHeight = support.height;
    const wheelState = kart.wheelContacts?.[sample.id];
    const normalLoad = clamp(finite(wheelState?.load, sample.normalLoad || 0.78), 0.08, 1.58);
    const tireWidth = profile.tireWidth;
    const contactLength = contact.wheelRadius * (0.46 + normalLoad * 0.17);
    const contactArea = Math.max(0.12, tireWidth * contactLength);
    const supportFactor = 0.62 + support.compaction * 1.48;
    const rawSinkage = normalLoad * support.looseness * 0.082 / (contactArea * supportFactor);
    sample.sinkage = clamp(rawSinkage, 0.008, support.surface === 'deep-loose-sand' ? 0.13 : 0.092);
    support.height = support.surfaceHeight - sample.sinkage;
    sample.normalLoad = normalLoad;
    sample.rollingResistance = clamp(
      0.08 + support.looseness * 0.54 + sample.sinkage * 3.1 - support.compaction * 0.2,
      0.05,
      0.92,
    );
    sample.rootContactHeight = support.height;
    front += support.height * (sample.axle > 0 ? 0.5 : 0);
    rear += support.height * (sample.axle < 0 ? 0.5 : 0);
    left += support.height * (sample.side < 0 ? 0.5 : 0);
    right += support.height * (sample.side > 0 ? 0.5 : 0);
    fittedHeight += support.height * 0.25;
    grip += support.surfaceGrip * 0.25;
    // `stepKart` treats surfaceDrag as a velocity-proportional acceleration
    // coefficient. Terramechanics values above are telemetry-scale forces, so
    // convert them to the compact arcade coefficient here instead of feeding
    // raw soil resistance directly into the integrator.
    drag += (support.surfaceDrag * 0.16 + sample.rollingResistance * 0.12) * 0.25;
    looseness += support.looseness * 0.25;
    compaction += support.compaction * 0.25;
    resistance += sample.rollingResistance * 0.25;
    sinkageTotal += sample.sinkage * 0.25;
  }
  const pitch = Math.atan2(front - rear, contact.wheelbase);
  const roll = -Math.atan2(right - left, contact.trackWidth);
  for (let index = 0; index < runtime.wheels.length; index += 1) {
    const sample = runtime.wheels[index];
    sample.rootContactHeight = sample.support.height
      - sample.localZ * Math.sin(pitch)
      + sample.localX * Math.sin(roll);
    landingHeight = Math.max(landingHeight, sample.rootContactHeight);
  }
  const nx = Math.sin(roll);
  const nz = -Math.sin(pitch);
  const ny = Math.max(0.08, Math.sqrt(Math.max(0, 1 - nx * nx - nz * nz)));
  runtime.fittedHeight = fittedHeight;
  runtime.landingHeight = landingHeight;
  runtime.height = kart.grounded ? fittedHeight : landingHeight;
  runtime.pitch = pitch;
  runtime.roll = roll;
  runtime.normal.x = nx;
  runtime.normal.y = ny;
  runtime.normal.z = nz;
  runtime.surfaceGrip = grip;
  runtime.surfaceDrag = drag;
  runtime.looseness = looseness;
  runtime.compaction = compaction;
  runtime.surface = compaction > 0.56
    ? 'packed-sand'
    : looseness > 0.72 ? 'deep-loose-sand' : 'dune-sand';
  // Sand is still a supported driving surface. `stepKart` gates its
  // handbrake/drift solver on `onRoad`; marking loose sand as off-road made
  // powerslides impossible instead of merely lower-grip and higher-drag.
  runtime.onRoad = true;
  runtime.sandResistance = resistance;
  runtime.averageSinkage = sinkageTotal;
  runtime.groundHeight = runtime.height;
  runtime.groundPitch = pitch;
  runtime.groundRoll = roll;
  return runtime;
}

function updateDuneWheelStates(kart, runtime, controls, dt, events) {
  const profile = runtime.profile;
  const contact = profile.contact;
  const wheelRadius = contact.wheelRadius;
  const speed = Math.max(0, finite(kart.speed));
  const lateralRatio = clamp(finite(kart.lateralSpeed) / Math.max(3, speed), -1.6, 1.6);
  const throttle = clamp(finite(controls.throttle), -1, 1);
  const brakeAmount = throttle < 0 && kart.forwardSpeed > 0.25 ? -throttle : 0;
  const requestedForce = Math.abs(finite(kart.wheelTorque)) / Math.max(0.2, wheelRadius);
  const baseTraction = profile.tuning.powertrain.tractionLimit
    * (0.62 + runtime.compaction * 0.42 - runtime.looseness * 0.13);
  const normalizedRequested = requestedForce / Math.max(1, baseTraction * profile.tuning.powertrain.mass);
  const boostSlip = kart.boostTime > 0 ? 0.22 + runtime.looseness * 0.28 : 0;
  const driveSlip = clamp(
    Math.max(0, normalizedRequested - 0.72)
      + Math.abs(throttle) * runtime.looseness * (0.14 + Math.max(0, 1 - speed / 9) * 0.3)
      + boostSlip,
    0,
    1.65,
  );
  let frontCompression = 0;
  let rearCompression = 0;
  let leftCompression = 0;
  let rightCompression = 0;
  let groundedCount = 0;
  let compressionTotal = 0;
  let loadTotal = 0;
  let suspensionVelocity = 0;
  for (let index = 0; index < runtime.wheels.length; index += 1) {
    const sample = runtime.wheels[index];
    const state = kart.wheelContacts[sample.id];
    const gap = kart.y - sample.rootContactHeight;
    const grounded = kart.grounded && gap <= contact.suspensionTravel * 0.86 + 0.18;
    const longitudinalTransfer = finite(kart.longitudinalWeightTransfer) * sample.axle * 0.15;
    const lateralTransfer = finite(kart.lateralWeightTransfer) * sample.side * 0.13;
    const contactPush = clamp(-gap / Math.max(0.1, contact.suspensionTravel), -0.36, 0.5);
    let targetCompression = grounded
      ? clamp(contact.suspensionRest + contactPush + longitudinalTransfer + lateralTransfer, 0.035, 1)
      : 0;
    const oppositeId = sample.side < 0
      ? (sample.axle > 0 ? 'rightFront' : 'rightRear')
      : (sample.axle > 0 ? 'leftFront' : 'leftRear');
    const oppositeCompression = finite(kart.wheelContacts[oppositeId]?.compression, targetCompression);
    targetCompression = clamp(targetCompression + (oppositeCompression - targetCompression) * 0.08, 0, 1);
    const springAcceleration = (targetCompression - finite(state.compression)) * contact.contactSpring
      - finite(state.velocity) * contact.contactDamping;
    const bumpStop = state.compression > 0.86
      ? (state.compression - 0.86) * 48
      : 0;
    state.velocity = clamp(finite(state.velocity) + (springAcceleration - bumpStop) * dt, -4.8, 4.8);
    state.compression = clamp(finite(state.compression) + state.velocity * dt, 0, 1);
    const springForce = contact.contactSpring * state.compression;
    const damperForce = contact.contactDamping * state.velocity;
    state.load = grounded ? clamp((springForce - damperForce) / Math.max(1, contact.contactSpring * 0.7), 0, 1.58) : 0;
    state.grounded = grounded;
    state.x = sample.localX;
    state.z = sample.localZ;
    state.worldX = sample.worldX;
    state.worldZ = sample.worldZ;
    state.height = sample.support.height;
    state.surface = sample.support.surface;
    state.contactSurface = sample.support.surface;
    state.contactType = grounded ? 'sand-contact' : 'unsupported-air';
    state.contactTarget = '';
    state.targetId = '';
    state.targetKind = '';
    state.obstacleContact = false;
    state.sinkage = sample.sinkage;
    state.rollingResistance = sample.rollingResistance;
    state.longitudinalSlip = grounded ? driveSlip : 0;
    state.lateralSlip = grounded ? lateralRatio : 0;
    state.normalLoad = state.load;
    state.steerAngle = sample.axle > 0 ? finite(kart.appliedSteering) * 0.48 : 0;
    state.visualOffset = grounded
      ? (sample.support.height - runtime.fittedHeight) * 0.42
        - (1 - state.compression) * contact.suspensionTravel * 0.18
      : -contact.suspensionTravel * 0.35;
    sample.normalLoad = state.load;
    sample.longitudinalSlip = state.longitudinalSlip;
    sample.lateralSlip = state.lateralSlip;
    sample.steerAngle = state.steerAngle;
    if (grounded) groundedCount += 1;
    if (sample.axle > 0) frontCompression += state.compression * 0.5;
    else rearCompression += state.compression * 0.5;
    if (sample.side < 0) leftCompression += state.compression * 0.5;
    else rightCompression += state.compression * 0.5;
    compressionTotal += state.compression * 0.25;
    loadTotal += state.load * 0.25;
    suspensionVelocity += finite(state.velocity) * 0.25;
  }
  kart.groundedWheelCount = groundedCount;
  kart.suspensionCompression = compressionTotal;
  kart.suspensionVelocity = suspensionVelocity;
  const targetPitch = -runtime.pitch
    + finite(kart.bodyPitch) * 0.86
    + (rearCompression - frontCompression) * 0.12;
  const targetRoll = -runtime.roll
    + finite(kart.bodyRoll) * 0.84
    + (leftCompression - rightCompression) * 0.1;
  const previousPitch = finite(kart.contactPitch, targetPitch);
  const measuredPitchVelocity = clamp((targetPitch - previousPitch) / Math.max(1e-5, dt), -4.8, 4.8);
  kart.contactPitchVelocity = approach(finite(kart.contactPitchVelocity), measuredPitchVelocity, 10.5, dt);
  // The assist only damps pathological near-ground rearward impulses. It does
  // not act in free flight, so deliberate jump rotation remains available.
  const nearGround = groundedCount >= 2 && kart.y - runtime.landingHeight < 0.42;
  const excessiveRearward = nearGround && kart.contactPitchVelocity < -1.22;
  kart.antiBackflipTorque = excessiveRearward
    ? clamp((-kart.contactPitchVelocity - 1.22) * 4.8, 0, 7.2)
    : 0;
  if (kart.antiBackflipTorque > 0) {
    kart.contactPitchVelocity = Math.min(
      -1.22,
      kart.contactPitchVelocity + kart.antiBackflipTorque * dt,
    );
  }
  kart.contactPitch = previousPitch + kart.contactPitchVelocity * dt;
  kart.contactRoll = approach(finite(kart.contactRoll, targetRoll), targetRoll, 10.5, dt);
  kart.wheelSlip = driveSlip;
  kart.wheelRpm = speed / (TWO_PI * wheelRadius) * 60 * (1 + driveSlip * 0.72);
  kart.sandResistance = runtime.sandResistance * speed;
  kart.sandSinkage = runtime.averageSinkage;
  kart.deliveredWheelForce = Math.min(requestedForce, baseTraction * profile.tuning.powertrain.mass);
  kart.requestedDriveForce = requestedForce;
  kart.normalLoad = loadTotal;
  events.groundedWheels = groundedCount;
  events.sandResistance = kart.sandResistance;
  events.sinkage = kart.sandSinkage;
  events.wheelSlip = kart.wheelSlip;
  events.brakeAmount = brakeAmount;
}

function stampWheelBrushes(kart, runtime, deformation, controls, dt) {
  const buffer = runtime.brushBuffer;
  const brush = runtime.brushScratch;
  buffer.clear();
  const forwardX = Math.sin(kart.yaw);
  const forwardZ = Math.cos(kart.yaw);
  const torqueScale = clamp(
    Math.abs(finite(kart.wheelTorque)) / Math.max(1, runtime.profile.tuning.powertrain.peakTorque * 20),
    0,
    2,
  );
  const brakeAmount = finite(controls.throttle) < 0 && kart.forwardSpeed > 0.25
    ? -finite(controls.throttle)
    : 0;
  for (let index = 0; index < runtime.wheels.length; index += 1) {
    const sample = runtime.wheels[index];
    const state = kart.wheelContacts[sample.id];
    if (!state.grounded || !(state.load > 0.02)) continue;
    brush.wheelIndex = index;
    brush.worldX = sample.worldX;
    brush.worldZ = sample.worldZ;
    brush.normalX = sample.support.normal.x;
    brush.normalY = sample.support.normal.y;
    brush.normalZ = sample.support.normal.z;
    brush.travelX = sample.worldX - sample.previousWorldX;
    brush.travelZ = sample.worldZ - sample.previousWorldZ;
    brush.forwardX = forwardX;
    brush.forwardZ = forwardZ;
    brush.tireRadius = runtime.profile.contact.wheelRadius;
    brush.tireWidth = runtime.profile.tireWidth;
    brush.normalLoad = state.load;
    brush.longitudinalSlip = state.longitudinalSlip;
    brush.lateralSlip = state.lateralSlip;
    brush.driveTorque = torqueScale;
    brush.brakeAmount = brakeAmount;
    brush.surfaceLooseness = sample.support.looseness;
    buffer.push(brush);
  }
  deformation.applyBrushBuffer(buffer, dt);
  return buffer.count;
}

export class DuneVehicleRuntime {
  constructor({
    vehicleId = 'meowster',
    quality = 'medium',
  } = {}) {
    this.vehicleId = getDuneVehicleProfile(vehicleId).id;
    this.profile = getDuneVehicleProfile(this.vehicleId);
    this.contact = createContactRuntime(this.profile);
    this.brushBuffer = createDuneDeformationBrushBuffer(quality);
    this.contact.brushBuffer = this.brushBuffer;
    this.contact.brushScratch = {
      wheelIndex: 0,
      worldX: 0,
      worldZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      travelX: 0,
      travelZ: 1,
      forwardX: 0,
      forwardZ: 1,
      tireRadius: this.profile.contact.wheelRadius,
      tireWidth: this.profile.tireWidth,
      normalLoad: 0,
      longitudinalSlip: 0,
      lateralSlip: 0,
      driveTorque: 0,
      brakeAmount: 0,
      surfaceLooseness: 0.65,
    };
    this.events = {};
    this.telemetry = {
      speed: 0,
      forwardVelocity: 0,
      engineRpm: 0,
      requestedDriveForce: 0,
      deliveredWheelForce: 0,
      normalLoad: 0,
      chassisPitchVelocity: 0,
      chassisRoll: 0,
      steeringInput: 0,
      wheelAngle: 0,
      groundedWheels: 4,
      sandResistance: 0,
      brushStrength: 0,
      sinkage: 0,
      wheelSlip: 0,
    };
  }
}

export function createDuneVehicleState({
  vehicleId = 'meowster',
  x = 0,
  y = 0,
  z = 0,
  yaw = 0,
} = {}) {
  const profile = getDuneVehicleProfile(vehicleId);
  const kart = createKartState({
    x,
    y,
    z,
    previousX: x,
    previousZ: z,
    previousYaw: yaw,
    yaw,
    groundHeight: y,
    currentSurface: 'dune-sand',
  });
  initializeMonsterVehiclePhysics(kart, profile);
  return kart;
}

/**
 * Fixed-step Dune Run controller. Shared kart integration owns drivetrain,
 * braking, steering, air control and landing; this layer owns four-wheel sand
 * contact, bounded sinkage and deformation brushes.
 */
export function stepDuneVehicle(
  kart,
  controls,
  surfaceField,
  deformation,
  runtime,
  dt,
) {
  if (!kart || !runtime || !(dt > 0)) return runtime?.events || {};
  deformation.recenter(kart.x, kart.z);
  kart.previousX = kart.x;
  kart.previousZ = kart.z;
  kart.previousYaw = kart.yaw;
  sampleDuneVehicleContact(kart, surfaceField, runtime.contact);
  if (controls.boost && !kart.overheated) {
    const starting = !(kart.boostTime > 0);
    kart.boostTime = Math.max(kart.boostTime || 0, 0.12);
    kart.boostLevel = Math.max(kart.boostLevel || 0, 2);
    runtime.contact.boostHeldStart = starting;
  } else {
    runtime.contact.boostHeldStart = false;
  }

  // A procedural crest has no authored ramp object, but its geometry still
  // needs to release the suspension. Compare the approach and departure
  // tangents along the actual heading and feed a bounded ramp contract into
  // the shared integrator. The thresholds reject ordinary ripples.
  const forwardX = Math.sin(kart.yaw);
  const forwardZ = Math.cos(kart.yaw);
  const currentHeight = surfaceField.heightAt(kart.x, kart.z);
  const behindHeight = surfaceField.heightAt(
    kart.x - forwardX * 1.35,
    kart.z - forwardZ * 1.35,
  );
  const aheadHeight = surfaceField.heightAt(
    kart.x + forwardX * 2.7,
    kart.z + forwardZ * 2.7,
  );
  const approachSlope = (currentHeight - behindHeight) / 1.35;
  const departureSlope = (aheadHeight - currentHeight) / 2.7;
  const crestRelease = kart.grounded
    && kart.forwardSpeed > 10.5
    && approachSlope > 0.105
    && departureSlope < approachSlope - 0.17;
  runtime.contact.ramp = crestRelease;
  runtime.contact.preserveRampSpeed = crestRelease;
  runtime.contact.rampDirection = runtime.contact.rampDirection || { x: 0, z: 1 };
  runtime.contact.rampDirection.x = forwardX;
  runtime.contact.rampDirection.z = forwardZ;
  runtime.contact.takeoffSlope = crestRelease ? clamp(approachSlope, 0.08, 0.5) : 0;
  runtime.contact.rampVelocity = 0;
  runtime.contact.suspensionRebound = crestRelease
    ? clamp(Math.max(0, kart.suspensionVelocity || 0) * 0.32, 0, 1.6)
    : 0;
  const events = stepKart(
    kart,
    controls,
    runtime.contact,
    dt,
    runtime.profile.tuning,
    runtime.events,
  );
  if (runtime.contact.boostHeldStart && kart.boostTime > 0) {
    events.boostStarted = true;
    events.boostLevel = kart.boostLevel;
  }
  if (!surfaceField.contains(kart.x, kart.z, 2)) {
    kart.x = clamp(kart.x, surfaceField.minX + 2, surfaceField.maxX - 2);
    kart.z = clamp(kart.z, surfaceField.minZ + 2, surfaceField.maxZ - 2);
    kart.yaw = normalizeAngle(kart.yaw + Math.PI);
    kart.vx *= -0.35;
    kart.vz *= -0.35;
  }
  sampleDuneVehicleContact(kart, surfaceField, runtime.contact);
  updateDuneWheelStates(kart, runtime.contact, controls, dt, events);
  const appliedBrushes = stampWheelBrushes(kart, runtime.contact, deformation, controls, dt);
  deformation.step(dt, 0.42);
  const telemetry = runtime.telemetry;
  telemetry.speed = kart.speed;
  telemetry.forwardVelocity = kart.forwardSpeed;
  telemetry.engineRpm = kart.engineRpm;
  telemetry.requestedDriveForce = kart.requestedDriveForce;
  telemetry.deliveredWheelForce = kart.deliveredWheelForce;
  telemetry.normalLoad = kart.normalLoad;
  telemetry.chassisPitchVelocity = kart.contactPitchVelocity;
  telemetry.chassisRoll = kart.contactRoll;
  telemetry.steeringInput = kart.inputSteering;
  telemetry.wheelAngle = kart.appliedSteering * 0.48;
  telemetry.groundedWheels = kart.groundedWheelCount;
  telemetry.sandResistance = kart.sandResistance;
  telemetry.brushStrength = appliedBrushes;
  telemetry.sinkage = kart.sandSinkage;
  telemetry.wheelSlip = kart.wheelSlip;
  return events;
}

export function getDuneVehicleTelemetry(runtime) {
  return runtime?.telemetry || null;
}
