import assert from 'node:assert/strict';
import {
  TrackSpline,
  TrackValidator,
} from '../src/racing/drawTrackGeometry.js';
import {
  DRAW_TRACK_THEME_ORDER,
  compileDrawTrackCourse,
} from '../src/racing/drawTrackThemes.js';
import { TrackCodeCodec } from '../src/racing/drawTrackStorage.js';
import { createDrawDuneEvent } from '../src/racing/dunes/duneEvents.js';
import { buildDuneHeightfieldData } from '../src/racing/dunes/duneHeightfield.js';

const rawStroke = Array.from({ length: 180 }, (_, index) => {
  const angle = index / 180 * Math.PI * 2;
  return {
    x: 0.5 + Math.cos(angle) * (0.35 + Math.sin(angle * 3) * 0.018),
    y: 0.5 + Math.sin(angle) * (0.28 + Math.cos(angle * 2) * 0.014),
  };
});
const controlPoints = TrackSpline.clean(rawStroke, 0.58);
const initial = TrackValidator.validate({
  rawPoints: rawStroke,
  controlPoints,
  closed: true,
  sizeId: 'club',
  widthId: 'wide',
  mirror: true,
});
const validation = TrackValidator.validate({
  rawPoints: rawStroke,
  controlPoints,
  closed: true,
  sizeId: 'club',
  widthId: 'wide',
  mirror: true,
  startFraction: initial.suggestedStartFraction,
});
assert.equal(validation.valid, true, validation.errors.map((issue) => issue.message).join(' | '));

const draft = {
  id: 'kdt-dune-smoke',
  name: 'Copper Paw Test Loop',
  themeId: 'dune',
  sizeId: 'club',
  widthId: 'wide',
  seed: 0xd00e1234,
  smoothing: 0.58,
  startFraction: initial.suggestedStartFraction,
  reverse: false,
  laps: 2,
  modifiers: {
    randomJumps: true,
    nightRace: true,
    rain: true,
    mirror: true,
  },
  rawStroke,
  controlPoints,
  elevationProfile: {
    version: 1,
    stamps: [{
      id: 'dune-ridge',
      fraction: 0.36,
      radius: 0.12,
      elevation: 3.2,
      bank: 0.045,
    }],
  },
  featurePlacements: [{
    id: 'dune-oasis',
    featureId: 'theme-landmark',
    source: 'manual',
    anchor: {
      mode: 'spline',
      fraction: 0.61,
      lateralOffset: 9,
      facing: 'forward',
      rotationOffset: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
    },
  }],
};
const course = compileDrawTrackCourse(draft, validation);
assert.equal(course.drawThemeId, 'dune');
assert.equal(course.drawDiscipline, 'dunes');
assert.equal(course.duneConfig.weather, 'sandstorm');
assert.ok(course.featurePlacements.some((placement) => placement.featureId === 'theme-landmark'));
assert.ok(course.featurePlacements.some((placement) => placement.featureId === 'small-kicker'));

const event = createDrawDuneEvent(course, draft);
assert.equal(event.isDrawTrack, true);
assert.equal(event.routeType, 'circuit');
assert.equal(event.weather, 'sandstorm');
assert.equal(event.timeOfDay, 'sunset');
assert.equal(event.customTrackId, draft.id);
assert.ok(event.route.length >= 4 && event.route.length <= 56);
assert.ok(event.routeWidth >= 17);
assert.ok(event.drawFeaturePlacements.length >= 2);
assert.equal(structuredClone(event).id, event.id, 'event definition must be worker-cloneable');

const first = buildDuneHeightfieldData(event, { width: 129, height: 129 });
const second = buildDuneHeightfieldData(structuredClone(event), { width: 129, height: 129 });
assert.equal(first.eventId, event.id);
assert.deepEqual(first.heights, second.heights, 'custom Dune heightfield changed for the same seed');
assert.ok(first.maximum - first.minimum > 12, 'drawn Dune terrain lacks meaningful elevation');

const code = TrackCodeCodec.encode(draft);
assert.match(code, /^KDT3-/);
const decoded = TrackCodeCodec.decode(code);
assert.equal(decoded.themeId, 'dune');
assert.equal(decoded.seed, draft.seed >>> 0);
assert.equal(decoded.modifiers.rain, true);
assert.equal(decoded.featurePlacements[0].featureId, 'theme-landmark');
assert.equal(decoded.elevationProfile.stamps.length, 1);
assert.deepEqual(
  DRAW_TRACK_THEME_ORDER.slice(0, 8),
  ['countryside', 'forest', 'desert', 'snow', 'neon', 'coastal', 'industrial', 'dirt'],
  'Dune theme insertion broke legacy KDT theme indices',
);

console.log('Dune Workshop KDT3 route and terrain round-trip passed');
