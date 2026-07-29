import { buildDuneHeightfieldData } from './duneHeightfield.js';

self.addEventListener('message', (event) => {
  try {
    const payload = buildDuneHeightfieldData(
      event.data?.eventDefinition || event.data?.eventId,
      event.data?.options || {},
    );
    const heights = payload.heights.buffer;
    const looseness = payload.looseness.buffer;
    const compaction = payload.compaction.buffer;
    self.postMessage({
      ...payload,
      heights,
      looseness,
      compaction,
    }, [heights, looseness, compaction]);
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
});
