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

const crashWebGl = getRacingModeAvailability('crash', { backend: 'webgl' });
assert.equal(crashWebGl.status, 'beta');
assert.equal(crashWebGl.canLaunch, true);
assert.equal(crashWebGl.reason, 'validated-webgl-beta');

const crashWebGpu = getRacingModeAvailability('crash', { backend: 'webgpu' });
assert.equal(crashWebGpu.status, 'renderer-required');
assert.equal(crashWebGpu.canLaunch, false);
assert.equal(crashWebGpu.action, 'restart-webgl');
assert.match(crashWebGpu.detail, /requires WebGL 2/i);

const gated = getRacingModeAvailability('crash', {
  backend: 'webgl',
  catastropheValidated: false,
});
assert.equal(gated.status, 'gated');
assert.equal(gated.canLaunch, false);
assert.equal(gated.action, 'experimental-query');

const experimental = getRacingModeAvailability('crash', {
  backend: 'webgl',
  catastropheValidated: false,
  experimental: true,
});
assert.equal(experimental.status, 'experimental');
assert.equal(experimental.canLaunch, true);

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

const retained = routeUrl('https://dknos.github.io/kaki-rally/?mode=crash&play=1&qa=1#grid', {
  renderer: 'webgl',
  autoStart: false,
});
assert.equal(retained.searchParams.get('mode'), 'crash');
assert.equal(retained.searchParams.get('renderer'), 'webgl');
assert.equal(retained.searchParams.has('play'), false);
assert.equal(retained.searchParams.get('qa'), '1');
assert.equal(retained.hash, '#grid');

const route = readRallyRoute('https://dknos.github.io/kaki-rally/?mode=monster&renderer=webgpu&play=1');
assert.equal(route.mode, 'monster');
assert.equal(route.renderer, 'webgpu');
assert.equal(route.autoStart, true);

console.log('Kaki Rally renderer and mode availability matrix passed');
