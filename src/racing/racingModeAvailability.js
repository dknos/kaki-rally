const AVAILABLE = Object.freeze({
  status: 'available',
  canLaunch: true,
  label: 'READY',
  detail: '',
});

function normalizedBackend(value) {
  const backend = String(value || '').toLowerCase();
  return backend === 'webgpu' ? 'webgpu' : 'webgl';
}

export function getRacingModeAvailability(mode, {
  backend = 'webgl',
  development = false,
} = {}) {
  if (String(mode || '') !== 'crash') return AVAILABLE;
  if (!development) {
    return Object.freeze({
      status: 'frozen',
      canLaunch: false,
      reason: 'out-of-production-scope',
      label: 'FROZEN',
      detail: 'Kaki Catastrophe is preserved outside the production menu.',
    });
  }
  if (normalizedBackend(backend) === 'webgpu') {
    return Object.freeze({
      status: 'renderer-required',
      canLaunch: false,
      reason: 'webgl-required',
      label: 'DEV · WEBGL',
      detail: 'The frozen Catastrophe development route requires WebGL 2.',
      action: 'restart-webgl',
    });
  }
  return Object.freeze({
    status: 'development',
    canLaunch: true,
    reason: 'localhost-development-flag',
    label: 'DEV ONLY',
    detail: 'Frozen experiment enabled explicitly for this localhost session.',
  });
}

export function canLaunchRacingMode(mode, options = {}) {
  return getRacingModeAvailability(mode, options).canLaunch === true;
}
