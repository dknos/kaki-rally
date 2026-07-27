import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normalizeBackendPreference,
  readBackendPreference,
  rendererPreferenceReloadUrl,
} from '../rendererSettings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('stable automatic profiles resolve to WebGL while explicit choices win', () => {
  assert.equal(readBackendPreference('', 'auto'), 'webgl');
  assert.equal(readBackendPreference('', 'webgpu'), 'webgpu');
  assert.equal(readBackendPreference('?renderer=webgpu', 'webgl'), 'webgpu');
  assert.equal(readBackendPreference('?renderer=webgl', 'webgpu'), 'webgl');
  assert.equal(readBackendPreference('?renderer=invalid', 'webgl'), 'auto');
  assert.equal(normalizeBackendPreference(' WEBGL '), 'webgl');
});

test('reload URL removes only a temporary renderer override', () => {
  const url = new URL(rendererPreferenceReloadUrl(
    'https://dknos.github.io/kaki-rally/?mode=monster&renderer=webgpu&qa=1#run',
  ));
  assert.equal(url.searchParams.get('mode'), 'monster');
  assert.equal(url.searchParams.get('qa'), '1');
  assert.equal(url.searchParams.has('renderer'), false);
  assert.equal(url.hash, '#run');
});

test('standalone boot wires preference, fallback, recovery, DPR, and actionable failure UI', () => {
  const app = read('src/app/rallyApp.js');
  const menu = read('src/app/rallyMenu.js');
  const html = read('index.html');
  assert.match(app, /readBackendPreference\(location\.search, this\.settings\.renderer\)/);
  assert.match(app, /createRenderer\(RENDERER_BACKENDS\.WEBGL\)/);
  assert.match(app, /autoRecover:\s*true/);
  assert.match(app, /dknos|SOURCE_COMMIT/);
  assert.match(app, /rendererService\.resize\(this\.width, this\.height\)/);
  assert.match(app, /RALLY_DISPLAY\.desktopAspect/);
  assert.match(app, /RESTART IN WEBGL/);
  assert.match(menu, /Auto · stable WebGL default/);
  assert.match(html, /<canvas id="game-canvas"/);
  assert.match(html, /three\.webgpu\.js/);
});
