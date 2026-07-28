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
) {
  if (!Array.isArray(samples) || !samples.length) {
    return { index: -1, distance: Infinity, verticalDistance: Infinity, sample: null };
  }
  const indices = candidateIndices?.length
    ? candidateIndices
    : samples.map((_, index) => index);
  let best = indices[0] ?? 0;
  let bestScore = Infinity;
  let bestHorizontalSq = Infinity;
  let bestVertical = Infinity;
  for (const rawIndex of indices) {
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
  return {
    index: best,
    distance: Math.sqrt(bestHorizontalSq),
    verticalDistance: bestVertical,
    score: bestScore,
    sample: samples[best],
  };
}

export class CourseSurfaceIndex {
  constructor(samples = [], trackWidth = 9.2) {
    this.samples = samples;
    this.trackWidth = Math.max(1, finite(trackWidth, 9.2));
    this.cellSize = Math.max(5, this.trackWidth * 1.4);
    this.hash = new CourseSpatialHash(this.cellSize);
    this.rebuild(samples);
  }

  rebuild(samples = this.samples) {
    this.samples = Array.isArray(samples) ? samples : [];
    this.hash.clear();
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

  nearest(x, z, y = 0, preferredIndex = null) {
    if (!this.samples.length) return nearestCourseSample([], x, z, y, preferredIndex);
    let radius = Math.max(this.trackWidth, this.cellSize);
    let entries = [];
    for (let attempt = 0; attempt < 3 && !entries.length; attempt++) {
      entries = this.hash.queryRadius(x, z, radius);
      radius *= 2;
    }
    const candidates = new Set();
    for (const entry of entries) {
      candidates.add(entry.payload.index);
      candidates.add(entry.payload.nextIndex);
      candidates.add((entry.payload.index - 1 + this.samples.length) % this.samples.length);
      candidates.add((entry.payload.nextIndex + 1) % this.samples.length);
    }
    if (Number.isFinite(preferredIndex)) {
      const preferred = ((Math.trunc(preferredIndex) % this.samples.length) + this.samples.length) % this.samples.length;
      for (let offset = -5; offset <= 5; offset++) {
        candidates.add((preferred + offset + this.samples.length) % this.samples.length);
      }
    }
    return nearestCourseSample(
      this.samples,
      x,
      z,
      y,
      preferredIndex,
      [...candidates],
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
