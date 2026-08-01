// Kaki Rally Raid — terrain sector worker.
//
// Generation is a few tens of milliseconds per sector, which is several frames.
// Doing it on the main thread would hitch every sector boundary at speed, so it
// lives here. The worker holds the route once and then answers sector requests.
//
// Cancellation matters as much as generation: turning around must not leave a
// queue of sectors behind the vehicle being built while the ground ahead waits.
// Requests are dropped by id before work starts rather than interrupted midway,
// which is enough because a single sector is short.

import { buildRaidRouteIndex } from './raidRouteRuntime.js';
import { RAID_SECTOR_CELLS, generateRaidSector } from './raidSectorGenerator.js';

let route = null;
let index = null;
let cells = RAID_SECTOR_CELLS;
const cancelled = new Set();
const queue = [];
let draining = false;

function drain() {
  if (draining) return;
  draining = true;
  // Yield between sectors so a cancel message can be received and honoured
  // instead of sitting behind a long synchronous burst.
  const step = () => {
    const job = queue.shift();
    if (!job) {
      draining = false;
      return;
    }
    if (cancelled.has(job.requestId)) {
      cancelled.delete(job.requestId);
      setTimeout(step, 0);
      return;
    }
    const started = Date.now();
    const payload = generateRaidSector({
      sectorX: job.sectorX,
      sectorZ: job.sectorZ,
      route,
      index,
      cells,
    });
    const generateMs = Date.now() - started;
    if (cancelled.has(job.requestId)) {
      cancelled.delete(job.requestId);
    } else {
      // Transfer the buffers rather than copying them: a sector is ~390 KiB and
      // structured cloning that on every boundary crossing is wasted bandwidth.
      self.postMessage(
        { type: 'sector', requestId: job.requestId, payload, generateMs },
        [payload.heights.buffer, payload.surface.buffer, payload.looseness.buffer],
      );
    }
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

self.onmessage = (event) => {
  const message = event.data;
  if (!message) return;
  if (message.type === 'route') {
    route = message.route;
    cells = message.cells || RAID_SECTOR_CELLS;
    index = buildRaidRouteIndex(route);
    return;
  }
  if (message.type === 'cancel') {
    cancelled.add(message.requestId);
    return;
  }
  if (message.type === 'sector') {
    if (!route) return;
    queue.push(message);
    drain();
  }
};
