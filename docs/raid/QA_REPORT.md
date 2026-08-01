# Kaki Rally Raid — QA report

Scope of this report: Wave 0 (frozen baseline and isolation) and the
computational core of Waves 2–3 (terrain authority, streaming, route runtime,
stage data). **Wave 1 — the shell-facing mode lifecycle — is not built, and
nothing has been rendered.**

## Automated results

`npm test` — **PASS (exit 0)**. Every pre-existing suite still passes, and the
new `test:raid` suite runs as part of it.

| Suite | Result |
| --- | --- |
| `test:renderer` | PASS |
| `test:racing` (20 smokes, incl. the frozen embedded Rally Raid) | PASS |
| `test:standalone` (save, boundaries, Catastrophe isolation, lifecycle) | PASS |
| `test:assets` (73 assets, 1549 assertions, 123-file inventory) | PASS |
| `test:raid` (new) | PASS |

### New Raid suite

| Test | Contracts | Notable measurement |
| --- | --- | --- |
| `smoke-raid-isolation.mjs` | 11 | 150 production modules inspected; both development gates asserted behaviourally |
| `generate-raid-frozen-boundaries.mjs --check` | 150 digests | all frozen files byte-identical to the baseline |
| `smoke-raid-surface-field.mjs` | 10 | 2056 seam vertices bit-identical out to 24 km |
| `smoke-raid-route.mjs` | 11 | 12.41 km, 1553 samples, 419 fold-back pairs, no shortcut |
| `smoke-raid-sector-seams.mjs` | 7 | 0 mismatches across 3×3 block, corners, zone transitions, 25 km |
| `smoke-raid-terrain-provider.mjs` | 7 | full-stage drive: 0 samples outside authority, 0.230 m largest step |

### Browser matrix

The **baseline fails**: `npm run test:browser:webgl` fails at
`tools/smoke-rally-browser-matrix.mjs:392` on an untouched checkout of
`632efaf` (mobile Trials Workshop responsive assertion). This predates Raid and
is deliberately not fixed — see `BASELINE.md`.

`npm run test:browser:dunes` **also fails on the untouched baseline**, at
`:477` (`mobile Dune target fell below 44 CSS px: 40.47998046875`).

The matrix was therefore used as a *differential* gate rather than a pass/fail
one. Run under quiet conditions on a pristine `632efaf` clone and on the Raid
clone, both boot, both reach `runDuneResponsive`, and both fail at the same line
with the same value. The seams introduce no regression on the real boot path.

An earlier Raid-clone run timed out at boot; it was concurrent with an
eleven-agent recon workflow saturating the CPU and did not reproduce once the
machine was quiet.

## Bugs found and fixed during this work

Four of these were found by tests written before the code they exercise, and
two were pre-existing defects in shared code.

1. **Zone blending made the landscape swim.** Interpolating `macroScale` /
   `ridgeWavelength` slid the noise phase in proportion to distance from the
   origin — 3.3 m of relief movement per 0.5% of a transition. Fixed by
   blending evaluated fields instead of parameters.
2. **The unwindowed route query returned a wrong nearest point.** It stopped one
   cell-ring after the first hit, so a query 2 km off-route could accept a
   2534 m match while a 2218 m one sat one ring out. Fixed with a correct
   distance-bound termination, then bounded to 4 rings with an exact linear
   fallback after the ring walk was found to be quadratic in the off-route case.
3. **Surface classification collapsed to one identity per sector.** Slope was
   hardcoded to zero and relief used absolute height, so no vertex ever crossed
   a threshold. Fixed with a real slope from a seam-exact apron and a relief
   measured against the zone's own macro landform.
4. **The zone lattice apron was clamped**, so an apron vertex used the sector's
   edge weights rather than the true weights one node out, and the neighbouring
   sector disagreed. Fixed by giving the lattice a node of margin.
5. **Residency `retain` was smaller than the requested ring**, so the cache
   evicted the sector under the wheels and regenerated it. 1623 physics samples
   silently fell back over one drive. Fixed by sizing `retain` above
   `(2·safety+1)² + 3·ahead` and pinning the wanted set during eviction.
6. **The unloaded-terrain fallback popped the ground by up to 0.4 m.** The
   analytic field and the bilinear blend of stored float32 vertices differ by
   that much in rocky terrain. Fixed by having the fallback reproduce the stored
   lattice exactly; the pop is now under 1 mm.

### Pre-existing shared-code bug fixed

`routeUrl()` in `src/app/rallyRouter.js` deleted the `dev` query parameter
whenever `catastropheDevelopment === false`, and `restartInWebGL(mode)` passed
`catastropheDevelopment: mode === 'crash'`. Restarting any non-Catastrophe
development mode into WebGL would have stripped its own development flag. Both
restart paths are now asserted behaviourally.

## Explicitly omitted

Listed so the omissions are visible rather than inferred from silence. Against
the specification's §46 delivery list, the following are **not delivered**:

- Screenshot evidence of Raid — nothing has been rendered, so none exists. The
  §43 named-capture list is entirely outstanding.
- Audio self-test results — no audio exists.
- WebGL/WebGPU results *for Raid* — Raid cannot be launched yet. The seam
  regression check covers existing modes only.
- Desktop / ultrawide / mobile / controller status for Raid — not launchable.
- Performance and memory results measured in a browser. All figures in
  `ARCHITECTURE.md` are measured in Node, and the full-stage soak ran at reduced
  sector resolution (8 m cells) for runtime; the seam and physics/render
  guarantees are separately verified at the production 2 m resolution.
- Critical-review scorecard — the recon's critic thread died on an API error and
  returned nothing, so no independent review was obtained. The §44 scorecard is
  not filled in, and should not be filled in by the author of the code.
- Asset inventory changes — Raid ships no assets.
- `docs/raid/PERFORMANCE.md`, and updates to the root `README.md`,
  `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/QA_REPORT.md`,
  `docs/gauntlet-progress.html`, `CREDITS.md`, `THIRD_PARTY_NOTICES.md` — all
  deferred until there is a playable mode to describe. Editing them now would
  advertise a discipline that cannot be launched.

## Not done, as instructed

Nothing was pushed. Nothing was deployed. The GitHub Pages build is untouched.
The development flag remains in place. No other mode was altered to make this
report look cleaner.
