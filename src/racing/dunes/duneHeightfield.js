import {
  getDuneEvent,
  nearestDuneRouteSample,
  sampleDuneRoute,
} from './duneEvents.js';

const F32 = Math.fround;
const EPSILON = 1e-6;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / Math.max(EPSILON, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function cyclicDelta(from, to) {
  let delta = from - to;
  if (delta > 0.5) delta -= 1;
  else if (delta < -0.5) delta += 1;
  return delta;
}

function routeProfileAt(definition, progress, target = { elevation: 0, bank: 0 }) {
  const stamps = definition.routeProfile?.stamps?.length
    ? definition.routeProfile.stamps
    : definition.drawElevationProfile?.stamps || [];
  const loop = definition.routeType === 'circuit' || definition.routeType === 'freeride';
  let elevation = 0;
  let bank = 0;
  for (let index = 0; index < stamps.length; index += 1) {
    const stamp = stamps[index];
    const distance = Math.abs(loop
      ? cyclicDelta(progress, stamp.fraction)
      : progress - stamp.fraction);
    if (distance >= stamp.radius) continue;
    const amount = 0.5 + 0.5 * Math.cos(Math.PI * distance / stamp.radius);
    elevation += stamp.elevation * amount;
    bank += stamp.bank * amount;
  }
  target.elevation = clamp(elevation, -8, 17);
  target.bank = clamp(bank, -0.16, 0.16);
  return target;
}

function drawFeatureElevation(definition, routeLength, progress, lateralDistance) {
  const features = definition.drawFeaturePlacements || [];
  if (!features.length || lateralDistance > definition.routeWidth * 0.58 + 1.5) return 0;
  let elevation = 0;
  for (let index = 0; index < features.length; index += 1) {
    const feature = features[index];
    let length = 0;
    let height = 0;
    let kind = 'single';
    if (feature.featureId === 'small-kicker') { length = 9; height = 1.45; }
    else if (feature.featureId === 'large-launch-ramp') { length = 15; height = 2.9; }
    else if (feature.featureId === 'tabletop') { length = 20; height = 2.2; kind = 'tabletop'; }
    else if (feature.featureId === 'double-jump') { length = 24; height = 2.45; kind = 'double'; }
    else if (feature.featureId === 'roller-bumps') { length = 22; height = 0.72; kind = 'rollers'; }
    else if (feature.featureId === 'step-up' || feature.featureId === 'step-down') {
      length = 17;
      height = 2.15;
      kind = feature.featureId;
    } else continue;
    const radius = clamp(length / Math.max(1, routeLength), 0.008, 0.09);
    const delta = cyclicDelta(progress, feature.fraction);
    if (Math.abs(delta) >= radius) continue;
    const u = delta / radius;
    const envelope = 0.5 + 0.5 * Math.cos(Math.PI * u);
    let shape = envelope;
    if (kind === 'rollers') shape = envelope * (0.5 + 0.5 * Math.cos(u * Math.PI * 8));
    else if (kind === 'double') shape = envelope * (0.58 + 0.42 * Math.cos(u * Math.PI * 4));
    else if (kind === 'tabletop') shape = Math.pow(envelope, 0.42);
    else if (kind === 'step-up') shape = envelope * clamp(0.9 - u * 0.58, 0.2, 1);
    else if (kind === 'step-down') shape = envelope * clamp(0.9 + u * 0.58, 0.2, 1);
    elevation += height * shape * clamp(Number(feature.scaleY) || 1, 0.75, 1.35);
  }
  return clamp(elevation, 0, 5.5);
}

function hash32(x, z, seed) {
  let value = Math.imul((x | 0) ^ (seed | 0), 0x45d9f3b);
  value = Math.imul((value ^ (value >>> 16)) + Math.imul(z | 0, 0x27d4eb2d), 0x45d9f3b);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967295;
}

function fade(value) {
  return value * value * (3 - 2 * value);
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash32(ix, iz, seed);
  const b = hash32(ix + 1, iz, seed);
  const c = hash32(ix, iz + 1, seed);
  const d = hash32(ix + 1, iz + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return F32((top + (bottom - top) * fz) * 2 - 1);
}

function fractalNoise(x, z, seed, octaves, lacunarity = 2, gain = 0.5) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total = F32(total + valueNoise(x * frequency, z * frequency, seed + octave * 0x9e37) * amplitude);
    weight += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return F32(total / Math.max(EPSILON, weight));
}

function duneBands(worldX, worldZ, eventDefinition) {
  const terrain = eventDefinition.terrain;
  const windX = Math.cos(terrain.windAngle);
  const windZ = Math.sin(terrain.windAngle);
  const crossX = -windZ;
  const crossZ = windX;
  const along = worldX * windX + worldZ * windZ;
  const cross = worldX * crossX + worldZ * crossZ;

  // Broad swells establish traversable event-scale relief.
  const swell = fractalNoise(worldX / 270, worldZ / 270, eventDefinition.seed ^ 0x5f3759df, 4, 1.92, 0.53);
  const basin = fractalNoise(worldX / 430, worldZ / 430, eventDefinition.seed ^ 0x2468ace, 3, 2.1, 0.5);
  const broad = F32((swell * 0.72 + basin * 0.28) * terrain.macroHeight + terrain.basinBias);

  // Dune ridges are stretched across the wind with a low-frequency phase warp.
  // Windward faces are broad; the powered positive lobe gives a firmer lee lip.
  const ridgeWarp = fractalNoise(along / 190, cross / 310, eventDefinition.seed ^ 0x17a5, 3, 2, 0.5);
  const ridgePhase = F32(cross / 54 + ridgeWarp * 2.15 + Math.sin(along / 155) * 0.52);
  const ridgeWave = Math.sin(ridgePhase);
  const ridgeShape = ridgeWave >= 0
    ? Math.pow(ridgeWave, 1.58)
    : ridgeWave * 0.38;
  const ridgeEnvelope = 0.68 + 0.32 * (fractalNoise(along / 360, cross / 420, eventDefinition.seed ^ 0x6d2b79, 2) * 0.5 + 0.5);
  const ridge = F32(ridgeShape * terrain.ridgeHeight * ridgeEnvelope);

  // Medium drifts and eroded channels remain anisotropic about the same wind.
  const drift = fractalNoise(along / 92, cross / 32, eventDefinition.seed ^ 0x51ed, 4, 1.86, 0.48);
  const channel = Math.abs(fractalNoise(along / 138, cross / 47, eventDefinition.seed ^ 0xc0ffee, 3));
  const medium = F32(
    drift * terrain.mediumHeight
    - Math.max(0, channel - 0.66) * terrain.mediumHeight * 0.9,
  );

  // Fine wind ripples are small enough to read in shading and tire response
  // without becoming physics noise.
  const rippleWarp = valueNoise(along / 31, cross / 49, eventDefinition.seed ^ 0x8181);
  const ripple = F32(
    Math.sin(cross * 0.42 + along * 0.035 + rippleWarp * 1.6)
    * terrain.rippleHeight
    * (0.72 + valueNoise(along / 18, cross / 22, eventDefinition.seed ^ 0x4141) * 0.28),
  );

  return {
    height: F32(broad + ridge + medium + ripple),
    routeBase: F32(broad + ridge * 0.82 + medium * 0.34),
    lee: clamp(0.5 + ridgeWave * 0.5, 0, 1),
    macro: broad,
  };
}

function buildRouteCenterline(definition, routeRuntime) {
  const samples = routeRuntime.samples;
  const count = samples.length;
  const raw = new Float32Array(count);
  const smooth = new Float32Array(count);
  const heights = new Float32Array(count);
  const banks = new Float32Array(count);
  const loop = routeRuntime.loop;
  const profile = definition.routeProfile || {};
  const smoothingMeters = clamp(Number(profile.smoothingMeters) || 30, 12, 72);
  const radius = Math.max(1, Math.round(smoothingMeters / Math.max(1, routeRuntime.spacing)));
  const profileValue = { elevation: 0, bank: 0 };

  for (let index = 0; index < count; index += 1) {
    const sample = samples[index];
    raw[index] = duneBands(sample.x, sample.z, definition).routeBase;
  }
  for (let index = 0; index < count; index += 1) {
    let total = 0;
    let weight = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      let sampleIndex = index + offset;
      if (loop) sampleIndex = (sampleIndex % count + count) % count;
      else sampleIndex = clamp(sampleIndex, 0, count - 1);
      const sampleWeight = radius + 1 - Math.abs(offset);
      total += raw[sampleIndex] * sampleWeight;
      weight += sampleWeight;
    }
    smooth[index] = F32(total / Math.max(EPSILON, weight));
  }
  for (let index = 0; index < count; index += 1) {
    routeProfileAt(definition, samples[index].progress, profileValue);
    heights[index] = F32(smooth[index] + profileValue.elevation);
    banks[index] = F32(profileValue.bank);
  }
  return {
    heights,
    banks,
    strength: clamp(
      Number(profile.strength) || definition.terrain.routeConditioning + 0.22,
      0.42,
      0.9,
    ),
    lineWidth: clamp(Number(profile.lineWidth) || definition.routeWidth * 0.28, 3.5, 9),
  };
}

function nearestRouteDistance(routeSamples, x, z, loop = false) {
  let bestDistanceSq = Infinity;
  let bestIndex = 0;
  let bestNextIndex = Math.min(1, routeSamples.length - 1);
  let bestAmount = 0;
  let bestX = routeSamples[0]?.x || 0;
  let bestZ = routeSamples[0]?.z || 0;
  let bestYaw = routeSamples[0]?.yaw || 0;
  let bestProgress = routeSamples[0]?.progress || 0;
  const segmentCount = Math.max(1, loop ? routeSamples.length : routeSamples.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = loop ? (index + 1) % routeSamples.length : index + 1;
    const start = routeSamples[index];
    const end = routeSamples[nextIndex] || start;
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
    const amount = clamp(
      ((x - start.x) * segmentX + (z - start.z) * segmentZ) / Math.max(EPSILON, lengthSq),
      0,
      1,
    );
    const routeX = start.x + segmentX * amount;
    const routeZ = start.z + segmentZ * amount;
    const dx = x - routeX;
    const dz = z - routeZ;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
      bestNextIndex = nextIndex;
      bestAmount = amount;
      bestX = routeX;
      bestZ = routeZ;
      bestYaw = Math.atan2(segmentX, segmentZ);
      const endProgress = loop && nextIndex === 0 ? 1 : end.progress;
      bestProgress = (start.progress + (endProgress - start.progress) * amount) % 1;
    }
  }
  return {
    distance: Math.sqrt(bestDistanceSq),
    index: bestIndex,
    nextIndex: bestNextIndex,
    amount: bestAmount,
    x: bestX,
    z: bestZ,
    yaw: bestYaw,
    progress: bestProgress,
  };
}

/**
 * Pure generation entry used on the main thread, in Node tests, and by the
 * module worker. Returned typed arrays are the sole renderer/physics source.
 */
export function buildDuneHeightfieldData(eventId = 'whiskerwind', options = {}) {
  const definition = eventId && typeof eventId === 'object'
    ? eventId
    : getDuneEvent(eventId);
  const width = Math.max(65, Math.round(Number(options.width) || definition.heightResolution || 513));
  const height = Math.max(65, Math.round(Number(options.height) || width));
  const worldSize = Math.max(128, Number(options.worldSize) || definition.worldSize);
  const half = worldSize * 0.5;
  const cellX = worldSize / (width - 1);
  const cellZ = worldSize / (height - 1);
  const heights = new Float32Array(width * height);
  const looseness = new Uint8Array(width * height);
  const compaction = new Uint8Array(width * height);
  const routeRuntime = sampleDuneRoute(definition, Math.max(5, worldSize / 128));
  const routeSamples = routeRuntime.samples;
  const routeCenterline = buildRouteCenterline(definition, routeRuntime);
  const corridor = definition.routeWidth * 0.5;
  const influence = corridor + Math.max(8, definition.routeWidth * 0.72);
  let minimum = Infinity;
  let maximum = -Infinity;

  for (let row = 0; row < height; row += 1) {
    const worldZ = F32(-half + row * cellZ);
    for (let column = 0; column < width; column += 1) {
      const index = row * width + column;
      const worldX = F32(-half + column * cellX);
      const bands = duneBands(worldX, worldZ, definition);
      const nearest = nearestRouteDistance(routeSamples, worldX, worldZ, routeRuntime.loop);
      const corridorBlend = 1 - smoothstep(corridor, influence, nearest.distance);
      const conditioning = corridorBlend * routeCenterline.strength;
      const rightX = Math.cos(nearest.yaw);
      const rightZ = -Math.sin(nearest.yaw);
      const lateral = (worldX - nearest.x) * rightX + (worldZ - nearest.z) * rightZ;
      const featureElevation = drawFeatureElevation(
        definition,
        routeRuntime.length,
        nearest.progress,
        nearest.distance,
      );
      const centerHeight = routeCenterline.heights[nearest.index]
        + (routeCenterline.heights[nearest.nextIndex] - routeCenterline.heights[nearest.index]) * nearest.amount;
      const centerBank = routeCenterline.banks[nearest.index]
        + (routeCenterline.banks[nearest.nextIndex] - routeCenterline.banks[nearest.index]) * nearest.amount;
      const conditionedHeight = centerHeight + centerBank * clamp(lateral, -corridor, corridor);
      let terrainHeight = bands.height + (conditionedHeight - bands.height) * conditioning;
      terrainHeight += featureElevation * corridorBlend * 0.92;

      // Keep start/finish approaches stable without flattening their elevation.
      const routeProgress = nearest.progress;
      const startFinish = definition.routeType === 'circuit'
        ? Math.max(0, 1 - Math.min(routeProgress, 1 - routeProgress) / 0.045)
        : Math.max(
            Math.max(0, 1 - routeProgress / 0.035),
            Math.max(0, 1 - (1 - routeProgress) / 0.035),
          );
      terrainHeight = F32(terrainHeight + (conditionedHeight - terrainHeight) * startFinish * 0.46);
      heights[index] = terrainHeight;
      minimum = Math.min(minimum, terrainHeight);
      maximum = Math.max(maximum, terrainHeight);

      const micro = hash32(column, row, definition.seed ^ 0xdeca);
      const lineBlend = corridorBlend * (
        1 - smoothstep(
          routeCenterline.lineWidth,
          routeCenterline.lineWidth + 3.5,
          Math.abs(lateral),
        )
      );
      const routePack = corridorBlend * (0.28 + definition.terrain.routeConditioning * 0.22)
        + lineBlend * (0.46 + definition.terrain.routeConditioning * 0.24);
      const staticCompaction = clamp(routePack + (1 - definition.terrain.looseSand) * 0.22, 0, 1);
      const staticLoose = clamp(
        definition.terrain.looseSand
        + bands.lee * 0.17
        + (micro - 0.5) * 0.12
        - staticCompaction * 0.52,
        0.08,
        1,
      );
      compaction[index] = Math.round(staticCompaction * 255);
      looseness[index] = Math.round(staticLoose * 255);
    }
  }

  return {
    schema: 1,
    eventId: definition.id,
    seed: definition.seed >>> 0,
    width,
    height,
    worldSize,
    minX: -half,
    minZ: -half,
    cellX,
    cellZ,
    minimum,
    maximum,
    heights,
    looseness,
    compaction,
  };
}

function bilinear(array, width, height, gx, gz) {
  const x = clamp(gx, 0, width - 1);
  const z = clamp(gz, 0, height - 1);
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(width - 1, x0 + 1);
  const z1 = Math.min(height - 1, z0 + 1);
  const tx = x - x0;
  const tz = z - z0;
  const a = array[z0 * width + x0];
  const b = array[z0 * width + x1];
  const c = array[z1 * width + x0];
  const d = array[z1 * width + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}

export class DuneHeightfield {
  constructor(payload) {
    if (!(payload?.heights instanceof Float32Array)) {
      throw new TypeError('DuneHeightfield requires a Float32Array height payload');
    }
    this.schema = payload.schema || 1;
    this.eventId = payload.eventId || 'whiskerwind';
    this.seed = payload.seed >>> 0;
    this.width = payload.width;
    this.height = payload.height;
    this.worldSize = payload.worldSize;
    this.minX = payload.minX;
    this.minZ = payload.minZ;
    this.maxX = this.minX + this.worldSize;
    this.maxZ = this.minZ + this.worldSize;
    this.cellX = payload.cellX;
    this.cellZ = payload.cellZ;
    this.minimum = payload.minimum;
    this.maximum = payload.maximum;
    this.heights = payload.heights;
    this.looseness = payload.looseness instanceof Uint8Array
      ? payload.looseness
      : new Uint8Array(this.width * this.height);
    this.compaction = payload.compaction instanceof Uint8Array
      ? payload.compaction
      : new Uint8Array(this.width * this.height);
    this._normalScratch = { x: 0, y: 1, z: 0 };
    this._surfaceScratch = {
      height: 0,
      normal: this._normalScratch,
      slope: 0,
      looseness: 0,
      compaction: 0,
      surface: 'loose-sand',
      surfaceGrip: 0.8,
      surfaceDrag: 0.7,
    };
  }

  gridX(worldX) {
    return (worldX - this.minX) / this.cellX;
  }

  gridZ(worldZ) {
    return (worldZ - this.minZ) / this.cellZ;
  }

  contains(worldX, worldZ, margin = 0) {
    return worldX >= this.minX + margin
      && worldX <= this.maxX - margin
      && worldZ >= this.minZ + margin
      && worldZ <= this.maxZ - margin;
  }

  heightAt(worldX, worldZ) {
    return bilinear(this.heights, this.width, this.height, this.gridX(worldX), this.gridZ(worldZ));
  }

  normalAt(worldX, worldZ, target = this._normalScratch) {
    const stepX = this.cellX;
    const stepZ = this.cellZ;
    const left = this.heightAt(worldX - stepX, worldZ);
    const right = this.heightAt(worldX + stepX, worldZ);
    const back = this.heightAt(worldX, worldZ - stepZ);
    const front = this.heightAt(worldX, worldZ + stepZ);
    const nx = left - right;
    const ny = stepX + stepZ;
    const nz = back - front;
    const inverse = 1 / Math.max(EPSILON, Math.hypot(nx, ny, nz));
    target.x = nx * inverse;
    target.y = ny * inverse;
    target.z = nz * inverse;
    return target;
  }

  slopeAt(worldX, worldZ) {
    return Math.acos(clamp(this.normalAt(worldX, worldZ).y, -1, 1));
  }

  surfaceAt(worldX, worldZ, target = this._surfaceScratch) {
    const gx = this.gridX(worldX);
    const gz = this.gridZ(worldZ);
    const height = bilinear(this.heights, this.width, this.height, gx, gz);
    const loose = bilinear(this.looseness, this.width, this.height, gx, gz) / 255;
    const packed = bilinear(this.compaction, this.width, this.height, gx, gz) / 255;
    const normal = this.normalAt(worldX, worldZ, target.normal || this._normalScratch);
    target.height = height;
    target.normal = normal;
    target.slope = Math.acos(clamp(normal.y, -1, 1));
    target.looseness = clamp(loose, 0, 1);
    target.compaction = clamp(packed, 0, 1);
    target.surface = packed > 0.48 ? 'packed-sand' : loose > 0.72 ? 'deep-loose-sand' : 'dune-sand';
    target.surfaceGrip = clamp(0.72 + packed * 0.32 - loose * 0.11, 0.58, 1.12);
    target.surfaceDrag = clamp(0.24 + loose * 0.82 - packed * 0.31, 0.12, 1.25);
    return target;
  }

  projectToTerrain(position, target = position) {
    target.x = position.x;
    target.z = position.z;
    target.y = this.heightAt(position.x, position.z);
    return target;
  }

  findSafeRecoveryPose(position, routeProgress = 0, routeRuntime = null, target = {}) {
    const route = routeRuntime;
    if (route?.samples?.length) {
      const baseIndex = Math.round(clamp(routeProgress, 0, 1) * (route.samples.length - 1));
      for (let offset = 0; offset < 32; offset += 1) {
        const index = Math.min(route.samples.length - 1, baseIndex + offset);
        const sample = route.samples[index];
        const slope = this.slopeAt(sample.x, sample.z);
        if (slope > 0.58) continue;
        target.x = sample.x;
        target.z = sample.z;
        target.y = this.heightAt(sample.x, sample.z);
        target.yaw = sample.yaw;
        target.progress = sample.progress;
        target.index = index;
        return target;
      }
    }
    let bestX = clamp(position.x, this.minX + 16, this.maxX - 16);
    let bestZ = clamp(position.z, this.minZ + 16, this.maxZ - 16);
    let bestSlope = this.slopeAt(bestX, bestZ);
    for (let ring = 1; ring <= 5; ring += 1) {
      for (let step = 0; step < 12; step += 1) {
        const angle = step / 12 * Math.PI * 2;
        const x = clamp(position.x + Math.cos(angle) * ring * 5, this.minX + 12, this.maxX - 12);
        const z = clamp(position.z + Math.sin(angle) * ring * 5, this.minZ + 12, this.maxZ - 12);
        const slope = this.slopeAt(x, z);
        if (slope < bestSlope) {
          bestSlope = slope;
          bestX = x;
          bestZ = z;
        }
      }
    }
    target.x = bestX;
    target.z = bestZ;
    target.y = this.heightAt(bestX, bestZ);
    target.yaw = 0;
    target.progress = routeProgress;
    target.index = 0;
    return target;
  }

  nearestRoute(routeRuntime, x, z, preferredIndex = 0) {
    return nearestDuneRouteSample(routeRuntime, x, z, preferredIndex);
  }

  checksum() {
    const words = new Uint32Array(this.heights.buffer, this.heights.byteOffset, this.heights.length);
    let hash = 2166136261;
    for (let index = 0; index < words.length; index += 1) {
      hash ^= words[index];
      hash = Math.imul(hash, 16777619);
    }
    for (let index = 0; index < this.looseness.length; index += 16) {
      hash ^= this.looseness[index] | (this.compaction[index] << 8);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  getSnapshot() {
    return {
      schema: this.schema,
      eventId: this.eventId,
      seed: this.seed,
      resolution: [this.width, this.height],
      worldSize: this.worldSize,
      heightRange: [this.minimum, this.maximum],
      checksum: this.checksum(),
    };
  }
}

export function createDuneHeightfield(payload) {
  return new DuneHeightfield(payload);
}

export async function generateDuneHeightfield(eventId = 'whiskerwind', options = {}) {
  const useWorker = options.worker !== false && typeof Worker === 'function' && typeof document !== 'undefined';
  if (!useWorker) return new DuneHeightfield(buildDuneHeightfieldData(eventId, options));
  const worker = new Worker(new URL('./duneHeightWorker.js', import.meta.url), { type: 'module' });
  const timeoutMs = Math.max(2_000, Number(options.timeoutMs) || 20_000);
  try {
    const payload = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Dune heightfield worker timed out')), timeoutMs);
      worker.addEventListener('message', (event) => {
        clearTimeout(timeout);
        if (event.data?.error) reject(new Error(event.data.error));
        else resolve(event.data);
      }, { once: true });
      worker.addEventListener('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      }, { once: true });
      worker.postMessage({
        eventId: typeof eventId === 'string' ? eventId : eventId?.id,
        eventDefinition: eventId && typeof eventId === 'object' ? eventId : null,
        options: {
          width: options.width,
          height: options.height,
          worldSize: options.worldSize,
        },
      });
    });
    payload.heights = new Float32Array(payload.heights);
    payload.looseness = new Uint8Array(payload.looseness);
    payload.compaction = new Uint8Array(payload.compaction);
    return new DuneHeightfield(payload);
  } finally {
    worker.terminate();
  }
}
