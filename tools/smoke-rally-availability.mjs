import assert from 'node:assert/strict';

import {
  canLaunchRacingMode,
  getRacingModeAvailability,
} from '../src/racing/racingModeAvailability.js';
import {
  normalizeRouteMode,
  readRallyRoute,
  routeUrl,
} from '../src/app/rallyRouter.js';

const productionModes = ['circuit', 'drift', 'stock', 'draw', 'monster', 'trials'];
for (const backend of ['webgl', 'webgpu']) {
  for (const mode of productionModes) {
    const availability = getRacingModeAvailability(mode, { backend });
    assert.equal(availability.status, 'available', `${mode}/${backend} is not normally available`);
    assert.equal(availability.canLaunch, true, `${mode}/${backend} cannot launch`);
    assert.equal(canLaunchRacingMode(mode, { backend }), true);
  }
}

const frozenCrash = getRacingModeAvailability('crash', { backend: 'webgl' });
assert.equal(frozenCrash.status, 'frozen');
assert.equal(frozenCrash.canLaunch, false);
assert.equal(frozenCrash.reason, 'out-of-production-scope');

const crashWebGpu = getRacingModeAvailability('crash', {
  backend: 'webgpu',
  development: true,
});
assert.equal(crashWebGpu.status, 'renderer-required');
assert.equal(crashWebGpu.canLaunch, false);
assert.equal(crashWebGpu.action, 'restart-webgl');
assert.match(crashWebGpu.detail, /requires WebGL 2/i);

const development = getRacingModeAvailability('crash', {
  backend: 'webgl',
  development: true,
});
assert.equal(development.status, 'development');
assert.equal(development.canLaunch, true);
assert.equal(development.reason, 'localhost-development-flag');

for (const [alias, expected] of Object.entries({
  race: 'circuit',
  gp: 'circuit',
  drift: 'drift',
  stock: 'stock',
  draw: 'draw',
  monster: 'monster',
  trials: 'trials',
  catastrophe: 'crash',
})) {
  assert.equal(normalizeRouteMode(alias), expected);
}

const blockedRemote = readRallyRoute('https://dknos.github.io/kaki-rally/?mode=crash&dev=catastrophe&play=1');
assert.equal(blockedRemote.mode, null);
assert.equal(blockedRemote.catastropheDevelopment, false);

const localDevelopment = readRallyRoute('http://127.0.0.1:4173/?mode=crash&dev=catastrophe&play=1');
assert.equal(localDevelopment.mode, 'crash');
assert.equal(localDevelopment.catastropheDevelopment, true);
assert.equal(localDevelopment.autoStart, true);

const retained = routeUrl('https://dknos.github.io/kaki-rally/?mode=monster&play=1&qa=1#grid', {
  renderer: 'webgl',
  autoStart: false,
});
assert.equal(retained.searchParams.get('mode'), 'monster');
assert.equal(retained.searchParams.get('renderer'), 'webgl');
assert.equal(retained.searchParams.has('play'), false);
assert.equal(retained.searchParams.get('qa'), '1');
assert.equal(retained.hash, '#grid');

const localDevUrl = routeUrl('http://localhost:8080/', {
  mode: 'crash',
  catastropheDevelopment: true,
});
assert.equal(localDevUrl.searchParams.get('dev'), 'catastrophe');

const route = readRallyRoute('https://dknos.github.io/kaki-rally/?mode=monster&renderer=webgpu&play=1');
assert.equal(route.mode, 'monster');
assert.equal(route.renderer, 'webgpu');
assert.equal(route.autoStart, true);

console.log('Kaki Rally renderer and mode availability matrix passed');
