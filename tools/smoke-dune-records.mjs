import assert from 'node:assert/strict';
import { DUNE_EVENTS } from '../src/racing/dunes/duneEvents.js';
import {
  createDuneGhostPlayback,
  createDuneRecordRun,
  duneRecordKey,
  finishDuneRecordRun,
  readDuneRecords,
  sampleDuneGhost,
  stepDuneRecordRun,
} from '../src/racing/dunes/duneRecords.js';

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

const storage = new FakeStorage();
const kart = {
  x: 0,
  y: 2,
  z: 0,
  yaw: Math.PI - 0.02,
  bodyPitch: 0.03,
  bodyRoll: -0.02,
};
const run = createDuneRecordRun({ eventId: 'mirage', vehicleId: 'meowster' });
for (let index = 0; index < 160; index += 1) {
  kart.x = index * 0.42;
  kart.z = Math.sin(index * 0.05) * 2;
  kart.yaw = index < 80 ? Math.PI - 0.02 : -Math.PI + 0.02;
  stepDuneRecordRun(run, kart, 1 / 20, { active: true });
}
assert.equal(run.sampleCount, 80);
const firstResult = finishDuneRecordRun(run, DUNE_EVENTS.mirage, storage);
assert.equal(firstResult.improved, true);
assert.equal(firstResult.medal, 'S');
assert.equal(readDuneRecords(storage).records[duneRecordKey('mirage', 'meowster')].ghost.length, 80);

const slower = createDuneRecordRun({
  eventId: 'mirage',
  vehicleId: 'meowster',
  previousRecord: firstResult.record,
});
for (let index = 0; index < 200; index += 1) stepDuneRecordRun(slower, kart, 1 / 20);
const slowerResult = finishDuneRecordRun(slower, DUNE_EVENTS.mirage, storage);
assert.equal(slowerResult.improved, false, 'a slower run replaced the personal best');

const playback = createDuneGhostPlayback(firstResult.record);
assert.equal(playback.visible, true);
const interpolated = sampleDuneGhost(playback, 4.05);
assert.ok(Number.isFinite(interpolated.x));
assert.ok(Math.abs(interpolated.yaw) > 3, 'ghost yaw crossed the long way around ±PI');

const freeride = createDuneRecordRun({ eventId: 'litterbox', vehicleId: 'tipsy' });
stepDuneRecordRun(freeride, kart, 1, { score: 18_500 });
const scoreResult = finishDuneRecordRun(freeride, DUNE_EVENTS.litterbox, storage);
assert.equal(scoreResult.time, null);
assert.equal(scoreResult.score, 18_500);
assert.equal(scoreResult.medal, 'S');

console.log('Dune records, medals, and deterministic ghost playback passed');
