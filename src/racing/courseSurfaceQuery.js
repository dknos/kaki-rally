/**
 * Height-aware nearest-road lookup.
 *
 * Drawn overpasses can place two legal road samples at the same X/Z. Horizontal
 * distance alone therefore cannot select a contact surface. This index keeps
 * the existing route-continuity preference while giving vertical proximity
 * enough weight to distinguish the elevated and lower branches.
 */
import { CourseSpatialHash } from './courseSpatialIndex.js';

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function circularIndexDistance(a, b, count) {
  const direct = Math.abs(a - b);
  return Math.min(direct, count - direct);
}

export function nearestCourseSample(
  samples,
  x,
  z,
  y = 0,
  preferredIndex = null,
  candidateIndices = null,
  target = null,
  candidateCount = candidateIndices?.length || 0,
) {
  if (!Array.isArray(samples) || !samples.length) {
    const empty = target || {};
    empty.index = -1;
    empty.distance = Infinity;
    empty.verticalDistance = Infinity;
    empty.score = Infinity;
    empty.sample = null;
    return empty;
  }
  const useCandidates = !!candidateIndices && candidateCount > 0;
  let best = useCandidates ? candidateIndices[0] : 0;
  let bestScore = Infinity;
  let bestHorizontalSq = Infinity;
  let bestVertical = Infinity;
  const count = useCandidates ? Math.min(candidateCount, candidateIndices.length) : samples.length;
  for (let candidateIndex = 0; candidateIndex < count; candidateIndex++) {
    const rawIndex = useCandidates ? candidateIndices[candidateIndex] : candidateIndex;
    const index = ((Math.trunc(rawIndex) % samples.length) + samples.length) % samples.length;
    const sample = samples[index];
    if (!sample) continue;
    const dx = finite(x) - finite(sample.x);
    const dz = finite(z) - finite(sample.z);
    const horizontalSq = dx * dx + dz * dz;
    const vertical = finite(y) - finite(sample.y);
    let continuity = 0;
    if (Number.isFinite(preferredIndex)) {
      const delta = circularIndexDistance(index, preferredIndex, samples.length);
      continuity = Math.min(18, delta * delta * 0.002);
    }
    const score = horizontalSq + vertical * vertical * 1.8 + continuity;
    if (
      score < bestScore
      || (
        Math.abs(score - bestScore) < 1e-8
        && (horizontalSq < bestHorizontalSq || (
          Math.abs(horizontalSq - bestHorizontalSq) < 1e-8 && index < best
        ))
      )
    ) {
      best = index;
      bestScore = score;
      bestHorizontalSq = horizontalSq;
      bestVertical = Math.abs(vertical);
    }
  }
  const result = target || {};
  result.index = best;
  result.distance = Math.sqrt(bestHorizontalSq);
  result.verticalDistance = bestVertical;
  result.score = bestScore;
  result.sample = samples[best];
  return result;
}

export class CourseSurfaceIndex {
  constructor(samples = [], trackWidth = 9.2) {
    this.samples = samples;
    this.trackWidth = Math.max(1, finite(trackWidth, 9.2));
    this.cellSize = Math.max(5, this.trackWidth * 1.4);
    this.hash = new CourseSpatialHash(this.cellSize);
    this.candidateMarks = new Uint32Array(0);
    this.candidateIndices = new Int32Array(0);
    this.candidateGeneration = 0;
    this.rebuild(samples);
  }

  rebuild(samples = this.samples) {
    this.samples = Array.isArray(samples) ? samples : [];
    this.hash.clear();
    this.candidateMarks = new Uint32Array(this.samples.length);
    this.candidateIndices = new Int32Array(this.samples.length);
    this.candidateGeneration = 0;
    if (!this.samples.length) return this;
    const expansion = Math.max(0.5, this.trackWidth * 0.12);
    for (let index = 0; index < this.samples.length; index++) {
      const nextIndex = (index + 1) % this.samples.length;
      const start = this.samples[index];
      const end = this.samples[nextIndex];
      this.hash.insert(
        index,
        Math.min(finite(start?.x), finite(end?.x)) - expansion,
        Math.min(finite(start?.z), finite(end?.z)) - expansion,
        Math.max(finite(start?.x), finite(end?.x)) + expansion,
        Math.max(finite(start?.z), finite(end?.z)) + expansion,
        { index, nextIndex },
      );
    }
    return this;
  }

  _appendCandidate(index, count, generation) {
    const sampleCount = this.samples.length;
    const normalized = ((Math.trunc(index) % sampleCount) + sampleCount) % sampleCount;
    if (this.candidateMarks[normalized] === generation) return count;
    this.candidateMarks[normalized] = generation;
    this.candidateIndices[count] = normalized;
    return count + 1;
  }

  nearest(x, z, y = 0, preferredIndex = null, target = null) {
    if (!this.samples.length) {
      return nearestCourseSample([], x, z, y, preferredIndex, null, target);
    }
    this.candidateGeneration++;
    if (this.candidateGeneration >= 0xffffffff) {
      this.candidateMarks.fill(0);
      this.candidateGeneration = 1;
    }
    const generation = this.candidateGeneration;
    let candidateCount = 0;
    let radius = Math.max(this.trackWidth, this.cellSize);
    for (let attempt = 0; attempt < 3 && candidateCount === 0; attempt++) {
      const radiusSq = radius * radius;
      const minCellX = Math.floor((x - radius) / this.cellSize);
      const maxCellX = Math.floor((x + radius) / this.cellSize);
      const minCellZ = Math.floor((z - radius) / this.cellSize);
      const maxCellZ = Math.floor((z + radius) / this.cellSize);
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          const bucket = this.hash.cells.get(`${cellX}:${cellZ}`);
          if (!bucket) continue;
          for (let bucketIndex = 0; bucketIndex < bucket.length; bucketIndex++) {
            const entry = this.hash.entries[bucket[bucketIndex]];
            const nearestX = Math.max(entry.bounds.minX, Math.min(x, entry.bounds.maxX));
            const nearestZ = Math.max(entry.bounds.minY, Math.min(z, entry.bounds.maxY));
            if ((nearestX - x) ** 2 + (nearestZ - z) ** 2 > radiusSq) continue;
            candidateCount = this._appendCandidate(entry.payload.index, candidateCount, generation);
            candidateCount = this._appendCandidate(entry.payload.nextIndex, candidateCount, generation);
            candidateCount = this._appendCandidate(entry.payload.index - 1, candidateCount, generation);
            candidateCount = this._appendCandidate(entry.payload.nextIndex + 1, candidateCount, generation);
          }
        }
      }
      radius *= 2;
    }
    if (Number.isFinite(preferredIndex)) {
      const preferred = ((Math.trunc(preferredIndex) % this.samples.length) + this.samples.length) % this.samples.length;
      for (let offset = -5; offset <= 5; offset++) {
        candidateCount = this._appendCandidate(preferred + offset, candidateCount, generation);
      }
    }
    return nearestCourseSample(
      this.samples,
      x,
      z,
      y,
      preferredIndex,
      candidateCount ? this.candidateIndices : null,
      target,
      candidateCount,
    );
  }

  diagnostics() {
    return {
      schema: 'kaki-course-surface-index@1',
      samples: this.samples.length,
      cells: this.hash.cells.size,
      cellSize: this.cellSize,
      trackWidth: this.trackWidth,
    };
  }
}

export function createCourseSurfaceIndex(samples, trackWidth) {
  return new CourseSurfaceIndex(samples, trackWidth);
}
