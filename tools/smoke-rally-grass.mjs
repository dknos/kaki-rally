#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRallyGrassLayout,
  rallyGrassDensityFactor,
  rallyGrassDistanceToTrackSq,
  RALLY_GRASS_BIOMES,
  RALLY_GRASS_QUALITY,
  RALLY_GRASS_SCHEMA,
} from '../src/racing/rallyGrassLayout.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let assertions = 0;

function check(condition, message) {
  assertions += 1;
  assert(condition, message);
}

function equal(actual, expected, message) {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function throws(callback, matcher, message) {
  assertions += 1;
  assert.throws(callback, matcher, message);
}

function circleSamples(count = 96, radiusX = 48, radiusZ = 34) {
  return Array.from({ length: count }, (_, index) => {
    const angle = index / count * Math.PI * 2;
    const dx = Math.cos(angle) * radiusX;
    const dz = -Math.sin(angle) * radiusZ;
    const length = Math.hypot(dx, dz) || 1;
    const tangent = { x: dx / length, z: dz / length };
    return {
      x: Math.sin(angle) * radiusX,
      y: 0,
      z: Math.cos(angle) * radiusZ,
      tangent,
      normal: { x: -tangent.z, z: tangent.x },
    };
  });
}

const samples = circleSamples();
const heightAt = (x, z) => -0.4 + Math.sin(x * 0.07) * 0.12 + Math.cos(z * 0.09) * 0.08;
const course = { id: 'forest', trackWidth: 8.4, seed: 1979 };
const high = createRallyGrassLayout({
  course,
  samples,
  quality: 'high',
  mode: 'circuit',
  groundSize: 360,
  heightAt,
});
const repeated = createRallyGrassLayout({
  course,
  samples,
  quality: 'high',
  mode: 'circuit',
  groundSize: 360,
  heightAt,
});

equal(high.schema, RALLY_GRASS_SCHEMA, 'layout schema changed');
equal(high.counts.carpet, RALLY_GRASS_QUALITY.high.carpet, 'forest high carpet budget changed');
equal(high.counts.emergent, RALLY_GRASS_QUALITY.high.emergent, 'forest high emergent budget changed');
equal(JSON.stringify(high.carpet), JSON.stringify(repeated.carpet), 'same inputs are not deterministic');
check(Object.isFrozen(high) && Object.isFrozen(high.counts), 'layout result is mutable');
check(high.carpet.every((placement) => (
  Math.abs(placement.y - (heightAt(placement.x, placement.z) + 0.035)) < 1e-12
)), 'grass bases do not follow the supplied terrain height');
check([...high.carpet, ...high.emergent].every((placement) => (
  rallyGrassDistanceToTrackSq(placement.x, placement.z, samples)
    >= high.roadClearance * high.roadClearance - 1e-8
)), 'grass entered the complete road-clearance corridor');
check(new Set(high.carpet.map((placement) => placement.band)).size === 3, 'carpet lost a distance band');
check(new Set(high.emergent.map((placement) => placement.band)).size === 3, 'emergent grass lost a distance band');
check(high.carpet.every((placement) => (
  Number.isFinite(placement.x)
  && Number.isFinite(placement.y)
  && Number.isFinite(placement.z)
  && placement.scale > 0
)), 'layout contains malformed placement data');

const qualityTotals = Object.keys(RALLY_GRASS_QUALITY).map((quality) => (
  createRallyGrassLayout({ course, samples, quality, groundSize: 360, heightAt }).counts.total
));
check(qualityTotals.every((total, index) => index === 0 || total > qualityTotals[index - 1]), 'quality budgets are not monotonic');

for (const [courseId, biome] of Object.entries(RALLY_GRASS_BIOMES)) {
  const layout = createRallyGrassLayout({
    course: { id: courseId, trackWidth: 8.4, seed: 19 },
    samples,
    quality: 'medium',
    groundSize: 360,
    heightAt,
  });
  check(layout.counts.total > 0, `${courseId} has no grass presentation`);
  equal(layout.biome, biome, `${courseId} did not select its authored grass biome`);
  check(layout.biome.palette.healthyTip.length === 3, `${courseId} palette is malformed`);
}

const stock = createRallyGrassLayout({
  course,
  samples,
  quality: 'high',
  mode: 'stock',
  groundSize: 360,
  heightAt,
});
check(stock.counts.total < high.counts.total, 'Stock Cup safeguard did not reduce grass instances');

const selfNear = circleSamples(128, 28, 8);
const selfNearLayout = createRallyGrassLayout({
  course: { id: 'kakiland', trackWidth: 12, seed: 44 },
  samples: selfNear,
  quality: 'medium',
  mode: 'draw',
  groundSize: 220,
  heightAt,
});
check([...selfNearLayout.carpet, ...selfNearLayout.emergent].every((placement) => (
  rallyGrassDistanceToTrackSq(placement.x, placement.z, selfNear)
    >= selfNearLayout.roadClearance * selfNearLayout.roadClearance - 1e-8
)), 'wide Draw Track clearance failed on a self-near course');

const densityA = rallyGrassDensityFactor(14.2, -9.8, 17);
const densityB = rallyGrassDensityFactor(14.2, -9.8, 17);
equal(densityA, densityB, 'density field is not deterministic');
check(densityA >= 0.02 && densityA <= 1, 'density field escaped [0.02, 1]');

throws(() => createRallyGrassLayout({}), /course id/i, 'missing course did not fail');
throws(
  () => createRallyGrassLayout({ course, samples: samples.slice(0, 4), heightAt }),
  /at least eight/i,
  'undersampled track did not fail',
);
throws(
  () => createRallyGrassLayout({ course, samples, quality: 'cinematic', heightAt }),
  /unknown rally grass quality/i,
  'unknown quality did not fail',
);

const renderSource = readFileSync(path.join(ROOT, 'src/racing/rallyGrass.js'), 'utf8');
const materialSource = readFileSync(path.join(ROOT, 'src/rendering/materials/rallyGrassMaterial.js'), 'utf8');
const environmentSource = readFileSync(path.join(ROOT, 'src/racing/racingEnvironment.js'), 'utf8');
check(/InstancedMesh/.test(renderSource), 'grass renderer is not instanced');
check(/mergeGeometries/.test(renderSource), 'grass clumps lost merged multi-blade geometry');
check(/MeshStandardNodeMaterial/.test(materialSource), 'grass is not using a backend-neutral node material');
check(/material\.positionNode/.test(materialSource), 'grass lost GPU wind deformation');
check(!/onBeforeCompile/.test(materialSource.replace(/The Terra-STL research shader used onBeforeCompile/, '')), 'grass reintroduced a WebGL-only shader hook');
check(/reduceMotion \? 0/.test(materialSource), 'reduced-motion wind gate is missing');
check(/env\.grass\?\.update\(t\)/.test(environmentSource), 'environment does not tick grass wind');
check(/env\.grass\?\.dispose/.test(environmentSource), 'environment does not dispose grass resources');

console.log(`Rally Terra grass smoke passed (${assertions} assertions).`);
