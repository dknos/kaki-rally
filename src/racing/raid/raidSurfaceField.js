// Kaki Rally Raid — deterministic global surface field.
//
// This module is the single source of truth for what the desert looks and feels
// like at any point on the planet. Everything here is a PURE function of world
// metres and the stage seed. Nothing is a function of a sector origin, a grid
// index, an iteration order, or a camera position.
//
// That purity is the whole reason a 24 km stage can be streamed without seams:
// two neighbouring sectors evaluate the shared boundary from identical inputs,
// so they produce identical outputs by construction rather than by a fix-up
// pass. The seam test in tools/smoke-raid-sector-seams.mjs is a regression
// guard on that property, not the mechanism that provides it.
//
// One world unit is one metre. The field is evaluated in float64 and only the
// stored heightfield is narrowed to float32, so the value a wheel samples and
// the texel the terrain shader samples are the same number.

const TAU = Math.PI * 2;

export function clamp(value, minimum, maximum) {
  return value < minimum ? minimum : (value > maximum ? maximum : value);
}

export function smoothstep(edge0, edge1, value) {
  const span = edge1 - edge0;
  if (!(Math.abs(span) > 1e-9)) return value < edge0 ? 0 : 1;
  const amount = clamp((value - edge0) / span, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

export function mix(a, b, t) {
  return a + (b - a) * t;
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

// The lattice is addressed with signed 32-bit integers. A stage that reaches
// 24 km with a shortest feature wavelength of 8 m needs |lattice| <= 3000, so
// the safety margin before wraparound is enormous; RAID_MAX_LATTICE documents
// the bound the seam test asserts against.
export const RAID_MAX_LATTICE = 0x3fffffff;

function hash2i(ix, iz, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ (seed | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  return (h ^ (h >>> 16)) >>> 0;
}

// Eight evenly spaced unit gradients. Gradient noise rather than value noise:
// dune flanks need a continuous first derivative or the terrain normal, and
// therefore the wheel contact normal, steps at every lattice line.
const GRADIENT_X = new Float64Array(8);
const GRADIENT_Z = new Float64Array(8);
for (let index = 0; index < 8; index += 1) {
  const angle = (index / 8) * TAU;
  GRADIENT_X[index] = Math.cos(angle);
  GRADIENT_Z[index] = Math.sin(angle);
}

function quintic(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function dotGradient(ix, iz, seed, dx, dz) {
  const slot = hash2i(ix, iz, seed) & 7;
  return GRADIENT_X[slot] * dx + GRADIENT_Z[slot] * dz;
}

// Perlin-style gradient noise in [-1, 1].
export function gradientNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = quintic(fx);
  const v = quintic(fz);
  const n00 = dotGradient(ix, iz, seed, fx, fz);
  const n10 = dotGradient(ix + 1, iz, seed, fx - 1, fz);
  const n01 = dotGradient(ix, iz + 1, seed, fx, fz - 1);
  const n11 = dotGradient(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  const top = mix(n00, n10, u);
  const bottom = mix(n01, n11, u);
  // Gradient noise peaks near 1/sqrt(2); normalise so callers get a full range.
  return clamp(mix(top, bottom, v) * 1.4142135623730951, -1, 1);
}

export function fbm(x, z, seed, octaves = 4, lacunarity = 2.03, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += gradientNoise(x * frequency, z * frequency, (seed + octave * 0x9e3779b1) | 0) * amplitude;
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-9, weight);
}

// Ridged multifractal. Sharp positive crests over soft basins is exactly the
// silhouette of a rock shelf or a wind-packed ridge line.
export function ridgedNoise(x, z, seed, octaves = 4, lacunarity = 2.07, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const value = 1 - Math.abs(gradientNoise(x * frequency, z * frequency, (seed + octave * 0x85ebca6b) | 0));
    total += value * value * amplitude;
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return clamp((total / Math.max(1e-9, weight)) * 2 - 1, -1, 1);
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

// Physical identity of what the tyres are actually on. `momentum` is the share
// of recovered lateral energy that becomes forward speed when a slide is
// caught, which is what makes salt feel fast and powder feel like glue.
function surface(id, name, values) {
  return Object.freeze({ id, name, ...values });
}

export const RAID_SURFACES = Object.freeze({
  salt: surface('salt', 'Salt flat', {
    grip: 1.06, drag: 0.028, sinkage: 0.02, roughness: 0.05, momentum: 0.86,
    dust: 0.22, tyreWear: 0.9, punctureRisk: 0.05, colour: 0xd9dbd2,
  }),
  hardpack: surface('hardpack', 'Hardpack', {
    grip: 0.98, drag: 0.045, sinkage: 0.05, roughness: 0.16, momentum: 0.78,
    dust: 0.45, tyreWear: 1, punctureRisk: 0.1, colour: 0xc0a071,
  }),
  compacted: surface('compacted', 'Compacted sand', {
    grip: 0.9, drag: 0.075, sinkage: 0.14, roughness: 0.22, momentum: 0.66,
    dust: 0.72, tyreWear: 1.05, punctureRisk: 0.08, colour: 0xd8b47e,
  }),
  loose: surface('loose', 'Loose sand', {
    grip: 0.78, drag: 0.14, sinkage: 0.32, roughness: 0.3, momentum: 0.44,
    dust: 1, tyreWear: 1.15, punctureRisk: 0.05, colour: 0xe4c48f,
  }),
  powder: surface('powder', 'Powder basin', {
    grip: 0.62, drag: 0.27, sinkage: 0.56, roughness: 0.24, momentum: 0.2,
    dust: 1.35, tyreWear: 1.2, punctureRisk: 0.04, colour: 0xefdcb4,
  }),
  gravel: surface('gravel', 'Wadi gravel', {
    grip: 0.86, drag: 0.09, sinkage: 0.1, roughness: 0.48, momentum: 0.58,
    dust: 0.6, tyreWear: 1.35, punctureRisk: 0.34, colour: 0xa89170,
  }),
  rock: surface('rock', 'Broken rock', {
    grip: 0.94, drag: 0.11, sinkage: 0.02, roughness: 0.85, momentum: 0.5,
    dust: 0.3, tyreWear: 1.7, punctureRisk: 0.72, colour: 0x8d7f6d,
  }),
});

export const RAID_SURFACE_ORDER = Object.freeze([
  'salt', 'hardpack', 'compacted', 'loose', 'powder', 'gravel', 'rock',
]);

const SURFACE_INDEX = Object.freeze(Object.fromEntries(
  RAID_SURFACE_ORDER.map((id, index) => [id, index]),
));

export function raidSurfaceIndex(id) {
  return SURFACE_INDEX[id] ?? SURFACE_INDEX.hardpack;
}

export function raidSurfaceByIndex(index) {
  return RAID_SURFACES[RAID_SURFACE_ORDER[clamp(index | 0, 0, RAID_SURFACE_ORDER.length - 1)]];
}

// ---------------------------------------------------------------------------
// Terrain zones
// ---------------------------------------------------------------------------

// A zone is a macro terrain identity. Zones are authored along the route in
// metres, then blended over hundreds of metres so a stage never switches
// biome at a sector boundary.
function zone(id, name, values) {
  return Object.freeze({ id, name, ...values });
}

export const RAID_ZONES = Object.freeze({
  'salt-flat': zone('salt-flat', 'Salt flat', {
    macroHeight: 1.6, macroScale: 620, ridgeHeight: 0.35, ridgeWavelength: 210,
    detailHeight: 0.16, detailScale: 26, roughness: 0.05, rockiness: 0,
    softness: 0.04, baseSurface: 'salt', crestSurface: 'salt', hollowSurface: 'hardpack',
  }),
  'hardpack-plateau': zone('hardpack-plateau', 'Hardpack plateau', {
    macroHeight: 7.5, macroScale: 480, ridgeHeight: 1.4, ridgeWavelength: 150,
    detailHeight: 0.42, detailScale: 21, roughness: 0.2, rockiness: 0.12,
    softness: 0.15, baseSurface: 'hardpack', crestSurface: 'hardpack', hollowSurface: 'compacted',
  }),
  'rolling-dunes': zone('rolling-dunes', 'Rolling dunes', {
    macroHeight: 13, macroScale: 380, ridgeHeight: 6.2, ridgeWavelength: 118,
    detailHeight: 0.66, detailScale: 17, roughness: 0.22, rockiness: 0,
    softness: 0.62, baseSurface: 'compacted', crestSurface: 'loose', hollowSurface: 'loose',
  }),
  'dune-sea': zone('dune-sea', 'Dune sea', {
    macroHeight: 21, macroScale: 460, ridgeHeight: 15.5, ridgeWavelength: 176,
    detailHeight: 0.85, detailScale: 15, roughness: 0.24, rockiness: 0,
    softness: 0.88, baseSurface: 'loose', crestSurface: 'loose', hollowSurface: 'powder',
  }),
  'wadi-gravel': zone('wadi-gravel', 'Wadi gravel', {
    macroHeight: 9.5, macroScale: 300, ridgeHeight: 3.1, ridgeWavelength: 96,
    detailHeight: 0.95, detailScale: 12, roughness: 0.52, rockiness: 0.48,
    softness: 0.12, baseSurface: 'gravel', crestSurface: 'rock', hollowSurface: 'compacted',
  }),
  'rock-shelf': zone('rock-shelf', 'Rock shelf', {
    macroHeight: 16, macroScale: 340, ridgeHeight: 8.4, ridgeWavelength: 88,
    detailHeight: 1.25, detailScale: 10, roughness: 0.8, rockiness: 0.86,
    softness: 0.05, baseSurface: 'rock', crestSurface: 'rock', hollowSurface: 'gravel',
  }),
  'powder-basin': zone('powder-basin', 'Powder basin', {
    macroHeight: 6, macroScale: 520, ridgeHeight: 1.9, ridgeWavelength: 240,
    detailHeight: 0.3, detailScale: 30, roughness: 0.1, rockiness: 0,
    softness: 1, baseSurface: 'powder', crestSurface: 'loose', hollowSurface: 'powder',
  }),
});

export const RAID_ZONE_ORDER = Object.freeze(Object.keys(RAID_ZONES));

export function getRaidZone(id) {
  return RAID_ZONES[id] || RAID_ZONES['hardpack-plateau'];
}

// Blend two zones.
//
// Scale parameters — macroScale, ridgeWavelength, detailScale — are NOT
// interpolated. They divide the world coordinate, so interpolating them shifts
// the noise sample point in proportion to distance from the origin: at 5 km a
// 1% wavelength change slides the ridge phase by tens of metres, and the whole
// landscape visibly swims as the stage crosses a zone transition. Interpolating
// amplitudes alone has the same defect through the phase warp.
//
// So a blend keeps both zones intact and mixes their evaluated HEIGHTS instead.
// That is continuous by construction because it is a linear interpolation
// between two continuous fields, and it costs a second noise evaluation only
// inside a transition band.
//
// Non-phase-bearing scalars (roughness, rockiness, softness) are safe to mix
// directly and are used by dust, wear, and sinkage rather than by geometry.
const BLENDED_SCALAR_KEYS = Object.freeze(['roughness', 'rockiness', 'softness']);

export function blendRaidZones(fromId, toId, t) {
  const from = getRaidZone(fromId);
  const to = getRaidZone(toId);
  const amount = clamp(t, 0, 1);
  const blend = { from, to, t: amount };
  for (const key of BLENDED_SCALAR_KEYS) blend[key] = mix(from[key], to[key], amount);
  // Discrete identities follow the dominant zone. The switch is invisible
  // because the mixed relief has already morphed around the midpoint.
  const dominant = amount < 0.5 ? from : to;
  blend.baseSurface = dominant.baseSurface;
  blend.crestSurface = dominant.crestSurface;
  blend.hollowSurface = dominant.hollowSurface;
  blend.id = dominant.id;
  blend.reliefBound = Math.max(zoneReliefBound(from), zoneReliefBound(to));
  return Object.freeze(blend);
}

export function zoneReliefBound(zone) {
  return zone.macroHeight + zone.ridgeHeight + zone.detailHeight * (1 + zone.rockiness * 4.2);
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

// Terrain height in metres for a single zone, split into its broad and local
// parts. `windAngle` is stage-wide so dune ridge lines stay coherent across zone
// boundaries instead of pinwheeling.
//
// `macro` is the broad relief alone — what the land would be without ridges,
// rock, or ripples. Surface classification needs it: "am I on a crest or in a
// hollow" is a question about height RELATIVE to the local landform, and
// absolute height answers it wrongly on a slope.
export function raidZoneHeightParts(worldX, worldZ, params, seed, windAngle, target = { macro: 0, height: 0 }) {
  const windX = Math.cos(windAngle);
  const windZ = Math.sin(windAngle);
  // Along-wind and cross-wind axes. Dunes are stretched perpendicular to the
  // wind, so the ridge term must be evaluated in this rotated frame.
  const along = worldX * windX + worldZ * windZ;
  const cross = worldX * -windZ + worldZ * windX;

  // Broad relief: what the stage looks like from ten kilometres away.
  const macro = fbm(worldX / params.macroScale, worldZ / params.macroScale, seed ^ 0x1b873593, 4, 1.97, 0.52);
  const basin = fbm(worldX / (params.macroScale * 2.4), worldZ / (params.macroScale * 2.4), seed ^ 0x6b43a9b5, 3, 2.11, 0.5);
  const broad = (macro * 0.74 + basin * 0.26) * params.macroHeight;
  let height = broad;

  // Ridge lines. A phase warp keeps them from reading as a sine grating, and
  // the asymmetric power shapes a broad windward face against a sharp lee lip,
  // which is what makes a dune crest legible at speed.
  if (params.ridgeHeight > 0.01) {
    const warp = fbm(along / (params.ridgeWavelength * 1.9), cross / (params.ridgeWavelength * 3.1), seed ^ 0x2f8a1c3d, 3, 2.02, 0.5);
    const phase = (cross / params.ridgeWavelength) * TAU * 0.5 + warp * 2.3 + Math.sin(along / (params.ridgeWavelength * 1.4)) * 0.6;
    const wave = Math.sin(phase);
    const shape = wave >= 0 ? Math.pow(wave, 1.52) : wave * 0.36;
    const envelope = 0.66 + 0.34 * (fbm(along / (params.ridgeWavelength * 3.4), cross / (params.ridgeWavelength * 4), seed ^ 0x0f1bbcdc, 2) * 0.5 + 0.5);
    height += shape * params.ridgeHeight * envelope;
  }

  // Rock structure. Ridged noise only where the zone is actually rocky.
  if (params.rockiness > 0.01) {
    const rock = ridgedNoise(worldX / 74, worldZ / 74, seed ^ 0x27d4eb2f, 4, 2.09, 0.52);
    height += rock * params.rockiness * params.detailHeight * 4.2;
  }

  // Surface detail: ripples, chatter, and the small chop that gives the
  // suspension something to do between the big features.
  const detail = fbm(worldX / params.detailScale, worldZ / params.detailScale, seed ^ 0x165667b1, 3, 2.13, 0.48);
  height += detail * params.detailHeight;

  target.macro = broad;
  target.height = height;
  return target;
}

const HEIGHT_PARTS = { macro: 0, height: 0 };

/** Terrain height in metres for a single zone. */
export function raidZoneHeight(worldX, worldZ, params, seed, windAngle) {
  return raidZoneHeightParts(worldX, worldZ, params, seed, windAngle, HEIGHT_PARTS).height;
}

/**
 * How far a point stands above or below its own landform, normalised to
 * roughly -1..1. Positive is a scoured crest, negative a collecting hollow.
 * This is the input surface classification actually needs.
 */
export function raidRelief(height, macro, params) {
  const scale = Math.max(0.35, params.ridgeHeight * 0.55 + params.detailHeight * (1 + params.rockiness * 2.1));
  return clamp((height - macro) / scale, -1, 1);
}

// Terrain height in metres for a zone blend. Inside a transition band this
// mixes two intact fields; outside one it degenerates to a single evaluation.
export function raidTerrainHeight(worldX, worldZ, blend, seed, windAngle) {
  const t = blend.t;
  if (!(t > 0)) return raidZoneHeight(worldX, worldZ, blend.from, seed, windAngle);
  if (!(t < 1)) return raidZoneHeight(worldX, worldZ, blend.to, seed, windAngle);
  const from = raidZoneHeight(worldX, worldZ, blend.from, seed, windAngle);
  const to = raidZoneHeight(worldX, worldZ, blend.to, seed, windAngle);
  return mix(from, to, t);
}

// Analytic-free normal. Central differences on the same pure field, so the
// normal agrees with the height everywhere including across sector boundaries.
export function raidTerrainNormal(worldX, worldZ, blend, seed, windAngle, epsilon = 0.75, target = { x: 0, y: 1, z: 0 }) {
  const west = raidTerrainHeight(worldX - epsilon, worldZ, blend, seed, windAngle);
  const east = raidTerrainHeight(worldX + epsilon, worldZ, blend, seed, windAngle);
  const south = raidTerrainHeight(worldX, worldZ - epsilon, blend, seed, windAngle);
  const north = raidTerrainHeight(worldX, worldZ + epsilon, blend, seed, windAngle);
  const dx = (west - east) / (2 * epsilon);
  const dz = (south - north) / (2 * epsilon);
  const inverse = 1 / Math.hypot(dx, 1, dz);
  target.x = dx * inverse;
  target.y = inverse;
  target.z = dz * inverse;
  return target;
}

// ---------------------------------------------------------------------------
// Surface classification
// ---------------------------------------------------------------------------

// Which surface is actually underfoot. Crests get scoured to the zone's crest
// surface, hollows collect the zone's hollow surface, slope exposes rock, and a
// slow drift field breaks up the boundaries so the map never reads as tiles.
export function classifyRaidSurface(worldX, worldZ, params, seed, {
  height = 0,
  slope = 0,
  relief = 0,
} = {}) {
  const drift = fbm(worldX / 190, worldZ / 190, seed ^ 0x45d9f3b1, 3, 2.05, 0.5);
  const exposure = clamp(relief * 0.5 + drift * 0.32, -1, 1);

  if (params.rockiness > 0.35 && slope > 0.32 + drift * 0.08) return params.crestSurface;
  if (exposure > 0.26) return params.crestSurface;
  if (exposure < -0.3) return params.hollowSurface;
  return params.baseSurface;
}

// Continuous 0..1 looseness used by sinkage and dust. Kept separate from the
// discrete surface id so deep sand can deepen gradually inside one zone.
export function raidLooseness(worldX, worldZ, params, seed, relief = 0) {
  const drift = fbm(worldX / 145, worldZ / 145, seed ^ 0x9e3779b9, 3, 2.07, 0.5);
  const settled = clamp(params.softness + drift * 0.18 - relief * 0.22, 0, 1);
  return settled;
}
