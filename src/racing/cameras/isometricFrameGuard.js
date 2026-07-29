export function guardIsometricTerrainFrame(position, focus, vehicle = {}) {
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
