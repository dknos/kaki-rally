// Kaki Rally Raid — HUD.
//
// Raid-owned DOM under its own `kkr-` namespace, mounted into the shell's
// existing UI root and removed completely on exit. It reuses no Dune selector,
// so a change here cannot restyle another mode and a change there cannot
// silently restyle this one.
//
// Scope: distance, speed, heading and surface. The roadbook, tripmaster, CAP
// target and penalties are not built.

const FIELDS = Object.freeze([
  { key: 'distance', label: 'STAGE' },
  { key: 'remaining', label: 'TO GO' },
  { key: 'speed', label: 'SPEED' },
  { key: 'heading', label: 'CAP' },
  { key: 'surface', label: 'SURFACE' },
]);

export function createRaidHud(host = null) {
  const mount = host || document.getElementById('ui-root') || document.body;
  const root = document.createElement('div');
  root.className = 'kkr-hud';
  root.dataset.kkrHud = 'true';

  const stage = document.createElement('div');
  stage.className = 'kkr-hud-stage';
  root.appendChild(stage);

  const readouts = document.createElement('div');
  readouts.className = 'kkr-hud-readouts';
  root.appendChild(readouts);

  const values = {};
  for (const field of FIELDS) {
    const cell = document.createElement('div');
    cell.className = 'kkr-hud-cell';
    const label = document.createElement('span');
    label.className = 'kkr-hud-label';
    label.textContent = field.label;
    const value = document.createElement('span');
    value.className = 'kkr-hud-value';
    value.textContent = '--';
    cell.append(label, value);
    readouts.appendChild(cell);
    values[field.key] = value;
  }
  mount.appendChild(root);

  let disposed = false;
  return {
    root,
    get disposed() { return disposed; },
    update(session) {
      if (disposed || !session) return;
      const vehicle = session.vehicle;
      stage.textContent = `${session.blueprint.name.toUpperCase()} · ${session.route.officialDistanceKm.toFixed(2)} KM`;
      values.distance.textContent = `${(session.referenceMeters / 1000).toFixed(2)} km`;
      values.remaining.textContent = `${Math.max(0, (session.route.totalMeters - session.referenceMeters) / 1000).toFixed(2)} km`;
      const speed = Math.hypot(vehicle.velocityX, vehicle.velocityZ) * 3.6;
      values.speed.textContent = `${Math.round(speed)} km/h`;
      const heading = ((-vehicle.yaw * 180) / Math.PI + 450) % 360;
      values.heading.textContent = `${Math.round(heading).toString().padStart(3, '0')}°`;
      values.surface.textContent = (vehicle.surface?.name || '--').toUpperCase();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.remove();
    },
  };
}
