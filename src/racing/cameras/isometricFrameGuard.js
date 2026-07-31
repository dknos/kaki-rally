function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function sanitizeIsometricCameraFx(rawFx) {
  const source = rawFx && typeof rawFx === 'object' && !Array.isArray(rawFx)
    ? rawFx
    : {};
  return {
    shake: Math.max(0, finite(source.shake)),
    roll: finite(source.roll),
    punch: Math.max(0, finite(source.punch)),
    phase: finite(source.phase),
  };
}

function finiteVector(value) {
  return Number.isFinite(Number(value?.x))
    && Number.isFinite(Number(value?.y))
    && Number.isFinite(Number(value?.z));
}

function setVector(value, x, y, z) {
  if (typeof value?.set === 'function') value.set(x, y, z);
  else if (value) {
    value.x = x;
    value.y = y;
    value.z = z;
  }
}

export function guardIsometricTerrainFrame(position, focus, vehicle = {}) {
  const vehiclePosition = vehicle?.position || {};
  if (!finiteVector(position) || !finiteVector(focus)) {
    const x = finite(vehiclePosition.x);
    const y = finite(vehiclePosition.y);
    const z = finite(vehiclePosition.z);
    const safeClearance = vehicle.trials ? 0.6 : vehicle.monster ? 12 : 9;
    setVector(focus, x, y + (vehicle.trials ? 0.4 : 0.8), z);
    setVector(position, x + safeClearance, y + safeClearance * 1.8, z + safeClearance);
    return true;
  }
  const horizontalDistance = Math.hypot(
    Number(position?.x) - Number(focus?.x),
    Number(position?.z) - Number(focus?.z),
  );
  const minimumClearance = vehicle.trials ? 0.6 : vehicle.monster ? 12 : 9;
  const minimumDownSlope = vehicle.trials ? 0.015 : 0.22;
  const requiredClearance = Math.max(minimumClearance, horizontalDistance * minimumDownSlope);
  const verticalClearance = Number(position?.y) - Number(focus?.y);
  const guarded = Number.isFinite(requiredClearance)
    && Number.isFinite(verticalClearance)
    && verticalClearance < requiredClearance;
  if (guarded) position.y = Number(focus.y) + requiredClearance;
  return guarded;
}
