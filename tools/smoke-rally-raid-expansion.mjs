import assert from 'node:assert/strict';
import {
  DUNE_EVENTS,
  DUNE_EVENT_ORDER,
} from '../src/racing/dunes/duneEvents.js';
import {
  getDuneVehicleProfile,
} from '../src/racing/dunes/duneVehiclePhysics.js';
import {
  RALLY_RAID_EXPEDITION,
  RALLY_RAID_STAGE_ORDER,
  RALLY_RAID_VEHICLE_ORDER,
  ROADBOOK_ASSISTS,
  createRoadbookState,
  roadbookSnapshot,
  stepRoadbook,
} from '../src/racing/dunes/duneRallyRaid.js';

assert.deepEqual(RALLY_RAID_STAGE_ORDER, [
  'raid-prologue',
  'raid-wadi-crossing',
  'raid-saltline',
  'raid-night-ridge',
]);
assert.deepEqual(RALLY_RAID_EXPEDITION.stages, RALLY_RAID_STAGE_ORDER);
assert.equal(RALLY_RAID_VEHICLE_ORDER.length, 3);
assert.equal(Object.keys(ROADBOOK_ASSISTS).length, 3);
for (const eventId of RALLY_RAID_STAGE_ORDER) {
  const event = DUNE_EVENTS[eventId];
  assert.equal(event.isRallyRaid, true, `${eventId} is not marked Rally Raid`);
  assert.ok(event.route.length >= 10, `${eventId} lacks authored route points`);
  assert.ok(event.routeProfile.stamps.length >= 7, `${eventId} lacks authored rhythm stamps`);
  assert.ok(event.roadbook.notes.length >= 5, `${eventId} lacks roadbook notes`);
  assert.ok(DUNE_EVENT_ORDER.includes(eventId), `${eventId} is not reachable through Dune event order`);
}

const profiles = RALLY_RAID_VEHICLE_ORDER.map((id) => getDuneVehicleProfile(id));
assert.ok(new Set(profiles.map((profile) => profile.name)).size === 3, 'raid vehicle names collapsed');
assert.ok(new Set(profiles.map((profile) => profile.tuning.maxSpeed)).size === 3, 'raid vehicle speed tuning collapsed');
assert.ok(new Set(profiles.map((profile) => profile.contact.wheelbase)).size === 3, 'raid vehicle wheelbases collapsed');
assert.ok(profiles.find((profile) => profile.id === 'truck').tuning.powertrain.mass > 5000, 'rally truck mass was not preserved');
assert.ok(profiles.find((profile) => profile.id === 'buggy').tuning.powertrain.mass < 1500, 'buggy mass was not preserved');

const routeRuntime = {
  samples: Array.from({ length: 101 }, (_, index) => ({
    x: index * 4,
    z: 0,
    yaw: 0,
    progress: index / 100,
  })),
};
const event = DUNE_EVENTS['raid-prologue'];
const clean = createRoadbookState(event, routeRuntime, 'navigator');
stepRoadbook(clean, event, routeRuntime, { x: 40, z: 0, speed: 8 }, { routeProgress: 0.1 }, 1 / 60);
assert.equal(clean.validated, 1, 'roadbook failed to validate a clean waypoint');
assert.equal(clean.penaltySeconds, 0, 'clean waypoint added a penalty');
const missed = createRoadbookState(event, routeRuntime, 'rally');
stepRoadbook(missed, event, routeRuntime, { x: 260, z: 80, speed: 8 }, { routeProgress: 0.42 }, 1 / 60);
assert.ok(missed.missed > 0, 'roadbook did not detect a missed waypoint');
assert.ok(missed.penaltySeconds >= 8, 'missed waypoint did not add a bounded penalty');
const snapshot = roadbookSnapshot(missed, { routeProgress: 0.42 });
assert.equal(snapshot.assist, 'rally');
assert.ok(snapshot.next && snapshot.next.instruction, 'roadbook snapshot lost the next instruction');

console.log('Kaki Rally Raid fleet, authored stages, roadbook, and penalties passed');
