import { clamp } from '../physics.js';

const BRUSH_STRIDE = 18;
const BRUSH_FIELDS = Object.freeze({
  wheelIndex: 0,
  x: 1,
  z: 2,
  normalX: 3,
  normalY: 4,
  normalZ: 5,
  travelX: 6,
  travelZ: 7,
  forwardX: 8,
  forwardZ: 9,
  tireRadius: 10,
  tireWidth: 11,
  normalLoad: 12,
  longitudinalSlip: 13,
  lateralSlip: 14,
  driveTorque: 15,
  brakeAmount: 16,
  looseness: 17,
});

export const DUNE_DEFORMATION_QUALITY = Object.freeze({
  low: Object.freeze({
    recentResolution: 128,
    recentWorldSize: 72,
    coarseResolution: 64,
    brushCapacity: 20,
    slumpInterval: 0.75,
  }),
  medium: Object.freeze({
    recentResolution: 256,
    recentWorldSize: 88,
    coarseResolution: 96,
    brushCapacity: 28,
    slumpInterval: 0.5,
  }),
  high: Object.freeze({
    recentResolution: 512,
    recentWorldSize: 96,
    coarseResolution: 128,
    brushCapacity: 36,
    slumpInterval: 0.42,
  }),
  ultra: Object.freeze({
    recentResolution: 1024,
    recentWorldSize: 104,
    coarseResolution: 160,
    brushCapacity: 44,
    slumpInterval: 0.34,
  }),
});

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function snapped(value, spacing) {
  return Math.floor(value / spacing) * spacing;
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
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * tz;
}

/**
 * Fixed-capacity wheel brush upload. The same packed layout feeds the CPU
 * fallback, renderer upload and deterministic tests without allocating brush
 * objects in the simulation loop.
 */
export class DuneBrushBuffer {
  constructor(capacity = 32) {
    this.capacity = Math.max(1, Math.round(capacity));
    this.stride = BRUSH_STRIDE;
    this.data = new Float32Array(this.capacity * this.stride);
    this.count = 0;
    this.dropped = 0;
  }

  clear() {
    this.count = 0;
  }

  push(brush) {
    if (this.count >= this.capacity) {
      this.dropped += 1;
      return false;
    }
    const offset = this.count * this.stride;
    const data = this.data;
    data[offset + BRUSH_FIELDS.wheelIndex] = finite(brush.wheelIndex);
    data[offset + BRUSH_FIELDS.x] = finite(brush.worldX ?? brush.x);
    data[offset + BRUSH_FIELDS.z] = finite(brush.worldZ ?? brush.z);
    data[offset + BRUSH_FIELDS.normalX] = finite(brush.normalX, 0);
    data[offset + BRUSH_FIELDS.normalY] = finite(brush.normalY, 1);
    data[offset + BRUSH_FIELDS.normalZ] = finite(brush.normalZ, 0);
    data[offset + BRUSH_FIELDS.travelX] = finite(brush.travelX);
    data[offset + BRUSH_FIELDS.travelZ] = finite(brush.travelZ, 1);
    data[offset + BRUSH_FIELDS.forwardX] = finite(brush.forwardX);
    data[offset + BRUSH_FIELDS.forwardZ] = finite(brush.forwardZ, 1);
    data[offset + BRUSH_FIELDS.tireRadius] = Math.max(0.1, finite(brush.tireRadius, 1.05));
    data[offset + BRUSH_FIELDS.tireWidth] = Math.max(0.08, finite(brush.tireWidth, 0.62));
    data[offset + BRUSH_FIELDS.normalLoad] = clamp(finite(brush.normalLoad, 0.75), 0, 1.8);
    data[offset + BRUSH_FIELDS.longitudinalSlip] = clamp(finite(brush.longitudinalSlip), -2, 2);
    data[offset + BRUSH_FIELDS.lateralSlip] = clamp(finite(brush.lateralSlip), -2, 2);
    data[offset + BRUSH_FIELDS.driveTorque] = clamp(finite(brush.driveTorque), -2, 2);
    data[offset + BRUSH_FIELDS.brakeAmount] = clamp(finite(brush.brakeAmount), 0, 1);
    data[offset + BRUSH_FIELDS.looseness] = clamp(finite(brush.surfaceLooseness ?? brush.looseness, 0.65), 0, 1);
    this.count += 1;
    return true;
  }
}

function seedRecentFromCoarse(field, offsets, compaction, originX, originZ) {
  const size = field.recentResolution;
  const cell = field.recentCellSize;
  for (let row = 0; row < size; row += 1) {
    const z = originZ + row * cell;
    const coarseZ = (z - field.worldMinZ) / field.coarseCellZ;
    const rowOffset = row * size;
    for (let column = 0; column < size; column += 1) {
      const x = originX + column * cell;
      const coarseX = (x - field.worldMinX) / field.coarseCellX;
      const index = rowOffset + column;
      offsets[index] = bilinear(
        field.coarseOffset,
        field.coarseResolution,
        field.coarseResolution,
        coarseX,
        coarseZ,
      );
      compaction[index] = Math.round(clamp(bilinear(
        field.coarseCompaction,
        field.coarseResolution,
        field.coarseResolution,
        coarseX,
        coarseZ,
      ), 0, 255));
    }
  }
}

/**
 * Two-level deformable-sand state.
 *
 * The recent field is a snapped, player-following high-resolution window. A
 * sparse-cost world field retains physical rut and compaction history between
 * visits and laps. Heights are bounded independently from the visual material,
 * keeping deep-looking displaced sand from destabilizing the chassis.
 */
export class DuneDeformationField {
  constructor({
    worldSize = 768,
    worldMinX = -worldSize * 0.5,
    worldMinZ = -worldSize * 0.5,
    quality = 'medium',
    recentResolution,
    recentWorldSize,
    coarseResolution,
    focusX = 0,
    focusZ = 0,
  } = {}) {
    this.quality = DUNE_DEFORMATION_QUALITY[quality] ? quality : 'medium';
    const tier = DUNE_DEFORMATION_QUALITY[this.quality];
    this.worldSize = Math.max(64, finite(worldSize, 768));
    this.worldMinX = finite(worldMinX, -this.worldSize * 0.5);
    this.worldMinZ = finite(worldMinZ, -this.worldSize * 0.5);
    this.worldMaxX = this.worldMinX + this.worldSize;
    this.worldMaxZ = this.worldMinZ + this.worldSize;
    this.recentResolution = Math.max(32, Math.round(recentResolution || tier.recentResolution));
    this.recentWorldSize = Math.max(32, finite(recentWorldSize, tier.recentWorldSize));
    this.recentCellSize = this.recentWorldSize / (this.recentResolution - 1);
    this.coarseResolution = Math.max(32, Math.round(coarseResolution || tier.coarseResolution));
    this.coarseCellX = this.worldSize / (this.coarseResolution - 1);
    this.coarseCellZ = this.worldSize / (this.coarseResolution - 1);
    this.recentOffset = new Float32Array(this.recentResolution * this.recentResolution);
    this.recentCompaction = new Uint8Array(this.recentResolution * this.recentResolution);
    this._recentOffsetScratch = new Float32Array(this.recentOffset.length);
    this._recentCompactionScratch = new Uint8Array(this.recentCompaction.length);
    this.coarseOffset = new Float32Array(this.coarseResolution * this.coarseResolution);
    this.coarseCompaction = new Uint8Array(this.coarseOffset.length);
    this.originX = snapped(focusX - this.recentWorldSize * 0.5, this.recentCellSize);
    this.originZ = snapped(focusZ - this.recentWorldSize * 0.5, this.recentCellSize);
    this.focusX = focusX;
    this.focusZ = focusZ;
    this.version = 1;
    this.dirty = true;
    this.scrollCount = 0;
    this.appliedBrushes = 0;
    this.maximumDepression = 0;
    this.maximumBerm = 0;
    this._slumpAccumulator = 0;
    this._slumpInterval = tier.slumpInterval;
    this._sampleScratch = {
      offset: 0,
      compaction: 0,
      recent: false,
    };
    seedRecentFromCoarse(
      this,
      this.recentOffset,
      this.recentCompaction,
      this.originX,
      this.originZ,
    );
  }

  containsRecent(x, z, margin = 0) {
    return x >= this.originX + margin
      && x <= this.originX + this.recentWorldSize - margin
      && z >= this.originZ + margin
      && z <= this.originZ + this.recentWorldSize - margin;
  }

  recenter(focusX, focusZ, force = false) {
    this.focusX = finite(focusX, this.focusX);
    this.focusZ = finite(focusZ, this.focusZ);
    const guard = this.recentWorldSize * 0.24;
    if (!force && this.containsRecent(this.focusX, this.focusZ, guard)) return false;
    const nextOriginX = snapped(this.focusX - this.recentWorldSize * 0.5, this.recentCellSize);
    const nextOriginZ = snapped(this.focusZ - this.recentWorldSize * 0.5, this.recentCellSize);
    if (!force && nextOriginX === this.originX && nextOriginZ === this.originZ) return false;

    const oldOriginX = this.originX;
    const oldOriginZ = this.originZ;
    const size = this.recentResolution;
    const cell = this.recentCellSize;
    const nextOffsets = this._recentOffsetScratch;
    const nextCompaction = this._recentCompactionScratch;
    seedRecentFromCoarse(this, nextOffsets, nextCompaction, nextOriginX, nextOriginZ);
    for (let row = 0; row < size; row += 1) {
      const worldZ = oldOriginZ + row * cell;
      const nextRow = Math.round((worldZ - nextOriginZ) / cell);
      if (nextRow < 0 || nextRow >= size) continue;
      const oldRowOffset = row * size;
      const nextRowOffset = nextRow * size;
      for (let column = 0; column < size; column += 1) {
        const worldX = oldOriginX + column * cell;
        const nextColumn = Math.round((worldX - nextOriginX) / cell);
        if (nextColumn < 0 || nextColumn >= size) continue;
        const oldIndex = oldRowOffset + column;
        const nextIndex = nextRowOffset + nextColumn;
        nextOffsets[nextIndex] = this.recentOffset[oldIndex];
        nextCompaction[nextIndex] = this.recentCompaction[oldIndex];
      }
    }
    this._recentOffsetScratch = this.recentOffset;
    this._recentCompactionScratch = this.recentCompaction;
    this.recentOffset = nextOffsets;
    this.recentCompaction = nextCompaction;
    this.originX = nextOriginX;
    this.originZ = nextOriginZ;
    this.scrollCount += 1;
    this.version += 1;
    this.dirty = true;
    return true;
  }

  _coarseCoordinates(x, z) {
    return {
      x: (x - this.worldMinX) / this.coarseCellX,
      z: (z - this.worldMinZ) / this.coarseCellZ,
    };
  }

  sampleAt(x, z, target = this._sampleScratch) {
    if (this.containsRecent(x, z)) {
      const gx = (x - this.originX) / this.recentCellSize;
      const gz = (z - this.originZ) / this.recentCellSize;
      target.offset = clamp(
        bilinear(this.recentOffset, this.recentResolution, this.recentResolution, gx, gz),
        -0.15,
        0.08,
      );
      target.compaction = clamp(
        bilinear(this.recentCompaction, this.recentResolution, this.recentResolution, gx, gz) / 255,
        0,
        1,
      );
      target.recent = true;
      return target;
    }
    const gx = (x - this.worldMinX) / this.coarseCellX;
    const gz = (z - this.worldMinZ) / this.coarseCellZ;
    target.offset = clamp(
      bilinear(this.coarseOffset, this.coarseResolution, this.coarseResolution, gx, gz),
      -0.15,
      0.08,
    );
    target.compaction = clamp(
      bilinear(this.coarseCompaction, this.coarseResolution, this.coarseResolution, gx, gz) / 255,
      0,
      1,
    );
    target.recent = false;
    return target;
  }

  heightOffsetAt(x, z) {
    return this.sampleAt(x, z).offset;
  }

  compactionAt(x, z) {
    return this.sampleAt(x, z).compaction;
  }

  _stampRecent(x, z, travelX, travelZ, tireRadius, tireWidth, rutStrength, bermStrength, compactionGain) {
    if (!this.containsRecent(x, z, tireRadius * 1.8)) return;
    const invLength = 1 / Math.max(1e-5, Math.hypot(travelX, travelZ));
    const forwardX = travelX * invLength;
    const forwardZ = travelZ * invLength;
    const rightX = forwardZ;
    const rightZ = -forwardX;
    const extent = tireRadius * 1.18 + tireWidth * 1.4;
    const minColumn = clamp(Math.floor((x - extent - this.originX) / this.recentCellSize), 0, this.recentResolution - 1);
    const maxColumn = clamp(Math.ceil((x + extent - this.originX) / this.recentCellSize), 0, this.recentResolution - 1);
    const minRow = clamp(Math.floor((z - extent - this.originZ) / this.recentCellSize), 0, this.recentResolution - 1);
    const maxRow = clamp(Math.ceil((z + extent - this.originZ) / this.recentCellSize), 0, this.recentResolution - 1);
    const halfLength = tireRadius * 0.76;
    const halfWidth = tireWidth * 0.56;
    const bermCenter = halfWidth + tireWidth * 0.48;
    const bermWidth = Math.max(this.recentCellSize * 1.25, tireWidth * 0.42);
    for (let row = minRow; row <= maxRow; row += 1) {
      const worldZ = this.originZ + row * this.recentCellSize;
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const worldX = this.originX + column * this.recentCellSize;
        const dx = worldX - x;
        const dz = worldZ - z;
        const along = dx * forwardX + dz * forwardZ;
        const across = dx * rightX + dz * rightZ;
        const alongWeight = Math.max(0, 1 - (along / Math.max(0.12, halfLength)) ** 2);
        if (!(alongWeight > 0)) continue;
        const rutWeight = Math.max(0, 1 - (across / Math.max(0.08, halfWidth)) ** 2) * alongWeight;
        const bermDistance = Math.abs(Math.abs(across) - bermCenter);
        const bermWeight = Math.max(0, 1 - (bermDistance / bermWidth) ** 2) * alongWeight;
        if (!(rutWeight > 0 || bermWeight > 0)) continue;
        const index = row * this.recentResolution + column;
        const nextOffset = this.recentOffset[index]
          - rutStrength * rutWeight
          + bermStrength * bermWeight;
        this.recentOffset[index] = clamp(nextOffset, -0.15, 0.08);
        const nextPack = this.recentCompaction[index] + compactionGain * rutWeight * 255;
        this.recentCompaction[index] = Math.round(clamp(nextPack, 0, 255));
        this.maximumDepression = Math.max(this.maximumDepression, -this.recentOffset[index]);
        this.maximumBerm = Math.max(this.maximumBerm, this.recentOffset[index]);
      }
    }
  }

  _stampCoarse(x, z, rutStrength, compactionGain) {
    const gx = (x - this.worldMinX) / this.coarseCellX;
    const gz = (z - this.worldMinZ) / this.coarseCellZ;
    const centerX = Math.round(gx);
    const centerZ = Math.round(gz);
    for (let dz = -1; dz <= 1; dz += 1) {
      const row = centerZ + dz;
      if (row < 0 || row >= this.coarseResolution) continue;
      for (let dx = -1; dx <= 1; dx += 1) {
        const column = centerX + dx;
        if (column < 0 || column >= this.coarseResolution) continue;
        const distanceWeight = dx === 0 && dz === 0 ? 1 : dx !== 0 && dz !== 0 ? 0.22 : 0.48;
        const index = row * this.coarseResolution + column;
        this.coarseOffset[index] = clamp(
          this.coarseOffset[index] - rutStrength * distanceWeight * 0.28,
          -0.12,
          0.035,
        );
        this.coarseCompaction[index] = Math.round(clamp(
          this.coarseCompaction[index] + compactionGain * distanceWeight * 255 * 0.52,
          0,
          255,
        ));
      }
    }
  }

  applyBrushBuffer(buffer, dt = 1 / 120) {
    if (!buffer?.data || !(buffer.count > 0)) return 0;
    const data = buffer.data;
    const count = Math.min(buffer.count, buffer.capacity);
    const timeScale = clamp(finite(dt, 1 / 120) * 120, 0.25, 4);
    for (let brushIndex = 0; brushIndex < count; brushIndex += 1) {
      const offset = brushIndex * buffer.stride;
      const x = data[offset + BRUSH_FIELDS.x];
      const z = data[offset + BRUSH_FIELDS.z];
      const normalLoad = data[offset + BRUSH_FIELDS.normalLoad];
      if (!(normalLoad > 0.03)) continue;
      const longitudinalSlip = Math.abs(data[offset + BRUSH_FIELDS.longitudinalSlip]);
      const lateralSlip = Math.abs(data[offset + BRUSH_FIELDS.lateralSlip]);
      const driveTorque = Math.abs(data[offset + BRUSH_FIELDS.driveTorque]);
      const brake = data[offset + BRUSH_FIELDS.brakeAmount];
      const looseness = data[offset + BRUSH_FIELDS.looseness];
      const slipEnergy = clamp(longitudinalSlip * 0.72 + lateralSlip * 0.84 + driveTorque * 0.18 + brake * 0.32, 0, 2.2);
      const rutStrength = clamp(
        (0.00075 + looseness * 0.00125)
        * normalLoad
        * (1 + slipEnergy * 4.1)
        * timeScale,
        0.00012,
        0.014,
      );
      const bermStrength = rutStrength * clamp(0.38 + lateralSlip * 0.52 + longitudinalSlip * 0.17, 0.34, 0.92);
      const compactionGain = clamp(
        (0.0018 + normalLoad * 0.0024) * (1 + brake * 0.24) * timeScale,
        0.001,
        0.012,
      );
      let travelX = data[offset + BRUSH_FIELDS.travelX];
      let travelZ = data[offset + BRUSH_FIELDS.travelZ];
      if (Math.hypot(travelX, travelZ) < 1e-5) {
        travelX = data[offset + BRUSH_FIELDS.forwardX];
        travelZ = data[offset + BRUSH_FIELDS.forwardZ];
      }
      this._stampRecent(
        x,
        z,
        travelX,
        travelZ,
        data[offset + BRUSH_FIELDS.tireRadius],
        data[offset + BRUSH_FIELDS.tireWidth],
        rutStrength,
        bermStrength,
        compactionGain,
      );
      this._stampCoarse(x, z, rutStrength, compactionGain);
      this.appliedBrushes += 1;
    }
    this.version += 1;
    this.dirty = true;
    return count;
  }

  step(dt, windStrength = 0.35) {
    if (!(dt > 0)) return false;
    this._slumpAccumulator += dt;
    if (this._slumpAccumulator < this._slumpInterval) return false;
    const elapsed = this._slumpAccumulator;
    this._slumpAccumulator = 0;
    const recentFill = Math.exp(-elapsed * (0.0028 + clamp(windStrength, 0, 1.5) * 0.0038));
    const bermSlump = Math.exp(-elapsed * 0.016);
    const compactionFade = Math.exp(-elapsed * 0.00055);
    for (let index = 0; index < this.recentOffset.length; index += 1) {
      const current = this.recentOffset[index];
      this.recentOffset[index] = current < 0 ? current * recentFill : current * bermSlump;
      this.recentCompaction[index] = Math.round(this.recentCompaction[index] * compactionFade);
    }
    const coarseFill = Math.exp(-elapsed * (0.00032 + clamp(windStrength, 0, 1.5) * 0.00038));
    const coarsePackFade = Math.exp(-elapsed * 0.00008);
    for (let index = 0; index < this.coarseOffset.length; index += 1) {
      this.coarseOffset[index] *= coarseFill;
      this.coarseCompaction[index] = Math.round(this.coarseCompaction[index] * coarsePackFade);
    }
    this.version += 1;
    this.dirty = true;
    return true;
  }

  getTextureState() {
    return {
      version: this.version,
      dirty: this.dirty,
      recent: {
        offsets: this.recentOffset,
        compaction: this.recentCompaction,
        resolution: this.recentResolution,
        originX: this.originX,
        originZ: this.originZ,
        worldSize: this.recentWorldSize,
      },
      coarse: {
        offsets: this.coarseOffset,
        compaction: this.coarseCompaction,
        resolution: this.coarseResolution,
        originX: this.worldMinX,
        originZ: this.worldMinZ,
        worldSize: this.worldSize,
      },
    };
  }

  markUploaded() {
    this.dirty = false;
  }

  snapshot() {
    return {
      quality: this.quality,
      recentResolution: this.recentResolution,
      recentWorldSize: this.recentWorldSize,
      coarseResolution: this.coarseResolution,
      origin: [this.originX, this.originZ],
      focus: [this.focusX, this.focusZ],
      scrollCount: this.scrollCount,
      appliedBrushes: this.appliedBrushes,
      droppedBrushes: 0,
      maximumDepression: this.maximumDepression,
      maximumBerm: this.maximumBerm,
      physicalBounds: [-0.15, 0.08],
      version: this.version,
    };
  }
}

/**
 * One authoritative query facade combines seeded terrain and bounded physical
 * deformation. Rendering uploads the same arrays referenced here.
 */
export class DuneSurfaceField {
  constructor(heightfield, deformation) {
    if (!heightfield?.heightAt || !deformation?.sampleAt) {
      throw new TypeError('DuneSurfaceField requires heightfield and deformation query sources');
    }
    this.heightfield = heightfield;
    this.deformation = deformation;
    this.width = heightfield.width;
    this.height = heightfield.height;
    this.worldSize = heightfield.worldSize;
    this.minX = heightfield.minX;
    this.minZ = heightfield.minZ;
    this.maxX = heightfield.maxX;
    this.maxZ = heightfield.maxZ;
    this._normalScratch = { x: 0, y: 1, z: 0 };
    this._deformScratch = { offset: 0, compaction: 0, recent: false };
    this._surfaceScratch = {
      height: 0,
      baseHeight: 0,
      deformation: 0,
      normal: this._normalScratch,
      slope: 0,
      looseness: 0.6,
      compaction: 0,
      surface: 'dune-sand',
      surfaceGrip: 0.8,
      surfaceDrag: 0.5,
    };
  }

  contains(x, z, margin = 0) {
    return this.heightfield.contains(x, z, margin);
  }

  heightAt(x, z) {
    return this.heightfield.heightAt(x, z) + this.deformation.sampleAt(x, z, this._deformScratch).offset;
  }

  normalAt(x, z, target = this._normalScratch) {
    const step = Math.max(0.18, Math.min(this.heightfield.cellX, this.deformation.recentCellSize));
    const left = this.heightAt(x - step, z);
    const right = this.heightAt(x + step, z);
    const back = this.heightAt(x, z - step);
    const front = this.heightAt(x, z + step);
    const nx = left - right;
    const ny = step * 2;
    const nz = back - front;
    const inverse = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
    target.x = nx * inverse;
    target.y = ny * inverse;
    target.z = nz * inverse;
    return target;
  }

  surfaceAt(x, z, target = this._surfaceScratch) {
    const base = this.heightfield.surfaceAt(x, z, target);
    const deform = this.deformation.sampleAt(x, z, this._deformScratch);
    const deformationOffset = deform.offset;
    const deformationCompaction = deform.compaction;
    const staticCompaction = clamp(finite(base.compaction), 0, 1);
    const compaction = clamp(Math.max(staticCompaction, deformationCompaction), 0, 1);
    const looseness = clamp(finite(base.looseness, 0.6) * (1 - deformationCompaction * 0.58), 0.06, 1);
    const baseHeight = base.height;
    const normal = this.normalAt(x, z, target.normal || this._normalScratch);
    target.baseHeight = baseHeight;
    target.deformation = deformationOffset;
    target.height = baseHeight + deformationOffset;
    target.normal = normal;
    target.slope = Math.acos(clamp(normal.y, -1, 1));
    target.compaction = compaction;
    target.looseness = looseness;
    target.surface = compaction > 0.56
      ? 'packed-sand'
      : looseness > 0.72 ? 'deep-loose-sand' : 'dune-sand';
    target.surfaceGrip = clamp(0.7 + compaction * 0.38 - looseness * 0.1, 0.56, 1.13);
    target.surfaceDrag = clamp(0.18 + looseness * 0.68 - compaction * 0.24, 0.08, 0.96);
    return target;
  }

  slopeAt(x, z) {
    return Math.acos(clamp(this.normalAt(x, z).y, -1, 1));
  }

  projectToTerrain(position, target = position) {
    target.x = position.x;
    target.z = position.z;
    target.y = this.heightAt(position.x, position.z);
    return target;
  }

  findSafeRecoveryPose(position, routeProgress = 0, routeRuntime = null, target = {}) {
    const result = this.heightfield.findSafeRecoveryPose(position, routeProgress, routeRuntime, target);
    result.y = this.heightAt(result.x, result.z);
    return result;
  }
}

export function createDuneDeformationBrushBuffer(quality = 'medium') {
  const tier = DUNE_DEFORMATION_QUALITY[quality] || DUNE_DEFORMATION_QUALITY.medium;
  return new DuneBrushBuffer(tier.brushCapacity);
}
