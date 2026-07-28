/**
 * Small deterministic 2D spatial hash shared by course authoring systems.
 *
 * Entries are inserted with an axis-aligned footprint and returned in insertion
 * order. Query callers therefore get stable results without sorting by object
 * identity or relying on Map bucket order.
 */

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function orderedBounds(minX, minY, maxX, maxY) {
  const x0 = finite(minX);
  const y0 = finite(minY);
  const x1 = finite(maxX, x0);
  const y1 = finite(maxY, y0);
  return {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

export class CourseSpatialHash {
  constructor(cellSize = 12) {
    this.cellSize = Math.max(0.25, finite(cellSize, 12));
    this.cells = new Map();
    this.entries = [];
  }

  _coordinate(value) {
    return Math.floor(finite(value) / this.cellSize);
  }

  _key(x, y) {
    return `${x}:${y}`;
  }

  _range(bounds) {
    return {
      minX: this._coordinate(bounds.minX),
      minY: this._coordinate(bounds.minY),
      maxX: this._coordinate(bounds.maxX),
      maxY: this._coordinate(bounds.maxY),
    };
  }

  clear() {
    this.cells.clear();
    this.entries.length = 0;
  }

  insert(id, minX, minY, maxX, maxY, payload = null) {
    const bounds = orderedBounds(minX, minY, maxX, maxY);
    const entry = Object.freeze({
      id: String(id),
      index: this.entries.length,
      bounds: Object.freeze(bounds),
      payload,
    });
    this.entries.push(entry);
    const range = this._range(bounds);
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        const key = this._key(x, y);
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(entry.index);
        else this.cells.set(key, [entry.index]);
      }
    }
    return entry;
  }

  queryBounds(minX, minY, maxX, maxY) {
    const bounds = orderedBounds(minX, minY, maxX, maxY);
    const range = this._range(bounds);
    const seen = new Set();
    const output = [];
    for (let y = range.minY; y <= range.maxY; y++) {
      for (let x = range.minX; x <= range.maxX; x++) {
        for (const index of this.cells.get(this._key(x, y)) || []) {
          if (seen.has(index)) continue;
          seen.add(index);
          const entry = this.entries[index];
          if (
            entry.bounds.maxX < bounds.minX
            || entry.bounds.minX > bounds.maxX
            || entry.bounds.maxY < bounds.minY
            || entry.bounds.minY > bounds.maxY
          ) continue;
          output.push(entry);
        }
      }
    }
    output.sort((a, b) => a.index - b.index);
    return output;
  }

  queryRadius(x, y, radius = 0) {
    const safeRadius = Math.max(0, finite(radius));
    const radiusSq = safeRadius * safeRadius;
    return this.queryBounds(
      x - safeRadius,
      y - safeRadius,
      x + safeRadius,
      y + safeRadius,
    ).filter((entry) => {
      const nearestX = Math.max(entry.bounds.minX, Math.min(x, entry.bounds.maxX));
      const nearestY = Math.max(entry.bounds.minY, Math.min(y, entry.bounds.maxY));
      return (nearestX - x) ** 2 + (nearestY - y) ** 2 <= radiusSq;
    });
  }
}

export function buildPointSpatialHash(points = [], cellSize = 12, accessor = (point) => point) {
  const hash = new CourseSpatialHash(cellSize);
  points.forEach((source, index) => {
    const point = accessor(source, index) || {};
    hash.insert(index, point.x, point.y, point.x, point.y, source);
  });
  return hash;
}
