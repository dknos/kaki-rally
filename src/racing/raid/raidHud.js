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
  root.innerHTML = `
    <div class="kkr-panel kkr-stage">
      <span class="kkr-eyebrow">KAKI RALLY RAID &middot; DESERT EXPEDITION</span>
      <span class="kkr-title" data-kkr="stage">&mdash;</span>
      <span class="kkr-subtitle" data-kkr="discipline">SELECTIVE</span>
    </div>
    <div class="kkr-panel kkr-progress">
      <div class="kkr-progress-head"><span>ROUTE PROGRESS</span><span data-kkr="split">0.00 / 0.00 KM</span></div>
      <div class="kkr-progress-value" data-kkr="percent">0%</div>
      <div class="kkr-progress-track"><div class="kkr-progress-fill" data-kkr="fill"></div></div>
    </div>
    <div class="kkr-panel kkr-clock">
      <span class="kkr-eyebrow">STAGE TIME</span>
      <span class="kkr-clock-value" data-kkr="clock">0:00.000</span>
      <span class="kkr-readout-detail" data-kkr="cap">CAP 000&deg;</span>
    </div>
    <div class="kkr-panel kkr-readout kkr-readout-surface">
      <span class="kkr-readout-label">SAND STATS</span>
      <span class="kkr-readout-value" data-kkr="contacts">0 CONTACTS</span>
      <span class="kkr-readout-detail" data-kkr="surface">&mdash;</span>
    </div>
    <div class="kkr-panel kkr-readout kkr-readout-speed">
      <span class="kkr-readout-value" data-kkr="speed">0</span>
      <span class="kkr-readout-label">KM/H</span>
    </div>
    <div class="kkr-panel kkr-controls">W/S GAS &middot; BRAKE &nbsp; A/D STEER &nbsp; SPACE SLIDE &nbsp; SHIFT ENGINE PUSH</div>
  `;
  mount.appendChild(root);

  const node = (key) => root.querySelector(`[data-kkr="${key}"]`);
  const el = {
    stage: node('stage'), discipline: node('discipline'), split: node('split'),
    percent: node('percent'), fill: node('fill'), clock: node('clock'),
    cap: node('cap'), contacts: node('contacts'), surface: node('surface'), speed: node('speed'),
  };

  function formatClock(seconds) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds - minutes * 60;
    return `${minutes}:${rest.toFixed(3).padStart(6, '0')}`;
  }

  let disposed = false;
  return {
    root,
    get disposed() { return disposed; },
    update(session) {
      if (disposed || !session) return;
      const vehicle = session.vehicle;
      const total = session.route.totalMeters;
      const done = session.referenceMeters;
      const fraction = total > 0 ? done / total : 0;
      el.stage.textContent = session.blueprint.name.toUpperCase();
      el.discipline.textContent = `${session.blueprint.discipline.toUpperCase()} \u00b7 ${session.route.officialDistanceKm.toFixed(2)} KM`;
      el.split.textContent = `${(done / 1000).toFixed(2)} / ${(total / 1000).toFixed(2)} KM`;
      el.percent.textContent = `${Math.round(fraction * 100)}%`;
      el.fill.style.width = `${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%`;
      el.clock.textContent = formatClock(session.elapsed);
      const heading = ((-vehicle.yaw * 180) / Math.PI + 450) % 360;
      el.cap.textContent = `CAP ${Math.round(heading).toString().padStart(3, '0')}\u00b0`;
      el.contacts.textContent = `${vehicle.contacts} CONTACTS`;
      el.surface.textContent = `${(vehicle.surface?.name || '--').toUpperCase()} \u00b7 SLIP ${vehicle.slip.toFixed(1)}`;
      el.speed.textContent = `${Math.round(Math.hypot(vehicle.velocityX, vehicle.velocityZ) * 3.6)}`;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.remove();
    },
  };
}
