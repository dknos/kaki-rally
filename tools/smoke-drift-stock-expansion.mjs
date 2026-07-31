import assert from 'node:assert/strict';

import {
  DRIFT_CAR_ORDER,
  DRIFT_CAR_PROFILES,
  DRIFT_LAYOUT_ORDER,
  DRIFT_LAYOUTS,
  createDriftJudgeState,
  driftDisciplineSnapshot,
  finalizeDriftJudge,
  noteDriftCollision,
  stepDriftJudge,
} from '../src/racing/drift/driftAttack.js';
import { createKartState, stepKart } from '../src/racing/physics.js';
import { getRallyHandlingProfile } from '../src/racing/handlingProfiles.js';
import {
  RACE_MODES,
  STOCK_VARIANTS,
  getCourseDefinition,
  sampleTrackBank,
} from '../src/racing/tracks.js';

assert.equal(RACE_MODES.drift.duration, 90, 'Drift Attack timed run contract changed');
assert.deepEqual([...DRIFT_CAR_ORDER], ['needle', 'comet', 'monarch']);
assert.deepEqual([...DRIFT_LAYOUT_ORDER], ['practice', 'judged', 'wallrun']);
assert.ok(new Set(DRIFT_LAYOUT_ORDER.map((id) => DRIFT_LAYOUTS[id].trackWidth)).size === 3, 'drift layouts need distinct venue widths');

const cars = DRIFT_CAR_ORDER.map((id) => DRIFT_CAR_PROFILES[id]);
assert.ok(new Set(cars.map((car) => car.tuning.mass)).size === 3, 'drift cars collapsed to one mass');
assert.ok(new Set(cars.map((car) => car.tuning.wheelbase)).size === 3, 'drift cars collapsed to one wheelbase');
assert.ok(new Set(cars.map((car) => car.tuning.powertrain.peakTorque)).size === 3, 'drift cars collapsed to one powertrain');
assert.ok(new Set(DRIFT_CAR_ORDER.map((id) => getRallyHandlingProfile('drift', id).id)).size === 3, 'drift handling profiles are not per-car');

const judge = createDriftJudgeState('judged');
const judgedLayout = DRIFT_LAYOUTS.judged;
const physics = {
  grounded: true,
  drifting: true,
  speed: 20.5,
  slipAngle: 0.43,
  nearestIndex: Math.round(0.06 * 256),
};
const contact = { lateralOffset: 0 };
stepDriftJudge(judge, { dt: 1 / 60, physics, contact, layout: judgedLayout, sampleCount: 256 });
assert.equal(judge.initiations, 1, 'initiation zone did not reward a decisive entry');
physics.nearestIndex = Math.round(0.19 * 256);
contact.lateralOffset = 2.4;
for (let i = 0; i < 12; i++) stepDriftJudge(judge, { dt: 1 / 60, physics, contact, layout: judgedLayout, sampleCount: 256 });
assert.ok(judge.score > 0, 'judge did not award real drift score');
assert.ok(judge.zonesHit >= 1, 'clipping-point coverage did not register');
physics.nearestIndex = Math.round(0.61 * 256);
contact.lateralOffset = 0;
stepDriftJudge(judge, { dt: 1 / 60, physics, contact, layout: judgedLayout, sampleCount: 256 });
assert.ok(judge.transitions >= 1, 'transition zone did not register');
const beforeCollisionCombo = judge.combo;
noteDriftCollision(judge);
assert.equal(judge.combo, 1, 'drift collision did not reset combo');
assert.ok(beforeCollisionCombo >= 1, 'judge combo never initialized');
const breakdown = finalizeDriftJudge(judge, judgedLayout);
assert.equal(breakdown.zonesTotal, judgedLayout.zones.length);
assert.ok(['S', 'A', 'B', 'C', 'D'].includes(breakdown.grade));
assert.equal(driftDisciplineSnapshot(judge).breakdown.grade, breakdown.grade);

const profiles = DRIFT_CAR_ORDER.map((id) => getRallyHandlingProfile('drift', id));
const driveStates = profiles.map(() => createKartState({ grounded: true }));
for (let i = 0; i < driveStates.length; i++) {
  stepKart(
    driveStates[i],
    { throttle: 1, steer: 0.7, drift: true, handbrake: false },
    { onRoad: true, surfaceGrip: 1, surfaceDrag: 0 },
    1 / 30,
    profiles[i],
  );
}
assert.ok(new Set(driveStates.map((state) => state.speed.toFixed(4))).size > 1, 'drift profiles produce identical acceleration');

const concrete = getCourseDefinition('forest', 'stock', { stockVariant: 'concrete' });
const dirt = getCourseDefinition('forest', 'stock', { stockVariant: 'dirt' });
assert.equal(concrete.stockVariant, 'concrete');
assert.equal(dirt.stockVariant, 'dirt');
assert.notEqual(concrete.surfaceId, dirt.surfaceId);
assert.notEqual(concrete.surfaceGrip, dirt.surfaceGrip);
assert.ok(Math.abs(sampleTrackBank(concrete, 0)) > Math.abs(sampleTrackBank(concrete, 0.25)), 'concrete corner banking is not stronger than its straight');
assert.ok(Math.abs(sampleTrackBank(dirt, 0)) > Math.abs(sampleTrackBank(dirt, 0.25)), 'clay corner banking is not stronger than its straight');
assert.ok(Math.abs(sampleTrackBank(concrete, 0)) > Math.abs(sampleTrackBank(dirt, 0)), 'clay should have a visibly lower bank profile');
assert.equal(sampleTrackBank(concrete, 0.63), sampleTrackBank(concrete, 0.63), 'bank sampling is not deterministic');
assert.equal(concrete.venueId, 'kaki-thunderbowl');
assert.equal(dirt.venueId, concrete.venueId);

console.log('Drift Attack fleet/judge and Thunderbowl bank/surface smoke passed');
