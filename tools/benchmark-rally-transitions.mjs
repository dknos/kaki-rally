#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARDWARE = process.argv.includes('--hardware');
const NATIVE_WINDOWS = process.platform === 'win32';
const argumentValue = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? Number(process.argv[index + 1]) || fallback : fallback;
};
const VIEWPORT = {
  width: Math.max(640, Math.round(argumentValue('--width', 1280))),
  height: Math.max(360, Math.round(argumentValue('--height', 720))),
};
const SESSION_COUNT = Math.max(1, Math.round(argumentValue('--sessions', 25)));
const OUTPUT = path.join(
  ROOT,
  'docs',
  'qa',
  HARDWARE
    ? `performance-hardware-${VIEWPORT.width}x${VIEWPORT.height}.json`
    : 'performance-transitions.json',
);
const SOURCE_COMMIT = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const SOURCE_TREE_DIRTY = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0;
const CHROMIUM = [
  process.env.KAKI_RALLY_CHROMIUM,
  '/home/nemoclaw/bin/chromium',
  chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));
assert(CHROMIUM, 'No Chromium executable is available');

const baseSequence = [
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
const sequence = Array.from({ length: SESSION_COUNT }, (_, index) => baseSequence[index % baseSequence.length]);

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
  const median = percentile(values, 0.5);
  const p95 = percentile(values, 0.95);
  const p99 = percentile(values, 0.99);
  return {
    samples: values.length,
    averageMs: Number(average.toFixed(3)),
    medianMs: Number(median.toFixed(3)),
    p95Ms: Number(p95.toFixed(3)),
    p99Ms: Number(p99.toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
    averageFps: Number((1000 / Math.max(0.001, average)).toFixed(2)),
    medianFps: Number((1000 / Math.max(0.001, median)).toFixed(2)),
    onePercentLowFps: Number((1000 / Math.max(0.001, p99)).toFixed(2)),
    warmedSpikeCount: values.filter((value) => value > median + 4).length,
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
    ...(HARDWARE
      ? (NATIVE_WINDOWS ? [] : ['--use-angle=gl'])
      : ['--use-gl=swiftshader']),
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-precise-memory-info',
  ],
});
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
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
  sourceCommit: SOURCE_COMMIT,
  sourceTreeDirty: SOURCE_TREE_DIRTY,
  environment: {
    browser: CHROMIUM,
    renderer: 'webgl',
    gpuProfile: HARDWARE ? 'pending browser renderer query' : 'SwiftShader software WebGL',
    adapterSelector: process.env.MESA_D3D12_DEFAULT_ADAPTER_NAME || '',
    viewport: [VIEWPORT.width, VIEWPORT.height],
    quality: VIEWPORT.width >= 2560 ? 'ultra' : 'high',
    physicalGpu: HARDWARE,
    sessions: SESSION_COUNT,
    runtime: NATIVE_WINDOWS ? 'Windows native Chrome' : 'Linux Chromium under WSL',
    note: HARDWARE
      ? (NATIVE_WINDOWS
          ? 'Native Windows Chrome physical-adapter measurement; this does not establish phone thermals.'
          : 'Physical D3D12 adapter measured through WSL/ANGLE; this does not establish phone thermals.')
      : 'Comparative CI evidence only; software rendering does not predict physical-device thermals or frame pacing.',
  },
  browserDiagnostics,
  transitions: [],
};

try {
  await page.addInitScript(() => {
    localStorage.setItem('kaki_rally_settings_v1', JSON.stringify({
      renderer: 'webgl',
      quality: innerWidth >= 2560 ? 'ultra' : 'high',
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
  report.environment.webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      webgl2: !!gl,
      vendor: gl && extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : '',
      renderer: gl && extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : '',
    };
  });
  report.environment.gpuProfile = report.environment.webgl.renderer || 'unreported WebGL adapter';
  if (HARDWARE) {
    assert(
      report.environment.webgl.webgl2
        && !/swiftshader|llvmpipe|software/i.test(report.environment.webgl.renderer),
      `hardware benchmark did not acquire a physical adapter: ${report.environment.webgl.renderer}`,
    );
  }

  // The first authored scene compiles and retains renderer-wide post-processing
  // support resources. Establish the leak baseline after that one-time warmup,
  // then require all twenty-five measured sessions to return to the same counters.
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
    const enterDurationMs = Date.now() - startedAt;
    // Scene construction intentionally happens behind the branded transition
    // and countdown. Let upload/compilation garbage settle before measuring
    // interactive play so a legal transition is not mislabeled as a race hitch.
    await page.evaluate(() => new Promise((resolve) => {
      // Match the normal 3.4 second countdown. This is the period during which
      // every visible pack material and effect is intentionally rendered once.
      let frames = innerWidth >= 2560 ? 240 : 210;
      const settle = () => {
        frames--;
        if (frames <= 0) resolve();
        else requestAnimationFrame(settle);
      };
      requestAnimationFrame(settle);
    }));
    const frameDeltas = await page.evaluate(() => new Promise((resolve) => {
      const values = [];
      let previous = performance.now();
      const frame = (now) => {
        values.push(now - previous);
        previous = now;
        if (values.length >= (innerWidth >= 2560 ? 180 : 120)) resolve(values);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }));
    const active = await page.evaluate(() => ({
      ...window.__kakiRally.getDiagnostics(),
      jsHeapBytes: performance.memory?.usedJSHeapSize || 0,
    }));
    assert(active.renderer.drawCalls > 0, `${mode} made no render submissions`);
    assert.equal(active.hudRoots, 1, `${mode} has the wrong HUD count`);
    let restartDurationMs = null;
    if (index < 5) {
      const restartStartedAt = Date.now();
      assert(
        await page.evaluate(() => window.__kakiRally.restart().then(Boolean)),
        `${mode} failed its measured restart`,
      );
      await page.waitForFunction((expected) => (
        window.__kakiRally.getDiagnostics().activeMode === expected
      ), mode, { timeout: 120_000 });
      await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
      await page.evaluate(() => window.__kkRacing?.skipCountdown?.());
      await page.evaluate(() => new Promise((resolve) => (
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )));
      restartDurationMs = Date.now() - restartStartedAt;
    }
    await page.evaluate((label) => window.__kakiRally.captureTransition(label), `benchmark:${index + 1}`);
    await page.evaluate(() => window.__kakiRally.menu());
    await page.waitForFunction(() => {
      const diagnostics = window.__kakiRally.getDiagnostics();
      return diagnostics.appMode === 'menu' && diagnostics.hudRoots === 0 && diagnostics.sessionRoots === 0;
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const afterExit = await page.evaluate(() => ({
      ...window.__kakiRally.getDiagnostics(),
      jsHeapBytes: performance.memory?.usedJSHeapSize || 0,
    }));
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
      enterDurationMs,
      restartDurationMs,
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
        estimatedGpuMemoryBytes: active.estimatedGpuMemoryBytes,
        jsHeapBytes: active.jsHeapBytes,
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
        estimatedGpuMemoryBytes: afterExit.estimatedGpuMemoryBytes,
        jsHeapBytes: afterExit.jsHeapBytes,
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
    frameP99WorstMs: Math.max(...report.transitions.map((entry) => entry.frames.p99Ms)),
    minimumOnePercentLowFps: Math.min(...report.transitions.map((entry) => entry.frames.onePercentLowFps)),
    warmedSpikeCount: report.transitions.reduce((sum, entry) => sum + entry.frames.warmedSpikeCount, 0),
    enterP95Ms: percentile(report.transitions.map((entry) => entry.enterDurationMs), 0.95),
    restartP95Ms: percentile(
      report.transitions.map((entry) => entry.restartDurationMs).filter(Number.isFinite),
      0.95,
    ),
    peakDrawCalls: Math.max(...report.transitions.map((entry) => entry.active.drawCalls)),
    peakTriangles: Math.max(...report.transitions.map((entry) => entry.active.triangles)),
    peakEstimatedGpuMemoryBytes: Math.max(...report.transitions.map((entry) => entry.active.estimatedGpuMemoryBytes)),
    peakJsHeapBytes: Math.max(...report.transitions.map((entry) => entry.active.jsHeapBytes)),
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
  assert.equal(report.summary.entries, SESSION_COUNT);
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
