/** Full-screen drafting-table UI for Draw Your Track. */
import {
  StrokeSampler,
  TrackRepair,
  TrackSpline,
  TrackValidator,
  TRACK_SIZE_PRESETS,
  TRACK_WIDTH_PRESETS,
  DEFAULT_LAYOUT_TRANSFORM,
  applyLayoutToPoint,
  createCanonicalTrackLayout,
  invertLayoutPoint,
  nearestSplineFraction,
  resampleClosedSpline,
  sanitizeLayoutTransform,
} from './drawTrackGeometry.js';
import {
  DRAW_TRACK_THEMES,
  DRAW_TRACK_THEME_ORDER,
  compileDrawTrackCourse,
  createDrawTrackId,
  proceduralTrackName,
} from './drawTrackThemes.js';
import {
  TrackCodeCodec,
  TrackGallery,
} from './drawTrackStorage.js';
import {
  BRIDGE_PRESETS,
  CROSSING_OVERRIDE_MODES,
  createCrossingOverride,
  crossingAngleDegrees,
  crossingGradePercent,
  sanitizeCrossingOverrides,
} from './drawTrackCrossings.js';
import {
  COURSE_FEATURE_CATEGORIES,
  COURSE_FEATURE_THUMBNAIL_ATLAS,
  getCourseFeature,
  listCourseFeatures,
} from './courseFeatureCatalog.js';
import {
  circuitRuntimeFraction,
  createCourseFeaturePlacementId,
  sanitizeCourseFeaturePlacements,
} from './courseFeaturePlacement.js';
import { validateCircuitFeaturePlacement } from './courseFeatureValidation.js';

const STYLE_ID = 'kdt-editor-style';
const STYLE_URL = new URL('./drawTrack.css?v=20260727workshop1', import.meta.url).href;
const FEATURE_ATLAS_URL = new URL(`../../${COURSE_FEATURE_THUMBNAIL_ATLAS}`, import.meta.url).href;
const WIDTH_ORDER = Object.keys(TRACK_WIDTH_PRESETS);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function seededUnit(seed, ordinal) {
  let value = ((Number(seed) >>> 0) ^ Math.imul((ordinal + 1) >>> 0, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return (value >>> 0) / 0x100000000;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function formatTime(seconds) {
  if (!(seconds > 0)) return '—';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = STYLE_URL;
  document.head.appendChild(link);
}

function defaultDraft(initial = {}) {
  const now = Date.now();
  const seed = (Number(initial.seed) || now) >>> 0;
  let raw = (initial.rawStroke?.length ? initial.rawStroke : initial.controlPoints || [])
    .map((point) => ({ x: point.x, y: point.y }));
  let controls = (initial.controlPoints || raw).map((point) => ({ x: point.x, y: point.y }));
  let layoutTransform = initial.layoutTransform?.version >= 1
    ? sanitizeLayoutTransform(initial.layoutTransform)
    : null;
  if (!layoutTransform && controls.length >= 6) {
    const migrated = createCanonicalTrackLayout(raw, controls, initial.sizeId || 'club');
    raw = migrated.rawPoints;
    controls = migrated.controlPoints;
    layoutTransform = migrated.layoutTransform;
  }
  const features = sanitizeCourseFeaturePlacements(initial.featurePlacements, { mode: 'spline' });
  return {
    id: initial.id || createDrawTrackId(seed),
    name: initial.name || '',
    themeId: DRAW_TRACK_THEMES[initial.themeId] ? initial.themeId : 'countryside',
    sizeId: TRACK_SIZE_PRESETS[initial.sizeId] ? initial.sizeId : 'club',
    widthId: TRACK_WIDTH_PRESETS[initial.widthId] ? initial.widthId : 'standard',
    seed,
    smoothing: clamp(Number(initial.smoothing) || 0.55, 0, 1),
    layoutTransform: layoutTransform || { ...DEFAULT_LAYOUT_TRANSFORM },
    startFraction: clamp(Number(initial.startFraction) || 0, 0, 0.999999),
    reverse: !!initial.reverse,
    modifiers: { boostPads: true, ...(initial.modifiers || {}) },
    crossingOverrides: sanitizeCrossingOverrides(initial.crossingOverrides),
    featurePlacements: features.placements,
    dataWarnings: features.warnings,
    laps: Number(initial.laps) || null,
    rawStroke: raw,
    controlPoints: controls,
    favorite: !!initial.favorite,
    createdAt: initial.createdAt,
    updatedAt: initial.updatedAt,
    raceCount: initial.raceCount || 0,
    bestLap: initial.bestLap || null,
    ghost: initial.ghost || null,
  };
}

function pointPath(points, width = 320, height = 180, padding = 16) {
  if (!points?.length) return '';
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (width - padding * 2) / Math.max(0.02, maxX - minX),
    (height - padding * 2) / Math.max(0.02, maxY - minY),
  );
  const offsetX = (width - (maxX - minX) * scale) * 0.5;
  const offsetY = (height - (maxY - minY) * scale) * 0.5;
  return points.map((point, index) => `${index ? 'L' : 'M'}${(offsetX + (point.x - minX) * scale).toFixed(1)},${(offsetY + (point.y - minY) * scale).toFixed(1)}`).join(' ') + ' Z';
}

function pointsBounds(points) {
  if (!points?.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
  }
  return {
    minX, minY, maxX, maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function circularIndexDistance(a, b, count) {
  const direct = Math.abs(a - b);
  return Math.min(direct, count - direct);
}

function circularFractionDistance(a, b) {
  const direct = Math.abs(Number(a) - Number(b));
  return Math.min(direct, 1 - direct);
}

function featureThumbnailStyle(feature) {
  const column = feature.previewFrame % 7;
  const row = Math.floor(feature.previewFrame / 7);
  return `--feature-atlas:url('${FEATURE_ATLAS_URL}');--feature-col:${column};--feature-row:${row}`;
}

function featureCardHtml(feature) {
  return `<button type="button" class="kdt-feature-card" data-feature-id="${escapeHtml(feature.id)}" title="${escapeHtml(feature.label)}">
    <i style="${featureThumbnailStyle(feature)}" aria-hidden="true"></i>
    <span>${escapeHtml(feature.label)}</span>
  </button>`;
}

export class TrackDrawingInput {
  constructor(ui, canvas) {
    this.ui = ui;
    this.canvas = canvas;
    this.pointers = new Map();
    this.mode = '';
    this.lastPan = null;
    this.pinch = null;
    this.spacePan = false;
    this._bind();
  }

  _bind() {
    this.onPointerDown = (event) => this.pointerDown(event);
    this.onPointerMove = (event) => this.pointerMove(event);
    this.onPointerUp = (event) => this.pointerUp(event);
    this.onContextMenu = (event) => event.preventDefault();
    this.onWheel = (event) => this.wheel(event);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }

  pointerDown(event) {
    event.preventDefault();
    try {
      this.canvas.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Synthetic pointer streams and a few mobile browsers can reject capture
      // even though the pointer itself is valid. Drawing must still continue.
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    if (this.pointers.size >= 2) {
      this.ui.cancelActiveStroke();
      const values = [...this.pointers.values()];
      this.mode = 'pinch';
      this.pinch = {
        distance: Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y),
        zoom: this.ui.view.zoom,
        panX: this.ui.view.panX,
        panY: this.ui.view.panY,
        centerX: (values[0].x + values[1].x) * 0.5,
        centerY: (values[0].y + values[1].y) * 0.5,
      };
      return;
    }
    const local = this.ui.eventPoint(event);
    if (this.ui.editorStage === 'place' && this.ui.closed) {
      if (event.button === 2) {
        this.mode = '';
        this.ui.cancelFeatureTool();
        return;
      }
      this.mode = 'feature';
      this.ui.beginFeaturePointer(local, {
        repeat: event.shiftKey,
        pointerType: event.pointerType,
      });
      return;
    }
    if (this.ui.startMoveArmed || this.ui.hitStartMarker(local)) {
      this.mode = 'start';
      this.ui.beginMoveStart(local);
      return;
    }
    if (event.button === 2 || event.altKey) {
      this.mode = 'erase';
      this.ui.beginErase(local);
      return;
    }
    if (this.spacePan || event.button === 1) {
      this.mode = 'pan';
      this.lastPan = { x: event.clientX, y: event.clientY };
      return;
    }
    if (this.ui.closed) {
      const crossing = this.ui.hitCrossing(local);
      if (crossing) {
        this.mode = 'crossing';
        this.ui.selectCrossing(crossing);
        return;
      }
      const handle = this.ui.hitLayoutHandle(local);
      if (handle) {
        this.mode = 'transform';
        this.ui.beginLayoutTransform(handle, local);
        return;
      }
      if (this.ui.hitTrack(local)) {
        this.mode = 'deform';
        this.ui.beginDeform(local);
        return;
      }
      this.ui.toast('Drag the road to reshape it · pull a handle to stretch');
      return;
    }
    this.mode = 'draw';
    this.ui.beginStroke(local, event.pointerType);
  }

  pointerMove(event) {
    if (this.pointers.has(event.pointerId)) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const values = [...this.pointers.values()];
      const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      const centerX = (values[0].x + values[1].x) * 0.5;
      const centerY = (values[0].y + values[1].y) * 0.5;
      const limits = this.ui.zoomLimits();
      this.ui.view.zoom = clamp(
        this.pinch.zoom * distance / Math.max(10, this.pinch.distance),
        limits.min,
        limits.max,
      );
      this.ui.view.panX = this.pinch.panX + centerX - this.pinch.centerX;
      this.ui.view.panY = this.pinch.panY + centerY - this.pinch.centerY;
      this.ui.requestDraw();
      return;
    }
    if (this.mode === 'pan' && this.lastPan) {
      this.ui.view.panX += event.clientX - this.lastPan.x;
      this.ui.view.panY += event.clientY - this.lastPan.y;
      this.lastPan = { x: event.clientX, y: event.clientY };
      this.ui.requestDraw();
      return;
    }
    const local = this.ui.eventPoint(event);
    if (this.mode === 'draw') this.ui.extendStroke(local);
    else if (this.mode === 'erase') this.ui.eraseAt(local);
    else if (this.mode === 'start') this.ui.moveStart(local);
    else if (this.mode === 'deform') this.ui.updateDeform(local);
    else if (this.mode === 'transform') this.ui.updateLayoutTransform(local);
    else if (this.mode === 'feature') this.ui.updateFeaturePointer(local);
    else {
      if (this.ui.editorStage === 'place') this.ui.updatePlacementGhost(local);
      this.ui.setHover(local);
    }
  }

  pointerUp(event) {
    this.pointers.delete(event.pointerId);
    if (this.mode === 'pinch' && this.pointers.size) return;
    if (this.mode === 'draw') this.ui.endStroke();
    if (this.mode === 'erase') this.ui.endErase();
    if (this.mode === 'start') this.ui.endMoveStart();
    if (this.mode === 'deform') this.ui.endDeform();
    if (this.mode === 'transform') this.ui.endLayoutTransform();
    if (this.mode === 'feature') this.ui.endFeaturePointer();
    this.mode = '';
    this.pinch = null;
    this.lastPan = null;
  }

  wheel(event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const limits = this.ui.zoomLimits();
      this.ui.view.zoom = clamp(
        this.ui.view.zoom * (event.deltaY > 0 ? 0.9 : 1.1),
        limits.min,
        limits.max,
      );
      this.ui.requestDraw();
      return;
    }
    if (this.ui.editorStage === 'place') {
      this.ui.scaleSelectedFeature(event.deltaY > 0 ? -1 : 1);
      return;
    }
    this.ui.stepWidth(event.deltaY > 0 ? -1 : 1);
  }
}

export class DrawTrackUI {
  constructor({ initialTrack = null, onBuild = null, onExit = null } = {}) {
    injectStyle();
    this.onBuild = onBuild;
    this.onExit = onExit;
    this.draft = defaultDraft(initialTrack || {});
    this.closed = this.draft.controlPoints.length >= 6;
    this.layoutReady = this.closed;
    this.gallery = new TrackGallery();
    this.history = [];
    this.future = [];
    this.validation = null;
    this.repairPreview = null;
    this.closureState = null;
    this.deformGesture = null;
    this.transformGesture = null;
    this.startDragIssue = '';
    this.lastInteraction = this.closed ? 'adjust' : 'draw';
    this.drawing = false;
    this.erasing = false;
    this.startMoveArmed = false;
    this.startTouched = !!initialTrack;
    this.selectedCrossingId = null;
    this.selectedCrossingReference = null;
    this.editorStage = this.closed ? 'adjust' : 'draw';
    this.featureCategoryId = 'jumps';
    this.selectedFeatureId = 'small-kicker';
    this.selectedPlacementId = null;
    this.featureStampArmed = false;
    this.placementGhost = null;
    this.placementGesture = null;
    this._placementOrdinal = this.draft.featurePlacements.length;
    this.featureThumbnail = typeof Image === 'function' ? new Image() : null;
    if (this.featureThumbnail) {
      this.featureThumbnail.decoding = 'async';
      this.featureThumbnail.src = FEATURE_ATLAS_URL;
      this.featureThumbnail.addEventListener('load', () => this.requestDraw(), { once: true });
    }
    this.hover = null;
    this.controllerCursor = { x: 0.5, y: 0.5, visible: false, drawing: false };
    this.view = { zoom: 1, panX: 0, panY: 0 };
    this.sampler = new StrokeSampler({ minDistance: 0.004 });
    this.sampler.reset(this.draft.rawStroke);
    this._frame = 0;
    this._controllerFrame = 0;
    this._lastGamepad = { buttons: [], widthAxis: 0 };
    this._buildTimer = null;
    this._clearTimer = null;
    this._mount();
  }

  _mount() {
    const host = document.getElementById('kk-stage') || document.body;
    this.root = document.createElement('section');
    this.root.className = 'kdt-editor';
    this.root.setAttribute('aria-label', 'Kaki Course Workshop circuit editor');
    const themeOptions = DRAW_TRACK_THEME_ORDER.map((id) => {
      const theme = DRAW_TRACK_THEMES[id];
      return `<button type="button" data-theme="${id}" title="${escapeHtml(theme.detail)}"><span>${theme.icon}</span><b>${escapeHtml(theme.short)}</b></button>`;
    }).join('');
    const sizeOptions = Object.values(TRACK_SIZE_PRESETS).map((preset) => (
      `<button type="button" data-size="${preset.id}"><b>${preset.label}</b><span>${preset.detail}</span></button>`
    )).join('');
    const widthOptions = Object.values(TRACK_WIDTH_PRESETS).map((preset) => (
      `<button type="button" data-width="${preset.id}"><b>${preset.label}</b><span>${preset.detail}</span></button>`
    )).join('');
    const featureCategories = COURSE_FEATURE_CATEGORIES.map((category) => (
      `<button type="button" data-feature-category="${category.id}">${escapeHtml(category.shortLabel)}</button>`
    )).join('');
    const featureCards = listCourseFeatures({ mode: 'circuit', category: this.featureCategoryId })
      .map(featureCardHtml)
      .join('');
    this.root.innerHTML = `
      <header class="kdt-head">
        <button class="kdt-back" type="button" data-action="exit">← RALLY MODES</button>
        <div class="kdt-title"><span>DRAW TRACK + TRIALS CREATOR</span><h1>KAKI COURSE WORKSHOP</h1><em>Draw it. Place it. Race it.</em></div>
        <nav class="kdt-stage-flow" aria-label="Track creation progress">
          <button type="button" data-stage="draw"><i>1</i>DRAW</button><b>›</b>
          <button type="button" data-stage="adjust"><i>2</i>ADJUST</button><b>›</b>
          <button type="button" data-stage="place"><i>3</i>PLACE</button><b>›</b>
          <button type="button" data-stage="start"><i>4</i>START / FINISH</button><b>›</b>
          <button type="button" data-stage="race"><i>5</i>TEST / RACE</button>
        </nav>
        <div class="kdt-head-status" data-status-kind="empty"><i></i><span data-role="status">Draw one closed loop</span></div>
      </header>
      <aside class="kdt-tools" aria-label="Drawing tools">
        <button type="button" data-action="undo" title="Undo · Ctrl+Z"><span>↶</span><b>UNDO</b></button>
        <button type="button" data-action="redo" title="Redo · Ctrl+Y"><span>↷</span><b>REDO</b></button>
        <button type="button" data-action="smooth" title="Smooth track"><span>∿</span><b>SMOOTH</b></button>
        <button type="button" data-action="repair" title="Preview automatic repair"><span>✦</span><b>FIX</b></button>
        <button type="button" data-action="start" title="Move the start line"><span>⚑</span><b>START</b></button>
        <button type="button" data-action="clear" title="Clear drawing"><span>×</span><b>CLEAR</b></button>
      </aside>
      <main class="kdt-board">
        <div class="kdt-canvas-wrap">
          <canvas class="kdt-canvas" aria-label="Track drawing surface"></canvas>
          <button class="kdt-inspector-toggle" type="button" data-action="options" aria-expanded="false">⚙ TRACK SETUP</button>
          <div class="kdt-canvas-actions">
            <button type="button" data-action="fit-view" title="Fit the complete track in view">⌂ FIT VIEW</button>
            <button type="button" data-action="close-loop" data-context="open" hidden>⌁ CLOSE LOOP</button>
            <button type="button" data-action="auto-start" data-context="closed" hidden>⚑ AUTO-PLACE START</button>
          </div>
          <div class="kdt-canvas-corner kdt-canvas-help"><b>DRAW</b><span>Hold and drag · release at the start</span></div>
          <div class="kdt-canvas-corner kdt-canvas-scale"><b data-role="scale-name">CLUB</b><span data-role="scale-size">124 × 86 m</span></div>
          <div class="kdt-controller-hint">LEFT STICK · CURSOR&nbsp;&nbsp; A · DRAW&nbsp;&nbsp; X · UNDO&nbsp;&nbsp; Y · CLEAR</div>
          <aside class="kdt-crossing-panel" aria-label="Selected crossing" hidden>
            <header>
              <div><span>OVERPASS WORKBENCH</span><b data-role="crossing-title">CROSSING</b></div>
              <button type="button" data-action="close-crossing" aria-label="Close crossing inspector">×</button>
            </header>
            <div class="kdt-crossing-modes" role="group" aria-label="Upper branch">
              <button type="button" data-crossing-mode="auto">AUTO</button>
              <button type="button" data-crossing-mode="a-over-b">A OVER B</button>
              <button type="button" data-crossing-mode="b-over-a">B OVER A</button>
              <button type="button" data-crossing-mode="flat">FLAT / INVALID</button>
            </div>
            <div class="kdt-crossing-presets" role="group" aria-label="Bridge preset">
              ${Object.values(BRIDGE_PRESETS).map((preset) => `<button type="button" data-crossing-preset="${preset.id}"><b>${preset.label}</b><span>${preset.baseHeight.toFixed(1)} m deck</span></button>`).join('')}
            </div>
            <label class="kdt-crossing-approach">
              <span><b>APPROACH LENGTH</b><output data-role="crossing-approach">AUTO</output></span>
              <input type="range" min="20" max="180" step="1" value="40" data-setting="crossing-approach">
            </label>
            <dl class="kdt-crossing-metrics">
              <div><dt>ANGLE</dt><dd data-role="crossing-angle">—</dd></div>
              <div><dt>GRADE</dt><dd data-role="crossing-grade">—</dd></div>
              <div><dt>CLEARANCE</dt><dd data-role="crossing-clearance">—</dd></div>
              <div><dt>APPROACH</dt><dd data-role="crossing-capacity">—</dd></div>
            </dl>
            <p data-role="crossing-message">Select which route branch travels above the other.</p>
          </aside>
          <aside class="kdt-feature-workbench" aria-label="Course feature palette" hidden>
            <header>
              <div><span>PLACE WORKBENCH</span><b>STAMP REAL COURSE PARTS</b></div>
              <div class="kdt-auto-dress-actions">
                <button type="button" data-action="auto-dress">✦ AUTO DRESS</button>
                <button type="button" data-action="clear-auto-dress">× DRESS</button>
              </div>
              <p><strong data-role="feature-count">0</strong> PLACED</p>
              <button class="kdt-feature-collapse" type="button" data-action="toggle-feature-workbench" aria-expanded="true" aria-label="Collapse feature palette">⌄</button>
            </header>
            <nav class="kdt-feature-categories" aria-label="Feature categories">${featureCategories}</nav>
            <div class="kdt-feature-layout">
              <div class="kdt-feature-cards" data-role="feature-cards">${featureCards}</div>
              <article class="kdt-feature-inspector">
                <i data-role="feature-preview" style="${featureThumbnailStyle(getCourseFeature(this.selectedFeatureId))}" aria-hidden="true"></i>
                <div><b data-role="feature-name">SMALL KICKER</b><span data-role="feature-anchor">SELECT · THEN TAP ROAD</span></div>
                <p data-role="feature-message" data-state="valid">Choose a final asset and stamp it onto the racing line.</p>
                <div class="kdt-feature-transform" role="group" aria-label="Feature transform controls">
                  <button type="button" data-action="feature-rotate-left" title="Rotate left · Q">↶ <span>ROTATE</span></button>
                  <button type="button" data-action="feature-rotate-right" title="Rotate right · E">↷ <span>ROTATE</span></button>
                  <button type="button" data-action="feature-flip" title="Flip direction · R">⇄ <span>FLIP</span></button>
                  <button type="button" data-action="feature-scale-down" title="Scale down">− <span>SIZE</span></button>
                  <button type="button" data-action="feature-scale-up" title="Scale up">+ <span>SIZE</span></button>
                  <button type="button" data-action="feature-duplicate" title="Duplicate · Y">⧉ <span>COPY</span></button>
                  <button type="button" data-action="feature-delete" title="Delete · X">× <span>DELETE</span></button>
                  <button type="button" data-action="feature-test" title="Test From Here">▶ <span>TEST HERE</span></button>
                </div>
              </article>
            </div>
          </aside>
          <aside class="kdt-health" aria-label="Track validation">
            <header><b>RACEABILITY</b><span data-role="health-summary">Start drawing</span></header>
            <div class="kdt-length-budget"><span><b data-role="length-current">0 m</b><em data-role="length-message">Draw a loop</em></span><i><b></b></i><small data-role="length-range">Recommended —</small></div>
            <div class="kdt-checklist" data-role="checklist"></div>
            <div class="kdt-repair-actions" hidden><span data-role="repair-summary"></span><button type="button" data-action="apply-repair">APPLY</button><button type="button" data-action="cancel-repair">CANCEL</button></div>
          </aside>
        </div>
      </main>
      <aside class="kdt-inspector">
        <label class="kdt-name"><span>TRACK NAME</span><input type="text" maxlength="42" placeholder="Generated after your first loop"></label>
        <section class="kdt-theme-section"><div class="kdt-section-title"><b>01 · WORLD</b><span>Same line, a different adventure</span></div><div class="kdt-themes">${themeOptions}</div></section>
        <section class="kdt-world-preview" data-role="world-preview" aria-label="Selected world map preview"><div class="kdt-world-preview-art" aria-hidden="true"><i></i><b></b><em></em></div><div><b data-role="world-venue">MEADOW RALLY PARK</b><span data-role="world-sky">HARVEST SKY</span><small>LIVE MAP &amp; SKY PREVIEW</small></div></section>
        <section class="kdt-size-section"><div class="kdt-section-title"><b>02 · TRACK SIZE</b><span>World footprint, not road width</span></div><div class="kdt-size-options">${sizeOptions}</div></section>
        <section class="kdt-width-section"><div class="kdt-section-title"><b>03 · ROAD WIDTH</b><span>Wheel changes this too</span></div><div class="kdt-width-options">${widthOptions}</div></section>
        <section class="kdt-tuning">
          <label><span><b>SMOOTHING</b><output data-role="smoothing">55%</output></span><input type="range" min="0" max="100" value="55" data-setting="smoothing"></label>
          <div class="kdt-switches">
            <label><input type="checkbox" data-modifier="randomJumps"><span>Auto-fill jumps</span></label>
            <label><input type="checkbox" data-setting="reverse"><span>Reverse direction</span></label>
            <label><input type="checkbox" data-modifier="nightRace"><span>Night race</span></label>
            <label><input type="checkbox" data-modifier="mirror"><span>Mirror layout</span></label>
          </div>
          <p class="kdt-crossing-orphans" data-role="crossing-orphans" hidden></p>
        </section>
        <div class="kdt-library-actions">
          <button type="button" data-action="gallery">SAVED TRACKS <span data-role="save-count">0</span></button>
          <button type="button" data-action="import">IMPORT CODE</button>
        </div>
      </aside>
      <footer class="kdt-foot">
        <div class="kdt-metrics">
          <span><b data-stat="length">—</b><em>LENGTH</em></span>
          <span><b data-stat="time">—</b><em>EST. LAP</em></span>
          <span><b data-stat="corners">—</b><em>CORNERS</em></span>
          <span><b data-stat="speed">—</b><em>TOP SPEED</em></span>
          <span><b data-stat="difficulty">—</b><em>DIFFICULTY</em></span>
          <span class="kdt-personality"><b data-stat="personality">MAKE YOUR MARK</b><em>TRACK PERSONALITY</em></span>
        </div>
        <div class="kdt-primary-actions">
          <button type="button" data-action="save" disabled>SAVE</button>
          <button type="button" data-action="share" disabled>TRACK CODE</button>
          <div class="kdt-build-wrap"><button class="kdt-build" type="button" data-action="build" disabled><span>BUILD TRACK</span><b>ENTER</b></button><small data-role="build-explain">Close the loop to build</small></div>
        </div>
      </footer>
      <div class="kdt-gallery" hidden></div>
      <dialog class="kdt-code-dialog">
        <form method="dialog"><button class="kdt-dialog-close" value="cancel" aria-label="Close">×</button>
          <span>VERSIONED · OFFLINE · SAFE</span><h2>TRACK CODE</h2>
          <textarea rows="5" spellcheck="false" placeholder="Paste a KDT1-, KDT2-, or KDT3- track code"></textarea>
          <p data-role="code-message">A code reproduces shape, size, width, theme, seed, direction and supported modifiers.</p>
          <div><button type="button" data-code-action="copy">COPY CURRENT</button><button type="button" data-code-action="load">IMPORT TRACK</button></div>
        </form>
      </dialog>
      <div class="kdt-toast" role="status" aria-live="polite"></div>
      <div class="kdt-build-reveal" hidden>
        <div class="kdt-build-line"></div><span>DRAWN BY YOU</span><h2 data-role="build-name">KAKI CIRCUIT</h2>
        <p data-role="build-stage">CLEANING THE RACING LINE</p><div class="kdt-build-progress"><i></i></div>
        <button type="button" data-action="skip-build">SKIP</button>
      </div>`;
    host.appendChild(this.root);
    this.canvas = this.root.querySelector('.kdt-canvas');
    this.context = this.canvas.getContext('2d');
    this.input = new TrackDrawingInput(this, this.canvas);
    this._bindControls();
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(this.canvas.parentElement);
    this.resize();
    this.recalculate({ allowSuggestedStart: !this.startTouched });
    this._syncControls();
    this._renderGallerySummary();
    this.root.querySelector('.kdt-name input').value = this.draft.name;
    document.body.classList.add('kdt-open');
    if (new URLSearchParams(location.search).has('qa')) window.__kdtEditor = this;
    this._controllerFrame = requestAnimationFrame((time) => this._pollController(time));
  }

  _bindControls() {
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button || !this.root.contains(button)) return;
      if (button.dataset.theme) this.setTheme(button.dataset.theme);
      else if (button.dataset.size) this.setSize(button.dataset.size);
      else if (button.dataset.width) this.setWidth(button.dataset.width);
      else if (button.dataset.featureCategory) this.setFeatureCategory(button.dataset.featureCategory);
      else if (button.dataset.featureId) this.selectFeature(button.dataset.featureId);
      else if (button.dataset.crossingMode) this.setCrossingMode(button.dataset.crossingMode);
      else if (button.dataset.crossingPreset) this.setCrossingPreset(button.dataset.crossingPreset);
      else if (button.dataset.stage) this.setEditorStage(button.dataset.stage);
      else if (button.dataset.action) this.action(button.dataset.action, button);
      else if (button.dataset.galleryAction) this.galleryAction(button);
      else if (button.dataset.codeAction) this.codeAction(button.dataset.codeAction);
    });
    const smoothing = this.root.querySelector('[data-setting="smoothing"]');
    smoothing.addEventListener('pointerdown', () => {
      if (!this._smoothingGesture) { this.pushHistory(); this._smoothingGesture = true; }
    });
    smoothing.addEventListener('pointerup', () => { this._smoothingGesture = false; });
    smoothing.addEventListener('keydown', () => {
      if (!this._smoothingKeyGesture) { this.pushHistory(); this._smoothingKeyGesture = true; }
    });
    smoothing.addEventListener('keyup', () => { this._smoothingKeyGesture = false; });
    smoothing.addEventListener('input', (event) => {
      this.draft.smoothing = Number(event.target.value) / 100;
      this.root.querySelector('[data-role="smoothing"]').textContent = `${event.target.value}%`;
      this.recalculate();
    });
    this.root.querySelector('[data-setting="reverse"]').addEventListener('change', (event) => {
      this.pushHistory();
      this.draft.reverse = event.target.checked;
      this.recalculate();
    });
    this.root.querySelectorAll('[data-modifier]').forEach((input) => input.addEventListener('change', () => {
      this.pushHistory();
      this.draft.modifiers[input.dataset.modifier] = input.checked;
      this.recalculate();
    }));
    this.root.querySelector('.kdt-name input').addEventListener('input', (event) => {
      this.draft.name = event.target.value.slice(0, 42);
    });
    const crossingApproach = this.root.querySelector('[data-setting="crossing-approach"]');
    crossingApproach.addEventListener('pointerdown', () => {
      if (!this._crossingApproachGesture) {
        this.pushHistory();
        this._crossingApproachGesture = true;
      }
    });
    crossingApproach.addEventListener('pointerup', () => {
      this._crossingApproachGesture = false;
    });
    crossingApproach.addEventListener('input', (event) => {
      this.setCrossingApproach(Number(event.target.value), { recordHistory: false });
    });
    this.keyHandler = (event) => this.keydown(event);
    document.addEventListener('keydown', this.keyHandler, true);
    document.addEventListener('keyup', (this.keyUpHandler = (event) => {
      if (event.code === 'Space') this.input.spacePan = false;
    }), true);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * ratio));
    this.canvas.height = Math.max(1, Math.round(rect.height * ratio));
    this.pixelRatio = ratio;
    this.requestDraw();
  }

  snapshot() {
    return {
      rawStroke: this.draft.rawStroke.map((point) => ({ ...point })),
      controlPoints: this.draft.controlPoints.map((point) => ({ ...point })),
      layoutTransform: { ...this.draft.layoutTransform },
      closed: this.closed,
      startFraction: this.draft.startFraction,
      reverse: this.draft.reverse,
      sizeId: this.draft.sizeId,
      widthId: this.draft.widthId,
      smoothing: this.draft.smoothing,
      modifiers: { ...this.draft.modifiers },
      crossingOverrides: this.draft.crossingOverrides.map((override) => ({
        ...override,
        point: override.point ? { ...override.point } : undefined,
        branchFractions: override.branchFractions ? [...override.branchFractions] : undefined,
      })),
      featurePlacements: structuredClone(this.draft.featurePlacements),
      themeId: this.draft.themeId,
      laps: this.draft.laps,
      layoutReady: this.layoutReady,
    };
  }

  pushHistory() {
    this.history.push(this.snapshot());
    if (this.history.length > 40) this.history.shift();
    this.future.length = 0;
  }

  restore(snapshot) {
    if (!snapshot) return;
    Object.assign(this.draft, {
      rawStroke: snapshot.rawStroke.map((point) => ({ ...point })),
      controlPoints: snapshot.controlPoints.map((point) => ({ ...point })),
      startFraction: snapshot.startFraction,
      reverse: snapshot.reverse,
      sizeId: snapshot.sizeId,
      widthId: snapshot.widthId,
      smoothing: snapshot.smoothing,
      layoutTransform: { ...snapshot.layoutTransform },
      modifiers: { ...snapshot.modifiers },
      crossingOverrides: sanitizeCrossingOverrides(snapshot.crossingOverrides),
      featurePlacements: structuredClone(snapshot.featurePlacements || []),
      themeId: snapshot.themeId,
      laps: snapshot.laps,
    });
    this.closed = snapshot.closed;
    this.layoutReady = snapshot.layoutReady;
    this.sampler.reset(this.draft.rawStroke);
    this.repairPreview = null;
    this.selectedCrossingId = null;
    this.selectedCrossingReference = null;
    this.selectedPlacementId = null;
    this.placementGhost = null;
    this.placementGesture = null;
    this.featureStampArmed = false;
    this.lastInteraction = this.closed ? 'adjust' : 'draw';
    this.recalculate();
    this._syncControls();
  }

  undo() {
    if (!this.history.length) return;
    this.future.push(this.snapshot());
    this.restore(this.history.pop());
  }

  redo() {
    if (!this.future.length) return;
    this.history.push(this.snapshot());
    this.restore(this.future.pop());
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return this.screenToNormalized(event.clientX - rect.left, event.clientY - rect.top);
  }

  screenToNormalized(x, y) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    return {
      x: clamp(((x - width * 0.5 - this.view.panX) / this.view.zoom + width * 0.5) / width, 0, 1),
      y: clamp(((y - height * 0.5 - this.view.panY) / this.view.zoom + height * 0.5) / height, 0, 1),
    };
  }

  normalizedToScreen(point) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    return {
      x: (point.x * width - width * 0.5) * this.view.zoom + width * 0.5 + this.view.panX,
      y: (point.y * height - height * 0.5) * this.view.zoom + height * 0.5 + this.view.panY,
    };
  }

  displayPoint(point, layout = this.draft.layoutTransform) {
    if (!this.layoutReady) return point;
    const authored = this.draft.modifiers.mirror ? { x: 1 - point.x, y: point.y } : point;
    return applyLayoutToPoint(authored, layout);
  }

  displayPoints(points, layout = this.draft.layoutTransform) {
    return (points || []).map((point) => this.displayPoint(point, layout));
  }

  canonicalPoint(point, layout = this.draft.layoutTransform) {
    if (!this.layoutReady) return point;
    const canonical = invertLayoutPoint(point, layout);
    return this.draft.modifiers.mirror ? { x: 1 - canonical.x, y: canonical.y } : canonical;
  }

  _closureRadius(pointerType = this.pointerType || 'mouse') {
    const rect = this.canvas.getBoundingClientRect();
    const minimumScale = pointerType === 'touch' ? 1 : 0.94;
    const scale = clamp(Math.min(rect.width, rect.height) / 520, minimumScale, 1.22);
    return (pointerType === 'touch' ? 74 : 60) * scale;
  }

  _updateClosureState(endpoint = this.draft.rawStroke.at(-1)) {
    const start = this.draft.rawStroke[0];
    if (!start || !endpoint || this.draft.rawStroke.length < 8) {
      this.closureState = null;
      return null;
    }
    const a = this.normalizedToScreen(this.displayPoint(start));
    const b = this.normalizedToScreen(this.displayPoint(endpoint));
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const radius = this._closureRadius();
    const magnetic = distance <= radius;
    const nearby = distance <= radius * 2.35;
    const pull = magnetic ? clamp(1 - distance / radius, 0, 1) : 0;
    this.closureState = { distance, radius, magnetic, nearby, pull, start, endpoint };
    return this.closureState;
  }

  _roundedClosure(points, forceConnector = false) {
    if (points.length < 4) return points.map((point) => ({ ...point }));
    const result = points.map((point) => ({ ...point }));
    const start = result[0];
    const end = result.at(-1);
    const gap = Math.hypot(start.x - end.x, start.y - end.y);
    if ((forceConnector || gap > 0.012) && gap > 0.001) {
      const previous = result.at(-2);
      const next = result[1];
      const outLength = Math.hypot(end.x - previous.x, end.y - previous.y) || 1;
      const inLength = Math.hypot(next.x - start.x, next.y - start.y) || 1;
      const handle = Math.min(gap * 0.42, 0.075);
      const c1 = { x: end.x + (end.x - previous.x) / outLength * handle, y: end.y + (end.y - previous.y) / outLength * handle };
      const c2 = { x: start.x - (next.x - start.x) / inLength * handle, y: start.y - (next.y - start.y) / inLength * handle };
      for (let step = 1; step <= 5; step++) {
        const t = step / 6;
        const u = 1 - t;
        result.push({
          x: u ** 3 * end.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * start.x,
          y: u ** 3 * end.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * start.y,
        });
      }
    }
    result.push({ ...start });
    // Relax only the closure neighborhood. The rest of the authored stroke is
    // left untouched so sharp intent remains recognizable.
    for (const index of [result.length - 3, result.length - 2, 1, 2]) {
      const previous = result[(index - 1 + result.length) % result.length];
      const point = result[index];
      const next = result[(index + 1) % result.length];
      point.x = point.x * 0.78 + (previous.x + next.x) * 0.11;
      point.y = point.y * 0.78 + (previous.y + next.y) * 0.11;
    }
    return result;
  }

  _completeClosure({ forceConnector = false } = {}) {
    const closedStroke = this._roundedClosure(this.draft.rawStroke, forceConnector);
    const controls = TrackSpline.clean(closedStroke, this.draft.smoothing);
    if (this.layoutReady) {
      this.draft.rawStroke = closedStroke;
      this.draft.controlPoints = controls;
    } else {
      const canonical = createCanonicalTrackLayout(closedStroke, controls, this.draft.sizeId);
      this.draft.rawStroke = canonical.rawPoints;
      this.draft.controlPoints = canonical.controlPoints;
      this.draft.layoutTransform = canonical.layoutTransform;
    }
    this.layoutReady = true;
    this.closed = true;
    this.closureState = null;
    this.sampler.reset(this.draft.rawStroke);
    this.lastInteraction = 'adjust';
    this.editorStage = 'adjust';
    this.recalculate({ allowSuggestedStart: true });
    this.fitView();
    this.toast('Loop closed · we placed the grid on your safest straight');
  }

  beginStroke(point, pointerType = 'mouse') {
    if (this.closed && this.draft.rawStroke.length) {
      this.toast('Track already closed · use Clear or right-drag to erase');
      return;
    }
    if (!this.drawing) {
      if (this.draft.rawStroke.length) {
        const endpoint = this.normalizedToScreen(this.displayPoint(this.draft.rawStroke.at(-1)));
        const pressed = this.normalizedToScreen(point);
        const resumeRadius = pointerType === 'touch' ? 76 : 54;
        if (Math.hypot(endpoint.x - pressed.x, endpoint.y - pressed.y) > resumeRadius) {
          this.toast('Resume from the glowing endpoint · no jump was added', 'error');
          return false;
        }
      }
      this.pushHistory();
      this.sampler.reset(this.draft.rawStroke);
      this.drawing = true;
      this.pointerType = pointerType;
    }
    if (!this.draft.rawStroke.length) this.extendStroke(point);
    return true;
  }

  extendStroke(point) {
    if (!this.drawing) return;
    const sampledPoint = this.layoutReady ? this.canonicalPoint(point) : point;
    if (this.sampler.push(sampledPoint)) {
      this.draft.rawStroke = this.sampler.points.map((entry) => ({ ...entry }));
      this.draft.controlPoints = TrackSpline.clean(this.draft.rawStroke, this.draft.smoothing);
      const closure = this._updateClosureState();
      this.requestDraw();
      this._setStatus(
        closure?.magnetic ? 'valid' : 'drawing',
        closure?.magnetic ? 'RELEASE TO CLOSE' : this.draft.rawStroke.length < 18 ? 'Keep drawing…' : 'Bring it back to the checkered circle',
      );
      this._syncButtons();
    }
  }

  endStroke() {
    if (!this.drawing) return;
    this.drawing = false;
    const closure = this.closureState?.magnetic ? this.closureState : this._updateClosureState();
    if (closure?.magnetic && this.draft.rawStroke.length >= 18) {
      this._completeClosure();
      return;
    }
    this.closed = false;
    this.recalculate();
    if (closure?.nearby) this.toast('Almost there · use Close Loop for a rounded connector');
  }

  cancelActiveStroke() {
    if (!this.drawing) return;
    this.drawing = false;
    this.recalculate();
  }

  beginErase(point) {
    if (!this.draft.rawStroke.length) return;
    this.pushHistory();
    this.erasing = true;
    this.eraseAt(point);
  }

  eraseAt(point) {
    if (!this.erasing) return;
    const radius = 0.035 / this.view.zoom;
    const canonical = this.canonicalPoint(point);
    const filtered = this.draft.rawStroke.filter((candidate) => Math.hypot(candidate.x - canonical.x, candidate.y - canonical.y) > radius);
    if (filtered.length !== this.draft.rawStroke.length) {
      this.draft.rawStroke = filtered;
      this.sampler.reset(filtered);
      this.closed = false;
      this.draft.controlPoints = TrackSpline.clean(filtered, this.draft.smoothing);
      this.requestDraw();
    }
  }

  endErase() {
    this.erasing = false;
    this.recalculate();
  }

  setHover(point) {
    this.hover = point;
    this.requestDraw();
  }

  _baseSamples() {
    let samples = resampleClosedSpline(this.draft.controlPoints, TRACK_SIZE_PRESETS[this.draft.sizeId].samples);
    return this.displayPoints(samples);
  }

  selectionHandles() {
    if (!this.closed) return {};
    const bounds = pointsBounds(this._baseSamples());
    if (!bounds) return {};
    return {
      nw: { x: bounds.minX, y: bounds.minY }, n: { x: bounds.centerX, y: bounds.minY }, ne: { x: bounds.maxX, y: bounds.minY },
      w: { x: bounds.minX, y: bounds.centerY }, center: { x: bounds.centerX, y: bounds.centerY }, e: { x: bounds.maxX, y: bounds.centerY },
      sw: { x: bounds.minX, y: bounds.maxY }, s: { x: bounds.centerX, y: bounds.maxY }, se: { x: bounds.maxX, y: bounds.maxY },
    };
  }

  hitLayoutHandle(point) {
    const target = this.normalizedToScreen(point);
    let best = null;
    let bestDistance = Infinity;
    for (const [id, handle] of Object.entries(this.selectionHandles())) {
      const screen = this.normalizedToScreen(handle);
      const d = Math.hypot(screen.x - target.x, screen.y - target.y);
      const radius = id === 'center' ? 18 : 15;
      if (d <= radius && d < bestDistance) { best = id; bestDistance = d; }
    }
    return best;
  }

  hitTrack(point) {
    const target = this.normalizedToScreen(point);
    const samples = this.validation?.normalizedSamples || this._baseSamples();
    const threshold = 22 + TRACK_WIDTH_PRESETS[this.draft.widthId].width * 0.35;
    return samples.some((sample) => {
      const screen = this.normalizedToScreen(sample);
      return Math.hypot(screen.x - target.x, screen.y - target.y) <= threshold;
    });
  }

  zoomLimits() {
    const preset = TRACK_SIZE_PRESETS[this.draft.sizeId] || TRACK_SIZE_PRESETS.club;
    return {
      min: preset.editorMinZoom || 0.8,
      max: preset.editorMaxZoom || 2.5,
    };
  }

  crossingNormalizedPoint(crossing) {
    const size = TRACK_SIZE_PRESETS[this.draft.sizeId] || TRACK_SIZE_PRESETS.club;
    return {
      x: 0.5 + Number(crossing?.point?.x || 0) / size.width,
      y: 0.5 - Number(crossing?.point?.y || 0) / size.depth,
    };
  }

  hitCrossing(point) {
    if (!this.closed || !this.validation?.crossings?.length) return null;
    const target = this.normalizedToScreen(point);
    let best = null;
    let bestDistance = Infinity;
    for (const crossing of this.validation.crossings) {
      const screen = this.normalizedToScreen(this.crossingNormalizedPoint(crossing));
      const distance = Math.hypot(screen.x - target.x, screen.y - target.y);
      if (distance <= 28 && distance < bestDistance) {
        best = crossing;
        bestDistance = distance;
      }
    }
    return best;
  }

  selectedCrossing() {
    return this.validation?.crossings?.find((crossing) => crossing.id === this.selectedCrossingId) || null;
  }

  _restoreSelectedCrossing() {
    if (!this.selectedCrossingReference || this.selectedCrossing()) return;
    let best = null;
    let bestCost = Infinity;
    for (const crossing of this.validation?.crossings || []) {
      const pointDistance = Math.hypot(
        crossing.canonicalPoint.x - this.selectedCrossingReference.point.x,
        crossing.canonicalPoint.y - this.selectedCrossingReference.point.y,
      );
      const fractionDistance = (
        circularFractionDistance(
          crossing.branchA.canonicalFraction,
          this.selectedCrossingReference.branchFractions[0],
        )
        + circularFractionDistance(
          crossing.branchB.canonicalFraction,
          this.selectedCrossingReference.branchFractions[1],
        )
      );
      const cost = pointDistance + fractionDistance * 2.5;
      if (pointDistance <= 0.16 && fractionDistance <= 0.14 && cost < bestCost) {
        best = crossing;
        bestCost = cost;
      }
    }
    if (best) {
      this.selectedCrossingId = best.id;
      this.selectedCrossingReference = {
        point: { ...best.canonicalPoint },
        branchFractions: [
          best.branchA.canonicalFraction,
          best.branchB.canonicalFraction,
        ],
      };
    } else {
      this.selectedCrossingId = null;
    }
  }

  selectCrossing(crossing) {
    if (!crossing?.id) return;
    this.selectedCrossingId = crossing.id;
    this.selectedCrossingReference = {
      point: { ...crossing.canonicalPoint },
      branchFractions: [
        crossing.branchA.canonicalFraction,
        crossing.branchB.canonicalFraction,
      ],
    };
    this.editorStage = 'adjust';
    this.startMoveArmed = false;
    this._updateCrossingPanel();
    this._syncStageFlow();
    this.requestDraw();
    this.toast(
      crossing.bridgeable
        ? 'Crossing selected · choose AUTO or the upper branch'
        : crossing.conflictExplanation || 'Crossing selected · inspect the safety limits',
      crossing.bridgeable ? 'ok' : 'error',
    );
  }

  closeCrossing() {
    this.selectedCrossingId = null;
    this.selectedCrossingReference = null;
    this._updateCrossingPanel();
    this.requestDraw();
  }

  _replaceCrossingOverride(next) {
    const crossing = this.selectedCrossing();
    if (!crossing) return;
    this.draft.crossingOverrides = sanitizeCrossingOverrides([
      ...this.draft.crossingOverrides.filter((override) => override.id !== crossing.id),
      next,
    ]);
    this.recalculate();
  }

  setCrossingMode(mode) {
    const crossing = this.selectedCrossing();
    if (!crossing || !CROSSING_OVERRIDE_MODES.includes(mode)) return;
    this.pushHistory();
    const existing = crossing.override || {};
    this._replaceCrossingOverride(createCrossingOverride(crossing, {
      mode,
      preset: existing.preset || crossing.preset || 'standard',
      approachLength: existing.approachLength ?? null,
    }));
  }

  setCrossingPreset(preset) {
    const crossing = this.selectedCrossing();
    if (!crossing || !BRIDGE_PRESETS[preset]) return;
    this.pushHistory();
    const existing = crossing.override || {};
    this._replaceCrossingOverride(createCrossingOverride(crossing, {
      mode: existing.mode || 'auto',
      preset,
      approachLength: null,
    }));
  }

  setCrossingApproach(approachLength, { recordHistory = true } = {}) {
    const crossing = this.selectedCrossing();
    if (!crossing || !Number.isFinite(approachLength)) return;
    if (recordHistory) this.pushHistory();
    const existing = crossing.override || {};
    this._replaceCrossingOverride(createCrossingOverride(crossing, {
      mode: existing.mode || 'auto',
      preset: existing.preset || crossing.preset || 'standard',
      approachLength,
    }));
  }

  cycleCrossingMode(direction) {
    const crossing = this.selectedCrossing();
    if (!crossing) return;
    const mode = crossing.override?.mode || 'auto';
    const index = CROSSING_OVERRIDE_MODES.indexOf(mode);
    const next = CROSSING_OVERRIDE_MODES[
      (index + direction + CROSSING_OVERRIDE_MODES.length) % CROSSING_OVERRIDE_MODES.length
    ];
    this.setCrossingMode(next);
  }

  cycleCrossingPreset(direction) {
    const crossing = this.selectedCrossing();
    if (!crossing) return;
    const ids = Object.keys(BRIDGE_PRESETS);
    const index = ids.indexOf(crossing.override?.preset || crossing.preset || 'standard');
    this.setCrossingPreset(ids[(index + direction + ids.length) % ids.length]);
  }

  _updateCrossingPanel() {
    const panel = this.root?.querySelector('.kdt-crossing-panel');
    if (!panel) return;
    const crossing = this.selectedCrossing();
    panel.hidden = !crossing;
    const orphanNode = this.root.querySelector('[data-role="crossing-orphans"]');
    const orphanCount = this.validation?.orphanedCrossingOverrides?.length || 0;
    orphanNode.hidden = !orphanCount;
    orphanNode.textContent = orphanCount
      ? `⚠ ${orphanCount} saved crossing choice${orphanCount === 1 ? '' : 's'} no longer match this route. Undo the reshape or create a new crossing.`
      : '';
    if (!crossing) return;
    const override = crossing.override || {};
    const mode = override.mode || 'auto';
    const preset = override.preset || crossing.preset || 'standard';
    const orientation = crossing.selectedOrientation
      || crossing.orientations.find((entry) => entry.mode === mode)
      || crossing.orientations.find((entry) => entry.valid)
      || crossing.orientations[0];
    const approach = override.approachLength ?? orientation?.approachLength ?? BRIDGE_PRESETS[preset].minimumApproach;
    const capacity = Math.max(
      BRIDGE_PRESETS[preset].minimumApproach,
      ...crossing.orientations.map((entry) => Number(entry.maximumApproach) || 0),
    );
    panel.querySelector('[data-role="crossing-title"]').textContent = `CROSSING ${this.validation.crossings.indexOf(crossing) + 1} · ${crossing.bridgeable ? 'BRIDGE READY' : 'NEEDS ATTENTION'}`;
    panel.querySelectorAll('[data-crossing-mode]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.crossingMode === mode);
    });
    panel.querySelectorAll('[data-crossing-preset]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.crossingPreset === preset);
    });
    const slider = panel.querySelector('[data-setting="crossing-approach"]');
    slider.min = String(Math.ceil(BRIDGE_PRESETS[preset].minimumApproach));
    slider.max = String(Math.max(Number(slider.min), Math.min(180, Math.floor(capacity))));
    slider.value = String(clamp(Math.round(approach), Number(slider.min), Number(slider.max)));
    panel.querySelector('[data-role="crossing-approach"]').textContent = override.approachLength == null
      ? `AUTO · ${Math.round(approach)} m`
      : `${Math.round(approach)} m`;
    panel.querySelector('[data-role="crossing-angle"]').textContent = `${crossingAngleDegrees(crossing).toFixed(0)}°`;
    panel.querySelector('[data-role="crossing-grade"]').textContent = orientation?.grade != null
      ? `${crossingGradePercent(orientation).toFixed(1)}%`
      : '—';
    panel.querySelector('[data-role="crossing-clearance"]').textContent = orientation?.clearance != null
      ? `${orientation.clearance.toFixed(1)} m`
      : '—';
    panel.querySelector('[data-role="crossing-capacity"]').textContent = `${Math.floor(capacity)} m max`;
    const message = panel.querySelector('[data-role="crossing-message"]');
    message.dataset.state = crossing.bridgeable ? 'valid' : 'invalid';
    message.textContent = crossing.bridgeable
      ? `${orientation.presetLabel} selected by the global solver · ${orientation.overBranch} travels over ${orientation.underBranch}.`
      : crossing.conflictExplanation || 'No compatible safe bridge orientation is available here.';
  }

  beginDeform(point) {
    if (!this.closed || !this.draft.rawStroke.length) return false;
    this.pushHistory();
    const canonical = this.canonicalPoint(point);
    let nearest = 0;
    let best = Infinity;
    for (let index = 0; index < this.draft.rawStroke.length; index++) {
      const candidate = this.draft.rawStroke[index];
      const d = Math.hypot(candidate.x - canonical.x, candidate.y - canonical.y);
      if (d < best) { best = d; nearest = index; }
    }
    this.deformGesture = {
      start: canonical,
      nearest,
      points: this.draft.rawStroke.map((entry) => ({ ...entry })),
    };
    this.lastInteraction = 'adjust';
    this.editorStage = 'adjust';
    return true;
  }

  updateDeform(point) {
    const gesture = this.deformGesture;
    if (!gesture) return;
    const canonical = this.canonicalPoint(point);
    const dx = canonical.x - gesture.start.x;
    const dy = canonical.y - gesture.start.y;
    const count = gesture.points.length;
    const radius = clamp(Math.round(count * 0.085), 5, 24);
    this.draft.rawStroke = gesture.points.map((entry, index) => {
      const ring = circularIndexDistance(index, gesture.nearest, count);
      if (ring > radius) return { ...entry };
      const weight = 0.5 + 0.5 * Math.cos(Math.PI * ring / (radius + 1));
      return { x: entry.x + dx * weight, y: entry.y + dy * weight };
    });
    this.recalculate();
  }

  endDeform() {
    if (!this.deformGesture) return;
    this.deformGesture = null;
    this.sampler.reset(this.draft.rawStroke);
    this.toast('Road reshaped · metrics updated');
  }

  beginLayoutTransform(handle, point) {
    if (!this.closed) return false;
    this.pushHistory();
    this.transformGesture = {
      handle,
      start: { ...point },
      layout: { ...this.draft.layoutTransform },
      bounds: pointsBounds(this._baseSamples()),
    };
    this.lastInteraction = 'adjust';
    this.editorStage = 'adjust';
    return true;
  }

  updateLayoutTransform(point) {
    const gesture = this.transformGesture;
    if (!gesture?.bounds) return;
    const dx = point.x - gesture.start.x;
    const dy = point.y - gesture.start.y;
    const horizontal = gesture.handle.includes('e') || gesture.handle.includes('w');
    const vertical = gesture.handle.includes('n') || gesture.handle.includes('s');
    const sx = gesture.handle.includes('w') ? -1 : 1;
    const sy = gesture.handle.includes('n') ? -1 : 1;
    const next = { ...gesture.layout };
    if (gesture.handle === 'center') {
      next.offsetX += dx;
      next.offsetY += dy;
    } else if (horizontal && vertical) {
      const factor = clamp(1 + (sx * dx / Math.max(0.05, gesture.bounds.width)
        + sy * dy / Math.max(0.05, gesture.bounds.height)) * 0.5, 0.55, 1.7);
      next.scaleX *= factor;
      next.scaleY *= factor;
      next.offsetX += dx * 0.5;
      next.offsetY += dy * 0.5;
    } else if (horizontal) {
      next.scaleX *= clamp(1 + sx * dx / Math.max(0.05, gesture.bounds.width), 0.55, 1.7);
      next.offsetX += dx * 0.5;
    } else if (vertical) {
      next.scaleY *= clamp(1 + sy * dy / Math.max(0.05, gesture.bounds.height), 0.55, 1.7);
      next.offsetY += dy * 0.5;
    }
    this.draft.layoutTransform = sanitizeLayoutTransform(next);
    this.recalculate();
  }

  endLayoutTransform() {
    if (!this.transformGesture) return;
    this.transformGesture = null;
    this.toast('Layout transformed · world dimensions changed');
  }

  startMarkerPoint() {
    const samples = this._baseSamples();
    return samples[Math.floor(this.draft.startFraction * samples.length) % Math.max(1, samples.length)] || null;
  }

  hitStartMarker(point) {
    if (!this.closed) return false;
    const marker = this.startMarkerPoint();
    if (!marker) return false;
    const a = this.normalizedToScreen(marker);
    const b = this.normalizedToScreen(point);
    return Math.hypot(a.x - b.x, a.y - b.y) <= 32;
  }

  beginMoveStart(point) {
    if (!this.closed) { this.toast('Close the loop before moving the start line'); return; }
    this.pushHistory();
    this.startTouched = true;
    this.lastInteraction = 'start';
    this.editorStage = 'start';
    this.moveStart(point);
  }

  moveStart(point) {
    const samples = this._baseSamples();
    const requested = nearestSplineFraction(samples, point);
    const snapped = this._nearestSafeStart(requested, samples);
    this.draft.startFraction = snapped.fraction;
    this.startDragIssue = snapped.reason;
    this.unsafeStartPreview = snapped.reason ? { point, reason: snapped.reason } : null;
    this.recalculate();
  }

  endMoveStart() {
    this.startMoveArmed = false;
    this.unsafeStartPreview = null;
    this.root.querySelector('[data-action="start"]')?.classList.remove('is-active');
    this.recalculate();
  }

  _startSafety(fraction, samples = this._baseSamples()) {
    if (!samples.length) return { safe: false, reason: 'Track is not ready' };
    const count = samples.length;
    const index = Math.round(fraction * count) % count;
    const before = samples[(index - 5 + count) % count];
    const point = samples[index];
    const after = samples[(index + 10) % count];
    const ax = point.x - before.x; const ay = point.y - before.y;
    const bx = after.x - point.x; const by = after.y - point.y;
    const al = Math.hypot(ax, ay) || 1; const bl = Math.hypot(bx, by) || 1;
    const turn = Math.acos(clamp((ax * bx + ay * by) / (al * bl), -1, 1));
    if (turn > 0.48) return { safe: false, reason: 'Grid needs a straighter section' };
    const length = this.validation?.stats?.length || 1;
    for (const bridge of this.validation?.overpasses || []) {
      const absolute = ((this.draft.startFraction + bridge.fraction) % 1 + 1) % 1;
      const delta = Math.abs(absolute - fraction);
      const cyclic = Math.min(delta, 1 - delta);
      if (cyclic * length < bridge.approachLength + 18) return { safe: false, reason: 'Too close to an overpass approach' };
    }
    return { safe: true, reason: '' };
  }

  _nearestSafeStart(fraction, samples = this._baseSamples()) {
    const count = samples.length || 1;
    const first = this._startSafety(fraction, samples);
    if (first.safe) return { fraction, reason: '' };
    for (let offset = 1; offset < Math.min(count * 0.18, 42); offset++) {
      for (const direction of [-1, 1]) {
        const candidate = ((fraction + direction * offset / count) % 1 + 1) % 1;
        if (this._startSafety(candidate, samples).safe) return { fraction: candidate, reason: first.reason };
      }
    }
    return { fraction: this.draft.startFraction, reason: first.reason };
  }

  recalculate({ allowSuggestedStart = false } = {}) {
    this.draft.controlPoints = TrackSpline.clean(this.draft.rawStroke, this.draft.smoothing);
    if (!this.closed || this.draft.controlPoints.length < 6) {
      this.validation = null;
      this.featureDiagnostics = [];
      this.selectedCrossingId = null;
      this._updateStats();
      const closure = this._updateClosureState();
      this._setStatus(
        closure?.magnetic ? 'valid' : this.draft.rawStroke.length ? 'drawing' : 'empty',
        closure?.magnetic ? 'RELEASE TO CLOSE' : this.draft.rawStroke.length ? 'Bring it back to the checkered circle' : 'Draw one closed loop',
      );
      this._updateHealth();
      this._syncStageFlow();
      this._updateCrossingPanel();
      this._syncFeatureWorkbench();
      this.requestDraw();
      this._syncButtons();
      return;
    }
    const options = {
      rawPoints: this.draft.rawStroke,
      controlPoints: this.repairPreview?.points || this.draft.controlPoints,
      closed: true,
      sizeId: this.draft.sizeId,
      widthId: this.draft.widthId,
      startFraction: this.draft.startFraction,
      reverse: this.draft.reverse,
      mirror: !!this.draft.modifiers.mirror,
      allowOverpasses: true,
      layoutTransform: this.repairPreview?.layoutTransform || this.draft.layoutTransform,
      crossingOverrides: this.draft.crossingOverrides,
      featurePlacements: this.draft.featurePlacements,
    };
    this.validation = TrackValidator.validate(options);
    if (allowSuggestedStart && this.validation.stats) {
      this.draft.startFraction = this.validation.suggestedStartFraction;
      this.startTouched = false;
      options.startFraction = this.draft.startFraction;
      this.validation = TrackValidator.validate(options);
    }
    this.draft.crossingOverrides = sanitizeCrossingOverrides([
      ...(this.validation.crossingOverrides || []),
      ...(this.validation.orphanedCrossingOverrides || []),
    ]);
    this.featureDiagnostics = this.draft.featurePlacements.map((placement) => this._validateFeature(placement));
    if (this.selectedPlacementId && !this.selectedPlacement()) this.selectedPlacementId = null;
    this._restoreSelectedCrossing();
    if (!this.draft.name && this.validation.stats) {
      this.draft.name = proceduralTrackName(this.draft.seed, this.validation.stats);
      this.root.querySelector('.kdt-name input').value = this.draft.name;
    }
    this._updateStats();
    const layoutSize = TRACK_SIZE_PRESETS[this.draft.sizeId];
    const activeLayout = this.repairPreview?.layoutTransform || this.draft.layoutTransform;
    this.root.querySelector('[data-role="scale-size"]').textContent = `${Math.round(layoutSize.width * activeLayout.occupancy * activeLayout.scaleX)} × ${Math.round(layoutSize.depth * activeLayout.occupancy * activeLayout.scaleY)} m layout`;
    if (this.validation.valid) {
      const bridgeText = this.validation.overpasses.length ? ` · ${this.validation.overpasses.length} OVERPASS${this.validation.overpasses.length > 1 ? 'ES' : ''}` : '';
      this._setStatus('valid', `Loop closed · race ready${bridgeText}`);
    } else {
      this._setStatus('invalid', this.validation.errors[0]?.message || 'Track needs attention');
    }
    this._updateHealth();
    this._syncStageFlow();
    this._updateCrossingPanel();
    this._syncFeatureWorkbench();
    this._syncButtons();
    this.requestDraw();
  }

  _setStatus(kind, message) {
    const root = this.root?.querySelector('.kdt-head-status');
    if (!root) return;
    root.dataset.statusKind = kind;
    root.querySelector('[data-role="status"]').textContent = message;
  }

  _updateStats() {
    const stats = this.validation?.stats;
    const set = (name, value) => { const node = this.root.querySelector(`[data-stat="${name}"]`); if (node) node.textContent = value; };
    set('length', stats ? `${Math.round(stats.length)} m` : '—');
    set('time', stats ? formatTime(stats.estimatedLapTime) : '—');
    set('corners', stats ? String(stats.cornerCount) : '—');
    set('speed', stats ? `${Math.round(stats.topSpeedPotential)}%` : '—');
    set('difficulty', stats?.difficulty || '—');
    set('personality', stats?.personality || 'MAKE YOUR MARK');
  }

  _updateHealth() {
    const size = TRACK_SIZE_PRESETS[this.draft.sizeId];
    const stats = this.validation?.stats;
    const length = stats?.length || 0;
    const ratio = length / Math.max(1, size.maxLength);
    const lengthState = !this.closed || !stats ? 'empty'
      : length < size.minLength || length > size.maxLength * 1.28 ? 'error'
        : length > size.maxLength ? 'warning'
          : length > size.maxLength * 0.88 ? 'near' : 'ok';
    const budget = this.root.querySelector('.kdt-length-budget');
    budget.dataset.state = lengthState;
    budget.querySelector('[data-role="length-current"]').textContent = stats ? `${Math.round(length)} m` : '0 m';
    budget.querySelector('[data-role="length-range"]').textContent = `Recommended ${size.minLength}–${size.maxLength} m`;
    budget.querySelector('i > b').style.width = `${clamp(ratio * 100, 0, 100)}%`;
    let lengthMessage = 'Draw a loop';
    if (stats) {
      if (length < size.minLength) lengthMessage = `${Math.round(size.minLength - length)} m short — expand automatically`;
      else if (length > size.maxLength) lengthMessage = `${Math.round(length - size.maxLength)} m over — shorten automatically`;
      else lengthMessage = `${Math.round(size.maxLength - length)} m remaining`;
    }
    budget.querySelector('[data-role="length-message"]').textContent = lengthMessage;

    const issues = this.validation?.issues || [];
    const first = (predicate) => issues.find(predicate);
    const checks = [
      { label: 'Loop closed', issue: this.closed ? null : { id: 'open-loop', message: 'Release inside the checkered circle' }, ok: this.closed },
      { label: 'Length', issue: first((item) => ['too-short', 'extreme-length', 'too-long', 'length-near-limit'].includes(item.id)), ok: !!stats && length >= size.minLength && length <= size.maxLength },
      { label: 'Corner radius', issue: first((item) => item.id === 'tight-corner' || item.id === 'corner-rounded'), ok: !!stats && !first((item) => item.id === 'tight-corner') },
      { label: 'Road clearance', issue: first((item) => item.id.startsWith('clearance-') || item.id.startsWith('intersection-') || item.id === 'layout-bounds'), ok: !!stats && !first((item) => item.id.startsWith('clearance-') || item.id.startsWith('intersection-') || item.id === 'layout-bounds') },
      { label: 'Crossings / overpasses', issue: first((item) => item.id.startsWith('intersection-') || item.id.startsWith('overpass-')), ok: !!stats && !first((item) => item.id.startsWith('intersection-')) },
      {
        label: 'Placed features',
        issue: this.featureDiagnostics?.find((item) => !item.valid)
          ? { id: 'feature-placement', severity: 'error', message: this.featureDiagnostics.find((item) => !item.valid).message }
          : null,
        ok: !this.featureDiagnostics?.some((item) => !item.valid),
      },
      { label: 'Start grid', issue: first((item) => item.id.startsWith('grid-')), ok: !!stats && !first((item) => item.id.startsWith('grid-')) },
      { label: 'AI safety route', issue: first((item) => item.id === 'invalid-geometry' || item.id === 'tight-corner'), ok: !!stats && !first((item) => item.id === 'invalid-geometry' || item.id === 'tight-corner') },
    ];
    this.root.querySelector('[data-role="checklist"]').innerHTML = checks.map((check) => {
      const state = !this.closed ? 'pending' : check.issue?.severity === 'error' || (!check.ok && check.issue) ? 'error'
        : check.issue ? 'warning' : check.ok ? 'ok' : 'pending';
      const issueId = check.issue?.id || '';
      const title = check.issue?.message || (check.ok ? 'Ready' : 'Waiting');
      return `<button type="button" data-check-state="${state}" ${issueId ? `data-action="focus-issue" data-issue="${escapeHtml(issueId)}"` : ''} title="${escapeHtml(title)}"><i>${state === 'ok' ? '✓' : state === 'error' ? '!' : state === 'warning' ? '•' : '○'}</i><span>${escapeHtml(check.label)}</span></button>`;
    }).join('');
    const errors = this.validation?.errors?.length || 0;
    const warnings = issues.filter((item) => item.severity === 'warning').length;
    this.root.querySelector('[data-role="health-summary"]').textContent = !this.closed ? 'Draw one loop'
      : errors ? `${errors} fix${errors === 1 ? '' : 'es'} needed`
        : warnings ? `Raceable · ${warnings} note${warnings === 1 ? '' : 's'}` : 'Race ready';
    const repairActions = this.root.querySelector('.kdt-repair-actions');
    repairActions.hidden = !this.repairPreview;
    if (this.repairPreview) repairActions.querySelector('[data-role="repair-summary"]').textContent = this.repairPreview.actions.join(' · ');
  }

  _syncStageFlow() {
    const shapeErrors = (this.validation?.errors || []).filter((issue) => !issue.id.startsWith('grid-'));
    const gridErrors = (this.validation?.errors || []).filter((issue) => issue.id.startsWith('grid-'));
    let active = 'draw';
    if (this.closed) {
      if (shapeErrors.length) active = 'adjust';
      else if (this.editorStage === 'race' && gridErrors.length) active = 'start';
      else active = ['adjust', 'place', 'start', 'race'].includes(this.editorStage)
        ? this.editorStage
        : 'adjust';
    }
    this.root.dataset.editorStage = active;
    const order = ['draw', 'adjust', 'place', 'start', 'race'];
    const activeIndex = order.indexOf(active);
    this.root.querySelectorAll('[data-stage]').forEach((node) => {
      const index = order.indexOf(node.dataset.stage);
      node.classList.toggle('is-active', index === activeIndex);
      node.classList.toggle('is-done', index < activeIndex);
    });
    const help = this.root.querySelector('.kdt-canvas-help');
    if (help) {
      const copy = {
        draw: ['DRAW', 'Release inside the checkered circle'],
        adjust: ['ADJUST', 'Select a crossing · drag the road · pull a handle'],
        place: ['PLACE', 'Choose a feature, then stamp it onto the road'],
        start: ['START / FINISH', 'Drag the checkered gate to a safe straight'],
        race: ['TEST / RACE', 'Test-drive, save, share, or build the full event'],
      }[active];
      help.querySelector('b').textContent = copy[0];
      help.querySelector('span').textContent = copy[1];
    }
    const hint = this.root.querySelector('.kdt-controller-hint');
    if (hint) hint.textContent = active === 'adjust'
      ? 'LEFT STICK · CURSOR   A · SELECT / DRAG   D-PAD · BRIDGE CHOICE   X · UNDO'
      : active === 'place'
        ? 'LEFT STICK · CURSOR   A · PLACE / SELECT   B · CANCEL   Y · DUPLICATE'
        : active === 'start'
          ? 'LEFT STICK · CURSOR   A · MOVE GRID   B · CANCEL   LB · FIT VIEW'
          : 'LEFT STICK · CURSOR   A · DRAW   X · UNDO   Y · CLEAR';
  }

  setEditorStage(stage) {
    if (!['draw', 'adjust', 'place', 'start', 'race'].includes(stage)) return;
    if (!this.closed && stage !== 'draw') {
      this.toast('Close a basic loop before opening the next workbench', 'error');
      return;
    }
    if (stage === 'draw' && this.closed) stage = 'adjust';
    if (stage === 'race' && !this.validation?.valid) {
      this.toast(this.validation?.errors?.[0]?.message || 'Repair the course before test driving', 'error');
      return;
    }
    this.editorStage = stage;
    this.startMoveArmed = stage === 'start';
    if (stage === 'place' && !this.selectedPlacementId) this.featureStampArmed = true;
    if (stage !== 'place') {
      this.placementGhost = null;
      this.placementGesture = null;
    }
    this.root.querySelector('[data-action="start"]')?.classList.toggle('is-active', this.startMoveArmed);
    if (stage !== 'adjust') this.closeCrossing();
    this._syncStageFlow();
    this._syncFeatureWorkbench();
    this.requestDraw();
  }

  _featureRuntimeSamples() {
    const source = this.validation?.samples || [];
    return source.map((point, index) => {
      const before = source[(index - 1 + source.length) % source.length] || point;
      const after = source[(index + 1) % source.length] || point;
      const dx = after.x - before.x;
      const dz = after.y - before.y;
      const length = Math.hypot(dx, dz) || 1;
      return {
        x: point.x,
        y: 0,
        z: point.y,
        tangent: { x: dx / length, y: 0, z: dz / length },
        normal: { x: -dz / length, y: 0, z: dx / length },
      };
    });
  }

  _authoredFraction(runtimeFraction) {
    const start = this.draft.startFraction;
    const value = this.draft.reverse
      ? 1 - start - runtimeFraction
      : start + runtimeFraction;
    return ((value % 1) + 1) % 1;
  }

  _featurePlacementPoint(placement) {
    const samples = this.validation?.normalizedSamples || [];
    const world = this.validation?.samples || [];
    if (!samples.length || !placement?.anchor) return null;
    const fraction = circuitRuntimeFraction(placement.anchor.fraction, {
      startFraction: this.draft.startFraction,
      reverse: this.draft.reverse,
    });
    const index = Math.round(fraction * samples.length) % samples.length;
    const point = samples[index];
    const before = samples[(index - 1 + samples.length) % samples.length];
    const after = samples[(index + 1) % samples.length];
    const pointScreen = this.normalizedToScreen(point);
    const beforeScreen = this.normalizedToScreen(before);
    const afterScreen = this.normalizedToScreen(after);
    const tx = afterScreen.x - beforeScreen.x;
    const ty = afterScreen.y - beforeScreen.y;
    const screenLength = Math.hypot(tx, ty) || 1;
    const worldBefore = world[(index - 1 + world.length) % world.length] || { x: 0, y: 0 };
    const worldAfter = world[(index + 1) % world.length] || { x: 1, y: 0 };
    const metresPerPixel = Math.hypot(
      worldAfter.x - worldBefore.x,
      worldAfter.y - worldBefore.y,
    ) / screenLength;
    const lateralPixels = placement.anchor.lateralOffset / Math.max(0.0001, metresPerPixel);
    const screen = {
      x: pointScreen.x + (-ty / screenLength) * lateralPixels,
      y: pointScreen.y + (tx / screenLength) * lateralPixels,
    };
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.screenToNormalized(screen.x, screen.y).x,
      y: this.screenToNormalized(screen.x, screen.y).y,
      screen,
      tangent: { x: tx / screenLength, y: ty / screenLength },
      index,
      fraction,
    };
  }

  _featureCandidate(point, base = null) {
    const samples = this.validation?.normalizedSamples || [];
    const world = this.validation?.samples || [];
    const feature = getCourseFeature(base?.featureId || this.selectedFeatureId);
    if (!feature || !samples.length) return null;
    const target = this.normalizedToScreen(point);
    let index = 0;
    let best = Infinity;
    for (let at = 0; at < samples.length; at++) {
      const screen = this.normalizedToScreen(samples[at]);
      const distance = Math.hypot(screen.x - target.x, screen.y - target.y);
      if (distance < best) { best = distance; index = at; }
    }
    const before = this.normalizedToScreen(samples[(index - 1 + samples.length) % samples.length]);
    const after = this.normalizedToScreen(samples[(index + 1) % samples.length]);
    const center = this.normalizedToScreen(samples[index]);
    const tx = after.x - before.x;
    const ty = after.y - before.y;
    const screenLength = Math.hypot(tx, ty) || 1;
    const worldBefore = world[(index - 1 + world.length) % world.length] || { x: 0, y: 0 };
    const worldAfter = world[(index + 1) % world.length] || { x: 1, y: 0 };
    const metresPerPixel = Math.hypot(
      worldAfter.x - worldBefore.x,
      worldAfter.y - worldBefore.y,
    ) / screenLength;
    const lateralOffset = clamp(
      ((target.x - center.x) * (-ty / screenLength) + (target.y - center.y) * (tx / screenLength))
        * metresPerPixel,
      -32,
      32,
    );
    const anchor = {
      mode: 'spline',
      fraction: this._authoredFraction(index / samples.length),
      lateralOffset,
      facing: base?.anchor?.facing || 'forward',
      rotationOffset: base?.anchor?.rotationOffset || 0,
      scaleX: base?.anchor?.scaleX || 1,
      scaleY: base?.anchor?.scaleY || 1,
      scaleZ: base?.anchor?.scaleZ || 1,
    };
    const placement = {
      id: base?.id || createCourseFeaturePlacementId(feature.id, this.draft.seed, this._placementOrdinal),
      featureId: feature.id,
      source: base?.source || 'manual',
      createdAt: base?.createdAt || 0,
      properties: { ...(base?.properties || {}) },
      anchor,
    };
    return this._validateFeature(placement);
  }

  _validateFeature(placement, {
    checkpointFractions = [],
    respawnFractions = [],
  } = {}) {
    const size = TRACK_SIZE_PRESETS[this.draft.sizeId];
    return validateCircuitFeaturePlacement(placement, {
      samples: this._featureRuntimeSamples(),
      routeLength: this.validation?.stats?.length || 1,
      trackWidth: TRACK_WIDTH_PRESETS[this.draft.widthId].width,
      startFraction: this.draft.startFraction,
      reverse: this.draft.reverse,
      overpasses: this.validation?.overpasses || [],
      placements: this.draft.featurePlacements,
      checkpointFractions,
      respawnFractions,
      buildBounds: {
        minX: -size.width,
        maxX: size.width,
        minZ: -size.depth,
        maxZ: size.depth,
      },
    });
  }

  selectedPlacement() {
    return this.draft.featurePlacements.find((placement) => placement.id === this.selectedPlacementId) || null;
  }

  hitFeaturePlacement(point) {
    const target = this.normalizedToScreen(point);
    let best = null;
    let bestDistance = Infinity;
    for (const placement of this.draft.featurePlacements) {
      const display = this._featurePlacementPoint(placement);
      if (!display) continue;
      const distance = Math.hypot(display.screen.x - target.x, display.screen.y - target.y);
      if (distance <= 31 && distance < bestDistance) {
        best = placement;
        bestDistance = distance;
      }
    }
    return best;
  }

  setFeatureCategory(id) {
    if (!COURSE_FEATURE_CATEGORIES.some((category) => category.id === id)) return;
    this.featureCategoryId = id;
    const features = listCourseFeatures({ mode: 'circuit', category: id });
    const cards = this.root.querySelector('[data-role="feature-cards"]');
    cards.innerHTML = features.map(featureCardHtml).join('');
    if (!features.some((feature) => feature.id === this.selectedFeatureId)) {
      this.selectFeature(features[0]?.id);
    } else {
      this._syncFeatureWorkbench();
    }
  }

  cycleFeatureCategory(direction) {
    const ids = COURSE_FEATURE_CATEGORIES.map((category) => category.id);
    const index = ids.indexOf(this.featureCategoryId);
    this.setFeatureCategory(ids[(index + direction + ids.length) % ids.length]);
  }

  selectFeature(id) {
    const feature = getCourseFeature(id);
    if (!feature?.compatibleModes.includes('circuit')) return;
    this.selectedFeatureId = id;
    this.selectedPlacementId = null;
    this.featureStampArmed = true;
    this.placementGhost = null;
    this._syncFeatureWorkbench();
    this.toast(`${feature.label} armed · tap the road to stamp`);
    this.requestDraw();
  }

  updatePlacementGhost(point) {
    if (!this.featureStampArmed || !this.closed) return;
    this.placementGhost = this._featureCandidate(point);
    this._syncFeatureWorkbench();
    this.requestDraw();
  }

  beginFeaturePointer(point, { repeat = false } = {}) {
    const hit = this.hitFeaturePlacement(point);
    if (hit) {
      this.pushHistory();
      this.selectedPlacementId = hit.id;
      this.selectedFeatureId = hit.featureId;
      this.featureStampArmed = false;
      this.placementGesture = {
        original: structuredClone(hit),
        repeat: false,
        moved: false,
        validation: this._validateFeature(hit),
      };
      this._syncFeatureWorkbench();
      this.requestDraw();
      return;
    }
    if (!this.featureStampArmed) {
      this.toast('Choose a palette asset, or tap a placed feature to edit it', 'error');
      return;
    }
    const candidate = this._featureCandidate(point);
    this.placementGhost = candidate;
    if (!candidate?.valid) {
      this.toast(candidate?.message || 'Outside build area', 'error');
      this._syncFeatureWorkbench();
      this.requestDraw();
      return;
    }
    this.pushHistory();
    this._placementOrdinal++;
    this.draft.featurePlacements.push(candidate.placement);
    this.selectedPlacementId = candidate.placement.id;
    this.placementGesture = {
      original: null,
      repeat,
      moved: false,
      validation: candidate,
    };
    this.featureStampArmed = !!repeat;
    this._syncFeatureWorkbench();
    this.requestDraw();
  }

  updateFeaturePointer(point) {
    if (!this.placementGesture || !this.selectedPlacementId) {
      this.updatePlacementGhost(point);
      return;
    }
    const current = this.selectedPlacement();
    const candidate = this._featureCandidate(point, current);
    if (!candidate) return;
    const index = this.draft.featurePlacements.findIndex((placement) => placement.id === current.id);
    this.draft.featurePlacements[index] = candidate.placement;
    this.placementGesture.moved = true;
    this.placementGesture.validation = candidate;
    this.placementGhost = candidate;
    this._syncFeatureWorkbench();
    this.requestDraw();
  }

  endFeaturePointer() {
    const gesture = this.placementGesture;
    if (!gesture) return;
    if (!gesture.validation?.valid) {
      if (gesture.original) {
        const index = this.draft.featurePlacements.findIndex((placement) => placement.id === this.selectedPlacementId);
        if (index >= 0) this.draft.featurePlacements[index] = gesture.original;
      } else {
        this.draft.featurePlacements = this.draft.featurePlacements
          .filter((placement) => placement.id !== this.selectedPlacementId);
        this.selectedPlacementId = null;
      }
      this.toast(gesture.validation?.message || 'Invalid placement', 'error');
    } else if (!gesture.repeat) {
      this.featureStampArmed = false;
      this.toast(gesture.moved ? 'Feature moved · history updated' : 'Feature placed · select it to transform');
    } else {
      this.selectedPlacementId = null;
      this.featureStampArmed = true;
      this.toast('Feature placed · Shift-repeat remains armed');
    }
    this.placementGesture = null;
    this.placementGhost = null;
    this.recalculate();
    this._syncFeatureWorkbench();
  }

  cancelFeatureTool() {
    if (this.placementGesture?.original) {
      const index = this.draft.featurePlacements.findIndex((placement) => placement.id === this.selectedPlacementId);
      if (index >= 0) this.draft.featurePlacements[index] = this.placementGesture.original;
    }
    this.placementGesture = null;
    this.placementGhost = null;
    this.featureStampArmed = false;
    this._syncFeatureWorkbench();
    this.requestDraw();
    this.toast('Placement cancelled');
  }

  transformSelectedFeature(kind) {
    const placement = this.selectedPlacement();
    if (!placement) return;
    const feature = getCourseFeature(placement.featureId);
    const step = feature.adjustableProperties.rotationOffset?.step || Math.PI / 12;
    const next = structuredClone(placement);
    if (kind === 'rotate-left') next.anchor.rotationOffset -= step;
    else if (kind === 'rotate-right') next.anchor.rotationOffset += step;
    else if (kind === 'flip') next.anchor.facing = next.anchor.facing === 'backward' ? 'forward' : 'backward';
    else if (kind === 'scale-down' || kind === 'scale-up') {
      const range = feature.adjustableProperties.scale || { min: 1, max: 1, step: 0.05 };
      const direction = kind === 'scale-up' ? 1 : -1;
      const scale = clamp(next.anchor.scaleX + direction * (range.step || 0.05), range.min, range.max);
      next.anchor.scaleX = scale;
      next.anchor.scaleY = scale;
      next.anchor.scaleZ = scale;
    }
    const result = this._validateFeature(next);
    if (!result.valid) {
      this.placementGhost = result;
      this._syncFeatureWorkbench();
      this.requestDraw();
      this.toast(result.message, 'error');
      return;
    }
    this.pushHistory();
    const index = this.draft.featurePlacements.findIndex((value) => value.id === placement.id);
    this.draft.featurePlacements[index] = result.placement;
    this.placementGhost = result;
    this.recalculate();
    this._syncFeatureWorkbench();
  }

  scaleSelectedFeature(direction) {
    this.transformSelectedFeature(direction > 0 ? 'scale-up' : 'scale-down');
  }

  nudgeSelectedFeature(amount) {
    const placement = this.selectedPlacement();
    if (!placement) return;
    const next = structuredClone(placement);
    next.anchor.lateralOffset = clamp(next.anchor.lateralOffset + amount, -32, 32);
    const result = this._validateFeature(next);
    if (!result.valid) {
      this.toast(result.message, 'error');
      return;
    }
    this.pushHistory();
    const index = this.draft.featurePlacements.findIndex((value) => value.id === placement.id);
    this.draft.featurePlacements[index] = result.placement;
    this.recalculate();
    this._syncFeatureWorkbench();
  }

  duplicateSelectedFeature() {
    const placement = this.selectedPlacement();
    if (!placement) return;
    const next = structuredClone(placement);
    next.id = createCourseFeaturePlacementId(next.featureId, this.draft.seed, ++this._placementOrdinal);
    next.anchor.fraction = ((next.anchor.fraction + 0.025) % 1 + 1) % 1;
    const result = this._validateFeature(next);
    if (!result.valid) {
      this.toast(result.message, 'error');
      return;
    }
    this.pushHistory();
    this.draft.featurePlacements.push(result.placement);
    this.selectedPlacementId = result.placement.id;
    this.recalculate();
    this._syncFeatureWorkbench();
    this.toast('Feature duplicated · drag it to its final position');
  }

  deleteSelectedFeature() {
    if (!this.selectedPlacementId) return;
    const feature = getCourseFeature(this.selectedPlacement()?.featureId);
    this.pushHistory();
    this.draft.featurePlacements = this.draft.featurePlacements
      .filter((placement) => placement.id !== this.selectedPlacementId);
    this.selectedPlacementId = null;
    this.placementGhost = null;
    this.recalculate();
    this._syncFeatureWorkbench();
    this.toast(`${feature?.label || 'Feature'} removed`);
  }

  testFromSelectedFeature() {
    const placement = this.selectedPlacement();
    if (!placement || !this.validation?.valid) return;
    this.testFromFraction = circuitRuntimeFraction(placement.anchor.fraction, {
      startFraction: this.draft.startFraction,
      reverse: this.draft.reverse,
    });
    this.build();
  }

  autoDress() {
    if (!this.closed || !this.validation?.valid) {
      this.toast('Finish a raceable loop before auto dressing', 'error');
      return;
    }
    this.pushHistory();
    const manual = this.draft.featurePlacements.filter((placement) => placement.source !== 'auto-dress');
    this.draft.featurePlacements = manual;
    const themePools = {
      countryside: ['direction-signs', 'rally-flags', 'foliage-group', 'billboard', 'crowd-section'],
      forest: ['foliage-group', 'direction-signs', 'floodlights', 'rally-flags', 'theme-landmark'],
      desert: ['rally-flags', 'billboard', 'construction-equipment', 'direction-signs', 'theme-landmark'],
      snow: ['floodlights', 'direction-signs', 'rally-flags', 'foliage-group', 'theme-landmark'],
      neon: ['floodlights', 'billboard', 'rally-flags', 'crowd-section', 'theme-landmark'],
      coastal: ['rally-flags', 'direction-signs', 'crowd-section', 'grandstand', 'theme-landmark'],
      industrial: ['construction-equipment', 'floodlights', 'billboard', 'direction-signs', 'theme-landmark'],
      arena: ['crowd-section', 'grandstand', 'floodlights', 'billboard', 'rally-flags'],
    };
    const pool = (themePools[this.draft.themeId] || listCourseFeatures({
      mode: 'circuit',
      category: 'scenery',
    }).map((feature) => feature.id)).map(getCourseFeature).filter(Boolean);
    const target = ({
      pocket: 4,
      club: 6,
      grand: 8,
      epic: 10,
      mega: 14,
      colossal: 18,
    })[this.draft.sizeId] || 6;
    const routeLength = this.validation.stats.length;
    const checkpointCount = clamp(Math.round(routeLength / 28), 8, 18);
    const checkpointFractions = Array.from({ length: checkpointCount - 1 }, (_, index) => (
      (this.draft.startFraction + (index + 1) / checkpointCount) % 1
    ));
    let added = 0;
    for (let attempt = 0; attempt < target * 12 && added < target; attempt++) {
      const feature = pool[
        Math.floor(seededUnit(this.draft.seed ^ 0x4b414b49, attempt) * pool.length) % pool.length
      ];
      const side = seededUnit(this.draft.seed ^ 0x51ed270b, attempt) < 0.5 ? -1 : 1;
      const lateral = side * clamp(
        TRACK_WIDTH_PRESETS[this.draft.widthId].width * 0.5 + feature.footprint.width * 0.5 + 1.4,
        5.5,
        19,
      );
      const placement = {
        id: `auto-dress-${(this.draft.seed >>> 0).toString(36)}-${attempt.toString(36)}`,
        featureId: feature.id,
        source: 'auto-dress',
        createdAt: 0,
        properties: {},
        anchor: {
          mode: 'spline',
          fraction: seededUnit(this.draft.seed ^ 0xa5a5a5a5, attempt),
          lateralOffset: lateral,
          facing: seededUnit(this.draft.seed ^ 0xc3c3c3c3, attempt) < 0.5 ? 'forward' : 'backward',
          rotationOffset: 0,
          scaleX: 1,
          scaleY: 1,
          scaleZ: 1,
        },
      };
      const result = this._validateFeature(placement, {
        checkpointFractions,
        respawnFractions: checkpointFractions,
      });
      if (!result.valid) continue;
      this.draft.featurePlacements.push(result.placement);
      added++;
    }
    this.selectedPlacementId = null;
    this.placementGhost = null;
    this.recalculate();
    this._syncFeatureWorkbench();
    this.toast(
      added
        ? `${added} theme-aware details placed · manual work untouched`
        : 'No safe Auto Dress locations remain',
      added ? 'ok' : 'error',
    );
  }

  clearAutoDress() {
    const count = this.draft.featurePlacements.filter((placement) => placement.source === 'auto-dress').length;
    if (!count) {
      this.toast('No Auto Dress details to remove');
      return;
    }
    this.pushHistory();
    this.draft.featurePlacements = this.draft.featurePlacements
      .filter((placement) => placement.source !== 'auto-dress');
    this.selectedPlacementId = null;
    this.placementGhost = null;
    this.recalculate();
    this._syncFeatureWorkbench();
    this.toast(`${count} Auto Dress details removed · manual work preserved`);
  }

  _syncFeatureWorkbench() {
    const panel = this.root?.querySelector('.kdt-feature-workbench');
    if (!panel) return;
    panel.hidden = this.editorStage !== 'place' || !this.closed;
    panel.querySelector('[data-role="feature-count"]').textContent = String(this.draft.featurePlacements.length);
    panel.querySelectorAll('[data-feature-category]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.featureCategory === this.featureCategoryId);
    });
    panel.querySelectorAll('[data-feature-id]').forEach((button) => {
      button.classList.toggle(
        'is-selected',
        button.dataset.featureId === this.selectedFeatureId && this.featureStampArmed,
      );
    });
    const placement = this.selectedPlacement();
    const feature = getCourseFeature(placement?.featureId || this.selectedFeatureId);
    if (!feature) return;
    const preview = panel.querySelector('[data-role="feature-preview"]');
    preview.setAttribute('style', featureThumbnailStyle(feature));
    panel.querySelector('[data-role="feature-name"]').textContent = feature.label.toUpperCase();
    panel.querySelector('[data-role="feature-anchor"]').textContent = placement
      ? `${Math.round(placement.anchor.fraction * 100)}% ROUTE · ${placement.anchor.lateralOffset.toFixed(1)} m LATERAL · ${placement.anchor.scaleX.toFixed(2)}×`
      : this.featureStampArmed ? 'ARMED · TAP ROAD TO STAMP' : 'SELECT · THEN TAP ROAD';
    const result = this.placementGhost || (placement ? this._validateFeature(placement) : null);
    const message = panel.querySelector('[data-role="feature-message"]');
    message.dataset.state = result ? result.valid ? result.warning ? 'warning' : 'valid' : 'invalid' : 'valid';
    message.textContent = result?.message || 'Choose a final asset and stamp it onto the racing line.';
    panel.querySelectorAll('.kdt-feature-transform button').forEach((button) => {
      button.disabled = !placement;
    });
  }

  focusIssue(id) {
    const issue = this.validation?.issues?.find((item) => item.id === id);
    if (!issue?.normalizedPoint) {
      if (id === 'open-loop') this.fitView();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const limits = this.zoomLimits();
    this.view.zoom = clamp(1.75, limits.min, limits.max);
    this.view.panX = (0.5 - issue.normalizedPoint.x) * rect.width * this.view.zoom;
    this.view.panY = (0.5 - issue.normalizedPoint.y) * rect.height * this.view.zoom;
    this.requestDraw();
    this.toast(issue.message, issue.severity === 'error' ? 'error' : 'ok');
  }

  fitView() {
    const points = this.validation?.normalizedSamples?.length
      ? this.validation.normalizedSamples
      : this.displayPoints(this.draft.controlPoints);
    const bounds = pointsBounds(points);
    const limits = this.zoomLimits();
    if (!bounds || !this.closed) {
      this.view.zoom = clamp(1, limits.min, limits.max);
      this.view.panX = 0;
      this.view.panY = 0;
      this.requestDraw();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const horizontalRoom = rect.width < 760 ? 0.88 : 0.82;
    const verticalRoom = rect.height < 520 ? 0.78 : 0.84;
    this.view.zoom = clamp(Math.min(
      horizontalRoom / Math.max(0.04, bounds.width),
      verticalRoom / Math.max(0.04, bounds.height),
    ), limits.min, limits.max);
    this.view.panX = (0.5 - bounds.centerX) * rect.width * this.view.zoom;
    this.view.panY = (0.5 - bounds.centerY) * rect.height * this.view.zoom;
    this.requestDraw();
  }

  closeLoop() {
    if (this.closed || this.draft.rawStroke.length < 18) return;
    this.pushHistory();
    this._completeClosure({ forceConnector: true });
  }

  autoPlaceStart() {
    if (!this.closed || !this.validation?.stats) return;
    this.pushHistory();
    this.draft.startFraction = this.validation.suggestedStartFraction;
    this.startTouched = false;
    this.lastInteraction = 'start';
    this.editorStage = 'start';
    this.recalculate();
    this.toast('Start / finish moved to the safest straight');
  }

  _syncControls() {
    this.root.querySelectorAll('[data-theme]').forEach((button) => button.classList.toggle('is-selected', button.dataset.theme === this.draft.themeId));
    this.root.querySelectorAll('[data-size]').forEach((button) => button.classList.toggle('is-selected', button.dataset.size === this.draft.sizeId));
    this.root.querySelectorAll('[data-width]').forEach((button) => button.classList.toggle('is-selected', button.dataset.width === this.draft.widthId));
    this.root.querySelector('[data-setting="smoothing"]').value = String(Math.round(this.draft.smoothing * 100));
    this.root.querySelector('[data-role="smoothing"]').textContent = `${Math.round(this.draft.smoothing * 100)}%`;
    this.root.querySelector('[data-setting="reverse"]').checked = this.draft.reverse;
    this.root.querySelectorAll('[data-modifier]').forEach((input) => { input.checked = !!this.draft.modifiers[input.dataset.modifier]; });
    const size = TRACK_SIZE_PRESETS[this.draft.sizeId];
    const theme = DRAW_TRACK_THEMES[this.draft.themeId] || DRAW_TRACK_THEMES.countryside;
    const worldPreview = this.root.querySelector('[data-role="world-preview"]');
    if (worldPreview) {
      worldPreview.dataset.mapKind = theme.mapKind || 'hills';
      worldPreview.style.setProperty('--kdt-map-sky-top', theme.skyTop || '#78b9d0');
      worldPreview.style.setProperty('--kdt-map-sky-horizon', theme.skyHorizon || '#f4c27b');
      worldPreview.style.setProperty('--kdt-map-ground', theme.mapGround || '#667c4c');
      worldPreview.style.setProperty('--kdt-map-accent', theme.mapAccent || '#ffe0a3');
      worldPreview.querySelector('[data-role="world-venue"]').textContent = theme.venue || theme.name;
      worldPreview.querySelector('[data-role="world-sky"]').textContent = theme.skyName || 'RALLY SKY';
    }
    this.root.querySelector('[data-role="scale-name"]').textContent = size.label.toUpperCase();
    const layout = this.draft.layoutTransform;
    this.root.querySelector('[data-role="scale-size"]').textContent = this.closed
      ? `${Math.round(size.width * layout.occupancy * layout.scaleX)} × ${Math.round(size.depth * layout.occupancy * layout.scaleY)} m layout`
      : `${size.width} × ${size.depth} m`;
    this._syncButtons();
  }

  _syncButtons() {
    const featureIssue = this.featureDiagnostics?.find((item) => !item.valid);
    const ready = !!this.validation?.valid && !featureIssue && !this.repairPreview;
    this.root.querySelector('[data-action="build"]').disabled = !ready;
    this.root.querySelector('[data-action="save"]').disabled = !ready;
    this.root.querySelector('[data-action="share"]').disabled = !ready;
    this.root.querySelector('[data-action="undo"]').disabled = !this.history.length;
    this.root.querySelector('[data-action="redo"]').disabled = !this.future.length;
    const repair = this.root.querySelector('[data-action="repair"]');
    repair.classList.toggle('is-active', !!this.repairPreview);
    repair.querySelector('b').textContent = this.repairPreview ? 'PREVIEW' : 'FIX';
    const closeLoop = this.root.querySelector('[data-action="close-loop"]');
    closeLoop.hidden = this.closed || !this.closureState?.nearby;
    const autoStart = this.root.querySelector('[data-action="auto-start"]');
    autoStart.hidden = !this.closed;
    const explain = this.root.querySelector('[data-role="build-explain"]');
    if (explain) explain.textContent = this.repairPreview ? 'Apply or cancel the repair preview'
      : !this.closed ? 'Close the loop to build'
        : this.validation?.errors?.length ? this.validation.errors[0].message
          : featureIssue ? featureIssue.message
          : 'Ready to race';
  }

  setTheme(id) {
    if (!DRAW_TRACK_THEMES[id] || id === this.draft.themeId) return;
    this.pushHistory();
    this.draft.themeId = id;
    this.draft.seed = (this.draft.seed ^ (DRAW_TRACK_THEME_ORDER.indexOf(id) + 1) * 2654435761) >>> 0;
    this._syncControls();
    this.recalculate();
  }

  setSize(id) {
    if (!TRACK_SIZE_PRESETS[id] || id === this.draft.sizeId) return;
    this.pushHistory();
    this.draft.sizeId = id;
    this.draft.laps = TRACK_SIZE_PRESETS[id].laps;
    this._syncControls();
    this.recalculate({ allowSuggestedStart: !this.startTouched });
  }

  setWidth(id) {
    if (!TRACK_WIDTH_PRESETS[id] || id === this.draft.widthId) return;
    this.pushHistory();
    this.draft.widthId = id;
    this._syncControls();
    this.recalculate();
  }

  stepWidth(direction) {
    const index = WIDTH_ORDER.indexOf(this.draft.widthId);
    this.setWidth(WIDTH_ORDER[clamp(index + direction, 0, WIDTH_ORDER.length - 1)]);
  }

  action(name, button) {
    if (name === 'exit') this.exit();
    else if (name === 'undo') this.undo();
    else if (name === 'redo') this.redo();
    else if (name === 'smooth') this.smooth();
    else if (name === 'repair') this.repair();
    else if (name === 'start') {
      this.startMoveArmed = !this.startMoveArmed;
      this.editorStage = this.startMoveArmed ? 'start' : 'adjust';
      button.classList.toggle('is-active', this.startMoveArmed);
      this._syncStageFlow();
      this.toast(this.startMoveArmed ? 'Tap or drag anywhere on the route to place the grid' : 'Start-line tool cancelled');
    }
    else if (name === 'clear') this.clear(button);
    else if (name === 'build') this.build();
    else if (name === 'save') this.save();
    else if (name === 'share') this.openCode(true);
    else if (name === 'import') this.openCode(false);
    else if (name === 'gallery') this.openGallery();
    else if (name === 'close-gallery') this.closeGallery();
    else if (name === 'fit-view') this.fitView();
    else if (name === 'close-loop') this.closeLoop();
    else if (name === 'auto-start') this.autoPlaceStart();
    else if (name === 'apply-repair') this.applyRepair();
    else if (name === 'cancel-repair') this.cancelRepair();
    else if (name === 'focus-issue') this.focusIssue(button.dataset.issue);
    else if (name === 'close-crossing') this.closeCrossing();
    else if (name === 'feature-rotate-left') this.transformSelectedFeature('rotate-left');
    else if (name === 'feature-rotate-right') this.transformSelectedFeature('rotate-right');
    else if (name === 'feature-flip') this.transformSelectedFeature('flip');
    else if (name === 'feature-scale-down') this.transformSelectedFeature('scale-down');
    else if (name === 'feature-scale-up') this.transformSelectedFeature('scale-up');
    else if (name === 'feature-duplicate') this.duplicateSelectedFeature();
    else if (name === 'feature-delete') this.deleteSelectedFeature();
    else if (name === 'feature-test') this.testFromSelectedFeature();
    else if (name === 'auto-dress') this.autoDress();
    else if (name === 'clear-auto-dress') this.clearAutoDress();
    else if (name === 'toggle-feature-workbench') {
      const workbench = this.root.querySelector('.kdt-feature-workbench');
      const collapsed = workbench.classList.toggle('is-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', collapsed ? 'Expand feature palette' : 'Collapse feature palette');
      button.textContent = collapsed ? '⌃' : '⌄';
      this.requestDraw();
    }
    else if (name === 'options') {
      const open = this.root.classList.toggle('is-inspector-open');
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? '× CLOSE SETUP' : '⚙ TRACK SETUP';
    }
    else if (name === 'skip-build') this.finishBuild();
  }

  smooth() {
    if (this.draft.rawStroke.length < 6) return;
    this.pushHistory();
    this.draft.rawStroke = TrackSpline.clean(this.draft.rawStroke, clamp(this.draft.smoothing + 0.1, 0, 1));
    this.sampler.reset(this.draft.rawStroke);
    this.lastInteraction = this.closed ? 'adjust' : 'draw';
    this.editorStage = this.closed ? 'adjust' : 'draw';
    this.recalculate({ allowSuggestedStart: !this.startTouched });
    this.toast('Line cleaned while keeping the authored corners');
  }

  repair() {
    if (!this.draft.rawStroke.length) return;
    if (this.repairPreview) {
      this.applyRepair();
      return;
    }
    this.repairPreview = TrackRepair.proposeDetailed(this.draft.rawStroke, {
      smoothing: this.draft.smoothing,
      sizeId: this.draft.sizeId,
      widthId: this.draft.widthId,
      layoutTransform: this.draft.layoutTransform,
      validation: this.validation,
    });
    this.recalculate();
    this.toast('Before / after preview shown · Apply or Cancel');
  }

  applyRepair() {
    if (!this.repairPreview) return;
    this.pushHistory();
    this.draft.rawStroke = this.repairPreview.points.map((point) => ({ ...point }));
    this.draft.layoutTransform = { ...this.repairPreview.layoutTransform };
    this.sampler.reset(this.draft.rawStroke);
    this.repairPreview = null;
    this.closed = true;
    this.layoutReady = true;
    this.lastInteraction = 'adjust';
    this.editorStage = 'adjust';
    this.recalculate({ allowSuggestedStart: true });
    this.toast('Make Raceable repair applied · Undo restores the exact previous track');
  }

  cancelRepair() {
    if (!this.repairPreview) return;
    this.repairPreview = null;
    this.recalculate();
    this.toast('Repair preview cancelled');
  }

  clear(button) {
    if (!this.draft.rawStroke.length) return;
    clearTimeout(this._clearTimer);
    this.pushHistory();
    this.draft.rawStroke = [];
    this.draft.controlPoints = [];
    this.sampler.reset();
    this.closed = false;
    this.layoutReady = false;
    this.draft.layoutTransform = { ...DEFAULT_LAYOUT_TRANSFORM };
    this.closureState = null;
    this.repairPreview = null;
    this.validation = null;
    this.draft.crossingOverrides = [];
    this.draft.featurePlacements = [];
    this.selectedCrossingId = null;
    this.selectedCrossingReference = null;
    this.selectedPlacementId = null;
    this.placementGhost = null;
    this.featureStampArmed = false;
    this.editorStage = 'draw';
    button.classList.remove('is-confirming');
    button.querySelector('b').textContent = 'CLEAR';
    this.recalculate();
    this.toast('Track cleared · Undo brings it back');
  }

  currentDraft() {
    return {
      ...this.draft,
      name: this.root.querySelector('.kdt-name input').value.trim() || this.draft.name,
      rawStroke: this.draft.rawStroke.map((point) => ({ ...point })),
      controlPoints: this.draft.controlPoints.map((point) => ({ ...point })),
      crossingOverrides: sanitizeCrossingOverrides(this.draft.crossingOverrides),
      featurePlacements: structuredClone(this.draft.featurePlacements),
      stats: this.validation?.stats ? {
        length: this.validation.stats.length,
        estimatedLapTime: this.validation.stats.estimatedLapTime,
        cornerCount: this.validation.stats.cornerCount,
        difficulty: this.validation.stats.difficulty,
        personality: this.validation.stats.personality,
      } : null,
    };
  }

  save() {
    const featureIssue = this.featureDiagnostics?.find((item) => !item.valid);
    if (!this.validation?.valid || featureIssue) {
      if (featureIssue) this.toast(featureIssue.message, 'error');
      return;
    }
    try {
      const result = this.gallery.save(this.currentDraft());
      this.draft = { ...this.draft, ...result.track };
      this.toast(result.pruned ? `Saved · ${result.pruned} old track removed to free space` : 'Track saved to your local gallery');
      this._renderGallerySummary();
    } catch (error) {
      this.toast(error.message || 'Track could not be saved', 'error');
    }
  }

  build() {
    const featureIssue = this.featureDiagnostics?.find((item) => !item.valid);
    if (!this.validation?.valid || featureIssue || this.root.classList.contains('is-building')) {
      if (featureIssue) this.toast(featureIssue.message, 'error');
      return;
    }
    const draft = this.currentDraft();
    let course;
    try { course = compileDrawTrackCourse(draft, this.validation); }
    catch (error) { this.toast(error.message || 'Track generation failed', 'error'); return; }
    this.pendingBuild = {
      draft,
      course,
      validation: this.validation,
      testFromFraction: Number.isFinite(this.testFromFraction) ? this.testFromFraction : null,
    };
    this.testFromFraction = null;
    const reveal = this.root.querySelector('.kdt-build-reveal');
    reveal.hidden = false;
    reveal.querySelector('[data-role="build-name"]').textContent = course.name;
    this.root.classList.add('is-building');
    const stages = [
      'CLEANING THE RACING LINE', 'LAYING ROAD & SHOULDERS', 'RAISING BARRIERS & OVERPASSES',
      'PLACING KAKI LANDMARKS', 'RUNNING THE AI SAFETY LAP', 'ROLLING TO THE GRID',
    ];
    let stage = 0;
    const stageNode = reveal.querySelector('[data-role="build-stage"]');
    this._buildStageTimer = setInterval(() => {
      stage = Math.min(stages.length - 1, stage + 1);
      stageNode.textContent = stages[stage];
    }, 650);
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    this._buildTimer = setTimeout(() => this.finishBuild(), reducedMotion ? 280 : 4100);
  }

  finishBuild() {
    if (!this.pendingBuild) return;
    clearTimeout(this._buildTimer);
    clearInterval(this._buildStageTimer);
    const payload = this.pendingBuild;
    this.pendingBuild = null;
    this.destroy({ callExit: false });
    this.onBuild?.(payload);
  }

  openCode(withCurrent) {
    const dialog = this.root.querySelector('.kdt-code-dialog');
    const area = dialog.querySelector('textarea');
    const message = dialog.querySelector('[data-role="code-message"]');
    if (withCurrent && this.validation?.valid) {
      try {
        area.value = TrackCodeCodec.encode(this.currentDraft());
        message.textContent = `${area.value.length} characters · ready to copy or import anywhere.`;
      } catch (error) { message.textContent = error.message; }
    } else {
      area.value = '';
      message.textContent = 'Paste a KDT1- code. Corrupt or unsupported data is rejected safely.';
    }
    dialog.showModal?.();
    if (!dialog.open) dialog.setAttribute('open', '');
    setTimeout(() => area.focus(), 0);
  }

  async codeAction(action) {
    const dialog = this.root.querySelector('.kdt-code-dialog');
    const area = dialog.querySelector('textarea');
    const message = dialog.querySelector('[data-role="code-message"]');
    if (action === 'copy') {
      if (!this.validation?.valid) { message.textContent = 'Finish a valid loop before copying a code.'; return; }
      const code = TrackCodeCodec.encode(this.currentDraft());
      area.value = code;
      try { await navigator.clipboard.writeText(code); message.textContent = 'Track code copied.'; }
      catch (_) { area.select(); document.execCommand?.('copy'); message.textContent = 'Track code selected for copying.'; }
      return;
    }
    if (action === 'load') {
      try {
        const imported = TrackCodeCodec.decode(area.value);
        this.pushHistory();
        this.draft = defaultDraft(imported);
        this.closed = true;
        this.layoutReady = true;
        this.sampler.reset(this.draft.rawStroke);
        this.startTouched = true;
        dialog.close?.();
        dialog.removeAttribute('open');
        this.root.querySelector('.kdt-name input').value = this.draft.name;
        this._syncControls();
        this.recalculate();
        this.toast('Track code imported and validated');
      } catch (error) {
        message.textContent = error.message || 'Track code could not be imported.';
      }
    }
  }

  _renderGallerySummary() {
    const summary = this.gallery.summary();
    this.root.querySelector('[data-role="save-count"]').textContent = String(summary.count);
  }

  openGallery(sort = 'newest') {
    const panel = this.root.querySelector('.kdt-gallery');
    const tracks = this.gallery.list(sort);
    panel.hidden = false;
    panel.innerHTML = `
      <header><div><span>LOCAL WORKSHOP</span><h2>YOUR TRACKS</h2></div><label>SORT <select data-gallery-sort><option value="newest">Newest</option><option value="favorite">Favorite</option><option value="best">Best time</option><option value="raced">Most raced</option></select></label><button type="button" data-action="close-gallery">×</button></header>
      <div class="kdt-gallery-grid">${tracks.length ? tracks.map((track) => `
        <article data-track-id="${escapeHtml(track.id)}">
          <svg viewBox="0 0 320 180" aria-label="${escapeHtml(track.name)} minimap"><path d="${pointPath(track.controlPoints.map((point) => applyLayoutToPoint(track.modifiers?.mirror ? { x: 1 - point.x, y: point.y } : point, track.layoutTransform)))}"></path><circle cx="20" cy="20" r="4"></circle></svg>
          <div><span>${escapeHtml(DRAW_TRACK_THEMES[track.themeId]?.name || 'Kaki Rally')} · ${escapeHtml(TRACK_SIZE_PRESETS[track.sizeId]?.label || 'Club')}</span><h3>${escapeHtml(track.name)}</h3><p>${track.bestLap ? `BEST ${formatTime(track.bestLap)}` : 'NO LAP TIME'} · RACED ${track.raceCount || 0}×</p></div>
          <footer><button type="button" data-gallery-action="load">LOAD</button><button type="button" data-gallery-action="favorite">${track.favorite ? '★' : '☆'}</button><button type="button" data-gallery-action="duplicate">COPY</button><button type="button" data-gallery-action="rename">RENAME</button><button type="button" data-gallery-action="delete">DELETE</button></footer>
        </article>`).join('') : '<div class="kdt-gallery-empty"><b>NO TRACKS YET</b><span>Close this drawer, draw a loop, then press Save.</span></div>'}</div>`;
    panel.querySelector('[data-gallery-sort]').value = sort;
    panel.querySelector('[data-gallery-sort]').addEventListener('change', (event) => this.openGallery(event.target.value));
  }

  closeGallery() {
    this.root.querySelector('.kdt-gallery').hidden = true;
  }

  galleryAction(button) {
    const article = button.closest('[data-track-id]');
    const id = article?.dataset.trackId;
    if (!id) return;
    const action = button.dataset.galleryAction;
    if (action === 'load') {
      const track = this.gallery.get(id);
      if (!track) return;
      this.pushHistory();
      this.draft = defaultDraft(track);
      this.closed = true;
      this.layoutReady = true;
      this.sampler.reset(this.draft.rawStroke);
      this.root.querySelector('.kdt-name input').value = this.draft.name;
      this.closeGallery();
      this._syncControls();
      this.recalculate();
      this.toast('Saved track loaded');
    } else if (action === 'favorite') {
      this.gallery.toggleFavorite(id);
      this.openGallery('favorite');
    } else if (action === 'duplicate') {
      this.gallery.duplicate(id);
      this.openGallery('newest');
      this._renderGallerySummary();
    } else if (action === 'rename') {
      const track = this.gallery.get(id);
      const next = window.prompt('Rename track', track?.name || '');
      if (next != null) { this.gallery.rename(id, next); this.openGallery('newest'); }
    } else if (action === 'delete') {
      if (!button.classList.contains('is-confirming')) {
        button.classList.add('is-confirming');
        button.textContent = 'CONFIRM';
      } else {
        this.gallery.delete(id);
        this.openGallery('newest');
        this._renderGallerySummary();
      }
    }
  }

  keydown(event) {
    if (!this.root?.isConnected) return;
    const interactive = event.target?.matches?.('input, textarea, select');
    if (event.code === 'Space' && !interactive) { event.preventDefault(); this.input.spacePan = true; return; }
    if (interactive && event.key !== 'Escape') return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? this.redo() : this.undo();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault(); this.redo();
    } else if (event.key === 'Enter' && this.validation?.valid) {
      event.preventDefault(); this.build();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      const dialog = this.root.querySelector('.kdt-code-dialog');
      if (dialog.open || dialog.hasAttribute('open')) { dialog.close?.(); dialog.removeAttribute('open'); }
      else if (this.editorStage === 'place' && (this.featureStampArmed || this.selectedPlacementId)) {
        this.selectedPlacementId = null;
        this.cancelFeatureTool();
      }
      else if (this.selectedCrossing()) this.closeCrossing();
      else if (this.repairPreview) this.cancelRepair();
      else if (!this.root.querySelector('.kdt-gallery').hidden) this.closeGallery();
      else if (this.root.classList.contains('is-inspector-open')) this.action('options', this.root.querySelector('[data-action="options"]'));
      else this.exit();
    } else if (this.editorStage === 'place' && event.key.toLowerCase() === 'q') {
      event.preventDefault(); this.transformSelectedFeature('rotate-left');
    } else if (this.editorStage === 'place' && event.key.toLowerCase() === 'e') {
      event.preventDefault(); this.transformSelectedFeature('rotate-right');
    } else if (this.editorStage === 'place' && event.key.toLowerCase() === 'r') {
      event.preventDefault(); this.transformSelectedFeature('flip');
    } else if (this.editorStage === 'place' && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault(); this.deleteSelectedFeature();
    } else if (event.key.toLowerCase() === 's') this.smooth();
    else if (event.key.toLowerCase() === 'f') this.repair();
    else if (event.key === 'Home') this.fitView();
    else if (event.key.toLowerCase() === 'c' && !this.closed) this.closeLoop();
    else if (event.key.toLowerCase() === 'g' && this.closed) this.autoPlaceStart();
    else if (this.selectedCrossing() && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      this.setCrossingMode(CROSSING_OVERRIDE_MODES[Number(event.key) - 1]);
    } else if (this.selectedCrossing() && event.key === '[') {
      event.preventDefault();
      this.cycleCrossingPreset(-1);
    } else if (this.selectedCrossing() && event.key === ']') {
      event.preventDefault();
      this.cycleCrossingPreset(1);
    }
  }

  _pollController(time) {
    if (!this.root?.isConnected) return;
    const pad = navigator.getGamepads?.()?.find(Boolean);
    if (pad) {
      const dt = clamp((time - (this._lastControllerTime || time)) / 1000, 0, 0.05);
      this._lastControllerTime = time;
      const dead = (value) => Math.abs(value) > 0.16 ? value : 0;
      const x = dead(pad.axes[0] || 0);
      const y = dead(pad.axes[1] || 0);
      if (x || y) {
        this.controllerCursor.visible = true;
        this.controllerCursor.x = clamp(this.controllerCursor.x + x * dt * 0.42, 0.02, 0.98);
        this.controllerCursor.y = clamp(this.controllerCursor.y + y * dt * 0.42, 0.02, 0.98);
        if (this.controllerCursor.drawing) {
          if (this._controllerEditMode === 'deform') this.updateDeform(this.controllerCursor);
          else if (this._controllerEditMode === 'transform') this.updateLayoutTransform(this.controllerCursor);
          else if (this._controllerEditMode === 'start') this.moveStart(this.controllerCursor);
          else if (this._controllerEditMode === 'feature') this.updateFeaturePointer(this.controllerCursor);
          else this.extendStroke(this.controllerCursor);
        }
        this.requestDraw();
      }
      const pressed = (index) => !!pad.buttons[index]?.pressed;
      const edge = (index) => pressed(index) && !this._lastGamepad.buttons[index];
      if (pressed(0) && !this.controllerCursor.drawing) {
        this.controllerCursor.drawing = true;
        if (this.editorStage === 'place' && this.closed) {
          this._controllerEditMode = 'feature';
          this.beginFeaturePointer(this.controllerCursor, { repeat: false, pointerType: 'controller' });
        } else if (this.closed && this.hitStartMarker(this.controllerCursor)) {
          this._controllerEditMode = 'start'; this.beginMoveStart(this.controllerCursor);
        } else if (this.closed && this.hitCrossing(this.controllerCursor)) {
          this._controllerEditMode = 'crossing';
          this.selectCrossing(this.hitCrossing(this.controllerCursor));
        } else if (this.closed && this.hitLayoutHandle(this.controllerCursor)) {
          this._controllerEditMode = 'transform'; this.beginLayoutTransform(this.hitLayoutHandle(this.controllerCursor), this.controllerCursor);
        } else if (this.closed && this.hitTrack(this.controllerCursor)) {
          this._controllerEditMode = 'deform'; this.beginDeform(this.controllerCursor);
        } else {
          this._controllerEditMode = 'draw'; this.beginStroke(this.controllerCursor, 'controller');
        }
      } else if (!pressed(0) && this.controllerCursor.drawing) {
        this.controllerCursor.drawing = false;
        if (this._controllerEditMode === 'deform') this.endDeform();
        else if (this._controllerEditMode === 'transform') this.endLayoutTransform();
        else if (this._controllerEditMode === 'start') this.endMoveStart();
        else if (this._controllerEditMode === 'feature') this.endFeaturePointer();
        else if (this._controllerEditMode !== 'crossing') this.endStroke();
        this._controllerEditMode = '';
      }
      if (edge(2)) this.editorStage === 'place' ? this.deleteSelectedFeature() : this.undo();
      if (edge(3)) this.editorStage === 'place'
        ? this.duplicateSelectedFeature()
        : this.clear(this.root.querySelector('[data-action="clear"]'));
      if (edge(1)) this.editorStage === 'place'
        ? this.cancelFeatureTool()
        : this.selectedCrossing() ? this.closeCrossing() : this.repair();
      if (this.editorStage === 'place' && edge(4)) this.cycleFeatureCategory(-1);
      else if (edge(4)) this.fitView();
      if (this.editorStage === 'place' && edge(5)) this.cycleFeatureCategory(1);
      else if (edge(5)) this.autoPlaceStart();
      if (this.editorStage === 'place' && edge(14)) this.transformSelectedFeature('rotate-left');
      else if (this.selectedCrossing() && edge(14)) this.cycleCrossingMode(-1);
      if (this.editorStage === 'place' && edge(15)) this.transformSelectedFeature('rotate-right');
      else if (this.selectedCrossing() && edge(15)) this.cycleCrossingMode(1);
      if (this.editorStage === 'place' && edge(12)) this.nudgeSelectedFeature(-0.5);
      else if (this.selectedCrossing() && edge(12)) this.cycleCrossingPreset(1);
      if (this.editorStage === 'place' && edge(13)) this.nudgeSelectedFeature(0.5);
      else if (this.selectedCrossing() && edge(13)) this.cycleCrossingPreset(-1);
      const widthAxis = (pad.buttons[7]?.value || 0) - (pad.buttons[6]?.value || 0);
      if (Math.abs(widthAxis) > 0.6 && Math.abs(this._lastGamepad.widthAxis) <= 0.6) {
        if (this.editorStage === 'place') this.scaleSelectedFeature(widthAxis > 0 ? 1 : -1);
        else this.stepWidth(widthAxis > 0 ? 1 : -1);
      }
      this._lastGamepad = { buttons: pad.buttons.map((button) => button.pressed), widthAxis };
    }
    this._controllerFrame = requestAnimationFrame((next) => this._pollController(next));
  }

  requestDraw() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => { this._frame = 0; this.draw(); });
  }

  draw() {
    const ctx = this.context;
    if (!ctx) return;
    const ratio = this.pixelRatio || 1;
    const width = this.canvas.width / ratio;
    const height = this.canvas.height / ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width * 0.5 + this.view.panX, height * 0.5 + this.view.panY);
    ctx.scale(this.view.zoom, this.view.zoom);
    ctx.translate(-width * 0.5, -height * 0.5);
    this._drawGrid(ctx, width, height);
    const raw = this.draft.rawStroke;
    const rawDisplay = this.displayPoints(raw);
    if (rawDisplay.length > 1) this._drawPolyline(ctx, rawDisplay, { color: 'rgba(234,224,198,.30)', width: 1.25, dash: [4, 5], close: this.closed });
    let samples = this.closed && this.validation?.normalizedSamples
      ? this.validation.normalizedSamples
      : this.displayPoints(this.draft.controlPoints);
    if (samples.length > 3) {
      const roadWidth = TRACK_WIDTH_PRESETS[this.draft.widthId].width;
      const footprint = TRACK_SIZE_PRESETS[this.draft.sizeId].width;
      const previewWidth = roadWidth / footprint * width;
      this._drawPolyline(ctx, samples, { color: 'rgba(15,23,29,.60)', width: previewWidth + 8, close: this.closed });
      this._drawPolyline(ctx, samples, { color: this.repairPreview ? 'rgba(255,203,92,.48)' : 'rgba(247,241,211,.24)', width: previewWidth, close: this.closed });
      this._drawPolyline(ctx, samples, { color: this.repairPreview ? '#ffcb5c' : this.validation?.valid ? '#91f0c4' : '#f4e5bd', width: 3.2, close: this.closed, glow: true });
      if (this.closed) this._drawArrows(ctx, samples);
    }
    if (this.closed) this._drawCrossings(ctx);
    if (this.closed) this._drawPlacedFeatures(ctx);
    if (rawDisplay[0] && !this.closed) {
      this._drawClosureTarget(ctx, rawDisplay[0], this.closureState);
      const end = rawDisplay.at(-1);
      if (end && rawDisplay.length > 5) this._drawGhostConnector(ctx, end, rawDisplay[0], this.closureState);
    }
    if (this.closed) {
      const marker = this.startMarkerPoint();
      if (rawDisplay[0]) this._drawSeam(ctx, rawDisplay[0]);
      if (marker) this._drawStartGate(ctx, marker, this.unsafeStartPreview ? 'unsafe' : 'safe');
      this._drawSelection(ctx);
      this._drawTightestRadius(ctx);
    }
    if (this.unsafeStartPreview) this._drawUnsafeStart(ctx, this.unsafeStartPreview);
    for (const issue of this.validation?.issues || []) {
      if (!issue.normalizedPoint) continue;
      if (issue.crossing) continue;
      this._drawIssue(ctx, issue.normalizedPoint, issue);
    }
    if (this.controllerCursor.visible) {
      const point = this.normalizedToScreen(this.controllerCursor);
      // Convert back into the transformed context's drafting coordinates.
      const localX = (point.x - this.view.panX - width * 0.5) / this.view.zoom + width * 0.5;
      const localY = (point.y - this.view.panY - height * 0.5) / this.view.zoom + height * 0.5;
      ctx.beginPath(); ctx.arc(localX, localY, 9 / this.view.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffcb5c'; ctx.lineWidth = 2 / this.view.zoom; ctx.stroke();
      ctx.beginPath(); ctx.arc(localX, localY, 2.5 / this.view.zoom, 0, Math.PI * 2); ctx.fillStyle = '#fff8dd'; ctx.fill();
    }
    ctx.restore();
  }

  _drawGrid(ctx, width, height) {
    const theme = DRAW_TRACK_THEMES[this.draft.themeId] || DRAW_TRACK_THEMES.countryside;
    const horizon = height * 0.43;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, theme.skyTop || '#78b9d0');
    sky.addColorStop(1, theme.skyHorizon || '#f4c27b');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = theme.mapGround || '#667c4c';
    ctx.fillRect(0, horizon, width, height - horizon);
    this._drawWorldMap(ctx, width, height, horizon, theme);
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height);
      ctx.strokeStyle = x % 128 === 0 ? 'rgba(255,248,218,.16)' : 'rgba(255,248,218,.065)'; ctx.stroke();
    }
    for (let y = 0; y <= height; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y);
      ctx.strokeStyle = y % 128 === 0 ? 'rgba(255,248,218,.16)' : 'rgba(255,248,218,.065)'; ctx.stroke();
    }
    const gradient = ctx.createRadialGradient(width * 0.5, height * 0.48, 20, width * 0.5, height * 0.48, Math.max(width, height) * 0.7);
    gradient.addColorStop(0, 'rgba(255,245,202,.08)');
    gradient.addColorStop(1, 'rgba(3,10,14,.32)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  }

  _drawWorldMap(ctx, width, height, horizon, theme) {
    const accent = theme.mapAccent || '#ffe0a3';
    const kind = theme.mapKind || 'hills';
    ctx.save();
    if (kind === 'coast') {
      ctx.fillStyle = 'rgba(228,255,255,.58)'; ctx.fillRect(0, horizon + 10, width, height * .16);
      ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2;
      for (let x = -20; x < width + 20; x += 36) { ctx.beginPath(); ctx.arc(x, horizon + 26, 19, Math.PI, Math.PI * 2); ctx.stroke(); }
    } else if (kind === 'stadium') {
      ctx.fillStyle = 'rgba(9,14,31,.34)'; ctx.beginPath(); ctx.ellipse(width * .5, horizon + 22, width * .52, height * .18, 0, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = accent; ctx.globalAlpha = .58; ctx.lineWidth = 2;
      for (let x = width * .12; x < width * .92; x += width * .16) { ctx.beginPath(); ctx.moveTo(x, horizon + 14); ctx.lineTo(x + 12, horizon - 36); ctx.lineTo(x + 24, horizon + 14); ctx.stroke(); }
    } else if (kind === 'forest') {
      ctx.fillStyle = 'rgba(9,38,35,.55)';
      for (let x = -15; x < width + 20; x += 27) { const tall = 28 + ((x * 13) % 31); ctx.beginPath(); ctx.moveTo(x, horizon + 13); ctx.lineTo(x + 13, horizon - tall); ctx.lineTo(x + 27, horizon + 13); ctx.fill(); }
    } else if (kind === 'skyline') {
      ctx.fillStyle = 'rgba(20,27,37,.5)';
      for (let x = 0; x < width; x += 30) { const tower = 18 + ((x * 7) % 43); ctx.fillRect(x, horizon - tower, 24, tower + 16); }
    } else {
      ctx.fillStyle = kind === 'mesa' ? 'rgba(117,61,37,.54)' : 'rgba(35,67,80,.36)';
      ctx.beginPath(); ctx.moveTo(0, horizon + 18);
      for (let x = 0; x <= width; x += width / 7) { const peak = kind === 'mountains' ? 42 + (x % 3) * 12 : 20 + (x % 4) * 8; ctx.lineTo(x + width / 14, horizon - peak); }
      ctx.lineTo(width, horizon + 22); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = .66; ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(width * .82, height * .17, Math.max(12, width * .035), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  _trace(ctx, points, close) {
    if (!points.length) return;
    ctx.beginPath();
    points.forEach((point, index) => {
      const screen = { x: point.x * this.canvas.width / this.pixelRatio, y: point.y * this.canvas.height / this.pixelRatio };
      if (!index) ctx.moveTo(screen.x, screen.y); else ctx.lineTo(screen.x, screen.y);
    });
    if (close) ctx.closePath();
  }

  _drawPolyline(ctx, points, { color, width, dash = [], close = true, glow = false }) {
    this._trace(ctx, points, close);
    ctx.strokeStyle = color;
    ctx.lineWidth = width / this.view.zoom;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(dash.map((value) => value / this.view.zoom));
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 12 / this.view.zoom; }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
  }

  _drawArrows(ctx, samples) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const direction = this.draft.reverse ? -1 : 1;
    const step = Math.max(18, Math.round(samples.length / 9));
    for (let i = step; i < samples.length; i += step) {
      const current = samples[i];
      const next = samples[(i + direction + samples.length) % samples.length];
      const x = current.x * width;
      const y = current.y * height;
      const angle = Math.atan2((next.y - current.y) * height, (next.x - current.x) * width);
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath();
      ctx.fillStyle = 'rgba(255,203,92,.72)'; ctx.fill(); ctx.restore();
    }
  }

  _drawClosureTarget(ctx, point, state) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const x = point.x * width;
    const y = point.y * height;
    const magnetic = !!state?.magnetic;
    const radius = ((state?.radius || this._closureRadius()) * (magnetic ? 1.18 : 1)) / this.view.zoom;
    ctx.save();
    ctx.shadowColor = magnetic ? '#91f0c4' : '#ffcb5c';
    ctx.shadowBlur = (magnetic ? 24 : 10) / this.view.zoom;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = magnetic ? 'rgba(145,240,196,.14)' : 'rgba(255,203,92,.08)'; ctx.fill();
    ctx.setLineDash([7 / this.view.zoom, 6 / this.view.zoom]);
    ctx.strokeStyle = magnetic ? '#91f0c4' : '#ffcb5c'; ctx.lineWidth = 2 / this.view.zoom; ctx.stroke();
    ctx.setLineDash([]);
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2;
      ctx.save(); ctx.translate(x + Math.cos(angle) * radius * 0.68, y + Math.sin(angle) * radius * 0.68); ctx.rotate(angle);
      ctx.fillStyle = index % 2 ? '#172832' : magnetic ? '#91f0c4' : '#f4e5bd';
      ctx.fillRect(-4 / this.view.zoom, -4 / this.view.zoom, 8 / this.view.zoom, 8 / this.view.zoom); ctx.restore();
    }
    ctx.font = `${800 / this.view.zoom} ${10 / this.view.zoom}px Geist Mono, monospace`;
    ctx.textAlign = 'center'; ctx.fillStyle = magnetic ? '#baffdc' : '#ffe9a8';
    ctx.fillText(magnetic ? 'RELEASE TO CLOSE' : 'CHECKERED FINISH ZONE', x, y - radius - 10 / this.view.zoom);
    ctx.restore(); ctx.textAlign = 'left';
  }

  _drawGhostConnector(ctx, end, start, state) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const pull = state?.pull || 0;
    const endpoint = {
      x: end.x * (1 - pull * 0.82) + start.x * pull * 0.82,
      y: end.y * (1 - pull * 0.82) + start.y * pull * 0.82,
    };
    ctx.beginPath(); ctx.moveTo(endpoint.x * width, endpoint.y * height);
    ctx.quadraticCurveTo(
      (endpoint.x * 0.56 + start.x * 0.44) * width,
      (endpoint.y * 0.44 + start.y * 0.56) * height,
      start.x * width,
      start.y * height,
    );
    ctx.setLineDash([8 / this.view.zoom, 6 / this.view.zoom]);
    ctx.strokeStyle = state?.magnetic ? 'rgba(145,240,196,.95)' : 'rgba(255,203,92,.48)';
    ctx.lineWidth = (state?.magnetic ? 3 : 1.5) / this.view.zoom;
    ctx.stroke(); ctx.setLineDash([]);
  }

  _drawSelection(ctx) {
    if (this.editorStage !== 'adjust') return;
    const handles = this.selectionHandles();
    if (!handles.nw) return;
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    ctx.save();
    ctx.strokeStyle = 'rgba(121,233,255,.5)'; ctx.lineWidth = 1 / this.view.zoom;
    ctx.setLineDash([5 / this.view.zoom, 5 / this.view.zoom]);
    ctx.strokeRect(handles.nw.x * width, handles.nw.y * height, (handles.se.x - handles.nw.x) * width, (handles.se.y - handles.nw.y) * height);
    ctx.setLineDash([]);
    for (const [id, point] of Object.entries(handles)) {
      const x = point.x * width; const y = point.y * height;
      const radius = (id === 'center' ? 7 : 6) / this.view.zoom;
      ctx.beginPath();
      if (id === 'center') ctx.arc(x, y, radius, 0, Math.PI * 2);
      else ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
      ctx.fillStyle = id === 'center' ? '#ffcb5c' : '#13242d'; ctx.fill();
      ctx.strokeStyle = id === 'center' ? '#fff0b8' : '#79e9ff'; ctx.lineWidth = 2 / this.view.zoom; ctx.stroke();
    }
    ctx.restore();
  }

  _drawPlacedFeatures(ctx) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const size = TRACK_SIZE_PRESETS[this.draft.sizeId];
    const pxPerMetre = width / Math.max(1, size.width);
    const diagnostics = new Map(
      (this.featureDiagnostics || []).map((result) => [result.placement?.id, result]),
    );
    const drawOne = (placement, result = null, ghost = false) => {
      const feature = getCourseFeature(placement?.featureId);
      const display = this._featurePlacementPoint(placement);
      if (!feature || !display) return;
      const localX = (display.screen.x - this.view.panX - width * 0.5) / this.view.zoom + width * 0.5;
      const localY = (display.screen.y - this.view.panY - height * 0.5) / this.view.zoom + height * 0.5;
      const rotation = Math.atan2(display.tangent.y, display.tangent.x)
        + Math.PI / 2
        + placement.anchor.rotationOffset
        + (placement.anchor.facing === 'backward' ? Math.PI : 0);
      const footprintWidth = feature.footprint.width * placement.anchor.scaleX * pxPerMetre;
      const footprintLength = feature.footprint.length * placement.anchor.scaleZ * pxPerMetre;
      const selected = placement.id === this.selectedPlacementId;
      const state = result
        ? result.valid ? result.warning ? 'warning' : 'valid' : 'invalid'
        : 'valid';
      const color = state === 'invalid' ? '#ff6f61' : state === 'warning' ? '#ffcb5c' : '#91f0c4';
      ctx.save();
      ctx.translate(localX, localY);
      ctx.rotate(rotation);
      ctx.globalAlpha = ghost ? 0.66 : 0.94;
      ctx.fillStyle = state === 'invalid'
        ? 'rgba(255,111,97,.18)'
        : state === 'warning' ? 'rgba(255,203,92,.15)' : 'rgba(145,240,196,.12)';
      ctx.strokeStyle = selected ? '#ffcb5c' : color;
      ctx.lineWidth = (selected ? 2.5 : 1.4) / this.view.zoom;
      ctx.setLineDash(ghost ? [5 / this.view.zoom, 4 / this.view.zoom] : []);
      ctx.fillRect(-footprintWidth * 0.5, -footprintLength * 0.5, footprintWidth, footprintLength);
      ctx.strokeRect(-footprintWidth * 0.5, -footprintLength * 0.5, footprintWidth, footprintLength);
      ctx.setLineDash([]);
      if (this.featureThumbnail?.complete && this.featureThumbnail.naturalWidth > 0) {
        const sourceWidth = this.featureThumbnail.naturalWidth / 7;
        const sourceHeight = this.featureThumbnail.naturalHeight / 6;
        const column = feature.previewFrame % 7;
        const row = Math.floor(feature.previewFrame / 7);
        const iconWidth = clamp(footprintWidth * 0.92, 24 / this.view.zoom, 72 / this.view.zoom);
        const iconHeight = clamp(footprintLength * 0.68, 20 / this.view.zoom, 58 / this.view.zoom);
        ctx.drawImage(
          this.featureThumbnail,
          column * sourceWidth,
          row * sourceHeight,
          sourceWidth,
          sourceHeight,
          -iconWidth * 0.5,
          -iconHeight * 0.5,
          iconWidth,
          iconHeight,
        );
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, -footprintLength * 0.56);
      ctx.lineTo(-5 / this.view.zoom, -footprintLength * 0.39);
      ctx.lineTo(5 / this.view.zoom, -footprintLength * 0.39);
      ctx.closePath();
      ctx.fillStyle = selected ? '#ffcb5c' : color;
      ctx.fill();
      if (selected) {
        for (const [x, y] of [
          [-footprintWidth * 0.5, -footprintLength * 0.5],
          [footprintWidth * 0.5, -footprintLength * 0.5],
          [-footprintWidth * 0.5, footprintLength * 0.5],
          [footprintWidth * 0.5, footprintLength * 0.5],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, 5 / this.view.zoom, 0, Math.PI * 2);
          ctx.fillStyle = '#13242d';
          ctx.fill();
          ctx.strokeStyle = '#ffcb5c';
          ctx.stroke();
        }
      }
      ctx.restore();

      if (result?.trajectory?.points?.length) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 2 / this.view.zoom;
        ctx.setLineDash([5 / this.view.zoom, 4 / this.view.zoom]);
        ctx.beginPath();
        result.trajectory.points.forEach((point, index) => {
          const along = point.distance * pxPerMetre;
          const lift = point.height * pxPerMetre * 0.72;
          const x = localX + display.tangent.x * along + display.tangent.y * lift;
          const y = localY + display.tangent.y * along - display.tangent.x * lift;
          if (index) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        const landing = result.trajectory.points.at(-1);
        const lx = localX + display.tangent.x * landing.distance * pxPerMetre;
        const ly = localY + display.tangent.y * landing.distance * pxPerMetre;
        ctx.strokeRect(lx - 8 / this.view.zoom, ly - 5 / this.view.zoom, 16 / this.view.zoom, 10 / this.view.zoom);
        ctx.restore();
      }
    };
    for (const placement of this.draft.featurePlacements) {
      drawOne(placement, diagnostics.get(placement.id), false);
    }
    if (
      this.placementGhost?.placement
      && !this.draft.featurePlacements.some((placement) => placement.id === this.placementGhost.placement.id)
    ) drawOne(this.placementGhost.placement, this.placementGhost, true);
  }

  _drawCrossings(ctx) {
    const crossings = this.validation?.crossings || [];
    const samples = this.validation?.normalizedSamples || [];
    if (!crossings.length || !samples.length) return;
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const meanStep = (this.validation.stats?.length || samples.length) / Math.max(1, samples.length);
    ctx.save();
    crossings.forEach((crossing, crossingIndex) => {
      const selected = crossing.id === this.selectedCrossingId;
      const orientation = crossing.selectedOrientation
        || crossing.orientations.find((entry) => entry.mode === crossing.override?.mode)
        || null;
      if (orientation) {
        const branch = orientation.overBranch === 'A' ? crossing.branchA : crossing.branchB;
        const radius = clamp(
          Math.ceil((orientation.approachLength || 32) / Math.max(0.1, meanStep)),
          5,
          Math.max(5, Math.floor(samples.length * 0.16)),
        );
        const ribbon = [];
        for (let offset = -radius; offset <= radius; offset++) {
          ribbon.push(samples[(branch.segment + offset + samples.length) % samples.length]);
        }
        this._drawPolyline(ctx, ribbon, {
          color: selected ? 'rgba(121,233,255,.48)' : 'rgba(121,233,255,.25)',
          width: selected ? 13 : 8,
          close: false,
          glow: selected,
        });
        this._drawPolyline(ctx, ribbon, {
          color: selected ? '#b8f7ff' : '#79e9ff',
          width: selected ? 2.8 : 1.5,
          dash: selected ? [] : [5, 4],
          close: false,
        });
      }
      const point = this.crossingNormalizedPoint(crossing);
      const x = point.x * width;
      const y = point.y * height;
      const color = crossing.bridgeable ? '#79e9ff' : '#ff8b72';
      const radius = (selected ? 19 : 14) / this.view.zoom;
      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, 27 / this.view.zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,203,92,.12)';
        ctx.fill();
        ctx.setLineDash([4 / this.view.zoom, 4 / this.view.zoom]);
        ctx.strokeStyle = '#ffcb5c';
        ctx.lineWidth = 1.5 / this.view.zoom;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = crossing.bridgeable ? 'rgba(9,38,48,.94)' : 'rgba(54,24,25,.94)';
      ctx.fill();
      ctx.strokeStyle = selected ? '#ffcb5c' : color;
      ctx.lineWidth = (selected ? 3 : 2) / this.view.zoom;
      ctx.stroke();
      ctx.font = `${900 / this.view.zoom} ${8 / this.view.zoom}px "Geist Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = selected ? '#ffdf87' : color;
      ctx.fillText(crossing.bridgeable ? `↟${crossingIndex + 1}` : `!${crossingIndex + 1}`, x, y);
      if (selected) {
        for (const [label, branch, dy] of [
          ['A', crossing.branchA, -1],
          ['B', crossing.branchB, 1],
        ]) {
          const before = samples[(branch.segment - 4 + samples.length) % samples.length];
          const after = samples[(branch.segment + 4) % samples.length];
          const tx = (after.x - before.x) * width;
          const ty = (after.y - before.y) * height;
          const length = Math.hypot(tx, ty) || 1;
          const nx = -ty / length;
          const ny = tx / length;
          const ox = nx * dy * 31 / this.view.zoom;
          const oy = ny * dy * 31 / this.view.zoom;
          ctx.beginPath();
          ctx.arc(x + ox, y + oy, 10 / this.view.zoom, 0, Math.PI * 2);
          ctx.fillStyle = label === orientation?.overBranch ? '#ffcb5c' : '#132a34';
          ctx.fill();
          ctx.strokeStyle = label === orientation?.overBranch ? '#fff1b7' : '#79e9ff';
          ctx.lineWidth = 1.5 / this.view.zoom;
          ctx.stroke();
          ctx.fillStyle = label === orientation?.overBranch ? '#17242a' : '#d9fbff';
          ctx.fillText(label, x + ox, y + oy);
        }
      }
    });
    ctx.restore();
  }

  _drawSeam(ctx, point) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const x = point.x * width; const y = point.y * height;
    ctx.beginPath(); ctx.arc(x, y, 4 / this.view.zoom, 0, Math.PI * 2);
    ctx.fillStyle = '#79e9ff'; ctx.fill();
    ctx.font = `${700 / this.view.zoom} ${7 / this.view.zoom}px Geist Mono, monospace`;
    ctx.fillStyle = 'rgba(121,233,255,.72)'; ctx.fillText('DRAW SEAM', x + 8 / this.view.zoom, y + 13 / this.view.zoom);
  }

  _drawStartGate(ctx, point, state = 'safe') {
    const samples = this._baseSamples();
    if (!samples.length) return;
    const count = samples.length;
    const index = Math.round(this.draft.startFraction * count) % count;
    const direction = this.draft.reverse ? -1 : 1;
    const next = samples[(index + direction + count) % count];
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const x = point.x * width; const y = point.y * height;
    const tx = (next.x - point.x) * width; const ty = (next.y - point.y) * height;
    const length = Math.hypot(tx, ty) || 1;
    const nx = -ty / length; const ny = tx / length;
    const half = TRACK_WIDTH_PRESETS[this.draft.widthId].width / TRACK_SIZE_PRESETS[this.draft.sizeId].width * width * 0.72;
    const color = state === 'unsafe' ? '#ff8b72' : '#ffcb5c';
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 13 / this.view.zoom;
    for (let segment = -4; segment < 4; segment++) {
      const a = segment / 4 * half;
      const b = (segment + 1) / 4 * half;
      ctx.beginPath(); ctx.moveTo(x + nx * a, y + ny * a); ctx.lineTo(x + nx * b, y + ny * b);
      ctx.strokeStyle = segment % 2 ? '#101b21' : color; ctx.lineWidth = 7 / this.view.zoom; ctx.stroke();
    }
    const arrowLength = 34 / this.view.zoom;
    const ux = tx / length; const uy = ty / length;
    ctx.beginPath(); ctx.moveTo(x + ux * 9 / this.view.zoom, y + uy * 9 / this.view.zoom);
    ctx.lineTo(x + ux * arrowLength, y + uy * arrowLength);
    ctx.strokeStyle = color; ctx.lineWidth = 4 / this.view.zoom; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + ux * arrowLength, y + uy * arrowLength);
    ctx.lineTo(x + ux * (arrowLength - 10) + nx * 6 / this.view.zoom, y + uy * (arrowLength - 10) + ny * 6 / this.view.zoom);
    ctx.lineTo(x + ux * (arrowLength - 10) - nx * 6 / this.view.zoom, y + uy * (arrowLength - 10) - ny * 6 / this.view.zoom); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    ctx.font = `${900 / this.view.zoom} ${9 / this.view.zoom}px Geist Mono, monospace`; ctx.fillStyle = color;
    ctx.fillText('START / FINISH', x + nx * (half + 8 / this.view.zoom), y + ny * (half + 8 / this.view.zoom));
    ctx.restore();
  }

  _drawTightestRadius(ctx) {
    const stats = this.validation?.stats;
    const samples = this.validation?.normalizedSamples;
    if (!stats || !samples?.length) return;
    let index = 0;
    for (let at = 1; at < stats.radii.length; at++) if (stats.radii[at] < stats.radii[index]) index = at;
    const point = samples[index];
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const radius = clamp(stats.radii[index] / TRACK_SIZE_PRESETS[this.draft.sizeId].width * width, 12, 52) / this.view.zoom;
    const x = point.x * width; const y = point.y * height;
    ctx.beginPath(); ctx.arc(x, y, radius, -0.9, 0.9);
    ctx.strokeStyle = stats.radii[index] < this.validation.radii.required ? '#ff8b72' : 'rgba(121,233,255,.72)';
    ctx.lineWidth = 1.5 / this.view.zoom; ctx.stroke();
    ctx.font = `${800 / this.view.zoom} ${8 / this.view.zoom}px Geist Mono, monospace`;
    ctx.fillStyle = ctx.strokeStyle; ctx.fillText(`R ${stats.radii[index].toFixed(1)} m`, x + radius + 4 / this.view.zoom, y);
  }

  _drawUnsafeStart(ctx, preview) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const x = preview.point.x * width; const y = preview.point.y * height;
    ctx.beginPath(); ctx.arc(x, y, 16 / this.view.zoom, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,139,114,.2)'; ctx.fill(); ctx.strokeStyle = '#ff8b72'; ctx.lineWidth = 2 / this.view.zoom; ctx.stroke();
    ctx.font = `${800 / this.view.zoom} ${8 / this.view.zoom}px Geist Mono, monospace`;
    ctx.fillStyle = '#ffb09e'; ctx.fillText(preview.reason, x + 20 / this.view.zoom, y - 10 / this.view.zoom);
  }

  _drawStart(ctx, point, open, label) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const x = point.x * width;
    const y = point.y * height;
    ctx.beginPath(); ctx.arc(x, y, (open ? 12 : 9) / this.view.zoom, 0, Math.PI * 2);
    ctx.fillStyle = open ? 'rgba(255,203,92,.18)' : '#ffcb5c'; ctx.fill();
    ctx.strokeStyle = '#ffcb5c'; ctx.lineWidth = 2 / this.view.zoom; ctx.stroke();
    ctx.font = `${700 / this.view.zoom} ${10 / this.view.zoom}px Geist Mono, monospace`;
    ctx.fillStyle = '#ffe9a8'; ctx.fillText(label, x + 17 / this.view.zoom, y - 12 / this.view.zoom);
  }

  _drawIssue(ctx, point, issue) {
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    const x = point.x * width;
    const y = point.y * height;
    const overpass = issue.id?.startsWith('overpass-');
    const color = issue.severity === 'error' ? '#ff8b72' : issue.severity === 'info' ? '#79e9ff' : '#ffcb5c';
    ctx.beginPath(); ctx.arc(x, y, 14 / this.view.zoom, 0, Math.PI * 2);
    ctx.fillStyle = `${color}28`; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.4 / this.view.zoom; ctx.stroke();
    ctx.font = `${800 / this.view.zoom} ${13 / this.view.zoom}px Geist Mono, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.fillText(issue.severity === 'error' ? '!' : overpass ? '↟' : issue.severity === 'info' ? 'i' : '•', x, y);
    if (overpass) {
      ctx.font = `${900 / this.view.zoom} ${7 / this.view.zoom}px Geist Mono, monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('OVERPASS', x + 18 / this.view.zoom, y - 10 / this.view.zoom);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  toast(message, kind = 'ok') {
    const node = this.root?.querySelector('.kdt-toast');
    if (!node) return;
    node.textContent = message;
    node.dataset.kind = kind;
    node.classList.add('is-visible');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => node.classList.remove('is-visible'), 2600);
  }

  exit() {
    if (this.root.classList.contains('is-building')) return;
    this.destroy({ callExit: true });
  }

  destroy({ callExit = false } = {}) {
    clearTimeout(this._buildTimer);
    clearInterval(this._buildStageTimer);
    clearTimeout(this._toastTimer);
    clearTimeout(this._clearTimer);
    cancelAnimationFrame(this._frame);
    cancelAnimationFrame(this._controllerFrame);
    this._resizeObserver?.disconnect();
    this.input?.destroy();
    document.removeEventListener('keydown', this.keyHandler, true);
    document.removeEventListener('keyup', this.keyUpHandler, true);
    this.root?.remove();
    document.body.classList.remove('kdt-open');
    if (window.__kdtEditor === this) delete window.__kdtEditor;
    if (callExit) this.onExit?.();
  }
}
