import assert from 'node:assert/strict';

import {
  EXPORT_FORMAT,
  LEGACY_SAVE_KEYS,
  RALLY_IMPORT_BACKUP_KEY,
  RALLY_SETTINGS_KEY,
  collectSavePayload,
  exportRallySave,
  importRallySave,
  readRallySettings,
  resetAllRallyProgress,
  resetDrawTracks,
  resetRallyRecords,
  sanitizeRallySettings,
  writeRallySettings,
} from '../src/app/rallySave.js';

class MemoryStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

assert.deepEqual(LEGACY_SAVE_KEYS, [
  'kks_rally_best_v1',
  'kks_draw_tracks_v1',
  'kks_monster_records_v1',
  'kks_rally_trials_v1',
  'kks_kaki_catastrophe_records_v1',
]);

const legacyValues = Object.fromEntries(LEGACY_SAVE_KEYS.map((key, index) => [
  key,
  JSON.stringify({ marker: `${key}:${index}`, tracks: key.includes('draw') ? [{ code: 'KDT1-preserved' }] : undefined }),
]));
const source = new MemoryStorage(Object.entries(legacyValues));
const settings = writeRallySettings({
  lastMode: 'monster',
  lastCourse: 'kakiland',
  lastDriver: 'sote',
  renderer: 'webgpu',
  quality: 'ultra',
  carCounts: { circuit: 12, drift: 8, stock: 16, draw: 12 },
}, source);
assert.equal(settings.lastMode, 'monster');
assert.equal(settings.renderer, 'webgpu');

const serialized = exportRallySave(source);
const payload = JSON.parse(serialized);
assert.equal(payload.format, EXPORT_FORMAT);
assert.equal(payload.sourceCommit, '3711e8fc0c2c86b27911171c5394723ceb9e45aa');
for (const [key, value] of Object.entries(legacyValues)) {
  assert.equal(payload.values[key], value, `${key} changed during export`);
}

const destination = new MemoryStorage([
  ['kks_rally_best_v1', JSON.stringify({ old: true })],
  ['unrelated-origin-key', 'leave-me-alone'],
]);
const result = importRallySave(serialized, destination);
assert.deepEqual(new Set(result.imported), new Set([...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY]));
assert.ok(destination.getItem(RALLY_IMPORT_BACKUP_KEY), 'pre-import backup was not retained');
assert.equal(destination.getItem('unrelated-origin-key'), 'leave-me-alone');
for (const [key, value] of Object.entries(legacyValues)) {
  assert.equal(destination.getItem(key), value, `${key} changed during import`);
}
assert.equal(readRallySettings(destination).lastDriver, 'sote');

assert.throws(() => importRallySave('{"format":"wrong"}', destination), /not a Kaki Rally save/i);
assert.throws(() => resetRallyRecords({ storage: destination }), /confirmation/i);
assert.throws(() => resetDrawTracks({ storage: destination }), /confirmation/i);
assert.throws(() => resetAllRallyProgress({ storage: destination }), /confirmation/i);

resetRallyRecords({ confirmed: true, storage: destination });
assert.equal(destination.getItem('kks_draw_tracks_v1'), legacyValues.kks_draw_tracks_v1);
assert.equal(destination.getItem('kks_rally_best_v1'), null);
assert.equal(destination.getItem('unrelated-origin-key'), 'leave-me-alone');

resetDrawTracks({ confirmed: true, storage: destination });
assert.equal(destination.getItem('kks_draw_tracks_v1'), null);
assert.equal(destination.getItem('unrelated-origin-key'), 'leave-me-alone');

const allReset = new MemoryStorage(Object.entries(collectSavePayload(source).values));
allReset.setItem('unrelated-origin-key', 'still-here');
resetAllRallyProgress({ confirmed: true, storage: allReset });
for (const key of [...LEGACY_SAVE_KEYS, RALLY_SETTINGS_KEY]) assert.equal(allReset.getItem(key), null);
assert.equal(allReset.getItem('unrelated-origin-key'), 'still-here');

const sanitized = sanitizeRallySettings({
  lastMode: 'combat',
  renderer: 'vulkan',
  carCounts: { stock: 999, drift: -5 },
  controllerDeadzone: 9,
});
assert.equal(sanitized.lastMode, 'circuit');
assert.equal(sanitized.renderer, 'auto');
assert.equal(sanitized.carCounts.stock, 16);
assert.equal(sanitized.carCounts.drift, 2);
assert.equal(sanitized.controllerDeadzone, 0.5);

console.log('Kaki Rally save migration, export, import, and reset contracts passed');
