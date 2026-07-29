const missing = (name) => () => {
  throw new Error(`Kaki Rally navigation handler "${name}" is not configured`);
};

let contract = Object.freeze({
  menu: missing('menu'),
  startRacing: missing('startRacing'),
  restartRacing: missing('restartRacing'),
  openDrawEditor: missing('openDrawEditor'),
});

export function configureRallyNavigation(next = {}) {
  for (const name of ['menu', 'startRacing', 'restartRacing', 'openDrawEditor']) {
    if (typeof next[name] !== 'function') {
      throw new TypeError(`Kaki Rally navigation requires a ${name}() handler`);
    }
  }
  contract = Object.freeze({ ...next });
  return contract;
}

export function navigateToMenu(reason = 'mode-exit') {
  return contract.menu(reason);
}

export function startRallySession(courseId, options = {}) {
  return contract.startRacing(courseId, options);
}

export function restartRallySession() {
  return contract.restartRacing();
}

export function openRallyDrawEditor(initialTrack = null) {
  return contract.openDrawEditor(initialTrack);
}

export function getRallyNavigationContract() {
  return contract;
}
