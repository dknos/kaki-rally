import assert from 'node:assert/strict';
import {
  DuneDeformationField,
  DuneSurfaceField,
} from '../src/racing/dunes/duneDeformation.js';
import { generateDuneHeightfield } from '../src/racing/dunes/duneHeightfield.js';
import {
  DuneVehicleRuntime,
  createDuneVehicleState,
  getDuneVehicleProfile,
  stepDuneVehicle,
} from '../src/racing/dunes/duneVehiclePhysics.js';

const heightfield = await generateDuneHeightfield('whiskerwind', { width: 257, worker: false });

function makeRig(x = 0, z = 0, yaw = 0) {
  const deformation = new DuneDeformationField({
    worldSize: heightfield.worldSize,
    worldMinX: heightfield.minX,
    worldMinZ: heightfield.minZ,
    quality: 'low',
  });
  const surface = new DuneSurfaceField(heightfield, deformation);
  const kart = createDuneVehicleState({
    x,
    z,
    yaw,
    y: surface.heightAt(x, z),
  });
  const runtime = new DuneVehicleRuntime({ quality: 'low' });
  return { deformation, surface, kart, runtime };
}

function run(rig, controls, seconds, hz = 120) {
  for (let frame = 0; frame < seconds * hz; frame += 1) {
    stepDuneVehicle(
      rig.kart,
      controls,
      rig.surface,
      rig.deformation,
      rig.runtime,
      1 / hz,
    );
  }
}

const launch = makeRig();
run(launch, { throttle: 1, steer: 0 }, 4);
assert.ok(launch.kart.speed > 18, `dune truck remains underpowered: ${launch.kart.speed}`);
assert.ok(launch.kart.engineRpm >= getDuneVehicleProfile().tuning.powertrain.idleRpm,
  'dune drivetrain did not expose RPM');
assert.ok(launch.kart.requestedDriveForce > 0
  && launch.kart.deliveredWheelForce > 0
  && launch.kart.deliveredWheelForce <= launch.kart.requestedDriveForce,
  'dune drivetrain force telemetry is inconsistent');
assert.equal(launch.kart.groundedWheelCount, 4, 'flat dune launch lost tire contacts');
assert.ok(launch.kart.sandSinkage >= 0.008 && launch.kart.sandSinkage <= 0.13,
  `sand sinkage escaped bounds: ${launch.kart.sandSinkage}`);
assert.ok(launch.deformation.appliedBrushes > 100, 'four tires did not write deformation brushes');

const left = makeRig();
const right = makeRig();
run(left, { throttle: 0.8, steer: 0.6 }, 0.8);
run(right, { throttle: 0.8, steer: -0.6 }, 0.8);
assert.ok(left.kart.yaw > 0.12 && left.kart.x > 0.1,
  'positive physical steering did not yaw toward the expected vehicle-left convention');
assert.ok(right.kart.yaw < -0.12 && right.kart.x < -0.1,
  'negative physical steering did not yaw toward the expected vehicle-right convention');
assert.ok(left.kart.wheelContacts.leftFront.steerAngle > 0
  && left.kart.wheelContacts.leftRear.steerAngle === 0,
  'visual front-wheel steering disagrees with physical steering');

const braking = makeRig();
braking.kart.vz = 12;
braking.kart.speed = 12;
braking.kart.forwardSpeed = 12;
stepDuneVehicle(
  braking.kart,
  { throttle: -1, steer: 0 },
  braking.surface,
  braking.deformation,
  braking.runtime,
  0.25,
);
assert.ok(braking.kart.forwardSpeed >= 0, 'braking crossed directly through neutral into reverse');
run(braking, { throttle: -1, steer: 0 }, 1);
assert.ok(braking.kart.forwardSpeed < 0, 'held reverse never engaged after braking');
assert.ok(Math.abs(braking.kart.forwardSpeed) < getDuneVehicleProfile().tuning.reverseSpeed + 0.01,
  'reverse speed cap leaked');

const loose = makeRig();
const packed = makeRig();
packed.deformation.coarseCompaction.fill(255);
packed.deformation.recenter(0, 0, true);
run(loose, { throttle: 1, steer: 0 }, 3);
run(packed, { throttle: 1, steer: 0 }, 3);
assert.ok(packed.kart.speed > loose.kart.speed + 0.35,
  'packed sand does not carry momentum better than loose sand');
assert.ok(loose.kart.sandSinkage > packed.kart.sandSinkage,
  'compaction did not reduce tire sinkage');

const stability = makeRig();
stability.kart.contactPitchVelocity = -4.2;
run(stability, { throttle: 0.8, steer: 0 }, 0.25);
assert.ok(stability.kart.contactPitchVelocity > -3,
  'near-ground pathological rearward pitch impulse was not damped');
assert.ok(stability.kart.antiBackflipTorque <= 7.2,
  'anti-backflip correction exceeded its torque bound');
stability.kart.grounded = false;
stability.kart.y += 3;
stability.kart.contactPitchVelocity = -2.4;
run(stability, { throttle: 1, steer: 0, airPitch: 1 }, 0.1);
assert.equal(stability.kart.antiBackflipTorque, 0,
  'grounded stability assist remained active in free flight');

const hz60 = makeRig();
const hz120 = makeRig();
run(hz60, { throttle: 0.75, steer: 0.18 }, 2, 60);
run(hz120, { throttle: 0.75, steer: 0.18 }, 2, 120);
assert.ok(Math.abs(hz60.kart.speed - hz120.kart.speed) < 0.65,
  'dune handling drifted materially between 60 and 120 Hz');
assert.ok(Math.abs(hz60.kart.contactRoll - hz120.kart.contactRoll) < 0.1,
  'dune suspension attitude drifted between 60 and 120 Hz');

console.log('Dune four-contact soft-sand vehicle physics passed');
