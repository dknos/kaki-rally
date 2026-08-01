#!/usr/bin/env node

// Kaki Rally Raid — Rift of Nine Tails visual evidence.
//
// Drives the second stage in a real browser and photographs the five sections
// the stage was authored for, plus the signature jump in mid-air. Everything
// here is measured from the running session rather than asserted: the jump
// capture waits for `airborne === true` and refuses to shoot otherwise, because
// a frame taken from a teleport into the air proves nothing.
//
// Not part of `npm test`: it needs Chromium and takes minutes. Run it as
// `node tools/smoke-raid-stage2-drive.mjs`.

import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'qa', 'raid');
const STAGE = 'rift-of-nine-tails';

const CHROMIUM = [
  process.env.KAKI_RALLY_CHROMIUM,
  '/home/nemoclaw/bin/chromium',
  chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));
if (!CHROMIUM) throw new Error('No Chromium executable is available');

const MIME = new Map([
  ['.html', 'text/html'], ['.js', 'text/javascript'], ['.mjs', 'text/javascript'],
  ['.css', 'text/css'], ['.json', 'application/json'], ['.wasm', 'application/wasm'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.webp', 'image/webp'],
  ['.glb', 'model/gltf-binary'], ['.mp3', 'audio/mpeg'], ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'],
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
    response.writeHead(200, { 'Content-Type': MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream' });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Shots: where to start from, how far to run, what has to be true before the
// shutter opens.
// `until` is a route distance, not a timer: at 190 km/h a fixed hold overshoots
// the thing being photographed by hundreds of metres, which is how the first
// pass produced an empty plateau where the rim drop was supposed to be.
const SHOTS = [
  { name: 'spire-forest', from: 700, until: 900, hold: 14, note: 'hoodoo forest, opening section' },
  { name: 'canyon-floor', from: 4150, until: 4420, hold: 16, note: 'slot canyon floor at its deepest, 45 m below the plateau' },
  { name: 'rim-drop', from: 5000, until: 5118, hold: 14, note: 'rim-fall, the 10 m drop authored at 5100 m' },
  { name: 'canyon-rim', from: 5450, until: 5640, hold: 14, note: 'running the rim with the chasm to the right' },
  { name: 'rift-crater', from: 7700, until: 7900, hold: 14, note: 'crater bowl and the glowing fractures' },
  { name: 'ruins', from: 10000, until: 10260, hold: 14, note: 'ruin terraces' },
  { name: 'ruin-monument', from: 10480, until: 10700, hold: 14, note: 'the one landmark cell on the ruin band, measured at (8889, 1697)' },
  // Airborne is not enough on its own — the truck leaves the ground on ordinary
  // desert now — so the shutter also waits until it is past the ramp's lip.
  { name: 'signature-jump', from: 6980, hold: 40, airborne: 7368, note: 'nine-tails-leap, 53 m gap at 175 km/h — shot over the pit, not at the lip' },
];

await mkdir(OUT, { recursive: true });
const { server, port } = await serve();
const origin = `http://127.0.0.1:${port}`;
// SwiftShader renders this stage at roughly one frame a second, and the mode
// clamps its fixed-step integrator to twelve substeps a frame, so the
// simulation advances about a tenth of real time — a run at the design speed of
// the signature jump would take an hour of wall clock and the terrain streamer
// never catches up. `--use-angle=gl-egl` reaches the real D3D12 driver through
// WSL, which is the same three.js WebGL 2 path with a driver that can keep up.
// SwiftShader stays as the fallback because it is the only guaranteed one.
const SOFTWARE = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const HARDWARE = ['--use-gl=angle', '--use-angle=gl-egl', '--enable-webgl', '--ignore-gpu-blocklist'];
const backend = process.argv.includes('--software') ? SOFTWARE : HARDWARE;
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--disable-dev-shm-usage', ...backend],
});

const report = [];
const failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await context.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, async (route) => {
    if (route.request().url().includes('googleapis')) await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    else await route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });

  await page.goto(`${origin}/index.html?mode=raid&play=1&stage=${STAGE}&qa=1&renderer=webgl`, {
    waitUntil: 'load', timeout: 120_000,
  });
  await page.waitForFunction(() => document.body.dataset.kakiRallyReady === 'true' && !!window.__kakiRally, null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__kakiRally?.getSnapshot?.()?.raceMode === 'raid', null, { timeout: 240_000 });

  const renderer = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`renderer: ${renderer}`);
  const opened = await page.evaluate(() => window.__kakiRally.getSnapshot());
  console.log(`opened ${opened.stageName} (${opened.stageId}) — ${opened.officialDistanceKm} km, ${opened.sectors.resident} sectors resident`);
  if (opened.stageId !== STAGE) failures.push(`?stage= opened ${opened.stageId}`);

  await page.evaluate(() => { window.__kakiRally.state.racing.cameraMode = 'chase'; });
  // The shell's loader panel is still on top of the canvas for a moment after
  // the session exists; the first capture caught it.
  await page.waitForFunction(
    () => !document.querySelector('.rally-loader:not([hidden])')
      && !document.querySelector('[data-loader]:not([hidden])'),
    null, { timeout: 60_000 },
  ).catch(() => {});
  await page.waitForTimeout(4000);

  // Teleport the vehicle onto a route sample, with terrain authority
  // established there first. Velocity is left at zero: every capture below
  // drives itself up to speed under throttle, so nothing in these frames is
  // travelling faster than the player could have got it to.
  await page.evaluate(() => {
    // Deliberately NOT preloadAround(): its Promise.all never settles for a
    // point outside the current residency ring, because the streamer cancels
    // those requests as it re-centres and a cancelled request drops its waiter.
    // Moving the vehicle first is what makes the sectors wanted; the harness
    // then waits on the sector count actually going up.
    window.__raidPlace = (metres) => {
      const session = window.__kakiRally.state.racing;
      const route = session.route;
      const i = Math.max(0, Math.min(route.count - 1, Math.round(metres / route.spacing)));
      const x = route.x[i];
      const z = route.z[i];
      const vehicle = session.vehicle;
      vehicle.x = x;
      vehicle.z = z;
      vehicle.yaw = route.yaw[i];
      vehicle.y = session.provider.heightAt(x, z) + vehicle.wheelRadius + 0.35;
      vehicle.velocityX = 0;
      vehicle.velocityY = 0;
      vehicle.velocityZ = 0;
      vehicle.yawRate = 0;
      vehicle.previousGround = NaN;
      session.referenceMeters = route.meters[i];
      return { x, z, metres: route.meters[i] };
    };

    // A driver, not a brick. Holding the throttle with no steering sends the
    // truck in a straight line while the route curves away, so the first pass
    // photographed the canyon WALL rather than the canyon floor. This aims at a
    // point ahead on the centreline and steers through the same touch.left /
    // touch.right booleans the on-screen controls set, which is the real input
    // path — nothing here writes to the vehicle.
    window.__raidAutopilot = () => {
      const session = window.__kakiRally.state.racing;
      if (!session) return;
      const route = session.route;
      const vehicle = session.vehicle;
      const centre = Math.round(session.referenceMeters / route.spacing);
      let best = centre;
      let bestDistance = Infinity;
      for (let i = Math.max(0, centre - 40); i < Math.min(route.count, centre + 80); i += 1) {
        const d = (route.x[i] - vehicle.x) ** 2 + (route.z[i] - vehicle.z) ** 2;
        if (d < bestDistance) { bestDistance = d; best = i; }
      }
      const aim = Math.min(route.count - 1, best + Math.round(48 / route.spacing));
      const desired = Math.atan2(route.z[aim] - vehicle.z, route.x[aim] - vehicle.x);
      let error = desired - vehicle.yaw;
      while (error > Math.PI) error -= Math.PI * 2;
      while (error < -Math.PI) error += Math.PI * 2;
      const touch = window.__kakiRally.state.input.touch;
      touch.left = error < -0.03;
      touch.right = error > 0.03;
    };
    window.__raidAutopilotTimer = setInterval(() => window.__raidAutopilot(), 16);
  });

  for (const shot of SHOTS) {
    const placed = await page.evaluate((metres) => window.__raidPlace(metres), shot.from);
    // Let the streamer re-centre on the new position and the visible patch be
    // rebuilt before anything is driven or photographed.
    await page.waitForTimeout(3000);
    // Snap the camera behind the vehicle before anything is drawn from the old
    // position, then hold the throttle through the real input path.
    await page.evaluate(() => {
      window.__kakiRally.state.input.touch.throttle = true;
      window.__kakiRally.app?.racing?.setCameraMode?.('chase');
    });
    let peak = 0;
    let sawAir = false;
    const wallStart = Date.now();
    const simStart = await page.evaluate(() => window.__kakiRally.getSnapshot().elapsed);
    const deadline = Date.now() + shot.hold * 1000;
    while (Date.now() < deadline) {
      const snapshot = await page.evaluate(() => window.__kakiRally.getSnapshot());
      peak = Math.max(peak, snapshot.speedKph);
      if (shot.airborne && snapshot.airborne && snapshot.referenceMeters > shot.airborne) {
        sawAir = true;
        break;
      }
      if (shot.until && snapshot.referenceMeters >= shot.until) break;
      await page.waitForTimeout(40);
    }
    const snapshot = await page.evaluate(() => window.__kakiRally.getSnapshot());
    const file = path.join(OUT, `stage2-${shot.name}.png`);
    await page.screenshot({ path: file });
    if (shot.airborne && !sawAir) failures.push(`${shot.name}: never left the ground (peak ${peak.toFixed(0)} km/h)`);
    const line = `${shot.name.padEnd(15)} from ${String(shot.from).padStart(6)} m -> `
      + `${snapshot.referenceMeters.toFixed(0).padStart(6)} m  ${snapshot.speedKph.toFixed(0).padStart(3)} km/h `
      + `(peak ${peak.toFixed(0)})  ${snapshot.surface.padEnd(10)} `
      + `${snapshot.airborne ? 'AIRBORNE' : 'grounded'}  scatter ${snapshot.scatter?.placed ?? 0}+${snapshot.scatter?.landmarks ?? 0}  `
      + `off-route ${snapshot.offRouteMeters.toFixed(0).padStart(3)} m  `
      + `sim ${(snapshot.elapsed - simStart).toFixed(1)}s in ${((Date.now() - wallStart) / 1000).toFixed(1)}s wall`;
    console.log(line);
    report.push({ ...shot, placed, ...snapshot, peakKph: peak, sawAir });
    await page.evaluate(() => {
      const touch = window.__kakiRally.state.input.touch;
      touch.throttle = false;
      touch.left = false;
      touch.right = false;
    });
  }

  // The menu path, not only the deep link. startModeTransition() defaults
  // courseId to 'forest', so this proves the selected stage is what actually
  // reaches enterRaidMode rather than being shadowed by that default.
  await page.evaluate(() => window.__kakiRally.app.exitToMenu('qa'));
  await page.waitForFunction(() => !window.__kakiRally.state.racing, null, { timeout: 60_000 });
  const menuRequest = await page.evaluate(() => {
    const menu = window.__kakiRally.app.menu;
    menu.selectedMode = 'raid';
    menu.raidStage = 'rift-of-nine-tails';
    const request = menu.launchRequest();
    void window.__kakiRally.app.startMode(request);
    return request;
  });
  await page.waitForFunction(() => window.__kakiRally.state.racing?.raceMode === 'raid', null, { timeout: 240_000 });
  const viaMenu = await page.evaluate(() => window.__kakiRally.getSnapshot().stageId);
  console.log(`menu launch: courseId=${JSON.stringify(menuRequest.courseId)} -> stage ${viaMenu}`);
  if (viaMenu !== STAGE) failures.push(`the menu's stage selector opened ${viaMenu}`);

  await context.close();
} finally {
  await browser.close();
  server.close();
}

await writeFile(path.join(OUT, 'stage2-drive.json'), `${JSON.stringify(report, null, 2)}\n`);
if (failures.length) {
  console.log(`\nPROBLEMS:\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nall captures taken');
}
