/** Local persistence and compact, versioned share codes for Draw Your Track. */
import {
  TRACK_SIZE_PRESETS,
  TRACK_WIDTH_PRESETS,
  DEFAULT_LAYOUT_TRANSFORM,
  createCanonicalTrackLayout,
  dedupeStroke,
  sanitizeLayoutTransform,
  simplifyClosed,
} from './drawTrackGeometry.js';
import {
  DRAW_TRACK_THEME_ORDER,
  DRAW_TRACK_THEMES,
  createDrawTrackId,
} from './drawTrackThemes.js';
import { sanitizeCourseFeaturePlacements } from './courseFeaturePlacement.js';
import { sanitizeCrossingOverrides } from './drawTrackCrossings.js';
import { sanitizeElevationProfile } from './drawTrackElevation.js';

export const DRAW_TRACK_SCHEMA_VERSION = 3;
export const DRAW_TRACK_STORAGE_KEY = 'kks_draw_tracks_v1';
const CODE_PREFIX = 'KDT3-';
const COMPATIBLE_CODE_PREFIX = 'KDT2-';
const LEGACY_CODE_PREFIX = 'KDT1-';
const MAX_SAVED_TRACKS = 36;
const MAX_SHARE_FEATURES = 96;
const MAX_SHARE_EXTENSION_BYTES = 48 * 1024;
const MAX_SHARE_CODE_CHARS = 70 * 1024;

const SIZE_ORDER = Object.freeze(Object.keys(TRACK_SIZE_PRESETS));
const WIDTH_ORDER = Object.freeze(Object.keys(TRACK_WIDTH_PRESETS));
const MODIFIER_BITS = Object.freeze({
  randomJumps: 1 << 0,
  boostPads: 1 << 1,
  nightRace: 1 << 2,
  rain: 1 << 3,
  snow: 1 << 4,
  noBarriers: 1 << 5,
  lowGravity: 1 << 6,
  mirror: 1 << 7,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantize(value, precision = 100000) {
  return Math.round(clamp(Number(value) || 0, 0, 1) * precision) / precision;
}

function safePoints(points, limit = 180) {
  return (points || [])
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .slice(0, limit)
    .map((point) => ({ x: quantize(point.x), y: quantize(point.y) }));
}

function normalizeDraft(input = {}) {
  const now = Date.now();
  const seed = (Number(input.seed) || now) >>> 0;
  const id = String(input.id || createDrawTrackId(seed)).slice(0, 80);
  const themeId = DRAW_TRACK_THEMES[input.themeId] ? input.themeId : 'countryside';
  const sizeId = TRACK_SIZE_PRESETS[input.sizeId] ? input.sizeId : 'club';
  const widthId = TRACK_WIDTH_PRESETS[input.widthId] ? input.widthId : 'standard';
  let controlPoints = safePoints(input.controlPoints?.length ? input.controlPoints : input.rawStroke);
  let rawStroke = safePoints(input.rawStroke?.length ? input.rawStroke : controlPoints, 1200);
  let layoutTransform;
  if (input.layoutTransform?.version >= 1) {
    layoutTransform = sanitizeLayoutTransform(input.layoutTransform);
  } else if (controlPoints.length >= 6) {
    const migrated = createCanonicalTrackLayout(rawStroke, controlPoints, sizeId);
    rawStroke = safePoints(migrated.rawPoints, 1200);
    controlPoints = safePoints(migrated.controlPoints);
    layoutTransform = migrated.layoutTransform;
  } else {
    layoutTransform = { ...DEFAULT_LAYOUT_TRANSFORM };
  }
  const crossingOverrides = sanitizeCrossingOverrides(input.crossingOverrides);
  const features = sanitizeCourseFeaturePlacements(input.featurePlacements, { mode: 'spline' });
  const elevation = sanitizeElevationProfile(input.elevationProfile);
  return {
    version: DRAW_TRACK_SCHEMA_VERSION,
    id,
    name: String(input.name || 'Untitled Kaki Circuit').trim().slice(0, 42) || 'Untitled Kaki Circuit',
    createdAt: Number(input.createdAt) || now,
    updatedAt: Number(input.updatedAt) || now,
    themeId,
    sizeId,
    widthId,
    seed,
    reverse: !!input.reverse,
    smoothing: clamp(Number(input.smoothing) || 0.55, 0, 1),
    layoutTransform,
    startFraction: ((Number(input.startFraction) || 0) % 1 + 1) % 1,
    laps: clamp(Math.round(Number(input.laps) || TRACK_SIZE_PRESETS[sizeId].laps), 1, 9),
    modifiers: { ...(input.modifiers || {}) },
    rawStroke,
    controlPoints,
    crossingOverrides,
    featurePlacements: features.placements,
    elevationProfile: elevation,
    dataWarnings: [
      ...(Array.isArray(input.dataWarnings) ? input.dataWarnings.filter((value) => typeof value === 'string').slice(0, 32) : []),
      ...features.warnings,
      ...elevation.warnings,
    ].slice(0, 48),
    favorite: !!input.favorite,
    raceCount: Math.max(0, Math.round(Number(input.raceCount) || 0)),
    bestLap: Number(input.bestLap) > 0 ? Number(input.bestLap) : null,
    bestResult: input.bestResult || null,
    vehicleRecord: input.vehicleRecord || null,
    stats: input.stats || null,
    ghost: input.ghost || null,
  };
}

function readPayload(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(DRAW_TRACK_STORAGE_KEY) || '{}');
    if (Array.isArray(parsed)) return { version: 1, tracks: parsed.map(normalizeDraft) };
    return {
      version: DRAW_TRACK_SCHEMA_VERSION,
      tracks: Array.isArray(parsed.tracks) ? parsed.tracks.map(normalizeDraft) : [],
    };
  } catch (_) {
    return { version: DRAW_TRACK_SCHEMA_VERSION, tracks: [] };
  }
}

function writePayload(storage, payload) {
  if (!storage?.setItem) return { saved: false, pruned: 0 };
  let tracks = [...payload.tracks];
  let pruned = 0;
  while (true) {
    try {
      storage.setItem(DRAW_TRACK_STORAGE_KEY, JSON.stringify({
        version: DRAW_TRACK_SCHEMA_VERSION,
        tracks,
      }));
      return { saved: true, pruned };
    } catch (error) {
      const removable = tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => !track.favorite)
        .sort((a, b) => (a.track.updatedAt || 0) - (b.track.updatedAt || 0))[0];
      if (!removable || tracks.length <= 1) {
        const quotaError = new Error('Track storage is full. Delete a saved creation and try again.');
        quotaError.name = 'TrackStorageQuotaError';
        quotaError.cause = error;
        throw quotaError;
      }
      tracks.splice(removable.index, 1);
      pruned++;
    }
  }
}

export class TrackSerializer {
  static serialize(draft) {
    return JSON.stringify(normalizeDraft(draft));
  }

  static deserialize(serialized) {
    const parsed = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
    if (!parsed || typeof parsed !== 'object') throw new Error('Saved track data is not an object');
    if ((Number(parsed.version) || 1) > DRAW_TRACK_SCHEMA_VERSION) {
      throw new Error(`Track save version ${parsed.version} is newer than this build`);
    }
    const migrated = normalizeDraft(parsed);
    if (migrated.controlPoints.length < 6) throw new Error('Saved track does not contain a complete circuit');
    return migrated;
  }
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : globalThis.Buffer?.from?.(bytes)?.toString?.('base64');
  if (!base64) throw new Error('This browser cannot encode track codes');
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  let binary;
  try {
    binary = typeof atob === 'function'
      ? atob(padded)
      : globalThis.Buffer?.from?.(padded, 'base64')?.toString?.('binary');
  } catch (_) {
    throw new Error('Track code is not valid base64 data');
  }
  if (typeof binary !== 'string') throw new Error('This browser cannot decode track codes');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function fnv1a(bytes, end = bytes.length) {
  let hash = 2166136261;
  for (let i = 0; i < end; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pushUint16(target, value) {
  target.push((value >>> 8) & 0xff, value & 0xff);
}

function pushUint32(target, value) {
  target.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function readUint16(bytes, offset) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function encodeRange(value, min, max) {
  return Math.round(clamp((Number(value) - min) / (max - min), 0, 1) * 65535);
}

function decodeRange(value, min, max) {
  return min + value / 65535 * (max - min);
}

function modifierFlags(modifiers = {}) {
  let flags = 0;
  for (const [name, bit] of Object.entries(MODIFIER_BITS)) if (modifiers[name]) flags |= bit;
  return flags;
}

function flagsToModifiers(flags) {
  return Object.fromEntries(Object.entries(MODIFIER_BITS).map(([name, bit]) => [name, !!(flags & bit)]));
}

function codePoints(draft) {
  let points = dedupeStroke(draft.controlPoints?.length ? draft.controlPoints : draft.rawStroke, 0.002);
  points = simplifyClosed(points, 0.0055);
  if (points.length > 62) {
    const stride = Math.ceil(points.length / 62);
    points = points.filter((_, index) => index % stride === 0).slice(0, 62);
  }
  if (points.length < 6) throw new Error('Draw a complete circuit before creating a track code');
  return points;
}

function compactNumber(value, precision = 10000) {
  return Math.round((Number(value) || 0) * precision) / precision;
}

function encodeExtension(draft) {
  if (draft.featurePlacements.length > MAX_SHARE_FEATURES) {
    throw new Error(`A KDT3 share code supports up to ${MAX_SHARE_FEATURES} placed features`);
  }
  const payload = {
    c: draft.crossingOverrides.map((override) => [
      override.id || '',
      override.mode,
      override.preset,
      override.approachLength == null ? null : compactNumber(override.approachLength, 100),
      override.point ? compactNumber(override.point.x) : null,
      override.point ? compactNumber(override.point.y) : null,
      override.branchFractions ? compactNumber(override.branchFractions[0], 100000) : null,
      override.branchFractions ? compactNumber(override.branchFractions[1], 100000) : null,
      override.overBranchFraction == null ? null : compactNumber(override.overBranchFraction, 100000),
    ]),
    f: draft.featurePlacements.map((placement) => [
      placement.id,
      placement.featureId,
      compactNumber(placement.anchor.fraction, 100000),
      compactNumber(placement.anchor.lateralOffset),
      placement.anchor.facing === 'backward' ? 1 : 0,
      compactNumber(placement.anchor.rotationOffset),
      compactNumber(placement.anchor.scaleX),
      compactNumber(placement.anchor.scaleY),
      compactNumber(placement.anchor.scaleZ),
      placement.source === 'auto-dress' ? 2 : placement.source === 'auto-fill' ? 1 : 0,
      Object.keys(placement.properties || {}).length ? placement.properties : null,
    ]),
    e: draft.elevationProfile.stamps.map((stamp) => [
      stamp.id,
      compactNumber(stamp.fraction, 100000),
      compactNumber(stamp.radius, 100000),
      compactNumber(stamp.elevation, 1000),
      compactNumber(stamp.bank, 100000),
    ]),
  };
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.length > MAX_SHARE_EXTENSION_BYTES || encoded.length > 65535) {
    throw new Error('KDT3 feature data is too large to share safely');
  }
  return encoded;
}

function decodeExtension(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (_) {
    throw new Error('KDT3 extension data is corrupt');
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.c) || !Array.isArray(parsed.f)) {
    throw new Error('KDT3 extension data is invalid');
  }
  if (parsed.c.length > 48 || parsed.f.length > MAX_SHARE_FEATURES) {
    throw new Error('KDT3 contains too many crossings or placed features');
  }
  const crossingOverrides = parsed.c.map((value) => ({
    id: String(value?.[0] || ''),
    mode: value?.[1],
    preset: value?.[2],
    approachLength: value?.[3],
    ...(value?.[4] != null && value?.[5] != null
      ? { point: { x: value[4], y: value[5] } }
      : {}),
    ...(value?.[6] != null && value?.[7] != null
      ? { branchFractions: [value[6], value[7]] }
      : {}),
    ...(value?.[8] != null ? { overBranchFraction: value[8] } : {}),
  }));
  const featurePlacements = parsed.f.map((value) => ({
    id: String(value?.[0] || ''),
    featureId: String(value?.[1] || ''),
    source: value?.[9] === 2 ? 'auto-dress' : value?.[9] === 1 ? 'auto-fill' : 'manual',
    properties: value?.[10] && typeof value[10] === 'object' ? value[10] : {},
    anchor: {
      mode: 'spline',
      fraction: value?.[2],
      lateralOffset: value?.[3],
      facing: value?.[4] === 1 ? 'backward' : 'forward',
      rotationOffset: value?.[5],
      scaleX: value?.[6],
      scaleY: value?.[7],
      scaleZ: value?.[8],
    },
  }));
  const elevationProfile = sanitizeElevationProfile({
    stamps: Array.isArray(parsed.e) ? parsed.e.map((value) => ({
      id: String(value?.[0] || ''),
      fraction: value?.[1],
      radius: value?.[2],
      elevation: value?.[3],
      bank: value?.[4],
    })) : [],
  });
  return { crossingOverrides, featurePlacements, elevationProfile };
}

export class TrackCodeCodec {
  static encode(input) {
    const draft = normalizeDraft(input);
    const points = codePoints(draft);
    const hasExtension = draft.crossingOverrides.length > 0
      || draft.featurePlacements.length > 0
      || draft.elevationProfile.stamps.length > 0;
    const version = hasExtension ? 3 : 2;
    const bytes = [
      version,
      Math.max(0, DRAW_TRACK_THEME_ORDER.indexOf(draft.themeId)),
      Math.max(0, SIZE_ORDER.indexOf(draft.sizeId)),
      Math.max(0, WIDTH_ORDER.indexOf(draft.widthId)),
      draft.reverse ? 1 : 0,
      modifierFlags(draft.modifiers),
    ];
    pushUint32(bytes, draft.seed);
    pushUint16(bytes, Math.round(draft.startFraction * 65535));
    bytes.push(Math.round(draft.smoothing * 255), points.length);
    const layout = sanitizeLayoutTransform(draft.layoutTransform);
    pushUint16(bytes, encodeRange(layout.occupancy, 0.48, 1.04));
    pushUint16(bytes, encodeRange(layout.scaleX, 0.52, 1.65));
    pushUint16(bytes, encodeRange(layout.scaleY, 0.52, 1.65));
    pushUint16(bytes, encodeRange(layout.offsetX, -0.32, 0.32));
    pushUint16(bytes, encodeRange(layout.offsetY, -0.32, 0.32));
    for (const point of points) {
      pushUint16(bytes, Math.round(clamp(point.x, 0, 1) * 4095));
      pushUint16(bytes, Math.round(clamp(point.y, 0, 1) * 4095));
    }
    if (version === 3) {
      const extension = encodeExtension(draft);
      pushUint16(bytes, extension.length);
      bytes.push(...extension);
    }
    pushUint32(bytes, fnv1a(bytes));
    const code = `${version === 3 ? CODE_PREFIX : COMPATIBLE_CODE_PREFIX}${bytesToBase64Url(Uint8Array.from(bytes))}`;
    if (code.length > MAX_SHARE_CODE_CHARS) throw new Error('Track code exceeds the safe share-code size');
    return code;
  }

  static encodeLegacy(input) {
    const draft = normalizeDraft(input);
    const points = codePoints(draft);
    const bytes = [
      1,
      Math.max(0, DRAW_TRACK_THEME_ORDER.indexOf(draft.themeId)),
      Math.max(0, SIZE_ORDER.indexOf(draft.sizeId)),
      Math.max(0, WIDTH_ORDER.indexOf(draft.widthId)),
      draft.reverse ? 1 : 0,
      modifierFlags(draft.modifiers),
    ];
    pushUint32(bytes, draft.seed);
    pushUint16(bytes, Math.round(draft.startFraction * 65535));
    bytes.push(Math.round(draft.smoothing * 255), points.length);
    for (const point of points) {
      pushUint16(bytes, Math.round(clamp(point.x, 0, 1) * 4095));
      pushUint16(bytes, Math.round(clamp(point.y, 0, 1) * 4095));
    }
    pushUint32(bytes, fnv1a(bytes));
    return `${LEGACY_CODE_PREFIX}${bytesToBase64Url(Uint8Array.from(bytes))}`;
  }

  static decode(code) {
    const source = String(code || '').trim().replace(/\s+/g, '');
    const prefix = source.startsWith(CODE_PREFIX) ? CODE_PREFIX
      : source.startsWith(COMPATIBLE_CODE_PREFIX) ? COMPATIBLE_CODE_PREFIX
      : source.startsWith(LEGACY_CODE_PREFIX) ? LEGACY_CODE_PREFIX : null;
    if (!prefix) throw new Error('Track code must begin with KDT1-, KDT2-, or KDT3-');
    if (source.length > MAX_SHARE_CODE_CHARS) throw new Error('Track code exceeds the safe size limit');
    const bytes = base64UrlToBytes(source.slice(prefix.length));
    if (bytes.length < 18) throw new Error('Track code is incomplete');
    const storedChecksum = readUint32(bytes, bytes.length - 4);
    const actualChecksum = fnv1a(bytes, bytes.length - 4);
    if (storedChecksum !== actualChecksum) throw new Error('Track code is corrupted or mistyped');
    const version = bytes[0];
    if (![1, 2, 3].includes(version)) throw new Error(`Unsupported track-code version ${version}`);
    const expectedPrefix = version === 1
      ? LEGACY_CODE_PREFIX
      : version === 2 ? COMPATIBLE_CODE_PREFIX : CODE_PREFIX;
    if (prefix !== expectedPrefix) throw new Error('Track code prefix and version do not match');
    const themeId = DRAW_TRACK_THEME_ORDER[bytes[1]];
    const sizeId = SIZE_ORDER[bytes[2]];
    const widthId = WIDTH_ORDER[bytes[3]];
    if (!themeId || !sizeId || !widthId) throw new Error('Track code references an unknown preset');
    const reverse = !!bytes[4];
    const modifiers = flagsToModifiers(bytes[5]);
    const seed = readUint32(bytes, 6);
    const startFraction = readUint16(bytes, 10) / 65535;
    const smoothing = bytes[12] / 255;
    const count = bytes[13];
    const pointOffset = version >= 2 ? 24 : 14;
    const pointsEnd = pointOffset + count * 4;
    const minimumLength = pointsEnd + (version === 3 ? 2 : 0) + 4;
    if (count < 6 || count > 62 || bytes.length < minimumLength) throw new Error('Track code has an invalid point count');
    if (version < 3 && bytes.length !== pointsEnd + 4) throw new Error('Track code has an invalid point count');
    const layoutTransform = version >= 2 ? sanitizeLayoutTransform({
      version: 1,
      occupancy: decodeRange(readUint16(bytes, 14), 0.48, 1.04),
      scaleX: decodeRange(readUint16(bytes, 16), 0.52, 1.65),
      scaleY: decodeRange(readUint16(bytes, 18), 0.52, 1.65),
      offsetX: decodeRange(readUint16(bytes, 20), -0.32, 0.32),
      offsetY: decodeRange(readUint16(bytes, 22), -0.32, 0.32),
    }) : null;
    const controlPoints = [];
    let offset = pointOffset;
    for (let i = 0; i < count; i++, offset += 4) {
      controlPoints.push({ x: readUint16(bytes, offset) / 4095, y: readUint16(bytes, offset + 2) / 4095 });
    }
    let extension = {
      crossingOverrides: [],
      featurePlacements: [],
      elevationProfile: sanitizeElevationProfile(),
    };
    if (version === 3) {
      const extensionLength = readUint16(bytes, pointsEnd);
      if (
        extensionLength > MAX_SHARE_EXTENSION_BYTES
        || pointsEnd + 2 + extensionLength + 4 !== bytes.length
      ) throw new Error('KDT3 extension length is invalid');
      extension = decodeExtension(bytes.slice(pointsEnd + 2, pointsEnd + 2 + extensionLength));
    }
    return normalizeDraft({
      id: createDrawTrackId(seed ^ actualChecksum),
      name: 'Imported Kaki Circuit',
      themeId,
      sizeId,
      widthId,
      seed,
      reverse,
      modifiers,
      smoothing,
      startFraction,
      ...(layoutTransform ? { layoutTransform } : {}),
      rawStroke: controlPoints,
      controlPoints,
      crossingOverrides: extension.crossingOverrides,
      featurePlacements: extension.featurePlacements,
      elevationProfile: extension.elevationProfile,
    });
  }
}

function sortTracks(tracks, sort = 'newest') {
  const list = [...tracks];
  if (sort === 'favorite') return list.sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt);
  if (sort === 'best') return list.sort((a, b) => (a.bestLap || Infinity) - (b.bestLap || Infinity) || b.updatedAt - a.updatedAt);
  if (sort === 'raced') return list.sort((a, b) => b.raceCount - a.raceCount || b.updatedAt - a.updatedAt);
  return list.sort((a, b) => b.updatedAt - a.updatedAt);
}

export class TrackGallery {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
  }

  list(sort = 'newest') {
    return sortTracks(readPayload(this.storage).tracks, sort);
  }

  get(id) {
    return this.list().find((track) => track.id === id) || null;
  }

  save(input) {
    const track = normalizeDraft({ ...input, updatedAt: Date.now() });
    const payload = readPayload(this.storage);
    const existing = payload.tracks.findIndex((item) => item.id === track.id);
    if (existing >= 0) {
      track.createdAt = payload.tracks[existing].createdAt;
      track.favorite = input.favorite ?? payload.tracks[existing].favorite;
      track.raceCount = input.raceCount ?? payload.tracks[existing].raceCount;
      track.bestLap = input.bestLap ?? payload.tracks[existing].bestLap;
      track.ghost = input.ghost ?? payload.tracks[existing].ghost;
      payload.tracks[existing] = track;
    } else {
      payload.tracks.unshift(track);
    }
    payload.tracks = sortTracks(payload.tracks, 'newest').slice(0, MAX_SAVED_TRACKS);
    const result = writePayload(this.storage, payload);
    return { track, ...result };
  }

  rename(id, name) {
    const track = this.get(id);
    if (!track) return null;
    return this.save({ ...track, name: String(name || '').trim().slice(0, 42) || track.name }).track;
  }

  toggleFavorite(id) {
    const track = this.get(id);
    if (!track) return null;
    return this.save({ ...track, favorite: !track.favorite }).track;
  }

  duplicate(id) {
    const source = this.get(id);
    if (!source) return null;
    const seed = (source.seed ^ Date.now()) >>> 0;
    return this.save({
      ...source,
      id: createDrawTrackId(seed),
      name: `${source.name} Copy`.slice(0, 42),
      seed,
      createdAt: Date.now(),
      favorite: false,
      raceCount: 0,
      bestLap: null,
      ghost: null,
    }).track;
  }

  delete(id) {
    const payload = readPayload(this.storage);
    const before = payload.tracks.length;
    payload.tracks = payload.tracks.filter((track) => track.id !== id);
    if (payload.tracks.length === before) return false;
    writePayload(this.storage, payload);
    return true;
  }

  recordRace(id, { lapTime = null, result = null, vehicle = null, ghost = null } = {}) {
    const track = this.get(id);
    if (!track) return null;
    const validLap = Number(lapTime) > 0 ? Number(lapTime) : null;
    const isBest = validLap && (!track.bestLap || validLap < track.bestLap);
    return this.save({
      ...track,
      raceCount: track.raceCount + 1,
      bestLap: isBest ? validLap : track.bestLap,
      bestResult: result || track.bestResult,
      vehicleRecord: isBest && vehicle ? vehicle : track.vehicleRecord,
      ghost: isBest && ghost ? ghost : track.ghost,
    }).track;
  }

  summary() {
    const tracks = this.list();
    const best = tracks.filter((track) => track.bestLap).sort((a, b) => a.bestLap - b.bestLap)[0] || null;
    return { count: tracks.length, bestLap: best?.bestLap || null, bestName: best?.name || '' };
  }
}

export function getTrackGallerySummary(storage = globalThis.localStorage) {
  try { return new TrackGallery(storage).summary(); } catch (_) { return { count: 0, bestLap: null, bestName: '' }; }
}
