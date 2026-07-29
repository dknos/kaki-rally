import { clamp } from '../physics.js';

export const DUNE_RECORDS_KEY = 'kks_dune_records_v1';
export const DUNE_RECORDS_SCHEMA = 1;
export const DUNE_GHOST_HZ = 10;
export const DUNE_GHOST_MAX_SAMPLES = 2400;

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function quantize(value, precision = 1000) {
  return Math.round(finite(value) * precision) / precision;
}

function cleanGhostSamples(source) {
  if (!Array.isArray(source)) return [];
  const samples = [];
  let previousTime = -1;
  for (let index = 0; index < source.length && samples.length < DUNE_GHOST_MAX_SAMPLES; index += 1) {
    const sample = source[index];
    const t = finite(sample?.t, NaN);
    const x = finite(sample?.x, NaN);
    const y = finite(sample?.y, NaN);
    const z = finite(sample?.z, NaN);
    const yaw = finite(sample?.yaw, NaN);
    if (![t, x, y, z, yaw].every(Number.isFinite) || t < previousTime || t < 0) continue;
    samples.push({
      t: quantize(t),
      x: quantize(x),
      y: quantize(y),
      z: quantize(z),
      yaw: quantize(yaw, 10000),
      pitch: quantize(sample?.pitch, 10000),
      roll: quantize(sample?.roll, 10000),
    });
    previousTime = t;
  }
  return samples;
}

export function sanitizeDuneRecords(input = {}) {
  const source = input?.records && typeof input.records === 'object'
    ? input.records
    : {};
  const records = {};
  for (const [key, record] of Object.entries(source)) {
    if (!record || typeof record !== 'object') continue;
    const time = finite(record.time, Infinity);
    const score = Math.max(0, Math.round(finite(record.score)));
    if (!Number.isFinite(time) && !(score > 0)) continue;
    records[String(key).slice(0, 96)] = {
      eventId: String(record.eventId || '').slice(0, 32),
      vehicleId: String(record.vehicleId || 'meowster').slice(0, 32),
      time: Number.isFinite(time) ? quantize(time) : null,
      score,
      medal: ['S', 'A', 'B', 'FINISH'].includes(record.medal) ? record.medal : '',
      ghost: cleanGhostSamples(record.ghost),
      setAt: String(record.setAt || ''),
    };
  }
  return { schema: DUNE_RECORDS_SCHEMA, records };
}

export function readDuneRecords(storage = globalThis.localStorage) {
  try {
    if (!storage?.getItem) return sanitizeDuneRecords();
    return sanitizeDuneRecords(JSON.parse(storage.getItem(DUNE_RECORDS_KEY) || '{}'));
  } catch (_) {
    return sanitizeDuneRecords();
  }
}

export function writeDuneRecords(records, storage = globalThis.localStorage) {
  const sanitized = sanitizeDuneRecords(records);
  storage?.setItem?.(DUNE_RECORDS_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function duneRecordKey(eventId, vehicleId = 'meowster') {
  return `${String(eventId || 'whiskerwind')}:${String(vehicleId || 'meowster')}`;
}

export function createDuneRecordRun({
  eventId = 'whiskerwind',
  vehicleId = 'meowster',
  previousRecord = null,
} = {}) {
  return {
    eventId,
    vehicleId,
    key: duneRecordKey(eventId, vehicleId),
    elapsed: 0,
    score: 0,
    sampleAccumulator: 0,
    sampleInterval: 1 / DUNE_GHOST_HZ,
    sampleCount: 0,
    samples: new Array(DUNE_GHOST_MAX_SAMPLES),
    previousRecord,
    finished: false,
  };
}

export function stepDuneRecordRun(run, kart, dt, {
  score = run?.score || 0,
  active = true,
} = {}) {
  if (!run || run.finished || !(dt > 0) || !active) return run;
  run.elapsed += dt;
  run.score = Math.max(run.score, Math.round(finite(score)));
  run.sampleAccumulator += dt;
  while (run.sampleAccumulator >= run.sampleInterval && run.sampleCount < DUNE_GHOST_MAX_SAMPLES) {
    run.sampleAccumulator -= run.sampleInterval;
    run.samples[run.sampleCount] = {
      t: quantize(run.elapsed),
      x: quantize(kart.x),
      y: quantize(kart.y),
      z: quantize(kart.z),
      yaw: quantize(kart.yaw, 10000),
      pitch: quantize(kart.contactPitch ?? kart.bodyPitch, 10000),
      roll: quantize(kart.contactRoll ?? kart.bodyRoll, 10000),
    };
    run.sampleCount += 1;
  }
  return run;
}

export function medalForDuneResult(eventDefinition, {
  time = null,
  score = 0,
} = {}) {
  const medals = eventDefinition?.medals || {};
  if (eventDefinition?.routeType === 'freeride') {
    if (score >= medals.S) return 'S';
    if (score >= medals.A) return 'A';
    if (score >= medals.B) return 'B';
    return 'FINISH';
  }
  if (Number(time) <= medals.S) return 'S';
  if (Number(time) <= medals.A) return 'A';
  if (Number(time) <= medals.B) return 'B';
  return 'FINISH';
}

export function finishDuneRecordRun(run, eventDefinition, storage = globalThis.localStorage) {
  if (!run || run.finished) return run?.result || null;
  run.finished = true;
  const time = eventDefinition?.routeType === 'freeride' ? null : quantize(run.elapsed);
  const score = Math.max(0, Math.round(run.score));
  const medal = medalForDuneResult(eventDefinition, { time, score });
  const ghost = cleanGhostSamples(run.samples.slice(0, run.sampleCount));
  const progress = readDuneRecords(storage);
  const previous = progress.records[run.key] || run.previousRecord || null;
  const isScore = eventDefinition?.routeType === 'freeride';
  const improved = !previous
    || (isScore ? score > finite(previous.score) : time < finite(previous.time, Infinity));
  if (improved) {
    progress.records[run.key] = {
      eventId: run.eventId,
      vehicleId: run.vehicleId,
      time,
      score,
      medal,
      ghost,
      setAt: new Date().toISOString(),
    };
    writeDuneRecords(progress, storage);
  }
  run.result = {
    improved,
    time,
    score,
    medal,
    previous,
    record: improved ? progress.records[run.key] : previous,
  };
  return run.result;
}

export function createDuneGhostPlayback(record) {
  const samples = cleanGhostSamples(record?.ghost);
  return {
    samples,
    cursor: 0,
    visible: samples.length >= 2,
    sample: {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
    },
  };
}

export function sampleDuneGhost(playback, time, target = playback?.sample) {
  const samples = playback?.samples;
  if (!samples?.length || !target) return null;
  const elapsed = Math.max(0, finite(time));
  while (playback.cursor < samples.length - 2 && samples[playback.cursor + 1].t <= elapsed) {
    playback.cursor += 1;
  }
  while (playback.cursor > 0 && samples[playback.cursor].t > elapsed) playback.cursor -= 1;
  const first = samples[playback.cursor];
  const second = samples[Math.min(samples.length - 1, playback.cursor + 1)];
  const amount = clamp((elapsed - first.t) / Math.max(1e-6, second.t - first.t), 0, 1);
  target.x = first.x + (second.x - first.x) * amount;
  target.y = first.y + (second.y - first.y) * amount;
  target.z = first.z + (second.z - first.z) * amount;
  let yawDelta = second.yaw - first.yaw;
  if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
  else if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
  target.yaw = first.yaw + yawDelta * amount;
  target.pitch = first.pitch + (second.pitch - first.pitch) * amount;
  target.roll = first.roll + (second.roll - first.roll) * amount;
  return target;
}
