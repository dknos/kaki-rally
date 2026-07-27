export const CATASTROPHE_WEBGL_BETA_VALIDATED = true;

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
  experimental = false,
  catastropheValidated = CATASTROPHE_WEBGL_BETA_VALIDATED,
} = {}) {
  if (String(mode || '') !== 'crash') return AVAILABLE;
  if (normalizedBackend(backend) === 'webgpu') {
    return Object.freeze({
      status: 'renderer-required',
      canLaunch: false,
      reason: 'webgl-required',
      label: 'WEBGL BETA',
      detail: 'Kaki Catastrophe Beta currently requires WebGL 2.',
      action: 'restart-webgl',
    });
  }
  if (catastropheValidated) {
    return Object.freeze({
      status: 'beta',
      canLaunch: true,
      reason: 'validated-webgl-beta',
      label: 'WEBGL BETA',
      detail: 'Validated for WebGL 2. WebGPU remains experimental.',
    });
  }
  if (experimental) {
    return Object.freeze({
      status: 'experimental',
      canLaunch: true,
      reason: 'experimental-query',
      label: 'EXPERIMENTAL',
      detail: 'Enabled by ?experimental=crash while the WebGL beta gate is under review.',
    });
  }
  return Object.freeze({
    status: 'gated',
    canLaunch: false,
    reason: 'browser-validation-blocked',
    label: 'PRESERVED',
    detail: 'Source, tests, and assets are preserved. Launch with ?experimental=crash.',
    action: 'experimental-query',
  });
}

export function canLaunchRacingMode(mode, options = {}) {
  return getRacingModeAvailability(mode, options).canLaunch === true;
}
