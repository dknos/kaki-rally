/** Draw Your Track mode coordinator. Owns one editor instance at a time. */
import { DrawTrackUI } from './drawTrackUI.js';
import { TRACK_WIDTH_PRESETS } from './drawTrackGeometry.js';
import { getTrackGallerySummary } from './drawTrackStorage.js';
import { startRallySession } from '../navigation.js';

let activeEditor = null;

function defaultBuild({ draft, course, testFromFraction = null }) {
  const width = TRACK_WIDTH_PRESETS[draft.widthId] || TRACK_WIDTH_PRESETS.standard;
  return startRallySession(course.id, {
    mode: 'draw',
    customCourse: course,
    customTrack: draft,
    carCount: width.cars,
    testFromFraction,
  });
}

export function openDrawTrackMode({ initialTrack = null, onBuild = null, onExit = null } = {}) {
  activeEditor?.destroy?.();
  activeEditor = new DrawTrackUI({
    initialTrack,
    onBuild: (payload) => {
      activeEditor = null;
      return (onBuild || defaultBuild)(payload);
    },
    onExit: () => {
      activeEditor = null;
      onExit?.();
    },
  });
  return activeEditor;
}

export function closeDrawTrackMode() {
  if (!activeEditor) return false;
  activeEditor.destroy();
  activeEditor = null;
  return true;
}

export function getDrawTrackModeCardStats() {
  return getTrackGallerySummary();
}

export function isDrawTrackModeOpen() {
  return !!activeEditor;
}
