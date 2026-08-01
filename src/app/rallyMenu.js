import { AVATARS } from '../config.js';
import {
  MONSTER_ARENAS,
  MONSTER_ARENA_ORDER,
} from '../racing/monsterArenaDefinition.js';
import {
  canLaunchRacingMode,
  getRacingModeAvailability,
} from '../racing/racingModeAvailability.js';
import {
  RACE_COURSES,
  RACE_COURSE_ORDER,
  RACE_MODES,
  STOCK_VARIANT_ORDER,
  STOCK_VARIANTS,
} from '../racing/tracks.js';
import {
  TRIALS_TRACK_ORDER,
  TRIALS_TRACKS,
} from '../racing/trialsTracks.js';
import { TRIALS_VEHICLE_PROFILES } from '../racing/trialsPhysics.js';
import {
  DUNE_EVENTS,
  DUNE_EVENT_ORDER,
} from '../racing/dunes/duneEvents.js';
import {
  RALLY_RAID_VEHICLES,
  RALLY_RAID_VEHICLE_ORDER,
  ROADBOOK_ASSISTS,
  ROADBOOK_ASSIST_ORDER,
} from '../racing/dunes/duneRallyRaid.js';
import {
  DRIFT_CAR_ORDER,
  DRIFT_CAR_PROFILES,
  DRIFT_LAYOUT_ORDER,
  DRIFT_LAYOUTS,
} from '../racing/drift/driftAttack.js';
import { rendererPreferenceReloadUrl } from '../rendering/rendererSettings.js';
import {
  exportRallySave,
  getSaveDiagnostics,
  importRallySave,
  readRallySettings,
  resetAllRallyProgress,
  resetDrawTracks,
  resetRallyRecords,
  writeRallySettings,
} from './rallySave.js';
import { applyRallyOptions, optionsNeedReload } from './rallyOptions.js';
import { RALLY_VERSION_LABEL } from './rallyVersion.js';

const MODE_DATA = Object.freeze({
  circuit: Object.freeze({
    eyebrow: 'RACE · STAGE RALLY',
    title: 'Off-Road GP',
    short: 'Off-Road GP',
    art: 'assets/sprites/chapters/chapter_forest_kaki-v1.webp',
    description: 'Six rough-surface circuits, AI fields, damage, repairs, ramps, and real shortcuts.',
    mechanic: 'Three laps · mixed surfaces · up to 12 cars',
  }),
  drift: Object.freeze({
    eyebrow: 'RACE · CHARGED DRIFT',
    title: 'Drift Attack',
    short: 'Drift Attack',
    art: 'assets/sprites/chapters/chapter_twilight.webp',
    description: 'Drive the Whisker Yard, place the car on the line, and earn a judgeable run through angle, speed, and style.',
    mechanic: '90 seconds · 3 cars · 3 authored layouts · line / angle / style',
  }),
  stock: Object.freeze({
    eyebrow: 'RACE · OVAL PACK',
    title: 'Kaki Stock Cup',
    short: 'Stock Cup',
    art: 'assets/sprites/chapters/chapter_cinder.webp',
    description: 'Draft through the steeply banked Thunderbowl, trade paint cleanly, and choose concrete grip or loose clay.',
    mechanic: 'Eight laps · concrete / clay · drafting · up to 16 cars',
  }),
  draw: Object.freeze({
    eyebrow: 'COURSE WORKSHOP · KDT1 / KDT2 / KDT3',
    title: 'Circuit Workshop',
    short: 'Course Workshop',
    art: 'assets/screenshots/draw-your-track-workshop.png',
    description: 'Draw huge loops, author safe multi-level crossings, stamp production features, test, save, and race.',
    mechanic: 'Mouse · touch · controller · KDT share codes',
  }),
  monster: Object.freeze({
    eyebrow: 'MONSTER ARENA · THREE FORMATS',
    title: 'Monster Smash',
    short: 'Monster Smash',
    art: 'assets/racing/monster-smash-key-art-oekaki-v2.webp',
    description: 'Crush traffic, collapse supports, chain dominoes, land flips, and spend Zoomies.',
    mechanic: 'Smashdown · Freestyle · Free Ride',
  }),
  dunes: Object.freeze({
    eyebrow: 'DEFORMABLE SAND · RALLY RAID',
    title: 'Kaki Rally Raid',
    short: 'Rally Raid',
    art: 'assets/racing/dunes/kaki-dune-run-key-art-imagegen-v1.webp',
    description: 'Read the roadbook across authored dunes, wadis, hardpack, salt, and ridge stages while the original Dune Run events remain ready for freeride.',
    mechanic: 'Four raid stages · CAP calls · penalties · deformable sand',
  }),
  raid: Object.freeze({
    eyebrow: 'STREAMED DESERT · PREVIEW',
    title: 'Desert Expedition',
    short: 'Desert Expedition',
    art: 'assets/racing/raid/kaki-raid-key-art-v1.png',
    description: 'Cross a streamed desert on two stages: a winding gravel wadi and a folded rock shelf, or a hoodoo forest, a slot canyon, a glowing rift and the ruin terraces. An unfinished preview — there is no roadbook, no penalties, and no finish line yet.',
    mechanic: 'Two stages, 12.41 and 13.10 km · streamed terrain · authored jumps',
  }),
  trials: Object.freeze({
    eyebrow: 'SIDE TRIAL · KTR1 COURSE WORKSHOP',
    title: 'Kaki Trials',
    short: 'Kaki Trials',
    art: 'assets/screenshots/kaki-trials-side-scroll.png',
    description: 'Race the official medal road or sculpt, stamp, validate, share, and run your own side-view course.',
    mechanic: 'Three official courses · custom KTR1 library · PB ghosts',
  }),
  crash: Object.freeze({
    eyebrow: 'PAWPRINT INTERCHANGE · WEBGL BETA',
    title: 'Kaki Catastrophe',
    short: 'Catastrophe Beta',
    art: 'images/pawprint_interchange_03_chain_reaction.png',
    description: 'Enter live traffic, trigger a chain reaction, fire Kaki Boom, then watch the incident replay.',
    mechanic: 'Rapier · replay director · dynamic damage',
  }),
});

const CATASTROPHE_DEVELOPMENT_VEHICLES = Object.freeze([
  Object.freeze({ value: 'pocket', label: 'Pocket Pouncer' }),
  Object.freeze({ value: 'muscle', label: 'Kaki Muscle' }),
  Object.freeze({ value: 'iron', label: 'Iron Tabby' }),
]);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

// Desert Expedition stages, duplicated as plain data on purpose.
//
// tools/smoke-raid-isolation.mjs forbids this module from importing anything
// under src/racing/raid/ — the whole point of the discipline's isolation is
// that none of it reaches the initial bundle — so the menu cannot read
// RAID_STAGE_ORDER. The same test checks these ids against the real blueprint
// table, so the duplication cannot drift silently.
const RAID_STAGE_CHOICES = Object.freeze([
  Object.freeze({ value: 'wadi-of-whiskers', label: 'Wadi of Whiskers · 12.41 km · wadi, rock shelf, dunes' }),
  Object.freeze({ value: 'rift-of-nine-tails', label: 'Rift of Nine Tails · 13.10 km · canyon, rift, ruins, jumps' }),
]);
const DEFAULT_RAID_STAGE = RAID_STAGE_CHOICES[0].value;

function selectMarkup(name, label, options, selected) {
  return `<label class="rally-field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(name)}">${options.map(({ value, label: optionLabel, disabled = false }) => (
    `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${escapeHtml(optionLabel)}</option>`
  )).join('')}</select></label>`;
}

function rangeMarkup(name, label, value, min, max, step = 0.01) {
  return `<label class="rally-field rally-range"><span>${escapeHtml(label)} <output>${Number(value).toFixed(step < 0.1 ? 2 : 1)}</output></span><input name="${escapeHtml(name)}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function trackPath(points) {
  if (!points?.length) return '';
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(250 / Math.max(1, maxX - minX), 105 / Math.max(1, maxY - minY));
  const ox = 150 - (maxX - minX) * scale * 0.5;
  const oy = 64 - (maxY - minY) * scale * 0.5;
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${(ox + (x - minX) * scale).toFixed(1)},${(oy + (y - minY) * scale).toFixed(1)}`).join(' ') + 'Z';
}

function safeJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch (_) { return fallback; }
}

function recordSummary() {
  const rally = safeJson('kks_rally_best_v1', {});
  const draw = safeJson('kks_draw_tracks_v1', { tracks: [] });
  const monster = safeJson('kks_monster_records_v1', { records: {} });
  const dunes = safeJson('kks_dune_records_v1', { records: {} });
  const trials = safeJson('kks_rally_trials_v1', { records: {}, unlocked: ['meadow'] });
  const trialRecords = Object.values(trials.records || {});
  return {
    rallyRecords: Object.keys(rally).length,
    bestRally: Object.entries(rally).sort((a, b) => Number(a[1]) - Number(b[1]))[0] || null,
    drawTracks: Array.isArray(draw.tracks) ? draw.tracks.length : 0,
    drawBest: (draw.tracks || []).filter((track) => track.bestLap).sort((a, b) => a.bestLap - b.bestLap)[0] || null,
    monsterRecords: Object.keys(monster.records || monster).length,
    duneRecords: Object.keys(dunes.records || dunes).length,
    trialsMedals: trialRecords.filter((record) => record?.medal).length,
    trialsUnlocked: (trials.unlocked || ['meadow']).length,
  };
}

function unlockedTrialsTracks() {
  const progress = safeJson('kks_rally_trials_v1', { unlocked: ['meadow'] });
  const unlocked = new Set(Array.isArray(progress.unlocked) ? progress.unlocked : ['meadow']);
  unlocked.add('meadow');
  return unlocked;
}

function formatTime(seconds) {
  if (!(Number(seconds) > 0)) return '—';
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(3).padStart(6, '0')}`;
}

export class RallyMenu {
  constructor({
    host,
    backend = 'webgl',
    route = {},
    onSelectMode = null,
    onLaunch = null,
    onOpenDraw = null,
    onOpenTrialsWorkshop = null,
    onRestartWebGL = null,
  } = {}) {
    if (!host) throw new TypeError('RallyMenu requires a host element');
    this.host = host;
    this.backend = backend;
    this.route = route;
    this.onSelectMode = onSelectMode;
    this.onLaunch = onLaunch;
    this.onOpenDraw = onOpenDraw;
    this.onOpenTrialsWorkshop = onOpenTrialsWorkshop;
    this.onRestartWebGL = onRestartWebGL;
    this.catastropheDevelopment = !!route.catastropheDevelopment;
    // Deliberately session state rather than a saved setting: adding a key to
    // the save schema would change what rallySave sanitises and exports, and the
    // deep link is what a player actually shares.
    this.raidStage = RAID_STAGE_CHOICES.some((stage) => stage.value === route.stage)
      ? route.stage
      : DEFAULT_RAID_STAGE;
    this.settings = readRallySettings();
    this.optionsBaseline = { ...this.settings };
    const requestedMode = route.mode || this.settings.lastMode || 'circuit';
    this.selectedMode = requestedMode === 'crash' && !this.catastropheDevelopment
      ? 'circuit'
      : requestedMode;
    this.screen = 'main';
    this.visible = false;
    this.toastTimer = null;
    this.importInput = null;
    this._click = (event) => this.handleClick(event);
    this._change = (event) => this.handleChange(event);
    this._input = (event) => this.handleInput(event);
    this._keydown = (event) => this.handleKeydown(event);
    this.mount();
  }

  mount() {
    this.host.innerHTML = `
      <main class="rally-menu" aria-label="Kaki Rally main menu">
        <div class="rally-menu-art" aria-hidden="true"></div>
        <div class="rally-menu-scrim" aria-hidden="true"></div>
        <header class="rally-brand">
          <div class="rally-brand-mark"><i></i><span>KR</span></div>
          <div>
            <span>KAKI MOTOR CLUB</span>
            <div class="rally-title-line">
              <h1>KAKI <b>RALLY</b></h1>
              <span class="rally-version" aria-label="Kaki Rally version ${escapeHtml(RALLY_VERSION_LABEL)}">${escapeHtml(RALLY_VERSION_LABEL)}</span>
            </div>
          </div>
          <p class="rally-backend"><i></i><span>${escapeHtml(this.backend.toUpperCase())}</span></p>
        </header>
        <nav class="rally-mode-rail" aria-label="Game modes">
          <p>RACE</p>
          <button type="button" data-mode="circuit"><span>GP</span><strong>OFF-ROAD GP</strong></button>
          <button type="button" data-mode="drift"><span>90</span><strong>DRIFT ATTACK</strong></button>
          <button type="button" data-mode="stock"><span>16</span><strong>KAKI STOCK CUP</strong></button>
          <button type="button" data-mode="dunes"><span>≈</span><strong>KAKI DUNE RUN</strong></button>
          <p>BUILD / BREAK</p>
          <button type="button" data-mode="draw"><span>✎</span><strong>DRAW YOUR TRACK</strong></button>
          <button type="button" data-mode="monster"><span>✦</span><strong>MONSTER SMASH</strong></button>
          <button type="button" data-mode="trials"><span>△</span><strong>KAKI TRIALS</strong></button>
          <button type="button" data-mode="raid"><span>PRE</span><strong>DESERT EXPEDITION</strong></button>
          ${this.catastropheDevelopment ? '<button type="button" data-mode="crash"><span>DEV</span><strong>KAKI CATASTROPHE</strong><em></em></button>' : ''}
        </nav>
        <section class="rally-detail" aria-live="polite"></section>
        <footer class="rally-utilities">
          <button type="button" data-action="records">GARAGE / RECORDS</button>
          <button type="button" data-action="options">OPTIONS</button>
          <span><kbd>↑↓</kbd> SELECT <kbd>ENTER</kbd> OPEN <kbd>ESC</kbd> BACK</span>
        </footer>
        <div class="rally-toast" role="status" aria-live="polite"></div>
      </main>`;
    this.importInput = document.createElement('input');
    this.importInput.type = 'file';
    this.importInput.accept = 'application/json,.json';
    this.importInput.hidden = true;
    this.importInput.addEventListener('change', async () => {
      const file = this.importInput.files?.[0];
      if (!file) return;
      try {
        const result = importRallySave(await file.text());
        this.toast(`Imported ${result.imported.length} save sections. Reloading…`);
        setTimeout(() => location.reload(), 450);
      } catch (error) {
        this.toast(error?.message || 'Save import failed', 'error');
      } finally {
        this.importInput.value = '';
      }
    });
    this.host.appendChild(this.importInput);
    this.host.addEventListener('click', this._click);
    this.host.addEventListener('change', this._change);
    this.host.addEventListener('input', this._input);
    this.host.addEventListener('keydown', this._keydown);
    this.render();
  }

  availability() {
    return getRacingModeAvailability('crash', {
      backend: this.backend,
      development: this.catastropheDevelopment,
    });
  }

  show({ mode = null } = {}) {
    if (mode && (mode !== 'crash' || this.catastropheDevelopment)) this.selectedMode = mode;
    this.visible = true;
    this.host.hidden = false;
    this.screen = 'main';
    this.render();
    requestAnimationFrame(() => this.host.querySelector(`.rally-mode-rail button[data-mode="${this.selectedMode}"]`)?.focus({ preventScroll: true }));
  }

  hide() {
    this.visible = false;
    this.host.hidden = true;
  }

  selectMode(mode, { announce = true } = {}) {
    if (!MODE_DATA[mode] || (mode === 'crash' && !this.catastropheDevelopment)) return false;
    this.selectedMode = mode;
    this.settings = writeRallySettings({ ...this.settings, lastMode: mode });
    this.screen = 'main';
    this.render();
    if (announce) this.onSelectMode?.(mode);
    return true;
  }

  render() {
    const root = this.host.querySelector('.rally-menu');
    if (!root) return;
    root.dataset.screen = this.screen;
    root.querySelectorAll('.rally-mode-rail button[data-mode]').forEach((button) => {
      const active = button.dataset.mode === this.selectedMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'true' : 'false');
    });
    const crashButton = root.querySelector('.rally-mode-rail button[data-mode="crash"]');
    const availability = this.availability();
    if (crashButton) {
      crashButton.querySelector('em').textContent = availability.label;
      crashButton.classList.toggle('is-blocked', !availability.canLaunch);
    }
    if (this.screen === 'options') this.renderOptions();
    else if (this.screen === 'records') this.renderRecords();
    else this.renderMode();
  }

  renderMode() {
    const data = MODE_DATA[this.selectedMode];
    const course = RACE_COURSES[this.settings.lastCourse] || RACE_COURSES.forest;
    const driftLayout = DRIFT_LAYOUTS[this.settings.driftLayout] || DRIFT_LAYOUTS.judged;
    const art = this.host.querySelector('.rally-menu-art');
    art.style.backgroundImage = `url("${data.art}")`;
    art.dataset.mode = this.selectedMode;
    const path = trackPath(
      this.selectedMode === 'dunes'
        ? DUNE_EVENTS[this.settings.duneEvent]?.route
        : this.selectedMode === 'drift'
          ? driftLayout.points
        : course.points,
    );
    const availability = this.availability();
    let setup = '';
    if (this.selectedMode === 'drift') {
      setup = `
        ${selectMarkup('driftLayout', 'Layout', DRIFT_LAYOUT_ORDER.map((id) => ({ value: id, label: DRIFT_LAYOUTS[id].name })), this.settings.driftLayout)}
        ${selectMarkup('driftCar', 'Drift car', DRIFT_CAR_ORDER.map((id) => ({ value: id, label: `${DRIFT_CAR_PROFILES[id].name} · ${DRIFT_CAR_PROFILES[id].archetype}` })), this.settings.driftCar)}
        <div class="rally-workshop-note"><strong>JUDGED RUN</strong><span>Line, angle, speed, and style are scored at the zones shown in the venue.</span></div>
        ${this.driverSelect()}
        ${this.cameraSelect()}`;
    } else if (['circuit', 'stock'].includes(this.selectedMode)) {
      const mode = RACE_MODES[this.selectedMode];
      setup = `
        ${selectMarkup('course', 'Venue', RACE_COURSE_ORDER.map((id) => ({ value: id, label: RACE_COURSES[id].name })), this.settings.lastCourse)}
        ${selectMarkup('carCount', 'Grid', Array.from({ length: mode.maxCars - mode.minCars + 1 }, (_, index) => {
          const value = mode.minCars + index;
          return { value: String(value), label: `${value} cars` };
        }), String(this.settings.carCounts[this.selectedMode]))}
        ${this.selectedMode === 'stock' ? selectMarkup('stockVariant', 'Surface', STOCK_VARIANT_ORDER.map((id) => ({ value: id, label: STOCK_VARIANTS[id].name })), this.settings.stockVariant) : ''}
        ${this.driverSelect()}
        ${this.cameraSelect()}`;
    } else if (this.selectedMode === 'draw') {
      setup = `<div class="rally-workshop-note"><strong>LEGACY SAFE</strong><span>Reads existing libraries and KDT1 / KDT2 codes without conversion.</span></div>`;
    } else if (this.selectedMode === 'monster') {
      setup = `
        ${selectMarkup('monsterEvent', 'Event', [
          { value: 'smashdown', label: 'Smashdown · five rounds' },
          { value: 'freestyle', label: 'Freestyle · two minutes' },
          { value: 'free-ride', label: 'Free Ride · no clock' },
        ], this.settings.monsterEvent)}
        ${selectMarkup('monsterVehicle', 'Monster', [
          { value: 'meowster', label: 'Mighty Meowster' },
          { value: 'cyber', label: 'Cyber Kaki' },
          { value: 'tipsy', label: 'Tipsy Tumbler' },
        ], this.settings.monsterVehicle)}
        ${selectMarkup('monsterArena', 'Arena', MONSTER_ARENA_ORDER.map((id) => ({ value: id, label: MONSTER_ARENAS[id].name })), this.settings.monsterArena)}
        ${this.driverSelect()}`;
    } else if (this.selectedMode === 'dunes') {
      setup = `
        ${selectMarkup('duneEvent', 'Event', DUNE_EVENT_ORDER.map((id) => ({
          value: id,
          label: DUNE_EVENTS[id].isRallyRaid ? `RAID · ${DUNE_EVENTS[id].name}` : DUNE_EVENTS[id].name,
        })), this.settings.duneEvent)}
        ${selectMarkup('duneVehicle', 'Vehicle', [
          { value: 'meowster', label: 'Mighty Meowster' },
          { value: 'cyber', label: 'Cyber Kaki' },
          { value: 'tipsy', label: 'Tipsy Tumbler' },
          ...RALLY_RAID_VEHICLE_ORDER.map((id) => ({ value: id, label: `${RALLY_RAID_VEHICLES[id].name} · ${RALLY_RAID_VEHICLES[id].drive}` })),
        ], this.settings.duneVehicle)}
        ${selectMarkup('duneNavigationAssist', 'Roadbook', ROADBOOK_ASSIST_ORDER.map((id) => ({
          value: id,
          label: `${ROADBOOK_ASSISTS[id].name} · ${ROADBOOK_ASSISTS[id].description}`,
        })), this.settings.duneNavigationAssist)}
        ${DUNE_EVENTS[this.settings.duneEvent]?.isRallyRaid ? selectMarkup('duneService', 'Service plan', [
          { value: 'push', label: 'Push on · no service time' },
          { value: 'repair', label: 'Service · +18 seconds / reset wear' },
        ], this.settings.duneService) : ''}
        ${selectMarkup('duneDifficulty', 'Driving', [
          { value: 'relaxed', label: 'Relaxed assists' },
          { value: 'standard', label: 'Standard' },
          { value: 'pro', label: 'Pro · no line assist' },
        ], this.settings.duneDifficulty)}
        ${selectMarkup('duneDeformation', 'Sand simulation', ['low', 'medium', 'high', 'ultra'].map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        })), this.settings.duneDeformation)}
        ${this.driverSelect()}
        ${this.cameraSelect()}`;
    } else if (this.selectedMode === 'trials') {
      const unlocked = unlockedTrialsTracks();
      const selectedTrack = unlocked.has(this.settings.trialsTrack) ? this.settings.trialsTrack : 'meadow';
      setup = `
        ${selectMarkup('trialsTrack', 'Course', TRIALS_TRACK_ORDER.map((id) => ({
          value: id,
          label: unlocked.has(id) ? TRIALS_TRACKS[id].name : `${TRIALS_TRACKS[id].name} · earn B`,
          disabled: !unlocked.has(id),
        })), selectedTrack)}
        ${selectMarkup('trialsVehicle', 'Vehicle', Object.values(TRIALS_VEHICLE_PROFILES).map((profile) => ({ value: profile.id, label: profile.name })), this.settings.trialsVehicle)}
        ${this.driverSelect()}
        ${this.cameraSelect()}`;
    } else if (this.selectedMode === 'raid') {
      // Raid picks its own vehicle for now, so the stage is the only Raid-owned
      // choice. Without this branch the panel falls through to Catastrophe's
      // controls and shows its FROZEN notice.
      setup = `
        ${selectMarkup('raidStage', 'Stage', RAID_STAGE_CHOICES, this.raidStage)}
        ${this.driverSelect()}
        ${this.cameraSelect()}
        <div class="rally-beta-note" data-status="preview"><strong>PREVIEW</strong><span>Streamed terrain and two drivable stages. No roadbook, penalties, or finish line yet.</span></div>`;
    } else {
      setup = `
        ${selectMarkup('crashVehicle', 'Impact car', CATASTROPHE_DEVELOPMENT_VEHICLES, this.settings.crashVehicle)}
        ${selectMarkup('crashQuality', 'Traffic budget', [
          { value: 'low', label: 'Low · 24 bodies' },
          { value: 'medium', label: 'Medium · 38 bodies' },
          { value: 'high', label: 'High · 54 bodies' },
        ], this.settings.crashQuality)}
        ${this.driverSelect()}
        <div class="rally-beta-note" data-status="${availability.status}"><strong>${escapeHtml(availability.label)}</strong><span>${escapeHtml(availability.detail)}</span></div>`;
    }
    const action = this.selectedMode === 'draw'
      ? '<button class="rally-launch" type="button" data-action="draw">OPEN WORKSHOP <span>→</span></button>'
      : this.selectedMode === 'trials'
        ? '<button class="rally-launch is-secondary" type="button" data-action="trials-workshop">COURSE WORKSHOP <span>✎</span></button><button class="rally-launch" type="button" data-action="launch">START KAKI TRIALS <span>→</span></button>'
      : this.selectedMode === 'crash' && availability.action === 'restart-webgl'
        ? '<button class="rally-launch" type="button" data-action="restart-webgl">RESTART IN WEBGL <span>↻</span></button>'
      : `<button class="rally-launch" type="button" data-action="launch"${canLaunchRacingMode(this.selectedMode, { backend: this.backend, development: this.catastropheDevelopment }) ? '' : ' disabled'}>START ${escapeHtml(data.short.toUpperCase())} <span>→</span></button>`;
    this.host.querySelector('.rally-detail').innerHTML = `
      <div class="rally-detail-copy">
        <span class="rally-eyebrow">${escapeHtml(data.eyebrow)}</span>
        <h2>${escapeHtml(data.title)}</h2>
        <p>${escapeHtml(data.description)}</p>
        <strong>${escapeHtml(data.mechanic)}</strong>
      </div>
      <svg class="rally-route-signature" viewBox="0 0 300 128" role="img" aria-label="${escapeHtml(this.selectedMode === 'dunes' ? DUNE_EVENTS[this.settings.duneEvent].name : this.selectedMode === 'drift' ? driftLayout.name : course.name)} route diagram">
        <path class="route-shadow" d="${path}"></path><path d="${path}"></path><circle cx="0" cy="0" r="4"></circle>
      </svg>
      <form class="rally-setup" data-mode="${escapeHtml(this.selectedMode)}">${setup}${action}</form>`;
  }

  driverSelect() {
    return selectMarkup('lastDriver', 'Driver', AVATARS.map((avatar) => ({
      value: avatar.id,
      label: `${avatar.icon} ${avatar.name}`,
    })), this.settings.lastDriver);
  }

  cameraSelect() {
    return selectMarkup('camera', 'Camera', [
      { value: 'isometric', label: 'Isometric' },
      { value: 'chase', label: 'Chase' },
      { value: 'driver_fpv', label: 'Driver FPV' },
    ], this.settings.camera);
  }

  renderOptions() {
    const art = this.host.querySelector('.rally-menu-art');
    art.style.backgroundImage = 'url("assets/screenshots/kaki-rally-forest-chase.png")';
    const settings = this.settings;
    this.host.querySelector('.rally-detail').innerHTML = `
      <div class="rally-panel-head"><span>CAR SETUP / ACCESSIBILITY</span><h2>Options</h2><button type="button" data-action="back">BACK</button></div>
      <form class="rally-options-form">
        <fieldset><legend>DISPLAY</legend>
          ${selectMarkup('renderer', 'Renderer', [
            { value: 'auto', label: 'Auto · stable WebGL default' },
            { value: 'webgl', label: 'WebGL 2' },
            { value: 'webgpu', label: 'WebGPU' },
          ], settings.renderer)}
          ${selectMarkup('quality', 'Quality', ['low', 'medium', 'high', 'ultra'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })), settings.quality)}
          <label class="rally-check"><input name="reduceMotion" type="checkbox"${settings.reduceMotion ? ' checked' : ''}><span>Reduce camera motion</span></label>
          <label class="rally-check"><input name="reduceFlashing" type="checkbox"${settings.reduceFlashing ? ' checked' : ''}><span>Reduce flashing</span></label>
        </fieldset>
        <fieldset><legend>AUDIO</legend>
          ${rangeMarkup('masterVolume', 'Master', settings.masterVolume, 0, 1)}
          ${rangeMarkup('musicVolume', 'Music', settings.musicVolume, 0, 1)}
          ${rangeMarkup('sfxVolume', 'SFX', settings.sfxVolume, 0, 1)}
          ${rangeMarkup('ambientVolume', 'Ambient', settings.ambientVolume, 0, 1)}
        </fieldset>
        <fieldset><legend>CONTROLS</legend>
          ${this.cameraSelect()}
          ${rangeMarkup('controllerDeadzone', 'Controller deadzone', settings.controllerDeadzone, 0, 0.5)}
          <p class="rally-control-copy">WASD / arrows drive. Shift drifts or boosts. Space handbrakes; in Trials it restarts from checkpoint. Camera controls are always on-screen.</p>
        </fieldset>
        <fieldset><legend>DUNE RUN</legend>
          ${selectMarkup('duneTerrain', 'Terrain detail', ['low', 'medium', 'high', 'ultra'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })), settings.duneTerrain)}
          ${selectMarkup('duneParticles', 'Sand particles', ['low', 'medium', 'high', 'ultra'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })), settings.duneParticles)}
          ${selectMarkup('duneDust', 'Dust density', ['off', 'low', 'medium', 'high'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })), settings.duneDust)}
          ${selectMarkup('duneShadow', 'Dune shadows', ['low', 'medium', 'high', 'ultra'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })), settings.duneShadow)}
          ${rangeMarkup('duneCameraShake', 'Camera shake', settings.duneCameraShake, 0, 1)}
          <label class="rally-check"><input name="duneHeatHaze" type="checkbox"${settings.duneHeatHaze ? ' checked' : ''}><span>Heat haze</span></label>
          <label class="rally-check"><input name="duneSteeringAssist" type="checkbox"${settings.duneSteeringAssist ? ' checked' : ''}><span>Steering assist</span></label>
          <label class="rally-check"><input name="duneRecoveryAssist" type="checkbox"${settings.duneRecoveryAssist ? ' checked' : ''}><span>Automatic recovery</span></label>
        </fieldset>
        <button class="rally-launch" type="button" data-action="apply-options">SAVE OPTIONS <span>✓</span></button>
      </form>`;
  }

  renderRecords() {
    const summary = recordSummary();
    const diagnostics = getSaveDiagnostics();
    const bytes = Object.values(diagnostics).reduce((total, entry) => total + entry.bytes, 0);
    this.host.querySelector('.rally-menu-art').style.backgroundImage = 'url("assets/screenshots/monster-smash-arena-chase.png")';
    this.host.querySelector('.rally-detail').innerHTML = `
      <div class="rally-panel-head"><span>LOCAL GARAGE / ${Math.round(bytes / 1024)} KIB SAVED</span><h2>Records</h2><button type="button" data-action="back">BACK</button></div>
      <div class="rally-record-grid">
        <article><span>RALLY BOARDS</span><strong>${summary.rallyRecords}</strong><p>${summary.bestRally ? `${escapeHtml(summary.bestRally[0])} · ${formatTime(summary.bestRally[1])}` : 'Set your first lap.'}</p></article>
        <article><span>DRAW LIBRARY</span><strong>${summary.drawTracks}</strong><p>${summary.drawBest ? `${escapeHtml(summary.drawBest.name)} · ${formatTime(summary.drawBest.bestLap)}` : 'No saved best lap.'}</p></article>
        <article><span>MONSTER ROUTES</span><strong>${summary.monsterRecords}</strong><p>Personal routes and event records.</p></article>
        <article><span>DUNE RECORDS</span><strong>${summary.duneRecords}</strong><p>Timed runs, freeride scores, and deterministic ghosts.</p></article>
        <article><span>TRIALS MEDALS</span><strong>${summary.trialsMedals}</strong><p>${summary.trialsUnlocked} / 3 courses unlocked.</p></article>
        <article><span>DRIVER</span><strong>${escapeHtml(AVATARS.find((avatar) => avatar.id === this.settings.lastDriver)?.icon || '🐱')}</strong><p>${escapeHtml(AVATARS.find((avatar) => avatar.id === this.settings.lastDriver)?.name || 'Kitty Kaki')}</p></article>
      </div>
      <div class="rally-save-actions">
        <button type="button" data-action="export-save">EXPORT SAVE</button>
        <button type="button" data-action="import-save">IMPORT SAVE</button>
        <button type="button" data-action="reset-records">RESET RECORDS</button>
        <button type="button" data-action="reset-draw">RESET DRAW TRACKS</button>
        <button class="danger" type="button" data-action="reset-all">RESET ALL PROGRESS</button>
      </div>`;
  }

  handleChange(event) {
    const target = event.target;
    if (!target.name) return;
    const value = target.type === 'checkbox' ? target.checked : target.value;
    if (target.name === 'carCount') {
      this.settings = writeRallySettings({
        ...this.settings,
        carCounts: { ...this.settings.carCounts, [this.selectedMode]: Number(value) },
      });
    } else if (target.name === 'course') {
      this.settings = writeRallySettings({ ...this.settings, lastCourse: value });
      this.renderMode();
      return;
    } else if (target.name === 'raidStage') {
      this.raidStage = value;
      return;
    } else if (target.name === 'duneEvent') {
      this.settings = writeRallySettings({ ...this.settings, duneEvent: value });
      this.renderMode();
      return;
    } else if (target.name === 'driftLayout' || target.name === 'driftCar' || target.name === 'stockVariant') {
      this.settings = writeRallySettings({ ...this.settings, [target.name]: value });
      this.renderMode();
      return;
    } else {
      const numeric = ['masterVolume', 'musicVolume', 'sfxVolume', 'ambientVolume', 'controllerDeadzone', 'duneCameraShake'].includes(target.name);
      this.settings = writeRallySettings({ ...this.settings, [target.name]: numeric ? Number(value) : value });
    }
    if (this.screen === 'options') applyRallyOptions(this.settings);
  }

  handleInput(event) {
    if (event.target.type !== 'range') return;
    event.target.closest('label')?.querySelector('output')?.replaceChildren(Number(event.target.value).toFixed(2));
    this.handleChange(event);
  }

  launchRequest() {
    const mode = this.selectedMode;
    const common = {
      mode,
      playerAvatarId: this.settings.lastDriver,
      cameraMode: this.settings.camera,
    };
    if (mode === 'drift') {
      return {
        courseId: 'twilight',
        options: {
          ...common,
          carCount: this.settings.carCounts.drift,
          driftLayout: this.settings.driftLayout,
          driftCar: this.settings.driftCar,
        },
      };
    }
    if (mode === 'circuit') {
      return { courseId: this.settings.lastCourse, options: { ...common, carCount: this.settings.carCounts[mode] } };
    }
    if (mode === 'stock') {
      return {
        courseId: this.settings.lastCourse,
        options: {
          ...common,
          carCount: this.settings.carCounts.stock,
          stockVariant: this.settings.stockVariant,
        },
      };
    }
    if (mode === 'monster') {
      return {
        courseId: 'forest',
        options: {
          ...common,
          carCount: 1,
          monsterEvent: this.settings.monsterEvent,
          monsterVehicle: this.settings.monsterVehicle,
          monsterArena: this.settings.monsterArena,
        },
      };
    }
    if (mode === 'dunes') {
      return {
        courseId: this.settings.duneEvent,
        options: {
          ...common,
          carCount: 1,
          duneEvent: this.settings.duneEvent,
          duneVehicle: this.settings.duneVehicle,
          duneNavigationAssist: this.settings.duneNavigationAssist,
          duneService: this.settings.duneService,
          duneDifficulty: this.settings.duneDifficulty,
          duneDeformation: this.settings.duneDeformation,
          duneParticles: this.settings.duneParticles,
          duneDust: this.settings.duneDust,
          duneHeatHaze: this.settings.duneHeatHaze,
          duneTerrain: this.settings.duneTerrain,
          duneShadow: this.settings.duneShadow,
          duneCameraShake: this.settings.duneCameraShake,
          duneSteeringAssist: this.settings.duneSteeringAssist,
          duneRecoveryAssist: this.settings.duneRecoveryAssist,
        },
      };
    }
    if (mode === 'raid') {
      // src/racing/index.js resolves the Raid stage as `options.stageId ||
      // courseId`, so the selected stage travels on the shared courseId.
      return { courseId: this.raidStage, options: { ...common, raidStage: this.raidStage } };
    }
    if (mode === 'trials') {
      const trackId = unlockedTrialsTracks().has(this.settings.trialsTrack)
        ? this.settings.trialsTrack
        : 'meadow';
      return {
        courseId: trackId,
        options: {
          ...common,
          trialsTrackId: trackId,
          trialsVehicle: this.settings.trialsVehicle,
        },
      };
    }
    return {
      courseId: 'forest',
      options: {
        ...common,
        crashVehicle: this.settings.crashVehicle,
        crashQuality: this.settings.crashQuality,
      },
    };
  }

  async handleClick(event) {
    const modeButton = event.target.closest('button[data-mode]');
    if (modeButton) {
      this.selectMode(modeButton.dataset.mode);
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'launch') {
      this.onLaunch?.(this.launchRequest());
    } else if (action === 'draw') {
      this.onOpenDraw?.();
    } else if (action === 'trials-workshop') {
      this.onOpenTrialsWorkshop?.();
    } else if (action === 'options') {
      this.optionsBaseline = { ...readRallySettings() };
      this.screen = 'options';
      this.render();
    } else if (action === 'records') {
      this.screen = 'records';
      this.render();
    } else if (action === 'back') {
      this.screen = 'main';
      this.render();
    } else if (action === 'restart-webgl') {
      this.onRestartWebGL?.();
    } else if (action === 'apply-options') {
      const before = this.optionsBaseline;
      const form = this.host.querySelector('.rally-options-form');
      const data = new FormData(form);
      const after = {
        ...this.settings,
        renderer: data.get('renderer'),
        quality: data.get('quality'),
        camera: data.get('camera'),
        reduceMotion: data.has('reduceMotion'),
        reduceFlashing: data.has('reduceFlashing'),
      };
      this.settings = applyRallyOptions(after);
      if (optionsNeedReload(before, this.settings)) {
        this.toast('Display backend saved. Reloading…');
        setTimeout(() => location.assign(rendererPreferenceReloadUrl(location.href)), 350);
      } else {
        this.optionsBaseline = { ...this.settings };
        this.toast('Options saved');
      }
    } else if (action === 'export-save') {
      this.downloadSave();
    } else if (action === 'import-save') {
      this.importInput.click();
    } else if (action === 'reset-records') {
      if (confirm('Reset all race, Monster, and Trials records? Draw Track creations will remain.')) {
        resetRallyRecords({ confirmed: true });
        this.renderRecords();
        this.toast('Records reset');
      }
    } else if (action === 'reset-draw') {
      if (confirm('Delete every locally saved Draw Your Track creation? This cannot be undone unless you exported a save.')) {
        resetDrawTracks({ confirmed: true });
        this.renderRecords();
        this.toast('Draw Track library reset');
      }
    } else if (action === 'reset-all') {
      if (confirm('Reset ALL Kaki Rally progress, tracks, records, ghosts, and settings?')) {
        resetAllRallyProgress({ confirmed: true });
        this.toast('All progress reset. Reloading…');
        setTimeout(() => location.reload(), 400);
      }
    }
  }

  handleKeydown(event) {
    if (event.key === 'Escape') {
      if (this.screen !== 'main') {
        event.preventDefault();
        this.screen = 'main';
        this.render();
      }
      return;
    }
    if (!['ArrowUp', 'ArrowDown'].includes(event.key) || event.target.matches('select,input')) return;
    const buttons = [...this.host.querySelectorAll('.rally-mode-rail button[data-mode]')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
  }

  updateGamepad(gamepad) {
    if (!this.visible || !gamepad?.connected) return;
    const focusable = [...this.host.querySelectorAll('button:not([disabled]), select, input:not([hidden])')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    let index = focusable.indexOf(document.activeElement);
    if (index < 0) index = 0;
    if (gamepad.justPressed.dpadDown || gamepad.justPressed.dpadRight) {
      focusable[(index + 1) % focusable.length].focus();
    } else if (gamepad.justPressed.dpadUp || gamepad.justPressed.dpadLeft) {
      focusable[(index - 1 + focusable.length) % focusable.length].focus();
    } else if (gamepad.justPressed.a) {
      document.activeElement?.click?.();
    } else if (gamepad.justPressed.b) {
      if (this.screen !== 'main') {
        this.screen = 'main';
        this.render();
      }
    }
  }

  downloadSave() {
    const blob = new Blob([exportRallySave()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `kaki-rally-save-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    this.toast('Save exported');
  }

  toast(message, tone = '') {
    const toast = this.host.querySelector('.rally-toast');
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.classList.add('is-visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800);
  }

  dispose() {
    clearTimeout(this.toastTimer);
    this.host.removeEventListener('click', this._click);
    this.host.removeEventListener('change', this._change);
    this.host.removeEventListener('input', this._input);
    this.host.removeEventListener('keydown', this._keydown);
    this.host.replaceChildren();
  }
}
