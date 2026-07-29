import assert from 'node:assert/strict';
import {
  DuneHeightfield,
  buildDuneHeightfieldData,
  generateDuneHeightfield,
} from '../src/racing/dunes/duneHeightfield.js';
import {
  DUNE_EVENT_ORDER,
  buildDuneCheckpoints,
  getDuneEvent,
  sampleDuneRoute,
} from '../src/racing/dunes/duneEvents.js';

function routeFlowMetrics(field, route) {
  const heights = route.samples.map((sample) => field.heightAt(sample.x, sample.z));
  const grades = heights.slice(1).map((height, index) => {
    const current = route.samples[index];
    const next = route.samples[index + 1];
    const distance = Math.max(0.01, Math.hypot(next.x - current.x, next.z - current.z));
    return Math.abs((height - heights[index]) / distance);
  });
  let prominentCrests = 0;
  for (let index = 3; index < heights.length - 3; index += 1) {
    if (heights[index] < heights[index - 1] || heights[index] <= heights[index + 1]) continue;
    const left = Math.min(...heights.slice(Math.max(0, index - 7), index));
    const right = Math.min(...heights.slice(index + 1, Math.min(heights.length, index + 8)));
    if (heights[index] - Math.max(left, right) > 0.45) prominentCrests += 1;
  }
  return {
    maximumGrade: Math.max(...grades),
    prominentCrests,
  };
}

for (const eventId of DUNE_EVENT_ORDER) {
  const definition = getDuneEvent(eventId);
  const first = new DuneHeightfield(buildDuneHeightfieldData(eventId, { width: 129 }));
  const second = await generateDuneHeightfield(eventId, { width: 129, worker: false });
  assert.equal(first.checksum(), second.checksum(), `${eventId} heightfield changed between deterministic builds`);
  assert.equal(first.heights.length, 129 * 129, `${eventId} returned the wrong typed-array size`);
  assert.ok(first.maximum - first.minimum > 4, `${eventId} has no meaningful dune relief`);
  assert.ok(first.contains(0, 0), `${eventId} authority omitted the event center`);
  const centerHeight = first.heightAt(0, 0);
  const centerNormal = first.normalAt(0, 0, {});
  assert.ok(Number.isFinite(centerHeight), `${eventId} center height is not finite`);
  assert.ok(Math.abs(Math.hypot(centerNormal.x, centerNormal.y, centerNormal.z) - 1) < 1e-6,
    `${eventId} normal was not normalized`);
  assert.ok(centerNormal.y > 0.2, `${eventId} produced an inverted or pathological normal`);
  const surface = first.surfaceAt(0, 0, { normal: {} });
  assert.equal(surface.height, centerHeight, `${eventId} surface and height queries disagree`);
  assert.ok(surface.looseness >= 0 && surface.looseness <= 1, `${eventId} looseness escaped bounds`);
  assert.ok(surface.compaction >= 0 && surface.compaction <= 1, `${eventId} compaction escaped bounds`);

  const route = sampleDuneRoute(definition, 5);
  assert.ok(route.samples.length > 40, `${eventId} route is too coarse`);
  assert.ok(route.length > 350, `${eventId} route is too short`);
  assert.ok(definition.routeProfile.stamps.length >= 7, `${eventId} lost its authored rhythm sections`);
  const flow = routeFlowMetrics(first, route);
  assert.ok(flow.prominentCrests >= 3, `${eventId} has no deliberate crest/landing rhythm`);
  assert.ok(flow.maximumGrade < 0.38, `${eventId} centerline has an unreadable ${flow.maximumGrade.toFixed(3)} grade`);
  const recovery = first.findSafeRecoveryPose(
    { x: definition.route[0][0], z: definition.route[0][1] },
    0,
    route,
  );
  assert.ok(Number.isFinite(recovery.y), `${eventId} recovery did not project to terrain`);
  assert.ok(first.slopeAt(recovery.x, recovery.z) <= 0.58,
    `${eventId} recovery selected an unsafe slope`);
  const checkpoints = buildDuneCheckpoints(definition, route);
  if (definition.routeType === 'freeride') {
    assert.equal(checkpoints.length, 0, 'freeride unexpectedly created race gates');
  } else {
    assert.ok(checkpoints.length >= 6, `${eventId} needs a complete checkpoint chain`);
  }
}

const low = await generateDuneHeightfield('whiskerwind', { width: 129, worker: false });
const high = await generateDuneHeightfield('whiskerwind', { width: 513, worker: false });
assert.ok(Math.abs(low.heightAt(0, 0) - high.heightAt(0, 0)) < 1e-4,
  'height query changed with upload resolution at an aligned sample');

console.log('Dune authoritative heightfield passed');
