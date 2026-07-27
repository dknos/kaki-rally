const MODE_ALIASES = Object.freeze({
  race: 'circuit',
  offroad: 'circuit',
  gp: 'circuit',
  circuit: 'circuit',
  drift: 'drift',
  stock: 'stock',
  draw: 'draw',
  monster: 'monster',
  trials: 'trials',
  crash: 'crash',
  catastrophe: 'crash',
});

export function normalizeRouteMode(value) {
  return MODE_ALIASES[String(value || '').trim().toLowerCase()] || null;
}

export function readRallyRoute(url = globalThis.location?.href || 'https://local.invalid/') {
  const parsed = new URL(url, 'https://local.invalid/');
  return Object.freeze({
    mode: normalizeRouteMode(parsed.searchParams.get('mode')),
    renderer: parsed.searchParams.get('renderer'),
    experimentalCrash: parsed.searchParams.get('experimental') === 'crash',
    autoStart: parsed.searchParams.get('play') === '1',
    qa: parsed.searchParams.has('qa'),
  });
}

export function routeUrl(currentHref, {
  mode,
  renderer,
  experimentalCrash,
  autoStart,
} = {}) {
  const url = new URL(currentHref);
  if (mode === null) url.searchParams.delete('mode');
  else if (mode) url.searchParams.set('mode', normalizeRouteMode(mode) || mode);
  if (renderer === null) url.searchParams.delete('renderer');
  else if (renderer) url.searchParams.set('renderer', renderer);
  if (experimentalCrash === false) url.searchParams.delete('experimental');
  else if (experimentalCrash === true) url.searchParams.set('experimental', 'crash');
  if (autoStart === false) url.searchParams.delete('play');
  else if (autoStart === true) url.searchParams.set('play', '1');
  return url;
}

export class RallyRouter {
  constructor({ onRoute = null } = {}) {
    this.onRoute = onRoute;
    this._popstate = () => this.onRoute?.(readRallyRoute());
  }

  start() {
    globalThis.addEventListener?.('popstate', this._popstate);
    return readRallyRoute();
  }

  selectMode(mode, { replace = false } = {}) {
    const url = routeUrl(location.href, { mode, autoStart: false });
    history[replace ? 'replaceState' : 'pushState']({ mode }, '', url);
    this.onRoute?.(readRallyRoute(url));
    return url;
  }

  clearMode({ replace = false } = {}) {
    const url = routeUrl(location.href, { mode: null, autoStart: false });
    history[replace ? 'replaceState' : 'pushState']({}, '', url);
    this.onRoute?.(readRallyRoute(url));
    return url;
  }

  restartInWebGL(mode = 'crash') {
    const url = routeUrl(location.href, { mode, renderer: 'webgl', autoStart: false });
    location.assign(url.href);
    return url;
  }

  enableExperimentalCrash() {
    const url = routeUrl(location.href, { mode: 'crash', experimentalCrash: true });
    location.assign(url.href);
    return url;
  }

  dispose() {
    globalThis.removeEventListener?.('popstate', this._popstate);
  }
}
