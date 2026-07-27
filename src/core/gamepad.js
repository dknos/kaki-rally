import { state } from './runtimeState.js';

const STICK_DEAD_DEFAULT = 0.18;
const TRIGGER_DEAD = 0.05;
const BUTTON_INDEX = Object.freeze({
  a: 0, b: 1, x: 2, y: 3,
  lb: 4, rb: 5, lt: 6, rt: 7,
  back: 8, start: 9, ls: 10, rs: 11,
  dpadUp: 12, dpadDown: 13, dpadLeft: 14, dpadRight: 15,
});
const BUTTON_KEYS = Object.freeze(Object.keys(BUTTON_INDEX));

function buttonState() {
  return {
    a: false, b: false, x: false, y: false,
    lb: false, rb: false, lt: 0, rt: 0,
    back: false, start: false, ls: false, rs: false,
    dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false,
  };
}

export const gamepadState = {
  lx: 0,
  ly: 0,
  rx: 0,
  ry: 0,
  buttons: buttonState(),
  justPressed: buttonState(),
  connected: false,
  name: '',
  index: -1,
};

const previous = buttonState();
const current = buttonState();
const stick = new Float64Array(4);
let initialized = false;
let connectHandler = null;
let disconnectHandler = null;

function deadzone() {
  const value = Number(state.options?.controllerDeadzone);
  return Number.isFinite(value) && value >= 0 && value <= 0.5 ? value : STICK_DEAD_DEFAULT;
}

function applyStick(x, y, offset) {
  const magnitude = Math.hypot(x, y);
  const threshold = deadzone();
  if (magnitude <= threshold) {
    stick[offset] = 0;
    stick[offset + 1] = 0;
    return;
  }
  const scale = Math.min(1, (magnitude - threshold) / Math.max(0.001, 1 - threshold));
  stick[offset] = (x / magnitude) * scale;
  stick[offset + 1] = (y / magnitude) * scale;
}

function analog(button) {
  const value = Number(button?.value ?? (button?.pressed ? 1 : 0));
  if (!(value > TRIGGER_DEAD)) return 0;
  return Math.min(1, (value - TRIGGER_DEAD) / (1 - TRIGGER_DEAD));
}

function activePad() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  const pads = navigator.getGamepads() || [];
  return [...pads].find((pad) => pad?.connected) || null;
}

function resetIdentity() {
  gamepadState.connected = false;
  gamepadState.name = '';
  gamepadState.index = -1;
  gamepadState.lx = gamepadState.ly = gamepadState.rx = gamepadState.ry = 0;
  for (const key of BUTTON_KEYS) {
    gamepadState.buttons[key] = typeof gamepadState.buttons[key] === 'number' ? 0 : false;
    gamepadState.justPressed[key] = typeof gamepadState.justPressed[key] === 'number' ? 0 : false;
    previous[key] = typeof previous[key] === 'number' ? 0 : false;
  }
}

export function initGamepad() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  connectHandler = ({ gamepad }) => {
    if (!gamepadState.connected && gamepad) {
      gamepadState.connected = true;
      gamepadState.name = gamepad.id || 'Gamepad';
      gamepadState.index = gamepad.index;
    }
  };
  disconnectHandler = ({ gamepad }) => {
    if (gamepad?.index === gamepadState.index) resetIdentity();
  };
  window.addEventListener('gamepadconnected', connectHandler);
  window.addEventListener('gamepaddisconnected', disconnectHandler);
}

export function pollGamepad() {
  for (const key of BUTTON_KEYS) {
    gamepadState.justPressed[key] = typeof gamepadState.justPressed[key] === 'number' ? 0 : false;
  }
  const pad = activePad();
  if (!pad) {
    if (gamepadState.connected) resetIdentity();
    return gamepadState;
  }
  gamepadState.connected = true;
  gamepadState.name = pad.id || 'Gamepad';
  gamepadState.index = pad.index;

  applyStick(pad.axes?.[0] || 0, pad.axes?.[1] || 0, 0);
  applyStick(pad.axes?.[2] || 0, pad.axes?.[3] || 0, 2);
  gamepadState.lx = stick[0];
  gamepadState.ly = stick[1];
  gamepadState.rx = stick[2];
  gamepadState.ry = stick[3];

  for (const key of BUTTON_KEYS) {
    const button = pad.buttons?.[BUTTON_INDEX[key]];
    current[key] = key === 'lt' || key === 'rt' ? analog(button) : !!button?.pressed;
    const value = current[key];
    if (typeof value === 'number') {
      gamepadState.justPressed[key] = previous[key] < 0.5 && value >= 0.5 ? 1 : 0;
    } else {
      gamepadState.justPressed[key] = !previous[key] && value;
    }
    gamepadState.buttons[key] = value;
    previous[key] = value;
  }
  return gamepadState;
}

export function gamepadHasActivity() {
  if (!gamepadState.connected) return false;
  if (Math.hypot(gamepadState.lx, gamepadState.ly) > 0.05) return true;
  if (Math.hypot(gamepadState.rx, gamepadState.ry) > 0.05) return true;
  return BUTTON_KEYS.some((key) => {
    const value = gamepadState.buttons[key];
    return typeof value === 'number' ? value > 0.05 : value;
  });
}

export function disposeGamepad() {
  if (!initialized || typeof window === 'undefined') return;
  window.removeEventListener('gamepadconnected', connectHandler);
  window.removeEventListener('gamepaddisconnected', disconnectHandler);
  initialized = false;
  connectHandler = null;
  disconnectHandler = null;
  resetIdentity();
}
