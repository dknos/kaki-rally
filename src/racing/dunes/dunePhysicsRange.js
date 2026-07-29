/**
 * Developer-only, deterministic validation range. Production navigation never
 * exposes it; tests and `?qa=dune-physics-range` use the same station data.
 */
export const DUNE_PHYSICS_RANGE = Object.freeze({
  id: 'dune-physics-range',
  name: 'Dune Truck Physics Range',
  seed: 0x50485953,
  worldSize: 640,
  routeWidth: 18,
  stations: Object.freeze([
    Object.freeze({ id: 'acceleration', kind: 'flat-strip', x: 0, z: -260, length: 110 }),
    Object.freeze({ id: 'braking', kind: 'braking-markers', x: 0, z: -135, length: 65 }),
    Object.freeze({ id: 'slalom-left', kind: 'slalom', x: -34, z: -45, direction: -1 }),
    Object.freeze({ id: 'slalom-right', kind: 'slalom', x: 34, z: -45, direction: 1 }),
    Object.freeze({ id: 'reverse', kind: 'reverse-pad', x: 0, z: 18, length: 34 }),
    Object.freeze({ id: 'curb', kind: 'curb', x: -70, z: 62, height: 0.22 }),
    Object.freeze({ id: 'medium-obstacle', kind: 'obstacle', x: -34, z: 62, height: 0.82 }),
    Object.freeze({ id: 'crush-car', kind: 'crushable', x: 2, z: 62 }),
    Object.freeze({ id: 'whoops', kind: 'whoops', x: 60, z: 62, count: 8, height: 0.7 }),
    Object.freeze({ id: 'slope-15', kind: 'slope', x: -104, z: 142, degrees: 15 }),
    Object.freeze({ id: 'slope-25', kind: 'slope', x: -50, z: 142, degrees: 25 }),
    Object.freeze({ id: 'slope-35', kind: 'slope', x: 8, z: 142, degrees: 35 }),
    Object.freeze({ id: 'side-slope', kind: 'side-slope', x: 70, z: 142, degrees: 22 }),
    Object.freeze({ id: 'small-jump', kind: 'jump', x: -72, z: 228, height: 2.4 }),
    Object.freeze({ id: 'large-jump', kind: 'jump', x: -15, z: 228, height: 5.8 }),
    Object.freeze({ id: 'flat-drop', kind: 'drop', x: 42, z: 228, height: 4.5 }),
    Object.freeze({ id: 'off-axis', kind: 'off-axis-landing', x: 91, z: 228, roll: 0.22 }),
    Object.freeze({ id: 'soft-sand', kind: 'surface', x: -52, z: 282, surface: 'loose-sand' }),
    Object.freeze({ id: 'packed-sand', kind: 'surface', x: 52, z: 282, surface: 'packed-sand' }),
  ]),
});

export function physicsRangeHeightAt(x, z) {
  if (z > 118 && z < 184) {
    if (x > -126 && x < -82) return Math.max(0, (z - 118) * Math.tan(15 * Math.PI / 180));
    if (x > -72 && x < -28) return Math.max(0, (z - 118) * Math.tan(25 * Math.PI / 180));
    if (x > -16 && x < 28) return Math.max(0, (z - 118) * Math.tan(35 * Math.PI / 180));
    if (x > 48 && x < 94) return Math.max(0, (x - 48) * Math.tan(22 * Math.PI / 180));
  }
  if (z > 42 && z < 86 && x > 42 && x < 82) {
    return Math.sin((z - 42) * Math.PI / 11) * 0.7;
  }
  return 0;
}
