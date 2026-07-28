import {
  getCourseFeature,
} from './courseFeatureCatalog.js';
import {
  createCourseFeaturePlacementId,
  sanitizeCourseFeaturePlacements,
} from './courseFeaturePlacement.js';
import {
  TRIALS_TRACKS,
  getTrialsTrack,
  sampleTrialsGround,
} from './trialsTracks.js';

export const CUSTOM_TRIALS_STORAGE_KEY = 'kks_rally_trials_courses_v1';
export const TRIALS_SHARE_PREFIX = 'KTR1-';
export const TRIALS_COURSE_SCHEMA_VERSION = 1;
export const MAX_TRIALS_SHARE_BYTES = 64 * 1024;
export const MAX_TRIALS_COURSES = 48;
export const MAX_TRIALS_FEATURES = 240;

const THEMES = Object.freeze(['meadow', 'quarry', 'crown']);
const VEHICLE_SUPPORT = Object.freeze(['both', 'monster', 'buggy']);
const OBSTACLE_KIND_BY_FEATURE = Object.freeze({
  'hay-bales': 'hay-bale',
  'wooden-crates': 'wood-crate',
  'barrel-stack': 'barrel-stack',
  'ore-cart': 'ore-cart',
  'rock-pile': 'rock-stack',
  'toy-cars': 'toy-car',
  'crown-targets': 'crown-stack',
  'smash-target-chain': 'crown-stack',
  'kaki-delivery-cart': 'ore-cart',
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function cleanText(value, fallback, limit) {
  const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, limit);
}

function cleanId(value, fallback = '') {
  return String(value || fallback).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function fnv1a(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function bytesToBase64Url(bytes) {
  let base64;
  if (typeof Buffer !== 'undefined') {
    base64 = Buffer.from(bytes).toString('base64');
  } else {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(padded, 'base64'));
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function defaultColors(themeId) {
  const source = TRIALS_TRACKS[themeId] || TRIALS_TRACKS.meadow;
  return { ...source.colors };
}

function sanitizeHeightPoints(input, length, warnings) {
  const source = Array.isArray(input) ? input : [];
  const sorted = source
    .slice(0, 256)
    .map((point) => ({
      x: clamp(finite(point?.x), 0, length),
      y: clamp(finite(point?.y, 4), 0, 92),
      ...(Number.isFinite(Number(point?.slope))
        ? { slope: clamp(Number(point.slope), -1.35, 1.35) }
        : {}),
    }))
    .sort((a, b) => a.x - b.x);
  const points = [];
  for (const point of sorted) {
    if (points.length && point.x - points.at(-1).x < 2.5) {
      warnings.push('Terrain points closer than 2.5 m were merged.');
      const previous = points.at(-1);
      previous.y = (previous.y + point.y) * 0.5;
      continue;
    }
    points.push(point);
  }
  if (points.length < 4) {
    warnings.push('Terrain profile was incomplete and a safe rolling profile was substituted.');
    return [
      { x: 0, y: 4, slope: 0 },
      { x: length * 0.32, y: 7 },
      { x: length * 0.66, y: 4.8 },
      { x: length, y: 5, slope: 0 },
    ];
  }
  points[0].x = 0;
  points.at(-1).x = length;
  // Clamp derived grade without erasing the player's silhouette.
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const maximumDelta = (points[index].x - previous.x) * 1.28;
    points[index].y = clamp(points[index].y, previous.y - maximumDelta, previous.y + maximumDelta);
  }
  return points;
}

function sanitizeGaps(input, length, warnings) {
  const gaps = [];
  const source = Array.isArray(input) ? input : [];
  for (const raw of source.slice(0, 64)) {
    const start = clamp(Math.min(finite(raw?.start), finite(raw?.end)), 8, length - 10);
    const end = clamp(Math.max(finite(raw?.start), finite(raw?.end)), start + 2, Math.min(length - 6, start + 120));
    if (end - start < 2) continue;
    const overlap = gaps.find((gap) => start < gap.end + 2 && end > gap.start - 2);
    if (overlap) {
      overlap.start = Math.min(overlap.start, start);
      overlap.end = Math.max(overlap.end, end);
      warnings.push('Overlapping gaps were merged.');
      continue;
    }
    gaps.push({
      start,
      end,
      label: cleanText(raw?.label, `Gap ${gaps.length + 1}`, 32),
    });
  }
  return gaps.sort((a, b) => a.start - b.start);
}

export function createTrialsCourseId(seed = Date.now()) {
  const value = (Math.imul((Number(seed) || 1) >>> 0, 2654435761) ^ 0x4b545231) >>> 0;
  return `ktr-${value.toString(36)}`;
}

export function createEmptyTrialsCourse({
  seed = Date.now(),
  rolling = true,
  length = 720,
  themeId = 'meadow',
} = {}) {
  const safeLength = clamp(finite(length, 720), 220, 2000);
  const points = rolling
    ? Array.from({ length: 15 }, (_, index) => {
      const x = safeLength * index / 14;
      const y = 5.5
        + Math.sin(index * 1.37 + Number(seed) * 0.001) * 2.5
        + Math.sin(index * 0.53) * 1.4;
      return {
        x,
        y: clamp(y, 2.5, 12),
        ...(index === 0 || index === 14 ? { slope: 0 } : {}),
      };
    })
    : [
      { x: 0, y: 5, slope: 0 },
      { x: safeLength * 0.33, y: 5 },
      { x: safeLength * 0.66, y: 5 },
      { x: safeLength, y: 5, slope: 0 },
    ];
  const checkpointXs = [safeLength * 0.34, safeLength * 0.67];
  const featurePlacements = [
    ...checkpointXs.map((x, index) => ({
      id: createCourseFeaturePlacementId('checkpoint-gate', seed ^ 0x43a2, index),
      featureId: 'checkpoint-gate',
      anchor: {
        mode: 'trials',
        x,
        groundOffset: 0,
        facing: 1,
        rotationOffset: 0,
        scaleX: 1,
        scaleY: 1,
      },
      properties: { label: `Workshop Bell ${index + 1}` },
    })),
    {
      id: createCourseFeaturePlacementId('trials-finish-gate', seed ^ 0x9e37, 0),
      featureId: 'trials-finish-gate',
      anchor: {
        mode: 'trials',
        x: safeLength - 20,
        groundOffset: 0,
        facing: 1,
        rotationOffset: 0,
        scaleX: 1,
        scaleY: 1,
      },
    },
  ];
  return {
    schemaVersion: TRIALS_COURSE_SCHEMA_VERSION,
    id: createTrialsCourseId(seed),
    custom: true,
    name: rolling ? 'Rolling Workshop Run' : 'Blank Workshop Run',
    subtitle: 'Built in Kaki Course Workshop.',
    themeId: THEMES.includes(themeId) ? themeId : 'meadow',
    sourceOfficialId: null,
    vehicleSupport: 'both',
    seed: (Number(seed) || Date.now()) >>> 0,
    length: safeLength,
    finish: safeLength - 20,
    spawn: { x: 8 },
    heightPoints: points,
    gaps: [],
    featurePlacements,
    medals: { S: 70, A: 92, B: 120 },
    records: {},
    favorite: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function duplicateOfficialTrialsCourse(trackId = 'meadow', {
  seed = Date.now(),
} = {}) {
  const source = getTrialsTrack(trackId);
  const obstacleFeature = {
    'hay-bale': 'hay-bales',
    'wood-crate': 'wooden-crates',
    'candy-crate': 'wooden-crates',
    'barrel-stack': 'barrel-stack',
    'ore-cart': 'ore-cart',
    'rock-stack': 'rock-pile',
    'toy-car': 'toy-cars',
    'crown-stack': 'crown-targets',
  };
  const placements = [
    ...source.obstacles.map((obstacle, index) => ({
      id: createCourseFeaturePlacementId(obstacleFeature[obstacle.kind] || 'wooden-crates', seed, index),
      featureId: obstacleFeature[obstacle.kind] || 'wooden-crates',
      anchor: {
        mode: 'trials',
        x: obstacle.x,
        groundOffset: 0,
        facing: 1,
        rotationOffset: 0,
        scaleX: 1,
        scaleY: 1,
      },
    })),
    ...source.checkpoints.map((checkpoint, index) => ({
      id: createCourseFeaturePlacementId('checkpoint-gate', seed ^ 0x2f4a, index),
      featureId: 'checkpoint-gate',
      anchor: {
        mode: 'trials',
        x: checkpoint.x,
        groundOffset: 0,
        facing: 1,
        rotationOffset: 0,
        scaleX: 1,
        scaleY: 1,
      },
      properties: { label: checkpoint.label },
    })),
    {
      id: createCourseFeaturePlacementId('trials-finish-gate', seed ^ 0x9e37, 0),
      featureId: 'trials-finish-gate',
      anchor: {
        mode: 'trials',
        x: source.finish,
        groundOffset: 0,
        facing: 1,
        rotationOffset: 0,
        scaleX: 1,
        scaleY: 1,
      },
    },
  ];
  return sanitizeTrialsCourse({
    ...source,
    id: createTrialsCourseId(seed),
    custom: true,
    name: `${source.name} Copy`,
    subtitle: `Editable workshop copy of ${source.name}.`,
    themeId: source.id,
    sourceOfficialId: source.id,
    featurePlacements: placements,
    records: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }).course;
}

export function sanitizeTrialsCourse(input = {}, {
  preserveId = true,
} = {}) {
  const warnings = [];
  const themeId = THEMES.includes(input.themeId)
    ? input.themeId
    : THEMES.includes(input.sourceOfficialId) ? input.sourceOfficialId : 'meadow';
  const length = clamp(finite(input.length, 720), 220, 2000);
  const heightPoints = sanitizeHeightPoints(input.heightPoints, length, warnings);
  const gaps = sanitizeGaps(input.gaps, length, warnings);
  const sanitizedFeatures = sanitizeCourseFeaturePlacements(input.featurePlacements, {
    mode: 'trials',
    limit: MAX_TRIALS_FEATURES,
  });
  warnings.push(...sanitizedFeatures.warnings);
  const finishPlacement = sanitizedFeatures.placements.find((placement) => placement.featureId === 'trials-finish-gate');
  const finish = clamp(
    finite(finishPlacement?.anchor?.x, finite(input.finish, length - 20)),
    40,
    length - 5,
  );
  const s = clamp(finite(input.medals?.S, 70), 12, 900);
  const a = clamp(finite(input.medals?.A, Math.max(s + 8, 92)), s + 1, 1200);
  const b = clamp(finite(input.medals?.B, Math.max(a + 12, 120)), a + 1, 1800);
  const id = preserveId
    ? cleanId(input.id, createTrialsCourseId(input.seed))
    : createTrialsCourseId((Number(input.seed) || Date.now()) ^ Date.now());
  const course = {
    schemaVersion: TRIALS_COURSE_SCHEMA_VERSION,
    id,
    custom: true,
    name: cleanText(input.name, 'Untitled Trials Run', 48),
    subtitle: cleanText(input.subtitle, 'Built in Kaki Course Workshop.', 120),
    themeId,
    sourceOfficialId: THEMES.includes(input.sourceOfficialId) ? input.sourceOfficialId : null,
    vehicleSupport: VEHICLE_SUPPORT.includes(input.vehicleSupport) ? input.vehicleSupport : 'both',
    seed: (finite(input.seed, Date.now()) >>> 0),
    colors: defaultColors(themeId),
    difficulty: clamp(Math.round(finite(input.difficulty, 2)), 1, 5),
    difficultyLabel: cleanText(input.difficultyLabel, 'Workshop', 24),
    length,
    finish,
    spawn: { x: clamp(finite(input.spawn?.x, 8), 2, Math.min(30, finish - 12)) },
    heightPoints,
    gaps,
    featurePlacements: sanitizedFeatures.placements,
    medals: { S: s, A: a, B: b },
    records: input.records && typeof input.records === 'object' ? structuredClone(input.records) : {},
    favorite: !!input.favorite,
    createdAt: Math.max(0, Math.round(finite(input.createdAt, Date.now()))),
    updatedAt: Math.max(0, Math.round(finite(input.updatedAt, Date.now()))),
  };
  return {
    course: materializeTrialsCourse(course),
    warnings: [...new Set(warnings)],
  };
}

export function materializeTrialsCourse(input) {
  const placements = Array.isArray(input.featurePlacements) ? input.featurePlacements : [];
  const checkpoints = placements
    .filter((placement) => placement.featureId === 'checkpoint-gate')
    .sort((a, b) => a.anchor.x - b.anchor.x)
    .map((placement, index) => ({
      id: placement.id,
      x: placement.anchor.x,
      label: cleanText(placement.properties?.label, `Workshop Bell ${index + 1}`, 32),
      placementId: placement.id,
    }));
  const obstacles = placements
    .filter((placement) => OBSTACLE_KIND_BY_FEATURE[placement.featureId])
    .map((placement) => {
      const feature = getCourseFeature(placement.featureId);
      return {
        id: placement.id,
        kind: OBSTACLE_KIND_BY_FEATURE[placement.featureId],
        x: placement.anchor.x,
        width: feature.footprint.width * placement.anchor.scaleX,
        height: feature.footprint.clearanceHeight * placement.anchor.scaleY,
        featureId: placement.featureId,
        placementId: placement.id,
      };
    });
  return {
    ...input,
    colors: { ...defaultColors(input.themeId), ...(input.colors || {}) },
    checkpoints,
    obstacles,
    finish: clamp(finite(input.finish, input.length - 20), 40, input.length - 5),
  };
}

function compactCourse(course) {
  return {
    v: 1,
    i: course.id,
    n: course.name,
    d: course.subtitle,
    t: course.themeId,
    o: course.sourceOfficialId,
    u: course.vehicleSupport,
    s: course.seed,
    l: course.length,
    f: course.finish,
    p: course.spawn.x,
    h: course.heightPoints.map((point) => [
      Math.round(point.x * 100) / 100,
      Math.round(point.y * 100) / 100,
      Number.isFinite(point.slope) ? Math.round(point.slope * 1000) / 1000 : null,
    ]),
    g: course.gaps.map((gap) => [
      Math.round(gap.start * 100) / 100,
      Math.round(gap.end * 100) / 100,
      gap.label,
    ]),
    x: course.featurePlacements.map((placement) => [
      placement.id,
      placement.featureId,
      Math.round(placement.anchor.x * 100) / 100,
      Math.round(placement.anchor.groundOffset * 100) / 100,
      placement.anchor.facing,
      Math.round(placement.anchor.rotationOffset * 1000) / 1000,
      Math.round(placement.anchor.scaleX * 100) / 100,
      Math.round(placement.anchor.scaleY * 100) / 100,
      placement.properties || {},
    ]),
    m: [course.medals.S, course.medals.A, course.medals.B],
  };
}

function expandCourse(data) {
  if (!data || data.v !== 1 || !Array.isArray(data.h) || !Array.isArray(data.x)) {
    throw new Error('KTR1 course data is incomplete.');
  }
  return {
    schemaVersion: 1,
    id: data.i,
    custom: true,
    name: data.n,
    subtitle: data.d,
    themeId: data.t,
    sourceOfficialId: data.o,
    vehicleSupport: data.u,
    seed: data.s,
    length: data.l,
    finish: data.f,
    spawn: { x: data.p },
    heightPoints: data.h.map(([x, y, slope]) => ({
      x,
      y,
      ...(Number.isFinite(slope) ? { slope } : {}),
    })),
    gaps: (data.g || []).map(([start, end, label]) => ({ start, end, label })),
    featurePlacements: data.x.map((value) => ({
      id: value[0],
      featureId: value[1],
      anchor: {
        mode: 'trials',
        x: value[2],
        groundOffset: value[3],
        facing: value[4],
        rotationOffset: value[5],
        scaleX: value[6],
        scaleY: value[7],
      },
      properties: value[8] || {},
    })),
    medals: { S: data.m?.[0], A: data.m?.[1], B: data.m?.[2] },
  };
}

export const TrialsCourseCodec = Object.freeze({
  encode(input) {
    const { course } = sanitizeTrialsCourse(input);
    const bytes = new TextEncoder().encode(JSON.stringify(compactCourse(course)));
    if (bytes.length > MAX_TRIALS_SHARE_BYTES) throw new Error('KTR1 course exceeds the 64 KiB share limit.');
    return `${TRIALS_SHARE_PREFIX}${bytesToBase64Url(bytes)}.${fnv1a(bytes)}`;
  },
  decode(code) {
    const value = String(code || '').trim();
    if (!value.startsWith(TRIALS_SHARE_PREFIX) || value.length > MAX_TRIALS_SHARE_BYTES * 2) {
      throw new Error('Not a bounded KTR1 course code.');
    }
    const [payload, checksum] = value.slice(TRIALS_SHARE_PREFIX.length).split('.');
    if (!payload || !checksum) throw new Error('KTR1 course code is incomplete.');
    let bytes;
    try {
      bytes = base64UrlToBytes(payload);
    } catch (_) {
      throw new Error('KTR1 course payload is not valid base64.');
    }
    if (!bytes.length || bytes.length > MAX_TRIALS_SHARE_BYTES || fnv1a(bytes) !== checksum) {
      throw new Error('KTR1 checksum failed.');
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
      throw new Error('KTR1 payload is not valid JSON.');
    }
    return sanitizeTrialsCourse(expandCourse(parsed));
  },
});

function storedCourse(course) {
  const {
    checkpoints,
    obstacles,
    colors,
    ...source
  } = course;
  return source;
}

export class TrialsCourseLibrary {
  constructor(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.storage = storage;
  }

  read() {
    const fallback = { version: 1, courses: [] };
    if (!this.storage) return fallback;
    try {
      const parsed = JSON.parse(this.storage.getItem(CUSTOM_TRIALS_STORAGE_KEY) || '{}');
      if (!parsed || !Array.isArray(parsed.courses)) return fallback;
      const courses = [];
      for (const value of parsed.courses.slice(0, MAX_TRIALS_COURSES)) {
        try {
          courses.push(sanitizeTrialsCourse(value).course);
        } catch (_) {}
      }
      return { version: 1, courses };
    } catch (_) {
      return fallback;
    }
  }

  write(data) {
    if (!this.storage) return false;
    const payload = {
      version: 1,
      courses: data.courses.slice(0, MAX_TRIALS_COURSES).map(storedCourse),
    };
    try {
      this.storage.setItem(CUSTOM_TRIALS_STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (error) {
      const wrapped = new Error('Custom Trials library could not be saved. Browser storage may be full.');
      wrapped.cause = error;
      throw wrapped;
    }
  }

  list() {
    return this.read().courses;
  }

  get(id) {
    return this.read().courses.find((course) => course.id === id) || null;
  }

  save(input) {
    const data = this.read();
    const sanitized = sanitizeTrialsCourse({
      ...input,
      updatedAt: Date.now(),
    }).course;
    const index = data.courses.findIndex((course) => course.id === sanitized.id);
    if (index >= 0) data.courses[index] = sanitized;
    else data.courses.unshift(sanitized);
    this.write(data);
    return sanitized;
  }

  duplicate(id) {
    const source = this.get(id);
    if (!source) throw new Error('Custom Trials course was not found.');
    return this.save(sanitizeTrialsCourse({
      ...storedCourse(source),
      id: createTrialsCourseId(Date.now()),
      name: `${source.name} Copy`,
      records: {},
      favorite: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).course);
  }

  delete(id) {
    const data = this.read();
    const next = data.courses.filter((course) => course.id !== id);
    if (next.length === data.courses.length) return false;
    this.write({ ...data, courses: next });
    return true;
  }

  recordResult(id, vehicleId, result, ghost = []) {
    const data = this.read();
    const index = data.courses.findIndex((course) => course.id === id);
    if (index < 0) return false;
    const course = data.courses[index];
    const previous = course.records?.[vehicleId];
    if (previous && Number(previous.effectiveTime) <= Number(result.effectiveTime)) return false;
    course.records = {
      ...(course.records || {}),
      [vehicleId]: {
        ...result,
        ghost: Array.isArray(ghost) ? ghost.slice(0, 1800) : [],
        updatedAt: Date.now(),
      },
    };
    this.write(data);
    return true;
  }
}

export function customTrialsCourseGroundSummary(course) {
  const samples = [];
  for (let x = 0; x <= course.length; x += Math.max(2, course.length / 300)) {
    const ground = sampleTrialsGround(course, x);
    if (ground) samples.push(ground.height);
  }
  return {
    min: samples.length ? Math.min(...samples) : 0,
    max: samples.length ? Math.max(...samples) : 0,
    samples: samples.length,
  };
}
