#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RALLY_ASSET_MANIFEST,
  rallyAssetIds,
  trialsAssetIds,
} from '../src/racing/racingManifest.js';
import {
  createDuneWorldPlan,
  createMonsterWorldPlan,
  createRacingWorldPlan,
  createRaidWorldPlan,
  createTrialsWorldPlan,
  createWorldSeed,
  placementClearsRoute,
} from '../src/racing/worldLiveness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIT_IDS = Object.freeze([
  'roadsideWorldKitV3',
  'industrialWorldKitV1',
  'stadiumWorldKitV1',
  'monsterEventWorldKitV2',
  'desertServiceWorldKitV1',
  'trialsWorldKitV1',
  'raceDayWorldKitV1',
]);

function glbJson(file) {
  const buffer = readFileSync(file);
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', `${file} is not GLB`);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a, `${file} has no JSON chunk`);
  return JSON.parse(buffer.toString('utf8', 20, 20 + buffer.readUInt32LE(12)).trim());
}

function checksum(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function source(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

const rights = JSON.parse(readFileSync(path.join(ROOT, 'docs/ASSET_RIGHTS_LEDGER.json'), 'utf8'));
const candidates = JSON.parse(readFileSync(path.join(ROOT, 'docs/BIMOBJECT_CANDIDATES.json'), 'utf8'));

for (const id of KIT_IDS) {
  const spec = RALLY_ASSET_MANIFEST[id];
  assert(spec, `missing world manifest id ${id}`);
  assert.equal(spec.kind, 'model');
  assert(!/^(?:https?:|file:|\/)/i.test(spec.url), `${id} is not repository-local`);
  assert(!/asset_staging|assets\/private|bimobject\.com/i.test(spec.url), `${id} bypasses the public rights gate`);
  const file = path.join(ROOT, spec.url);
  assert(statSync(file).size < 600 * 1024, `${id} exceeds the 600 KiB compressed kit budget`);
  const json = glbJson(file);
  assert.equal((json.images || []).length, 0, `${id} unexpectedly embeds textures`);
  const names = new Set((json.nodes || []).map((node) => node.name).filter(Boolean));
  const lod0 = [...names].filter((name) => /_LOD0$/.test(name));
  assert(lod0.length >= 12, `${id} exposes too few modular families`);
  for (const name of lod0) {
    const base = name.slice(0, -5);
    for (const suffix of ['_LOD1', '_LOD2', '_COL']) {
      assert(names.has(`${base}${suffix}`), `${id} is missing ${base}${suffix}`);
    }
  }
  const ledger = rights.assets.find((entry) => entry.runtimeGlb === spec.url);
  assert(ledger, `${id} has no rights-ledger row`);
  assert.equal(ledger.rightsStatus, 'GREEN');
  assert.equal(ledger.origin, 'ORIGINAL_CLEAN_ROOM');
  assert.equal(ledger.thirdPartyGeometryUsed, false);
  assert.equal(ledger.thirdPartyTexturesUsed, false);
  assert.equal(ledger.status, 'COMPLETED');
  assert.equal(ledger.derivativeChecksum, checksum(file), `${id} ledger checksum drifted`);
  assert(statSync(path.join(ROOT, ledger.builder)).isFile(), `${id} builder is absent`);
  assert(statSync(path.join(ROOT, ledger.blendSource)).isFile(), `${id} blend source is absent`);
}

const expectedModeAssets = [
  ['circuit', {}, 'roadsideWorldKitV3'],
  ['drift', {}, 'industrialWorldKitV1'],
  ['stock', {}, 'stadiumWorldKitV1'],
  ['draw', { drawThemeId: 'industrial' }, 'industrialWorldKitV1'],
  ['draw', { drawThemeId: 'desert' }, 'desertServiceWorldKitV1'],
  ['draw', { drawThemeId: 'neon' }, 'stadiumWorldKitV1'],
  ['draw', { drawThemeId: 'dirt' }, 'stadiumWorldKitV1'],
  ['draw', { drawThemeId: 'countryside' }, 'roadsideWorldKitV3'],
  ['draw', { drawThemeId: 'forest' }, 'roadsideWorldKitV3'],
  ['draw', { drawThemeId: 'snow' }, 'roadsideWorldKitV3'],
  ['draw', { drawThemeId: 'coastal' }, 'roadsideWorldKitV3'],
  ['monster', {}, 'monsterEventWorldKitV2'],
  ['dunes', {}, 'desertServiceWorldKitV1'],
];
for (const [mode, options, expected] of expectedModeAssets) {
  const ids = rallyAssetIds('forest', mode, 'meowster', options);
  assert(ids.includes(expected), `${mode}/${options.drawThemeId || 'default'} is missing ${expected}`);
  assert(ids.includes('raceDayWorldKitV1'), `${mode} is missing bounded shared race-day art`);
  const worldIds = ids.filter((id) => KIT_IDS.includes(id) && id !== 'raceDayWorldKitV1');
  assert.equal(worldIds.length, 1, `${mode} preloads unrelated world kits: ${worldIds.join(', ')}`);
}
assert(trialsAssetIds('meadow').includes('trialsWorldKitV1'));
assert(trialsAssetIds('meadow').includes('raceDayWorldKitV1'));

// The Workshop rebuild is the systemic P0/P1 repair: no optimizer-created
// anonymous roots may escape their feature/module owner again.
const workshopJson = glbJson(path.join(ROOT, RALLY_ASSET_MANIFEST.courseWorkshopKit.url));
const workshopRoots = workshopJson.scenes[workshopJson.scene || 0].nodes || [];
assert.equal(workshopRoots.length, 50, 'Workshop root contract changed');
assert(workshopRoots.every((index) => workshopJson.nodes[index]?.name), 'Workshop contains anonymous root nodes');
const guardrailRoot = workshopJson.nodes.findIndex((node) => node.name === 'bridge_guardrail_module');
assert(guardrailRoot >= 0, 'Workshop guardrail module is absent');
const guardrailDescendants = [];
const visitWorkshopNode = (index) => {
  const node = workshopJson.nodes[index];
  if (!node) return;
  guardrailDescendants.push(node.name || '');
  for (const child of node.children || []) visitWorkshopNode(child);
};
visitWorkshopNode(guardrailRoot);
assert.equal(guardrailDescendants.filter((name) => /guardrail_post(?:_cap)?_/.test(name)).length, 12,
  'Workshop guardrail posts/caps escaped their module hierarchy');

const racingEnvironmentSource = source('src/racing/racingEnvironment.js');
assert.match(racingEnvironmentSource, /function _driftChevronGeometry/);
assert.match(racingEnvironmentSource, /tile = \[5, 8, 15\]/);
assert.doesNotMatch(racingEnvironmentSource, /ConeGeometry\(0\.72, 1\.25, 7\)/);
assert.doesNotMatch(racingEnvironmentSource, /name: 'rally-guard-posts'/);
const featureRuntimeSource = source('src/racing/courseFeatureRuntime.js');
assert.match(featureRuntimeSource, /neighbourSpan \* deckStep \* 0\.52/);
assert.match(featureRuntimeSource, /neighbourSpan \* railStep \* 0\.52/);
const tracksSource = source('src/racing/tracks.js');
const driftDefinition = tracksSource.slice(tracksSource.indexOf("if (mode === 'drift')"), tracksSource.indexOf('return { ...base', tracksSource.indexOf("if (mode === 'drift')")));
assert.match(driftDefinition, /rampFractions: \[\]/);
assert.match(driftDefinition, /boostFractions: \[\]/);
const indexSource = source('src/racing/index.js');
assert.match(indexSource, /getObjectByName\?\.\('feature_repair_bay'\)/);
const monsterSource = source('src/racing/monsterDestruction.js');
assert.match(monsterSource, /fallbackAppear = target\.visualInstances\?\.length \? 0\.0001 : appear/);
assert.match(monsterSource, /function _composeDominoWheel/);
const monsterArenaSource = source('src/racing/monsterArena.js');
const storyDressing = monsterArenaSource.slice(monsterArenaSource.indexOf('export function attachMonsterStoryDressing'), monsterArenaSource.indexOf('export function attachMonsterAudience'));
for (const moduleName of ['ArenaKit_ConcreteBarrier', 'ArenaKit_Guardrail', 'ArenaKit_FencePanel']) {
  assert(storyDressing.includes(moduleName), `default Monster dressing omits ${moduleName}`);
}
const trialsSource = source('src/racing/trialsEnvironment.js');
assert.match(trialsSource, /bodyPositions\.getX\(vertex\) \/ 56/);
assert.match(trialsSource, /if \(themeId === 'quarry'\) return/);
const duneBuilderSource = source('tools/blender/build-kaki-dune-environment-kit.py');
const mesaBuilder = duneBuilderSource.slice(duneBuilderSource.indexOf('def build_mesa'), duneBuilderSource.indexOf('def aim_at'));
assert.match(mesaBuilder, /ErodedButtress/);
assert.doesNotMatch(mesaBuilder, /\bcube\(/);
const wreckBuilder = duneBuilderSource.slice(duneBuilderSource.indexOf('def build_wreck'), duneBuilderSource.indexOf('def build_sign'));
assert.match(wreckBuilder, /Wreck_TaperedCrushedShell/);
assert.match(wreckBuilder, /Wreck_BuckledRoofShell/);

const samples = Array.from({ length: 64 }, (_, index) => {
  const angle = index / 64 * Math.PI * 2;
  return {
    x: Math.cos(angle) * 72,
    y: 0,
    z: Math.sin(angle) * 72,
    normal: { x: Math.cos(angle), z: Math.sin(angle) },
  };
});
const course = { id: 'forest', mode: 'circuit', trackWidth: 10 };
const planA = createRacingWorldPlan({ course, mode: 'circuit', samples, heightAt: () => 0, quality: 'high' });
const planB = createRacingWorldPlan({ course, mode: 'circuit', samples, heightAt: () => 0, quality: 'high' });
assert.deepEqual(planA, planB, 'world composition is not deterministic');
for (const plan of planA) {
  for (const placement of plan.placements) {
    assert(placementClearsRoute(placement, course.trackWidth), `${placement.asset} violates the route exclusion zone`);
  }
}
const driftPlan = createRacingWorldPlan({ course, mode: 'drift', samples, heightAt: () => 0, quality: 'low' });
assert(driftPlan[0].placements.length >= 24, 'Whisker Yard lacks a continuous facility composition');
const stockPlan = createRacingWorldPlan({
  course: { ...course, trackWidth: 14.8 },
  mode: 'stock',
  samples,
  heightAt: () => 0,
  quality: 'medium',
});
assert(stockPlan[0].placements.filter((placement) => placement.asset === 'GRANDSTAND_BAY').length >= 8);
assert(stockPlan[0].placements.filter((placement) => placement.asset === 'CATCH_FENCE').length >= 16);
const rngA = createWorldSeed('forest:circuit');
const rngB = createWorldSeed('forest:circuit');
assert.deepEqual(Array.from({ length: 12 }, rngA), Array.from({ length: 12 }, rngB));

const expectedPlans = [
  createMonsterWorldPlan({ bounds: { minX: -88, maxX: 88, minZ: -68, maxZ: 68 } }),
  createDuneWorldPlan({
    event: { id: 'sunspine', routeWidth: 20 },
    samples,
    heightAt: () => 0,
    quality: 'low',
  }),
  createTrialsWorldPlan({
    track: { id: 'quarry', length: 960 },
    groundAt: () => ({ height: 0 }),
  }),
  createRaidWorldPlan({ startX: 0, startZ: 0, heightAt: () => 0 }),
];
for (const plans of expectedPlans) {
  assert.equal(plans.length, 2, 'a production world omitted its mode kit or shared race-day kit');
  assert(plans[0].placements.length >= 4, 'a production world is not a meaningful composition');
  assert(plans.flatMap((plan) => plan.placements).every((placement) => (
    Number.isFinite(placement.x) && Number.isFinite(placement.y) && Number.isFinite(placement.z)
  )), 'a production world emitted an invalid placement');
}
assert(
  expectedPlans[2][0].placements.every((placement) => placement.z <= -10),
  'Trials infrastructure must stay behind the side-camera action plane',
);

assert(candidates.candidates.length >= 12, 'candidate review is not product-specific enough');
for (const candidate of candidates.candidates) {
  assert.notEqual(candidate.rightsStatus, 'GREEN', `${candidate.candidateId} cannot ship under the reviewed terms`);
  assert.equal(candidate.sourceDownloaded, false, `${candidate.candidateId} unexpectedly claims an acquisition`);
  assert.equal(candidate.sourceFileChecksum, null);
  assert.equal(candidate.productionDerivativePath, null);
}

console.log(`Kaki world-asset gate passed: ${KIT_IDS.length} clean-room kits, deterministic placement, local leases, rights coverage.`);
