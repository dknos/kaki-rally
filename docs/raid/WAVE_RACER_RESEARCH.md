# Wave-Racer research — status

Reference repository: <https://github.com/Vyom-26/Wave-Racer> (read-only research
material).

## Provenance statement

**No Wave-Racer technique has been adapted, and no Wave-Racer material of any
kind is present in this repository.**

Nothing has been copied, translated, vendored, added as a dependency, added as a
submodule, or used as a source for art, palettes, UI, naming, or visual
identity. No file in `src/racing/raid/**` derives from it.

Everything built so far — the global-coordinate noise field, the terrain zone
and surface tables, the metre-native route runtime and its windowed progress
query, the sector generator, and the streamed terrain provider — was written
from first principles against Kaki Rally's own architecture and conventions.

## Why nothing has been adapted yet

The Wave-Racer techniques the specification calls out (§10) all sit in systems
this effort has not built:

| Technique | Belongs to | Status |
| --- | --- | --- |
| Deterministic visual harness | QA hooks | not built |
| Velocity-aware chase camera | camera | not built |
| Driver procedural animation and IK | vehicle presentation | not built |
| Second-order yaw and actual-slip feel | vehicle physics | not built |
| Persistent dust trails | VFX | not built |
| Adaptive resolution | renderer policy | not built |
| Synthesised audio + offline self-test | audio | not built |
| Optional water crossings | explicitly deferred by the spec | not built |

There was therefore nothing to adapt. This file exists so that the absence is
recorded rather than silently omitted.

## Licence status: NOT VERIFIED

The recon thread assigned to read the repository's `LICENSE` **failed with an
API error and returned nothing**. The licence is therefore unknown to this
effort.

Until it is verified, Wave-Racer must be treated as **all-rights-reserved
research material**: concepts may be understood and independently
reimplemented, but no source, shader, asset, or string may be reused under any
circumstances.

Anyone resuming this work must verify the licence before adapting anything, and
must record the verbatim licence name here. That check is the first item of
Wave 4, not an optional one.

## Required shape of a future entry

When a technique is adapted, this document must record, per the specification:

1. the technique;
2. the problem it solves;
3. how it maps to Kaki Rally Raid;
4. what must not be copied;
5. the new Raid-owned implementation boundary;
6. the test that proves the adaptation.
