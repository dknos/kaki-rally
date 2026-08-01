// Kaki Rally Raid — streamed terrain authority.
//
// The provider owns which sectors exist right now. It is the single authority
// both the wheel physics and the renderer read, so there is no second terrain
// definition that could drift out of agreement with the first.
//
// Design rules this file exists to keep:
//
//  * Active cost is bounded by the residency ring, not by stage length. A 24 km
//    stage and a 6 km stage cost the same at any instant.
//  * A fixed-step physics tick never awaits, never generates a sector inline,
//    and never reads a Promise. If it asks about ground that has not streamed
//    in, it gets the EXACT field value computed on the spot — the same number
//    the sector will contain when it arrives — so nothing steps when it lands.
//  * Requests are cancellable. Turning around 180 degrees must not leave the
//    worker grinding through sectors behind the vehicle.

import {
  RAID_SECTOR_CELLS,
  RAID_SECTOR_METRES,
  generateRaidSector,
  raidSectorBytes,
  raidSectorKey,
  raidSectorOfWorld,
  sampleRaidFieldAt,
  serializeRaidRoute,
} from './raidSectorGenerator.js';
import { buildRaidRouteIndex } from './raidRouteRuntime.js';
import { RAID_SURFACES, clamp, raidSurfaceByIndex } from './raidSurfaceField.js';

// Residency by display quality. `safety` is the ring kept in every direction so
// a spin or a hard reverse always lands on loaded ground; `ahead` extends that
// ring along the velocity vector, which is where the player is actually going.
//
// `retain` MUST exceed the largest set updateFocus can ask for, which is the
// (2*safety+1)^2 ring plus up to three sectors per step of `ahead`. Sizing it
// below that makes the cache evict ground the vehicle is still standing on, and
// the symptom is not a crash but a slow leak of authority: samples quietly fall
// back, terrain is regenerated over and over, and the frame cost climbs with
// distance. The headroom above that minimum is the deliberate short retention
// behind the vehicle so a reverse does not have to regenerate.
export const RAID_RESIDENCY = Object.freeze({
  low: Object.freeze({ safety: 1, ahead: 2, retain: 20, budgetBytes: 32 * 1024 * 1024 }),
  medium: Object.freeze({ safety: 1, ahead: 3, retain: 26, budgetBytes: 48 * 1024 * 1024 }),
  high: Object.freeze({ safety: 2, ahead: 3, retain: 42, budgetBytes: 80 * 1024 * 1024 }),
  ultra: Object.freeze({ safety: 2, ahead: 4, retain: 52, budgetBytes: 128 * 1024 * 1024 }),
});

/** Largest number of sectors updateFocus can ask to be resident at once. */
export function raidMaxDesiredSectors(residency) {
  return (residency.safety * 2 + 1) ** 2 + residency.ahead * 3;
}

function residencyFor(quality) {
  return RAID_RESIDENCY[quality] || RAID_RESIDENCY.high;
}

const SURFACE_SCRATCH = { height: 0, macro: 0, surface: 0, looseness: 0 };

export function createRaidTerrainProvider({
  route,
  quality = 'high',
  useWorker = true,
  workerFactory = null,
  cells = RAID_SECTOR_CELLS,
} = {}) {
  const index = buildRaidRouteIndex(route);
  const residency = residencyFor(quality);
  const sectors = new Map();
  const pending = new Map();
  const stats = {
    generated: 0,
    cacheHits: 0,
    cacheMisses: 0,
    fallbackSamples: 0,
    evicted: 0,
    cancelled: 0,
    lastGenerateMs: 0,
    totalGenerateMs: 0,
  };
  let clock = 0;
  let disposed = false;
  // The set updateFocus last asked for. Eviction treats it as pinned.
  let wantedKeys = new Set();
  let worker = null;
  let nextRequestId = 1;
  const waiters = new Map();

  // ---------------------------------------------------------------------
  // Worker plumbing
  // ---------------------------------------------------------------------

  function ensureWorker() {
    if (!useWorker || worker || disposed) return worker;
    const create = workerFactory
      || (typeof Worker === 'function'
        ? () => new Worker(new URL('./raidSectorWorker.js', import.meta.url), { type: 'module' })
        : null);
    if (!create) return null;
    worker = create();
    worker.onmessage = (event) => {
      const message = event.data;
      if (!message || message.type !== 'sector') return;
      const request = waiters.get(message.requestId);
      waiters.delete(message.requestId);
      if (!request) return; // Cancelled while in flight; drop the payload.
      pending.delete(request.key);
      if (disposed) return;
      stats.generated += 1;
      stats.lastGenerateMs = message.generateMs || 0;
      stats.totalGenerateMs += stats.lastGenerateMs;
      store(request.key, message.payload);
      request.resolve(message.payload);
    };
    worker.postMessage({ type: 'route', route: serializeRaidRoute(route), cells });
    return worker;
  }

  function store(key, payload) {
    sectors.set(key, { payload, lastUsed: clock });
    evictIfNeeded();
  }

  function evictIfNeeded() {
    const perSector = raidSectorBytes(cells);
    const maxBySize = Math.max(raidMaxDesiredSectors(residency), Math.floor(residency.budgetBytes / perSector));
    const limit = Math.min(residency.retain, maxBySize);
    if (sectors.size <= limit) return;
    // Least recently used first, but never evict ground the current focus still
    // wants. Without that guard a residency ring larger than the retain limit
    // evicts the sector under the wheels and immediately regenerates it.
    const ordered = [...sectors.entries()]
      .filter(([key]) => !wantedKeys.has(key))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (let i = 0; i < ordered.length && sectors.size > limit; i += 1) {
      sectors.delete(ordered[i][0]);
      stats.evicted += 1;
    }
  }

  function generateInline(sectorX, sectorZ) {
    const started = Date.now();
    const payload = generateRaidSector({ sectorX, sectorZ, route, index, cells });
    stats.generated += 1;
    stats.lastGenerateMs = Date.now() - started;
    stats.totalGenerateMs += stats.lastGenerateMs;
    return payload;
  }

  function request(sectorX, sectorZ) {
    const key = raidSectorKey(sectorX, sectorZ);
    const resident = sectors.get(key);
    if (resident) {
      resident.lastUsed = clock;
      return Promise.resolve(resident.payload);
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight.promise;

    const active = ensureWorker();
    if (!active) {
      // No worker available (headless tests, or a browser that refused one).
      // Generating inline is correct but must never happen mid-drive, which is
      // why preloadAround() is awaited before control is handed to the player.
      const payload = generateInline(sectorX, sectorZ);
      store(key, payload);
      return Promise.resolve(payload);
    }

    const requestId = nextRequestId;
    nextRequestId += 1;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    waiters.set(requestId, { key, resolve });
    pending.set(key, { requestId, promise });
    active.postMessage({ type: 'sector', requestId, sectorX, sectorZ });
    return promise;
  }

  function cancel(key) {
    const inFlight = pending.get(key);
    if (!inFlight) return;
    pending.delete(key);
    waiters.delete(inFlight.requestId);
    stats.cancelled += 1;
    worker?.postMessage({ type: 'cancel', requestId: inFlight.requestId });
  }

  // ---------------------------------------------------------------------
  // Residency
  // ---------------------------------------------------------------------

  function desiredSectors(worldX, worldZ, velocityX, velocityZ) {
    const { sectorX, sectorZ } = raidSectorOfWorld(worldX, worldZ);
    const wanted = new Map();
    const add = (sx, sz, priority) => {
      const key = raidSectorKey(sx, sz);
      const existing = wanted.get(key);
      if (existing === undefined || priority < existing.priority) {
        wanted.set(key, { sectorX: sx, sectorZ: sz, priority });
      }
    };
    // The safety ring is unconditional and highest priority: the player can
    // always spin, roll, or reverse into it.
    add(sectorX, sectorZ, 0);
    for (let dz = -residency.safety; dz <= residency.safety; dz += 1) {
      for (let dx = -residency.safety; dx <= residency.safety; dx += 1) {
        add(sectorX + dx, sectorZ + dz, 1);
      }
    }
    // Then extend along the direction of travel.
    const speed = Math.hypot(velocityX, velocityZ);
    if (speed > 1) {
      const nx = velocityX / speed;
      const nz = velocityZ / speed;
      for (let step = 1; step <= residency.ahead; step += 1) {
        const reachX = worldX + nx * step * RAID_SECTOR_METRES;
        const reachZ = worldZ + nz * step * RAID_SECTOR_METRES;
        const target = raidSectorOfWorld(reachX, reachZ);
        add(target.sectorX, target.sectorZ, 2 + step);
        // One sector either side of the travel corridor, so a lane change does
        // not outrun the stream.
        add(target.sectorX + Math.round(-nz), target.sectorZ + Math.round(nx), 3 + step);
        add(target.sectorX - Math.round(-nz), target.sectorZ - Math.round(nx), 3 + step);
      }
    }
    return wanted;
  }

  function updateFocus(worldX, worldZ, velocityX = 0, velocityZ = 0) {
    if (disposed) return;
    clock += 1;
    const wanted = desiredSectors(worldX, worldZ, velocityX, velocityZ);
    wantedKeys = new Set(wanted.keys());
    // Refresh LRU stamps for everything still wanted.
    for (const key of wanted.keys()) {
      const resident = sectors.get(key);
      if (resident) resident.lastUsed = clock;
    }
    // Cancel in-flight work nobody wants any more.
    for (const key of [...pending.keys()]) {
      if (!wanted.has(key)) cancel(key);
    }
    // Request what is missing, nearest first.
    const missing = [...wanted.values()]
      .filter(({ sectorX, sectorZ }) => {
        const key = raidSectorKey(sectorX, sectorZ);
        return !sectors.has(key) && !pending.has(key);
      })
      .sort((a, b) => a.priority - b.priority);
    for (const { sectorX, sectorZ } of missing) request(sectorX, sectorZ);
  }

  async function preloadAround(worldX, worldZ, radiusSectors = residency.safety) {
    const { sectorX, sectorZ } = raidSectorOfWorld(worldX, worldZ);
    const promises = [];
    for (let dz = -radiusSectors; dz <= radiusSectors; dz += 1) {
      for (let dx = -radiusSectors; dx <= radiusSectors; dx += 1) {
        promises.push(request(sectorX + dx, sectorZ + dz));
      }
    }
    await Promise.all(promises);
  }

  // ---------------------------------------------------------------------
  // Sampling — the physics-facing surface
  // ---------------------------------------------------------------------

  function residentPayload(worldX, worldZ) {
    const { sectorX, sectorZ } = raidSectorOfWorld(worldX, worldZ);
    const resident = sectors.get(raidSectorKey(sectorX, sectorZ));
    if (!resident) return null;
    resident.lastUsed = clock;
    return resident.payload;
  }

  function bilinearHeight(payload, worldX, worldZ) {
    const gx = (worldX - payload.originX) / payload.cellMetres;
    const gz = (worldZ - payload.originZ) / payload.cellMetres;
    const x0 = clamp(Math.floor(gx), 0, payload.verts - 1);
    const z0 = clamp(Math.floor(gz), 0, payload.verts - 1);
    const x1 = Math.min(payload.verts - 1, x0 + 1);
    const z1 = Math.min(payload.verts - 1, z0 + 1);
    const tx = clamp(gx - x0, 0, 1);
    const tz = clamp(gz - z0, 0, 1);
    const h = payload.heights;
    const a = h[z0 * payload.verts + x0];
    const b = h[z0 * payload.verts + x1];
    const c = h[z1 * payload.verts + x0];
    const d = h[z1 * payload.verts + x1];
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  // Fallback height for ground that has not streamed in.
  //
  // It is NOT enough to evaluate the analytic field at the query point. A
  // resident sector answers with a bilinear blend of stored float32 vertices,
  // and the difference between that and the continuous field reaches 0.4 m in
  // rocky terrain where the highest-frequency octave is only a few cells wide.
  // A wheel would pop by that much the instant the sector landed.
  //
  // So the fallback reproduces exactly what the sector will do: snap to the
  // same GLOBAL vertex lattice, evaluate the field at the four surrounding
  // vertices, round each to float32 the way storage will, and interpolate.
  const cellMetres = RAID_SECTOR_METRES / cells;
  function fallbackHeight(worldX, worldZ) {
    const gx = Math.floor(worldX / cellMetres);
    const gz = Math.floor(worldZ / cellMetres);
    const tx = worldX / cellMetres - gx;
    const tz = worldZ / cellMetres - gz;
    const x0 = gx * cellMetres;
    const x1 = (gx + 1) * cellMetres;
    const z0 = gz * cellMetres;
    const z1 = (gz + 1) * cellMetres;
    const a = Math.fround(sampleRaidFieldAt(x0, z0, route, index, SURFACE_SCRATCH).height);
    const b = Math.fround(sampleRaidFieldAt(x1, z0, route, index, SURFACE_SCRATCH).height);
    const c = Math.fround(sampleRaidFieldAt(x0, z1, route, index, SURFACE_SCRATCH).height);
    const d = Math.fround(sampleRaidFieldAt(x1, z1, route, index, SURFACE_SCRATCH).height);
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    return top + (bottom - top) * tz;
  }

  function heightAt(worldX, worldZ) {
    const payload = residentPayload(worldX, worldZ);
    if (payload) {
      stats.cacheHits += 1;
      return bilinearHeight(payload, worldX, worldZ);
    }
    stats.cacheMisses += 1;
    stats.fallbackSamples += 1;
    return fallbackHeight(worldX, worldZ);
  }

  function normalAt(worldX, worldZ, target = { x: 0, y: 1, z: 0 }) {
    // Central differences over one terrain cell. Sampling the same authority
    // the height came from keeps the contact normal consistent with the contact
    // point, including across a sector boundary.
    const step = RAID_SECTOR_METRES / cells;
    const west = heightAt(worldX - step, worldZ);
    const east = heightAt(worldX + step, worldZ);
    const south = heightAt(worldX, worldZ - step);
    const north = heightAt(worldX, worldZ + step);
    const dx = (west - east) / (2 * step);
    const dz = (south - north) / (2 * step);
    const inverse = 1 / Math.hypot(dx, 1, dz);
    target.x = dx * inverse;
    target.y = inverse;
    target.z = dz * inverse;
    return target;
  }

  function surfaceAt(worldX, worldZ, target = {}) {
    const payload = residentPayload(worldX, worldZ);
    let surfaceIndex;
    let looseness;
    if (payload) {
      const gx = clamp(Math.round((worldX - payload.originX) / payload.cellMetres), 0, payload.verts - 1);
      const gz = clamp(Math.round((worldZ - payload.originZ) / payload.cellMetres), 0, payload.verts - 1);
      const at = gz * payload.verts + gx;
      surfaceIndex = payload.surface[at];
      looseness = payload.looseness[at] / 255;
    } else {
      // Snap to the same vertex a resident sector would report, so the surface
      // identity cannot change when the payload arrives.
      stats.fallbackSamples += 1;
      const snappedX = Math.round(worldX / cellMetres) * cellMetres;
      const snappedZ = Math.round(worldZ / cellMetres) * cellMetres;
      sampleRaidFieldAt(snappedX, snappedZ, route, index, SURFACE_SCRATCH);
      surfaceIndex = SURFACE_SCRATCH.surface;
      looseness = Math.round(SURFACE_SCRATCH.looseness * 255) / 255;
    }
    const surface = raidSurfaceByIndex(surfaceIndex);
    target.id = surface.id;
    target.name = surface.name;
    target.grip = surface.grip;
    target.drag = surface.drag;
    target.momentum = surface.momentum;
    target.punctureRisk = surface.punctureRisk;
    target.tyreWear = surface.tyreWear;
    target.dust = surface.dust;
    // Looseness deepens sinkage inside one surface identity, so soft sand can
    // get softer without changing what the surface is called.
    target.sinkage = surface.sinkage * (0.65 + looseness * 0.7);
    target.looseness = looseness;
    return target;
  }

  function containsAuthority(worldX, worldZ, margin = 0) {
    if (margin <= 0) return !!residentPayload(worldX, worldZ);
    for (const [dx, dz] of [[-margin, 0], [margin, 0], [0, -margin], [0, margin]]) {
      if (!residentPayload(worldX + dx, worldZ + dz)) return false;
    }
    return true;
  }

  function getSectorState() {
    const perSector = raidSectorBytes(cells);
    return {
      resident: sectors.size,
      pending: pending.size,
      bytes: sectors.size * perSector,
      megabytes: (sectors.size * perSector) / 1024 / 1024,
      budgetMegabytes: residency.budgetBytes / 1024 / 1024,
      keys: [...sectors.keys()],
      ...stats,
      averageGenerateMs: stats.generated > 0 ? stats.totalGenerateMs / stats.generated : 0,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const key of [...pending.keys()]) cancel(key);
    pending.clear();
    waiters.clear();
    sectors.clear();
    wantedKeys = new Set();
    if (worker) {
      worker.onmessage = null;
      worker.terminate?.();
      worker = null;
    }
  }

  return {
    route,
    index,
    quality,
    cells,
    residency,
    maxDesiredSectors: raidMaxDesiredSectors(residency),
    preloadAround,
    updateFocus,
    heightAt,
    normalAt,
    surfaceAt,
    containsAuthority,
    getSectorState,
    dispose,
    get disposed() { return disposed; },
    // Exposed for diagnostics and tests only.
    _sectors: sectors,
    surfaces: RAID_SURFACES,
  };
}
