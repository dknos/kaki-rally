import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RALLY_VERSION } from '../src/app/rallyVersion.js';

const APPROVED_LAZY_IMPORTS = new Set([
  'src/app/rallyApp.js:../racing/crash/crashMode.js',
  'src/app/rallyApp.js:../racing/raid/raidMode.js',
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'src', 'main.js');
const STATIC_IMPORT_PATTERN = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const FORBIDDEN_PATHS = [
  /(?:^|\/)bullethell(?:\/|$)/i,
  /(?:^|\/)weapons?(?:\/|\.js$)/i,
  /(?:^|\/)enemies?(?:\/|\.js$)/i,
  /spawnDirector/i,
  /(?:^|\/)xp(?:\/|\.js$)/i,
  /(?:^|\/)town(?:\/|\.js$)/i,
  /(?:^|\/)catacomb(?:\/|\.js$)/i,
  /stageLife/i,
  /stageExploration/i,
  /combatUi/i,
];

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function resolveImport(owner, specifier) {
  if (!specifier.startsWith('.')) return null;
  const resolved = path.resolve(path.dirname(owner), specifier.split('?')[0].split('#')[0]);
  return path.extname(resolved) ? resolved : `${resolved}.js`;
}

const queue = [ENTRY];
const visited = new Set();
const edges = [];
while (queue.length) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  assert.equal(fs.existsSync(file), true, `production import is missing: ${relative(file)}`);
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(STATIC_IMPORT_PATTERN)) {
    const specifier = match[1];
    edges.push({ owner: relative(file), specifier });
    for (const forbidden of FORBIDDEN_PATHS) {
      assert.doesNotMatch(specifier, forbidden, `${relative(file)} imports forbidden Survivors subsystem ${specifier}`);
    }
    const resolved = resolveImport(file, specifier);
    if (!resolved) {
      assert.match(specifier, /^three(?:\/|$)/, `${relative(file)} has an unapproved bare import: ${specifier}`);
      continue;
    }
    assert.ok(resolved.startsWith(path.join(ROOT, 'src') + path.sep), `${relative(file)} imports outside src: ${specifier}`);
    queue.push(resolved);
  }
  for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    const specifier = match[1];
    edges.push({ owner: relative(file), specifier, dynamic: true });
    if (!specifier.startsWith('.')) {
      assert.match(specifier, /^three(?:\/|$)/, `unapproved lazy bare import: ${specifier}`);
      continue;
    }
    // Closed allow-list of lazy production imports, still matched exactly. Both
    // entries are development-gated modes the shell must not pull into the
    // initial bundle. Widening this set is a deliberate act; loosening it to a
    // pattern match would remove the protection entirely.
    assert.ok(
      APPROVED_LAZY_IMPORTS.has(`${relative(file)}:${specifier}`),
      `unapproved lazy production import: ${relative(file)} -> ${specifier}`,
    );
  }
}

const main = fs.readFileSync(ENTRY, 'utf8');
assert.match(main, /bootKakiRally/);
assert.doesNotMatch(main, /enterRacing|bullethell|Survivors/i, 'src/main.js must only boot the standalone rally app');
assert.ok(visited.size >= 70, `standalone graph is unexpectedly small (${visited.size} modules)`);

const graphPaths = [...visited].map(relative);
for (const file of graphPaths) {
  for (const forbidden of FORBIDDEN_PATHS) assert.doesNotMatch(file, forbidden);
  assert.doesNotMatch(file, /^src\/racing\/crash\//, 'normal startup statically imports frozen Catastrophe code');
}

const racingSource = fs.readFileSync(path.join(ROOT, 'src', 'racing', 'index.js'), 'utf8');
assert.doesNotMatch(racingSource, /window\.kkReturnToMenu|window\.kkStartRacing|window\.kkOpenDrawTrackEditor/);
assert.match(racingSource, /navigateToMenu/);

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
assert.match(html, /<title>Kaki Rally<\/title>/);
assert.match(html, /https:\/\/dknos\.github\.io\/kaki-rally\//);
assert.doesNotMatch(html, /Kaki Survivors|Kaki-Survivors-2|Survive the night/i);
assert.doesNotMatch(html, /https?:\/\/[^'"]+\/vendor\/three/, 'Three.js must be served from this repository');

const packageData = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const menuSource = fs.readFileSync(path.join(ROOT, 'src', 'app', 'rallyMenu.js'), 'utf8');
const shellCss = fs.readFileSync(path.join(ROOT, 'src', 'app', 'rallyShell.css'), 'utf8');
assert.equal(RALLY_VERSION, packageData.version, 'menu version and package version diverged');
assert.match(menuSource, /class="rally-version"/, 'main menu has no persistent version label');
assert.match(menuSource, /RALLY_VERSION_LABEL/, 'main menu version is not sourced from the canonical version module');
assert.match(shellCss, /\.rally-version\s*\{/, 'main menu version label is not styled');
assert.doesNotMatch(
  shellCss,
  /@media\s*\(max-width:[^)]+\)[\s\S]{0,600}\.rally-version[^{]*\{[^}]*display:\s*none/,
  'main menu version is hidden at a narrow breakpoint',
);

const runtimeState = fs.readFileSync(path.join(ROOT, 'src', 'core', 'runtimeState.js'), 'utf8');
const config = fs.readFileSync(path.join(ROOT, 'src', 'config.js'), 'utf8');
for (const source of [runtimeState, config]) {
  const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(executable, /\b(?:enemy|weapon|xp|dungeon|spawnDirector|combat)\b/i);
}

console.log(`Kaki Rally standalone boundary passed: ${visited.size} runtime modules, ${edges.length} import edges`);
