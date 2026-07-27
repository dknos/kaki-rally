import { gamepadHasActivity, gamepadState, initGamepad, pollGamepad } from './gamepad.js';
import { state } from './runtimeState.js';

const keys = new Set();
let jumpQueued = false;
let initialized = false;
let keyDownHandler = null;
let keyUpHandler = null;
let pointerHandler = null;

const blockedCodes = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space',
]);

function keyboardAxis(negativeCodes, positiveCodes) {
  const negative = negativeCodes.some((code) => keys.has(code)) ? -1 : 0;
  const positive = positiveCodes.some((code) => keys.has(code)) ? 1 : 0;
  return negative + positive;
}

export function initInput() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  initGamepad();
  keyDownHandler = (event) => {
    if (blockedCodes.has(event.code) && state.mode === 'racing') event.preventDefault();
    if (event.code === 'Space' && !event.repeat) jumpQueued = true;
    keys.add(event.code);
    state.input.lastDevice = 'keyboard';
  };
  keyUpHandler = (event) => keys.delete(event.code);
  pointerHandler = (event) => {
    state.input.lastDevice = event?.pointerType === 'touch' ? 'touch' : 'pointer';
  };
  window.addEventListener('keydown', keyDownHandler, { passive: false });
  window.addEventListener('keyup', keyUpHandler);
  window.addEventListener('pointerdown', pointerHandler, { passive: true });
}

export function setTouchDriveState(next = {}) {
  Object.assign(state.input.touch, next);
  if (Object.values(next).some(Boolean)) state.input.lastDevice = 'touch';
}

export function clearTouchDriveState() {
  for (const key of Object.keys(state.input.touch)) state.input.touch[key] = false;
}

export function sampleInput() {
  pollGamepad();
  const touch = state.input.touch;
  let x = keyboardAxis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
  let y = keyboardAxis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
  if (touch.left) x -= 1;
  if (touch.right) x += 1;
  if (touch.throttle) y -= 1;
  if (touch.brake) y += 1;
  x = Math.max(-1, Math.min(1, x));
  y = Math.max(-1, Math.min(1, y));

  if (gamepadState.connected) {
    const triggerY = (Number(gamepadState.buttons.lt) || 0) - (Number(gamepadState.buttons.rt) || 0);
    const padY = Math.abs(triggerY) > Math.abs(gamepadState.ly) ? triggerY : gamepadState.ly;
    if (Math.abs(gamepadState.lx) > Math.abs(x)) x = gamepadState.lx;
    if (Math.abs(padY) > Math.abs(y)) y = padY;
    if (gamepadHasActivity()) state.input.lastDevice = 'gamepad';
  }
  state.input.moveVec.x = x;
  state.input.moveVec.y = y;
  return state.input;
}

export function isDashPressed() {
  return keys.has('ShiftLeft')
    || keys.has('ShiftRight')
    || keys.has('KeyX')
    || !!gamepadState.buttons.x
    || !!gamepadState.buttons.rb;
}

export function isHandbrakePressed() {
  return keys.has('Space') || !!gamepadState.buttons.a;
}

export function consumeJump() {
  const queued = jumpQueued || !!gamepadState.justPressed.a;
  jumpQueued = false;
  return queued;
}

export function clearSecondaryAction() {
  jumpQueued = false;
}

export function disposeInput() {
  if (!initialized || typeof window === 'undefined') return;
  window.removeEventListener('keydown', keyDownHandler);
  window.removeEventListener('keyup', keyUpHandler);
  window.removeEventListener('pointerdown', pointerHandler);
  initialized = false;
  keys.clear();
  jumpQueued = false;
  clearTouchDriveState();
}

export function getInputDiagnostics() {
  return {
    initialized,
    pressedKeys: [...keys],
    jumpQueued,
    lastDevice: state.input.lastDevice,
    moveVec: { ...state.input.moveVec },
    touch: { ...state.input.touch },
    gamepad: {
      connected: gamepadState.connected,
      name: gamepadState.name,
      index: gamepadState.index,
    },
  };
}
