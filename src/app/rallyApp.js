import * as THREE from 'three';
import {
  createDriverAssetLease,
  createDriverMesh,
  disposeAssetService,
  disposeDriverMesh,
  getAssetDiagnostics,
} from '../assets.js';
import {
  disposeAudio,
  getAudioDiagnostics,
  playMenuMusic,
  resumeAudio,
  sfx,
  stopMenuMusic,
  stopRacingAudio,
  suspendAudio,
  unlockAudio,
} from '../audio.js';
import { RALLY_DISPLAY } from '../config.js';
import {
  disposeInput,
  getInputDiagnostics,
  initInput,
  sampleInput,
} from '../input.js';
import { gamepadState } from '../gamepad.js';
import { configureRallyNavigation } from '../navigation.js';
import {
  closeDrawTrackMode,
  openDrawTrackMode,
} from '../racing/drawTrackMode.js';
import {
  closeTrialsWorkshop,
  openTrialsWorkshop,
} from '../racing/trialsWorkshopUI.js';
import {
  enterRacing,
  exitRacing,
  getRacingCameraConfig,
  getRacingSnapshot,
  registerDevelopmentRacingMode,
  resizeRacingCamera,
  restartRacing,
  setRacingCameraMode,
  tickRacing,
  updateRacingCamera,
} from '../racing/index.js';
import {
  canLaunchRacingMode,
  getRacingModeAvailability,
} from '../racing/racingModeAvailability.js';
import { createRendererService } from '../rendering/createRenderer.js';
import {
  applyAccessibilityOptions,
  createPostPipeline,
} from '../rendering/postfx/createPostPipeline.js';
import {
  readBackendPreference,
  RENDERER_BACKENDS,
} from '../rendering/rendererSettings.js';
import {
  assertRuntimeState,
  resetRuntimeSession,
  state,
} from '../state.js';
import { RallyMenu } from './rallyMenu.js';
import { applyRallyOptions } from './rallyOptions.js';
import { RallyRouter, readRallyRoute, routeUrl } from './rallyRouter.js';
import { readRallySettings } from './rallySave.js';
import { RallyTouchControls } from './rallyTouchControls.js';

const SOURCE_COMMIT = '3711e8fc0c2c86b27911171c5394723ceb9e45aa';
const MAX_FRAME_SECONDS = 0.05;
const MAX_LOGIC_SECONDS = 1 / 30;
let catastropheDevelopmentPromise = null;

function loadCatastropheDevelopment() {
  if (catastropheDevelopmentPromise) return catastropheDevelopmentPromise;
  const stylesheet = new Promise((resolve, reject) => {
    const existing = document.querySelector('link[data-catastrophe-development]');
    if (existing?.sheet) {
      resolve(true);
      return;
    }
    const link = existing || document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './src/racing/crash/crash.css';
    link.dataset.catastropheDevelopment = 'true';
    link.addEventListener('load', () => resolve(true), { once: true });
    link.addEventListener('error', () => reject(new Error('Catastrophe development styles failed to load')), { once: true });
    if (!existing) document.head.appendChild(link);
  });
  catastropheDevelopmentPromise = Promise.all([
    stylesheet,
    import('../racing/crash/crashMode.js'),
  ]).then(([, catastrophe]) => catastrophe);
  return catastropheDevelopmentPromise;
}

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Kaki Rally shell is missing #${id}`);
  return element;
}

function sceneObjectCount(scene) {
  let count = 0;
  scene?.traverse?.(() => { count += 1; });
  return count;
}

function sessionRootCount(scene) {
  return scene?.children?.filter((child) => (
    /^kaki-(rally|trials|catastrophe)-/.test(child.name)
    && !child.name.startsWith('kaki-rally-driver-')
  )).length || 0;
}

function isCoarseDevice() {
  if (new URLSearchParams(location.search).get('touch') === '1') return true;
  return !!(
    globalThis.matchMedia?.('(pointer: coarse)')?.matches
    || navigator.maxTouchPoints > 0
    || 'ontouchstart' in window
  );
}

function safeErrorMessage(error) {
  return error?.message || String(error || 'Unknown error');
}

export class KakiRallyApp {
  constructor() {
    this.stage = requireElement('kk-stage');
    this.canvas = requireElement('game-canvas');
    this.uiRoot = requireElement('ui-root');
    this.menuRoot = requireElement('rally-menu-root');
    this.touchRoot = requireElement('rally-touch-root');
    this.pauseRoot = requireElement('rally-pause-root');
    this.loaderRoot = requireElement('rally-loader-root');
    this.failureRoot = requireElement('rally-renderer-failure-root');
    this.orientationGate = requireElement('rally-orientation-gate');

    this.settings = readRallySettings();
    this.route = readRallyRoute();
    this.coarse = isCoarseDevice();
    this.width = 1;
    this.height = 1;
    this.aspect = RALLY_DISPLAY.desktopAspect;
    this.rendererService = null;
    this.rendererBootFailure = null;
    this.frameFailure = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(RALLY_DISPLAY.background);
    this.menuCamera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 100);
    this.menuCamera.position.set(0, 0, 10);
    this.racingCamera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 900);
    this.racingCamera.position.set(40, 60, 40);
    this.racingCamera.lookAt(0, 0, 0);
    this.activeCamera = this.menuCamera;
    this.driverLease = null;
    this.driverId = null;
    this.menu = null;
    this.router = null;
    this.touchControls = null;
    this.lastFrameTime = 0;
    this.transitionId = 0;
    this.transitionPromise = null;
    this.transitionSamples = [];
    this.frameCount = 0;
    this.disposed = false;
    this.audioUnlocked = false;
    this._resize = () => this.resize();
    this._orientation = () => setTimeout(() => this.updateOrientationGate(), 50);
    this._visibility = () => this.handleVisibility();
    this._keyDown = (event) => this.handleKeyDown(event);
    this._pauseClick = (event) => this.handlePauseClick(event);
    this._unlockAudio = () => { void this.unlockFromGesture(); };
  }

  async boot() {
    state.diagnostics.bootedAt = Date.now();
    state.diagnostics.sourceCommit = SOURCE_COMMIT;
    state.mode = 'boot';
    this.settings = applyRallyOptions(this.settings);
    this.showLoader('Preparing graphics', 'Checking the stable rally renderer…');
    this.resize({ renderer: false });
    this.installShellListeners();

    const preferredBackend = readBackendPreference(location.search, this.settings.renderer);
    await this.initializeRenderer(preferredBackend);
    this.syncRendererState();

    this.showLoader('Loading the paddock', 'Preparing the selected Kaki driver…');
    await this.ensureDriver(this.settings.lastDriver);
    state.hero.mesh.visible = false;
    assertRuntimeState();

    initInput();
    this.touchControls = new RallyTouchControls({ host: this.touchRoot });
    this.installNavigation();
    this.installMenu();

    resetRuntimeSession();
    state.scene = this.scene;
    state.camera = this.activeCamera;
    state.renderer = this.rendererService.renderer;
    state.rendererService = this.rendererService;
    state.started = true;

    await this.rendererService.setAnimationLoop((now) => this.frame(now));
    this.hideLoader();
    this.menu.show({ mode: this.route.mode || this.settings.lastMode });
    playMenuMusic();
    this.captureTransition('boot-menu');
    this.installQaSurface();

    if (state.diagnostics.rendererFallback) {
      this.menu.toast(`WebGPU could not start; using WebGL 2 for this session.`);
    }
    if (this.route.autoStart && this.route.mode) {
      queueMicrotask(() => {
        if (this.route.mode === 'draw') void this.openDrawEditor();
        else void this.startMode(this.menu.launchRequest());
      });
    }
    return this;
  }

  installShellListeners() {
    window.addEventListener('resize', this._resize);
    window.addEventListener('orientationchange', this._orientation);
    window.addEventListener('keydown', this._keyDown);
    window.addEventListener('pointerdown', this._unlockAudio, { passive: true });
    window.addEventListener('keydown', this._unlockAudio);
    document.addEventListener('visibilitychange', this._visibility);
    this.pauseRoot.addEventListener('click', this._pauseClick);
    if (this.coarse) {
      const lockOnce = () => {
        try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch (_) {}
        window.removeEventListener('pointerdown', lockOnce);
      };
      window.addEventListener('pointerdown', lockOnce, { passive: true });
    }
  }

  async initializeRenderer(preferredBackend) {
    let service = this.createRenderer(preferredBackend);
    this.rendererService = service;
    try {
      await service.initialize();
      return service;
    } catch (webGpuError) {
      if (preferredBackend === RENDERER_BACKENDS.WEBGL) {
        this.showRendererFailure(webGpuError, false);
        throw webGpuError;
      }
      try { await service.dispose(); } catch (_) {}
      this.replaceCanvas();
      state.diagnostics.rendererFallback = {
        from: preferredBackend,
        to: RENDERER_BACKENDS.WEBGL,
        reason: safeErrorMessage(webGpuError),
      };
      this.showLoader('WebGPU unavailable', 'Recovering with the stable WebGL 2 renderer…');
      service = this.createRenderer(RENDERER_BACKENDS.WEBGL);
      this.rendererService = service;
      try {
        await service.initialize();
        return service;
      } catch (fallbackError) {
        this.showRendererFailure(fallbackError, false);
        throw fallbackError;
      }
    }
  }

  createRenderer(preferredBackend) {
    return createRendererService({
      canvas: this.canvas,
      preferredBackend,
      settings: {
        antialias: false,
        alpha: false,
        depth: true,
        stencil: false,
        powerPreference: 'high-performance',
        width: this.width,
        height: this.height,
        quality: this.settings.quality,
        autoRecover: true,
        threeRevision: THREE.REVISION,
        scene: this.scene,
        camera: this.activeCamera,
        configureRenderer(renderer) {
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.05;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFShadowMap;
          renderer.shadowMap.autoUpdate = true;
          renderer.info.autoReset = false;
        },
        saveStateOnDeviceLoss() {
          sessionStorage.setItem('kaki-rally-renderer-loss', JSON.stringify({
            at: Date.now(),
            mode: state.racing?.raceMode || state.mode,
            sourceCommit: SOURCE_COMMIT,
          }));
        },
        onRecoveryStateChange: (recovery) => {
          state.diagnostics.rendererRecovery = recovery;
          if (recovery.state === 'ready' && recovery.recovered) {
            queueMicrotask(() => {
              this.syncRendererState();
              this.frameFailure = false;
              this.failureRoot.hidden = true;
            });
          } else if (recovery.state === 'failed') {
            this.showRendererFailure(new Error(recovery.recoveryError || 'Renderer recovery failed'));
          }
        },
      },
      pipelineFactory: ({ renderer, scene, camera }) => createPostPipeline({
        renderer,
        scene,
        camera,
        quality: this.settings.quality,
        accessibility: {
          reduceMotion: this.settings.reduceMotion,
          reduceFlashing: this.settings.reduceFlashing,
        },
        samples: 0,
      }),
      contextProvider: () => ({
        activeMode: state.racing?.raceMode || state.mode,
        sessionPhase: state.racing?.phase || null,
        transitionCount: state.diagnostics.modeTransitions,
      }),
      onBackendReady: ({ renderer, backend, service }) => {
        state.renderer = renderer;
        state.rendererService = service;
        this.loaderRoot.querySelector('[data-role="boot-detail"]')?.replaceChildren(
          `Preparing ${backend === 'webgpu' ? 'WebGPU' : 'WebGL 2'}…`,
        );
        queueMicrotask(() => this.syncRendererState());
      },
      onBackendFailure: ({ error }) => {
        this.rendererBootFailure = error;
      },
      onFrameError: (error) => this.handleFrameError(error),
      onDeviceLost: ({ recoveryState }) => {
        this.pause('graphics-device-lost');
        state.diagnostics.rendererRecovery = recoveryState;
      },
    });
  }

  replaceCanvas() {
    const next = this.canvas.cloneNode(false);
    this.canvas.replaceWith(next);
    this.canvas = next;
  }

  syncRendererState() {
    const service = this.rendererService;
    if (!service?.renderer || service.state !== 'ready') return false;
    state.scene = this.scene;
    state.camera = this.activeCamera;
    state.renderer = service.renderer;
    state.rendererService = service;
    const postPipeline = service.pipeline?.getPipeline?.();
    if (postPipeline) {
      state.composer = postPipeline.composer || null;
      state.bloomComposer = postPipeline.bloomComposer || null;
      state.bloomPass = postPipeline.bloomPass || null;
      state.postFXPass = postPipeline.postFXPass || null;
      applyAccessibilityOptions(state.postFXPass, {
        reduceMotion: this.settings.reduceMotion,
        reduceFlashing: this.settings.reduceFlashing,
      });
    }
    try { service.pipeline?.setScene?.(this.scene); } catch (_) {}
    try { service.pipeline?.setCamera?.(this.activeCamera); } catch (_) {}
    globalThis.__kkRendererService = service;
    return true;
  }

  async ensureDriver(id = 'kitty') {
    const requested = String(id || 'kitty');
    if (this.driverId === requested && state.hero.mesh) {
      state.hero.mesh.visible = true;
      return state.hero.mesh;
    }
    if (state.racing) throw new Error('A driver cannot be replaced during an active rally session');
    const nextLease = createDriverAssetLease([requested]);
    try {
      await nextLease.ready;
      const nextMesh = await createDriverMesh(requested);
      nextMesh.visible = true;
      this.scene.add(nextMesh);
      const previousMesh = state.hero.mesh;
      const previousLease = this.driverLease;
      state.hero.mesh = nextMesh;
      this.driverLease = nextLease;
      this.driverId = requested;
      if (previousMesh && previousMesh !== nextMesh) disposeDriverMesh(previousMesh);
      previousLease?.release?.();
      return nextMesh;
    } catch (error) {
      nextLease.release();
      throw error;
    }
  }

  installNavigation() {
    configureRallyNavigation({
      menu: (reason) => this.exitToMenu(reason),
      startRacing: (courseId, options) => this.startMode({ courseId, options }),
      openDrawEditor: (initialTrack) => this.openDrawEditor(initialTrack),
    });
  }

  installMenu() {
    this.router = new RallyRouter({
      onRoute: (route) => this.handleRoute(route),
    });
    this.route = this.router.start();
    this.menu = new RallyMenu({
      host: this.menuRoot,
      backend: this.rendererService.backend,
      route: this.route,
      onSelectMode: (mode) => {
        try { sfx.uiClick(); } catch (_) {}
        this.router.selectMode(mode);
      },
      onLaunch: (request) => {
        try { sfx.uiClick(); } catch (_) {}
        void this.startMode(request);
      },
      onOpenDraw: () => {
        try { sfx.uiClick(); } catch (_) {}
        void this.openDrawEditor();
      },
      onOpenTrialsWorkshop: () => {
        try { sfx.uiClick(); } catch (_) {}
        void this.openTrialsEditor();
      },
      onRestartWebGL: () => this.router.restartInWebGL('crash'),
    });
  }

  handleRoute(route) {
    this.route = route;
    if (!this.menu) return;
    this.menu.route = route;
    if (state.racing || state.mode === 'draw' || state.mode === 'trials-workshop') {
      this.exitToMenu('browser-history', { updateHistory: false });
    }
    if (route.mode) this.menu.selectMode(route.mode, { announce: false });
  }

  async startMode(request = {}) {
    if (this.transitionPromise) return this.transitionPromise;
    const operation = this.startModeTransition(request);
    const wrapped = operation.finally(() => {
      if (this.transitionPromise === wrapped) this.transitionPromise = null;
    });
    this.transitionPromise = wrapped;
    return this.transitionPromise;
  }

  async startModeTransition({ courseId = 'forest', options = {} } = {}) {
    const token = ++this.transitionId;
    const mode = options.mode || 'circuit';
    if (!canLaunchRacingMode(mode, {
      backend: this.rendererService.backend,
      development: !!this.route.catastropheDevelopment,
    })) {
      const availability = getRacingModeAvailability(mode, {
        backend: this.rendererService.backend,
        development: !!this.route.catastropheDevelopment,
      });
      this.menu?.toast(availability.detail || 'This mode is not available on the active renderer', 'error');
      return null;
    }

    closeDrawTrackMode();
    closeTrialsWorkshop();
    if (state.racing) exitRacing(this.scene);
    this.pauseRoot.hidden = true;
    state.time.paused = false;
    this.touchControls?.hide();
    this.showLoader(`Loading ${mode === 'crash' ? 'Kaki Catastrophe' : 'the starting grid'}`, 'Preparing course, vehicles, and controls…');

    try {
      if (mode === 'crash') {
        const catastrophe = await loadCatastropheDevelopment();
        registerDevelopmentRacingMode('crash', catastrophe);
      }
      const selectedDriver = options.playerAvatarId || readRallySettings().lastDriver;
      await this.ensureDriver(selectedDriver);
      if (token !== this.transitionId) return null;
      state.hero.mesh.visible = true;
      stopMenuMusic();
      const cameraHost = {
        orthographicCamera: this.racingCamera,
        canvas: this.canvas,
        getAspect: () => this.aspect,
        setActiveCamera: (camera) => this.setActiveCamera(camera),
        transitionDuration: 0.3,
      };
      const session = await Promise.resolve(enterRacing(this.scene, courseId, {
        ...options,
        playerAvatarId: selectedDriver,
        cameraHost,
      }));
      if (token !== this.transitionId) {
        exitRacing(this.scene, session);
        return null;
      }
      if (!session || state.racing !== session) {
        throw new Error(`${mode} did not establish an authoritative racing session`);
      }
      state.mode = 'racing';
      state.started = true;
      this.menu.hide();
      this.setCameraFromSession(options.cameraMode || readRallySettings().camera);
      resizeRacingCamera(this.aspect);
      const cameraUpdate = updateRacingCamera(0, {
        aspect: this.aspect,
        reducedMotion: !!state._optReduceMotion,
        snap: true,
        paused: false,
      });
      if (cameraUpdate?.camera) this.setActiveCamera(cameraUpdate.camera);
      this.touchControls?.show(mode);
      this.lastFrameTime = 0;
      state.diagnostics.modeTransitions += 1;
      this.captureTransition(`enter:${mode}`);
      this.hideLoader();
      return session;
    } catch (error) {
      state.diagnostics.lastError = safeErrorMessage(error);
      try { if (state.racing) exitRacing(this.scene); } catch (_) {}
      this.hideLoader();
      this.restoreMenuPresentation();
      this.menu?.toast(`${mode} could not start: ${safeErrorMessage(error)}`, 'error');
      console.error(`[Kaki Rally] ${mode} failed to start`, error);
      return null;
    }
  }

  setCameraFromSession(mode) {
    if (!mode) return false;
    return setRacingCameraMode(mode, { instant: true, save: true });
  }

  openDrawEditor(initialTrack = null) {
    ++this.transitionId;
    if (state.racing) exitRacing(this.scene);
    this.touchControls?.hide();
    this.pauseRoot.hidden = true;
    this.hideLoader();
    this.menu?.hide();
    stopRacingAudio({ immediate: true });
    state.mode = 'draw';
    state.time.paused = false;
    this.setActiveCamera(this.menuCamera);
    const editor = openDrawTrackMode({
      initialTrack,
      onBuild: ({ draft, course }) => {
        state.mode = 'menu';
        const settings = readRallySettings();
        void this.startMode({
          courseId: course.id,
          options: {
            mode: 'draw',
            customCourse: course,
            customTrack: draft,
            carCount: settings.carCounts.draw,
            playerAvatarId: settings.lastDriver,
            cameraMode: settings.camera,
          },
        });
      },
      onExit: () => this.exitToMenu('draw-editor-exit'),
    });
    state.diagnostics.modeTransitions += 1;
    this.captureTransition('enter:draw-editor');
    return editor;
  }

  openTrialsEditor(initialCourse = null) {
    ++this.transitionId;
    if (state.racing) exitRacing(this.scene);
    closeDrawTrackMode();
    this.touchControls?.hide();
    this.pauseRoot.hidden = true;
    this.hideLoader();
    this.menu?.hide();
    stopRacingAudio({ immediate: true });
    state.mode = 'trials-workshop';
    state.time.paused = false;
    this.setActiveCamera(this.menuCamera);
    const editor = openTrialsWorkshop({
      initialCourse,
      onBuild: ({ course, testFromX }) => {
        state.mode = 'menu';
        closeTrialsWorkshop();
        const settings = readRallySettings();
        void this.startMode({
          courseId: course.id,
          options: {
            mode: 'trials',
            customCourse: course,
            trialsTrackId: course.id,
            trialsVehicle: settings.trialsVehicle,
            playerAvatarId: settings.lastDriver,
            cameraMode: settings.camera,
            testFromX,
          },
        });
      },
      onExit: () => this.exitToMenu('trials-workshop-exit'),
    });
    state.diagnostics.modeTransitions += 1;
    this.captureTransition('enter:trials-workshop');
    return editor;
  }

  exitToMenu(reason = 'mode-exit', { updateHistory = true } = {}) {
    ++this.transitionId;
    closeDrawTrackMode();
    closeTrialsWorkshop();
    const activeMode = state.racing?.raceMode || state.mode;
    if (state.racing) {
      try { exitRacing(this.scene); } catch (error) {
        state.diagnostics.lastError = safeErrorMessage(error);
      }
    }
    stopRacingAudio({ immediate: true });
    this.touchControls?.hide();
    this.pauseRoot.hidden = true;
    this.hideLoader();
    resetRuntimeSession();
    state.scene = this.scene;
    state.renderer = this.rendererService?.renderer || null;
    state.rendererService = this.rendererService;
    state.hero.mesh.visible = false;
    this.setActiveCamera(this.menuCamera);
    this.restoreMenuPresentation();
    if (updateHistory && this.menu?.selectedMode) {
      const url = routeUrl(location.href, {
        mode: this.menu.selectedMode,
        autoStart: false,
      });
      history.replaceState({ mode: this.menu.selectedMode }, '', url);
      this.route = readRallyRoute(url);
      this.menu.route = this.route;
    }
    playMenuMusic();
    state.diagnostics.modeTransitions += 1;
    state.diagnostics.lastExitReason = reason;
    this.captureTransition(`exit:${activeMode}`);
    return true;
  }

  restoreMenuPresentation() {
    state.mode = 'menu';
    state.racing = null;
    state.time.paused = false;
    if (state.hero.mesh) state.hero.mesh.visible = false;
    this.scene.background = new THREE.Color(RALLY_DISPLAY.background);
    this.scene.fog = null;
    this.menu?.show({ mode: this.menu.selectedMode });
  }

  pause(reason = 'player') {
    if (!state.racing || state.time.paused) return false;
    state.time.paused = true;
    state.racing.cameraManager?.setPaused?.(true);
    stopRacingAudio();
    this.touchControls?.hide();
    this.pauseRoot.hidden = false;
    this.pauseRoot.innerHTML = `
      <section class="rally-pause" role="dialog" aria-modal="true" aria-label="Rally paused">
        <span>SESSION HOLD · ${String(reason).replaceAll('-', ' ').toUpperCase()}</span>
        <h2>Paused</h2>
        <div class="rally-pause-actions">
          <button type="button" data-pause-action="resume">RESUME</button>
          <button type="button" data-pause-action="restart">RESTART EVENT</button>
          <button type="button" data-pause-action="menu">RETURN TO KAKI RALLY</button>
        </div>
      </section>`;
    requestAnimationFrame(() => this.pauseRoot.querySelector('[data-pause-action="resume"]')?.focus());
    return true;
  }

  resume() {
    if (!state.racing || !state.time.paused) return false;
    state.time.paused = false;
    state.racing.cameraManager?.setPaused?.(false);
    this.pauseRoot.hidden = true;
    this.pauseRoot.replaceChildren();
    this.touchControls?.show(state.racing.raceMode);
    this.lastFrameTime = 0;
    void resumeAudio();
    return true;
  }

  togglePause(reason = 'player') {
    return state.time.paused ? this.resume() : this.pause(reason);
  }

  async restartActiveMode() {
    if (!state.racing) return null;
    const mode = state.racing.raceMode;
    this.pauseRoot.hidden = true;
    this.pauseRoot.replaceChildren();
    state.time.paused = false;
    this.touchControls?.hide();
    this.showLoader('Restarting event', 'Rebuilding the active session without leaving the paddock…');
    try {
      const session = await Promise.resolve(restartRacing(this.scene));
      if (!state.racing) throw new Error('Restart did not create a racing session');
      resizeRacingCamera(this.aspect);
      const cameraUpdate = updateRacingCamera(0, {
        aspect: this.aspect,
        reducedMotion: !!state._optReduceMotion,
        snap: true,
      });
      if (cameraUpdate?.camera) this.setActiveCamera(cameraUpdate.camera);
      this.touchControls?.show(mode);
      this.lastFrameTime = 0;
      state.diagnostics.modeTransitions += 1;
      this.captureTransition(`restart:${mode}`);
      return session;
    } catch (error) {
      state.diagnostics.lastError = safeErrorMessage(error);
      this.exitToMenu('restart-failed');
      this.menu?.toast(`Restart failed: ${safeErrorMessage(error)}`, 'error');
      return null;
    } finally {
      this.hideLoader();
    }
  }

  handlePauseClick(event) {
    const action = event.target.closest('[data-pause-action]')?.dataset.pauseAction;
    if (action === 'resume') this.resume();
    else if (action === 'restart') void this.restartActiveMode();
    else if (action === 'menu') this.exitToMenu('pause-menu');
  }

  handleKeyDown(event) {
    if (event.code === 'Escape' && state.racing) {
      event.preventDefault();
      this.togglePause('escape');
    }
  }

  async unlockFromGesture() {
    if (this.audioUnlocked) return;
    this.audioUnlocked = await unlockAudio();
    if (!this.audioUnlocked) return;
    window.removeEventListener('pointerdown', this._unlockAudio);
    window.removeEventListener('keydown', this._unlockAudio);
    if (state.mode === 'menu') playMenuMusic();
  }

  handleVisibility() {
    if (document.hidden) {
      if (state.racing && !state.time.paused) this.pause('tab-hidden');
      void suspendAudio();
    } else {
      void resumeAudio({ menu: state.mode === 'menu' });
      this.lastFrameTime = 0;
    }
  }

  setActiveCamera(camera) {
    if (!camera) return false;
    this.activeCamera = camera;
    state.camera = camera;
    try { this.rendererService?.pipeline?.setCamera?.(camera); } catch (_) {}
    return true;
  }

  frame(now = performance.now()) {
    if (this.disposed || this.frameFailure) return;
    const elapsedDt = this.lastFrameTime > 0
      ? Math.max(0, (now - this.lastFrameTime) / 1000)
      : 0;
    this.lastFrameTime = now;
    const realDt = Math.min(MAX_FRAME_SECONDS, elapsedDt);
    state.time.real += realDt;
    this.frameCount += 1;

    sampleInput();
    if (state.mode === 'menu') this.menu?.updateGamepad(gamepadState);
    if (state.racing && gamepadState.justPressed.start) this.togglePause('gamepad');

    if (state.mode === 'racing' && state.racing) {
      if (state.time.paused) {
        const pausedCamera = updateRacingCamera(0, {
          aspect: this.aspect,
          reducedMotion: !!state._optReduceMotion,
          paused: true,
        });
        if (pausedCamera?.camera) this.setActiveCamera(pausedCamera.camera);
      } else {
        const logicDt = Math.min(realDt, MAX_LOGIC_SECONDS);
        state.time.dt = logicDt;
        state.time.game += logicDt;
        tickRacing(logicDt, elapsedDt);
        const cameraUpdate = updateRacingCamera(logicDt, {
          aspect: this.aspect,
          reducedMotion: !!state._optReduceMotion,
          paused: false,
        });
        if (cameraUpdate?.camera) this.setActiveCamera(cameraUpdate.camera);
        const cameraConfig = cameraUpdate?.effects || getRacingCameraConfig();
        if (state.postFXPass?.uniforms) {
          state.postFXPass.uniforms.chromatic.value = cameraConfig.chromatic ?? 0.0008;
        }
        if (state.bloomPass) state.bloomPass.strength = cameraConfig.bloom ?? 0.34;
      }
    } else if (this.activeCamera !== this.menuCamera) {
      this.setActiveCamera(this.menuCamera);
    }

    if (state.postFXPass?.uniforms?.time) {
      state.postFXPass.uniforms.time.value = state.time.real;
    }
    this.rendererService.render(this.scene, this.activeCamera);
  }

  resize({ renderer = true } = {}) {
    const viewportWidth = Math.max(1, window.innerWidth);
    const viewportHeight = Math.max(1, window.innerHeight);
    let width;
    let height;
    if (this.coarse) {
      width = viewportWidth;
      height = viewportHeight;
    } else if (viewportWidth / viewportHeight > RALLY_DISPLAY.desktopAspect) {
      height = viewportHeight;
      width = Math.round(height * RALLY_DISPLAY.desktopAspect);
    } else {
      width = viewportWidth;
      height = Math.round(width / RALLY_DISPLAY.desktopAspect);
    }
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.aspect = this.width / this.height;
    this.stage.style.width = `${this.width}px`;
    this.stage.style.height = `${this.height}px`;

    const halfHeight = 18;
    this.menuCamera.left = -halfHeight * this.aspect;
    this.menuCamera.right = halfHeight * this.aspect;
    this.menuCamera.top = halfHeight;
    this.menuCamera.bottom = -halfHeight;
    this.menuCamera.updateProjectionMatrix();
    if (renderer && this.rendererService?.state === 'ready') {
      this.rendererService.resize(this.width, this.height);
    }
    resizeRacingCamera(this.aspect);
    this.updateOrientationGate();
    return { width: this.width, height: this.height, aspect: this.aspect };
  }

  updateOrientationGate() {
    const portrait = this.coarse && window.innerHeight > window.innerWidth;
    this.orientationGate.hidden = !portrait;
    return portrait;
  }

  showLoader(title, detail = '') {
    this.loaderRoot.hidden = false;
    this.loaderRoot.innerHTML = `
      <div class="rally-boot" role="status" aria-live="polite">
        <div class="rally-boot-panel">
          <span class="rally-boot-mark">KR</span>
          <strong>${title}</strong>
          <p data-role="boot-detail">${detail}</p>
          <div class="rally-boot-progress"><i></i></div>
        </div>
      </div>`;
  }

  hideLoader() {
    this.loaderRoot.hidden = true;
    this.loaderRoot.replaceChildren();
  }

  showRendererFailure(error, canSwitchToWebGL = true) {
    this.frameFailure = true;
    state.diagnostics.lastError = safeErrorMessage(error);
    try { this.rendererService?.pause?.('frame-failure'); } catch (_) {}
    this.failureRoot.hidden = false;
    this.failureRoot.innerHTML = `
      <section class="rally-renderer-failure" role="alertdialog" aria-modal="true">
        <div>
          <h1>Graphics stopped</h1>
          <p data-role="failure-detail"></p>
          <div class="rally-renderer-failure-actions">
            <button type="button" data-failure-action="retry">RETRY</button>
            ${canSwitchToWebGL ? '<button type="button" data-failure-action="webgl">RESTART IN WEBGL</button>' : ''}
          </div>
        </div>
      </section>`;
    this.failureRoot.querySelector('[data-role="failure-detail"]').textContent = safeErrorMessage(error);
    this.failureRoot.querySelector('[data-failure-action="retry"]')?.addEventListener('click', () => location.reload());
    this.failureRoot.querySelector('[data-failure-action="webgl"]')?.addEventListener('click', () => {
      location.assign(routeUrl(location.href, { renderer: 'webgl' }).href);
    });
  }

  handleFrameError(error) {
    if (this.frameFailure) return;
    console.error('[Kaki Rally] renderer frame failed', error);
    this.showRendererFailure(error, this.rendererService?.backend !== 'webgl');
  }

  captureTransition(label) {
    const sample = {
      label,
      at: performance.now(),
      mode: state.racing?.raceMode || state.mode,
      domNodes: document.getElementsByTagName('*').length,
      hudRoots: document.querySelectorAll('.kkr-hud,.kkc-hud').length,
      sceneObjects: sceneObjectCount(this.scene),
      sessionRoots: sessionRootCount(this.scene),
      renderer: this.rendererService?.getDiagnostics?.() || null,
      audio: getAudioDiagnostics(),
    };
    this.transitionSamples.push(sample);
    while (this.transitionSamples.length > 40) this.transitionSamples.shift();
    return sample;
  }

  getDiagnostics() {
    return {
      sourceCommit: SOURCE_COMMIT,
      appMode: state.mode,
      activeMode: state.racing?.raceMode || null,
      activePhase: state.racing?.phase || null,
      paused: state.time.paused,
      backend: this.rendererService?.backend || 'unknown',
      renderer: this.rendererService?.getDiagnostics?.() || null,
      racing: getRacingSnapshot(),
      sceneObjects: sceneObjectCount(this.scene),
      domNodes: document.getElementsByTagName('*').length,
      hudRoots: document.querySelectorAll('.kkr-hud,.kkc-hud').length,
      sessionRoots: sessionRootCount(this.scene),
      assets: getAssetDiagnostics(),
      input: getInputDiagnostics(),
      audio: getAudioDiagnostics(),
      touch: this.touchControls?.getDiagnostics() || null,
      transitions: [...this.transitionSamples],
      frameCount: this.frameCount,
      stateDiagnostics: { ...state.diagnostics },
    };
  }

  installQaSurface() {
    const app = this;
    globalThis.__kakiRally = Object.freeze({
      sourceCommit: SOURCE_COMMIT,
      app,
      state,
      getSnapshot: () => getRacingSnapshot(),
      getDiagnostics: () => app.getDiagnostics(),
      start: (mode, courseId = 'forest', options = {}) => app.startMode({
        courseId,
        options: { ...options, mode },
      }),
      pause: () => app.togglePause('qa'),
      restart: () => app.restartActiveMode(),
      menu: () => app.exitToMenu('qa'),
      openDraw: (track = null) => app.openDrawEditor(track),
      openTrialsWorkshop: (course = null) => app.openTrialsEditor(course),
      captureTransition: (label = 'qa') => app.captureTransition(label),
    });
    document.body.dataset.kakiRallyReady = 'true';
    document.body.dataset.renderer = this.rendererService.backend;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.transitionId;
    closeDrawTrackMode();
    closeTrialsWorkshop();
    if (state.racing) exitRacing(this.scene);
    this.menu?.dispose();
    this.router?.dispose();
    this.touchControls?.dispose();
    disposeInput();
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('orientationchange', this._orientation);
    window.removeEventListener('keydown', this._keyDown);
    window.removeEventListener('pointerdown', this._unlockAudio);
    window.removeEventListener('keydown', this._unlockAudio);
    document.removeEventListener('visibilitychange', this._visibility);
    this.pauseRoot.removeEventListener('click', this._pauseClick);
    this.driverLease?.release?.();
    if (state.hero.mesh) disposeDriverMesh(state.hero.mesh);
    disposeAssetService();
    await disposeAudio();
    await this.rendererService?.dispose?.();
    try { delete globalThis.__kakiRally; } catch (_) {}
    try { delete globalThis.__kkRendererService; } catch (_) {}
  }
}

export async function bootKakiRally() {
  const app = new KakiRallyApp();
  await app.boot();
  return app;
}
