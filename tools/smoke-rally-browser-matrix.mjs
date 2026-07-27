#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA_DIR = path.join(ROOT, 'docs', 'qa');
const requestedBackend = process.argv.includes('--backend')
  ? process.argv[process.argv.indexOf('--backend') + 1]
  : 'all';
assert(['all', 'webgl', 'webgpu'].includes(requestedBackend), `Unknown backend: ${requestedBackend}`);
const requestedScope = process.argv.includes('--scope')
  ? process.argv[process.argv.indexOf('--scope') + 1]
  : 'all';

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
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/menu_glitch\.mp3.*ERR_ABORTED/i.test(text)) {
      diagnostics.expectedAborts.push(text);
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
  await page.goto(`${origin}/index.html?qa=1&renderer=${backend}`, {
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
  return { context, page, boot };
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
      return snapshot?.worldReady && snapshot?.assetsReady && !snapshot?.assetError;
    }, null, { timeout: 120_000 });
  } else {
    await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  }
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
  const opening = await startMode(page, spec.mode, spec.courseId, spec.options);
  await skipCountdown(page);
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
  if (spec.mode === 'stock') assert(snapshot.integrity <= 24, 'Stock Cup damage/smoke state did not trigger');
  if (spec.mode === 'circuit') assert(snapshot.raceTime > 0, 'Off-Road GP fixed-step race clock did not advance');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-${spec.mode}.png`) });
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
  evidence.opening = await startMode(page, spec.mode, spec.courseId, spec.options);
  await skipCountdown(page);
  await exerciseKeyboard(page);
  await exerciseTouch(page, 'monster');
  evidence.gamepad = await exerciseGamepad(page);
  const central = await page.evaluate(() => ({
    target: window.__kkRacing.warpToMonsterTarget(0),
    collapsed: window.__kkRacing.collapseMonsterStructure(),
    jump: window.__kkRacing.showMonsterJump(),
    chaos: window.__kkRacing.fillChaos(),
  }));
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

async function runDraw(page, backend, evidence) {
  await page.evaluate(() => window.__kakiRally.openDraw());
  await page.waitForSelector('.kdt-editor');
  await drawCircle(page, 'mouse');
  await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.setSize('epic');
    editor.setWidth('extra-wide');
    editor.draft.modifiers.randomJumps = true;
    editor.draft.modifiers.nightRace = true;
    editor.recalculate();
    editor.save();
  });
  const compatibility = await page.evaluate(async () => {
    const { TrackCodeCodec } = await import('./src/racing/drawTrackStorage.js');
    const editor = window.__kdtEditor;
    const draft = editor.currentDraft();
    const kdt1 = TrackCodeCodec.encodeLegacy({
      ...draft,
      sizeId: 'club',
      widthId: 'standard',
      layoutTransform: undefined,
    });
    const kdt2 = TrackCodeCodec.encode(draft);
    const legacy = TrackCodeCodec.decode(kdt1);
    const current = TrackCodeCodec.decode(kdt2);
    editor.openCode(false);
    const dialog = document.querySelector('.kdt-code-dialog');
    dialog.querySelector('textarea').value = kdt1;
    await editor.codeAction('load');
    const legacyValid = editor.validation.valid;
    const legacyLoaded = editor.closed && editor.draft.rawStroke.length >= 6;
    editor.openCode(false);
    dialog.querySelector('textarea').value = kdt2;
    await editor.codeAction('load');
    editor.draft.reverse = !editor.draft.reverse;
    editor.recalculate();
    editor.save();
    return {
      kdt1Prefix: kdt1.slice(0, 5),
      kdt2Prefix: kdt2.slice(0, 5),
      legacyValid,
      legacyLoaded,
      currentValid: editor.validation.valid,
      legacyPoints: legacy.controlPoints.length,
      currentPoints: current.controlPoints.length,
      reverse: editor.draft.reverse,
    };
  });
  assert.deepEqual(
    [compatibility.kdt1Prefix, compatibility.kdt2Prefix],
    ['KDT1-', 'KDT2-'],
    'Draw Track codes lost compatibility prefixes',
  );
  evidence.compatibility = compatibility;
  assert(
    compatibility.legacyLoaded && compatibility.currentValid,
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
  await page.evaluate(() => {
    const editor = window.__kdtEditor;
    editor.build();
    editor.finishBuild();
  });
  await page.waitForFunction(() => window.__kakiRally.getDiagnostics().activeMode === 'draw', null, {
    timeout: 120_000,
  });
  await page.evaluate(() => window.__kakiRally.state.racing?.assetLease?.ready);
  await skipCountdown(page);
  const raced = await exerciseKeyboard(page);
  await exerciseTouch(page, 'draw');
  const gamepad = await exerciseGamepad(page);
  const race = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert.equal(race.raceMode, 'draw');
  assert(race.customTrackId && race.overpasses >= 0 && race.checkpoints > 0, 'Generated Draw Track race is incomplete');
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

async function finishTrialsCourse(page, trackId, evidence) {
  await startMode(page, 'trials', 'forest', {
    trialsTrackId: trackId,
    trialsVehicle: trackId === 'quarry' ? 'buggy' : 'monster',
  });
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

async function runTrials(page, backend, evidence) {
  await finishTrialsCourse(page, 'meadow', evidence);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('kks_rally_trials_v1') || '{}'));
  assert(progress.unlocked?.includes('quarry'), 'B-medal progression did not unlock Quarry');
  assert(progress.records?.meadow?.ghost?.length >= 2, 'PB ghost was not persisted');
  assert(progress.records.meadow.ghost.length <= 1_800, 'PB ghost exceeded the sample cap');
  await finishTrialsCourse(page, 'quarry', evidence);
  await finishTrialsCourse(page, 'crown', evidence);

  await startMode(page, 'trials', 'forest', { trialsTrackId: 'meadow', trialsVehicle: 'monster' });
  await skipCountdown(page);
  const ghost = await page.evaluate(() => window.__kakiRally.getSnapshot());
  assert(ghost.pbGhostSampleCount >= 2, 'saved Trials ghost did not replay on re-entry');
  await page.screenshot({ path: path.join(QA_DIR, `${backend}-trials.png`) });
  evidence.ghostReplay = ghost;
  const spec = { mode: 'trials', courseId: 'forest', options: { trialsTrackId: 'meadow', trialsVehicle: 'monster' } };
  await assertPauseRestartExitReentry(page, spec, evidence);
}

async function runCrash(page, backend, evidence) {
  const spec = {
    mode: 'crash',
    courseId: 'forest',
    options: { crashVehicle: 'iron', crashQuality: 'medium' },
  };
  evidence.opening = await startMode(page, spec.mode, spec.courseId, spec.options);
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
  const { context, page, boot } = await bootPage(browser, origin, 'webgl', diagnostics);
  report.webgl.boot = boot;
  try {
    assert(await page.locator('[data-mode="circuit"]').count(), 'Off-Road GP menu control is missing');
    assert(await page.locator('[data-mode="crash"]').count(), 'Catastrophe menu control is missing');
    if (requestedScope === 'all' || requestedScope === 'circuit') await runRoadMode(page, {
      mode: 'circuit',
      courseId: 'forest',
      options: { carCount: 6 },
      mechanic: 'jump',
    }, 'webgl', report.webgl.modes.circuit);
    if (requestedScope === 'all' || requestedScope === 'drift') await runRoadMode(page, {
      mode: 'drift',
      courseId: 'twilight',
      options: { carCount: 6 },
      mechanic: 'drift',
    }, 'webgl', report.webgl.modes.drift);
    if (requestedScope === 'all' || requestedScope === 'stock') await runRoadMode(page, {
      mode: 'stock',
      courseId: 'cinder',
      options: { carCount: 16 },
      mechanic: 'damage',
    }, 'webgl', report.webgl.modes.stock);
    if (requestedScope === 'all' || requestedScope === 'draw') await runDraw(page, 'webgl', report.webgl.modes.draw);
    if (requestedScope === 'all' || requestedScope === 'monster') await runMonster(page, 'webgl', report.webgl.modes.monster);
    if (requestedScope === 'all' || requestedScope === 'trials') await runTrials(page, 'webgl', report.webgl.modes.trials);
    if (requestedScope === 'all' || requestedScope === 'crash') await runCrash(page, 'webgl', report.webgl.modes.crash);

    if (requestedScope === 'all') {
      const persistenceBefore = await page.evaluate(() => ({
      draw: localStorage.getItem('kks_draw_tracks_v1'),
      trials: localStorage.getItem('kks_rally_trials_v1'),
      crash: localStorage.getItem('kks_kaki_catastrophe_records_v1'),
      }));
      assert(persistenceBefore.draw && persistenceBefore.trials && persistenceBefore.crash, 'legacy save keys were not populated');
      await page.reload({ waitUntil: 'load', timeout: 120_000 });
      await page.waitForFunction(() => !!window.__kakiRally);
      const persistenceAfter = await page.evaluate(() => ({
        draw: localStorage.getItem('kks_draw_tracks_v1'),
        trials: localStorage.getItem('kks_rally_trials_v1'),
        crash: localStorage.getItem('kks_kaki_catastrophe_records_v1'),
      }));
      assert.deepEqual(persistenceAfter, persistenceBefore, 'records changed across reload');
      report.webgl.persistence = {
        drawBytes: persistenceAfter.draw.length,
        trialsBytes: persistenceAfter.trials.length,
        crashBytes: persistenceAfter.crash.length,
      };
    }

    await page.setViewportSize({ width: 1720, height: 720 });
    await page.waitForTimeout(160);
    report.webgl.ultrawide = await page.evaluate(() => {
      const stage = document.querySelector('#kk-stage').getBoundingClientRect();
      return { viewport: [innerWidth, innerHeight], stage: [stage.width, stage.height], left: stage.left, right: innerWidth - stage.right };
    });
    assert(Math.abs(report.webgl.ultrawide.left - report.webgl.ultrawide.right) < 2, 'ultrawide letterboxing is not centered');
    assert(Math.abs(report.webgl.ultrawide.stage[0] / report.webgl.ultrawide.stage[1] - 16 / 9) < 0.02, 'desktop stage lost 16:9');

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(160);
    report.webgl.landscapePhone = await page.evaluate(() => ({
      orientationGate: !document.querySelector('#rally-orientation-gate').hidden,
      overflowX: document.documentElement.scrollWidth - innerWidth,
      stage: document.querySelector('#kk-stage').getBoundingClientRect().toJSON(),
    }));
    assert(!report.webgl.landscapePhone.orientationGate, 'landscape phone incorrectly shows the rotate prompt');
    assert(report.webgl.landscapePhone.overflowX <= 2, 'landscape phone has horizontal overflow');
  } finally {
    await context.close();
  }
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
      ['trials', 'forest', { trialsTrackId: 'meadow', trialsVehicle: 'monster' }],
    ];
    for (const [mode, courseId, options] of specs) {
      await startMode(page, mode, courseId, options);
      await skipCountdown(page);
      if (mode !== 'trials') await page.evaluate((activeMode) => (
        window.__kkRacing.showState?.(activeMode === 'drift' ? 'drift' : 'boost')
        || window.__kkRacing.showMonsterJump?.()
      ), mode);
      else await page.evaluate(() => window.__kkRacing.warpCheckpoint(0));
      await page.waitForTimeout(220);
      const diagnosticsNow = await page.evaluate(() => window.__kakiRally.getDiagnostics());
      assert.equal(diagnosticsNow.backend, 'webgpu');
      assert(diagnosticsNow.renderer.drawCalls > 0, `${mode} WebGPU made no submissions`);
      report.webgpu.modes[mode] = diagnosticsNow;
      await page.evaluate(() => window.__kakiRally.menu());
    }

    await page.evaluate(() => window.__kakiRally.openDraw());
    await page.waitForSelector('.kdt-editor');
    await drawCircle(page, 'mouse');
    await page.evaluate(() => {
      window.__kdtEditor.build();
      window.__kdtEditor.finishBuild();
    });
    await page.waitForFunction(() => window.__kakiRally.getDiagnostics().activeMode === 'draw', null, { timeout: 120_000 });
    await skipCountdown(page);
    const drawDiagnostics = await page.evaluate(() => window.__kakiRally.getDiagnostics());
    assert.equal(drawDiagnostics.backend, 'webgpu');
    assert(drawDiagnostics.renderer.drawCalls > 0, 'Draw Track WebGPU made no submissions');
    report.webgpu.modes.draw = drawDiagnostics;
    await page.evaluate(() => window.__kakiRally.menu());

    const crashAvailability = await page.evaluate(async () => {
      const api = await import('./src/racing/racingModeAvailability.js');
      const availability = api.getRacingModeAvailability('crash', { backend: 'webgpu' });
      const launched = await window.__kakiRally.start('crash', 'forest', { crashQuality: 'low' });
      return {
        availability,
        launched: !!launched,
        activeMode: window.__kakiRally.getDiagnostics().activeMode,
        cardText: document.querySelector('[data-mode="crash"]')?.textContent || '',
      };
    });
    assert(!crashAvailability.availability.canLaunch && crashAvailability.availability.action === 'restart-webgl');
    assert(!crashAvailability.launched && crashAvailability.activeMode === null, 'Catastrophe launched on WebGPU');
    assert(/WEBGL/i.test(crashAvailability.cardText), 'Catastrophe WebGPU card does not explain its requirement');
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
  };
}

const report = {
  schema: 1,
  sourceCommit: '3711e8fc0c2c86b27911171c5394723ceb9e45aa',
  generatedAt: new Date().toISOString(),
  chromium: CHROMIUM,
  requestedBackend,
  webgl: {
    diagnostics: emptyDiagnostics(),
    modes: {
      circuit: {}, drift: {}, stock: {}, draw: {}, monster: {}, trials: {}, crash: {},
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
  for (const key of ['pageErrors', 'consoleErrors', 'badResponses', 'failedRequests']) {
    assert.deepEqual(section.diagnostics[key], [], `${backend} ${key}: ${section.diagnostics[key].join(' | ')}`);
  }
}

const covered = [];
if (requestedBackend === 'all' || requestedBackend === 'webgl') covered.push('WebGL seven-mode lifecycle/touch/gamepad');
if (requestedBackend === 'all' || requestedBackend === 'webgpu') covered.push('WebGPU normal-mode smoke and crash gate');
console.log(`Kaki Rally browser matrix passed: ${covered.join('; ')}`);
