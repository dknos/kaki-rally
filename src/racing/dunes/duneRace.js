import { clamp } from '../physics.js';
import {
  buildDuneCheckpoints,
  nearestDuneRouteSample,
  wrappedDuneProgressDelta,
} from './duneEvents.js';

function checkpointDistance(checkpoint, kart) {
  return Math.hypot(kart.x - checkpoint.x, kart.z - checkpoint.z);
}

export function createDuneRaceState(eventDefinition, routeRuntime) {
  const checkpoints = buildDuneCheckpoints(eventDefinition, routeRuntime);
  return {
    eventId: eventDefinition.id,
    routeType: eventDefinition.routeType,
    checkpoints,
    nextCheckpoint: checkpoints.length > 1 ? 1 : 0,
    checkpointCount: 0,
    completedLaps: 0,
    targetLaps: eventDefinition.laps,
    routeIndex: 0,
    routeProgress: 0,
    previousProgress: 0,
    unwrappedProgress: 0,
    offRouteDistance: 0,
    wrongWayTime: 0,
    finished: false,
    finishTime: null,
    score: 0,
    styleCombo: 1,
    styleTime: 0,
    lastEvent: '',
    lastEventTime: 0,
    recoveryCount: 0,
  };
}

function awardFreerideStyle(race, kart, dt) {
  race.styleTime = Math.max(0, race.styleTime - dt);
  race.lastEventTime = Math.max(0, race.lastEventTime - dt);
  if (race.styleTime <= 0) race.styleCombo = 1;
  let base = 0;
  let label = '';
  if (!kart.grounded && kart.airTime > 0.25) {
    base = dt * (45 + kart.airTime * 18);
    label = 'DUNE FLIGHT';
  } else if (kart.grounded && Math.abs(kart.lateralSpeed) > 2.8 && kart.speed > 9) {
    base = dt * kart.speed * (4 + Math.abs(kart.lateralSpeed) * 0.7);
    label = 'SAND SLIDE';
  } else if (kart.grounded && kart.groundPitch > 0.28 && kart.forwardSpeed > 5) {
    base = dt * kart.forwardSpeed * 3.4;
    label = 'HILL CLIMB';
  }
  if (!(base > 0)) return 0;
  race.styleCombo = race.styleTime > 0 ? clamp(race.styleCombo + dt * 0.22, 1, 6) : 1;
  race.styleTime = 2.8;
  const points = base * race.styleCombo;
  race.score += points;
  if (race.lastEventTime <= 0 || label !== race.lastEvent) {
    race.lastEvent = label;
    race.lastEventTime = 1.1;
  }
  return points;
}

export function stepDuneRace(race, eventDefinition, routeRuntime, kart, dt) {
  if (!race || race.finished || !(dt > 0)) return race;
  const nearest = nearestDuneRouteSample(routeRuntime, kart.x, kart.z, race.routeIndex, 44);
  race.routeIndex = nearest.index;
  race.previousProgress = race.routeProgress;
  race.routeProgress = nearest.progress;
  race.offRouteDistance = nearest.distance;
  const progressDelta = routeRuntime.loop
    ? wrappedDuneProgressDelta(race.previousProgress, race.routeProgress)
    : race.routeProgress - race.previousProgress;
  race.unwrappedProgress += progressDelta;
  race.wrongWayTime = progressDelta < -0.0004 && kart.speed > 4
    ? race.wrongWayTime + dt
    : Math.max(0, race.wrongWayTime - dt * 2);

  if (eventDefinition.routeType === 'freeride') {
    awardFreerideStyle(race, kart, dt);
    return race;
  }
  const checkpoint = race.checkpoints[race.nextCheckpoint];
  if (!checkpoint || checkpointDistance(checkpoint, kart) > checkpoint.width * 0.72 + 2.4) return race;
  race.checkpointCount += 1;
  race.lastEvent = checkpoint.finish ? 'FINISH GATE' : `GATE ${checkpoint.index}`;
  race.lastEventTime = 1;
  if (eventDefinition.routeType === 'circuit') {
    if (race.nextCheckpoint === 0) {
      race.completedLaps += 1;
      if (race.completedLaps >= race.targetLaps) {
        race.finished = true;
        return race;
      }
      race.nextCheckpoint = 1;
    } else if (race.nextCheckpoint >= race.checkpoints.length - 1) {
      race.nextCheckpoint = 0;
    } else {
      race.nextCheckpoint += 1;
    }
  } else if (checkpoint.finish || race.nextCheckpoint >= race.checkpoints.length - 1) {
    race.completedLaps = 1;
    race.finished = true;
  } else {
    race.nextCheckpoint += 1;
  }
  return race;
}

export function recoverDuneRace(race, kart, surfaceField, routeRuntime) {
  const pose = surfaceField.findSafeRecoveryPose(
    kart,
    race.routeProgress,
    routeRuntime,
    {},
  );
  kart.x = pose.x;
  kart.z = pose.z;
  kart.y = pose.y;
  kart.yaw = pose.yaw;
  kart.previousX = pose.x;
  kart.previousZ = pose.z;
  kart.previousYaw = pose.yaw;
  kart.vx = 0;
  kart.vz = 0;
  kart.vy = 0;
  kart.speed = 0;
  kart.forwardSpeed = 0;
  kart.grounded = true;
  kart.airTime = 0;
  kart.airPitch = 0;
  kart.airRoll = 0;
  kart.bodyPitch = 0;
  kart.bodyRoll = 0;
  kart.contactPitchVelocity = 0;
  kart.recoveryCooldown = 1;
  race.recoveryCount += 1;
  return pose;
}
