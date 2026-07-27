#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'docs', 'qa', 'performance-transitions.json');
const CHROMIUM = [
  process.env.KAKI_RALLY_CHROMIUM,
  '/home/nemoclaw/bin/chromium',
  chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));
assert(CHROMIUM, 'No Chromium executable is available');

const sequence = [
  ['circuit', 'forest', { carCount: 6 }],
  ['drift', 'twilight', { carCount: 6 }],
  ['stock', 'cinder', { carCount: 12 }],
  ['monster', 'forest', { carCount: 1, monsterArena: 'crown-chaos-coliseum', monsterEvent: 'free-ride' }],
  ['trials', 'forest', { trialsTrackId: 'meadow', trialsVehicle: 'monster' }],
  ['circuit', 'kakiland', { carCount: 8 }],
  ['drift', 'void', { carCount: 6 }],
  ['stock', 'cave', { carCount: 12 }],
  ['monster', 'forest', { carCount: 1, monsterArena: 'pileup-pyramid-yard', monsterEvent: 'freestyle', monsterVehicle: 'cyber' }],
  ['trials', 'forest', { trialsTrackId: 'quarry', trialsVehicle: 'buggy' }],
];

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function summarize(values) {
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    samples: values.length,
    averageMs: Number(average.toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
    averageFps: Number((1000 / Math.max(0.001, average)).toFixed(2)),
  };
}

function createServer() {
  return http.createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(ROOT, `.${requested}`);
    const relative = path.relative(ROOT, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.code || 'Read error');
        return;
      }
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    });
  });
}

const server = createServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  executablePath: CHROMIUM,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-precise-memory-info',
  ],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await context.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, (route) => route.fulfill({
  status: 204,
  body: '',
}));
const page = await context.newPage();
const browserDiagnostics = { pageErrors: [], consoleErrors: [], badResponses: [] };
page.on('pageerror', (error) => browserDiagnostics.pageErrors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error' && !/menu_glitch\.mp3.*ERR_ABORTED/i.test(message.text())) {
    browserDiagnostics.consoleErrors.push(message.text());
  }
});
page.on('response', (response) => {
  if (response.url().startsWith(origin) && response.status() >= 400) {
    browserDiagnostics.badResponses.push(`${response.status()} ${response.url()}`);
  }
});

const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  sourceCommit: '3711e8fc0c2c86b27911171c5394723ceb9e45aa',
  environment: {
    browser: CHROMIUM,
    renderer: 'webgl',
    gpuProfile: 'SwiftShader software WebGL',
    viewport: [1280, 720],
    note: 'Comparative CI evidence only; software rendering does not predict physical-device thermals or frame pacing.',
  },
  browserDiagnostics,
  transitions: [],
};

try {
  await page.addInitScript(() => {
    localStorage.setItem('kaki_rally_settings_v1', JSON.stringify({
      renderer: 'webgl',
      quality: 'high',
      lastDriver: 'kitty',
      camera: 'chase',
    }));
  });
  await page.goto(`${origin}/index.html?qa=1&renderer=webgl`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__kakiRally && document.body.dataset.kakiRallyReady === 'true', null, {
    timeout: 120_000,
  });
  report.coldBaseline = await page.evaluate(() => window.__kakiRally.getDiagnostics());
  assert.equal(report.coldBaseline.backend, 'webgl');

  // The first authored scene compiles and retains renderer-wide post-processing
  // support resources. Establish the leak baseline after that one-time warmup,
  // then require all ten measured sessions to return to the same counters.
  assert(await page.evaluate(() => window.__kakiRally.start('circuit', 'forest', { carCount: 2 }).then(Boolean)));
  await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  await page.evaluate(() => window.__kkRacing?.skipCountdown?.());
  await page.evaluate(() => new Promise((resolve) => {
    let frames = 4;
    const step = () => { if (--frames <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }));
  await page.evaluate(() => window.__kakiRally.menu());
  await page.waitForFunction(() => window.__kakiRally.getDiagnostics().sessionRoots === 0);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  report.baseline = await page.evaluate(() => window.__kakiRally.getDiagnostics());

  for (let index = 0; index < sequence.length; index++) {
    const [mode, courseId, options] = sequence[index];
    const startedAt = Date.now();
    const started = await page.evaluate(
      ({ mode, courseId, options }) => window.__kakiRally.start(mode, courseId, options).then(Boolean),
      { mode, courseId, options },
    );
    assert(started, `transition ${index + 1} failed to enter ${mode}`);
    await page.waitForFunction((expected) => window.__kakiRally.getDiagnostics().activeMode === expected, mode, {
      timeout: 120_000,
    });
    if (mode === 'crash') {
      await page.waitForFunction(() => window.__kkCrash?.snapshot?.()?.worldReady);
    } else {
      await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
    }
    await page.evaluate(() => window.__kkRacing?.skipCountdown?.());
    const frameDeltas = await page.evaluate(() => new Promise((resolve) => {
      const values = [];
      let previous = performance.now();
      const frame = (now) => {
        values.push(now - previous);
        previous = now;
        if (values.length >= 24) resolve(values);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }));
    const active = await page.evaluate(() => window.__kakiRally.getDiagnostics());
    assert(active.renderer.drawCalls > 0, `${mode} made no render submissions`);
    assert.equal(active.hudRoots, 1, `${mode} has the wrong HUD count`);
    await page.evaluate((label) => window.__kakiRally.captureTransition(label), `benchmark:${index + 1}`);
    await page.evaluate(() => window.__kakiRally.menu());
    await page.waitForFunction(() => {
      const diagnostics = window.__kakiRally.getDiagnostics();
      return diagnostics.appMode === 'menu' && diagnostics.hudRoots === 0 && diagnostics.sessionRoots === 0;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterExit = await page.evaluate(() => window.__kakiRally.getDiagnostics());
    assert.equal(afterExit.sceneObjects, report.baseline.sceneObjects, `scene object leak after transition ${index + 1}`);
    assert.equal(afterExit.hudRoots, 0, `HUD leak after transition ${index + 1}`);
    assert.equal(afterExit.sessionRoots, 0, `scene-root leak after transition ${index + 1}`);
    assert(Math.abs(afterExit.domNodes - report.baseline.domNodes) <= 3, `DOM leak after transition ${index + 1}`);
    assert.equal(afterExit.renderer.textures, report.baseline.renderer.textures, `texture leak after transition ${index + 1}`);
    assert.equal(afterExit.renderer.geometries, report.baseline.renderer.geometries, `geometry leak after transition ${index + 1}`);
    assert.equal(afterExit.renderer.renderTargets, report.baseline.renderer.renderTargets, `render-target leak after transition ${index + 1}`);
    report.transitions.push({
      index: index + 1,
      mode,
      courseId,
      enterDurationMs: Date.now() - startedAt,
      frames: summarize(frameDeltas),
      active: {
        domNodes: active.domNodes,
        sceneObjects: active.sceneObjects,
        sessionRoots: active.sessionRoots,
        drawCalls: active.renderer.drawCalls,
        triangles: active.renderer.triangles,
        textures: active.renderer.textures,
        geometries: active.renderer.geometries,
        renderTargets: active.renderer.renderTargets,
        gpuMemoryBytes: active.renderer.gpuMemoryBytes,
        cpuFrameTimeMs: active.renderer.cpuFrameTimeMs,
        cpuFrameTimeP99Ms: active.renderer.cpuFrameTimeP99Ms,
        renderSubmissionTimeMs: active.renderer.renderSubmissionTimeMs,
      },
      afterExit: {
        domNodes: afterExit.domNodes,
        sceneObjects: afterExit.sceneObjects,
        sessionRoots: afterExit.sessionRoots,
        hudRoots: afterExit.hudRoots,
        textures: afterExit.renderer.textures,
        geometries: afterExit.renderer.geometries,
        renderTargets: afterExit.renderer.renderTargets,
        gpuMemoryBytes: afterExit.renderer.gpuMemoryBytes,
        racingAudio: afterExit.audio.racingActive,
      },
    });
  }

  report.final = await page.evaluate(() => window.__kakiRally.getDiagnostics());
  report.summary = {
    entries: report.transitions.length,
    lifecycleTransitions: report.final.stateDiagnostics.modeTransitions - report.baseline.stateDiagnostics.modeTransitions,
    frameAverageMs: Number((
      report.transitions.reduce((sum, entry) => sum + entry.frames.averageMs, 0)
      / report.transitions.length
    ).toFixed(3)),
    frameP95WorstMs: Math.max(...report.transitions.map((entry) => entry.frames.p95Ms)),
    peakDrawCalls: Math.max(...report.transitions.map((entry) => entry.active.drawCalls)),
    peakTriangles: Math.max(...report.transitions.map((entry) => entry.active.triangles)),
    peakDomNodes: Math.max(...report.transitions.map((entry) => entry.active.domNodes)),
    peakSceneObjects: Math.max(...report.transitions.map((entry) => entry.active.sceneObjects)),
    baselineDomNodes: report.baseline.domNodes,
    finalDomNodes: report.final.domNodes,
    baselineSceneObjects: report.baseline.sceneObjects,
    finalSceneObjects: report.final.sceneObjects,
    baselineTextures: report.baseline.renderer.textures,
    finalTextures: report.final.renderer.textures,
    baselineGeometries: report.baseline.renderer.geometries,
    finalGeometries: report.final.renderer.geometries,
    baselineRenderTargets: report.baseline.renderer.renderTargets,
    finalRenderTargets: report.final.renderer.renderTargets,
  };
  assert.equal(report.summary.entries, 10);
  assert.equal(report.summary.finalDomNodes, report.summary.baselineDomNodes);
  assert.equal(report.summary.finalSceneObjects, report.summary.baselineSceneObjects);
  assert.equal(report.summary.finalTextures, report.summary.baselineTextures);
  assert.equal(report.summary.finalGeometries, report.summary.baselineGeometries);
  assert.equal(report.summary.finalRenderTargets, report.summary.baselineRenderTargets);
  for (const key of ['pageErrors', 'consoleErrors', 'badResponses']) {
    assert.deepEqual(browserDiagnostics[key], [], `${key}: ${browserDiagnostics[key].join(' | ')}`);
  }
} finally {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log(
  `Kaki Rally transition benchmark passed: ${report.summary.entries} entries, `
  + `${report.summary.lifecycleTransitions} lifecycle transitions, `
  + `${report.summary.baselineDomNodes}→${report.summary.finalDomNodes} DOM nodes, `
  + `${report.summary.baselineSceneObjects}→${report.summary.finalSceneObjects} scene objects`,
);
