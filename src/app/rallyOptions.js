import {
  setAmbientVolume,
  setMasterVolume,
  setMusicVolume,
  setSfxVolume,
} from '../audio.js';
import { applyRuntimeOptions, state } from '../state.js';
import { readRallySettings, writeRallySettings } from './rallySave.js';

export function applyRallyOptions(settings = readRallySettings()) {
  const next = writeRallySettings(settings) || settings;
  applyRuntimeOptions(next);
  setMasterVolume(next.masterVolume);
  setMusicVolume(next.musicVolume);
  setSfxVolume(next.sfxVolume);
  setAmbientVolume(next.ambientVolume);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.reduceMotion = next.reduceMotion ? 'true' : 'false';
    document.documentElement.dataset.reduceFlashing = next.reduceFlashing ? 'true' : 'false';
    document.documentElement.style.setProperty('--rally-ui-scale', String(next.uiScale || 1));
  }
  return next;
}

export function updateRallyOptions(patch) {
  const current = readRallySettings();
  const next = {
    ...current,
    ...patch,
    carCounts: { ...current.carCounts, ...(patch?.carCounts || {}) },
  };
  return applyRallyOptions(next);
}

export function optionsNeedReload(before, after) {
  return before.renderer !== after.renderer || before.quality !== after.quality;
}

export function getOptionDiagnostics() {
  return {
    settings: { ...state.options, carCounts: { ...(state.options?.carCounts || {}) } },
    reduceMotion: state._optReduceMotion,
    reduceFlashing: state._optReducedFlashing,
  };
}
