/**
 * Pure deterministic placement for Kaki Rally's Terra-derived grass layer.
 *
 * The render module owns geometry and materials. Keeping placement free of
 * Three.js makes road clearance, density bands, determinism, and quality
 * budgets cheap to test in Node.
 */

export const RALLY_GRASS_SCHEMA = 'kaki-rally-terra-grass@1';

export const RALLY_GRASS_QUALITY = Object.freeze({
  low: Object.freeze({ carpet: 1200, emergent: 220, templates: 1 }),
  medium: Object.freeze({ carpet: 2400, emergent: 460, templates: 2 }),
  high: Object.freeze({ carpet: 4200, emergent: 820, templates: 3 }),
  ultra: Object.freeze({ carpet: 6500, emergent: 1300, templates: 3 }),
});

export const RALLY_GRASS_LAYERS = Object.freeze({
  carpet: Object.freeze({
    fractions: Object.freeze([0.66, 0.27, 0.07]),
    bands: Object.freeze([
      Object.freeze({ min: 0.35, max: 10, density: 1 }),
      Object.freeze({ min: 10, max: 23, density: 0.62 }),
      Object.freeze({ min: 23, max: 40, density: 0.24 }),
    ]),
    scaleMin: 0.76,
    scaleMax: 1.28,
  }),
  emergent: Object.freeze({
    fractions: Object.freeze([0.52, 0.36, 0.12]),
    bands: Object.freeze([
      Object.freeze({ min: 1.5, max: 14, density: 0.92 }),
      Object.freeze({ min: 14, max: 29, density: 0.5 }),
      Object.freeze({ min: 29, max: 45, density: 0.18 }),
    ]),
    scaleMin: 1.08,
    scaleMax: 1.82,
  }),
});

function palette(values) {
  const output = {};
  for (const [key, value] of Object.entries(values)) {
    output[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(output);
}

/**
 * Palettes are data knobs from the Terra look-plan, retuned per Rally venue.
 * Geometry and scatter stay shared so a biome change cannot alter handling.
 */
export const RALLY_GRASS_BIOMES = Object.freeze({
  forest: Object.freeze({
    density: 1,
    height: 1,
    dryFraction: 0.16,
    palette: palette({
      healthyBase: [0.045, 0.14, 0.04],
      healthyTip: [0.3, 0.56, 0.18],
      dryBase: [0.2, 0.14, 0.045],
      dryTip: [0.58, 0.46, 0.17],
      seedBase: [0.09, 0.19, 0.055],
      seedTip: [0.56, 0.48, 0.2],
      forbBase: [0.035, 0.15, 0.055],
      forbTip: [0.2, 0.5, 0.18],
      soil: [0.095, 0.072, 0.035],
      translucent: [0.5, 0.5, 0.16],
    }),
  }),
  twilight: Object.freeze({
    density: 0.76,
    height: 1.08,
    dryFraction: 0.12,
    palette: palette({
      healthyBase: [0.025, 0.09, 0.105],
      healthyTip: [0.13, 0.39, 0.38],
      dryBase: [0.11, 0.12, 0.13],
      dryTip: [0.32, 0.38, 0.38],
      seedBase: [0.05, 0.14, 0.15],
      seedTip: [0.25, 0.55, 0.54],
      forbBase: [0.045, 0.1, 0.16],
      forbTip: [0.22, 0.44, 0.58],
      soil: [0.035, 0.065, 0.075],
      translucent: [0.18, 0.62, 0.58],
    }),
  }),
  cinder: Object.freeze({
    density: 0.34,
    height: 0.86,
    dryFraction: 0.58,
    palette: palette({
      healthyBase: [0.12, 0.045, 0.018],
      healthyTip: [0.43, 0.19, 0.045],
      dryBase: [0.19, 0.085, 0.02],
      dryTip: [0.62, 0.34, 0.08],
      seedBase: [0.17, 0.06, 0.018],
      seedTip: [0.68, 0.3, 0.06],
      forbBase: [0.11, 0.035, 0.025],
      forbTip: [0.45, 0.11, 0.045],
      soil: [0.1, 0.03, 0.018],
      translucent: [0.75, 0.25, 0.055],
    }),
  }),
  void: Object.freeze({
    density: 0.48,
    height: 1.12,
    dryFraction: 0.22,
    palette: palette({
      healthyBase: [0.045, 0.025, 0.1],
      healthyTip: [0.25, 0.12, 0.46],
      dryBase: [0.12, 0.07, 0.15],
      dryTip: [0.46, 0.26, 0.52],
      seedBase: [0.07, 0.04, 0.16],
      seedTip: [0.52, 0.25, 0.68],
      forbBase: [0.035, 0.055, 0.13],
      forbTip: [0.19, 0.32, 0.62],
      soil: [0.045, 0.025, 0.075],
      translucent: [0.52, 0.2, 0.78],
    }),
  }),
  cave: Object.freeze({
    density: 0.2,
    height: 0.72,
    dryFraction: 0.08,
    palette: palette({
      healthyBase: [0.025, 0.08, 0.055],
      healthyTip: [0.13, 0.32, 0.2],
      dryBase: [0.085, 0.09, 0.065],
      dryTip: [0.26, 0.28, 0.14],
      seedBase: [0.035, 0.11, 0.08],
      seedTip: [0.18, 0.45, 0.3],
      forbBase: [0.025, 0.09, 0.075],
      forbTip: [0.11, 0.4, 0.31],
      soil: [0.035, 0.045, 0.04],
      translucent: [0.13, 0.56, 0.36],
    }),
  }),
  kakiland: Object.freeze({
    density: 1.08,
    height: 0.96,
    dryFraction: 0.06,
    palette: palette({
      healthyBase: [0.055, 0.16, 0.045],
      healthyTip: [0.38, 0.64, 0.22],
      dryBase: [0.23, 0.17, 0.055],
      dryTip: [0.65, 0.54, 0.2],
      seedBase: [0.11, 0.23, 0.07],
      seedTip: [0.7, 0.58, 0.22],
      forbBase: [0.12, 0.09, 0.14],
      forbTip: [0.74, 0.26, 0.55],
      soil: [0.12, 0.09, 0.045],
      translucent: [0.58, 0.62, 0.18],
    }),
  }),
});

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createRallyGrassRandom(seed = 19) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, z) {
  let value = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise2(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(x0, z0);
  const b = hash2(x0 + 1, z0);
  const c = hash2(x0, z0 + 1);
  const d = hash2(x0 + 1, z0 + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm2(x, z) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let normalizer = 0;
  for (let octave = 0; octave < 3; octave += 1) {
    sum += amplitude * valueNoise2(x * frequency, z * frequency);
    normalizer += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / normalizer;
}

/** Terra-style low-frequency clump field with a soft near-road floor. */
export function rallyGrassDensityFactor(x, z, seed = 0) {
  const low = fbm2(x * 0.028 + seed * 0.17, z * 0.028 - seed * 0.11);
  const medium = fbm2(x * 0.09 + 19, z * 0.09);
  return clamp(Math.pow(Math.max(0, low * 0.72 + medium * 0.28), 0.72) * 1.15, 0.02, 1);
}

function segmentDistanceSq(x, z, a, b) {
  const dx = finite(b.x) - finite(a.x);
  const dz = finite(b.z) - finite(a.z);
  const lengthSq = dx * dx + dz * dz;
  if (!(lengthSq > 0)) return (x - finite(a.x)) ** 2 + (z - finite(a.z)) ** 2;
  const t = clamp(((x - finite(a.x)) * dx + (z - finite(a.z)) * dz) / lengthSq, 0, 1);
  const qx = finite(a.x) + dx * t;
  const qz = finite(a.z) + dz * t;
  return (x - qx) ** 2 + (z - qz) ** 2;
}

export function rallyGrassDistanceToTrackSq(x, z, samples) {
  let nearest = Infinity;
  for (let index = 0; index < samples.length; index += 1) {
    nearest = Math.min(nearest, segmentDistanceSq(x, z, samples[index], samples[(index + 1) % samples.length]));
  }
  return nearest;
}

function courseSeed(course) {
  const text = String(course?.id || 'forest');
  let seed = Math.round(finite(course?.seed, 19));
  for (let index = 0; index < text.length; index += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(index), 16777619);
  }
  return seed >>> 0;
}

function targetCount(layer, quality, biome, mode, groundSize) {
  const base = RALLY_GRASS_QUALITY[quality][layer];
  const modeScale = mode === 'stock' ? 0.78 : mode === 'draw' && groundSize > 420 ? 0.82 : 1;
  return Math.max(0, Math.round(base * biome.density * modeScale));
}

function allocateBands(total, fractions) {
  const counts = fractions.map((fraction) => Math.floor(total * fraction));
  let assigned = counts.reduce((sum, value) => sum + value, 0);
  for (let index = 0; assigned < total; index = (index + 1) % counts.length) {
    counts[index] += 1;
    assigned += 1;
  }
  return counts;
}

/**
 * Place both grass strata around a closed sampled course.
 *
 * `heightAt` must return the visible terrain height at world x/z. Placement
 * rejects the complete path, not only the source sample, so Draw Track
 * overpasses and self-near loops cannot grow grass through another road branch.
 */
export function createRallyGrassLayout({
  course,
  samples,
  quality = 'high',
  mode = course?.mode || 'circuit',
  groundSize = 360,
  heightAt = () => 0,
  seed = courseSeed(course),
} = {}) {
  if (!course?.id) throw new TypeError('createRallyGrassLayout requires a course id');
  if (!Array.isArray(samples) || samples.length < 8) {
    throw new TypeError('createRallyGrassLayout requires at least eight sampled track points');
  }
  if (!RALLY_GRASS_QUALITY[quality]) throw new RangeError(`Unknown rally grass quality: ${quality}`);
  if (typeof heightAt !== 'function') throw new TypeError('createRallyGrassLayout requires heightAt(x, z)');
  const biome = RALLY_GRASS_BIOMES[course.id] || RALLY_GRASS_BIOMES.forest;
  const halfGround = Math.max(40, finite(groundSize, 360) * 0.5 - 2);
  const centerX = samples.reduce((sum, sample) => sum + finite(sample.x), 0) / samples.length;
  const centerZ = samples.reduce((sum, sample) => sum + finite(sample.z), 0) / samples.length;
  const roadClearance = Math.max(3.8, finite(course.trackWidth, 8.4) * 0.5 + 3.15);
  const random = createRallyGrassRandom(seed);
  const layers = {};

  for (const layerName of ['carpet', 'emergent']) {
    const layer = RALLY_GRASS_LAYERS[layerName];
    const total = targetCount(layerName, quality, biome, mode, groundSize);
    const bandCounts = allocateBands(total, layer.fractions);
    const placements = [];
    for (let bandIndex = 0; bandIndex < layer.bands.length; bandIndex += 1) {
      const band = layer.bands[bandIndex];
      const wanted = bandCounts[bandIndex];
      let accepted = 0;
      const maxTries = Math.max(100, wanted * 55);
      for (let attempt = 0; accepted < wanted && attempt < maxTries; attempt += 1) {
        const sampleIndex = Math.floor(random() * samples.length) % samples.length;
        const sample = samples[sampleIndex];
        const next = samples[(sampleIndex + 1) % samples.length];
        const tangentX = finite(sample.tangent?.x, finite(next.x) - finite(sample.x));
        const tangentZ = finite(sample.tangent?.z, finite(next.z) - finite(sample.z));
        const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
        const tx = tangentX / tangentLength;
        const tz = tangentZ / tangentLength;
        const nx = finite(sample.normal?.x, -tz);
        const nz = finite(sample.normal?.z, tx);
        const side = random() < 0.5 ? -1 : 1;
        const bandT = Math.sqrt(random());
        const lateral = side * (roadClearance + band.min + (band.max - band.min) * bandT);
        const segmentLength = Math.max(1, Math.hypot(finite(next.x) - finite(sample.x), finite(next.z) - finite(sample.z)));
        const along = (random() - 0.5) * segmentLength * 1.8;
        const x = finite(sample.x) + nx * lateral + tx * along;
        const z = finite(sample.z) + nz * lateral + tz * along;
        if (Math.abs(x - centerX) > halfGround || Math.abs(z - centerZ) > halfGround) continue;
        if (rallyGrassDistanceToTrackSq(x, z, samples) < roadClearance * roadClearance) continue;
        const patch = rallyGrassDensityFactor(x, z, seed);
        const density = clamp((0.24 + patch * 0.92) * band.density, 0, 1);
        if (random() > density) continue;
        const y = Number(heightAt(x, z));
        if (!Number.isFinite(y)) continue;
        const scale = (layer.scaleMin + random() * (layer.scaleMax - layer.scaleMin)) * biome.height;
        placements.push(Object.freeze({
          x,
          y: y + 0.035,
          z,
          rotation: random() * Math.PI * 2,
          scale,
          tint: random(),
          band: bandIndex,
        }));
        accepted += 1;
      }
    }
    layers[layerName] = Object.freeze(placements);
  }

  return Object.freeze({
    schema: RALLY_GRASS_SCHEMA,
    courseId: course.id,
    quality,
    mode,
    seed,
    roadClearance,
    biome,
    carpet: layers.carpet,
    emergent: layers.emergent,
    counts: Object.freeze({
      carpet: layers.carpet.length,
      emergent: layers.emergent.length,
      total: layers.carpet.length + layers.emergent.length,
    }),
  });
}
