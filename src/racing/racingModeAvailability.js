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
  raidDevelopment = false,
} = {}) {
  // Kaki Rally Raid is a new discipline still behind its own development flag.
  // It needs an explicit branch because the default below reports every unknown
  // mode id as publicly available, which would expose it from the menu the
  // moment a route pointed at it. It runs on both renderer backends.
  if (String(mode || '') === 'raid') {
    if (!raidDevelopment) {
      return Object.freeze({
        status: 'development',
        canLaunch: false,
        reason: 'raid-development-flag',
        label: 'IN DEVELOPMENT',
        detail: 'Kaki Rally Raid is not finished; open it with the local development route.',
      });
    }
    return Object.freeze({
      status: 'development',
      canLaunch: true,
      reason: 'localhost-development-flag',
      label: 'DEV ONLY',
      detail: 'Desert Expedition enabled explicitly for this localhost session.',
    });
  }
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
