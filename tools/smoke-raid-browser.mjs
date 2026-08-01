#!/usr/bin/env node

// Kaki Rally Raid — browser lifecycle and visual evidence.
//
// The headless suite proves the terrain maths. This proves the mode actually
// opens in a real browser, renders, and gives every resource back on exit.
//
// It is deliberately separate from tools/smoke-rally-browser-matrix.mjs, which
// fails on this repository's own baseline in two mobile responsive assertions
// unrelated to Raid.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'qa', 'raid');
const CYCLES = Number(process.argv[process.argv.indexOf('--cycles') + 1]) || 12;

const CHROMIUM = [
  process.env.KAKI_RALLY_CHROMIUM,
  '/home/nemoclaw/bin/chromium',
  chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));
assert(CHROMIUM, 'No Chromium executable is available');

const MIME = new Map([
  ['.html', 'text/html'], ['.js', 'text/javascript'], ['.mjs', 'text/javascript'],
  ['.css', 'text/css'], ['.json', 'application/json'], ['.wasm', 'application/wasm'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.glb', 'model/gltf-binary'],
  ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'],
]);

function serve() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(ROOT, relative);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end('not found');
      return;
    }
    // No COEP: cross-origin isolation is only needed for SharedArrayBuffer, and
    // require-corp blocks the shell's web-font requests so the page never boots.
    response.writeHead(200, {
      'Content-Type': MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let checks = 0;
function pass(message) {
  checks += 1;
  console.log(`  PASS  ${message}`);
}

console.log('Kaki Rally Raid browser lifecycle');
await mkdir(OUT, { recursive: true });
const { server, port } = await serve();
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  // Stub the web fonts the shell requests, exactly as the production matrix
  // does, so boot does not wait on the network.
  await context.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, async (route) => {
    if (route.request().url().includes('googleapis')) {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });

  // ---------------------------------------------------------------------
  // 1. The development route must open the mode.
  const raidRequests = [];
  page.on('request', (request) => {
    if (/\/racing\/raid\//.test(request.url())) raidRequests.push(request.url());
  });

  // The public deep-link shape, with no development flag, because that is the
  // URL a player actually uses.
  await page.goto(`${origin}/index.html?mode=raid&play=1&qa=1&renderer=webgl`, {
    waitUntil: 'load', timeout: 120_000,
  });
  await page.waitForFunction(
    () => document.body.dataset.kakiRallyReady === 'true' && !!window.__kakiRally,
    null, { timeout: 120_000 },
  );
  await page.waitForFunction(
    () => window.__kakiRally?.getSnapshot?.()?.raceMode === 'raid',
    null, { timeout: 180_000 },
  );
  const snapshot = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert.equal(snapshot.raceMode, 'raid', 'the deep link did not enter Raid');
  assert.equal(snapshot.stageId, 'wadi-of-whiskers', `unexpected stage: ${snapshot.stageId}`);
  assert(snapshot.officialDistanceKm > 12, `stage distance is ${snapshot.officialDistanceKm} km`);
  assert(snapshot.sectors.resident > 0, 'no terrain sectors were resident');
  pass(`?mode=raid&play=1 opens ${snapshot.stageName} at ${snapshot.officialDistanceKm} km with ${snapshot.sectors.resident} sectors resident`);

  // ---------------------------------------------------------------------
  // 2. The HUD must be present and namespaced.
  const hud = await page.evaluate(() => {
    const node = document.querySelector('.kkr-hud');
    if (!node) return null;
    return {
      present: true,
      text: node.textContent.trim().slice(0, 200),
      foreign: document.querySelectorAll('[class*="dune-hud"], [class*="rally-hud"]').length,
    };
  });
  assert(hud?.present, 'the Raid HUD did not mount');
  assert.equal(hud.foreign, 0, 'a foreign mode HUD is mounted during Raid');
  pass(`the kkr- HUD is mounted and no other mode's HUD is present`);

  // ---------------------------------------------------------------------
  // 3. Drive it, and capture the result.
  // Hold the throttle through the same touch state sampleInput() already folds
  // into moveVec, so the drive goes through the real input path.
  await page.evaluate(() => { window.__kakiRally.state.input.touch.throttle = true; });
  await page.waitForFunction(
    () => (window.__kakiRally?.getSnapshot?.()?.speedKph || 0) > 12,
    null, { timeout: 60_000 },
  ).catch(() => {});
  const driving = await page.evaluate(() => window.__kakiRally.getSnapshot());
  await page.screenshot({ path: path.join(OUT, 'raid-wadi-of-whiskers-1280.png') });

  if (!(driving.speedKph > 12)) {
    console.log('        STATE NEVER REACHED — the capture does not prove driving');
    failures.push(`vehicle never exceeded 12 km/h (reached ${driving.speedKph.toFixed(1)})`);
  } else {
    pass(`the vehicle drives under its own power (${driving.speedKph.toFixed(1)} km/h on ${driving.surface}) and the frame is captured`);
  }

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'raid-wadi-of-whiskers-844x390.png') });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, 'raid-wadi-of-whiskers-1920.png') });
  pass('captured 1280x720, 1920x1080 and 844x390 landscape');

  // ---------------------------------------------------------------------
  // 4. Enter and exit repeatedly; nothing may accumulate.
  const measure = () => page.evaluate(() => {
    const renderer = window.__kakiRally.state.renderer;
    let sceneChildren = 0;
    window.__kakiRally.state.scene?.traverse?.(() => { sceneChildren += 1; });
    return {
      geometries: renderer?.info?.memory?.geometries ?? 0,
      textures: renderer?.info?.memory?.textures ?? 0,
      sceneChildren,
      raidRoots: (window.__kakiRally.state.scene?.children || []).filter((c) => /^kaki-raid-/.test(c.name)).length,
      hudNodes: document.querySelectorAll('.kkr-hud').length,
      raceMode: window.__kakiRally.state.racing?.raceMode || null,
    };
  });

  const exitToMenu = async () => {
    await page.evaluate(() => window.__kakiRally.app.exitToMenu('qa'));
    await page.waitForFunction(() => !window.__kakiRally.state.racing, null, { timeout: 30_000 });
  };
  const enterRaid = async () => {
    await page.evaluate(() => window.__kakiRally.app.startMode({
      courseId: '', options: { mode: 'raid' },
    }));
    await page.waitForFunction(
      () => window.__kakiRally?.state?.racing?.raceMode === 'raid',
      null, { timeout: 180_000 },
    );
  };

  await exitToMenu();
  const afterFirstExit = await measure();
  assert.equal(afterFirstExit.raidRoots, 0, 'a Raid scene root survived exit');
  assert.equal(afterFirstExit.hudNodes, 0, 'the Raid HUD survived exit');
  assert.equal(afterFirstExit.raceMode, null, 'the session survived exit');
  pass('exiting Raid removes its scene root, its HUD, and its session');

  const baseline = afterFirstExit;
  for (let cycle = 0; cycle < CYCLES; cycle += 1) {
    await enterRaid();
    await exitToMenu();
  }
  const afterCycles = await measure();
  assert.equal(afterCycles.raidRoots, 0, `Raid roots leaked after ${CYCLES} cycles`);
  assert.equal(afterCycles.hudNodes, 0, `Raid HUD leaked after ${CYCLES} cycles`);
  // Allow a small constant for shell-owned caches, but nothing proportional to
  // the number of cycles.
  const geometryGrowth = afterCycles.geometries - baseline.geometries;
  const textureGrowth = afterCycles.textures - baseline.textures;
  const childGrowth = afterCycles.sceneChildren - baseline.sceneChildren;
  assert(
    geometryGrowth <= 4,
    `geometries grew by ${geometryGrowth} over ${CYCLES} enter/exit cycles`,
  );
  assert(textureGrowth <= 4, `textures grew by ${textureGrowth} over ${CYCLES} cycles`);
  assert(childGrowth <= 4, `scene nodes grew by ${childGrowth} over ${CYCLES} cycles`);
  pass(
    `${CYCLES} enter/exit cycles leak nothing `
    + `(geometries ${geometryGrowth >= 0 ? '+' : ''}${geometryGrowth}, textures ${textureGrowth >= 0 ? '+' : ''}${textureGrowth}, `
    + `scene nodes ${childGrowth >= 0 ? '+' : ''}${childGrowth})`,
  );

  // ---------------------------------------------------------------------
  // 5. Raid must not be requested when another mode runs.
  raidRequests.length = 0;
  await page.evaluate(() => window.__kakiRally.app.startMode({
    courseId: 'whiskerwind', options: { mode: 'dunes', duneEvent: 'whiskerwind' },
  }));
  await page.waitForFunction(
    () => window.__kakiRally?.state?.racing?.raceMode === 'dunes',
    null, { timeout: 180_000 },
  );
  await page.waitForTimeout(1500);
  assert.equal(raidRequests.length, 0, `Dune Run requested Raid resources: ${raidRequests.join(', ')}`);
  await page.screenshot({ path: path.join(OUT, 'raid-isolation-dunes-unaffected.png') });
  pass('Kaki Dune Run runs without requesting a single Raid resource');

  await context.close();
} finally {
  await browser.close();
  server.close();
}

assert.equal(failures.length, 0, `browser reported errors:\n${failures.join('\n')}`);
await writeFile(
  path.join(OUT, 'raid-browser.json'),
  `${JSON.stringify({ checks, cycles: CYCLES, capturedAt: 'see git history' }, null, 2)}\n`,
);
console.log(`\nKaki Rally Raid browser lifecycle passed: ${checks} contracts, ${CYCLES} enter/exit cycles`);
