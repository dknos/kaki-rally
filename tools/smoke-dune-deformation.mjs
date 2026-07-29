import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DuneBrushBuffer,
  DuneDeformationField,
  DuneSurfaceField,
} from '../src/racing/dunes/duneDeformation.js';
import { generateDuneHeightfield } from '../src/racing/dunes/duneHeightfield.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [materialSource, wakeSource, dustSource] = await Promise.all([
  readFile(path.join(REPO_ROOT, 'src/racing/dunes/duneMaterial.js'), 'utf8'),
  readFile(path.join(REPO_ROOT, 'src/racing/dunes/duneRoosterTail.js'), 'utf8'),
  readFile(path.join(REPO_ROOT, 'src/racing/dunes/duneDust.js'), 'utf8'),
]);

const field = new DuneDeformationField({
  worldSize: 512,
  worldMinX: -256,
  worldMinZ: -256,
  quality: 'low',
  recentResolution: 96,
  recentWorldSize: 72,
  coarseResolution: 48,
});
const brushes = new DuneBrushBuffer(4);
const baseBrush = {
  wheelIndex: 0,
  worldX: 0,
  worldZ: 0,
  normalX: 0,
  normalY: 1,
  normalZ: 0,
  travelX: 0,
  travelZ: 0.2,
  forwardX: 0,
  forwardZ: 1,
  tireRadius: 1.05,
  tireWidth: 0.72,
  normalLoad: 1,
  longitudinalSlip: 0.1,
  lateralSlip: 0,
  driveTorque: 0.4,
  brakeAmount: 0,
  surfaceLooseness: 0.75,
};
for (let frame = 0; frame < 180; frame += 1) {
  brushes.clear();
  baseBrush.worldZ = frame * 0.025;
  brushes.push(baseBrush);
  field.applyBrushBuffer(brushes, 1 / 120);
}
const centerRut = field.heightOffsetAt(0, 2);
const leftBerm = field.heightOffsetAt(-0.72, 2);
const rightBerm = field.heightOffsetAt(0.72, 2);
assert.ok(centerRut < -0.025 && centerRut >= -0.1501,
  `rolling tire did not form a bounded physical rut: ${centerRut}`);
assert.ok(Math.max(leftBerm, rightBerm) > 0.001,
  'displaced mass did not form a raised berm');
assert.ok(field.compactionAt(0, 2) > 0.08, 'wheel passage did not compact the route');

const rollingDepth = -centerRut;
const spinField = new DuneDeformationField({
  worldSize: 512,
  worldMinX: -256,
  worldMinZ: -256,
  quality: 'low',
  recentResolution: 96,
  recentWorldSize: 72,
  coarseResolution: 48,
});
for (let frame = 0; frame < 180; frame += 1) {
  brushes.clear();
  baseBrush.worldZ = frame * 0.025;
  baseBrush.longitudinalSlip = 1.1;
  baseBrush.lateralSlip = 0.65;
  baseBrush.driveTorque = 1.5;
  brushes.push(baseBrush);
  spinField.applyBrushBuffer(brushes, 1 / 120);
}
assert.ok(-spinField.heightOffsetAt(0, 2) > rollingDepth * 1.35,
  `wheelspin did not dig more deeply than clean rolling: rolling=${rollingDepth}, spin=${-spinField.heightOffsetAt(0, 2)}`);

const oldOrigin = field.originZ;
const retainedBefore = field.heightOffsetAt(0, 2);
assert.equal(field.recenter(0, 50), true, 'deformation window did not scroll');
assert.notEqual(field.originZ, oldOrigin, 'recenter left the snapped origin unchanged');
assert.ok(Math.abs((field.originZ / field.recentCellSize) - Math.round(field.originZ / field.recentCellSize)) < 1e-6,
  'deformation origin is not texel snapped');
assert.ok(field.heightOffsetAt(0, 2) < 0, 'coarse history forgot the previous track after scrolling');
field.recenter(0, 2, true);
assert.ok(field.heightOffsetAt(0, 2) <= retainedBefore * 0.2,
  'returning local state did not retain the rut history');
assert.ok(field.heightOffsetAt(34, -32) >= -0.1501 && field.heightOffsetAt(34, -32) <= 0.0801,
  'newly exposed deformation region contained invalid stale data');

const limited = new DuneBrushBuffer(2);
assert.equal(limited.push(baseBrush), true);
assert.equal(limited.push(baseBrush), true);
assert.equal(limited.push(baseBrush), false);
assert.equal(limited.count, 2, 'brush capacity overflow mutated the active count');
assert.equal(limited.dropped, 1, 'brush overflow was not observable');

const heightfield = await generateDuneHeightfield('whiskerwind', { width: 129, worker: false });
const authority = new DuneSurfaceField(heightfield, field);
const x = 0;
const z = 2;
const surface = authority.surfaceAt(x, z, { normal: {} });
assert.ok(Math.abs(surface.height - authority.heightAt(x, z)) < 1e-6,
  'deformed surface and height queries diverged');
assert.ok(surface.deformation >= -0.15 && surface.deformation <= 0.08,
  'physical deformation escaped its stability bounds');

assert.match(materialSource, /const deformationOffset = mix\(coarseOffset,\s*recentOffset,\s*recentMask\)/,
  'terrain material does not retain signed deformation for track shading');
assert.match(materialSource, /const depression = smoothstep\(/,
  'terrain material does not expose rut depression at gameplay distance');
assert.match(materialSource, /signedTrackContrast = true/,
  'terrain material does not publish the signed-track visual contract');
assert.match(wakeSource, /const WAKE_ROWS = 5/,
  'sand wake is still a flat two-vertex curtain');
assert.match(wakeSource, /curvedSurface:\s*true/,
  'sand wake does not expose its curled surface contract');
assert.match(wakeSource, /positions:\s*positionAttribute\.array/,
  'sand wake animates a constructor buffer instead of its uploaded position stream');
assert.match(wakeSource, /const lip = outside \* outside/,
  'sand wake has no outside-carve lip');
assert.match(dustSource, /kind:\s*ballistic \? 1 : 0/,
  'sand VFX lost its separate curtain and ballistic populations');
assert.match(dustSource, /pool\.quality === 'ultra' \? 156 : 126/,
  'high-quality sand emission density regressed');

console.log('Dune two-level deformation passed');
