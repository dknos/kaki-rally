import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  TrackRepair,
  TrackSpline,
  TrackValidator,
  TRACK_SIZE_PRESETS,
  TRACK_WIDTH_PRESETS,
  DEFAULT_LAYOUT_TRANSFORM,
  createCanonicalTrackLayout,
  minimumTrackRadii,
} from '../src/racing/drawTrackGeometry.js';
import {
  DRAW_TRACK_THEME_ORDER,
  compileDrawTrackCourse,
} from '../src/racing/drawTrackThemes.js';
import {
  TrackCodeCodec,
  TrackGallery,
  TrackSerializer,
} from '../src/racing/drawTrackStorage.js';
import {
  BRIDGE_PRESETS,
  createCrossingOverride,
} from '../src/racing/drawTrackCrossings.js';
import { CourseSurfaceIndex } from '../src/racing/courseSurfaceQuery.js';
import {
  buildCircuitFeatureRuntime,
  queryCircuitFeatureContact,
  sampleCourseFeatureSurface,
} from '../src/racing/courseFeatureSurfaces.js';

function closedStroke(controls, steps = 10) {
  const points = [];
  for (let i = 0; i < controls.length; i++) {
    const start = controls[i];
    const end = controls[(i + 1) % controls.length];
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    }
  }
  return points;
}

function validateWithGrid(rawPoints, controlPoints, options = {}) {
  const first = TrackValidator.validate({ rawPoints, controlPoints, closed: true, ...options });
  return TrackValidator.validate({
    rawPoints,
    controlPoints,
    closed: true,
    ...options,
    startFraction: first.suggestedStartFraction,
  });
}

function workshopCrossingFixture(count, {
  left = 0.12,
  right = 0.88,
  sizeId = 'colossal',
} = {}) {
  const controls = [
    { x: 0.05, y: 0.5 },
    { x: 0.95, y: 0.5 },
    { x: 0.95, y: 0.12 },
    { x: right, y: 0.18 },
  ];
  for (let index = 1; index <= count; index++) {
    controls.push({
      x: right - index * ((right - left) / count),
      y: index % 2 ? 0.82 : 0.18,
    });
  }
  controls.push({ x: 0.05, y: count % 2 ? 0.88 : 0.12 });
  const raw = closedStroke(controls, 18);
  const clean = TrackSpline.clean(raw, 0.18);
  const layout = createCanonicalTrackLayout(raw, clean, sizeId);
  return { ...layout, sizeId };
}

class FakeStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

console.log('Kaki Rally Draw Your Track smoke');

assert.deepEqual(Object.keys(TRACK_SIZE_PRESETS), ['pocket', 'club', 'grand', 'epic', 'mega', 'colossal']);
assert.deepEqual(
  [TRACK_SIZE_PRESETS.mega.width, TRACK_SIZE_PRESETS.mega.depth, TRACK_SIZE_PRESETS.mega.minLength, TRACK_SIZE_PRESETS.mega.maxLength],
  [320, 220, 500, 1250],
);
assert.deepEqual(
  [TRACK_SIZE_PRESETS.colossal.width, TRACK_SIZE_PRESETS.colossal.depth, TRACK_SIZE_PRESETS.colossal.minLength, TRACK_SIZE_PRESETS.colossal.maxLength],
  [440, 300, 650, 1900],
);
assert.deepEqual(Object.keys(TRACK_WIDTH_PRESETS), ['narrow', 'standard', 'wide', 'extra']);
assert.equal(DRAW_TRACK_THEME_ORDER.length, 8, 'initial theme set changed');

const ellipse = Array.from({ length: 160 }, (_, index) => {
  const angle = index / 160 * Math.PI * 2;
  const shake = Math.sin(index * 3.7) * 0.003;
  return { x: 0.5 + Math.cos(angle) * (0.35 + shake), y: 0.5 + Math.sin(angle) * (0.28 - shake) };
});
const smoothEllipse = TrackSpline.clean(ellipse, 0.55);
assert.ok(smoothEllipse.length < ellipse.length * 0.4, 'shaky stroke was not simplified');
for (const sizeId of Object.keys(TRACK_SIZE_PRESETS)) {
  const result = validateWithGrid(ellipse, smoothEllipse, { sizeId, widthId: 'standard' });
  assert.equal(result.valid, true, `${sizeId} ellipse should be raceable: ${result.errors.map((issue) => issue.id).join(', ')}`);
  assert.ok(result.stats.length >= TRACK_SIZE_PRESETS[sizeId].minLength, `${sizeId} footprint did not affect track length`);
}

const open = TrackValidator.validate({
  rawPoints: ellipse.slice(0, 80),
  controlPoints: TrackSpline.clean(ellipse.slice(0, 80), 0.55),
  closed: false,
});
assert.equal(open.valid, false);
assert.ok(open.errors.some((issue) => issue.id === 'open-loop'), 'open loop lacks a precise error');

const roughRectangle = closedStroke([
  { x: 0.16, y: 0.2 }, { x: 0.84, y: 0.2 }, { x: 0.84, y: 0.8 }, { x: 0.16, y: 0.8 },
], 14);
const rectangleLayout = createCanonicalTrackLayout(
  roughRectangle,
  TrackSpline.clean(roughRectangle, 0.25),
  'club',
);
const rectangleResult = validateWithGrid(rectangleLayout.rawPoints, rectangleLayout.controlPoints, {
  sizeId: 'club', widthId: 'standard', layoutTransform: rectangleLayout.layoutTransform,
});
assert.equal(rectangleResult.valid, true, `rough rectangle did not become raceable: ${rectangleResult.errors.map((issue) => issue.id).join(', ')}`);
assert.ok(rectangleResult.issues.some((issue) => issue.id === 'corner-rounded'), 'sharp rectangle corners were not reported as locally rounded');
assert.ok(rectangleResult.stats.tightestRadius >= minimumTrackRadii(TRACK_WIDTH_PRESETS.standard.width).required * 0.94, 'generated rectangle radius is not mesh/vehicle safe');

const hairpinStroke = closedStroke([
  { x: 0.14, y: 0.2 }, { x: 0.82, y: 0.2 }, { x: 0.82, y: 0.42 }, { x: 0.38, y: 0.42 },
  { x: 0.38, y: 0.73 }, { x: 0.84, y: 0.73 }, { x: 0.84, y: 0.84 }, { x: 0.15, y: 0.84 },
], 12);
const hairpinLayout = createCanonicalTrackLayout(hairpinStroke, TrackSpline.clean(hairpinStroke, 0.12), 'grand');
const hairpinResult = validateWithGrid(hairpinLayout.rawPoints, hairpinLayout.controlPoints, {
  sizeId: 'grand', widthId: 'narrow', layoutTransform: hairpinLayout.layoutTransform,
});
assert.equal(hairpinResult.valid, true, `authored hairpin did not become raceable: ${hairpinResult.errors.map((issue) => issue.id).join(', ')}`);
assert.ok(hairpinResult.stats.cornerCount >= 6 && hairpinResult.stats.maximumCurvature > 0.12, 'hairpin silhouette was flattened into a generic oval');

const stretchedLayout = { ...hairpinLayout.layoutTransform, scaleX: 1.18 };
const stretchedHairpin = validateWithGrid(hairpinLayout.rawPoints, hairpinLayout.controlPoints, {
  sizeId: 'grand', widthId: 'narrow', layoutTransform: stretchedLayout,
});
assert.ok(stretchedHairpin.stats.length > hairpinResult.stats.length + 25, 'explicit horizontal stretch did not change world length');
const originalWorldWidth = Math.max(...hairpinResult.samples.map((point) => point.x)) - Math.min(...hairpinResult.samples.map((point) => point.x));
const stretchedWorldWidth = Math.max(...stretchedHairpin.samples.map((point) => point.x)) - Math.min(...stretchedHairpin.samples.map((point) => point.x));
assert.ok(stretchedWorldWidth > originalWorldWidth * 1.12, 'layout scale was silently normalized away');

const overLimitLayout = { ...hairpinLayout.layoutTransform, scaleX: 1.25 };
const overLimit = validateWithGrid(hairpinLayout.rawPoints, hairpinLayout.controlPoints, {
  sizeId: 'grand', widthId: 'narrow', layoutTransform: overLimitLayout,
});
assert.ok(overLimit.stats.length > TRACK_SIZE_PRESETS.grand.maxLength, 'over-limit fixture is not actually over budget');
assert.equal(overLimit.valid, true, 'mildly over-limit track should remain editable and raceable');
assert.ok(overLimit.issues.some((issue) => issue.id === 'too-long' && issue.severity === 'warning'), 'over-limit budget lacks an actionable warning');
const lengthRepair = TrackRepair.proposeDetailed(hairpinLayout.rawPoints, {
  smoothing: 0.12, sizeId: 'grand', widthId: 'narrow', layoutTransform: overLimitLayout, validation: overLimit,
});
const repairedLength = validateWithGrid(lengthRepair.points, TrackSpline.clean(lengthRepair.points, 0.12), {
  sizeId: 'grand', widthId: 'narrow', layoutTransform: lengthRepair.layoutTransform,
});
assert.ok(repairedLength.stats.length < overLimit.stats.length && repairedLength.stats.length <= TRACK_SIZE_PRESETS.grand.maxLength * 1.03, 'Make Raceable did not recover the length budget');

const figureEight = Array.from({ length: 180 }, (_, index) => {
  const angle = index / 180 * Math.PI * 2;
  return { x: 0.5 + Math.sin(angle) * 0.36, y: 0.5 + Math.sin(angle) * Math.cos(angle) * 0.31 };
});
const figureEightInitial = TrackValidator.validate({
  rawPoints: figureEight,
  controlPoints: TrackSpline.clean(figureEight, 0.55),
  closed: true,
  sizeId: 'grand',
  widthId: 'standard',
  allowOverpasses: true,
});
assert.ok(figureEightInitial.errors.some((issue) => issue.id === 'grid-crossing'), 'grid at a crossing was not rejected');
const figureEightResult = validateWithGrid(figureEight, TrackSpline.clean(figureEight, 0.55), {
  sizeId: 'grand', widthId: 'standard', allowOverpasses: true,
});
assert.equal(figureEightResult.valid, true, 'a well-spaced figure eight should generate safely');
assert.equal(figureEightResult.overpasses.length, 1, 'figure eight did not become one overpass');
assert.ok(figureEightResult.overpasses[0].approachLength > 40, 'overpass ramps are too abrupt');
assert.ok(Number.isFinite(figureEightResult.overpasses[0].underFraction), 'overpass did not retain the lower crossing branch');
assert.ok(Math.abs(figureEightResult.overpasses[0].fraction - figureEightResult.overpasses[0].underFraction) > 0.2, 'upper and lower crossing branches collapsed onto the same route progress');
assert.ok(!figureEightResult.errors.some((issue) => issue.id === 'grid-crossing'), 'automatic grid placement stayed inside the bridge approach');
assert.equal(figureEightResult.crossingDiagnostics.solver, 'exact-global');

for (const count of [3, 5]) {
  const fixture = workshopCrossingFixture(count);
  const result = validateWithGrid(fixture.rawPoints, fixture.controlPoints, {
    sizeId: fixture.sizeId,
    widthId: 'narrow',
    layoutTransform: fixture.layoutTransform,
    allowOverpasses: true,
  });
  assert.equal(result.valid, true, `${count}-crossing workshop fixture should be raceable: ${result.errors.map((issue) => issue.message).join(' | ')}`);
  assert.equal(result.crossings.length, count, `${count}-crossing fixture detection changed`);
  assert.equal(result.overpasses.length, count, `${count}-crossing fixture lost a simultaneous bridge`);
  assert.equal(result.crossingDiagnostics.solver, 'exact-global');
  assert(result.crossingDiagnostics.segmentPairs < result.sampleCount * 0.2, 'crossing detection regressed toward an all-pairs scan');
  const repeated = validateWithGrid(fixture.rawPoints, fixture.controlPoints, {
    sizeId: fixture.sizeId,
    widthId: 'narrow',
    layoutTransform: fixture.layoutTransform,
    allowOverpasses: true,
  });
  assert.deepEqual(
    repeated.overpasses.map((crossing) => [crossing.id, crossing.selectedOrientation.mode]),
    result.overpasses.map((crossing) => [crossing.id, crossing.selectedOrientation.mode]),
    `${count}-crossing global selection is not deterministic`,
  );
}

const overlapFixture = workshopCrossingFixture(2, { left: 0.44, right: 0.56, sizeId: 'mega' });
const overlapResult = validateWithGrid(overlapFixture.rawPoints, overlapFixture.controlPoints, {
  sizeId: 'mega',
  widthId: 'standard',
  layoutTransform: overlapFixture.layoutTransform,
});
assert.equal(overlapResult.crossings.length, 2, 'overlap fixture lost a crossing candidate');
assert.equal(overlapResult.overpasses.length, 1, 'overlapping bridge approaches were both accepted');
assert.equal(overlapResult.valid, false, 'an unresolved flat crossing must remain invalid');
assert.match(
  overlapResult.crossings.find((crossing) => !crossing.bridgeable)?.conflictExplanation || '',
  /overlap/i,
  'overlapping approach rejection is not explained',
);

const canonicalFigureEight = createCanonicalTrackLayout(
  figureEight,
  TrackSpline.clean(figureEight, 0.55),
  'grand',
);
let overrideBase = validateWithGrid(canonicalFigureEight.rawPoints, canonicalFigureEight.controlPoints, {
  sizeId: 'grand',
  widthId: 'standard',
  layoutTransform: canonicalFigureEight.layoutTransform,
});
const originalCrossing = overrideBase.crossings[0];
const manualMode = originalCrossing.selectedOrientation.overBranch === 'A' ? 'b-over-a' : 'a-over-b';
const crossingOverride = createCrossingOverride(originalCrossing, {
  mode: manualMode,
  preset: 'tall',
});
overrideBase = TrackValidator.validate({
  rawPoints: canonicalFigureEight.rawPoints,
  controlPoints: canonicalFigureEight.controlPoints,
  closed: true,
  sizeId: 'grand',
  widthId: 'standard',
  startFraction: overrideBase.suggestedStartFraction,
  layoutTransform: canonicalFigureEight.layoutTransform,
  crossingOverrides: [crossingOverride],
});
assert.equal(overrideBase.crossings[0].selectedOrientation.mode, manualMode, 'manual upper branch was ignored');
assert.equal(overrideBase.crossings[0].preset, 'tall', 'manual bridge preset was ignored');
assert(overrideBase.crossings[0].clearance > BRIDGE_PRESETS.standard.baseHeight, 'Tall bridge did not increase clearance');

for (const variant of [
  { reverse: true },
  { mirror: true },
  { reverse: true, mirror: true },
  { reverse: true, mirror: true, sizeId: 'colossal' },
  { startFraction: 0.31 },
]) {
  const result = TrackValidator.validate({
    rawPoints: canonicalFigureEight.rawPoints,
    controlPoints: canonicalFigureEight.controlPoints,
    closed: true,
    sizeId: 'grand',
    widthId: 'standard',
    startFraction: overrideBase.suggestedStartFraction,
    layoutTransform: canonicalFigureEight.layoutTransform,
    crossingOverrides: [crossingOverride],
    ...variant,
  });
  assert.equal(result.orphanedCrossingOverrides.length, 0, `override was orphaned by ${JSON.stringify(variant)}`);
  assert.equal(result.crossings[0].id, originalCrossing.id, `stable crossing id changed for ${JSON.stringify(variant)}`);
  assert.equal(result.crossings[0].override.mode, manualMode, `upper-branch intent changed for ${JSON.stringify(variant)}`);
  if (result.crossings[0].selectedOrientation) {
    assert.equal(result.crossings[0].selectedOrientation.mode, manualMode, `upper branch changed for ${JSON.stringify(variant)}`);
  } else {
    assert.match(
      result.crossings[0].conflictExplanation,
      /start-grid reservation/i,
      'temporarily invalid start relocation did not explain why the preserved override cannot build',
    );
  }
}

const removedCrossing = TrackValidator.validate({
  rawPoints: ellipse,
  controlPoints: smoothEllipse,
  closed: true,
  sizeId: 'grand',
  widthId: 'standard',
  crossingOverrides: [crossingOverride],
});
assert.equal(removedCrossing.crossings.length, 0);
assert.equal(removedCrossing.orphanedCrossingOverrides.length, 1, 'removed crossing override disappeared without warning');
const corruptOverride = TrackValidator.validate({
  rawPoints: canonicalFigureEight.rawPoints,
  controlPoints: canonicalFigureEight.controlPoints,
  closed: true,
  sizeId: 'grand',
  widthId: 'standard',
  layoutTransform: canonicalFigureEight.layoutTransform,
  crossingOverrides: [{ id: { nope: true }, mode: 'teleport', preset: 'infinite', point: { x: NaN, y: Infinity } }],
});
assert.equal(corruptOverride.crossings.length, 1, 'corrupt override damaged crossing detection');
assert.equal(corruptOverride.crossings[0].override, null, 'corrupt override was assigned to a crossing');

const stackedSamples = [
  { x: -10, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
  { x: 10, y: 0, z: 0 },
  { x: 10, y: 6, z: 10 },
  { x: 0, y: 6, z: 0 },
  { x: -10, y: 6, z: 10 },
];
const surfaceIndex = new CourseSurfaceIndex(stackedSamples, 9.2);
assert.equal(surfaceIndex.nearest(0, 0, 0.3, 1).index, 1, 'lower-road surface query selected the bridge deck');
assert.equal(surfaceIndex.nearest(0, 0, 5.8, 4).index, 4, 'upper-road surface query selected the underpass');

const figureEightCourse = compileDrawTrackCourse({
  id: 'kdt-overpass-smoke',
  name: 'Kaki Skyway Test',
  themeId: 'industrial',
  sizeId: 'grand',
  widthId: 'standard',
  seed: 818181,
  rawStroke: figureEight,
  controlPoints: TrackSpline.clean(figureEight, 0.55),
  layoutTransform: DEFAULT_LAYOUT_TRANSFORM,
  modifiers: {},
}, figureEightResult);
assert.equal(figureEightCourse.overpasses.length, 1, 'compiled course lost the safe crossing');
assert.ok(Number.isFinite(figureEightCourse.overpasses[0].underFraction), 'compiled bridge lost underpass route metadata');
assert.ok(figureEightCourse.overpasses[0].angle >= 0.52, 'compiled bridge retained an unsafe crossing angle');

const catControls = [
  [0.18, 0.62], [0.16, 0.44], [0.23, 0.25], [0.30, 0.16], [0.33, 0.31],
  [0.50, 0.22], [0.67, 0.31], [0.70, 0.16], [0.78, 0.25], [0.84, 0.44],
  [0.82, 0.62], [0.68, 0.78], [0.50, 0.84], [0.32, 0.78],
].map(([x, y]) => ({ x, y }));
const catStroke = closedStroke(catControls);
const rawCatResult = validateWithGrid(catStroke, TrackSpline.clean(catStroke, 0.55), { sizeId: 'grand', widthId: 'standard' });
assert.equal(rawCatResult.valid, false, 'sharp cat ears should request repair rather than fold the mesh');
const repairedCat = TrackRepair.propose(catStroke, { smoothing: 0.55, sizeId: 'grand', widthId: 'standard' });
const catResult = validateWithGrid(repairedCat, repairedCat, { sizeId: 'grand', widthId: 'standard' });
assert.equal(catResult.valid, true, `cat-shaped track repair failed: ${catResult.errors.map((issue) => issue.id).join(', ')}`);
assert.ok(catResult.stats.cornerCount >= 4, 'cat repair oversmoothed the silhouette into an oval');

const draft = {
  id: 'kdt-smoke',
  name: 'Nine Lives Test Ring',
  themeId: 'neon',
  sizeId: 'grand',
  widthId: 'wide',
  seed: 123456,
  reverse: true,
  smoothing: 0.61,
  startFraction: 0.15,
  layoutTransform: { ...DEFAULT_LAYOUT_TRANSFORM, occupancy: 0.84, scaleX: 1.17, scaleY: 0.95, offsetX: 0.04, offsetY: -0.03 },
  modifiers: { randomJumps: true, mirror: true },
  rawStroke: ellipse,
  controlPoints: smoothEllipse,
};
const code = TrackCodeCodec.encode(draft);
const decoded = TrackCodeCodec.decode(code);
assert.match(code, /^KDT2-/);
assert.ok(code.length < 240, `track code is unexpectedly long: ${code.length}`);
assert.equal(decoded.themeId, draft.themeId);
assert.equal(decoded.sizeId, draft.sizeId);
assert.equal(decoded.widthId, draft.widthId);
assert.equal(decoded.reverse, true);
assert.equal(decoded.modifiers.randomJumps, true);
assert.equal(decoded.modifiers.mirror, true);
assert.ok(Math.abs(decoded.layoutTransform.occupancy - draft.layoutTransform.occupancy) < 0.001);
assert.ok(Math.abs(decoded.layoutTransform.scaleX - draft.layoutTransform.scaleX) < 0.001);
assert.ok(Math.abs(decoded.layoutTransform.scaleY - draft.layoutTransform.scaleY) < 0.001);
assert.ok(Math.abs(decoded.layoutTransform.offsetX - draft.layoutTransform.offsetX) < 0.001);
assert.ok(Math.abs(decoded.layoutTransform.offsetY - draft.layoutTransform.offsetY) < 0.001);
assert.throws(() => TrackCodeCodec.decode(`${code.slice(0, -2)}aa`), /corrupt|invalid|incomplete/i);

const kdt3Draft = {
  ...draft,
  crossingOverrides: [crossingOverride],
  featurePlacements: [{
    id: 'placed-launch',
    featureId: 'large-launch-ramp',
    source: 'manual',
    anchor: {
      mode: 'spline',
      fraction: 0.42,
      lateralOffset: -0.75,
      facing: 'backward',
      rotationOffset: Math.PI / 12,
      scaleX: 1.1,
      scaleY: 1,
      scaleZ: 1.2,
    },
  }],
};
const kdt3Code = TrackCodeCodec.encode(kdt3Draft);
const kdt3Decoded = TrackCodeCodec.decode(kdt3Code);
assert.match(kdt3Code, /^KDT3-/);
assert.ok(kdt3Code.length < 2000, `compact KDT3 code is unexpectedly long: ${kdt3Code.length}`);
assert.equal(kdt3Decoded.crossingOverrides[0].mode, crossingOverride.mode);
assert.equal(kdt3Decoded.crossingOverrides[0].preset, 'tall');
assert.equal(kdt3Decoded.featurePlacements[0].featureId, 'large-launch-ramp');
assert.equal(kdt3Decoded.featurePlacements[0].anchor.facing, 'backward');
assert.ok(Math.abs(kdt3Decoded.featurePlacements[0].anchor.fraction - 0.42) < 0.00002);
assert.throws(() => TrackCodeCodec.decode(`${kdt3Code.slice(0, -2)}aa`), /corrupt|invalid|incomplete/i);
assert.throws(
  () => TrackCodeCodec.encode({
    ...draft,
    featurePlacements: Array.from({ length: 97 }, (_, index) => ({
      id: `too-many-${index}`,
      featureId: 'small-kicker',
      anchor: { mode: 'spline', fraction: index / 97 },
    })),
  }),
  /up to 96/i,
);
const unknownFeatureSave = TrackSerializer.deserialize({
  ...kdt3Draft,
  version: 3,
  featurePlacements: [
    ...kdt3Draft.featurePlacements,
    { id: 'future-part', featureId: 'unknown-future-feature', anchor: { mode: 'spline', fraction: 0.6 } },
  ],
});
assert.equal(unknownFeatureSave.featurePlacements.length, 1, 'unknown feature id was not ignored safely');
assert.match(unknownFeatureSave.dataWarnings.join(' '), /unknown course feature/i);

const rampSamples = Array.from({ length: 100 }, (_, index) => ({
  x: 0,
  y: 0,
  z: index,
  tangent: { x: 0, y: 0, z: 1 },
  normal: { x: -1, y: 0, z: 0 },
}));
const [rampRuntime] = buildCircuitFeatureRuntime([{
  ...kdt3Decoded.featurePlacements[0],
  anchor: {
    ...kdt3Decoded.featurePlacements[0].anchor,
    lateralOffset: 0,
    facing: 'forward',
    rotationOffset: 0,
  },
}], rampSamples, {
  startFraction: 0,
  drawDirection: 'forward',
});
const rampEntrance = queryCircuitFeatureContact([rampRuntime], {
  x: rampRuntime.x,
  y: 0,
  z: rampRuntime.z - rampRuntime.length * 0.43,
  vx: 0,
  vz: 18,
  previousX: rampRuntime.x,
  previousZ: rampRuntime.z - rampRuntime.length * 0.45,
});
assert.equal(rampEntrance.ramp.takeoff, false, 'ramp launched before the visible lip');
assert.ok(rampEntrance.ramp.groundHeight > 0, 'visible ramp profile did not raise contact height');
const lip = queryCircuitFeatureContact([rampRuntime], {
  x: rampRuntime.x,
  y: rampRuntime.surfaceProfile.height,
  z: rampRuntime.z + rampRuntime.length * 0.44,
  vx: 0,
  vz: 28,
  previousX: rampRuntime.x,
  previousZ: rampRuntime.z + rampRuntime.length * 0.37,
});
assert.equal(lip.ramp.takeoff, true, 'high-speed swept contact missed the visible ramp lip');
const sideMiss = queryCircuitFeatureContact([rampRuntime], {
  x: rampRuntime.x + rampRuntime.width,
  y: 0,
  z: rampRuntime.z + rampRuntime.length * 0.44,
  vx: 0,
  vz: 18,
});
assert.equal(sideMiss.ramp, null, 'ramp launched a vehicle that passed beside it');
assert.equal(sampleCourseFeatureSurface({ kind: 'double', height: 2 }, 0.5).hasSurface, false);
const normalizedDraft = TrackSerializer.deserialize(TrackSerializer.serialize(draft));
assert.equal(normalizedDraft.controlPoints.length, smoothEllipse.length);
const legacyCode = TrackCodeCodec.encodeLegacy({ ...draft, layoutTransform: undefined });
const legacyDecoded = TrackCodeCodec.decode(legacyCode);
assert.match(legacyCode, /^KDT1-/);
assert.deepEqual(legacyDecoded.layoutTransform, DEFAULT_LAYOUT_TRANSFORM, 'KDT1 migration did not receive sane layout defaults');
assert.ok(legacyDecoded.controlPoints.length >= 6, 'KDT1 migration lost the recognizable circuit');

const courseValidation = validateWithGrid(normalizedDraft.rawStroke, normalizedDraft.controlPoints, {
  sizeId: 'grand', widthId: 'wide', layoutTransform: normalizedDraft.layoutTransform,
});
const course = compileDrawTrackCourse(normalizedDraft, courseValidation);
assert.equal(course.mode, 'draw');
assert.equal(course.customTrackId, draft.id);
assert.equal(course.trackWidth, TRACK_WIDTH_PRESETS.wide.width);
assert.ok(course.points.length >= 8);
assert.equal(course.samples, courseValidation.sampleCount, 'dynamic validation sample density did not reach the runtime course');
assert.equal(course.rampFractions.length, 0, 'Draw courses must not render legacy tilted-pad ramps');
assert.ok(
  course.featurePlacements.filter((placement) => placement.source === 'auto-fill'
    && ['small-kicker', 'large-launch-ramp', 'tabletop'].includes(placement.featureId)).length >= 2,
  'Auto-fill jumps did not compile through the shared Workshop catalog',
);
assert.equal(course.shortcutFractions.length, 0, 'arbitrary geometry must not inherit chapter shortcuts');

const storage = new FakeStorage();
const gallery = new TrackGallery(storage);
gallery.save(draft);
assert.equal(gallery.summary().count, 1);
gallery.toggleFavorite(draft.id);
assert.equal(gallery.get(draft.id).favorite, true);
gallery.recordRace(draft.id, { lapTime: 42.5, result: { position: 1 }, vehicle: 'kitty' });
assert.equal(gallery.get(draft.id).bestLap, 42.5);
const duplicate = gallery.duplicate(draft.id);
assert.notEqual(duplicate.id, draft.id);
assert.equal(gallery.summary().count, 2);
assert.equal(gallery.delete(duplicate.id), true);

const generationSource = await readFile(new URL('../src/racing/drawTrackGeneration.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../src/racing/index.js', import.meta.url), 'utf8');
for (const contract of ['TrackMeshBuilder', 'CheckpointGenerator', 'RespawnGenerator', 'AIPathGenerator']) {
  assert.match(generationSource, new RegExp(`export class ${contract}`), `${contract} is not a separate generation responsibility`);
  assert.match(runtimeSource, new RegExp(contract), `${contract} is not integrated into Kaki Rally`);
}
assert.match(runtimeSource, /customCourse:\s*options\.customCourse/, 'runtime does not accept the compiled player course');
assert.match(runtimeSource, /queryCircuitFeatureContact/, 'runtime does not use the shared visible/contact feature profiles');
assert.match(runtimeSource, /rampDirection:\s*ramp\?\.runtime\?\.forward/, 'authored ramp contact does not preserve the visible takeoff direction');
for (const bridgePart of ['bridge-decks', 'bridge-fascias', 'bridge-portal-posts', 'bridge-portal-beams', 'bridge-marker-lights']) {
  assert.match(generationSource, new RegExp(`draw-track-${bridgePart}`), `procedural ${bridgePart} kit is missing`);
}

console.log('Kaki Rally Draw Your Track smoke passed');
