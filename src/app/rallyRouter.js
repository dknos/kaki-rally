const MODE_ALIASES = Object.freeze({
  race: 'circuit',
  offroad: 'circuit',
  gp: 'circuit',
  circuit: 'circuit',
  drift: 'drift',
  stock: 'stock',
  draw: 'draw',
  monster: 'monster',
  dune: 'dunes',
  dunes: 'dunes',
  trials: 'trials',
  crash: 'crash',
  catastrophe: 'crash',
  raid: 'raid',
  expedition: 'raid',
});

export function normalizeRouteMode(value) {
  return MODE_ALIASES[String(value || '').trim().toLowerCase()] || null;
}

function isLocalDevelopmentUrl(parsed) {
  return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
}

export function readRallyRoute(url = globalThis.location?.href || 'https://local.invalid/') {
  const parsed = new URL(url, 'https://local.invalid/');
  const developmentFlag = parsed.searchParams.get('dev');
  const catastropheDevelopment = (
    isLocalDevelopmentUrl(parsed)
    && developmentFlag === 'catastrophe'
  );
  // Kaki Rally Raid is playable from its deep link on any origin. It keeps its
  // own flag value so the two development routes cannot enable or cancel each
  // other, but the flag now only marks a local development session; it is no
  // longer required to reach the mode.
  const raidDevelopment = (
    isLocalDevelopmentUrl(parsed)
    && (developmentFlag === '1' || developmentFlag === 'raid')
  );
  const requestedMode = normalizeRouteMode(parsed.searchParams.get('mode'));
  // ?stage=<id> names a course inside the requested discipline. It is carried as
  // an opaque string: the router cannot validate it without importing a mode,
  // and the mode already falls back to its first stage for an unknown id.
  const stage = (parsed.searchParams.get('stage') || '').trim().toLowerCase() || null;
  // Raid has no menu card, so it is reachable by URL only. Catastrophe stays
  // gated to an explicit localhost development flag.
  const gatedMode = requestedMode === 'crash' && !catastropheDevelopment;
  return Object.freeze({
    mode: gatedMode ? null : requestedMode,
    stage: gatedMode ? null : stage,
    renderer: parsed.searchParams.get('renderer'),
    catastropheDevelopment,
    raidDevelopment,
    autoStart: parsed.searchParams.get('play') === '1',
    qa: parsed.searchParams.has('qa'),
  });
}

export function routeUrl(currentHref, {
  mode,
  stage,
  renderer,
  catastropheDevelopment,
  raidDevelopment,
  autoStart,
} = {}) {
  const url = new URL(currentHref);
  if (mode === null) url.searchParams.delete('mode');
  else if (mode) url.searchParams.set('mode', normalizeRouteMode(mode) || mode);
  // A stage belongs to a discipline, so clearing the mode clears it too.
  if (stage === null || mode === null) url.searchParams.delete('stage');
  else if (stage) url.searchParams.set('stage', stage);
  if (renderer === null) url.searchParams.delete('renderer');
  else if (renderer) url.searchParams.set('renderer', renderer);
  // The two development flags share one query parameter, so each only clears it
  // when the other is not asking for it. Without that guard a renderer restart
  // into one development mode would silently cancel the other's flag.
  if (catastropheDevelopment === true && isLocalDevelopmentUrl(url)) {
    url.searchParams.set('dev', 'catastrophe');
  } else if (raidDevelopment === true && isLocalDevelopmentUrl(url)) {
    url.searchParams.set('dev', '1');
  } else if (catastropheDevelopment === false && raidDevelopment !== true) {
    url.searchParams.delete('dev');
  } else if (raidDevelopment === false && catastropheDevelopment !== true) {
    url.searchParams.delete('dev');
  }
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
    const url = routeUrl(location.href, {
      mode,
      renderer: 'webgl',
      catastropheDevelopment: mode === 'crash',
      raidDevelopment: mode === 'raid',
      autoStart: false,
    });
    location.assign(url.href);
    return url;
  }

  dispose() {
    globalThis.removeEventListener?.('popstate', this._popstate);
  }
}
