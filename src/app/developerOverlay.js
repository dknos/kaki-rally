const SAMPLE_COUNT = 240;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function memoryLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'n/a';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function signed(value, digits = 2) {
  const number = finite(value);
  return `${number >= 0 ? '+' : ''}${number.toFixed(digits)}`;
}

function boolLabel(value) {
  return value ? 'YES' : 'NO';
}

export class DeveloperOverlay {
  constructor({ getDiagnostics }) {
    this.getDiagnostics = getDiagnostics;
    this.samples = new Float32Array(SAMPLE_COUNT);
    this.cursor = 0;
    this.count = 0;
    this.lastPaint = 0;
    this.visible = false;
    this.timing = { frameMs: 0, updateMs: 0, physicsMs: 0, renderMs: 0 };
    this.root = document.createElement('aside');
    this.root.className = 'rally-dev-overlay';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Kaki Rally developer telemetry');
    this.root.innerHTML = `
      <header>
        <div><span>KR // PIT WALL</span><strong>LIVE TELEMETRY</strong></div>
        <button type="button" data-dev-close aria-label="Hide developer telemetry">F3</button>
      </header>
      <canvas width="760" height="96" aria-label="Frame-time history"></canvas>
      <div class="rally-dev-columns">
        <pre data-dev-system></pre>
        <pre data-dev-vehicle></pre>
      </div>`;
    document.body.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas');
    this.system = this.root.querySelector('[data-dev-system]');
    this.vehicle = this.root.querySelector('[data-dev-vehicle]');
    this.root.querySelector('[data-dev-close]').addEventListener('click', () => this.hide());
    const params = new URLSearchParams(location.search);
    if (params.get('telemetry') === '1' || params.get('debug') === '1') this.show();
  }

  show() {
    this.visible = true;
    this.root.hidden = false;
    this.paint(performance.now(), true);
    return true;
  }

  hide() {
    this.visible = false;
    this.root.hidden = true;
    return false;
  }

  toggle() {
    return this.visible ? this.hide() : this.show();
  }

  recordFrame(timing = {}) {
    this.timing = {
      frameMs: finite(timing.frameMs),
      updateMs: finite(timing.updateMs),
      physicsMs: finite(timing.physicsMs),
      renderMs: finite(timing.renderMs),
    };
    if (this.timing.frameMs > 0) {
      this.samples[this.cursor] = this.timing.frameMs;
      this.cursor = (this.cursor + 1) % SAMPLE_COUNT;
      this.count = Math.min(SAMPLE_COUNT, this.count + 1);
    }
    if (this.visible) this.paint(performance.now());
  }

  orderedSamples() {
    const values = [];
    const start = this.count === SAMPLE_COUNT ? this.cursor : 0;
    for (let index = 0; index < this.count; index += 1) {
      values.push(this.samples[(start + index) % SAMPLE_COUNT]);
    }
    return values;
  }

  paint(now, force = false) {
    if (!force && now - this.lastPaint < 180) return;
    this.lastPaint = now;
    const diagnostics = this.getDiagnostics?.() || {};
    const renderer = diagnostics.renderer || {};
    const racing = diagnostics.racing || {};
    const telemetry = racing.telemetry || {};
    const audio = diagnostics.audio || {};
    const scene = diagnostics.sceneRenderables || {};
    const frames = this.orderedSamples();
    const median = percentile(frames, 0.5);
    const p95 = percentile(frames, 0.95);
    const p99 = percentile(frames, 0.99);
    const fps = median > 0 ? 1000 / median : finite(renderer.fps);
    const oneLow = p99 > 0 ? 1000 / p99 : fps;
    const pool = diagnostics.poolUsage || {};
    this.system.textContent = [
      `BACKEND     ${(renderer.backend || diagnostics.backend || 'unknown').toUpperCase()}`,
      `MODE        ${String(diagnostics.activeMode || diagnostics.appMode || 'menu').toUpperCase()}`,
      `FPS         ${fps.toFixed(1)}   1% LOW ${oneLow.toFixed(1)}`,
      `FRAME       ${this.timing.frameMs.toFixed(2)} ms`,
      `MED / P95   ${median.toFixed(2)} / ${p95.toFixed(2)} ms`,
      `UPDATE      ${this.timing.updateMs.toFixed(2)} ms`,
      `PHYSICS     ${this.timing.physicsMs.toFixed(2)} ms`,
      `RENDER      ${this.timing.renderMs.toFixed(2)} ms`,
      `DRAWS       ${finite(renderer.drawCalls).toFixed(0)}`,
      `TRIANGLES   ${finite(renderer.triangles).toLocaleString()}`,
      `VISIBLE     ${finite(scene.visible).toFixed(0)}`,
      `INSTANCED   ${finite(scene.instanced).toFixed(0)} / ${finite(scene.instances).toFixed(0)}`,
      `TEXTURES    ${finite(renderer.textures).toFixed(0)}`,
      `GEOMETRIES  ${finite(renderer.geometries).toFixed(0)}`,
      `TARGETS     ${finite(renderer.renderTargets).toFixed(0)}`,
      `GPU EST.    ${memoryLabel(diagnostics.estimatedGpuMemoryBytes ?? renderer.gpuMemoryBytes)}`,
      `MODE DOM    ${finite(diagnostics.modeOwnedDomNodes).toFixed(0)}`,
      `AUDIO NODES ${finite(audio.activeNodes).toFixed(0)}`,
      `POOLS       ${finite(pool.active).toFixed(0)} / ${finite(pool.capacity).toFixed(0)}`,
    ].join('\n');

    const monster = racing.monster?.vehicleContact;
    const dunes = racing.raceMode === 'dunes' ? racing : null;
    const wheelLines = monster
      ? Object.entries(monster.wheels || {}).map(([id, wheel]) => (
          `${id.padEnd(11)} ${wheel.grounded ? 'LOAD' : 'AIR '} `
          + `${finite(wheel.compression).toFixed(2)}  ${String(wheel.contactType || wheel.surface || '').slice(0, 12)}`
        ))
      : [];
    this.vehicle.textContent = [
      `PROFILE     ${telemetry.profile || racing.vehicleId || '—'}`,
      `SPEED       ${finite(racing.speed).toFixed(2)}`,
      `FORWARD     ${signed(telemetry.forwardSpeed ?? telemetry.forwardVelocity ?? racing.vx)}`,
      `LATERAL     ${signed(telemetry.lateralSpeed)}`,
      `ACCEL       ${signed(telemetry.acceleration)}`,
      `STEER       ${signed(telemetry.steeringInput)} > ${signed(telemetry.appliedSteering)}`,
      `YAW RATE    ${signed(telemetry.yawRate)}`,
      `SLIP ANGLE  ${signed(telemetry.slipAngle, 3)}`,
      `SURFACE     ${telemetry.surface || (dunes ? racing.telemetry?.groundedWheels ? 'dune sand' : 'airborne' : '—')}`,
      `GRIP / DRAG ${finite(telemetry.surfaceGrip, 1).toFixed(2)} / ${finite(telemetry.surfaceDrag).toFixed(2)}`,
      `DAMAGE      ${Math.max(0, 100 - finite(racing.integrity, 100)).toFixed(0)}%`,
      `BOOST       ${finite(racing.boostHeat ?? racing.turboHeat).toFixed(2)}`,
      `GROUNDED    ${boolLabel(telemetry.grounded ?? (dunes ? telemetry.groundedWheels > 0 : racing.grounded))}`,
      `JUMP        ${telemetry.jumpState || (racing.grounded ? 'grounded' : 'airborne')}`,
      `DRIFT       ${telemetry.driftState || (racing.drifting ? 'drifting' : 'grip')}`,
      `COLLISION   ${finite(telemetry.collisionIntensity).toFixed(2)}`,
      `RPM / GEAR  ${finite(telemetry.engineRpm).toFixed(0)} / ${finite(telemetry.gear).toFixed(0)}`,
      ...(monster ? [
        `PITCH       ${signed(monster.pitch)} @ ${signed(monster.pitchVelocity)}/s`,
        `ROLL        ${signed(monster.roll)}`,
        `SNAG        ${boolLabel(monster.obstacleContact)}  ASSIST ${finite(monster.antiBackflipTorque).toFixed(2)}`,
        ...wheelLines,
      ] : []),
      ...(dunes ? [
        `CONTACTS    ${finite(telemetry.groundedWheels).toFixed(0)} / 4`,
        `LOAD        ${finite(telemetry.normalLoad).toFixed(2)}`,
        `WHEEL SLIP  ${(finite(telemetry.wheelSlip) * 100).toFixed(1)}%`,
        `SINKAGE     ${(finite(telemetry.sinkage) * 100).toFixed(1)} cm`,
        `RUT / BERM  ${(finite(racing.deformation?.maximumDepression) * 100).toFixed(1)} / ${(finite(racing.deformation?.maximumBerm) * 100).toFixed(1)} cm`,
        `BRUSHES     ${finite(racing.deformation?.appliedBrushes).toFixed(0)}`,
        `HEIGHT Δ    ${finite(racing.terrain?.rendererPhysicsDelta).toExponential(1)}`,
      ] : []),
    ].join('\n');
    this.drawGraph(frames, median, p95);
  }

  drawGraph(frames, median, p95) {
    const context = this.canvas.getContext('2d');
    if (!context) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = '#071012';
    context.fillRect(0, 0, width, height);
    const scaleMax = Math.max(33.34, p95 * 1.25, ...frames);
    const lineY = (milliseconds) => height - Math.min(height, milliseconds / scaleMax * height);
    for (const [milliseconds, color] of [[8.33, '#1d4744'], [16.67, '#2d5d52'], [33.34, '#6d493d']]) {
      const y = lineY(milliseconds);
      context.strokeStyle = color;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    context.strokeStyle = '#73efc5';
    context.lineWidth = 2;
    context.beginPath();
    for (let index = 0; index < frames.length; index += 1) {
      const x = frames.length <= 1 ? 0 : index / (frames.length - 1) * width;
      const y = lineY(frames[index]);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
    context.fillStyle = '#defff4';
    context.font = '18px Geist Mono, monospace';
    context.fillText(`${median.toFixed(1)} median / ${p95.toFixed(1)} p95`, 12, 22);
  }

  dispose() {
    this.root.remove();
  }
}
