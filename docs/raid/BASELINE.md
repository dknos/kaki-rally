# Kaki Rally Raid — frozen baseline

Recorded before any Raid code was written, so that every later claim about
"nothing else changed" is measured against something real rather than assumed.

## Provenance

| Field | Value |
| --- | --- |
| Baseline commit | `632efaf25274c41a453c739485f1225f6ed22449` — *Scale menu and HUD chrome with stage size* |
| Branch | `main` |
| Working tree at baseline | 3 untracked files: `docs/qa/kaki-rally-ui-{1280,1920,2560}.png`. Everything tracked was clean. |
| Node | v22.22.1 |
| Platform | Linux 6.6.87.2-microsoft-standard-WSL2 |
| Working clone | `~/kaki-rally-claudec`, a full copy of `~/kaki-rally` including `.git`. Raid work never edits the shared tree; changes return as a patch or PR, never as an in-place edit. |

## Baseline test results

Run on the untouched clone before any source change.

| Command | Result |
| --- | --- |
| `npm test` | **PASS** (exit 0) |
| `npm run test:browser:webgl` | **FAIL** (exit 1) — see *Pre-existing defects* |

`npm test` covers `test:renderer`, `test:racing`, `test:standalone` and
`test:assets`: 30 visual configurations / 585 assertions, 88 lifecycle
assertions, 116 runtime modules and 321 import edges in the boundary walk, 73
local assets / 26.26 MiB / 1549 asset assertions, and an inventory of 123 files
/ 62.48 MiB.

### Pre-existing defects that predate Raid

**`npm run test:browser:webgl` fails on the untouched baseline.**

```
AssertionError: mobile Trials Workshop hid too much terrain:
{"x":5.52,"y":84.64,"width":832.96,"height":132.48, ...}
  at runWorkshopResponsive (tools/smoke-rally-browser-matrix.mjs:392:5)
  at async runWebGl (tools/smoke-rally-browser-matrix.mjs:2306:5)
```

This is a Trials Workshop responsive-layout assertion in the mobile viewport. It
is **not fixed here** and must not be: repairing it would mean editing frozen
code and would contaminate the isolation proof. It is recorded so that a later
run of the browser matrix is compared against a failing baseline, not a
presumed-green one.

Consequence: the WebGL browser matrix cannot currently be used as a pass/fail
gate for Raid. Raid's own browser verification has to be scoped so it does not
depend on this assertion.

## Production modes at baseline

Off-Road GP · Drift Attack · Kaki Stock Cup · Draw Your Track · Monster Smash ·
Kaki Dune Run · Kaki Trials.

Kaki Catastrophe is a frozen experiment reachable only from
`?mode=crash&dev=catastrophe` on localhost.

**Kaki Dune Run already contains an embedded Rally Raid experiment**
(`src/racing/dunes/duneRallyRaid.js`, 869 lines) with its own menu card titled
"Kaki Rally Raid", four dune events (`raid-prologue`, `raid-wadi-crossing`,
`raid-saltline`, `raid-night-ridge`), a vehicle fleet, CAP calls, penalties and
a service plan. It rides entirely inside `raceMode: 'dunes'`.

It is **frozen**. The new discipline does not extend it, import it, rename it,
or remove its card. The two are distinguished by internal id (`dunes` vs
`raid`), storage namespace, and source root. Naming collisions were checked
exhaustively before adopting the new names — see *Namespaces* below.

## Storage keys at baseline

Exact-match lists in `src/app/rallySave.js`; no code performs prefix or glob
key deletion, so a new namespace cannot be caught by an existing reset.

```
kks_rally_best_v1              kks_draw_tracks_v1
kks_monster_records_v1         kks_dune_records_v1
kks_rally_raid_progress_v1     kks_rally_trials_v1
kks_kaki_catastrophe_records_v1
kaki_rally_settings_v1         kaki_rally_import_backup_v1
kks_racing_camera_mode_v1      kks_rally_trials_courses_v1
kkSelectiveBloomIntensity
```

## Namespaces claimed by the new discipline

| Concern | Value | Collision check |
| --- | --- | --- |
| Internal mode id | `raid` | No existing `raceMode` or route alias used it. |
| Source root | `src/racing/raid/` | New directory. |
| Asset root | `assets/racing/raid/` | New directory. |
| Storage prefix | `kks_raid_` | Disjoint from `kks_rally_raid_` (the embedded experiment) and from every key above. Asserted in both directions by the isolation test. |
| CSS prefix | `kkr-` | Not used anywhere in the existing tree. |
| Deep link | `?mode=raid&play=1&dev=1` | `dev=1` is distinct from the existing `dev=catastrophe`. |

## Resource ownership contract at baseline

The shell (`src/app/rallyApp.js`) owns the canvas, renderer, scene, the single
`requestAnimationFrame` loop, pause, renderer recovery, navigation and input
sampling. A mode receives `enterRacing` / `tickRacing` / `updateRacingCamera` /
`resizeRacingCamera` / `getRacingCameraConfig` / `getRacingSnapshot` /
`restartRacing` / `exitRacing` and owns only its own resources.

Session roots are matched by `/^kaki-(rally|trials|dunes|catastrophe)-/` in
`rallyApp.js:116`. A Raid root would need that regex extended before it appears
in the shell's session-root diagnostics.

## Frozen boundary

`docs/raid/FROZEN_BOUNDARIES.json` records a SHA-256 digest for **150 files**
across `src/app`, `src/core`, `src/racing/cameras`, `src/racing/crash`,
`src/racing/drift`, `src/racing/dunes`, `src/rendering` and the individually
listed racing modules. `npm run raid:boundaries -- --check` fails the wave if
any of them changes.

Seven files are declared as permitted seams, each with the reason an adapter
cannot avoid the edit. Of those seven, **four have actually been touched**:

| Seam | Touched | Change |
| --- | --- | --- |
| `src/racing/index.js` | yes | `_raidModeApi` registration + 9 dispatch branches, mirroring `_crashModeApi` exactly. +23 lines. |
| `src/racing/racingModeAvailability.js` | yes | Additive `raid` branch. Without it the default returns AVAILABLE for every unknown id and Raid would be publicly launchable. +23 lines. |
| `src/app/rallyRouter.js` | yes | `raid`/`expedition` aliases, `raidDevelopment` flag, and a fix so the two development flags cannot cancel each other. +30 −4. |
| `package.json` | yes | `test:raid`, `raid:boundaries`; `test` extended. No existing script weakened. |
| `src/app/rallyApp.js` | no | Not needed until a Raid mode entry point exists. |
| `src/app/rallySave.js` | no | Not needed until Raid autosaves. |
| `src/racing/racingManifest.js` | no | Not needed until Raid ships assets. |

Total shared-file change: **76 insertions, 6 deletions across 4 files.**

### A router bug found and fixed while adding the seam

`routeUrl()` deleted the `dev` query parameter whenever
`catastropheDevelopment === false`, and `restartInWebGL(mode)` passed
`catastropheDevelopment: mode === 'crash'`. Restarting any non-Catastrophe
development mode into WebGL would therefore have stripped its development flag
and bounced the player back to the menu. Both flags now only clear `dev` when
the other is not asking for it, and both restart paths are asserted
behaviourally in `tools/smoke-raid-isolation.mjs`.

## Merge-back path

This clone is isolated. To contribute back to `~/kaki-rally`, produce a patch
(`git format-patch` / `git diff`) or open a PR. Never edit the shared tree in
place — another agent may be working in it.
