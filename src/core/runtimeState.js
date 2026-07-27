import * as THREE from 'three';

export const state = {
  mode: 'boot',
  started: false,
  racing: null,

  scene: null,
  camera: null,
  renderer: null,
  rendererService: null,
  composer: null,
  bloomComposer: null,
  bloomPass: null,
  postFXPass: null,
  envGroup: null,

  time: {
    game: 0,
    real: 0,
    dt: 0,
    paused: false,
  },

  hero: {
    mesh: null,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    facing: new THREE.Vector3(0, 0, 1),
  },

  input: {
    moveVec: { x: 0, y: 0 },
    lastDevice: 'keyboard',
    touch: {
      left: false,
      right: false,
      throttle: false,
      brake: false,
    },
  },

  options: {},
  diagnostics: {
    bootedAt: 0,
    sourceCommit: '3711e8fc0c2c86b27911171c5394723ceb9e45aa',
    rendererFallback: null,
    modeTransitions: 0,
    lastError: '',
  },

  gameOver: false,
  victory: false,
  _optReduceMotion: false,
  _optReducedFlashing: false,
};

export function assertRuntimeState({
  requireScene = true,
  requireRenderer = true,
  requireHero = true,
} = {}) {
  const missing = [];
  if (requireScene && !state.scene?.isScene) missing.push('scene');
  if (requireRenderer && (!state.renderer || !state.rendererService)) missing.push('renderer service');
  if (requireHero && !state.hero?.mesh?.isObject3D) missing.push('hero presentation');
  if (!state.time || typeof state.time.paused !== 'boolean') missing.push('time contract');
  if (!state.input?.moveVec || !Number.isFinite(state.input.moveVec.x) || !Number.isFinite(state.input.moveVec.y)) {
    missing.push('input move vector');
  }
  if (missing.length) {
    throw new Error(`Kaki Rally runtime is missing required state: ${missing.join(', ')}`);
  }
  return state;
}

export function applyRuntimeOptions(options = {}) {
  state.options = { ...options };
  state._optReduceMotion = !!options.reduceMotion;
  state._optReducedFlashing = !!options.reduceFlashing;
  return state.options;
}

export function resetRuntimeSession() {
  state.mode = 'menu';
  state.started = false;
  state.racing = null;
  state.time.game = 0;
  state.time.dt = 0;
  state.time.paused = false;
  state.input.moveVec.x = 0;
  state.input.moveVec.y = 0;
  state.hero.pos.set(0, 0, 0);
  state.hero.vel.set(0, 0, 0);
  state.gameOver = false;
  state.victory = false;
  return state;
}
