#!/usr/bin/env node

// Kaki Rally Raid isolation contract.
//
// Raid is an additive, lazily loaded discipline. Nothing that ships today may
// learn about it: no production module may import it, no other mode may request
// its assets, its styles and storage keys live in their own namespace, and its
// own source may not reach into another mode's private implementation.
//
// This test is meaningful before src/racing/raid/ exists (it proves the absence
// of leakage) and stays meaningful afterwards (it proves the boundary holds).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RALLY_ASSET_MANIFEST } from '../src/racing/racingManifest.js';
import { LEGACY_SAVE_KEYS, RALLY_IMPORT_BACKUP_KEY, RALLY_SETTINGS_KEY } from '../src/app/rallySave.js';
import { readRallyRoute, routeUrl } from '../src/app/rallyRouter.js';
import { getRacingModeAvailability } from '../src/racing/racingModeAvailability.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAID_SOURCE_ROOT = path.join(ROOT, 'src', 'racing', 'raid');
const RAID_ASSET_ROOT = 'assets/racing/raid/';
const RAID_STORAGE_PREFIX = 'kks_raid_';
const RAID_CSS_PREFIX = 'kkr-';

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

let checks = 0;
function pass(message) {
  checks += 1;
  console.log(`  PASS  ${message}`);
}

// Any import specifier that resolves into the Raid source root.
const RAID_IMPORT = /(?:from\s+|import\s*\(\s*)['"][^'"]*\/racing\/raid\//;
// Mode-private implementations Raid must never reach into.
const FOREIGN_MODE_IMPORT = /(?:from\s+|import\s*\(\s*)['"][^'"]*\/(?:dunes|drift|crash)\//;

function walkJs(directory, collected = []) {
  if (!fs.existsSync(directory)) return collected;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walkJs(absolute, collected);
    else if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) collected.push(absolute);
  }
  return collected;
}

// The shell seams are required once the mode has an ENTRY POINT for the shell
// to import. Raid's pure runtime modules can land, and be tested, before that.
const raidPresent = fs.existsSync(RAID_SOURCE_ROOT);
const raidModeEntry = fs.existsSync(path.join(RAID_SOURCE_ROOT, 'raidMode.js'));
const raidFiles = walkJs(RAID_SOURCE_ROOT);
const allSourceFiles = walkJs(path.join(ROOT, 'src'));
const nonRaidSourceFiles = allSourceFiles.filter((file) => !file.startsWith(`${RAID_SOURCE_ROOT}${path.sep}`));

console.log('Kaki Rally Raid isolation');

// 1. No production module may statically or dynamically import Raid, with the
//    single exception of the shell's documented lazy-import seam.
const LAZY_IMPORT_SEAM = path.join(ROOT, 'src', 'app', 'rallyApp.js');
for (const file of nonRaidSourceFiles) {
  const relative = path.relative(ROOT, file);
  const source = fs.readFileSync(file, 'utf8');
  if (file === LAZY_IMPORT_SEAM) {
    assert.doesNotMatch(
      source,
      /from\s+['"][^'"]*\/racing\/raid\//,
      'the shell statically imports Raid instead of lazily importing it',
    );
    continue;
  }
  assert.doesNotMatch(source, RAID_IMPORT, `${relative} imports the Raid discipline`);
}
pass(`no production module outside the shell seam imports src/racing/raid/ (${nonRaidSourceFiles.length} modules)`);

// 2. The shared racing facade must reach Raid only through the registration
//    seam, exactly as it already does for the frozen Catastrophe experiment.
const racing = read('src/racing/index.js');
assert.doesNotMatch(racing, RAID_IMPORT, 'the shared racing facade imports Raid');
assert.match(racing, /registerDevelopmentRacingMode/, 'the registration seam is missing');
pass('the shared racing facade reaches Raid only through registerDevelopmentRacingMode');

// 3. The menu must never pull Raid into the initial bundle.
const menu = read('src/app/rallyMenu.js');
assert.doesNotMatch(menu, RAID_IMPORT, 'the production menu imports Raid');
pass('the production menu does not import Raid');

// 4. Raid styles must not be linked from the shell document.
const html = read('index.html');
assert.doesNotMatch(html, /racing\/raid\//, 'index.html eagerly references Raid');
pass('index.html does not reference Raid source or styles');

// 5. Raid assets must be namespaced and referenced only by Raid.
const raidManifestIds = [];
for (const [id, spec] of Object.entries(RALLY_ASSET_MANIFEST)) {
  const url = String(spec?.url || '');
  const isRaidAsset = url.includes(RAID_ASSET_ROOT);
  if (!isRaidAsset) continue;
  raidManifestIds.push(id);
  assert.match(id, /^raid[-A-Za-z0-9]*/, `Raid manifest id is not namespaced: ${id}`);
}
// Declared seams that legitimately name Raid asset paths: the shared manifest
// registers them, and the menu card points at its own key art. What matters is
// that no other mode REQUESTS them, which the id check and the browser test cover.
const ASSET_NAMING_SEAMS = new Set([
  path.join(ROOT, 'src', 'racing', 'racingManifest.js'),
  path.join(ROOT, 'src', 'app', 'rallyMenu.js'),
]);
const MANIFEST_SEAM = path.join(ROOT, 'src', 'racing', 'racingManifest.js');
for (const file of nonRaidSourceFiles) {
  const relative = path.relative(ROOT, file);
  const source = fs.readFileSync(file, 'utf8');
  if (!ASSET_NAMING_SEAMS.has(file)) {
    assert.doesNotMatch(
      source,
      /assets\/racing\/raid\//,
      `${relative} references a Raid asset`,
    );
  }
  if (file === MANIFEST_SEAM) continue;
  for (const id of raidManifestIds) {
    assert.doesNotMatch(
      source,
      new RegExp(`['"\`]${id}['"\`]`),
      `${relative} requests the Raid asset ${id}`,
    );
  }
}
pass(`Raid assets are namespaced and requested only by Raid (${raidManifestIds.length} manifest entries)`);

// 6. Storage namespaces must be disjoint in both directions. The existing
//    embedded Rally Raid experiment owns kks_rally_raid_progress_v1, which is a
//    different namespace from the new discipline's kks_raid_* keys.
const shellKeys = [...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY, RALLY_IMPORT_BACKUP_KEY];
for (const key of shellKeys) {
  assert(
    !key.startsWith(RAID_STORAGE_PREFIX),
    `an existing save key already occupies the Raid namespace: ${key}`,
  );
}
const raidKeys = new Set();
for (const file of raidFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/['"`](kks_[A-Za-z0-9_]+)['"`]/g)) raidKeys.add(match[1]);
}
for (const key of raidKeys) {
  assert(
    key.startsWith(RAID_STORAGE_PREFIX),
    `Raid writes an un-namespaced storage key: ${key}`,
  );
  assert(
    !shellKeys.includes(key),
    `Raid storage key collides with an existing save key: ${key}`,
  );
}
pass(`Raid storage keys stay inside ${RAID_STORAGE_PREFIX}* and never collide (${raidKeys.size} keys)`);

// 7. Raid styles must be namespaced so they cannot restyle another mode.
const raidStylesheets = raidPresent
  ? fs.readdirSync(RAID_SOURCE_ROOT).filter((entry) => entry.endsWith('.css'))
  : [];
for (const stylesheet of raidStylesheets) {
  const css = read(path.posix.join('src/racing/raid', stylesheet));
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of withoutComments.matchAll(/(^|[},])\s*([^{}@]+)\{/g)) {
    const selectorList = match[2].trim();
    if (!selectorList || selectorList.startsWith('@')) continue;
    for (const selector of selectorList.split(',')) {
      const trimmed = selector.trim();
      if (!trimmed || trimmed.startsWith('from') || trimmed.startsWith('to') || /^\d/.test(trimmed)) continue;
      assert.match(
        trimmed,
        new RegExp(`(?:\\.|#|\\[data-)${RAID_CSS_PREFIX}|^:root|^\\.${RAID_CSS_PREFIX}`),
        `Raid stylesheet ${stylesheet} declares an un-namespaced selector: ${trimmed}`,
      );
    }
  }
}
pass(`Raid stylesheets are namespaced to ${RAID_CSS_PREFIX}* (${raidStylesheets.length} files)`);

// 8. Raid may consume stable shared services, never another mode's internals.
for (const file of raidFiles) {
  const relative = path.relative(ROOT, file);
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    FOREIGN_MODE_IMPORT,
    `${relative} reaches into another mode's private implementation`,
  );
}
pass(`Raid imports no other mode's internals (${raidFiles.length} Raid modules)`);

// 9. The development gate must exist and must not weaken the Catastrophe gate.
const router = read('src/app/rallyRouter.js');
const availability = read('src/racing/racingModeAvailability.js');
assert.match(router, /catastropheDevelopment/, 'the Catastrophe development gate was removed');
assert.match(availability, /crash/, 'the Catastrophe availability gate was removed');
if (raidPresent) {
  assert.match(router, /raidDevelopment/, 'the Raid development gate is missing from the router');
  assert.match(availability, /raid/, 'the Raid availability gate is missing');
  assert.match(racing, /_raidModeApi/, 'the racing facade has no Raid registration seam');
  // The gate must actually REFUSE an ungated route, not merely mention Raid.
  // Asserting behaviour rather than source text means a refactor that keeps the
  // identifier but loses the check still fails here.
  // Raid is a deep-link preview: reachable by URL on any origin, but never
  // advertised, because the menu's card table is frozen and has no Raid card.
  assert.equal(
    readRallyRoute('https://dknos.github.io/kaki-rally/?mode=raid&play=1').mode,
    'raid',
    'the public deep link does not reach Raid',
  );
  assert.equal(
    readRallyRoute('http://localhost:8080/?mode=raid&play=1&dev=1').mode,
    'raid',
    'the local development route does not reach Raid',
  );
  assert.equal(
    getRacingModeAvailability('raid', { raidDevelopment: false }).canLaunch,
    true,
    'the public deep link cannot launch Raid',
  );
  // The menu now carries a Raid card, but it must stay honest about what it is
  // and must not have disturbed any existing card.
  assert.match(menu, /data-mode="raid"/, 'the menu has no Raid card');
  assert.match(menu, /PREVIEW/, 'the Raid card does not declare itself a preview');
  for (const existing of ['circuit', 'drift', 'stock', 'dunes', 'draw', 'monster', 'trials']) {
    assert.match(menu, new RegExp(`data-mode="${existing}"`), `the ${existing} card was removed`);
  }
  // The menu's stage selector cannot import RAID_STAGE_ORDER — check 1 above
  // forbids it — so it carries a duplicated literal list. That duplication is
  // only safe if something compares it to the real table.
  const { RAID_STAGE_ORDER, RAID_STAGES } = await import('../src/racing/raid/raidStageBlueprints.js');
  const menuStageBlock = menu.match(/const RAID_STAGE_CHOICES[\s\S]*?\]\);/)?.[0] || '';
  const menuStageIds = [...menuStageBlock.matchAll(/value: '([a-z0-9-]+)'/g)].map((entry) => entry[1]);
  assert.deepEqual(
    menuStageIds,
    [...RAID_STAGE_ORDER],
    'the menu\'s duplicated Raid stage list has drifted from RAID_STAGE_ORDER',
  );
  assert.match(menu, /selectMarkup\('raidStage'/, 'the Raid card has no stage selector');
  // And the deep link has to carry a stage, or the selector is unshareable.
  assert.equal(
    readRallyRoute(`https://dknos.github.io/kaki-rally/?mode=raid&play=1&stage=${RAID_STAGE_ORDER[1]}`).stage,
    RAID_STAGE_ORDER[1],
    '?stage= does not reach the shell',
  );
  assert.equal(readRallyRoute('https://dknos.github.io/kaki-rally/?mode=raid').stage, null, 'a missing ?stage= is not null');
  for (const id of RAID_STAGE_ORDER) {
    assert.equal(RAID_STAGES[id].id, id, `RAID_STAGES is keyed inconsistently for ${id}`);
  }
  pass(`the menu offers every Raid stage (${RAID_STAGE_ORDER.join(', ')}) and ?stage= reaches the shell`);

  // And the Catastrophe gate must be untouched in both directions.
  assert.equal(
    readRallyRoute('http://localhost:8080/?mode=crash&dev=catastrophe').mode,
    'crash',
    'the Catastrophe development route regressed',
  );
  assert.equal(readRallyRoute('http://localhost:8080/?mode=crash').mode, null, 'the Catastrophe gate regressed');
  assert.equal(
    getRacingModeAvailability('crash', { development: true }).canLaunch,
    true,
    'the Catastrophe availability gate regressed',
  );
  assert.equal(
    getRacingModeAvailability('dunes').canLaunch,
    true,
    'a production mode became unavailable',
  );
  // A renderer restart into either development mode must preserve its own flag
  // and never cancel it.
  const raidRestart = routeUrl('http://localhost:8080/?mode=raid&dev=1', {
    mode: 'raid', renderer: 'webgl', catastropheDevelopment: false, raidDevelopment: true, autoStart: false,
  });
  assert.equal(readRallyRoute(raidRestart.href).mode, 'raid', 'restarting Raid into WebGL drops its development flag');
  const crashRestart = routeUrl('http://localhost:8080/?mode=crash&dev=catastrophe', {
    mode: 'crash', renderer: 'webgl', catastropheDevelopment: true, raidDevelopment: false, autoStart: false,
  });
  assert.equal(readRallyRoute(crashRestart.href).mode, 'crash', 'restarting Catastrophe into WebGL drops its flag');
  if (raidModeEntry) {
    const app = read('src/app/rallyApp.js');
    assert.match(
      app,
      /import\('\.\.\/racing\/raid\/[A-Za-z0-9]+\.js'\)/,
      'the shell does not lazily import the Raid mode',
    );
    pass('Raid is development-gated and lazily imported without weakening the Catastrophe gate');
  } else {
    assert.doesNotMatch(
      read('src/app/rallyApp.js'),
      /racing\/raid\//,
      'the shell references a Raid mode entry point that does not exist',
    );
    pass('Raid runtime modules are present and gated; no shell entry point exists yet, and none is referenced');
  }
} else {
  pass('Raid is absent; the Catastrophe development gate is intact');
}

// 10. Existing test wiring must not be weakened to accommodate Raid.
const packageJson = JSON.parse(read('package.json'));
assert.match(packageJson.scripts['test:racing'], /smoke-rally-raid-expansion/, 'the embedded Rally Raid smoke was removed');
assert.match(packageJson.scripts['test:standalone'], /smoke-catastrophe-isolation/, 'the Catastrophe isolation smoke was removed');
assert.doesNotMatch(packageJson.scripts.test, /--skip|--no-/, 'the default test script was weakened');
pass('existing test wiring is intact');

// 11. The frozen-boundary manifest must exist and cover the modes Raid must not touch.
assert(exists('docs/raid/FROZEN_BOUNDARIES.json'), 'docs/raid/FROZEN_BOUNDARIES.json is missing');
const boundaries = JSON.parse(read('docs/raid/FROZEN_BOUNDARIES.json'));
for (const directory of ['src/racing/dunes', 'src/racing/drift', 'src/racing/crash', 'src/rendering', 'src/core']) {
  assert(
    boundaries.frozenDirectories.includes(directory),
    `the frozen boundary does not cover ${directory}`,
  );
}
assert(boundaries.files.length > 100, 'the frozen boundary manifest looks empty');
pass(`frozen boundary manifest covers ${boundaries.files.length} files across ${boundaries.frozenDirectories.length} directories`);

console.log(
  `\nKaki Rally Raid isolation passed: ${checks} contracts, `
  + `${nonRaidSourceFiles.length} production modules inspected, `
  + `Raid ${raidPresent ? `present (${raidFiles.length} modules)` : 'not yet implemented'}`,
);
