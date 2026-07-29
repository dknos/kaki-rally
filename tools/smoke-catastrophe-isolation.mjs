#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RALLY_ASSET_MANIFEST } from '../src/racing/racingManifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

for (const [id, spec] of Object.entries(RALLY_ASSET_MANIFEST)) {
  assert.doesNotMatch(id, /crash|catastrophe|rapier/i, `standard manifest exposes ${id}`);
  assert.doesNotMatch(spec.url, /(?:\/crash\/|catastrophe|rapier)/i, `standard manifest loads ${spec.url}`);
}

const packageJson = JSON.parse(read('package.json'));
assert.doesNotMatch(packageJson.scripts.test, /catastrophe|racing:crash/i);
assert.doesNotMatch(packageJson.scripts['test:racing'], /catastrophe|racing:crash|smoke-racing-crash/i);
assert.match(packageJson.scripts['test:catastrophe'], /smoke-racing-crash/);

const menu = read('src/app/rallyMenu.js');
assert.doesNotMatch(menu, /from ['"][^'"]*\/crash\//, 'production menu statically imports Catastrophe');
assert.match(menu, /this\.catastropheDevelopment \? .*data-mode="crash"/s);

const app = read('src/app/rallyApp.js');
assert.match(app, /if \(mode === 'crash'\)[\s\S]*import\('\.\.\/racing\/crash\/crashMode\.js'\)/);
assert.match(app, /catastropheDevelopment/);
assert.doesNotMatch(read('index.html'), /racing\/crash\/crash\.css/);

const racing = read('src/racing/index.js');
assert.doesNotMatch(racing, /import\(['"][^'"]*\/crash\//, 'shared racing facade imports Catastrophe');
assert.match(racing, /registerDevelopmentRacingMode/);

const productionRacingFiles = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'crash') walk(absolute);
    } else if (entry.isFile() && /\.js$/u.test(entry.name)) {
      productionRacingFiles.push(absolute);
    }
  }
}
walk(path.join(ROOT, 'src', 'racing'));
for (const file of productionRacingFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(
    source,
    /(?:from\s+|import\s*\()\s*['"][^'"]*(?:\/crash\/|rapier)/i,
    `${path.relative(ROOT, file)} imports the frozen experiment`,
  );
}

for (const preserved of [
  'src/racing/crash/crashMode.js',
  'src/racing/crash/crashPhysics.js',
  'src/racing/crash/crashManifest.js',
  'src/racing/crash/vendor/rapier.mjs',
  'assets/racing/crash/kaki-catastrophe-vehicles-v2.glb',
  'assets/racing/crash/pawprint-moonpaw-environment-v2.glb',
]) {
  assert(fs.statSync(path.join(ROOT, preserved)).isFile(), `preserved Catastrophe file is missing: ${preserved}`);
}

console.log(`Kaki Catastrophe production isolation passed: ${productionRacingFiles.length} production racing modules inspected`);
