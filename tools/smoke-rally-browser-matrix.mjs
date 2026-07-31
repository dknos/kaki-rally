#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedBackend = process.argv.includes('--backend')
  ? process.argv[process.argv.indexOf('--backend') + 1]
  : 'all';
assert(['all', 'webgl', 'webgpu'].includes(requestedBackend), `Unknown backend: ${requestedBackend}`);
const requestedScope = process.argv.includes('--scope')
  ? process.argv[process.argv.indexOf('--scope') + 1]
  : 'all';
const catastropheRequested = process.argv.includes('--catastrophe');
assert(
  requestedScope !== 'crash' || catastropheRequested,
  'The frozen Catastrophe matrix requires the explicit --catastrophe flag',
);
const fullProductionMatrix = requestedBackend === 'all'
  && requestedScope === 'all'
  && !catastropheRequested;
const QA_DIR = fullProductionMatrix
  ? path.join(ROOT, 'docs', 'qa')
  : path.join(
    ROOT,
    'docs',
    'qa',
    'targeted',
    `${requestedBackend}-${requestedScope}${catastropheRequested ? '-catastrophe' : ''}`,
  );

const CHROMIUM = [
  process.env.KAKI_RALLY_CHROMIUM,
  '/home/nemoclaw/bin/chromium',
  chromium.executablePath(),
].find((candidate) => candidate && fs.existsSync(candidate));
assert(CHROMIUM, 'No Chromium executable is available');

const WEBGL_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--enable-precise-memory-info',
];
const WEBGPU_ARGS = [
  '--disable-gpu-sandbox',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-vulkan=swiftshader',
  '--enable-dawn-features=allow_unsafe_apis',
  '--enable-precise-memory-info',
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
      response.end(request.method === 'HEAD' ? undefined : body);
    });
  });
}

function watchPage(page, origin, diagnostics) {
  page.on('request', (request) => {
    if (
      !catastropheRequested
      &&
      request.url().startsWith(origin)
      && /(?:\/src\/racing\/crash\/|\/assets\/racing\/crash\/|\/rapier\.mjs(?:$|[?#]))/i.test(request.url())
    ) diagnostics.frozenModeRequests.push(request.url());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/menu_glitch\.mp3.*ERR_ABORTED/i.test(text)) {
      diagnostics.expectedAborts.push(text);
      return;
    }
    if (text === 'The AudioContext encountered an error from the audio device or the WebAudio renderer.') {
      // Headless Chromium can have a running Web Audio graph but no host audio
      // output device. Keep that platform diagnostic visible without treating
      // it as an application console failure; audio state and teardown are
      // asserted independently by the mode lifecycle checks.
      diagnostics.expectedAudioDeviceErrors.push(text);
      return;
    }
    diagnostics.consoleErrors.push(text);
  });
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      diagnostics.badResponses.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    const text = `${request.failure()?.errorText || 'failed'} ${request.url()}`;
    // A mode exit or context close is allowed to cancel an in-flight decode or
    // audio request. HTTP failures and every non-cancellation transport error
    // remain fatal below.
    if (/ERR_ABORTED/i.test(text)) diagnostics.expectedAborts.push(text);
    else if (request.url().startsWith(origin)) diagnostics.failedRequests.push(text);
  });
}

async function installQaState(page) {
  await page.addInitScript(() => {
    // Init scripts run again on reload. Seed a clean context once, then leave
    // the legacy save keys intact so the matrix can prove real persistence.
    if (sessionStorage.getItem('kaki-rally-qa-seeded') !== '1') {
      localStorage.clear();
      localStorage.setItem('kaki_rally_settings_v1', JSON.stringify({
        renderer: 'webgl',
        lastDriver: 'kitty',
        camera: 'chase',
        quality: 'high',
      }));
      sessionStorage.setItem('kaki-rally-qa-seeded', '1');
    }
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
    const pad = {
      id: 'Kaki Rally QA Gamepad',
      index: 0,
      connected: true,
      mapping: 'standard',
      timestamp: 1,
      axes: [0, 0, 0, 0],
      buttons,
      vibrationActuator: null,
    };
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [pad, null, null, null],
    });
    window.__setKakiQaPad = (next = {}) => {
      pad.timestamp += 1;
      pad.axes[0] = Number(next.lx) || 0;
      pad.axes[1] = Number(next.ly) || 0;
      const map = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, start: 9 };
      for (const button of buttons) Object.assign(button, { pressed: false, touched: false, value: 0 });
      for (const [name, index] of Object.entries(map)) {
        const value = Number(next[name]) || 0;
        Object.assign(buttons[index], { pressed: value >= 0.5, touched: value > 0, value });
      }
      return pad.timestamp;
    };
  });
}

async function bootPage(browser, origin, backend, diagnostics, {
  viewport = { width: 1280, height: 720 },
  touch = false,
  catastrophe = false,
} = {}) {
  const context = await browser.newContext({
    viewport,
    hasTouch: touch,
    isMobile: false,
    deviceScaleFactor: 1,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await context.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, async (route) => {
    if (route.request().url().includes('googleapis')) {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    } else {
      await route.fulfill({ status: 204, body: '' });
    }
  });
  const page = await context.newPage();
  watchPage(page, origin, diagnostics);
  await installQaState(page);
  const development = catastrophe ? '&dev=catastrophe' : '';
  await page.goto(`${origin}/index.html?qa=1&renderer=${backend}${development}`, {
    waitUntil: 'load',
    timeout: 120_000,
  });
  await page.waitForFunction(
    () => document.body.dataset.kakiRallyReady === 'true' && !!window.__kakiRally,
    null,
    { timeout: 120_000 },
  );
  const boot = await page.evaluate(() => window.__kakiRally.getDiagnostics());
  assert.equal(boot.backend, backend, `${backend} request initialized ${boot.backend}`);
  assert.equal(boot.stateDiagnostics.lastError || '', '', `${backend} boot error: ${boot.stateDiagnostics.lastError}`);
  const menuVersion = await page.locator('.rally-version').evaluate((node) => ({
    text: node.textContent.trim(),
    visible: !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length),
  }));
  assert.equal(menuVersion.text, 'V1.1.1', 'main menu version does not match the release');
  assert(menuVersion.visible, `main menu version is hidden at ${viewport.width}x${viewport.height}`);
  return { context, page, boot };
}

async function runWorkshopResponsive(browser, origin, report) {
  const desktopDiagnostics = emptyDiagnostics();
  const desktop = await bootPage(browser, origin, 'webgl', desktopDiagnostics, {
    viewport: { width: 2560, height: 720 },
  });
  try {
    await desktop.page.evaluate(() => window.__kakiRally.openDraw());
    await desktop.page.waitForSelector('.kdt-editor');
    await drawCircle(desktop.page, 'mouse');
    await desktop.page.evaluate(() => {
      window.__kdtEditor.setSize('colossal');
      window.__kdtEditor.setEditorStage('place');
    });
    await desktop.page.waitForTimeout(180);
    const ultrawide = await desktop.page.evaluate(() => {
      const stage = document.querySelector('#kk-stage').getBoundingClientRect();
      const editor = document.querySelector('.kdt-editor').getBoundingClientRect();
      const canvas = document.querySelector('.kdt-canvas-wrap').getBoundingClientRect();
      return {
        viewport: [innerWidth, innerHeight],
        stage: [stage.width, stage.height],
        left: stage.left,
        right: innerWidth - stage.right,
        editor: editor.toJSON(),
        canvas: canvas.toJSON(),
      };
    });
    assert(Math.abs(ultrawide.left - ultrawide.right) < 2, 'ultrawide letterboxing is not centered');
    assert(Math.abs(ultrawide.stage[0] / ultrawide.stage[1] - 16 / 9) < 0.02, 'desktop stage lost 16:9');
    assert(
      Math.abs(ultrawide.editor.x - ultrawide.left) < 2
        && Math.abs(ultrawide.editor.width - ultrawide.stage[0]) < 2,
      '32:9 Workshop tools escaped the centered work area',
    );
    await desktop.page.screenshot({ path: path.join(QA_DIR, 'webgl-draw-editor-32x9.png') });
    report.webgl.ultrawide = { ...ultrawide, diagnostics: desktopDiagnostics };
  } finally {
    await desktop.context.close();
  }

  const diagnostics = emptyDiagnostics();
  const { context, page } = await bootPage(browser, origin, 'webgl', diagnostics, {
    viewport: { width: 844, height: 390 },
    touch: true,
  });
  try {
    await page.evaluate(() => window.__kakiRally.openDraw());
    await page.waitForSelector('.kdt-editor');
    await drawCircle(page, 'touch');
    await page.evaluate(() => {
      window.__kdtEditor.setSize('mega');
      window.__kdtEditor.setEditorStage('place');
    });
    assert(await addWorkshopCircuitStamp(page), 'responsive Workshop could not preserve a manual stamp');
    const autoDress = await page.evaluate(() => {
      const editor = window.__kdtEditor;
      const manualId = editor.draft.featurePlacements.find((placement) => placement.source === 'manual')?.id;
      editor.autoDress();
      const first = editor.draft.featurePlacements
        .filter((placement) => placement.source === 'auto-dress')
        .map((placement) => JSON.stringify(placement));
      editor.autoDress();
      const second = editor.draft.featurePlacements
        .filter((placement) => placement.source === 'auto-dress')
        .map((placement) => JSON.stringify(placement));
      const manualAfterRegenerate = editor.draft.featurePlacements.some((placement) => placement.id === manualId);
      editor.clearAutoDress();
      const cleared = editor.draft.featurePlacements.every((placement) => placement.source !== 'auto-dress')
        && editor.draft.featurePlacements.some((placement) => placement.id === manualId);
      editor.undo();
      const restored = editor.draft.featurePlacements.filter((placement) => placement.source === 'auto-dress').length;
      return {
        first,
        second,
        manualAfterRegenerate,
        cleared,
        restored,
      };
    });
    assert(
      autoDress.first.length > 0
        && autoDress.manualAfterRegenerate
        && autoDress.cleared
        && autoDress.restored === autoDress.first.length
        && JSON.stringify(autoDress.first) === JSON.stringify(autoDress.second),
      `Auto Dress was not deterministic/history-safe: ${JSON.stringify(autoDress)}`,
    );
    await page.waitForTimeout(180);
    const landscape = await page.evaluate(() => {
      const editor = document.querySelector('.kdt-editor').getBoundingClientRect();
      const canvas = document.querySelector('.kdt-canvas-wrap').getBoundingClientRect();
      const targets = [...document.querySelectorAll(
        '.kdt-feature-categories button:not([hidden]), .kdt-feature-card:not([hidden]), .kdt-feature-transform button:not([hidden]), .kdt-auto-dress-actions button:not([hidden])',
      )].map((node) => node.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
      return {
        orientationGate: !document.querySelector('#rally-orientation-gate').hidden,
        overflowX: document.documentElement.scrollWidth - innerWidth,
        editor: editor.toJSON(),
        canvas: canvas.toJSON(),
        minTouchTarget: Math.min(...targets.map((rect) => Math.min(rect.width, rect.height))),
        coarse: matchMedia('(pointer: coarse)').matches,
      };
    });
    assert(!landscape.orientationGate, 'landscape coarse-pointer Workshop shows the rotate prompt');
    assert(landscape.coarse, 'mobile Workshop did not receive coarse-pointer media rules');
    assert(landscape.overflowX <= 2, 'mobile Workshop has horizontal overflow');
    assert(landscape.canvas.width >= 300 && landscape.canvas.height >= 170, 'mobile Workshop hid too much of the course');
    assert(landscape.minTouchTarget >= 43.5, `mobile Workshop target fell below 44 CSS px: ${landscape.minTouchTarget}`);
    await page.screenshot({ path: path.join(QA_DIR, 'webgl-draw-editor-mobile-landscape.png') });
    const initiallyCollapsed = await page.locator('.kdt-feature-workbench').evaluate((node) => (
      node.classList.contains('is-collapsed')
    ));
    if (!initiallyCollapsed) await page.click('.kdt-feature-collapse');
    const collapsedHeight = await page.locator('.kdt-feature-workbench').evaluate((node) => (
      node.getBoundingClientRect().height
    ));
    assert(collapsedHeight <= 60, `mobile Workshop palette did not collapse: ${collapsedHeight}px`);
    await page.click('.kdt-feature-collapse');

    await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
    await page.waitForTimeout(80);
    const accessibility = await page.evaluate(() => {
      const target = document.querySelector('.kdt-feature-card');
      const style = getComputedStyle(target);
      return {
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        highContrast: matchMedia('(prefers-contrast: more)').matches,
        borderWidth: parseFloat(style.borderTopWidth),
        transitionSeconds: style.transitionDuration.split(',').map(parseFloat),
      };
    });
    assert(accessibility.reducedMotion && accessibility.highContrast, 'Workshop accessibility media state was not applied');
    assert(accessibility.borderWidth >= 2, 'high-contrast Workshop controls lost their stronger boundary');
    assert(
      accessibility.transitionSeconds.every((value) => value <= 0.001),
      `reduced-motion Workshop retained a long transition: ${JSON.stringify(accessibility)}`,
    );

    await page.evaluate(async () => {
      await window.__kakiRally.menu();
      window.__kakiRally.openTrialsWorkshop();
    });
    await page.waitForSelector('.ktr-editor');
    await page.waitForTimeout(160);
    const trialsLandscape = await page.evaluate(() => {
      const canvas = document.querySelector('.ktr-canvas').getBoundingClientRect();
      const targets = [...document.querySelectorAll(
        '.ktr-stages button, .ktr-terrain-tools button, .ktr-header-actions button',
      )].map((node) => node.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
      const terrainTools = [...document.querySelectorAll('.ktr-terrain-tools button')]
        .map((node) => node.getBoundingClientRect());
      return {
        overflowX: document.documentElement.scrollWidth - innerWidth,
        canvas: canvas.toJSON(),
        minTouchTarget: Math.min(...targets.map((rect) => Math.min(rect.width, rect.height))),
        terrainTools: terrainTools.length,
        visibleTerrainTools: terrainTools.filter((rect) => rect.top >= 0 && rect.bottom <= innerHeight).length,
      };
    });
    assert(trialsLandscape.overflowX <= 2, 'mobile Trials Workshop has horizontal overflow');
    assert(
      trialsLandscape.canvas.width >= 500 && trialsLandscape.canvas.height >= 140,
      `mobile Trials Workshop hid too much terrain: ${JSON.stringify(trialsLandscape.canvas)}`,
    );
    assert(trialsLandscape.minTouchTarget >= 43.5, `mobile Trials target fell below 44 CSS px: ${trialsLandscape.minTouchTarget}`);
    assert.equal(trialsLandscape.terrainTools, 12, 'mobile Trials Workshop lost required terrain stamps');
    assert.equal(trialsLandscape.visibleTerrainTools, 12, 'mobile Trials Workshop clipped terrain stamps below the viewport');
    await page.screenshot({ path: path.join(QA_DIR, 'webgl-trials-workshop-mobile-landscape.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(180);
    const portrait = await page.evaluate(() => ({
      orientationGate: !document.querySelector('#rally-orientation-gate').hidden,
      overflowX: document.documentElement.scrollWidth - innerWidth,
    }));
    assert(portrait.orientationGate, 'portrait coarse-pointer Workshop did not show its orientation guidance');
    assert(portrait.overflowX <= 2, 'portrait orientation guidance has horizontal overflow');
    await page.screenshot({ path: path.join(QA_DIR, 'webgl-draw-editor-mobile-portrait.png') });
    report.webgl.responsiveWorkshop = {
      landscape,
      autoDressCount: autoDress.first.length,
      collapsedHeight,
      portrait,
      accessibility,
      trialsLandscape,
      diagnostics,
    };
  } finally {
    await context.close();
  }
}

async function runDuneResponsive(browser, origin, report) {
  const diagnostics = emptyDiagnostics();
  const { context, page } = await bootPage(browser, origin, 'webgl', diagnostics, {
    viewport: { width: 844, height: 390 },
    touch: true,
  });
  try {
    await startMode(page, 'dunes', 'whiskerwind', {
      duneEvent: 'whiskerwind',
      duneVehicle: 'meowster',
      duneTerrain: 'low',
      duneDeformation: 'low',
      duneParticles: 'low',
      duneDust: 'low',
      duneShadow: 'low',
      cameraMode: 'chase',
    });
    await skipCountdown(page);
    await page.evaluate(() => window.__kkRacing.showDuneState('slide'));
    await page.waitForTimeout(420);
    const landscape = await page.evaluate(() => {
      const stage = document.querySelector('#kk-stage').getBoundingClientRect();
      const hud = document.querySelector('.kkd-hud').getBoundingClientRect();
      const route = document.querySelector('.kkd-route').getBoundingClientRect();
      const camera = document.querySelector('.kkd-hud .kkr-camera-control').getBoundingClientRect();
      const buttons = [...document.querySelectorAll(
        '.kkd-touch button, #rally-touch-root button:not([hidden]), .kkd-topbar button',
      )].map((node) => node.getBoundingClientRect()).filter((rect) => rect.width && rect.height);
      return {
        viewport: [innerWidth, innerHeight],
        overflowX: document.documentElement.scrollWidth - innerWidth,
        stage: stage.toJSON(),
        hud: hud.toJSON(),
        coarse: matchMedia('(pointer: coarse)').matches,
        orientationGate: !document.querySelector('#rally-orientation-gate').hidden,
        duneTouchButtons: document.querySelectorAll('.kkd-touch button').length,
        visibleDuneTouchButtons: [...document.querySelectorAll('.kkd-touch button')]
          .filter((node) => getComputedStyle(node).display !== 'none').length,
        minTouchTarget: Math.min(...buttons.map((rect) => Math.min(rect.width, rect.height))),
        routeCameraOverlap: !(
          route.right <= camera.left
          || route.left >= camera.right
          || route.bottom <= camera.top
          || route.top >= camera.bottom
        ),
        snapshot: window.__kkRacing.snapshot(),
      };
    });
    assert(landscape.coarse, 'mobile Dune Run did not receive coarse-pointer media rules');
    assert(!landscape.orientationGate, 'landscape Dune Run shows the rotate prompt');
    assert(landscape.overflowX <= 2, 'mobile Dune Run has horizontal overflow');
    assert.equal(landscape.duneTouchButtons, 3, 'mobile Dune Run lost an action control');
    assert.equal(landscape.visibleDuneTouchButtons, 3, 'mobile Dune Run hid an action control');
    assert(landscape.minTouchTarget >= 43.5, `mobile Dune target fell below 44 CSS px: ${landscape.minTouchTarget}`);
    assert(!landscape.routeCameraOverlap, 'mobile Dune camera control covers route progress');
    assert.equal(landscape.snapshot.terrain.authorityShared, true, 'mobile Dune terrain authorities diverged');
    await page.screenshot({ path: path.join(QA_DIR, 'webgl-dunes-mobile-landscape.png') });
    report.webgl.responsiveDunes = { ...landscape, diagnostics };
  } finally {
    await context.close();
  }
}

async function runWebGpuFallback(browser, origin, report) {
  const diagnostics = emptyDiagnostics();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: undefined,
    });
  });
  const page = await context.newPage();
  watchPage(page, origin, diagnostics);
  await installQaState(page);
  try {
    await page.goto(`${origin}/index.html?qa=1&renderer=webgpu`, {
      waitUntil: 'load',
      timeout: 120_000,
    });
    await page.waitForFunction(
      () => document.body.dataset.kakiRallyReady === 'true' && !!window.__kakiRally,
      null,
      { timeout: 120_000 },
    );
    const fallback = await page.evaluate(() => window.__kakiRally.getDiagnostics());
    assert.equal(fallback.backend, 'webgl', 'forced WebGPU initialization failure did not recover through WebGL 2');
    assert.equal(fallback.stateDiagnostics.lastError || '', '', `WebGPU fallback boot error: ${fallback.stateDiagnostics.lastError}`);
    assert.equal(fallback.stateDiagnostics.rendererFallback?.to, 'webgl', 'WebGPU fallback diagnostics were not recorded');
    report.webgl.webgpuFailureFallback = { ...fallback, diagnostics };
  } finally {
    await context.close();
  }
}

async function runDrawThemeVariants(browser, origin, report) {
  const diagnostics = emptyDiagnostics();
  const { context, page } = await bootPage(browser, origin, 'webgl', diagnostics);
  const colors = {};
  try {
    for (const themeId of ['snow', 'neon']) {
      const started = await page.evaluate(async (theme) => {
        const [
          { TrackValidator, DEFAULT_LAYOUT_TRANSFORM },
          { compileDrawTrackCourse },
        ] = await Promise.all([
          import('./src/racing/drawTrackGeometry.js'),
          import('./src/racing/drawTrackThemes.js'),
        ]);
        const points = Array.from({ length: 40 }, (_, index) => {
          const angle = index / 40 * Math.PI * 2;
          return {
            x: 0.5 + Math.cos(angle) * 0.43,
            y: 0.5 + Math.sin(angle) * 0.38,
          };
        });
        const base = {
          rawPoints: points,
          controlPoints: points,
          closed: true,
          sizeId: 'grand',
          widthId: 'standard',
          layoutTransform: DEFAULT_LAYOUT_TRANSFORM,
          allowOverpasses: true,
        };
        let validation = TrackValidator.validate(base);
        validation = TrackValidator.validate({
          ...base,
          startFraction: validation.suggestedStartFraction,
        });
        const draft = {
          id: `browser-theme-${theme}`,
          name: `${theme.toUpperCase()} Kaki Craft`,
          themeId: theme,
          sizeId: 'grand',
          widthId: 'standard',
          seed: theme === 'snow' ? 77123 : 77129,
          smoothing: 0.55,
          layoutTransform: { ...DEFAULT_LAYOUT_TRANSFORM },
          startFraction: validation.suggestedStartFraction,
          reverse: false,
          modifiers: { boostPads: false, randomJumps: false },
          crossingOverrides: [],
          featurePlacements: [{
            id: `browser-${theme}-kicker`,
            featureId: 'small-kicker',
            source: 'manual',
            anchor: {
              mode: 'spline',
              fraction: 0.34,
              lateralOffset: 0,
              facing: 'forward',
              rotationOffset: 0,
              scaleX: 1,
              scaleY: 1,
              scaleZ: 1,
            },
          }],
          rawStroke: points,
          controlPoints: points,
        };
        const course = compileDrawTrackCourse(draft, validation);
        const launched = await window.__kakiRally.start('draw', course.id, {
          customCourse: course,
          customTrack: draft,
          carCount: 2,
          cameraMode: 'chase',
          practiceRun: true,
        });
        return { launched: !!launched, valid: validation.valid };
      }, themeId);
      assert(started.launched && started.valid, `${themeId} theme Workshop fixture did not start`);
      await page.waitForFunction(() => (
        window.__kkRacing?.snapshot?.()?.workshop?.features?.built >= 1
      ), null, { timeout: 120_000 });
      await skipCountdown(page);
      await page.evaluate(() => {
        window.__kkRacing.setCameraMode('chase');
        const runtime = window.__kakiRally.state.racing.courseFeatureRuntimes[0];
        window.__kkRacing.warpShowcase((runtime.fraction - 0.028 + 1) % 1);
      });
      await page.waitForTimeout(320);
      colors[themeId] = await page.evaluate(() => {
        const result = {};
        window.__kakiRally.state.racing.courseFeatureVisuals.group.traverse((object) => {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const name = String(material?.name || '');
            if (name.startsWith('variant_') && material.color && result[name] == null) {
              result[name] = material.color.getHex();
            }
          }
        });
        return result;
      });
      await page.screenshot({ path: path.join(QA_DIR, `webgl-draw-theme-${themeId}.png`) });
      await page.evaluate(() => window.__kakiRally.menu());
    }
    assert(
      colors.snow.variant_structure !== colors.neon.variant_structure
        && colors.snow.variant_trim !== colors.neon.variant_trim,
      `theme-reactive construction did not change authored materials: ${JSON.stringify(colors)}`,
    );
    report.webgl.themeVariants = { colors, diagnostics };
  } finally {
    await context.close();
  }
}

async function assertRallyGrass(page, mode) {
  if (!['circuit', 'drift', 'stock', 'draw'].includes(mode)) return null;
  const grass = await page.evaluate(() => window.__kakiRally.getSnapshot()?.environment?.grass || null);
  assert(grass, `${mode} did not create its Terra grass layer`);
  assert.equal(grass.schema, 'kaki-rally-terra-grass@1', `${mode} grass schema changed`);
  assert(grass.counts.total > 0, `${mode} grass layer is empty`);
  assert(grass.drawCalls > 0 && grass.drawCalls <= 6, `${mode} grass draw budget escaped its six instanced draws`);
  assert(grass.submittedTriangles > 0, `${mode} grass submitted no geometry`);
  assert.equal(grass.wind, 'tsl-tip-weighted', `${mode} grass lost backend-neutral wind`);
  return grass;
}

async function startMode(page, mode, courseId, options = {}) {
  const started = await page.evaluate(
    ({ mode, courseId, options }) => window.__kakiRally.start(mode, courseId, options).then(Boolean),
    { mode, courseId, options },
  );
  assert(started, `${mode} failed to start`);
  await page.waitForFunction((expected) => (
    window.__kakiRally?.getDiagnostics?.().activeMode === expected
    && window.__kakiRally?.getDiagnostics?.().hudRoots === 1
  ), mode, { timeout: 120_000 });
  if (mode === 'crash') {
    await page.waitForFunction(() => {
      const snapshot = window.__kkCrash?.snapshot?.();
      return snapshot?.worldReady
        && snapshot?.assetsReady
        && !snapshot?.assetError
        && snapshot.phase !== 'LOADING';
    }, null, { timeout: 120_000 });
  } else {
    await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  }
  await assertRallyGrass(page, mode);
  return page.evaluate(() => window.__kakiRally.getDiagnostics());
}

async function startModeFromMenu(page, spec) {
  await page.click(`.rally-mode-rail button[data-mode="${spec.mode}"]`);
  await page.waitForFunction((mode) => (
    document.querySelector('.rally-setup')?.dataset.mode === mode
  ), spec.mode);
  const selections = {
    course: spec.courseId,
    carCount: spec.options.carCount,
    driftLayout: spec.options.driftLayout,
    driftCar: spec.options.driftCar,
    stockVariant: spec.options.stockVariant,
    monsterEvent: spec.options.monsterEvent,
    monsterVehicle: spec.options.monsterVehicle,
    monsterArena: spec.options.monsterArena,
    duneEvent: spec.options.duneEvent,
    duneVehicle: spec.options.duneVehicle,
    duneNavigationAssist: spec.options.duneNavigationAssist,
    duneService: spec.options.duneService,
    duneDifficulty: spec.options.duneDifficulty,
    duneDeformation: spec.options.duneDeformation,
    trialsTrack: spec.options.trialsTrackId,
    trialsVehicle: spec.options.trialsVehicle,
    crashVehicle: spec.options.crashVehicle,
    crashQuality: spec.options.crashQuality,
  };
  for (const [name, value] of Object.entries(selections)) {
    if (value != null && await page.locator(`.rally-setup select[name="${name}"]`).count()) {
      await page.selectOption(`.rally-setup select[name="${name}"]`, String(value));
    }
  }
  await page.click('.rally-setup [data-action="launch"]');
  await page.waitForFunction((expected) => (
    window.__kakiRally?.getDiagnostics?.().activeMode === expected
    && window.__kakiRally?.getDiagnostics?.().hudRoots === 1
  ), spec.mode, { timeout: 120_000 });
  if (spec.mode === 'crash') {
    await page.waitForFunction(() => {
      const snapshot = window.__kkCrash?.snapshot?.();
      return snapshot?.worldReady
        && snapshot?.assetsReady
        && !snapshot?.assetError
        && snapshot.phase !== 'LOADING';
    }, null, { timeout: 120_000 });
  } else {
    await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  }
  await assertRallyGrass(page, spec.mode);
  return page.evaluate(() => window.__kakiRally.getDiagnostics());
}

async function skipCountdown(page) {
  const skipped = await page.evaluate(() => window.__kkRacing?.skipCountdown?.() !== false);
  assert(skipped, 'QA countdown hook was unavailable');
  await page.waitForTimeout(180);
}

async function exerciseKeyboard(page) {
  const before = await page.evaluate(() => window.__kakiRally.getSnapshot());
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await page.waitForTimeout(520);
  await page.keyboard.up('d');
  await page.keyboard.up('w');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert(after, 'keyboard exercise lost the active session');
  assert.equal(
    (await page.evaluate(() => window.__kakiRally.getDiagnostics().input.lastDevice)),
    'keyboard',
    'keyboard input was not sampled',
  );
  return { before, after };
}

async function heldPointer(page, selector, verify) {
  const exists = await page.locator(selector).count();
  assert(exists > 0, `touch control missing: ${selector}`);
  await page.evaluate(({ selector }) => {
    const element = document.querySelector(selector);
    element.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 81,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
    }));
  }, { selector });
  await page.waitForTimeout(180);
  const active = await page.evaluate(verify);
  assert(active, `touch input did not reach runtime through ${selector}`);
  await page.evaluate(({ selector }) => {
    const element = document.querySelector(selector);
    element.dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 81,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: 10,
      clientY: 10,
    }));
  }, { selector });
}

async function exerciseTouch(page, mode) {
  if (mode === 'trials') {
    await heldPointer(page, '[data-touch="throttle"]', () => (
      window.__kakiRally.state.racing?.physics?.vx > 0
    ));
  } else if (mode === 'crash') {
    await heldPointer(page, '.kkc-touch [data-touch="gas"]', () => (
      window.__kakiRally.state.racing?.controls?.throttle > 0.5
    ));
  } else {
    await heldPointer(page, '#rally-touch-root [data-drive="throttle"]', () => (
      window.__kakiRally.getDiagnostics().input.touch.throttle === true
      && window.__kakiRally.getDiagnostics().input.lastDevice === 'touch'
    ));
  }
}

async function exerciseGamepad(page) {
  await page.evaluate(() => window.__setKakiQaPad({ lx: 0.66, ly: -1, rt: 1, x: 1 }));
  await page.waitForFunction(() => {
    const input = window.__kakiRally?.getDiagnostics?.().input;
    return input?.lastDevice === 'gamepad'
      && input?.gamepad?.connected
      && Math.abs(input.moveVec.x) > 0.25;
  }, null, { timeout: 10_000 });
  const snapshot = await page.evaluate(() => window.__kakiRally.getDiagnostics().input);
  await page.evaluate(() => window.__setKakiQaPad({}));
  await page.waitForTimeout(100);
  return snapshot;
}

async function assertPauseRestartExitReentry(page, spec, evidence) {
  assert(await page.evaluate(() => window.__kakiRally.pause()), `${spec.mode} did not pause`);
  await page.waitForFunction(() => window.__kakiRally.getDiagnostics().paused === true);
  assert(await page.evaluate(() => window.__kakiRally.pause()), `${spec.mode} did not resume`);
  await page.waitForFunction(() => window.__kakiRally.getDiagnostics().paused === false);

  const beforeTransitions = await page.evaluate(() => (
    window.__kakiRally.getDiagnostics().stateDiagnostics.modeTransitions
  ));
  assert(await page.evaluate(() => window.__kakiRally.restart().then(Boolean)), `${spec.mode} restart failed`);
  await page.waitForFunction(({ mode, beforeTransitions }) => {
    const diagnostics = window.__kakiRally.getDiagnostics();
    return diagnostics.activeMode === mode
      && diagnostics.stateDiagnostics.modeTransitions > beforeTransitions
      && diagnostics.hudRoots === 1;
  }, { mode: spec.mode, beforeTransitions }, { timeout: 120_000 });
  evidence.restart = await page.evaluate(() => window.__kakiRally.getDiagnostics());

  await page.evaluate(() => window.__kakiRally.menu());
  await page.waitForFunction(() => {
    const diagnostics = window.__kakiRally.getDiagnostics();
    return diagnostics.appMode === 'menu'
      && diagnostics.activeMode === null
      && diagnostics.hudRoots === 0
      && diagnostics.sessionRoots === 0
      && diagnostics.audio.racingActive === false;
  }, null, { timeout: 20_000 });
  evidence.exit = await page.evaluate(() => window.__kakiRally.getDiagnostics());

  await startMode(page, spec.mode, spec.courseId, spec.options);
  await skipCountdown(page);
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('.kkr-hud,.kkc-hud').length),
    1,
    `${spec.mode} re-entry duplicated HUD`,
  );
  evidence.reentry = await page.evaluate(() => window.__kakiRally.getDiagnostics());
  await page.evaluate(() => window.__kakiRally.menu());
}

async function runRoadMode(page, spec, backend, evidence) {
  const opening = await startModeFromMenu(page, spec);
  await skipCountdown(page);
  if (spec.mode === 'stock') {
    assert(
      await page.evaluate(() => window.__kkRacing.setCameraMode('isometric')),
      'Stock Cup rejected its pack-reading camera',
    );
    await page.waitForTimeout(180);
    await page.screenshot({ path: path.join(QA_DIR, `${backend}-stock-pack.png`) });
    await page.evaluate(() => window.__kkRacing.setCameraMode('chase'));
  }
  const keyboard = await exerciseKeyboard(page);
  await exerciseTouch(page, spec.mode);
  const gamepad = await exerciseGamepad(page);
  const mechanic = await page.evaluate(({ kind }) => window.__kkRacing.showState(kind), {
    kind: spec.mechanic,
  });
  assert(mechanic, `${spec.mode} central-mechanic QA hook failed`);
  await page.waitForTimeout(180);
  const snapshot = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert.equal(snapshot.raceMode, spec.mode);
  assert.equal(snapshot.cars, spec.options.carCount);
  assert(snapshot.performance.drawCalls > 0, `${spec.mode} submitted no draw calls`);
  if (spec.mode === 'drift') assert(snapshot.drifting, 'Drift Attack did not enter charged-drift state');
  if (spec.mode === 'drift') {
    assert.equal(snapshot.driftCarId, spec.options.driftCar || 'comet');
    assert.equal(snapshot.driftLayoutId, spec.options.driftLayout || 'judged');
    assert(snapshot.driftJudge?.score > 0, 'Drift Attack judge did not score the driven showcase state');
  }
  if (spec.mode === 'stock') assert(snapshot.integrity <= 24, 'Stock Cup damage/smoke state did not trigger');
  if (spec.mode === 'stock') assert.equal(snapshot.stockVariant, spec.options.stockVariant || 'concrete');
  if (spec.mode === 'circuit') assert(snapshot.raceTime > 0, 'Off-Road GP fixed-step race clock did not advance');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-${spec.mode}.png`) });
  if (spec.mode === 'circuit') {
    assert(
      await page.evaluate(() => window.__kkRacing.setCameraMode('driver_fpv')),
      'Off-Road GP rejected its driver FPV camera',
    );
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(QA_DIR, `${backend}-circuit-fpv.png`) });
    await page.evaluate(() => window.__kkRacing.setCameraMode('chase'));
  }
  evidence.opening = opening;
  evidence.keyboard = keyboard;
  evidence.gamepad = gamepad;
  evidence.mechanic = snapshot;
  await assertPauseRestartExitReentry(page, spec, evidence);
}

async function runMonster(page, backend, evidence) {
  const spec = {
    mode: 'monster',
    courseId: 'forest',
    options: {
      carCount: 1,
      monsterVehicle: 'meowster',
      monsterArena: 'pileup-pyramid-yard',
      monsterEvent: 'smashdown',
    },
  };
  evidence.opening = await startModeFromMenu(page, spec);
  await skipCountdown(page);
  await exerciseKeyboard(page);
  await exerciseTouch(page, 'monster');
  evidence.gamepad = await exerciseGamepad(page);
  const target = await page.evaluate(() => window.__kkRacing.warpToMonsterTarget(0));
  assert(target, 'Monster target traversal setup failed');
  assert(
    await page.evaluate(() => window.__kkRacing.setCameraMode('isometric')),
    'Monster target traversal rejected its articulation camera',
  );
  await page.evaluate(() => new Promise((resolve) => (
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  )));
  await page.evaluate(() => {
    const session = window.__kakiRally.state.racing;
    session.goFlash = 0;
    session.hud.callout.className = 'kkr-callout';
    window.__kakiRally.state.time.paused = true;
  });
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-monster-crush-traversal.png`) });
  await page.evaluate(() => { window.__kakiRally.state.time.paused = false; });
  const central = await page.evaluate((targetReady) => ({
    target: targetReady,
    collapsed: window.__kkRacing.collapseMonsterStructure(),
    jump: window.__kkRacing.showMonsterJump(),
    chaos: window.__kkRacing.fillChaos(),
  }), target);
  assert(central.target && central.collapsed && central.jump && central.chaos, `Monster central mechanics failed: ${JSON.stringify(central)}`);
  const beforeRound = await page.evaluate(() => window.__kkRacing.snapshot().monster);
  await page.evaluate(() => {
    const session = window.__kakiRally.state.racing;
    const ids = new Set(session.monsterRounds.rounds[session.monsterRounds.index].targetIds);
    for (const target of session.monsterArena.targets) {
      if (ids.has(target.id)) target.destroyed = true;
    }
  });
  await page.waitForFunction(() => {
    const session = window.__kakiRally.state.racing;
    return session.phase === 'round-transition' || session.monsterRounds.index > 0;
  }, null, { timeout: 10_000 });
  evidence.smashdown = {
    beforeRound,
    afterRound: await page.evaluate(() => window.__kkRacing.snapshot().monster),
    central,
  };
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-monster.png`) });
  await assertPauseRestartExitReentry(page, spec, evidence);

  for (const monsterEvent of ['freestyle', 'free-ride']) {
    const options = { ...spec.options, monsterEvent, monsterVehicle: monsterEvent === 'freestyle' ? 'cyber' : 'tipsy' };
    await startMode(page, 'monster', 'forest', options);
    await skipCountdown(page);
    await page.evaluate(() => {
      window.__kkRacing.showMonsterBusyState();
      window.__kkRacing.showMonsterJump();
    });
    await page.waitForTimeout(240);
    const snapshot = await page.evaluate(() => window.__kkRacing.snapshot());
    assert.equal(snapshot.monster.eventMode, monsterEvent);
    assert(snapshot.monster.score > 0, `${monsterEvent} did not produce a score state`);
    evidence[monsterEvent] = snapshot;
    await page.evaluate(() => window.__kakiRally.menu());
  }
}

async function runDunes(page, backend, evidence) {
  const spec = {
    mode: 'dunes',
    courseId: 'whiskerwind',
    options: {
      carCount: 1,
      duneEvent: 'whiskerwind',
      duneVehicle: 'meowster',
      duneDifficulty: 'standard',
      duneTerrain: backend === 'webgl' ? 'high' : 'medium',
      duneDeformation: backend === 'webgl' ? 'high' : 'medium',
      duneParticles: backend === 'webgl' ? 'high' : 'medium',
      duneDust: 'high',
      duneShadow: 'medium',
      duneHeatHaze: true,
      cameraMode: 'chase',
    },
  };
  evidence.opening = await startModeFromMenu(page, spec);
  await skipCountdown(page);
  const keyboard = await exerciseKeyboard(page);
  await exerciseTouch(page, 'dunes');
  const gamepad = await exerciseGamepad(page);

  const recoveriesBefore = await page.evaluate(() => window.__kkRacing.snapshot().race.recoveries);
  await page.keyboard.press('r');
  await page.waitForFunction((before) => (
    window.__kkRacing?.snapshot?.()?.race?.recoveries > before
  ), recoveriesBefore, { timeout: 10_000 });
  const recovery = await page.evaluate(() => window.__kkRacing.snapshot());

  assert(
    await page.evaluate(() => window.__kkRacing.setCameraMode('chase')),
    'Dune Run rejected its chase camera',
  );
  assert(
    await page.evaluate(() => window.__kkRacing.showDuneState('wheelspin')),
    'Dune Run wheelspin/deformation setup failed',
  );
  await page.waitForTimeout(1_400);
  const wheelspin = await page.evaluate(() => window.__kkRacing.snapshot());
  assert.equal(wheelspin.raceMode, 'dunes');
  assert.equal(wheelspin.eventId, 'whiskerwind');
  assert.equal(wheelspin.visual.authoredBody, true, 'Dune Run lost its authored truck body');
  assert.equal(wheelspin.visual.wheels, 4, 'Dune Run lost independent wheels');
  assert.equal(wheelspin.terrain.authorityShared, true, 'Dune renderer and physics heights diverged');
  assert(
    wheelspin.terrain.rendererPhysicsDelta <= 1e-6,
    `Dune renderer/physics height delta escaped tolerance: ${wheelspin.terrain.rendererPhysicsDelta}`,
  );
  assert(wheelspin.terrain.clipmap.levels >= 6, 'Dune clipmap lost its nested detail levels');
  assert(wheelspin.terrain.clipmap.staticTopology, 'Dune clipmap rebuilds topology while driving');
  assert(wheelspin.terrain.clipmap.shaderTrimmedUnderlays, 'Dune clipmap lost crack-free underlay trims');
  assert(wheelspin.terrain.clipmap.signedTrackContrast, 'Dune material no longer shades signed rut depth');
  assert(/^#[0-9a-f]{6}$/i.test(wheelspin.terrain.clipmap.trackColor), 'Dune track contrast has no authored color');
  assert(wheelspin.telemetry.groundedWheels > 0, 'Dune truck has no terrain contacts');
  assert(wheelspin.deformation.maximumDepression > 0, 'Dune tires made no persistent rut');
  assert(wheelspin.vfx.roosterTail.emittedSamples > 0, 'Dune tires emitted no swept sand wake');
  assert(wheelspin.vfx.roosterTail.activeCurtains > 0, 'Dune swept sand wake is inactive');
  assert.equal(wheelspin.vfx.roosterTail.crossSectionRows, 5, 'Dune sand wake fell back to a flat curtain');
  assert.equal(wheelspin.vfx.roosterTail.curvedSurface, true, 'Dune sand wake lost its curled surface');
  assert.equal(wheelspin.vfx.roosterTail.bufferAuthorityShared, true, 'Dune sand wake animates a detached CPU buffer');
  assert(wheelspin.vfx.roosterTail.peakHeight > 0.35, 'Dune sand wake has no readable lifted lip');
  assert(wheelspin.vfx.dust.capacity >= (backend === 'webgl' ? 300 : 180), 'Dune dust pool lost its dense quality tier');
  assert(wheelspin.environment.kitAttached, 'Dune environment kit did not attach');
  assert.equal(wheelspin.assets.error, '', `Dune asset error: ${wheelspin.assets.error}`);
  assert(wheelspin.performance.drawCalls > 0, 'Dune Run submitted no draw calls');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-wheelspin.png`) });

  const wheelPoseSamples = [];
  for (let index = 0; index < 14; index += 1) {
    wheelPoseSamples.push(await page.evaluate(() => {
      const wheel = window.__kakiRally.state.racing.visual.wheels
        .find((entry) => entry.userData.steerable);
      const axle = wheel.position.clone().set(1, 0, 0).applyQuaternion(wheel.quaternion);
      return {
        axle: axle.toArray(),
        spin: wheel.userData.presentationSpin,
        steer: wheel.userData.presentationSteer,
      };
    }));
    await page.waitForTimeout(45);
  }
  assert(
    wheelPoseSamples.every((sample) => Math.abs(sample.axle[1]) < 1e-5),
    `turning wheel axle wobbled out of plane: ${JSON.stringify(wheelPoseSamples)}`,
  );
  assert(
    Math.max(...wheelPoseSamples.map((sample) => Math.abs(sample.steer))) > 0.03,
    'wheel pose stability check never observed steering',
  );
  assert(
    new Set(wheelPoseSamples.map((sample) => Number(sample.spin).toFixed(2))).size >= 5,
    'wheel pose stability check did not span enough tire rotation',
  );

  assert(
    await page.evaluate(() => window.__kkRacing.setCameraMode('isometric')),
    'Dune Run rejected isometric before a continuous jump',
  );
  await page.waitForFunction(() => {
    const camera = window.__kakiRally?.state?.racing?.cameraManager;
    return camera?.mode === 'isometric'
      && camera?.activeCamera?.isOrthographicCamera
      && !camera?.transition;
  }, null, { timeout: 20_000 });
  await page.waitForTimeout(180);
  assert(
    await page.evaluate(() => window.__kkRacing.launchDuneJump(38)),
    'Dune Run continuous jump fixture failed',
  );
  const continuousJumpFrames = [];
  for (let index = 0; index < 34; index += 1) {
    await page.waitForTimeout(50);
    continuousJumpFrames.push(await page.evaluate(() => {
      const session = window.__kakiRally.state.racing;
      const manager = session.cameraManager;
      const camera = manager.activeCamera;
      const playerWorld = session.visual.root.getWorldPosition(session.visual.root.position.clone());
      const playerNdc = playerWorld.clone().project(camera);
      const forward = camera.getWorldDirection(camera.position.clone());
      return {
        altitude: session.kart.y - session.kart.groundHeight,
        cameraY: camera.position.y,
        focusY: manager.lastFrame?.focus?.y,
        playerNdc: playerNdc.toArray(),
        forwardY: forward.y,
        projection: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
        mode: manager.mode,
        transitioning: !!manager.transition,
      };
    }));
  }
  const invalidJumpFrame = continuousJumpFrames.find((frame) => (
    frame.projection !== 'orthographic'
    || frame.mode !== 'isometric'
    || frame.transitioning
    || !(frame.cameraY > frame.focusY + 8)
    || !(frame.forwardY < -0.15)
    || Math.abs(frame.playerNdc[0]) >= 0.92
    || Math.abs(frame.playerNdc[1]) >= 0.92
    || frame.playerNdc[2] < -1
    || frame.playerNdc[2] > 1
  ));
  const maximumJumpAltitude = Math.max(...continuousJumpFrames.map((frame) => frame.altitude));
  assert(
    maximumJumpAltitude > 18,
    `continuous ISO fixture did not produce a big jump: ${maximumJumpAltitude}`,
  );
  assert(!invalidJumpFrame, `Dune ISO lost its terrain-facing jump frame: ${JSON.stringify(invalidJumpFrame)}`);
  const bigJumpIsometric = {
    maximumAltitude: maximumJumpAltitude,
    first: continuousJumpFrames[0],
    apex: continuousJumpFrames.reduce((best, frame) => (
      frame.altitude > best.altitude ? frame : best
    ), continuousJumpFrames[0]),
    last: continuousJumpFrames.at(-1),
    sampledFrames: continuousJumpFrames.length,
  };
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-big-jump-isometric.png`) });
  await page.click('.kkd-hud .kkr-camera-cycle');
  await page.waitForFunction(() => {
    const camera = window.__kakiRally?.state?.racing?.cameraManager;
    return camera?.mode === 'chase'
      && camera?.activeCamera?.isPerspectiveCamera
      && !camera?.transition;
  }, null, { timeout: 20_000 });
  const bigJumpChaseRecovery = await page.evaluate(() => window.__kkRacing.snapshot().camera);

  // Reproduce the player's exact failure path: complete the whole camera
  // cycle, return from FPV to ISO, and then take another large jump. A stale
  // perspective/ISO handoff used to leave the orthographic view aimed at sky.
  await page.click('.kkd-hud .kkr-camera-cycle');
  await page.waitForFunction(() => {
    const camera = window.__kakiRally?.state?.racing?.cameraManager;
    return camera?.mode === 'driver_fpv'
      && camera?.activeCamera?.isPerspectiveCamera
      && !camera?.transition;
  }, null, { timeout: 20_000 });
  await page.click('.kkd-hud .kkr-camera-cycle');
  await page.waitForFunction(() => {
    const camera = window.__kakiRally?.state?.racing?.cameraManager;
    return camera?.mode === 'isometric'
      && camera?.activeCamera?.isOrthographicCamera
      && !camera?.transition;
  }, null, { timeout: 20_000 });
  assert(
    await page.evaluate(() => window.__kkRacing.launchDuneJump(38)),
    'Dune Run post-cycle jump fixture failed',
  );
  const postCycleJumpFrames = [];
  for (let index = 0; index < 26; index += 1) {
    await page.waitForTimeout(50);
    postCycleJumpFrames.push(await page.evaluate(() => {
      const session = window.__kakiRally.state.racing;
      const manager = session.cameraManager;
      const camera = manager.activeCamera;
      const vehicle = manager._vehicleState();
      const playerNdc = vehicle.position.clone().project(camera);
      const forward = camera.getWorldDirection(camera.position.clone());
      return {
        altitude: vehicle.position.y - vehicle.groundHeight,
        cameraY: camera.position.y,
        focusY: manager.lastFrame?.focus?.y,
        playerNdc: playerNdc.toArray(),
        forwardY: forward.y,
        projection: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
        mode: manager.mode,
        transitioning: !!manager.transition,
        guardRecoveries: manager.rigs.isometric.guardRecoveries,
      };
    }));
  }
  const invalidPostCycleFrame = postCycleJumpFrames.find((frame) => (
    frame.projection !== 'orthographic'
    || frame.mode !== 'isometric'
    || frame.transitioning
    || !(frame.cameraY > frame.focusY + 8)
    || !(frame.forwardY < -0.15)
    || Math.abs(frame.playerNdc[0]) >= 0.92
    || Math.abs(frame.playerNdc[1]) >= 0.92
    || frame.playerNdc[2] < -1
    || frame.playerNdc[2] > 1
  ));
  assert(
    Math.max(...postCycleJumpFrames.map((frame) => frame.altitude)) > 18,
    'post-cycle ISO fixture did not produce a large jump',
  );
  assert(
    !invalidPostCycleFrame,
    `Dune ISO re-entry lost its terrain-facing jump frame: ${JSON.stringify(invalidPostCycleFrame)}`,
  );
  const postCycleIsoRecovery = {
    maximumAltitude: Math.max(...postCycleJumpFrames.map((frame) => frame.altitude)),
    apex: postCycleJumpFrames.reduce((best, frame) => (
      frame.altitude > best.altitude ? frame : best
    ), postCycleJumpFrames[0]),
    sampledFrames: postCycleJumpFrames.length,
  };
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-camera-cycle-isometric.png`) });

  assert(await page.evaluate(() => !!window.__kkRacing.finish()), 'Dune result could not be banked');
  await page.waitForFunction(() => (
    window.__kkRacing?.snapshot?.()?.phase === 'finished'
    && !document.querySelector('.kkd-finish')?.hidden
  ));
  const result = await page.evaluate(() => ({
    snapshot: window.__kkRacing.snapshot(),
    stored: JSON.parse(localStorage.getItem('kks_dune_records_v1') || '{}'),
  }));
  assert(result.snapshot.records.result, 'Dune result did not persist to the active session');
  assert(Object.keys(result.stored.records || {}).length > 0, 'Dune result did not persist locally');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-results.png`) });
  await page.click('.kkd-finish [data-action="retry"]');
  await page.waitForFunction(() => (
    window.__kakiRally?.getDiagnostics?.().activeMode === 'dunes'
    && window.__kkRacing?.snapshot?.()?.phase === 'countdown'
    && window.__kkRacing?.snapshot?.()?.records?.result === null
    && document.querySelectorAll('.kkd-hud').length === 1
  ), null, { timeout: 120_000 });
  evidence.resultRetry = await page.evaluate(() => window.__kakiRally.getDiagnostics());

  evidence.keyboard = keyboard;
  evidence.gamepad = gamepad;
  evidence.recovery = recovery;
  evidence.wheelspin = wheelspin;
  evidence.bigJumpIsometric = bigJumpIsometric;
  evidence.bigJumpChaseRecovery = bigJumpChaseRecovery;
  evidence.postCycleIsoRecovery = postCycleIsoRecovery;
  evidence.result = result.snapshot;
  await assertPauseRestartExitReentry(page, spec, evidence);

  if (backend === 'webgl') {
    evidence.events = {};
    for (const eventId of ['sunspine', 'mirage', 'litterbox']) {
      await startMode(page, 'dunes', eventId, {
        ...spec.options,
        duneEvent: eventId,
        duneVehicle: eventId === 'sunspine' ? 'cyber' : eventId === 'mirage' ? 'tipsy' : 'meowster',
      });
      await skipCountdown(page);
      await page.evaluate((kind) => window.__kkRacing.showDuneState(kind), (
        eventId === 'sunspine' ? 'crest' : eventId === 'mirage' ? 'boost' : 'slide'
      ));
      await page.waitForTimeout(520);
      const snapshot = await page.evaluate(() => window.__kkRacing.snapshot());
      assert.equal(snapshot.eventId, eventId, `${eventId} selected the wrong Dune event`);
      assert.equal(snapshot.terrain.authorityShared, true, `${eventId} lost shared terrain authority`);
      assert.equal(snapshot.assets.error, '', `${eventId} asset error: ${snapshot.assets.error}`);
      evidence.events[eventId] = snapshot;
      await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-${eventId}.png`) });
      await page.evaluate(() => window.__kakiRally.menu());
    }

    await startMode(page, 'dunes', 'raid-prologue', {
      ...spec.options,
      duneEvent: 'raid-prologue',
      duneVehicle: 'prototype',
      duneNavigationAssist: 'navigator',
      duneService: 'repair',
    });
    await skipCountdown(page);
    await page.evaluate(() => window.__kkRacing.warpDuneProgress(0.03, 5));
    await page.waitForTimeout(420);
    const raidOpening = await page.evaluate(() => window.__kkRacing.snapshot());
    assert.equal(raidOpening.eventId, 'raid-prologue', 'Rally Raid selected the wrong stage');
    assert.equal(raidOpening.rallyRaid.navigationAssist, 'navigator', 'Rally Raid lost Navigator assistance');
    assert.equal(raidOpening.vehicleId, 'prototype', 'Rally Raid selected the wrong vehicle');
    assert.equal(raidOpening.rallyRaid.roadbook.assist, 'navigator');
    assert(raidOpening.rallyRaid.roadbook.next, 'Rally Raid did not expose a next roadbook call');
    assert(raidOpening.visual.authoredBody, 'Rally Raid procedural vehicle was not treated as a finished body');
    assert.equal(raidOpening.visual.wheels, 4, 'Rally Raid lost independent wheel presentation');
    assert(raidOpening.terrain.authorityShared, 'Rally Raid lost shared terrain authority');
    await page.evaluate(() => window.__kkRacing.warpDuneProgress(0.5, 10));
    await page.waitForTimeout(240);
    const raidPenalty = await page.evaluate(() => window.__kkRacing.snapshot());
    assert(raidPenalty.rallyRaid.roadbook.missed > 0, 'Rally Raid did not report a missed waypoint');
    assert(raidPenalty.race.penaltySeconds >= 8, 'Rally Raid missed-waypoint penalty was not applied');
    assert(await page.evaluate(() => !!window.__kkRacing.finish()), 'Rally Raid result could not be finalized');
    await page.waitForFunction(() => window.__kkRacing.snapshot()?.phase === 'finished', null, { timeout: 20_000 });
    const raidResult = await page.evaluate(() => window.__kkRacing.snapshot());
    assert.equal(raidResult.rallyRaid.expedition.completedStages.length, 1, 'Rally Raid cumulative stage did not persist');
    assert.equal(raidResult.rallyRaid.expedition.completedStages[0], 'raid-prologue', 'Rally Raid stage id did not persist');
    assert.equal(raidResult.rallyRaid.serviceChoice, 'repair', 'Rally Raid service choice did not persist');
    assert.equal(raidResult.rallyRaid.expedition.lastService, 'repair', 'Rally Raid service record did not persist');
    assert(raidResult.rallyRaid.expedition.serviceSeconds >= 18, 'Rally Raid service time was not added');
    evidence.rallyRaid = { opening: raidOpening, penalty: raidPenalty, result: raidResult };
    await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-rally-raid-prologue.png`) });
    await page.evaluate(() => window.__kakiRally.menu());

    await page.evaluate(() => window.__kakiRally.openDraw());
    await page.waitForSelector('.kdt-editor');
    await drawCircle(page, 'mouse');
    const workshop = await page.evaluate(() => {
      const editor = window.__kdtEditor;
      editor.setTheme('dune');
      editor.setSize('mega');
      editor.setWidth('extra-wide');
      editor.draft.modifiers.randomJumps = true;
      editor.draft.modifiers.rain = true;
      editor.setEditorStage('elevation');
      editor.selectedElevationFraction = 0.28;
      editor.applyElevationTool('hill');
      editor.selectedElevationFraction = 0.62;
      editor.applyElevationTool('bank-left');
      editor.build();
      const course = editor.pendingBuild?.course;
      editor.finishBuild();
      return {
        valid: editor.validation.valid,
        theme: course?.drawThemeId,
        discipline: course?.drawDiscipline,
        elevationStamps: course?.drawDraft?.elevationProfile?.stamps?.length || 0,
      };
    });
    assert(
      workshop.valid
        && workshop.theme === 'dune'
        && workshop.discipline === 'dunes'
        && workshop.elevationStamps === 2,
      `Dune Workshop build failed: ${JSON.stringify(workshop)}`,
    );
    await page.waitForFunction(() => (
      window.__kakiRally?.getDiagnostics?.().activeMode === 'dunes'
      && window.__kkRacing?.snapshot?.()?.event?.isDrawTrack
    ), null, { timeout: 120_000 });
    await skipCountdown(page);
    await page.evaluate(() => window.__kkRacing.showDuneState('crest'));
    await page.waitForTimeout(520);
    const custom = await page.evaluate(() => window.__kkRacing.snapshot());
    assert(custom.event.isDrawTrack && custom.event.customTrackId, 'Dune Workshop lost custom identity');
    assert(custom.environment.drawPlacements >= 0, 'Dune Workshop environment did not initialize');
    assert.equal(custom.terrain.authorityShared, true, 'Dune Workshop renderer/physics heights diverged');
    evidence.workshop = { build: workshop, snapshot: custom };
    await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-workshop.png`) });
    await page.evaluate(() => window.__kakiRally.menu());

    const origin = new URL(page.url()).origin;
    await page.goto(`${origin}/index.html?qa=1&renderer=webgl&mode=dunes&play=1`, {
      waitUntil: 'load',
      timeout: 120_000,
    });
    await page.waitForFunction(() => (
      document.body.dataset.kakiRallyReady === 'true'
      && window.__kakiRally?.getDiagnostics?.().activeMode === 'dunes'
      && window.__kkRacing?.snapshot?.()?.eventId === 'whiskerwind'
    ), null, { timeout: 120_000 });
    evidence.deepLink = await page.evaluate(() => window.__kakiRally.getDiagnostics());
    await page.screenshot({ path: path.join(QA_DIR, `${backend}-dunes-deep-link.png`) });
    await page.evaluate(() => window.__kakiRally.menu());
  }
}

async function drawCircle(page, pointerType = 'mouse') {
  const box = await page.locator('.kdt-canvas').boundingBox();
  assert(box && box.width > 300 && box.height > 180, 'Draw Track canvas is too small');
  const points = Array.from({ length: 181 }, (_, index) => {
    const angle = index / 180 * Math.PI * 2;
    return {
      x: box.x + box.width * (0.5 + Math.cos(angle) * 0.31),
      y: box.y + box.height * (0.5 + Math.sin(angle) * 0.31),
    };
  });
  await page.evaluate(({ points, pointerType }) => {
    const canvas = document.querySelector('.kdt-canvas');
    const dispatch = (type, point, buttons) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: pointerType === 'touch' ? 92 : 91,
      pointerType,
      isPrimary: true,
      clientX: point.x,
      clientY: point.y,
      button: 0,
      buttons,
    }));
    dispatch('pointerdown', points[0], 1);
    for (const point of points.slice(1)) dispatch('pointermove', point, 1);
    dispatch('pointerup', points.at(-1), 0);
  }, { points, pointerType });
  await page.waitForFunction(() => window.__kdtEditor?.closed && window.__kdtEditor?.validation?.valid, null, {
    timeout: 15_000,
  });
}

async function addWorkshopCircuitStamp(page) {
  return page.evaluate(() => {
    const editor = window.__kdtEditor;
    const fractions = [0.22, 0.36, 0.48, 0.62, 0.76];
    for (const fraction of fractions) {
      const placement = {
        id: `browser-kicker-${Math.round(fraction * 100)}`,
        featureId: 'small-kicker',
        source: 'manual',
        anchor: {
          mode: 'spline',
          fraction,
          lateralOffset: 0,
          facing: 'forward',
          rotationOffset: 0,
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
        },
      };
      const validation = editor._validateFeature(placement);
      if (!validation.valid) continue;
      editor.draft.featurePlacements.push(validation.placement);
      editor.selectedPlacementId = validation.placement.id;
      editor.recalculate();
      return {
        id: validation.placement.id,
        featureId: validation.placement.featureId,
        fraction: validation.placement.anchor.fraction,
      };
    }
    return null;
  });
}

async function startFiveOverpassFixture(page) {
  return page.evaluate(async () => {
    const [
      { TrackSpline, TrackValidator, createCanonicalTrackLayout },
      { compileDrawTrackCourse },
    ] = await Promise.all([
      import('./src/racing/drawTrackGeometry.js'),
      import('./src/racing/drawTrackThemes.js'),
    ]);
    const controls = [
      { x: 0.05, y: 0.5 },
      { x: 0.95, y: 0.5 },
      { x: 0.95, y: 0.12 },
      { x: 0.88, y: 0.18 },
    ];
    for (let index = 1; index <= 5; index++) {
      controls.push({
        x: 0.88 - index * ((0.88 - 0.12) / 5),
        y: index % 2 ? 0.82 : 0.18,
      });
    }
    controls.push({ x: 0.05, y: 0.88 });
    const rawStroke = [];
    for (let index = 0; index < controls.length; index++) {
      const start = controls[index];
      const end = controls[(index + 1) % controls.length];
      for (let step = 0; step < 18; step++) {
        const t = step / 18;
        rawStroke.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        });
      }
    }
    const controlsClean = TrackSpline.clean(rawStroke, 0.18);
    const layout = createCanonicalTrackLayout(rawStroke, controlsClean, 'colossal');
    const options = {
      rawPoints: layout.rawPoints,
      controlPoints: layout.controlPoints,
      closed: true,
      sizeId: 'colossal',
      widthId: 'narrow',
      layoutTransform: layout.layoutTransform,
      allowOverpasses: true,
    };
    let validation = TrackValidator.validate(options);
    validation = TrackValidator.validate({
      ...options,
      startFraction: validation.suggestedStartFraction,
    });
    const draft = {
      id: 'browser-colossal-five',
      name: 'Five Skyway Scramble',
      themeId: 'coastal',
      sizeId: 'colossal',
      widthId: 'narrow',
      seed: 91573,
      smoothing: 0.18,
      layoutTransform: layout.layoutTransform,
      startFraction: validation.suggestedStartFraction,
      reverse: false,
      modifiers: { boostPads: false, randomJumps: false },
      crossingOverrides: [],
      featurePlacements: [{
        id: 'browser-speed-trap',
        featureId: 'speed-trap',
        source: 'manual',
        anchor: {
          mode: 'spline',
          fraction: 0.82,
          lateralOffset: 0,
          facing: 'forward',
          rotationOffset: 0,
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
        },
      }],
      rawStroke: layout.rawPoints,
      controlPoints: layout.controlPoints,
    };
    const course = compileDrawTrackCourse(draft, validation);
    const started = await window.__kakiRally.start('draw', course.id, {
      customCourse: course,
      customTrack: draft,
      carCount: 2,
      cameraMode: 'chase',
      practiceRun: true,
    });
    return {
      started: !!started,
      valid: validation.valid,
      length: validation.stats.length,
      crossings: validation.crossings.length,
      overpasses: validation.overpasses.length,
      solver: validation.crossingDiagnostics.solver,
      fractions: course.overpasses.map((bridge) => bridge.fraction),
    };
  });
}

async function runDraw(page, backend, evidence) {
  await page.click('.rally-mode-rail button[data-mode="draw"]');
  await page.waitForFunction(() => document.querySelector('.rally-setup')?.dataset.mode === 'draw');
  await page.click('.rally-setup [data-action="draw"]');
  await page.waitForSelector('.kdt-editor');
  await drawCircle(page, 'mouse');
  await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.setSize('mega');
    editor.setWidth('extra-wide');
    editor.draft.modifiers.randomJumps = true;
    editor.draft.modifiers.nightRace = true;
    editor.recalculate();
  });
  const placedStamp = await addWorkshopCircuitStamp(page);
  assert(placedStamp, 'Draw Workshop could not place a validated circuit ramp');
  const elevationProfile = await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.setEditorStage('elevation');
    editor.selectedElevationFraction = 0.24;
    editor.applyElevationTool('hill');
    editor.selectedElevationFraction = 0.61;
    editor.applyElevationTool('bank-left');
    editor.setElevationOverlay('grade');
    return {
      stamps: editor.draft.elevationProfile.stamps.length,
      valid: editor.elevationValidation.valid,
      maxGrade: editor.elevationValidation.maximumGrade,
      maxBank: editor.elevationValidation.maximumBank,
      panelVisible: !document.querySelector('.kdt-elevation-workbench').hidden,
    };
  });
  assert(
    elevationProfile.stamps === 2
      && elevationProfile.valid
      && elevationProfile.maxGrade > 0
      && elevationProfile.maxBank > 0
      && elevationProfile.panelVisible,
    `Draw Workshop elevation/banking failed: ${JSON.stringify(elevationProfile)}`,
  );
  evidence.elevationProfile = elevationProfile;
  await page.evaluate(() => window.__kdtEditor.save());
  const compatibility = await page.evaluate(async () => {
    const { TrackCodeCodec } = await import('./src/racing/drawTrackStorage.js');
    const editor = window.__kdtEditor;
    const draft = editor.currentDraft();
    const oldSchemaDraft = {
      ...draft,
      featurePlacements: [],
      crossingOverrides: [],
      elevationProfile: { version: 1, stamps: [] },
    };
    const legacyPoints = Array.from({ length: 40 }, (_, index) => {
      const angle = index / 40 * Math.PI * 2;
      return {
        x: 0.5 + Math.cos(angle) * 0.43,
        y: 0.5 + Math.sin(angle) * 0.38,
      };
    });
    const kdt1 = TrackCodeCodec.encodeLegacy({
      // KDT1 predates layout transforms. Use an original-schema Grand preset
      // so its canonical migration has enough physical lap length to remain
      // raceable after the legacy decoder refits the stroke.
      name: 'Legacy QA Circuit',
      sizeId: 'grand',
      widthId: 'standard',
      themeId: 'countryside',
      seed: 1987,
      startFraction: 0.9513888888888888,
      smoothing: 0.55,
      rawStroke: legacyPoints,
      controlPoints: legacyPoints,
      layoutTransform: undefined,
    });
    const kdt2 = TrackCodeCodec.encode(oldSchemaDraft);
    const kdt3 = TrackCodeCodec.encode(draft);
    const legacy = TrackCodeCodec.decode(kdt1);
    const current = TrackCodeCodec.decode(kdt2);
    const workshop = TrackCodeCodec.decode(kdt3);
    editor.openCode(false);
    const dialog = document.querySelector('.kdt-code-dialog');
    dialog.querySelector('textarea').value = kdt1;
    await editor.codeAction('load');
    const legacyValid = editor.validation.valid;
    const legacyLoaded = editor.closed && editor.draft.rawStroke.length >= 6;
    const legacyErrors = editor.validation.errors.map((issue) => issue.id);
    const legacyLength = editor.validation.stats?.length;
    editor.openCode(false);
    dialog.querySelector('textarea').value = kdt2;
    await editor.codeAction('load');
    const currentValid = editor.validation.valid;
    editor.openCode(false);
    dialog.querySelector('textarea').value = kdt3;
    await editor.codeAction('load');
    editor.draft.reverse = !editor.draft.reverse;
    editor.recalculate();
    editor.save();
    return {
      kdt1Prefix: kdt1.slice(0, 5),
      kdt2Prefix: kdt2.slice(0, 5),
      kdt3Prefix: kdt3.slice(0, 5),
      legacyValid,
      legacyLoaded,
      legacyErrors,
      importedLegacySize: legacy.sizeId,
      legacyLength,
      currentValid,
      workshopValid: editor.validation.valid,
      legacyPoints: legacy.controlPoints.length,
      currentPoints: current.controlPoints.length,
      workshopFeatures: workshop.featurePlacements.length,
      workshopElevation: workshop.elevationProfile.stamps.length,
      editorFeatures: editor.draft.featurePlacements.length,
      editorElevation: editor.draft.elevationProfile.stamps.length,
      reverse: editor.draft.reverse,
    };
  });
  assert.deepEqual(
    [compatibility.kdt1Prefix, compatibility.kdt2Prefix, compatibility.kdt3Prefix],
    ['KDT1-', 'KDT2-', 'KDT3-'],
    'Draw Track codes lost compatibility prefixes',
  );
  evidence.compatibility = compatibility;
  assert(
    compatibility.legacyValid
      && compatibility.legacyLoaded
      && compatibility.currentValid
      && compatibility.workshopValid
      && compatibility.workshopFeatures === 1
      && compatibility.workshopElevation === 2
      && compatibility.editorFeatures === 1
      && compatibility.editorElevation === 2,
    `KDT code import failed browser validation: ${JSON.stringify(compatibility)}`,
  );

  await page.evaluate(() => {
    window.__setKakiQaPad({ lx: 0.8 });
  });
  const controllerBefore = await page.evaluate(() => ({ ...window.__kdtEditor.controllerCursor }));
  await page.waitForTimeout(220);
  const controllerAfter = await page.evaluate(() => ({ ...window.__kdtEditor.controllerCursor }));
  await page.evaluate(() => window.__setKakiQaPad({}));
  assert(controllerAfter.visible && controllerAfter.x > controllerBefore.x, 'Draw Track controller cursor did not move');

  await page.screenshot({ path: path.join(QA_DIR, `${backend}-draw-editor.png`) });
  const placementPreview = await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.selectFeature('large-launch-ramp');
    editor.setEditorStage('place');
    let valid = null;
    for (let index = 0; index < editor.validation.normalizedSamples.length; index += 12) {
      const candidate = editor._featureCandidate(editor.validation.normalizedSamples[index]);
      if (candidate?.valid) {
        valid = candidate;
        break;
      }
    }
    editor.placementGhost = valid;
    editor._syncFeatureWorkbench();
    editor.requestDraw();
    return {
      valid: !!valid?.valid,
      message: valid?.message,
      trajectoryPoints: valid?.trajectory?.points?.length || 0,
    };
  });
  assert(
    placementPreview.valid && placementPreview.trajectoryPoints > 2,
    `Draw Workshop ramp ghost lost physical trajectory feedback: ${JSON.stringify(placementPreview)}`,
  );
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-draw-place-ramp.png`) });
  const invalidPreview = await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.placementGhost = editor._featureCandidate({ x: 0.5, y: 0.5 });
    editor._syncFeatureWorkbench();
    editor.requestDraw();
    return {
      valid: !!editor.placementGhost?.valid,
      message: editor.placementGhost?.message || '',
    };
  });
  assert(!invalidPreview.valid && invalidPreview.message, 'Draw Workshop did not explain an invalid placement');
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-draw-invalid-placement.png`) });
  evidence.placementPreview = { valid: placementPreview, invalid: invalidPreview };
  await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.build();
    editor.finishBuild();
  });
  await page.waitForFunction(() => window.__kakiRally.getDiagnostics().activeMode === 'draw', null, {
    timeout: 120_000,
  });
  await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  evidence.flyover = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert(
    evidence.flyover.phase === 'flyover' && evidence.flyover.camera?.cinematic,
    'Draw Workshop did not enter its build flyover',
  );
  await page.evaluate(() => {
    const cinematic = window.__kakiRally.state.racing?.cameraManager?.cinematic;
    if (cinematic) cinematic.elapsed = cinematic.duration * 0.28;
  });
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-draw-build-flyover.png`) });
  await assertRallyGrass(page, 'draw');
  await skipCountdown(page);
  const raced = await exerciseKeyboard(page);
  await exerciseTouch(page, 'draw');
  const gamepad = await exerciseGamepad(page);
  const race = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert.equal(race.raceMode, 'draw');
  assert(race.customTrackId && race.overpasses >= 0 && race.checkpoints > 0, 'Generated Draw Track race is incomplete');
  assert(
    race.workshop.features?.built >= 1 && race.workshop.features?.missing?.length === 0,
    `Draw Workshop authored stamp failed to load: ${JSON.stringify(race.workshop.features)}`,
  );
  evidence.raced = raced;
  evidence.gamepad = gamepad;
  evidence.race = race;

  const spec = {
    mode: 'draw',
    courseId: race.courseId,
    options: {
      customCourse: await page.evaluate(() => window.__kakiRally.state.racing.course),
      customTrack: await page.evaluate(() => window.__kakiRally.state.racing.customTrack),
      carCount: 4,
    },
  };
  await assertPauseRestartExitReentry(page, spec, evidence);

  const multi = await startFiveOverpassFixture(page);
  assert(
    multi.started
      && multi.valid
      && multi.crossings === 5
      && multi.overpasses === 5
      && multi.solver === 'exact-global',
    `Colossal five-overpass fixture failed: ${JSON.stringify(multi)}`,
  );
  await page.waitForFunction(() => (
    window.__kkRacing?.snapshot?.()?.workshop?.bridges?.bridgeCount === 5
  ), null, { timeout: 120_000 });
  await skipCountdown(page);
  await page.evaluate((fraction) => {
    window.__kkRacing.setCameraMode('chase');
    window.__kkRacing.warpShowcase(fraction);
  }, multi.fractions[2]);
  await page.keyboard.down('w');
  await page.waitForTimeout(280);
  await page.keyboard.up('w');
  await page.waitForTimeout(400);
  const withBridges = await page.evaluate(() => ({
    snapshot: window.__kkRacing.snapshot(),
    renderer: window.__kakiRally.getDiagnostics().renderer,
  }));
  await page.evaluate(() => {
    window.__kakiRally.state.racing.overpassKit.group.visible = false;
  });
  await page.waitForTimeout(180);
  const withoutBridges = await page.evaluate(() => window.__kakiRally.getDiagnostics().renderer);
  await page.evaluate(() => {
    window.__kakiRally.state.racing.overpassKit.group.visible = true;
  });
  await page.waitForTimeout(180);
  const bridgeDiagnostics = withBridges.snapshot.workshop.bridges;
  const templateBounds = bridgeDiagnostics.templateBounds;
  assert(
    bridgeDiagnostics.drawGroups <= 32
      && bridgeDiagnostics.moduleInstances >= 200
      && bridgeDiagnostics.missing.length === 0
      && templateBounds.bridge_deck_module.width > 10
      && templateBounds.bridge_guardrail_module.height > 1
      && templateBounds.bridge_support_standard.height > 5,
    `Colossal authored bridge batching escaped its budget: ${JSON.stringify(bridgeDiagnostics)}`,
  );
  assert(
    !withBridges.snapshot.camera.collision.blocked,
    `Chase camera was trapped by the authored skyway: ${JSON.stringify(withBridges.snapshot.camera.collision)}`,
  );
  evidence.multiOverpass = {
    ...multi,
    bridgeDiagnostics,
    drawCallsWithBridges: withBridges.renderer.drawCalls,
    drawCallsWithoutBridges: withoutBridges.drawCalls,
    bridgeDrawCallCost: withBridges.renderer.drawCalls - withoutBridges.drawCalls,
    trianglesWithBridges: withBridges.renderer.triangles,
    trianglesWithoutBridges: withoutBridges.triangles,
  };
  assert(
    evidence.multiOverpass.bridgeDrawCallCost <= 80,
    `Five skyways cost too many draw calls: ${JSON.stringify(evidence.multiOverpass)}`,
  );
  await page.screenshot({
    path: path.join(QA_DIR, `${backend}-draw-colossal-five-overpasses.png`),
  });
  await page.evaluate(() => window.__kakiRally.menu());

  await page.evaluate(() => window.__kakiRally.openDraw());
  await page.waitForSelector('.kdt-editor');
  await drawCircle(page, 'touch');
  evidence.touch = await page.evaluate(() => ({
    valid: window.__kdtEditor.validation.valid,
    points: window.__kdtEditor.draft.rawStroke.length,
    pointer: window.__kakiRally.getDiagnostics().input.lastDevice,
  }));
  assert(evidence.touch.valid, 'emulated-touch track is not raceable');
  await page.evaluate(() => window.__kakiRally.menu());
}

async function finishTrialsCourse(page, trackId, evidence, { fromMenu = false } = {}) {
  const spec = {
    mode: 'trials',
    courseId: 'forest',
    options: {
      trialsTrackId: trackId,
      trialsVehicle: trackId === 'quarry' ? 'buggy' : 'monster',
    },
  };
  if (fromMenu) await startModeFromMenu(page, spec);
  else await startMode(page, spec.mode, spec.courseId, spec.options);
  await skipCountdown(page);
  if (trackId === 'meadow') {
    await exerciseKeyboard(page);
    await exerciseTouch(page, 'trials');
    evidence.gamepad = await exerciseGamepad(page);
    assert(await page.evaluate(() => window.__kkRacing.restartCheckpoint()), 'Trials checkpoint restart failed');
  }
  const checkpointCount = await page.evaluate(() => window.__kakiRally.getSnapshot().checkpoint.total);
  for (let index = 0; index < checkpointCount; index++) {
    assert(await page.evaluate((value) => window.__kkRacing.warpCheckpoint(value), index), `Trials checkpoint ${index} warp failed`);
    await page.keyboard.down('w');
    await page.waitForTimeout(160);
    await page.keyboard.up('w');
  }
  assert(await page.evaluate(() => window.__kkRacing.warpFinish()), `Trials ${trackId} finish warp failed`);
  await page.waitForFunction(() => window.__kakiRally.getSnapshot()?.finished === true, null, {
    timeout: 15_000,
  });
  const result = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert(result.medal, `Trials ${trackId} did not award a medal`);
  assert(result.ghostSampleCount >= 2, `Trials ${trackId} did not record a ghost`);
  evidence[trackId] = result;
  await page.evaluate(() => window.__kakiRally.menu());
}

async function runTrialsWorkshop(page, backend, evidence, {
  verifyRestart = true,
} = {}) {
  const officialProgressBefore = await page.evaluate(() => (
    localStorage.getItem('kks_rally_trials_v1')
  ));
  await page.evaluate(() => window.__kakiRally.openTrialsWorkshop());
  await page.waitForSelector('.ktr-editor');
  const authored = await page.evaluate(async () => {
    const { getCourseFeature } = await import('./src/racing/courseFeatureCatalog.js');
    const { TrialsCourseCodec } = await import('./src/racing/trialsWorkshopStorage.js');
    const editor = window.__ktrEditor;
    editor.applyTerrain('gap', 160);
    const gap = editor.course.gaps[0];
    const kicker = getCourseFeature('small-kicker');
    const kickerX = gap.start - kicker.footprint.length * 0.5 - 0.02;
    editor.setStage('place');
    const placed = editor.placeFeature('small-kicker', kickerX);
    editor.setStage('test');
    editor.testFromX = 128;
    editor.selectedPlacementId = null;
    editor.focusTestView();
    editor.render();
    const saved = editor.save();
    const code = TrialsCourseCodec.encode(saved);
    const decoded = TrialsCourseCodec.decode(code);
    return {
      placed,
      valid: editor.validation.valid,
      errors: editor.validation.errors.map((issue) => issue.message),
      jumps: editor.validation.jumps.map((jump) => ({
        label: jump.label,
        monster: jump.monster.message,
        buggy: jump.buggy.message,
      })),
      courseId: saved.id,
      featureCount: saved.featurePlacements.length,
      gap: { ...gap },
      kickerX,
      codePrefix: code.slice(0, 5),
      codeBytes: code.length,
      decodedFeatures: decoded.course.featurePlacements.length,
      decodedGaps: decoded.course.gaps.length,
    };
  });
  assert(
    authored.placed
      && authored.valid
      && authored.codePrefix === 'KTR1-'
      && authored.decodedFeatures === authored.featureCount
      && authored.decodedGaps === 1,
    `Trials Workshop authoring/codec failed: ${JSON.stringify(authored)}`,
  );
  await page.screenshot({
    path: path.join(QA_DIR, `${backend}-trials-workshop-gap.png`),
  });
  assert(await page.evaluate(() => window.__ktrEditor.build({ testFromHere: true })), 'Trials Workshop test build failed');
  await page.waitForFunction(() => (
    window.__kakiRally.getDiagnostics().activeMode === 'trials'
      && window.__kkRacing?.snapshot?.()?.customCourse
  ), null, { timeout: 120_000 });
  await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  await page.waitForFunction(() => (
    window.__kkRacing?.snapshot?.()?.assets?.workshop?.built >= 4
  ), null, { timeout: 120_000 });
  await skipCountdown(page);
  assert(
    await page.evaluate(() => window.__kkRacing.setCameraMode('isometric')),
    'Custom Trials rejected its side/ISO camera',
  );
  await page.waitForTimeout(420);
  const opening = await page.evaluate(() => window.__kkRacing.snapshot());
  assert(
    opening.customCourse
      && opening.practiceRun
      && Math.abs(opening.practiceStartX - 128) < 0.6
      && opening.assets.workshop.missing.length === 0,
    `Custom Trials runtime did not preserve its authored test start/assets: ${JSON.stringify(opening)}`,
  );
  assert(
    await page.evaluate(() => window.__kkRacing.restartCheckpoint()),
    'Custom Trials checkpoint restart failed',
  );
  const afterCheckpointRestart = await page.evaluate(() => window.__kkRacing.snapshot());
  assert(
    Math.abs(afterCheckpointRestart.x - 128) < 0.8,
    `Custom Trials restart lost the selected test location: ${afterCheckpointRestart.x}`,
  );
  // Capture the steady-state course rather than a valid but intentionally
  // oversized restart callout that would hide the authored ramp and terrain.
  await page.evaluate(() => {
    const session = window.__kakiRally.state.racing;
    session.calloutTime = 0;
    session.callout = '';
    session.goTime = 0;
  });
  await page.waitForTimeout(260);
  await page.screenshot({
    path: path.join(QA_DIR, `${backend}-trials-workshop-custom-run.png`),
  });

  let restart = null;
  if (verifyRestart) {
    assert(
      await page.evaluate(() => window.__kakiRally.restart().then(Boolean)),
      'Custom Trials full restart failed',
    );
    await page.waitForFunction((courseId) => {
      const snapshot = window.__kkRacing?.snapshot?.();
      return snapshot?.customCourse
        && snapshot.trackId === courseId
        && snapshot.practiceRun
        && Math.abs(snapshot.practiceStartX - 128) < 0.8;
    }, authored.courseId, { timeout: 120_000 });
    restart = await page.evaluate(() => window.__kkRacing.snapshot());
  }
  await page.evaluate(() => window.__kakiRally.menu());
  const customCourse = await page.evaluate(async (courseId) => {
    const { TrialsCourseLibrary } = await import('./src/racing/trialsWorkshopStorage.js');
    return new TrialsCourseLibrary().get(courseId);
  }, authored.courseId);
  assert(customCourse?.custom, 'Saved custom Trials course was not available after menu return');
  await startMode(page, 'trials', 'forest', {
    customCourse,
    trialsVehicle: 'buggy',
  });
  await skipCountdown(page);
  const buggy = await page.evaluate(() => window.__kkRacing.snapshot());
  assert(
    buggy.customCourse
      && buggy.trackId === authored.courseId
      && buggy.vehicleId === 'buggy'
      && !buggy.practiceRun,
    `Custom Trials vehicle change lost the authored course: ${JSON.stringify(buggy)}`,
  );
  await page.evaluate(() => window.__kakiRally.menu());
  const officialProgressAfter = await page.evaluate(() => (
    localStorage.getItem('kks_rally_trials_v1')
  ));
  assert.equal(
    officialProgressAfter,
    officialProgressBefore,
    'Custom Trials testing changed official progression records',
  );
  evidence.workshop = {
    authored,
    opening,
    afterCheckpointRestart,
    restart,
    buggy,
    storageBytes: await page.evaluate(() => (
      localStorage.getItem('kks_rally_trials_courses_v1')?.length || 0
    )),
  };
}

async function runTrials(page, backend, evidence) {
  await finishTrialsCourse(page, 'meadow', evidence, { fromMenu: true });
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('kks_rally_trials_v1') || '{}'));
  assert(progress.unlocked?.includes('quarry'), 'B-medal progression did not unlock Quarry');
  assert(progress.records?.meadow?.ghost?.length >= 2, 'PB ghost was not persisted');
  assert(progress.records.meadow.ghost.length <= 1_800, 'PB ghost exceeded the sample cap');
  await finishTrialsCourse(page, 'quarry', evidence);
  await finishTrialsCourse(page, 'crown', evidence);

  await startMode(page, 'trials', 'forest', { trialsTrackId: 'meadow', trialsVehicle: 'monster' });
  await skipCountdown(page);
  assert(
    await page.evaluate(() => window.__kkRacing.setCameraMode('isometric')),
    'Trials rejected its production side-view camera',
  );
  await page.evaluate(() => {
    const session = window.__kakiRally.state.racing;
    session.goTime = 0;
    session.calloutTime = 0;
    session.callout = '';
  });
  await page.waitForTimeout(260);
  const ghost = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert(ghost.pbGhostSampleCount >= 2, 'saved Trials ghost did not replay on re-entry');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-trials.png`) });
  evidence.ghostReplay = ghost;
  const spec = { mode: 'trials', courseId: 'forest', options: { trialsTrackId: 'meadow', trialsVehicle: 'monster' } };
  await assertPauseRestartExitReentry(page, spec, evidence);
  await runTrialsWorkshop(page, backend, evidence);
}

async function runCrash(page, backend, evidence) {
  const spec = {
    mode: 'crash',
    courseId: 'forest',
    options: { crashVehicle: 'iron', crashQuality: 'medium' },
  };
  evidence.opening = await startModeFromMenu(page, spec);
  assert.equal((await page.evaluate(() => window.__kkCrash.snapshot().quality)), 'medium');
  await page.evaluate(() => window.__kkCrash.skipIntro());
  await page.waitForFunction(() => ['APPROACH', 'LIVE_CRASH'].includes(window.__kkCrash.snapshot().phase), null, {
    timeout: 15_000,
  });
  await exerciseTouch(page, 'crash');
  evidence.gamepad = await exerciseGamepad(page);
  assert(await page.evaluate(() => window.__kkRacing.setCameraMode('driver_fpv')), 'Catastrophe FPV camera rejected');
  assert(await page.evaluate(() => window.__kkRacing.setCameraMode('chase')), 'Catastrophe chase camera rejected');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-crash-approach.png`) });

  assert(await page.evaluate(() => window.__kakiRally.pause()), 'Catastrophe pause failed');
  assert(await page.evaluate(() => window.__kakiRally.pause()), 'Catastrophe resume failed');
  assert(await page.evaluate(() => window.__kakiRally.restart().then(Boolean)), 'Catastrophe restart failed');
  await page.waitForFunction(() => window.__kkCrash?.snapshot?.()?.worldReady);
  await page.evaluate(() => window.__kkCrash.skipIntro());
  await page.waitForFunction(() => ['APPROACH', 'LIVE_CRASH'].includes(window.__kkCrash.snapshot().phase));

  const drivenImpact = await page.evaluate(() => {
    const session = window.__kakiRally.state.racing;
    let impactStep = -1;
    let closestToBlocker = Infinity;
    for (let step = 0; step < 2_800; step++) {
      const position = session.player.body.translation();
      closestToBlocker = Math.min(closestToBlocker, Math.abs(-3.3 - position.z));
      const brake = session.trafficClock < 6.7;
      window.__kkCrash.driveFixedSteps(1, {
        throttle: brake ? 0 : 1,
        steer: 0,
        brake,
        handbrake: false,
      });
      if (session.score.participants.size > 0) {
        impactStep = step;
        break;
      }
    }
    return {
      impactStep,
      closestToBlocker,
      position: session.player.body.translation(),
      snapshot: window.__kkCrash.snapshot(),
    };
  });
  assert(drivenImpact.impactStep >= 0, `Catastrophe ordinary controls produced no crash: ${JSON.stringify(drivenImpact)}`);
  assert(drivenImpact.snapshot.score.largestImpact?.value > 0, 'Catastrophe did not rank its first impact');
  evidence.firstImpact = drivenImpact;

  await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(120);
  const phase = await page.evaluate(() => {
    for (let batch = 0; batch < 8; batch++) {
      window.__kkCrash.driveFixedSteps(1800, { throttle: 1, steer: batch % 2 ? 0.08 : -0.04 });
      const current = window.__kkCrash.snapshot().phase;
      if (current === 'REPLAY' || current === 'RESULTS') return current;
    }
    return window.__kkCrash.snapshot().phase;
  });
  assert(['REPLAY', 'RESULTS'].includes(phase), `Catastrophe did not reach replay: ${phase}`);
  if (phase === 'REPLAY') {
    await page.screenshot({ path: path.join(QA_DIR, `${backend}-crash-replay.png`) });
    await page.click('[data-action="skip-replay"]');
    await page.waitForFunction(() => window.__kkCrash.snapshot().phase === 'RESULTS', null, { timeout: 15_000 });
  }
  const results = await page.evaluate(() => window.__kkCrash.snapshot());
  assert(results.result && results.replayMemoryBytes > 0, 'Catastrophe results or replay recording are missing');
  assert(results.phaseHistory.some((entry) => entry.phase === 'LIVE_CRASH'), 'Catastrophe never entered live crash phase');
  assert(results.phaseHistory.some((entry) => entry.phase === 'REPLAY'), 'Catastrophe never entered replay phase');
  evidence.results = results;
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-crash-results.png`) });

  await page.click('[data-action="replay-again"]');
  await page.waitForFunction(() => window.__kkCrash.snapshot().phase === 'REPLAY');
  await page.click('[data-action="skip-replay"]');
  await page.waitForFunction(() => window.__kkCrash.snapshot().phase === 'RESULTS');
  await page.evaluate(() => window.__kakiRally.menu());
  await page.waitForFunction(() => window.__kakiRally.getDiagnostics().hudRoots === 0);
  await startMode(page, spec.mode, spec.courseId, spec.options);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.kkc-hud').length), 1, 'Catastrophe re-entry duplicated HUD');
  evidence.reentry = await page.evaluate(() => window.__kakiRally.getDiagnostics());
  await page.evaluate(() => window.__kakiRally.menu());
}

async function runWebGl(browser, origin, report) {
  const diagnostics = report.webgl.diagnostics;
  const { context, page, boot } = await bootPage(browser, origin, 'webgl', diagnostics, {
    catastrophe: catastropheRequested,
  });
  report.webgl.boot = boot;
  try {
    assert(await page.locator('[data-mode="circuit"]').count(), 'Off-Road GP menu control is missing');
    assert.equal(
      await page.locator('[data-mode="crash"]').count(),
      catastropheRequested ? 1 : 0,
      'Catastrophe menu visibility does not match the explicit development flag',
    );
    if (requestedScope === 'all' || requestedScope === 'circuit') await runRoadMode(page, {
      mode: 'circuit',
      courseId: 'forest',
      options: { carCount: 6 },
      mechanic: 'jump',
    }, 'webgl', report.webgl.modes.circuit);
    if (requestedScope === 'all' || requestedScope === 'drift') await runRoadMode(page, {
      mode: 'drift',
      courseId: 'twilight',
      options: { carCount: 6, driftLayout: 'wallrun', driftCar: 'monarch' },
      mechanic: 'drift',
    }, 'webgl', report.webgl.modes.drift);
    if (requestedScope === 'all' || requestedScope === 'stock') await runRoadMode(page, {
      mode: 'stock',
      courseId: 'cinder',
      options: { carCount: 16, stockVariant: 'dirt' },
      mechanic: 'damage',
    }, 'webgl', report.webgl.modes.stock);
    if (requestedScope === 'all' || requestedScope === 'draw') await runDraw(page, 'webgl', report.webgl.modes.draw);
    if (requestedScope === 'all' || requestedScope === 'monster') await runMonster(page, 'webgl', report.webgl.modes.monster);
    if (requestedScope === 'all' || requestedScope === 'dunes') await runDunes(page, 'webgl', report.webgl.modes.dunes);
    if (requestedScope === 'all' || requestedScope === 'trials') await runTrials(page, 'webgl', report.webgl.modes.trials);
    if (catastropheRequested && (requestedScope === 'all' || requestedScope === 'crash')) {
      await runCrash(page, 'webgl', report.webgl.modes.crash);
    }

    if (requestedScope === 'all') {
      const persistenceBefore = await page.evaluate((includeCatastrophe) => ({
        draw: localStorage.getItem('kks_draw_tracks_v1'),
        dunes: localStorage.getItem('kks_dune_records_v1'),
        trials: localStorage.getItem('kks_rally_trials_v1'),
        trialsCourses: localStorage.getItem('kks_rally_trials_courses_v1'),
        ...(includeCatastrophe ? {
          crash: localStorage.getItem('kks_kaki_catastrophe_records_v1'),
        } : {}),
      }), catastropheRequested);
      assert(
        persistenceBefore.draw
          && persistenceBefore.dunes
          && persistenceBefore.trials
          && persistenceBefore.trialsCourses
          && (!catastropheRequested || persistenceBefore.crash),
        'legacy or Workshop save keys were not populated',
      );
      await page.reload({ waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction(() => !!window.__kakiRally);
      const persistenceAfter = await page.evaluate((includeCatastrophe) => ({
        draw: localStorage.getItem('kks_draw_tracks_v1'),
        dunes: localStorage.getItem('kks_dune_records_v1'),
        trials: localStorage.getItem('kks_rally_trials_v1'),
        trialsCourses: localStorage.getItem('kks_rally_trials_courses_v1'),
        ...(includeCatastrophe ? {
          crash: localStorage.getItem('kks_kaki_catastrophe_records_v1'),
        } : {}),
      }), catastropheRequested);
      assert.deepEqual(persistenceAfter, persistenceBefore, 'records changed across reload');
      report.webgl.persistence = {
        drawBytes: persistenceAfter.draw.length,
        duneBytes: persistenceAfter.dunes.length,
        trialsBytes: persistenceAfter.trials.length,
        trialsCourseBytes: persistenceAfter.trialsCourses.length,
        ...(persistenceAfter.crash ? { crashBytes: persistenceAfter.crash.length } : {}),
      };
    }

  } finally {
    await context.close();
  }
  if (['all', 'draw', 'responsive'].includes(requestedScope)) {
    await runWorkshopResponsive(browser, origin, report);
  }
  if (['all', 'dunes', 'responsive'].includes(requestedScope)) {
    await runDuneResponsive(browser, origin, report);
  }
  if (['all', 'draw', 'visual'].includes(requestedScope)) {
    await runDrawThemeVariants(browser, origin, report);
  }
  if (requestedScope === 'all') await runWebGpuFallback(browser, origin, report);
}

async function runWebGpu(browser, origin, report) {
  const diagnostics = report.webgpu.diagnostics;
  const { context, page, boot } = await bootPage(browser, origin, 'webgpu', diagnostics);
  report.webgpu.boot = boot;
  try {
    const specs = [
      ['circuit', 'forest', { carCount: 4 }],
      ['drift', 'twilight', { carCount: 4 }],
      ['stock', 'cinder', { carCount: 8 }],
      ['monster', 'forest', { carCount: 1, monsterEvent: 'free-ride', monsterVehicle: 'meowster', monsterArena: 'crown-chaos-coliseum' }],
      ['dunes', 'whiskerwind', {
        carCount: 1,
        duneEvent: 'whiskerwind',
        duneVehicle: 'meowster',
        duneTerrain: 'medium',
        duneDeformation: 'medium',
        duneParticles: 'medium',
        duneDust: 'medium',
        cameraMode: 'chase',
      }],
      ['trials', 'forest', { trialsTrackId: 'meadow', trialsVehicle: 'monster' }],
    ].filter(([mode]) => requestedScope === 'all' || requestedScope === mode);
    for (const [mode, courseId, options] of specs) {
      await startMode(page, mode, courseId, options);
      await skipCountdown(page);
      if (mode === 'dunes') await page.evaluate(() => window.__kkRacing.showDuneState('wheelspin'));
      else if (mode !== 'trials') await page.evaluate((activeMode) => (
        window.__kkRacing.showState?.(activeMode === 'drift' ? 'drift' : 'boost')
        || window.__kkRacing.showMonsterJump?.()
      ), mode);
      else await page.evaluate(() => window.__kkRacing.warpCheckpoint(0));
      if (mode === 'dunes') {
        await page.waitForFunction(() => {
          const snapshot = window.__kkRacing?.snapshot?.();
          return snapshot?.deformation?.appliedBrushes > 0
            && snapshot?.vfx?.roosterTail?.emittedSamples > 0
            && snapshot?.vfx?.dust?.spawned > 0;
        }, null, { timeout: 20_000 });
      } else {
        await page.waitForTimeout(220);
      }
      const diagnosticsNow = await page.evaluate(() => window.__kakiRally.getDiagnostics());
      assert.equal(diagnosticsNow.backend, 'webgpu');
      assert(diagnosticsNow.renderer.drawCalls > 0, `${mode} WebGPU made no submissions`);
      if (mode === 'dunes') {
        const snapshot = await page.evaluate(() => window.__kkRacing.snapshot());
        assert.equal(snapshot.terrain.authorityShared, true, 'Dune WebGPU renderer/physics heights diverged');
        assert(snapshot.terrain.clipmap.shaderTrimmedUnderlays, 'Dune WebGPU lost clipmap trims');
        assert(snapshot.terrain.clipmap.signedTrackContrast, 'Dune WebGPU lost signed track shading');
        assert(snapshot.deformation.maximumDepression > 0, 'Dune WebGPU tires produced no rut');
        assert(snapshot.vfx.roosterTail.bufferAuthorityShared, 'Dune WebGPU wake animates a detached buffer');
        assert(snapshot.vfx.roosterTail.emittedSamples > 0, 'Dune WebGPU emitted no swept wake');
        assert(snapshot.vfx.dust.spawned > 0, 'Dune WebGPU emitted no sand grains');
        assert.equal(snapshot.assets.error, '', `Dune WebGPU asset error: ${snapshot.assets.error}`);
        await page.evaluate(() => window.__kkRacing.setCameraMode('isometric'));
        await page.waitForFunction(() => {
          const camera = window.__kakiRally?.state?.racing?.cameraManager;
          return camera?.mode === 'isometric'
            && camera?.activeCamera?.isOrthographicCamera
            && !camera?.transition;
        });
        await page.evaluate(() => window.__kkRacing.launchDuneJump(30));
        await page.waitForFunction(() => (
          window.__kkRacing?.snapshot?.()?.y
            - window.__kakiRally.state.racing.kart.groundHeight > 3
        ), null, { timeout: 20_000 });
        const jump = await page.evaluate(() => {
          const session = window.__kakiRally.state.racing;
          const manager = session.cameraManager;
          const camera = manager.activeCamera;
          const player = session.visual.root
            .getWorldPosition(session.visual.root.position.clone())
            .project(camera);
          return {
            cameraY: camera.position.y,
            focusY: manager.lastFrame.focus.y,
            forwardY: camera.getWorldDirection(camera.position.clone()).y,
            playerNdc: player.toArray(),
          };
        });
        assert(jump.cameraY > jump.focusY + 8 && jump.forwardY < -0.15,
          `Dune WebGPU ISO lost its terrain-facing jump frame: ${JSON.stringify(jump)}`);
        assert(Math.abs(jump.playerNdc[0]) < 0.92 && Math.abs(jump.playerNdc[1]) < 0.92,
          `Dune WebGPU jump left the ISO frame: ${JSON.stringify(jump)}`);
        await page.screenshot({ path: path.join(QA_DIR, 'webgpu-dunes.png') });

        for (const expectedMode of ['chase', 'driver_fpv', 'isometric']) {
          await page.click('.kkd-hud .kkr-camera-cycle');
          await page.waitForFunction((cameraMode) => {
            const camera = window.__kakiRally?.state?.racing?.cameraManager;
            const correctProjection = cameraMode === 'isometric'
              ? camera?.activeCamera?.isOrthographicCamera
              : camera?.activeCamera?.isPerspectiveCamera;
            return camera?.mode === cameraMode && correctProjection && !camera?.transition;
          }, expectedMode, { timeout: 20_000 });
        }
        await page.evaluate(() => window.__kkRacing.launchDuneJump(38));
        const postCycleFrames = [];
        for (let index = 0; index < 10; index += 1) {
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
          postCycleFrames.push(await page.evaluate(() => {
            const session = window.__kakiRally.state.racing;
            const manager = session.cameraManager;
            const camera = manager.activeCamera;
            const vehicle = manager._vehicleState();
            const player = vehicle.position.clone().project(camera);
            return {
              altitude: vehicle.position.y - vehicle.groundHeight,
              cameraY: camera.position.y,
              focusY: manager.lastFrame.focus.y,
              forwardY: camera.getWorldDirection(camera.position.clone()).y,
              playerNdc: player.toArray(),
              mode: manager.mode,
              projection: camera.isOrthographicCamera ? 'orthographic' : 'perspective',
              transitioning: !!manager.transition,
              guardRecoveries: manager.rigs.isometric.guardRecoveries,
            };
          }));
        }
        const invalidPostCycleFrame = postCycleFrames.find((frame) => (
          frame.mode !== 'isometric'
          || frame.projection !== 'orthographic'
          || frame.transitioning
          || !(frame.cameraY > frame.focusY + 8)
          || !(frame.forwardY < -0.15)
          || Math.abs(frame.playerNdc[0]) >= 0.92
          || Math.abs(frame.playerNdc[1]) >= 0.92
          || frame.playerNdc[2] < -1
          || frame.playerNdc[2] > 1
        ));
        assert(
          Math.max(...postCycleFrames.map((frame) => frame.altitude)) > 18,
          'Dune WebGPU post-cycle ISO fixture did not produce a large jump',
        );
        assert(
          !invalidPostCycleFrame,
          `Dune WebGPU ISO re-entry lost its terrain-facing frame: ${JSON.stringify(invalidPostCycleFrame)}`,
        );
        diagnosticsNow.postCycleIsoRecovery = {
          maximumAltitude: Math.max(...postCycleFrames.map((frame) => frame.altitude)),
          apex: postCycleFrames.reduce((best, frame) => (
            frame.altitude > best.altitude ? frame : best
          ), postCycleFrames[0]),
          sampledFrames: postCycleFrames.length,
        };
        await page.screenshot({
          path: path.join(QA_DIR, 'webgpu-dunes-camera-cycle-isometric.png'),
        });
      }
      report.webgpu.modes[mode] = diagnosticsNow;
      await page.evaluate(() => window.__kakiRally.menu());
    }

    if (requestedScope === 'all' || requestedScope === 'draw') {
      await page.evaluate(() => window.__kakiRally.openDraw());
      await page.waitForSelector('.kdt-editor');
      await drawCircle(page, 'mouse');
      await page.evaluate(() => {
        window.__kdtEditor.setSize('mega');
        window.__kdtEditor.recalculate();
      });
      assert(await addWorkshopCircuitStamp(page), 'WebGPU Draw Workshop could not place a ramp');
      await page.evaluate(() => {
        window.__kdtEditor.build();
        window.__kdtEditor.finishBuild();
      });
      await page.waitForFunction(() => window.__kakiRally.getDiagnostics().activeMode === 'draw', null, { timeout: 120_000 });
      await assertRallyGrass(page, 'draw');
      await page.waitForFunction(() => (
        window.__kkRacing?.snapshot?.()?.workshop?.features?.built >= 1
      ), null, { timeout: 120_000 });
      await skipCountdown(page);
      const drawDiagnostics = await page.evaluate(() => window.__kakiRally.getDiagnostics());
      assert.equal(drawDiagnostics.backend, 'webgpu');
      assert(drawDiagnostics.renderer.drawCalls > 0, 'Draw Track WebGPU made no submissions');
      report.webgpu.modes.draw = drawDiagnostics;
      await page.evaluate(() => window.__kakiRally.menu());
    }

    if (requestedScope === 'all' || requestedScope === 'trials') {
      report.webgpu.modes.trialsWorkshop = {};
      await runTrialsWorkshop(
        page,
        'webgpu',
        report.webgpu.modes.trialsWorkshop,
        { verifyRestart: false },
      );
    }

    const crashAvailability = await page.evaluate(async () => {
      const api = await import('./src/racing/racingModeAvailability.js');
      const availability = api.getRacingModeAvailability('crash', { backend: 'webgpu' });
      const launched = await window.__kakiRally.start('crash', 'forest', { crashQuality: 'low' });
      return {
        availability,
        launched: !!launched,
        activeMode: window.__kakiRally.getDiagnostics().activeMode,
        cardText: document.querySelector('.rally-mode-rail button[data-mode="crash"]')?.textContent || '',
      };
    });
    assert(!crashAvailability.availability.canLaunch);
    assert.equal(crashAvailability.availability.reason, 'out-of-production-scope');
    assert(!crashAvailability.launched && crashAvailability.activeMode === null, 'Catastrophe launched on WebGPU');
    assert.equal(crashAvailability.cardText, '', 'Catastrophe appeared in the production WebGPU menu');
    report.webgpu.modes.crash = crashAvailability;
    await page.screenshot({ path: path.join(QA_DIR, 'webgpu-menu.png') });
  } finally {
    await context.close();
  }
}

function emptyDiagnostics() {
  return {
    pageErrors: [],
    consoleErrors: [],
    badResponses: [],
    failedRequests: [],
    expectedAborts: [],
    expectedAudioDeviceErrors: [],
    frozenModeRequests: [],
  };
}

const report = {
  schema: 1,
  sourceCommit: 'fc84c36518651c8d80fc708f7398db2536046fd4',
  generatedAt: new Date().toISOString(),
  chromium: CHROMIUM,
  requestedBackend,
  webgl: {
    diagnostics: emptyDiagnostics(),
    modes: {
      circuit: {}, drift: {}, stock: {}, draw: {}, monster: {}, dunes: {}, trials: {}, crash: {},
    },
  },
  webgpu: {
    diagnostics: emptyDiagnostics(),
    modes: {},
  },
};

await mkdir(QA_DIR, { recursive: true });
const server = createServer();
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;

let webglBrowser;
let webgpuBrowser;
try {
  if (requestedBackend === 'all' || requestedBackend === 'webgl') {
    webglBrowser = await chromium.launch({ headless: true, executablePath: CHROMIUM, args: WEBGL_ARGS });
    await runWebGl(webglBrowser, origin, report);
  }
  if (requestedBackend === 'all' || requestedBackend === 'webgpu') {
    webgpuBrowser = await chromium.launch({ headless: true, executablePath: CHROMIUM, args: WEBGPU_ARGS });
    await runWebGpu(webgpuBrowser, origin, report);
  }
} finally {
  await webglBrowser?.close();
  await webgpuBrowser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(QA_DIR, 'browser-matrix.json'), `${JSON.stringify(report, null, 2)}\n`);
}

for (const [backend, section] of Object.entries({ webgl: report.webgl, webgpu: report.webgpu })) {
  if (requestedBackend !== 'all' && requestedBackend !== backend) continue;
  for (const key of ['pageErrors', 'consoleErrors', 'badResponses', 'failedRequests', 'frozenModeRequests']) {
    assert.deepEqual(section.diagnostics[key], [], `${backend} ${key}: ${section.diagnostics[key].join(' | ')}`);
  }
}

const covered = [];
if (requestedBackend === 'all' || requestedBackend === 'webgl') {
  covered.push(`WebGL seven-mode lifecycle/touch/gamepad${catastropheRequested ? ' plus optional Catastrophe' : ''}`);
}
if (requestedBackend === 'all' || requestedBackend === 'webgpu') covered.push('WebGPU production-mode smoke and frozen-mode gate');
console.log(`Kaki Rally browser matrix passed: ${covered.join('; ')}`);
