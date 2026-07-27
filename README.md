# Kaki Rally

**Race it. Draw it. Wreck it.**

[Play Kaki Rally](https://dknos.github.io/kaki-rally/) ·
[Source project](https://github.com/dknos/Kaki-Survivors-2) ·
[Report a bug](https://github.com/dknos/kaki-rally/issues)

![Kaki Rally on Borrowed Post Switchback](assets/screenshots/kaki-rally-forest-chase.png)

Kaki Rally is the complete standalone home for the racing games originally
built inside Kaki-Survivors-2. It preserves the authored handling, fixed-step
physics, courses, vehicles, camera rigs, records, track-code formats, ghosts,
destruction systems, and renderer abstraction while removing the Survivors
combat runtime from the production dependency graph.

## Modes

| Mode | What is preserved |
| --- | --- |
| **Off-Road GP** | Circuit racing, six venues, AI grids, laps, checkpoints, damage, repairs, ramps, shortcuts, surface handling, and three camera rigs |
| **Drift Attack** | Charged drifting, independent drift handling, mini-turbo release, 90-second scoring, combos, and per-course records |
| **Kaki Stock Cup** | Oval configurations, up to 16 cars, drafting, pack impacts, visible damage, smoke, and repairs |
| **Draw Your Track** | Mouse/touch/controller editor, four sizes and widths, repair tools, overpasses, AI paths, checkpoints, respawns, jumps, reverse, mirror, night, themes, gallery, and KDT1/KDT2 codes |
| **Monster Smash** | Smashdown, Freestyle, Free Ride, five-round progression, crush/collapse systems, stunts, wreck chains, Zoomies, route ghosts, and Mighty Meowster, Cyber Kaki, and Tipsy Tumbler |
| **Kaki Trials** | Three point-to-point courses, real gaps, pitch control, turbo heat, checkpoints, destruction, medals, unlocks, and validated personal-best ghosts |
| **Kaki Catastrophe · Beta** | WebGL beta with Rapier physics, Pawprint Interchange traffic, chain reactions, Kaki Boom, damage, debris, replay cameras, slow motion, records, and quality budgets |

The six rally venues are **Borrowed Post Switchback**, **Nobody’s Turn**,
**Kiln-Shift Circuit**, **Quiet Toll Run**, **Glass Mile**, and
**Chalkline Loop**.

Rally, drift, stock, and generated Draw Track courses use the Terra-STL grass
system: deterministic carpet and emergent clumps, venue-specific palettes,
road-cleared placement, distance thinning, and tip-weighted wind. The same TSL
material runs on WebGL and WebGPU; display quality scales the instance budget,
and reduced-motion disables wind without removing the landscape layer.

## Controls

Keyboard and gamepad controls are remappable through the browser/OS input
layer; touch controls appear automatically on coarse-pointer devices.

| Context | Keyboard |
| --- | --- |
| Rally / Drift / Stock | `W`/`S` throttle and brake, `A`/`D` steer, `Shift` drift, `Space` handbrake, on-screen camera selector |
| Monster Smash | `W`/`S` drive and air trim, `A`/`D` steer and air trim, hold `Shift` for Zoomies/flips, `Space` handbrake, `R` recover, `F` refill in Free Ride |
| Kaki Trials | `W` throttle, `S` brake/reverse, `A` nose up, `D` nose down, `Shift` turbo, `Space` restart from checkpoint |
| Kaki Catastrophe | `W`/`S` gas/brake, `A`/`D` steer, `Space` handbrake, `B` look back, `V` recenter |
| Draw Your Track | Draw with pointer/touch, use the labeled workshop tools, hold `Space` to pan; controller moves the workshop cursor and activates with the primary button |
| Everywhere | `Escape` / gamepad B pauses, backs out, or returns to the Kaki Rally menu |

## Renderer support

WebGL 2 is the stable default. WebGPU remains selectable and is exercised by
the browser matrix for every production mode except Catastrophe.

- Force WebGL: `?renderer=webgl`
- Request WebGPU: `?renderer=webgpu`
- Deep link: `?mode=monster`, `?mode=trials`, `?mode=draw`, and so on
- Deep link and launch immediately: add `&play=1`

If WebGPU initialization fails, Kaki Rally rebuilds the canvas with WebGL and
shows the fallback in renderer diagnostics. Kaki Catastrophe is intentionally
WebGL-only today: its WebGPU card explains the restriction and offers
**Restart in WebGL**, preserving the selected mode through reload.

## Saves and portability

Kaki Rally continues to read and write the original local-storage keys:

```text
kks_rally_best_v1
kks_draw_tracks_v1
kks_monster_records_v1
kks_rally_trials_v1
kks_kaki_catastrophe_records_v1
```

Nothing is silently deleted or converted. Existing Draw Track libraries and
KDT1/KDT2 codes remain readable. The Records screen can export all rally data
as a single JSON file, import it with an automatic backup, or separately reset
records, Draw Track creations, or all progress. Every destructive reset
requires confirmation.

## Local development

Requires Node.js 20 or newer.

```bash
npm ci
npm run serve
```

Open `http://127.0.0.1:4173/`. The game is intentionally bundler-free, so the
same relative files run locally and under `/kaki-rally/` on GitHub Pages.

## Validation

```bash
npm test                    # deterministic renderer, racing, boundary, save, and asset suites
npm run test:browser        # full WebGL/WebGPU interaction matrix
npm run qa:performance      # warmed ten-session lifecycle/leak benchmark
npm run assets:inventory    # regenerate path/size/SHA-256 inventory
npm run vendor:check        # verify the focused Three.js runtime closure
npm run test:production-assets -- https://dknos.github.io/kaki-rally/
```

The checked-in evidence is in [docs/QA_REPORT.md](docs/QA_REPORT.md),
[docs/PERFORMANCE.md](docs/PERFORMANCE.md), and `docs/qa/`. Browser automation
uses emulated touch and the Gamepad API; physical-phone thermals, frame pacing,
and individual controller mappings still require human hardware review.

## Screenshots

| Draw Your Track | Monster Smash |
| --- | --- |
| ![Draw Your Track workshop](assets/screenshots/draw-your-track-workshop.png) | ![Monster Smash arena](assets/screenshots/monster-smash-arena-chase.png) |

![Kaki Trials side-scrolling course](assets/screenshots/kaki-trials-side-scroll.png)

## Project and licenses

Kaki Rally was extracted from
[Kaki-Survivors-2](https://github.com/dknos/Kaki-Survivors-2) at the exact
commit recorded in [SOURCE_BASELINE.md](SOURCE_BASELINE.md). Code is MIT
licensed. Third-party and generated-asset provenance is preserved in
[CREDITS.md](CREDITS.md); those assets retain their own licenses.

Architecture and safe upstream-sync instructions are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/UPSTREAM_SYNC.md](docs/UPSTREAM_SYNC.md).
