import { clearTouchDriveState, setTouchDriveState } from '../input.js';

const DRIVE_MODES = new Set(['circuit', 'drift', 'stock', 'draw', 'monster', 'dunes']);

export class RallyTouchControls {
  constructor({ host } = {}) {
    if (!host) throw new TypeError('RallyTouchControls requires a host element');
    this.host = host;
    this.mode = null;
    this.activePointers = new Map();
    this.abort = new AbortController();
    this.mount();
  }

  mount() {
    this.host.innerHTML = `
      <div class="rally-touch-steer" aria-label="Touch steering">
        <button type="button" data-drive="left" aria-label="Steer left">◀</button>
        <button type="button" data-drive="right" aria-label="Steer right">▶</button>
      </div>
      <div class="rally-touch-pedals" aria-label="Touch pedals">
        <button type="button" data-drive="brake">BRAKE</button>
        <button type="button" data-drive="throttle">GAS</button>
      </div>`;
    const signal = this.abort.signal;
    for (const button of this.host.querySelectorAll('[data-drive]')) {
      const key = button.dataset.drive;
      const activate = (event) => {
        event.preventDefault();
        event.stopPropagation();
        try { button.setPointerCapture?.(event.pointerId); } catch (_) {}
        const pointers = this.activePointers.get(key) || new Set();
        pointers.add(event.pointerId);
        this.activePointers.set(key, pointers);
        button.classList.add('is-held');
        setTouchDriveState({ [key]: true });
      };
      const release = (event) => {
        const pointers = this.activePointers.get(key);
        if (!pointers) return;
        pointers.delete(event.pointerId);
        if (pointers.size) return;
        this.activePointers.delete(key);
        button.classList.remove('is-held');
        setTouchDriveState({ [key]: false });
      };
      button.addEventListener('pointerdown', activate, { signal });
      button.addEventListener('pointerup', release, { signal });
      button.addEventListener('pointercancel', release, { signal });
      button.addEventListener('lostpointercapture', release, { signal });
      button.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    }
    this.hide();
  }

  show(mode) {
    this.mode = DRIVE_MODES.has(mode) ? mode : null;
    this.host.hidden = !this.mode;
    this.host.dataset.mode = this.mode || '';
    this.host.setAttribute('aria-hidden', this.mode ? 'false' : 'true');
  }

  hide() {
    this.mode = null;
    this.activePointers.clear();
    clearTouchDriveState();
    this.host.querySelectorAll('.is-held').forEach((button) => button.classList.remove('is-held'));
    this.host.hidden = true;
    this.host.setAttribute('aria-hidden', 'true');
  }

  getDiagnostics() {
    return {
      mounted: this.host.isConnected,
      visible: !this.host.hidden,
      mode: this.mode,
      activeControls: [...this.activePointers.keys()],
    };
  }

  dispose() {
    this.hide();
    this.abort.abort();
    this.host.replaceChildren();
  }
}
