#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs', 'qa', 'world-assets', 'after');
const ORIGIN = process.env.KAKI_RALLY_QA_ORIGIN || 'http://127.0.0.1:4173';
const CHROMIUM = [
  process.env.KAKI_RALLY_CHROMIUM,
  '/home/nemoclaw/bin/chromium',
  chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));
assert(CHROMIUM, 'No Chromium executable is available');

const allCaptures = [
  { name: 'webgl-offroad-borrowed-post-1920x1080-high', viewport: [1920, 1080], quality: 'high', mode: 'circuit', course: 'forest', showcase: .01, options: { carCount: 1 } },
  { name: 'webgl-whisker-yard-1920x1080-high', viewport: [1920, 1080], quality: 'high', mode: 'drift', course: 'twilight', showcase: .30, options: { carCount: 1 } },
  { name: 'webgl-whisker-yard-1920x1080-low', viewport: [1920, 1080], quality: 'low', mode: 'drift', course: 'twilight', showcase: .56, options: { carCount: 1 } },
  { name: 'webgl-thunderbowl-2560x1440-medium', viewport: [2560, 1440], quality: 'medium', mode: 'stock', course: 'cinder', showcase: .08, options: { carCount: 1, stockVariant: 'clay' } },
  { name: 'webgl-monster-smash-5120x1440-high', viewport: [5120, 1440], quality: 'high', mode: 'monster', course: 'forest', options: { monsterArena: 'crown-chaos-coliseum', monsterEvent: 'free-ride', monsterVehicle: 'meowster' } },
  { name: 'webgl-dune-whiskerwind-1920x1080-low', viewport: [1920, 1080], quality: 'low', mode: 'dunes', course: 'whiskerwind', options: { duneEvent: 'whiskerwind', duneVehicle: 'meowster', duneTerrain: 'low', duneDeformation: 'low', duneParticles: 'low', duneDust: 'low', duneShadow: 'low' } },
  { name: 'webgl-trials-meadow-1920x1080-medium', viewport: [1920, 1080], quality: 'medium', mode: 'trials', course: 'forest', skipWarp: true, driveMs: 300, options: { trialsTrackId: 'meadow', trialsVehicle: 'monster' } },
  { name: 'webgl-rally-raid-1920x1080-high', viewport: [1920, 1080], quality: 'high', mode: 'raid', course: 'forest', options: {} },
];
const onlyIndex = process.argv.indexOf('--only');
const onlyPattern = onlyIndex >= 0 ? String(process.argv[onlyIndex + 1] || '') : '';
const captures = onlyPattern
  ? allCaptures.filter((capture) => capture.name.includes(onlyPattern))
  : allCaptures;
assert(captures.length > 0, `No world-asset capture matched --only ${onlyPattern}`);

await mkdir(OUTPUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const report = { schema: 1, generatedAt: new Date().toISOString(), origin: ORIGIN, captures: [] };

try {
  for (const spec of captures) {
    const context = await browser.newContext({
      viewport: { width: spec.viewport[0], height: spec.viewport[1] },
      deviceScaleFactor: 1,
    });
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !/ERR_ABORTED|AudioContext/i.test(message.text())) errors.push(message.text());
    });
    await page.addInitScript(({ quality }) => {
      localStorage.setItem('kaki_rally_settings_v1', JSON.stringify({
        renderer: 'webgl', quality, lastDriver: 'kitty', camera: 'chase',
      }));
    }, { quality: spec.quality });
    await page.goto(`${ORIGIN}/?qa=1&renderer=webgl`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForFunction(() => document.body.dataset.kakiRallyReady === 'true' && !!window.__kakiRally, null, { timeout: 120_000 });
    const started = await page.evaluate(({ mode, course, options, quality }) => (
      window.__kakiRally.start(mode, course, { ...options, quality }).then(Boolean)
    ), spec);
    assert(started, `${spec.name} did not start`);
    await page.waitForFunction((mode) => window.__kakiRally.getDiagnostics().activeMode === mode, spec.mode, { timeout: 120_000 });
    await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
    await page.evaluate(({ mode, showcase, checkpoint, skipWarp }) => {
      window.__kkRacing?.skipCountdown?.();
      if (mode === 'trials') window.__kkRacing?.setCameraMode?.('isometric');
      if (window.__kakiRally.state.racing) window.__kakiRally.state.racing.goFlash = 0;
      if (!skipWarp && ['circuit', 'drift', 'stock', 'monster'].includes(mode)) {
        window.__kkRacing?.warpShowcase?.(showcase ?? 0.32);
      } else if (!skipWarp && mode === 'trials') {
        window.__kkRacing?.warpCheckpoint?.(checkpoint ?? 0);
      }
    }, spec);
    await page.waitForTimeout(250);
    await page.keyboard.down('w');
    await page.waitForTimeout(spec.driveMs ?? 1500);
    await page.keyboard.up('w');
    await page.evaluate(() => {
      const session = window.__kakiRally.state.racing;
      if (!session) return;
      session.goFlash = 0;
      session.goTime = 0;
      session.callout = '';
      session.calloutTime = 0;
      session.hud?.countdown && (session.hud.countdown.textContent = '');
      session.hud?.callout && (session.hud.callout.textContent = '');
    });
    await page.waitForTimeout(350);
    const snapshot = await page.evaluate(() => window.__kakiRally.getSnapshot());
    const world = snapshot?.environment?.worldLiveness
      || snapshot?.monster?.worldLiveness
      || snapshot?.worldLiveness
      || null;
    assert(world?.placementCount > 0, `${spec.name} did not attach its world-liveness composition`);
    const file = path.join(OUTPUT, `${spec.name}.png`);
    await page.screenshot({ path: file });
    const diagnostics = await page.evaluate(() => window.__kakiRally.getDiagnostics());
    assert.equal(diagnostics.backend, 'webgl');
    assert.equal(errors.length, 0, `${spec.name} emitted browser errors: ${errors.join(' | ')}`);
    report.captures.push({
      name: spec.name,
      mode: spec.mode,
      quality: spec.quality,
      viewport: spec.viewport,
      world,
      renderer: diagnostics.renderer,
      file: path.relative(ROOT, file),
    });
    await page.evaluate(() => window.__kakiRally.menu());
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(path.join(OUTPUT, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`World-asset QA capture passed: ${report.captures.length} driven scenes across low/medium/high and 1920/2560/5120 widths.`);
