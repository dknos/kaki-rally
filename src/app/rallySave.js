export const LEGACY_SAVE_KEYS = Object.freeze([
  'kks_rally_best_v1',
  'kks_draw_tracks_v1',
  'kks_monster_records_v1',
  'kks_dune_records_v1',
  'kks_rally_trials_v1',
  'kks_kaki_catastrophe_records_v1',
]);

export const RALLY_SETTINGS_KEY = 'kaki_rally_settings_v1';
export const RALLY_IMPORT_BACKUP_KEY = 'kaki_rally_import_backup_v1';
export const EXPORT_FORMAT = 'kaki-rally-save';
export const EXPORT_VERSION = 1;

const DEFAULTS = Object.freeze({
  version: 1,
  lastMode: 'circuit',
  lastCourse: 'forest',
  lastDriver: 'kitty',
  carCounts: Object.freeze({ circuit: 8, drift: 6, stock: 12, draw: 7 }),
  camera: 'isometric',
  renderer: 'auto',
  quality: 'high',
  masterVolume: 1,
  musicVolume: 0.55,
  sfxVolume: 0.72,
  ambientVolume: 0.5,
  reduceMotion: false,
  reduceFlashing: false,
  controllerDeadzone: 0.18,
  monsterVehicle: 'meowster',
  monsterEvent: 'smashdown',
  monsterArena: 'crown-chaos-coliseum',
  duneEvent: 'whiskerwind',
  duneVehicle: 'meowster',
  duneDifficulty: 'standard',
  duneDeformation: 'high',
  duneParticles: 'high',
  duneDust: 'high',
  duneHeatHaze: true,
  duneTerrain: 'high',
  duneShadow: 'high',
  duneCameraShake: 0.72,
  duneSteeringAssist: true,
  duneRecoveryAssist: true,
  trialsTrack: 'meadow',
  trialsVehicle: 'monster',
  crashVehicle: 'muscle',
  crashQuality: 'high',
});

function storageOrDefault(storage) {
  return storage || globalThis.localStorage;
}

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function sanitizeRallySettings(input = {}) {
  const carCounts = input.carCounts && typeof input.carCounts === 'object' ? input.carCounts : {};
  return {
    version: 1,
    lastMode: oneOf(input.lastMode, ['circuit', 'drift', 'stock', 'draw', 'monster', 'dunes', 'trials', 'crash'], DEFAULTS.lastMode),
    lastCourse: oneOf(input.lastCourse, ['forest', 'twilight', 'cinder', 'void', 'cave', 'kakiland'], DEFAULTS.lastCourse),
    lastDriver: String(input.lastDriver || DEFAULTS.lastDriver).slice(0, 32),
    carCounts: {
      circuit: Math.round(numberInRange(carCounts.circuit, DEFAULTS.carCounts.circuit, 2, 12)),
      drift: Math.round(numberInRange(carCounts.drift, DEFAULTS.carCounts.drift, 2, 8)),
      stock: Math.round(numberInRange(carCounts.stock, DEFAULTS.carCounts.stock, 2, 16)),
      draw: Math.round(numberInRange(carCounts.draw, DEFAULTS.carCounts.draw, 2, 12)),
    },
    camera: oneOf(input.camera, ['isometric', 'chase', 'driver_fpv'], DEFAULTS.camera),
    renderer: oneOf(input.renderer, ['auto', 'webgl', 'webgpu'], DEFAULTS.renderer),
    quality: oneOf(input.quality, ['low', 'medium', 'high', 'ultra'], DEFAULTS.quality),
    masterVolume: numberInRange(input.masterVolume, DEFAULTS.masterVolume, 0, 1),
    musicVolume: numberInRange(input.musicVolume, DEFAULTS.musicVolume, 0, 1),
    sfxVolume: numberInRange(input.sfxVolume, DEFAULTS.sfxVolume, 0, 1),
    ambientVolume: numberInRange(input.ambientVolume, DEFAULTS.ambientVolume, 0, 1),
    reduceMotion: !!input.reduceMotion,
    reduceFlashing: !!input.reduceFlashing,
    controllerDeadzone: numberInRange(input.controllerDeadzone, DEFAULTS.controllerDeadzone, 0, 0.5),
    monsterVehicle: oneOf(input.monsterVehicle, ['meowster', 'cyber', 'tipsy'], DEFAULTS.monsterVehicle),
    monsterEvent: oneOf(input.monsterEvent, ['smashdown', 'freestyle', 'free-ride'], DEFAULTS.monsterEvent),
    monsterArena: String(input.monsterArena || DEFAULTS.monsterArena).slice(0, 64),
    duneEvent: oneOf(input.duneEvent, ['whiskerwind', 'sunspine', 'mirage', 'litterbox'], DEFAULTS.duneEvent),
    duneVehicle: oneOf(input.duneVehicle, ['meowster', 'cyber', 'tipsy'], DEFAULTS.duneVehicle),
    duneDifficulty: oneOf(input.duneDifficulty, ['relaxed', 'standard', 'pro'], DEFAULTS.duneDifficulty),
    duneDeformation: oneOf(input.duneDeformation, ['low', 'medium', 'high', 'ultra'], DEFAULTS.duneDeformation),
    duneParticles: oneOf(input.duneParticles, ['low', 'medium', 'high', 'ultra'], DEFAULTS.duneParticles),
    duneDust: oneOf(input.duneDust, ['off', 'low', 'medium', 'high'], DEFAULTS.duneDust),
    duneHeatHaze: input.duneHeatHaze !== false,
    duneTerrain: oneOf(input.duneTerrain, ['low', 'medium', 'high', 'ultra'], DEFAULTS.duneTerrain),
    duneShadow: oneOf(input.duneShadow, ['low', 'medium', 'high', 'ultra'], DEFAULTS.duneShadow),
    duneCameraShake: numberInRange(input.duneCameraShake, DEFAULTS.duneCameraShake, 0, 1),
    duneSteeringAssist: input.duneSteeringAssist !== false,
    duneRecoveryAssist: input.duneRecoveryAssist !== false,
    trialsTrack: oneOf(input.trialsTrack, ['meadow', 'quarry', 'crown'], DEFAULTS.trialsTrack),
    trialsVehicle: oneOf(input.trialsVehicle, ['monster', 'buggy'], DEFAULTS.trialsVehicle),
    crashVehicle: oneOf(input.crashVehicle, ['pocket', 'muscle', 'iron'], DEFAULTS.crashVehicle),
    crashQuality: oneOf(input.crashQuality, ['low', 'medium', 'high'], DEFAULTS.crashQuality),
  };
}

export function readRallySettings(storage = null) {
  const target = storageOrDefault(storage);
  if (!target) return sanitizeRallySettings(DEFAULTS);
  try {
    const parsed = JSON.parse(target.getItem(RALLY_SETTINGS_KEY) || '{}');
    return sanitizeRallySettings({ ...DEFAULTS, ...parsed });
  } catch (_) {
    return sanitizeRallySettings(DEFAULTS);
  }
}

export function writeRallySettings(settings, storage = null) {
  const target = storageOrDefault(storage);
  if (!target) return false;
  const sanitized = sanitizeRallySettings(settings);
  target.setItem(RALLY_SETTINGS_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function patchRallySettings(patch, storage = null) {
  const current = readRallySettings(storage);
  return writeRallySettings({
    ...current,
    ...patch,
    carCounts: { ...current.carCounts, ...(patch?.carCounts || {}) },
  }, storage);
}

export function collectSavePayload(storage = null) {
  const target = storageOrDefault(storage);
  const values = {};
  for (const key of [...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY]) {
    const value = target?.getItem?.(key);
    if (value != null) values[key] = value;
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    sourceCommit: 'fc84c36518651c8d80fc708f7398db2536046fd4',
    values,
  };
}

export function exportRallySave(storage = null) {
  return JSON.stringify(collectSavePayload(storage), null, 2);
}

export function importRallySave(serialized, storage = null) {
  const target = storageOrDefault(storage);
  if (!target) throw new Error('Browser storage is unavailable');
  const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
  if (parsed?.format !== EXPORT_FORMAT || parsed?.version !== EXPORT_VERSION || !parsed.values) {
    throw new Error('This is not a Kaki Rally save export');
  }
  const allowed = new Set([...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY]);
  const incoming = Object.entries(parsed.values).filter(([key, value]) => allowed.has(key) && typeof value === 'string');
  if (!incoming.length) throw new Error('The save export contains no recognized data');

  target.setItem(RALLY_IMPORT_BACKUP_KEY, JSON.stringify(collectSavePayload(target)));
  for (const [key, value] of incoming) {
    if (key === RALLY_SETTINGS_KEY) {
      const settings = sanitizeRallySettings(JSON.parse(value));
      target.setItem(key, JSON.stringify(settings));
    } else {
      JSON.parse(value);
      target.setItem(key, value);
    }
  }
  return { imported: incoming.map(([key]) => key), backupKey: RALLY_IMPORT_BACKUP_KEY };
}

function requireConfirmation(confirmed) {
  if (confirmed !== true) throw new Error('Destructive reset requires explicit confirmation');
}

export function resetRallyRecords({ confirmed = false, storage = null } = {}) {
  requireConfirmation(confirmed);
  const target = storageOrDefault(storage);
  const keys = [
    'kks_rally_best_v1',
    'kks_monster_records_v1',
    'kks_dune_records_v1',
    'kks_rally_trials_v1',
    'kks_kaki_catastrophe_records_v1',
  ];
  for (const key of keys) target.removeItem(key);
  return keys;
}

export function resetDrawTracks({ confirmed = false, storage = null } = {}) {
  requireConfirmation(confirmed);
  const target = storageOrDefault(storage);
  target.removeItem('kks_draw_tracks_v1');
  return ['kks_draw_tracks_v1'];
}

export function resetAllRallyProgress({ confirmed = false, storage = null } = {}) {
  requireConfirmation(confirmed);
  const target = storageOrDefault(storage);
  const keys = [...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY];
  for (const key of keys) target.removeItem(key);
  return keys;
}

export function getSaveDiagnostics(storage = null) {
  const target = storageOrDefault(storage);
  return Object.fromEntries([...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY].map((key) => {
    const raw = target?.getItem?.(key);
    return [key, { present: raw != null, bytes: raw == null ? 0 : new TextEncoder().encode(raw).length }];
  }));
}
