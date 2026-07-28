import {
  COURSE_FEATURE_CATEGORIES,
  COURSE_FEATURE_THUMBNAIL_ATLAS,
  getCourseFeature,
  listCourseFeatures,
} from './courseFeatureCatalog.js';
import {
  createCourseFeaturePlacementId,
  sanitizeCourseFeaturePlacements,
} from './courseFeaturePlacement.js';
import { sampleTrialsGround } from './trialsTracks.js';
import {
  TRIALS_TERRAIN_TOOLS,
  applyTrialsTerrainStamp,
  moveTrialsControlPoint,
  validateTrialsFeaturePlacement,
  validateTrialsCourse,
} from './trialsWorkshopGeometry.js';
import {
  TrialsCourseCodec,
  TrialsCourseLibrary,
  createEmptyTrialsCourse,
  duplicateOfficialTrialsCourse,
  sanitizeTrialsCourse,
} from './trialsWorkshopStorage.js';

const STYLE_ID = 'ktr-editor-style';
const STYLE_URL = new URL('./trialsWorkshop.css?v=20260727workshop1', import.meta.url).href;
const FEATURE_ATLAS_URL = new URL(`../../${COURSE_FEATURE_THUMBNAIL_ATLAS}`, import.meta.url).href;
const STAGES = Object.freeze([
  ['terrain', 'TERRAIN'],
  ['place', 'PLACE'],
  ['checkpoints', 'CHECKPOINTS'],
  ['goals', 'GOALS'],
  ['test', 'TEST / RUN'],
]);
const COURSE_OBJECTS = new Set([
  'checkpoint-gate',
  'trials-finish-gate',
  'turbo-gate',
  'trials-time-bonus',
  'trials-style-gate',
  'crown-jump-ring',
  'trials-destruction-gate',
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = STYLE_URL;
  document.head.appendChild(link);
}

function cloneCourse(course) {
  return structuredClone({
    ...course,
    checkpoints: undefined,
    obstacles: undefined,
  });
}

function featureThumbnailStyle(feature) {
  const frame = Math.max(0, Number(feature?.previewFrame) || 0);
  return `--feature-col:${frame % 7};--feature-row:${Math.floor(frame / 7)};background-image:url('${FEATURE_ATLAS_URL}')`;
}

function featureScale(placement) {
  return Number(placement?.anchor?.scaleX) || 1;
}

function placementLabel(placement) {
  return getCourseFeature(placement?.featureId)?.label || placement?.featureId || 'Feature';
}

function modePalette(stage, category) {
  let values = listCourseFeatures({ mode: 'trials', productionOnly: true });
  if (stage === 'checkpoints') return values.filter((feature) => COURSE_OBJECTS.has(feature.id));
  values = values.filter((feature) => !COURSE_OBJECTS.has(feature.id));
  return category ? values.filter((feature) => feature.category === category) : values;
}

export class TrialsWorkshopEditor {
  constructor({
    initialCourse = null,
    onBuild = null,
    onExit = null,
  } = {}) {
    injectStyle();
    this.library = new TrialsCourseLibrary();
    this.course = sanitizeTrialsCourse(initialCourse || createEmptyTrialsCourse()).course;
    this.validation = validateTrialsCourse(this.course);
    this.onBuild = onBuild;
    this.onExit = onExit;
    this.stage = 'terrain';
    this.terrainTool = 'gentle-hill';
    this.featureCategory = 'jumps';
    this.paletteFeatureId = 'small-kicker';
    this.selectedPlacementId = null;
    this.selectedPoint = -1;
    this.testFromX = this.course.spawn.x;
    this.history = [];
    this.future = [];
    this.view = { start: 0, end: this.course.length, minY: 0, maxY: 30 };
    this.pointer = null;
    this.pointers = new Map();
    this.hoverWorld = null;
    this.previewCache = null;
    this.controllerCursor = { x: 0.18, y: 0.52, visible: false };
    this.lastGamepad = { buttons: [], trigger: 0 };
    this.fieldEdit = null;
    this.frame = 0;
    this.resizeObserver = null;
    this.atlas = new Image();
    this.atlas.onload = () => this.requestDraw();
    this.atlas.src = FEATURE_ATLAS_URL;
    this.mount();
  }

  mount() {
    document.body.classList.add('ktr-open');
    this.root = document.createElement('section');
    this.root.className = 'ktr-editor';
    this.root.setAttribute('aria-label', 'Kaki Trials Workshop');
    this.root.innerHTML = `
      <header class="ktr-header">
        <div class="ktr-brand"><span>KAKI COURSE WORKSHOP</span><h1>TRIALS BENCH</h1><p>Authoritative terrain · shared production kit · KTR1</p></div>
        <nav class="ktr-stages" aria-label="Trials editor stages">
          ${STAGES.map(([id, label], index) => `<button type="button" data-stage="${id}"${index === 0 ? ' class="is-active"' : ''}><i>${index + 1}</i>${label}</button>`).join('')}
        </nav>
        <div class="ktr-header-actions">
          <button type="button" data-action="undo" aria-label="Undo">↶</button>
          <button type="button" data-action="redo" aria-label="Redo">↷</button>
          <button type="button" data-action="fit">FIT VIEW</button>
          <button type="button" data-action="save" class="is-primary">SAVE</button>
          <button type="button" data-action="share">SHARE</button>
          <button type="button" data-action="exit">EXIT</button>
        </div>
      </header>
      <aside class="ktr-library">
        <div><span>COURSE LIBRARY</span><strong class="ktr-course-name"></strong></div>
        <select data-field="library" aria-label="Saved custom Trials courses"></select>
        <button type="button" data-action="new-rolling">+ ROLLING</button>
        <button type="button" data-action="new-blank">+ BLANK</button>
        <select data-field="official-copy" aria-label="Official course to duplicate">
          <option value="meadow">MEADOW COPY</option>
          <option value="quarry">QUARRY COPY</option>
          <option value="crown">CROWN COPY</option>
        </select>
        <button type="button" data-action="copy-official">DUPLICATE OFFICIAL</button>
      </aside>
      <main class="ktr-workspace">
        <canvas class="ktr-canvas" tabindex="0" aria-label="Side-view Trials terrain editor"></canvas>
        <div class="ktr-scale"><strong></strong><span>DRAG POINTS · WHEEL ZOOM · TWO-FINGER PAN</span></div>
        <div class="ktr-test-marker">TEST START</div>
        <div class="ktr-controller-legend">LS CURSOR · A PLACE / SELECT · B CANCEL · X DELETE · Y DUPLICATE · LB/RB CATEGORY · LT/RT SIZE · D-PAD NUDGE</div>
        <section class="ktr-validation" role="status" aria-live="polite"></section>
      </main>
      <aside class="ktr-panel"></aside>
      <section class="ktr-bench"></section>
      <dialog class="ktr-share-dialog">
        <form method="dialog">
          <header><span>KTR1 SHARE CODE</span><button value="cancel" aria-label="Close">×</button></header>
          <textarea spellcheck="false" aria-label="KTR1 code"></textarea>
          <p>Export is read-only. Import validates bounds, checksums, features, terrain, and transforms before replacing the open draft.</p>
          <div><button type="button" data-action="copy-code">COPY</button><button type="button" data-action="load-code">LOAD CODE</button></div>
        </form>
      </dialog>`;
    (document.querySelector('#ui-root') || document.body).appendChild(this.root);
    this.canvas = this.root.querySelector('.ktr-canvas');
    this.ctx = this.canvas.getContext('2d');
    this._click = (event) => this.handleClick(event);
    this._change = (event) => this.handleChange(event);
    this._input = (event) => this.handleInput(event);
    this._focusOut = (event) => {
      if (event.target?.dataset?.field) this.finishFieldEdit(event.target.dataset.field);
    };
    this._keydown = (event) => this.handleKeydown(event);
    this._pointerDown = (event) => this.pointerDown(event);
    this._pointerMove = (event) => this.pointerMove(event);
    this._pointerUp = (event) => this.pointerUp(event);
    this._pointerLeave = (event) => {
      if (!this.pointers.has(event.pointerId)) {
        this.hoverWorld = null;
        this.requestDraw();
      }
    };
    this._wheel = (event) => this.wheel(event);
    this.root.addEventListener('click', this._click);
    this.root.addEventListener('change', this._change);
    this.root.addEventListener('input', this._input);
    this.root.addEventListener('focusout', this._focusOut);
    window.addEventListener('keydown', this._keydown);
    this.canvas.addEventListener('pointerdown', this._pointerDown);
    this.canvas.addEventListener('pointermove', this._pointerMove);
    this.canvas.addEventListener('pointerup', this._pointerUp);
    this.canvas.addEventListener('pointercancel', this._pointerUp);
    this.canvas.addEventListener('pointerleave', this._pointerLeave);
    this._contextMenu = (event) => {
      event.preventDefault();
      this.cancelTool();
    };
    this.canvas.addEventListener('contextmenu', this._contextMenu);
    this.canvas.addEventListener('wheel', this._wheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.fitView();
    this.render();
    this._controllerFrame = requestAnimationFrame((time) => this.pollController(time));
    window.__ktrEditor = this;
  }

  currentCourse() {
    return cloneCourse(this.course);
  }

  capture() {
    this.pushHistorySnapshot(this.course);
  }

  pushHistorySnapshot(course) {
    this.history.push(cloneCourse(course));
    if (this.history.length > 80) this.history.shift();
    this.future.length = 0;
  }

  commit(next, { preserveSelection = true, render = true } = {}) {
    this.course = sanitizeTrialsCourse(next).course;
    this.validation = validateTrialsCourse(this.course);
    if (
      preserveSelection
      && this.selectedPlacementId
      && !this.course.featurePlacements.some((placement) => placement.id === this.selectedPlacementId)
    ) this.selectedPlacementId = null;
    if (render) this.render();
    else {
      this.renderValidation();
      this.requestDraw();
    }
  }

  beginFieldEdit(field) {
    if (!field) return;
    if (this.fieldEdit?.field === field) return;
    this.finishFieldEdit();
    this.fieldEdit = {
      field,
      before: cloneCourse(this.course),
    };
  }

  finishFieldEdit(field = '') {
    if (!this.fieldEdit || (field && this.fieldEdit.field !== field)) return false;
    const edit = this.fieldEdit;
    this.fieldEdit = null;
    const changed = JSON.stringify(edit.before) !== JSON.stringify(cloneCourse(this.course));
    if (changed) this.pushHistorySnapshot(edit.before);
    this.commit(this.course);
    return changed;
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) return;
    this.future.push(cloneCourse(this.course));
    this.commit(previous);
  }

  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(cloneCourse(this.course));
    this.commit(next);
  }

  setStage(stage) {
    if (!STAGES.some(([id]) => id === stage)) return;
    this.finishFieldEdit();
    this.stage = stage;
    if (stage === 'checkpoints' && !COURSE_OBJECTS.has(this.paletteFeatureId)) {
      this.paletteFeatureId = 'checkpoint-gate';
    } else if (stage === 'place' && COURSE_OBJECTS.has(this.paletteFeatureId)) {
      this.paletteFeatureId = 'small-kicker';
    }
    if (stage === 'test') this.focusTestView();
    this.render();
  }

  selectedPlacement() {
    return this.course.featurePlacements.find((placement) => placement.id === this.selectedPlacementId) || null;
  }

  updatePlacement(id, mutate, capture = true, render = true) {
    const index = this.course.featurePlacements.findIndex((placement) => placement.id === id);
    if (index < 0) return false;
    const placements = this.course.featurePlacements.map((placement) => ({
      ...placement,
      anchor: { ...placement.anchor },
      properties: { ...placement.properties },
    }));
    mutate(placements[index]);
    const nextPlacement = placements[index];
    const placementValidation = validateTrialsFeaturePlacement(this.course, {
      featureId: nextPlacement.featureId,
      x: nextPlacement.anchor.x,
      scale: nextPlacement.anchor.scaleX,
      ignorePlacementId: nextPlacement.id,
    });
    if (!placementValidation.valid) {
      this.toast(placementValidation.message, 'error');
      return false;
    }
    if (capture) this.capture();
    this.commit({
      ...this.course,
      finish: nextPlacement.featureId === 'trials-finish-gate'
        ? nextPlacement.anchor.x
        : this.course.finish,
      featurePlacements: placements,
    }, { render });
    return true;
  }

  placeFeature(featureId, x) {
    const feature = getCourseFeature(featureId);
    if (!feature?.compatibleModes.includes('trials')) return false;
    let placements = [...this.course.featurePlacements];
    const existingFinish = featureId === 'trials-finish-gate'
      ? placements.find((placement) => placement.featureId === featureId)
      : null;
    const preview = validateTrialsFeaturePlacement(this.course, {
      featureId,
      x,
      ignorePlacementId: existingFinish?.id || '',
    });
    if (!preview.valid) {
      this.toast(preview.message, 'error');
      return false;
    }
    this.capture();
    if (featureId === 'trials-finish-gate') {
      placements = placements.filter((placement) => placement.featureId !== featureId);
    }
    const placement = {
      id: createCourseFeaturePlacementId(featureId, this.course.seed, placements.length + this.history.length),
      featureId,
      anchor: {
        mode: 'trials',
        x: clamp(x, 3, this.course.length - 3),
        groundOffset: 0,
        facing: 1,
        rotationOffset: 0,
        scaleX: 1,
        scaleY: 1,
      },
      properties: featureId === 'checkpoint-gate'
        ? { label: `Workshop Bell ${placements.filter((item) => item.featureId === 'checkpoint-gate').length + 1}` }
        : {},
    };
    const sanitized = sanitizeCourseFeaturePlacements([...placements, placement], {
      mode: 'trials',
    }).placements;
    this.selectedPlacementId = placement.id;
    this.commit({
      ...this.course,
      finish: featureId === 'trials-finish-gate' ? placement.anchor.x : this.course.finish,
      featurePlacements: sanitized,
    });
    return true;
  }

  deleteSelected() {
    if (!this.selectedPlacementId) return;
    this.capture();
    const selected = this.selectedPlacement();
    this.commit({
      ...this.course,
      finish: selected?.featureId === 'trials-finish-gate'
        ? this.course.length - 20
        : this.course.finish,
      featurePlacements: this.course.featurePlacements.filter((placement) => placement.id !== this.selectedPlacementId),
    }, { preserveSelection: false });
    this.selectedPlacementId = null;
  }

  duplicateSelected() {
    const selected = this.selectedPlacement();
    if (!selected || selected.featureId === 'trials-finish-gate') return;
    this.capture();
    const clone = structuredClone(selected);
    clone.id = createCourseFeaturePlacementId(clone.featureId, Date.now(), this.course.featurePlacements.length);
    clone.anchor.x = clamp(clone.anchor.x + 8, 3, this.course.length - 3);
    this.selectedPlacementId = clone.id;
    this.commit({ ...this.course, featurePlacements: [...this.course.featurePlacements, clone] });
  }

  transformSelected(action) {
    const selected = this.selectedPlacement();
    if (!selected) return;
    this.updatePlacement(selected.id, (placement) => {
      if (action === 'flip') placement.anchor.facing *= -1;
      else if (action === 'larger') {
        placement.anchor.scaleX = clamp(placement.anchor.scaleX + 0.05, 0.75, 1.35);
        placement.anchor.scaleY = placement.anchor.scaleX;
      } else if (action === 'smaller') {
        placement.anchor.scaleX = clamp(placement.anchor.scaleX - 0.05, 0.75, 1.35);
        placement.anchor.scaleY = placement.anchor.scaleX;
      } else if (action === 'rotate-left') {
        placement.anchor.rotationOffset = clamp(placement.anchor.rotationOffset - Math.PI / 12, -Math.PI, Math.PI);
      } else if (action === 'rotate-right') {
        placement.anchor.rotationOffset = clamp(placement.anchor.rotationOffset + Math.PI / 12, -Math.PI, Math.PI);
      }
    });
  }

  applyTerrain(kind, x) {
    this.capture();
    const result = applyTrialsTerrainStamp(this.course, { kind, x });
    this.commit(result.course);
  }

  save() {
    this.finishFieldEdit();
    try {
      this.course = this.library.save({
        ...this.course,
        name: this.root.querySelector('[data-field="name"]')?.value || this.course.name,
      });
      this.validation = validateTrialsCourse(this.course);
      this.toast('COURSE SAVED LOCALLY', 'ok');
      this.render();
      return this.course;
    } catch (error) {
      this.toast(error?.message || 'Save failed', 'error');
      return null;
    }
  }

  build({ testFromHere = false } = {}) {
    this.finishFieldEdit();
    this.validation = validateTrialsCourse(this.course);
    this.render();
    if (!this.validation.valid) {
      this.toast(this.validation.errors[0]?.message || 'Course is not ready to run.', 'error');
      return false;
    }
    this.onBuild?.({
      course: this.validation.course,
      testFromX: testFromHere ? this.testFromX : null,
    });
    return true;
  }

  openShare() {
    this.finishFieldEdit();
    const dialog = this.root.querySelector('.ktr-share-dialog');
    try {
      dialog.querySelector('textarea').value = TrialsCourseCodec.encode(this.course);
    } catch (error) {
      this.toast(error?.message || 'Share code failed', 'error');
      return;
    }
    dialog.showModal();
    dialog.querySelector('textarea').select();
  }

  loadCode() {
    const dialog = this.root.querySelector('.ktr-share-dialog');
    try {
      const decoded = TrialsCourseCodec.decode(dialog.querySelector('textarea').value);
      this.capture();
      this.selectedPlacementId = null;
      this.commit(decoded.course);
      this.fitView();
      dialog.close();
      this.toast(decoded.warnings.length ? decoded.warnings[0] : 'KTR1 COURSE LOADED', decoded.warnings.length ? 'warning' : 'ok');
    } catch (error) {
      this.toast(error?.message || 'KTR1 import failed', 'error');
    }
  }

  toast(message, tone = '') {
    const panel = this.root.querySelector('.ktr-validation');
    panel.dataset.toast = tone;
    panel.textContent = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.root?.isConnected) {
        panel.dataset.toast = '';
        panel.textContent = '';
        this.renderValidation();
      }
    }, 1800);
  }

  cancelTool() {
    this.selectedPoint = -1;
    this.pointer = null;
    this.paletteFeatureId = '';
    this.render();
  }

  handleClick(event) {
    const stage = event.target.closest('[data-stage]')?.dataset.stage;
    if (stage) return this.setStage(stage);
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action) {
      if (action === 'undo') this.undo();
      else if (action === 'redo') this.redo();
      else if (action === 'fit') this.fitView();
      else if (action === 'save') this.save();
      else if (action === 'share') this.openShare();
      else if (action === 'exit') this.exit();
      else if (action === 'new-rolling') this.newCourse(true);
      else if (action === 'new-blank') this.newCourse(false);
      else if (action === 'copy-official') this.copyOfficial();
      else if (action === 'delete') this.deleteSelected();
      else if (action === 'duplicate') this.duplicateSelected();
      else if (action === 'flip') this.transformSelected('flip');
      else if (action === 'larger') this.transformSelected('larger');
      else if (action === 'smaller') this.transformSelected('smaller');
      else if (action === 'rotate-left') this.transformSelected('rotate-left');
      else if (action === 'rotate-right') this.transformSelected('rotate-right');
      else if (action === 'run') this.build();
      else if (action === 'test-here') this.build({ testFromHere: true });
      else if (action === 'copy-code') {
        const textarea = this.root.querySelector('.ktr-share-dialog textarea');
        navigator.clipboard?.writeText?.(textarea.value).then(() => this.toast('KTR1 COPIED', 'ok')).catch(() => textarea.select());
      } else if (action === 'load-code') this.loadCode();
      return;
    }
    const terrain = event.target.closest('[data-terrain]')?.dataset.terrain;
    if (terrain) {
      this.terrainTool = terrain;
      this.render();
      return;
    }
    const category = event.target.closest('[data-category]')?.dataset.category;
    if (category) {
      this.featureCategory = category;
      const first = modePalette(this.stage, category)[0];
      if (first) this.paletteFeatureId = first.id;
      this.render();
      return;
    }
    const feature = event.target.closest('[data-feature]')?.dataset.feature;
    if (feature) {
      this.paletteFeatureId = feature;
      this.render();
      return;
    }
    const placement = event.target.closest('[data-placement]')?.dataset.placement;
    if (placement) {
      this.selectedPlacementId = placement;
      this.render();
    }
  }

  handleChange(event) {
    const field = event.target.dataset.field;
    if (['name', 'medalS', 'medalA', 'medalB', 'featureX', 'featureScale'].includes(field)) {
      this.finishFieldEdit(field);
      return;
    }
    this.finishFieldEdit();
    if (field === 'library') {
      const course = this.library.get(event.target.value);
      if (course) {
        this.capture();
        this.commit(course);
        this.fitView();
      }
    } else if (field === 'theme') {
      this.capture();
      this.commit({ ...this.course, themeId: event.target.value });
    } else if (field === 'vehicleSupport') {
      this.capture();
      this.commit({ ...this.course, vehicleSupport: event.target.value });
    }
  }

  handleInput(event) {
    const field = event.target.dataset.field;
    if (field === 'name') {
      this.beginFieldEdit(field);
      this.course.name = event.target.value.slice(0, 48);
      this.root.querySelector('.ktr-course-name').textContent = this.course.name;
    } else if (['medalS', 'medalA', 'medalB'].includes(field)) {
      this.beginFieldEdit(field);
      const key = field.at(-1);
      this.course.medals[key] = Number(event.target.value);
      this.validation = validateTrialsCourse(this.course);
      this.renderValidation();
    } else if (field === 'featureX') {
      const selected = this.selectedPlacement();
      if (selected) {
        this.beginFieldEdit(field);
        const accepted = this.updatePlacement(selected.id, (placement) => {
          placement.anchor.x = clamp(Number(event.target.value), 3, this.course.length - 3);
        }, false, false);
        if (accepted) {
          event.target.parentElement.querySelector('output').textContent = `${this.selectedPlacement().anchor.x.toFixed(1)} M`;
        }
      }
    } else if (field === 'featureScale') {
      const selected = this.selectedPlacement();
      if (selected) {
        this.beginFieldEdit(field);
        const accepted = this.updatePlacement(selected.id, (placement) => {
          placement.anchor.scaleX = clamp(Number(event.target.value), 0.75, 1.35);
          placement.anchor.scaleY = placement.anchor.scaleX;
        }, false, false);
        if (accepted) {
          event.target.parentElement.querySelector('output').textContent = `${featureScale(this.selectedPlacement()).toFixed(2)}×`;
        }
      }
    }
  }

  handleKeydown(event) {
    if (!this.root?.isConnected || event.target.matches('input,textarea,select')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.redo(); else this.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); this.redo();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); this.deleteSelected();
    } else if (event.key.toLowerCase() === 'q') this.transformSelected('rotate-left');
    else if (event.key.toLowerCase() === 'e') this.transformSelected('rotate-right');
    else if (event.key.toLowerCase() === 'r') this.transformSelected('flip');
    else if (event.key === 'Escape') this.cancelTool();
    else if (event.key === 'Home') this.fitView();
    else if (event.key === 'Enter' && this.stage === 'test') this.build({ testFromHere: true });
  }

  newCourse(rolling) {
    this.capture();
    this.selectedPlacementId = null;
    this.commit(createEmptyTrialsCourse({
      seed: Date.now(),
      rolling,
      themeId: this.course.themeId,
    }));
    this.fitView();
  }

  copyOfficial() {
    this.capture();
    const id = this.root.querySelector('[data-field="official-copy"]').value;
    this.selectedPlacementId = null;
    this.commit(duplicateOfficialTrialsCourse(id));
    this.fitView();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, Math.round(rect.width * dpr));
    const height = Math.max(220, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.canvas._cssWidth = rect.width;
      this.canvas._cssHeight = rect.height;
    }
    this.requestDraw();
  }

  terrainBounds() {
    const points = this.course.heightPoints;
    const min = Math.min(...points.map((point) => point.y), 0);
    const max = Math.max(...points.map((point) => point.y), 18);
    return { min: min - 8, max: max + 16 };
  }

  fitView() {
    const bounds = this.terrainBounds();
    this.view = {
      start: -12,
      end: this.course.length + 12,
      minY: bounds.min,
      maxY: bounds.max,
    };
    this.requestDraw();
  }

  focusTestView() {
    const jump = this.validation.jumps.find((entry) => (
      this.testFromX >= entry.startX - 8 && this.testFromX <= entry.endX + 8
    )) || this.validation.jumps[0];
    if (!jump) return this.fitView();
    const center = (jump.startX + jump.endX) * 0.5;
    const span = clamp((jump.endX - jump.startX) + 112, 126, Math.min(260, this.course.length + 24));
    const start = clamp(center - span * 0.5, -12, Math.max(-12, this.course.length - span + 12));
    const heights = [];
    for (let x = Math.max(0, start); x <= Math.min(this.course.length, start + span); x += 3) {
      const ground = sampleTrialsGround(this.course, x);
      if (ground) heights.push(ground.height);
    }
    for (const result of [jump.monster, jump.buggy]) {
      for (const point of result?.points || []) heights.push(point.y);
    }
    const min = Math.min(...heights, 0);
    const max = Math.max(...heights, min + 18);
    this.view = {
      start,
      end: start + span,
      minY: min - 7,
      maxY: Math.max(min + 26, max + 9),
    };
    this.requestDraw();
  }

  worldToScreen(x, y) {
    const width = this.canvas._cssWidth || this.canvas.clientWidth;
    const height = this.canvas._cssHeight || this.canvas.clientHeight;
    const left = 44;
    const right = width - 24;
    const top = 26;
    const bottom = height - 36;
    return {
      x: left + (x - this.view.start) / Math.max(1, this.view.end - this.view.start) * (right - left),
      y: bottom - (y - this.view.minY) / Math.max(1, this.view.maxY - this.view.minY) * (bottom - top),
    };
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const left = 44;
    const right = width - 24;
    const top = 26;
    const bottom = height - 36;
    return {
      x: this.view.start + (sx - left) / Math.max(1, right - left) * (this.view.end - this.view.start),
      y: this.view.minY + (bottom - sy) / Math.max(1, bottom - top) * (this.view.maxY - this.view.minY),
      sx,
      sy,
      nx: clamp(sx / width, 0, 1),
      ny: clamp(sy / height, 0, 1),
    };
  }

  hitPoint(world) {
    let best = -1;
    let distance = 15;
    this.course.heightPoints.forEach((point, index) => {
      const screen = this.worldToScreen(point.x, point.y);
      const d = Math.hypot(screen.x - world.sx, screen.y - world.sy);
      if (d < distance) { distance = d; best = index; }
    });
    return best;
  }

  hitPlacement(world) {
    let best = null;
    let distance = 26;
    for (const placement of this.course.featurePlacements) {
      const ground = sampleTrialsGround(this.course, placement.anchor.x);
      const screen = this.worldToScreen(placement.anchor.x, (ground?.height || 0) + 2.2);
      const d = Math.hypot(screen.x - world.sx, screen.y - world.sy);
      if (d < distance) { distance = d; best = placement; }
    }
    return best;
  }

  pointerDown(event) {
    event.preventDefault();
    if (Number.isFinite(event.pointerId)) {
      try { this.canvas.setPointerCapture?.(event.pointerId); } catch (_) {}
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size >= 2) {
      const values = [...this.pointers.values()];
      this.pointer = {
        mode: 'pinch',
        distance: Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y),
        center: (values[0].x + values[1].x) * 0.5,
        view: { ...this.view },
      };
      return;
    }
    const world = this.screenToWorld(event.clientX, event.clientY);
    this.hoverWorld = world;
    if (event.button === 1 || event.button === 2 || event.altKey) {
      this.pointer = { mode: 'pan', startX: event.clientX, view: { ...this.view } };
      return;
    }
    const placement = this.hitPlacement(world);
    if (placement && this.stage !== 'terrain') {
      this.selectedPlacementId = placement.id;
      this.paletteFeatureId = '';
      this.pointer = {
        mode: 'placement',
        id: placement.id,
        startCourse: cloneCourse(this.course),
        captured: false,
      };
      this.render();
      return;
    }
    if (this.stage === 'terrain') {
      const point = this.hitPoint(world);
      if (point >= 0) {
        this.selectedPoint = point;
        this.pointer = {
          mode: 'point',
          index: point,
          startCourse: cloneCourse(this.course),
          captured: false,
        };
        return;
      }
      this.applyTerrain(this.terrainTool, clamp(world.x, 0, this.course.length));
      return;
    }
    if (this.stage === 'place' || this.stage === 'checkpoints') {
      if (this.paletteFeatureId) this.placeFeature(this.paletteFeatureId, world.x);
      else this.testFromX = clamp(world.x, this.course.spawn.x, this.course.finish);
    } else if (this.stage === 'test') {
      this.testFromX = clamp(world.x, this.course.spawn.x, this.course.finish);
      this.render();
    }
  }

  pointerMove(event) {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.hoverWorld = this.screenToWorld(event.clientX, event.clientY);
    if (!this.pointer) {
      this.requestDraw();
      return;
    }
    if (this.pointer.mode === 'pinch' && this.pointers.size >= 2) {
      const values = [...this.pointers.values()];
      const distance = Math.max(10, Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y));
      const ratio = this.pointer.distance / distance;
      const baseSpan = this.pointer.view.end - this.pointer.view.start;
      const span = clamp(baseSpan * ratio, 90, this.course.length + 80);
      const centerWorld = this.screenToWorld((values[0].x + values[1].x) * 0.5, values[0].y).x;
      this.view.start = clamp(centerWorld - span * 0.5, -40, this.course.length - span + 40);
      this.view.end = this.view.start + span;
      this.requestDraw();
      return;
    }
    if (this.pointer.mode === 'pan') {
      const rect = this.canvas.getBoundingClientRect();
      const span = this.pointer.view.end - this.pointer.view.start;
      const delta = (event.clientX - this.pointer.startX) / Math.max(1, rect.width - 68) * span;
      this.view.start = this.pointer.view.start - delta;
      this.view.end = this.pointer.view.end - delta;
      this.requestDraw();
      return;
    }
    const world = this.screenToWorld(event.clientX, event.clientY);
    if (this.pointer.mode === 'point') {
      const result = moveTrialsControlPoint(
        this.pointer.startCourse,
        this.pointer.index,
        world.x,
        world.y,
      );
      if (!this.pointer.captured) {
        this.pushHistorySnapshot(this.pointer.startCourse);
        this.pointer.captured = true;
      }
      this.commit(result.course);
    } else if (this.pointer.mode === 'placement') {
      const placements = this.pointer.startCourse.featurePlacements.map((placement) => structuredClone(placement));
      const selected = placements.find((placement) => placement.id === this.pointer.id);
      if (!selected) return;
      selected.anchor.x = clamp(world.x, 3, this.course.length - 3);
      const placementValidation = validateTrialsFeaturePlacement(this.pointer.startCourse, {
        featureId: selected.featureId,
        x: selected.anchor.x,
        scale: selected.anchor.scaleX,
        ignorePlacementId: selected.id,
      });
      if (!placementValidation.valid) {
        if (this.pointer.validationMessage !== placementValidation.message) {
          this.pointer.validationMessage = placementValidation.message;
          this.toast(placementValidation.message, 'error');
        }
        return;
      }
      if (!this.pointer.captured) {
        this.pushHistorySnapshot(this.pointer.startCourse);
        this.pointer.captured = true;
      }
      this.commit({
        ...this.pointer.startCourse,
        finish: selected.featureId === 'trials-finish-gate' ? selected.anchor.x : this.pointer.startCourse.finish,
        featurePlacements: placements,
      });
    }
  }

  pointerUp(event) {
    this.pointers.delete(event.pointerId);
    if (this.pointer?.mode === 'pinch' && this.pointers.size === 1) {
      this.pointer = null;
      return;
    }
    if (!this.pointers.size) this.pointer = null;
  }

  wheel(event) {
    event.preventDefault();
    const world = this.screenToWorld(event.clientX, event.clientY);
    const span = this.view.end - this.view.start;
    const nextSpan = clamp(span * Math.exp(event.deltaY * 0.0012), 90, this.course.length + 100);
    const fraction = (world.x - this.view.start) / span;
    this.view.start = world.x - nextSpan * fraction;
    this.view.end = this.view.start + nextSpan;
    this.requestDraw();
  }

  pollController(time) {
    if (!this.root?.isConnected) return;
    const pad = navigator.getGamepads?.()?.find(Boolean);
    if (pad) {
      const dt = clamp((time - (this.lastControllerTime || time)) / 1000, 0, 0.05);
      this.lastControllerTime = time;
      const dead = (value) => Math.abs(value) > 0.16 ? value : 0;
      const x = dead(pad.axes[0] || 0);
      const y = dead(pad.axes[1] || 0);
      if (x || y) {
        this.controllerCursor.visible = true;
        this.controllerCursor.x = clamp(this.controllerCursor.x + x * dt * 0.48, 0.03, 0.97);
        this.controllerCursor.y = clamp(this.controllerCursor.y + y * dt * 0.48, 0.04, 0.96);
        const rect = this.canvas.getBoundingClientRect();
        this.hoverWorld = this.screenToWorld(
          rect.left + rect.width * this.controllerCursor.x,
          rect.top + rect.height * this.controllerCursor.y,
        );
        this.requestDraw();
      }
      const pressed = (index) => !!pad.buttons[index]?.pressed;
      const edge = (index) => pressed(index) && !this.lastGamepad.buttons[index];
      if (edge(0)) {
        const rect = this.canvas.getBoundingClientRect();
        this.pointerDown({
          preventDefault() {},
          button: 0,
          pointerId: 990,
          clientX: rect.left + rect.width * this.controllerCursor.x,
          clientY: rect.top + rect.height * this.controllerCursor.y,
        });
        this.pointerUp({ pointerId: 990 });
      }
      if (edge(1)) this.cancelTool();
      if (edge(2)) this.deleteSelected();
      if (edge(3)) this.duplicateSelected();
      if (edge(4)) this.cycleCategory(-1);
      if (edge(5)) this.cycleCategory(1);
      if (edge(14)) this.nudgeSelected(-3);
      if (edge(15)) this.nudgeSelected(3);
      if (edge(12)) this.transformSelected('rotate-left');
      if (edge(13)) this.transformSelected('rotate-right');
      const trigger = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0);
      if (Math.abs(trigger) > 0.55 && Math.abs(this.lastGamepad.trigger) <= 0.55) {
        this.transformSelected(trigger > 0 ? 'larger' : 'smaller');
      }
      this.lastGamepad = { buttons: pad.buttons.map((button) => button.pressed), trigger };
    }
    this._controllerFrame = requestAnimationFrame((next) => this.pollController(next));
  }

  nudgeSelected(delta) {
    const selected = this.selectedPlacement();
    if (selected) this.updatePlacement(selected.id, (placement) => {
      placement.anchor.x = clamp(placement.anchor.x + delta, 3, this.course.length - 3);
    });
  }

  cycleCategory(direction) {
    const values = COURSE_FEATURE_CATEGORIES
      .filter((category) => modePalette(this.stage, category.id).length);
    const index = values.findIndex((category) => category.id === this.featureCategory);
    const next = values[(index + direction + values.length) % values.length];
    if (!next) return;
    this.featureCategory = next.id;
    this.paletteFeatureId = modePalette(this.stage, next.id)[0]?.id || '';
    this.render();
  }

  render() {
    if (!this.root?.isConnected) return;
    this.root.dataset.stage = this.stage;
    this.root.querySelectorAll('[data-stage]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.stage === this.stage);
    });
    this.root.querySelector('.ktr-course-name').textContent = this.course.name;
    this.renderLibrary();
    this.renderPanel();
    this.renderBench();
    this.renderValidation();
    this.requestDraw();
  }

  renderLibrary() {
    const select = this.root.querySelector('[data-field="library"]');
    const courses = this.library.list();
    select.innerHTML = `<option value="">OPEN SAVED…</option>${courses.map((course) => (
      `<option value="${escapeHtml(course.id)}"${course.id === this.course.id ? ' selected' : ''}>${escapeHtml(course.name)} · ${Math.round(course.length)}M</option>`
    )).join('')}`;
  }

  renderPanel() {
    const panel = this.root.querySelector('.ktr-panel');
    const selected = this.selectedPlacement();
    if (this.stage === 'terrain') {
      panel.innerHTML = `
        <header><span>TERRAIN STAMPS</span><strong>SCULPT THE PROFILE</strong></header>
        <div class="ktr-terrain-tools">
          ${TRIALS_TERRAIN_TOOLS.map((tool) => `<button type="button" data-terrain="${tool.id}" class="${this.terrainTool === tool.id ? 'is-selected' : ''}"><i>${tool.id === 'gap' ? '⌁' : tool.id === 'smooth' ? '≈' : '⌃'}</i><span>${tool.label}</span><em>${tool.width} M BRUSH</em></button>`).join('')}
        </div>
        <p class="ktr-help">Tap empty terrain to stamp. Drag white control points to reshape. The sanitizer enforces 2.5 m spacing and prevents impossible vertical walls.</p>`;
    } else if (this.stage === 'goals') {
      panel.innerHTML = `
        <header><span>GOALS</span><strong>MEDALS & VEHICLES</strong></header>
        <label><span>COURSE NAME</span><input data-field="name" value="${escapeHtml(this.course.name)}" maxlength="48"></label>
        <label><span>WORLD</span><select data-field="theme"><option value="meadow"${this.course.themeId === 'meadow' ? ' selected' : ''}>MEADOW</option><option value="quarry"${this.course.themeId === 'quarry' ? ' selected' : ''}>QUARRY</option><option value="crown"${this.course.themeId === 'crown' ? ' selected' : ''}>CROWN CLOUDWAY</option></select></label>
        <label><span>VALIDATE FOR</span><select data-field="vehicleSupport"><option value="both"${this.course.vehicleSupport === 'both' ? ' selected' : ''}>MONSTER + BUGGY</option><option value="monster"${this.course.vehicleSupport === 'monster' ? ' selected' : ''}>MONSTER TRUCK</option><option value="buggy"${this.course.vehicleSupport === 'buggy' ? ' selected' : ''}>RALLY BUGGY</option></select></label>
        <div class="ktr-medals">
          <label><span>S MEDAL</span><input type="number" min="12" max="900" step="1" data-field="medalS" value="${this.course.medals.S}"><em>SEC</em></label>
          <label><span>A MEDAL</span><input type="number" min="13" max="1200" step="1" data-field="medalA" value="${this.course.medals.A}"><em>SEC</em></label>
          <label><span>B MEDAL</span><input type="number" min="14" max="1800" step="1" data-field="medalB" value="${this.course.medals.B}"><em>SEC</em></label>
        </div>`;
    } else if (this.stage === 'test') {
      const jump = this.validation.jumps.find((entry) => (
        selected ? entry.id === selected.id : this.testFromX >= entry.startX - 5 && this.testFromX <= entry.endX + 5
      )) || this.validation.jumps[0];
      panel.innerHTML = `
        <header><span>TEST / RUN</span><strong>PHYSICS CHECK</strong></header>
        <div class="ktr-test-readout"><span>TEST START</span><strong>${this.testFromX.toFixed(1)} M</strong><p>Tap the terrain to move the test spawn. Test runs do not write personal-best records.</p></div>
        ${jump ? this.jumpReadout(jump) : '<p class="ktr-help">Place a ramp or gap to see separate monster-truck and buggy trajectory checks.</p>'}
        <button type="button" class="ktr-run is-test" data-action="test-here">TEST FROM HERE</button>
        <button type="button" class="ktr-run" data-action="run">RUN FULL COURSE</button>`;
    } else {
      panel.innerHTML = `
        <header><span>${this.stage === 'checkpoints' ? 'COURSE OBJECTS' : 'PLACEMENT'}</span><strong>${selected ? escapeHtml(placementLabel(selected)) : 'SELECT A STAMP'}</strong></header>
        ${selected ? `
          <div class="ktr-selected-card">
            <div class="ktr-feature-thumb" style="${featureThumbnailStyle(getCourseFeature(selected.featureId))}"></div>
            <span>${escapeHtml(placementLabel(selected))}</span><em>${selected.anchor.x.toFixed(1)} M · ${featureScale(selected).toFixed(2)}×</em>
          </div>
          <label><span>COURSE X</span><input type="range" min="3" max="${this.course.length - 3}" step=".5" data-field="featureX" value="${selected.anchor.x}"><output>${selected.anchor.x.toFixed(1)} M</output></label>
          <label><span>SIZE</span><input type="range" min=".75" max="1.35" step=".05" data-field="featureScale" value="${featureScale(selected)}"><output>${featureScale(selected).toFixed(2)}×</output></label>
          <div class="ktr-transform-grid"><button data-action="rotate-left">Q · ROTATE −</button><button data-action="rotate-right">E · ROTATE +</button><button data-action="flip">R · FLIP</button><button data-action="smaller">− SIZE</button><button data-action="larger">+ SIZE</button><button data-action="duplicate">DUPLICATE</button><button data-action="delete" class="is-danger">DELETE</button></div>
        ` : '<p class="ktr-help">Choose a final-asset stamp below, then tap the terrain. Drag placed objects to move them.</p>'}`;
    }
  }

  jumpReadout(jump) {
    const row = (result, label) => `
      <article class="${result.possible ? result.safe ? 'is-safe' : 'is-warning' : 'is-invalid'}">
        <span>${label}</span><strong>${Number.isFinite(result.requiredSpeed) ? `${(result.requiredSpeed * 5).toFixed(0)} KM/H` : 'IMPOSSIBLE'}</strong>
        <em>${result.message} · LAND ${(result.landingSafety * 100 || 0).toFixed(0)}%${result.turboRequired ? ' · TURBO' : ''}</em>
      </article>`;
    return `<section class="ktr-jump-report"><header><span>${escapeHtml(jump.label)}</span><strong>${(jump.endX - jump.startX).toFixed(1)} M WINDOW</strong></header>${row(jump.monster, 'MONSTER')}${row(jump.buggy, 'BUGGY')}</section>`;
  }

  renderBench() {
    const bench = this.root.querySelector('.ktr-bench');
    if (!['place', 'checkpoints'].includes(this.stage)) {
      bench.hidden = true;
      bench.innerHTML = '';
      return;
    }
    bench.hidden = false;
    const categories = COURSE_FEATURE_CATEGORIES.filter((category) => modePalette(this.stage, category.id).length);
    if (!modePalette(this.stage, this.featureCategory).length) this.featureCategory = categories[0]?.id || '';
    const features = modePalette(this.stage, this.featureCategory);
    bench.innerHTML = `
      <nav>${categories.map((category) => `<button type="button" data-category="${category.id}" class="${this.featureCategory === category.id ? 'is-active' : ''}">${category.shortLabel}</button>`).join('')}</nav>
      <div class="ktr-palette">${features.map((feature) => `
        <button type="button" data-feature="${feature.id}" class="${this.paletteFeatureId === feature.id ? 'is-selected' : ''}">
          <i class="ktr-feature-thumb" style="${featureThumbnailStyle(feature)}"></i><span>${escapeHtml(feature.label)}</span>
        </button>`).join('')}</div>`;
  }

  renderValidation() {
    const panel = this.root.querySelector('.ktr-validation');
    if (panel.dataset.toast && panel.textContent) return;
    panel.dataset.toast = '';
    const first = this.validation.issues[0];
    panel.className = `ktr-validation ${this.validation.valid ? 'is-valid' : 'is-invalid'}`;
    panel.innerHTML = `<strong>${this.validation.valid ? 'COURSE READY' : `${this.validation.errors.length} BLOCKER${this.validation.errors.length === 1 ? '' : 'S'}`}</strong><span>${escapeHtml(first?.message || `${this.validation.stats.length.toFixed(0)} m · ${this.validation.stats.gaps} gaps · ${this.validation.stats.features} stamps`)}</span>`;
  }

  requestDraw() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  drawFeatureThumbnail(feature, screen, size, alpha = 1) {
    if (!feature || !this.atlas.complete || !this.atlas.naturalWidth) return false;
    const cellW = this.atlas.naturalWidth / 7;
    const cellH = this.atlas.naturalHeight / 6;
    const frame = Math.max(0, Number(feature.previewFrame) || 0);
    const sx = (frame % 7) * cellW;
    const sy = Math.floor(frame / 7) * cellH;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.atlas, sx, sy, cellW, cellH, screen.x - size * 0.67, screen.y - size * 0.72, size * 1.34, size);
    this.ctx.restore();
    return true;
  }

  drawTrajectory(jump, color, result) {
    if (!result?.points?.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    result.points.forEach((point, index) => {
      const screen = this.worldToScreen(point.x, point.y);
      if (!index) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    const landing = this.worldToScreen(result.points.at(-1).x, result.points.at(-1).y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(landing.x - 8, landing.y - 5, 16, 10);
    ctx.restore();
  }

  placementPreview() {
    if (
      !['place', 'checkpoints'].includes(this.stage)
      || !this.paletteFeatureId
      || !this.hoverWorld
    ) return null;
    const feature = getCourseFeature(this.paletteFeatureId);
    if (!feature) return null;
    const existingFinish = feature.id === 'trials-finish-gate'
      ? this.course.featurePlacements.find((placement) => placement.featureId === feature.id)
      : null;
    const result = validateTrialsFeaturePlacement(this.course, {
      featureId: feature.id,
      x: this.hoverWorld.x,
      ignorePlacementId: existingFinish?.id || '',
    });
    const key = `${feature.id}:${Math.round(this.hoverWorld.x * 2)}:${this.course.featurePlacements.length}`;
    if (this.previewCache?.key !== key) {
      let jump = null;
      if (result.valid && feature.category === 'jumps' && result.placement) {
        const previewCourse = sanitizeTrialsCourse({
          ...this.course,
          featurePlacements: [...this.course.featurePlacements, result.placement],
        }).course;
        jump = validateTrialsCourse(previewCourse).jumps.find((entry) => entry.id === result.placement.id) || null;
      }
      this.previewCache = { key, jump };
    }
    return {
      feature,
      result,
      jump: this.previewCache?.jump || null,
      x: this.hoverWorld.x,
    };
  }

  draw() {
    if (!this.ctx || !this.canvas.width) return;
    const ctx = this.ctx;
    const width = this.canvas._cssWidth || this.canvas.clientWidth;
    const height = this.canvas._cssHeight || this.canvas.clientHeight;
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, this.course.themeId === 'crown' ? '#432f68' : this.course.themeId === 'quarry' ? '#263640' : '#24606b');
    gradient.addColorStop(0.56, this.course.themeId === 'crown' ? '#b76f9d' : this.course.themeId === 'quarry' ? '#66757b' : '#86c9bd');
    gradient.addColorStop(1, '#16191e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = '#d8fff2';
    ctx.lineWidth = 1;
    const meterStep = this.view.end - this.view.start > 900 ? 100 : this.view.end - this.view.start > 420 ? 50 : 25;
    for (let x = Math.ceil(this.view.start / meterStep) * meterStep; x <= this.view.end; x += meterStep) {
      const screen = this.worldToScreen(x, 0);
      ctx.beginPath(); ctx.moveTo(screen.x, 18); ctx.lineTo(screen.x, height - 30); ctx.stroke();
      ctx.fillStyle = '#e8fff8'; ctx.fillText(`${x}m`, screen.x + 4, height - 14);
    }
    ctx.globalAlpha = 1;
    for (const gap of this.course.gaps) {
      const a = this.worldToScreen(gap.start, this.view.minY);
      const b = this.worldToScreen(gap.end, this.view.maxY);
      ctx.fillStyle = 'rgba(13,9,24,.72)';
      ctx.fillRect(a.x, b.y, b.x - a.x, a.y - b.y);
      ctx.strokeStyle = '#ff76a9'; ctx.lineWidth = 2;
      ctx.strokeRect(a.x, b.y, b.x - a.x, a.y - b.y);
      ctx.fillStyle = '#ffd4e4'; ctx.font = '700 10px system-ui';
      ctx.fillText(gap.label.toUpperCase(), a.x + 6, b.y + 16);
    }
    const sampled = [];
    const step = Math.max(1, (this.view.end - this.view.start) / Math.max(180, width * 0.75));
    for (let x = Math.max(0, this.view.start); x <= Math.min(this.course.length, this.view.end); x += step) {
      const ground = sampleTrialsGround(this.course, x);
      sampled.push(ground ? { x, y: ground.height } : null);
    }
    let run = [];
    const drawRun = (points) => {
      if (points.length < 2) return;
      ctx.beginPath();
      const first = this.worldToScreen(points[0].x, this.view.minY);
      ctx.moveTo(first.x, first.y);
      for (const point of points) {
        const screen = this.worldToScreen(point.x, point.y);
        ctx.lineTo(screen.x, screen.y);
      }
      const last = this.worldToScreen(points.at(-1).x, this.view.minY);
      ctx.lineTo(last.x, last.y);
      ctx.closePath();
      const terrain = ctx.createLinearGradient(0, 70, 0, height);
      terrain.addColorStop(0, this.course.themeId === 'quarry' ? '#819397' : this.course.themeId === 'crown' ? '#bc80aa' : '#87b06a');
      terrain.addColorStop(1, this.course.themeId === 'quarry' ? '#2c3339' : this.course.themeId === 'crown' ? '#4c3f66' : '#354b36');
      ctx.fillStyle = terrain; ctx.fill();
      ctx.beginPath();
      points.forEach((point, index) => {
        const screen = this.worldToScreen(point.x, point.y);
        if (!index) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
      });
      ctx.strokeStyle = '#f6d69a'; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.strokeStyle = '#fff8de'; ctx.lineWidth = 2; ctx.stroke();
    };
    for (const point of [...sampled, null]) {
      if (point) run.push(point);
      else { drawRun(run); run = []; }
    }
    if (this.stage === 'terrain') {
      for (let index = 0; index < this.course.heightPoints.length; index++) {
        const point = this.course.heightPoints[index];
        const screen = this.worldToScreen(point.x, point.y);
        ctx.beginPath(); ctx.arc(screen.x, screen.y, index === this.selectedPoint ? 8 : 5, 0, Math.PI * 2);
        ctx.fillStyle = index === this.selectedPoint ? '#ffcf56' : '#fffaf0'; ctx.fill();
        ctx.strokeStyle = '#2a1e2e'; ctx.lineWidth = 2; ctx.stroke();
      }
    }
    const preview = this.placementPreview();
    if (preview) {
      const centerGround = sampleTrialsGround(this.course, preview.x);
      const groundHeight = centerGround?.height ?? this.view.minY + 2;
      const center = this.worldToScreen(
        preview.x,
        groundHeight + Math.min(5, preview.feature.footprint.clearanceHeight * 0.42),
      );
      const start = this.worldToScreen(preview.result.startX ?? preview.x, groundHeight);
      const end = this.worldToScreen(preview.result.endX ?? preview.x, groundHeight);
      const color = !preview.result.valid
        ? '#ff806f'
        : preview.result.status === 'warning' ? '#ffd166' : '#72f2bd';
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = `${color}22`;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(start.x, center.y - 5, Math.max(2, end.x - start.x), 16);
      ctx.strokeRect(start.x, center.y - 5, Math.max(2, end.x - start.x), 16);
      ctx.setLineDash([]);
      this.drawFeatureThumbnail(preview.feature, center, 54, preview.result.valid ? 0.62 : 0.38);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y + 13);
      ctx.lineTo(center.x + 25, center.y + 13);
      ctx.lineTo(center.x + 19, center.y + 9);
      ctx.moveTo(center.x + 25, center.y + 13);
      ctx.lineTo(center.x + 19, center.y + 17);
      ctx.stroke();
      ctx.font = '800 9px ui-monospace, monospace';
      const message = preview.result.message.toUpperCase();
      const labelWidth = Math.min(310, Math.max(110, ctx.measureText(message).width + 18));
      const labelX = clamp(center.x - labelWidth * 0.5, 8, width - labelWidth - 8);
      const labelY = clamp(center.y - 64, 28, height - 42);
      ctx.fillStyle = 'rgba(4,14,15,.9)';
      ctx.fillRect(labelX, labelY, labelWidth, 24);
      ctx.strokeStyle = color;
      ctx.strokeRect(labelX, labelY, labelWidth, 24);
      ctx.fillStyle = color;
      ctx.fillText(message.slice(0, 48), labelX + 9, labelY + 15);
      ctx.restore();
      if (preview.jump) {
        this.drawTrajectory(preview.jump, '#ffd166', preview.jump.monster);
        this.drawTrajectory(preview.jump, '#73f2ff', preview.jump.buggy);
      }
    }
    for (const placement of this.course.featurePlacements) {
      const feature = getCourseFeature(placement.featureId);
      const ground = sampleTrialsGround(this.course, placement.anchor.x);
      const screen = this.worldToScreen(placement.anchor.x, (ground?.height || 0) + Math.min(5, feature?.footprint.clearanceHeight * 0.42 || 1.5));
      const selected = placement.id === this.selectedPlacementId;
      const size = clamp(44 * featureScale(placement), 34, 68);
      this.drawFeatureThumbnail(feature, screen, size, selected ? 1 : 0.86);
      if (selected) {
        ctx.strokeStyle = '#71ffd0'; ctx.lineWidth = 3;
        ctx.strokeRect(screen.x - size * 0.72, screen.y - size * 0.78, size * 1.44, size * 1.08);
        ctx.beginPath(); ctx.moveTo(screen.x, screen.y + 12); ctx.lineTo(screen.x + (placement.anchor.facing < 0 ? -22 : 22), screen.y + 12);
        ctx.stroke();
      }
    }
    const spawnGround = sampleTrialsGround(this.course, this.course.spawn.x);
    if (spawnGround) {
      const spawn = this.worldToScreen(this.course.spawn.x, spawnGround.height);
      ctx.strokeStyle = '#88ffe0'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(spawn.x, spawn.y); ctx.lineTo(spawn.x, spawn.y - 44); ctx.stroke();
      ctx.fillStyle = '#88ffe0'; ctx.fillText('START', spawn.x + 5, spawn.y - 32);
    }
    const testGround = sampleTrialsGround(this.course, this.testFromX);
    if (testGround) {
      const test = this.worldToScreen(this.testFromX, testGround.height);
      ctx.fillStyle = '#ffcf56'; ctx.beginPath(); ctx.moveTo(test.x, test.y - 18); ctx.lineTo(test.x - 7, test.y - 30); ctx.lineTo(test.x + 7, test.y - 30); ctx.closePath(); ctx.fill();
    }
    if (this.stage === 'test' || this.selectedPlacement()) {
      const jump = this.validation.jumps.find((entry) => entry.id === this.selectedPlacementId)
        || this.validation.jumps.find((entry) => this.testFromX >= entry.startX - 5 && this.testFromX <= entry.endX + 5)
        || this.validation.jumps[0];
      if (jump) {
        this.drawTrajectory(jump, '#ffcf56', jump.monster);
        this.drawTrajectory(jump, '#73f2ff', jump.buggy);
      }
    }
    if (this.controllerCursor.visible) {
      ctx.save();
      ctx.translate(width * this.controllerCursor.x, height * this.controllerCursor.y);
      ctx.strokeStyle = '#fff8de'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.moveTo(0, -15); ctx.lineTo(0, 15); ctx.stroke();
      ctx.restore();
    }
    this.root.querySelector('.ktr-scale strong').textContent = `${Math.round(this.view.end - this.view.start)} M VIEW · COURSE ${Math.round(this.course.length)} M`;
  }

  exit() {
    this.dispose();
    this.onExit?.();
  }

  dispose() {
    clearTimeout(this.toastTimer);
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this._controllerFrame);
    this.resizeObserver?.disconnect();
    this.root?.removeEventListener('click', this._click);
    this.root?.removeEventListener('change', this._change);
    this.root?.removeEventListener('input', this._input);
    this.root?.removeEventListener('focusout', this._focusOut);
    window.removeEventListener('keydown', this._keydown);
    this.canvas?.removeEventListener('pointerdown', this._pointerDown);
    this.canvas?.removeEventListener('pointermove', this._pointerMove);
    this.canvas?.removeEventListener('pointerup', this._pointerUp);
    this.canvas?.removeEventListener('pointercancel', this._pointerUp);
    this.canvas?.removeEventListener('pointerleave', this._pointerLeave);
    this.canvas?.removeEventListener('contextmenu', this._contextMenu);
    this.canvas?.removeEventListener('wheel', this._wheel);
    this.root?.remove();
    document.body.classList.remove('ktr-open');
    if (window.__ktrEditor === this) delete window.__ktrEditor;
  }
}

let activeEditor = null;

export function openTrialsWorkshop(options = {}) {
  activeEditor?.dispose();
  activeEditor = new TrialsWorkshopEditor(options);
  return activeEditor;
}

export function closeTrialsWorkshop() {
  activeEditor?.dispose();
  activeEditor = null;
}
