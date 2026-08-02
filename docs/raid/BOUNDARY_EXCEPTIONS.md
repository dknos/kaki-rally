# Raid frozen-boundary exceptions

`tools/generate-raid-frozen-boundaries.mjs` freezes 148 files against the Raid
baseline `3de3e717da2a78e3e59221d8a0eac6937f85a547`. Its policy is not "never
change these", it is:

> Every file under `files` must stay byte-identical. A digest mismatch fails the
> wave unless the final report documents the file, the reason, proof that an
> adapter could not solve it, regression tests, and before/after evidence.

This file is that documentation. Each exception is recorded individually. The
digest is rebaselined only after an entry exists here, and a blanket rebaseline
across all 148 files is never an acceptable substitute for a per-file entry —
that is precisely the laundering the tool's own comment warns about.

## Wave: `feat/kaki-world-asset-overhaul` (2026-08-02)

### Scope note

The freeze exists so that Raid work could not silently contaminate modes that
shipped before it. The Raid wave is complete: Raid is on the public build and
`Release 1.2.0` post-dates the baseline. This wave is not Raid work, and its
brief explicitly directs changes to the racing environment modules. The freeze
is therefore stale with respect to this wave, but it is still live policy in the
repository, so exceptions are recorded rather than assumed.

---

### 1. `src/racing/racingEnvironment.js`

**Reason.** Drift Attack's judged zones never rendered on the route.
`freezeZone` in `src/racing/drift/driftAttack.js:24` emits
`kind` / `from` / `to` / `targetLateral` / `width`, but this file read
`zone.fraction` and `zone.type`. Both are `undefined`, so
`_sampleAtFraction(samples, undefined)` resolved to index `0` and every marker of
every layout stacked on the start line while the HUD read `0/4 ZONES`.

**Why an adapter could not solve it.** The defect is *inside* the frozen file.
The incorrect property reads are on lines 1213 and 1218-1220 of
`racingEnvironment.js` itself. An adapter would have to fabricate `fraction` and
`type` onto the frozen zone objects emitted by `driftAttack.js`, which is also
frozen (`src/racing/drift/` is a frozen directory), and would still leave the
file reading a span as a point. There is nothing to adapt around.

**Blast radius.** Presentation only. The module docstring states it "never
creates or mutates path samples, collision widths, feature indices, or physics
state", every mesh carries `userData.presentationOnly`, and the change touches
only the transform list handed to `_instanced`. No course data, physics,
scoring, ghost, record or save format is read or written.

**Regression evidence.** `npm run test:racing` passes: 30 configurations /
585 assertions visual smoke, plus 88 assertions lifecycle smoke.

**Before / after.** Before: 4-5 instances per layout, all at `samples[0]`.
After: markers distributed along each zone span at the judged lateral offset —
45 instances across the five Wall Run zones, wrapping spans handled. Placement
verified offline against the real layout data before the edit.

---

### 2. `src/racing/trialsEnvironment.js`

**Reason.** Roughly 370 lines of authored Trials theme dressing never rendered.
`buildTrialsEnvironment` gated the procedural theme story on
`if (session.assetLease?.ready)` with `_addMeadowStory` / `_addQuarryStory` /
`_addCrownStory` on the `else` arms, but `ready` is always
`Promise.all(...)` (`src/racing/racingAssets.js:144`) and therefore always
truthy. Windmills and their rotor animation, cat pennants, quarry spires and
glowmoss, crown crests and cloudways were all unreachable, and `world.rotors`
was permanently empty so the rotor animation loop had nothing to iterate.

**Why an adapter could not solve it.** The dead branch is in this file, and the
always-truthy value it tests comes from `src/racing/racingAssets.js`, which is
also frozen. Making `ready` falsy to reach the `else` arm would break every
other lease consumer. The only correct fix is to stop treating the two layers as
alternatives, which is a change to this file's control flow.

**Blast radius.** Presentation only, and additive: the theme story dresses the
near band at `z ±4.55..5.9` on both sides while the authored kit occupies a far
band at `z -9.4`, so the layers compose rather than collide. Verified by reading
the placement expressions in both paths before the edit. No course data,
physics, scoring or save format is touched.

**Regression evidence.** `npm run test:racing` passes: 585 + 88 assertions.

**Before / after.** Before: each Trials venue rendered only the authored kit —
about 24 trees and 12 fern clusters in a single band behind the track over
780 m, with nothing in front of or above the racing line. After: the theme story
builds unconditionally and the authored kit layers on when the lease resolves,
restoring both the near-band dressing and the windmill rotor animation.

---

### Outstanding

`docs/qa/world-assets/after/` side-by-side captures are still pending. Both
entries currently rest on the automated racing suite plus offline verification
of the placement maths; neither has been visually confirmed in a rendered frame.
That gap is recorded rather than glossed, and is the first thing the next
session should close.
