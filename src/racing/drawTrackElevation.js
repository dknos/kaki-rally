/**
 * Bounded elevation and banking stamps for Draw Your Track.
 *
 * Stamps are intentionally sparse and additive. Legacy tracks have an empty
 * profile, while KDT3 can carry the same small records without changing its
 * binary envelope. Runtime sampling is deterministic and allocation-free.
 */

export const MAX_ELEVATION_STAMPS = 32;
export const MAX_TRACK_ELEVATION = 12;
export const MIN_TRACK_ELEVATION = -4;
export const MAX_TRACK_BANK = 0.24;
export const MIN_STAMP_RADIUS = 0.035;
export const MAX_STAMP_RADIUS = 0.24;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapFraction(value) {
  return ((Number(value) || 0) % 1 + 1) % 1;
}

function cyclicDistance(a, b) {
  const direct = Math.abs(wrapFraction(a) - wrapFraction(b));
  return Math.min(direct, 1 - direct);
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function sanitizeElevationProfile(input = {}) {
  const source = Array.isArray(input) ? input : Array.isArray(input?.stamps) ? input.stamps : [];
  const warnings = [];
  const stamps = [];
  const seen = new Set();
  for (let index = 0; index < source.length && stamps.length < MAX_ELEVATION_STAMPS; index += 1) {
    const entry = source[index];
    if (!entry || typeof entry !== 'object') {
      warnings.push(`Elevation stamp ${index + 1} was ignored.`);
      continue;
    }
    const elevation = clamp(finite(entry.elevation), MIN_TRACK_ELEVATION, MAX_TRACK_ELEVATION);
    const bank = clamp(finite(entry.bank), -MAX_TRACK_BANK, MAX_TRACK_BANK);
    if (Math.abs(elevation) < 0.001 && Math.abs(bank) < 0.0005) continue;
    let id = String(entry.id || `profile-${index.toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
    if (!id) id = `profile-${index.toString(36)}`;
    while (seen.has(id)) id = `${id.slice(0, 42)}-${index.toString(36)}`;
    seen.add(id);
    stamps.push({
      id,
      fraction: wrapFraction(entry.fraction),
      radius: clamp(finite(entry.radius, 0.1), MIN_STAMP_RADIUS, MAX_STAMP_RADIUS),
      elevation,
      bank,
    });
  }
  if (source.length > MAX_ELEVATION_STAMPS) {
    warnings.push(`Elevation profile was limited to ${MAX_ELEVATION_STAMPS} stamps.`);
  }
  stamps.sort((a, b) => a.fraction - b.fraction || a.id.localeCompare(b.id));
  return { version: 1, stamps, warnings };
}

export function sampleElevationProfile(input, fraction, target = {}) {
  const stamps = input?.stamps || [];
  let elevation = 0;
  let bank = 0;
  const at = wrapFraction(fraction);
  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = stamps[index];
    const distance = cyclicDistance(at, stamp.fraction);
    if (distance >= stamp.radius) continue;
    const amount = 0.5 + 0.5 * Math.cos(Math.PI * distance / stamp.radius);
    elevation += stamp.elevation * amount;
    bank += stamp.bank * amount;
  }
  target.elevation = clamp(elevation, MIN_TRACK_ELEVATION, MAX_TRACK_ELEVATION);
  target.bank = clamp(bank, -MAX_TRACK_BANK, MAX_TRACK_BANK);
  return target;
}

export function editElevationProfile(input, tool, fraction, ordinal = 0) {
  const profile = sanitizeElevationProfile(input);
  const at = wrapFraction(fraction);
  if (tool === 'reset') return { version: 1, stamps: [], warnings: [] };
  if (tool === 'flatten') {
    return {
      version: 1,
      stamps: profile.stamps.filter((stamp) => cyclicDistance(stamp.fraction, at) > Math.max(0.09, stamp.radius * 0.9)),
      warnings: [],
    };
  }
  if (tool === 'smooth') {
    return {
      version: 1,
      stamps: profile.stamps.map((stamp) => (
        cyclicDistance(stamp.fraction, at) <= Math.max(0.1, stamp.radius)
          ? {
              ...stamp,
              radius: clamp(stamp.radius * 1.22, MIN_STAMP_RADIUS, MAX_STAMP_RADIUS),
              elevation: stamp.elevation * 0.88,
              bank: stamp.bank * 0.84,
            }
          : stamp
      )),
      warnings: [],
    };
  }
  const presets = {
    raise: { elevation: 0.8, bank: 0, radius: 0.12 },
    lower: { elevation: -0.8, bank: 0, radius: 0.12 },
    hill: { elevation: 2.35, bank: 0, radius: 0.18 },
    valley: { elevation: -1.8, bank: 0, radius: 0.18 },
    'bank-left': { elevation: 0, bank: 0.075, radius: 0.105 },
    'bank-right': { elevation: 0, bank: -0.075, radius: 0.105 },
  };
  const preset = presets[tool];
  if (!preset) return profile;
  const stamps = [...profile.stamps, {
    id: `profile-${tool}-${Math.round(at * 1_000_000).toString(36)}-${Math.max(0, ordinal).toString(36)}`,
    fraction: at,
    ...preset,
  }];
  if (stamps.length > MAX_ELEVATION_STAMPS) stamps.shift();
  return sanitizeElevationProfile({ stamps });
}

export function validateElevationProfile(input, routeLength = 200, sampleCount = 256) {
  const profile = sanitizeElevationProfile(input);
  const count = clamp(Math.round(sampleCount), 64, 1024);
  const length = Math.max(40, Number(routeLength) || 200);
  const samples = Array.from({ length: count }, () => ({ elevation: 0, bank: 0 }));
  let maximumElevation = -Infinity;
  let minimumElevation = Infinity;
  let maximumBank = 0;
  let maximumGrade = 0;
  let maximumBankTransition = 0;
  for (let index = 0; index < count; index += 1) {
    sampleElevationProfile(profile, index / count, samples[index]);
    maximumElevation = Math.max(maximumElevation, samples[index].elevation);
    minimumElevation = Math.min(minimumElevation, samples[index].elevation);
    maximumBank = Math.max(maximumBank, Math.abs(samples[index].bank));
  }
  const segmentLength = length / count;
  for (let index = 0; index < count; index += 1) {
    const next = samples[(index + 1) % count];
    const current = samples[index];
    maximumGrade = Math.max(maximumGrade, Math.abs(next.elevation - current.elevation) / segmentLength);
    maximumBankTransition = Math.max(
      maximumBankTransition,
      Math.abs(next.bank - current.bank) / segmentLength,
    );
  }
  const issues = [];
  if (maximumGrade > 0.2) {
    issues.push({
      id: 'elevation-grade',
      severity: 'error',
      message: `${(maximumGrade * 100).toFixed(1)}% grade exceeds the 20% racing limit. Smooth or flatten this section.`,
    });
  } else if (maximumGrade > 0.16) {
    issues.push({
      id: 'elevation-grade',
      severity: 'warning',
      message: `${(maximumGrade * 100).toFixed(1)}% grade needs a careful test drive.`,
    });
  }
  if (maximumBankTransition > 0.035) {
    issues.push({
      id: 'bank-transition',
      severity: 'error',
      message: 'Banking changes too abruptly for stable AI and respawns. Smooth this section.',
    });
  }
  return {
    profile,
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    maximumElevation: Number.isFinite(maximumElevation) ? maximumElevation : 0,
    minimumElevation: Number.isFinite(minimumElevation) ? minimumElevation : 0,
    maximumBank,
    maximumGrade,
    maximumBankTransition,
  };
}

export function runtimeElevationProfile(input, {
  startFraction = 0,
  reverse = false,
} = {}) {
  const profile = sanitizeElevationProfile(input);
  return {
    version: 1,
    stamps: profile.stamps.map((stamp) => ({
      ...stamp,
      fraction: wrapFraction(reverse
        ? 1 - startFraction - stamp.fraction
        : stamp.fraction - startFraction),
      bank: reverse ? -stamp.bank : stamp.bank,
    })),
    warnings: [...profile.warnings],
  };
}
