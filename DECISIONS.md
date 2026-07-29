# Kaki Rally production decisions

## 2026-07-28 — Six production pillars

Kaki Rally's production navigation contains Off-Road GP, Drift Attack, Kaki
Stock Cup, Circuit Workshop, Monster Smash, and Kaki Trials. Kaki Catastrophe
is a frozen experiment, not a seventh release mode.

Catastrophe remains source-compatible for a future extraction. It is available
only from localhost with `?dev=catastrophe`, remains WebGL-only, and has
separate opt-in Node/browser commands. The ordinary module graph, menu,
standard asset manifest, and default tests do not load it or Rapier.

## 2026-07-28 — Handling architecture

The browser rebuild retains distinct deterministic models for circuit racing,
Monster Smash, and 2.5D Trials. The Godot/Jolt handling rebuild is a tuning and
contact-model reference, not authorization to replace the browser physics with
a rigid-body engine.

Directional steering remains centralized at the existing racing input
boundary. Behavioral tests must assert yaw and lateral displacement for each
input family and camera, not merely inspect a sign constant.

## 2026-07-28 — Visual direction

The menu and Course Workshop establish the product identity: illustrated Kaki
motorsport interpreted as a tactile working paddock. Racing UI uses compact
timing-board typography, enamel/paint colors, and track-marshalling motion.
The signature element is the venue intro board physically clearing the racing
line into a compact header. Racing environments must carry that identity
through authored silhouettes, layered depth, surface response, and restrained
effects rather than generic dark panels or permanent screen distortion.

## 2026-07-29 — Editable handling data, not one universal vehicle

Off-Road GP, Drift Attack, and Stock Cup share the deterministic circuit
integrator but select editable handling profiles for acceleration curve,
braking, rolling/aero/off-road resistance, steering response, lateral grip,
slip recovery, drift tendency, weight transfer, jump response, and damage
sensitivity. Drift scoring and charge/heat remain mode-owned; Stock drafting,
pack contact, and recovery remain mode-owned.

Monster Smash keeps its deterministic four-wheel contact model and now adds a
torque curve, gears/final drive, swept lower/forward tire contact, persistent
suspension state, and a torque-limited grounded snag correction. Trials keeps
its dedicated 2.5D front/rear contact model. Shared telemetry and presentation
do not imply shared physics.

## 2026-07-29 — KDT3 elevation is a bounded optional extension

Course elevation and banking are encoded only in an optional KDT3 `e`
extension. KDT1, KDT2, and KDT3 payloads without that extension remain flat
and retain their existing decode behavior. The runtime uses the same sanitized
sparse profile for visible road, surface height, pitch/bank, AI, checkpoints,
respawns, bridge clearance, camera clearance, and feature compatibility.

This additive representation was chosen to preserve old tracks and stable
crossing/feature anchors while keeping Colossal authoring bounded. Reverse
flips banking direction; invalid values are clamped or rejected at the storage
boundary.

## 2026-07-29 — WebGL remains default after physical validation

Native Windows Chrome on the RTX 5080 passed the 25-session 1080p lifecycle and
10-session 5120×1440 Ultra run with a 59.17 FPS minimum 1% low and exact
resource-count return after exit. WebGPU passed the six production-mode browser
smoke and fallback contract, but remains explicit opt-in until equivalent
physical, recovery, and device-matrix evidence justifies changing the default.

Headless Chrome was synchronized near 60 Hz. These results establish the
60 FPS floor, not the aspirational 120 FPS target or physical-phone behavior.

## 2026-07-29 — Production pack LOD preserves identity

Stock's 16-car field uses showcase geometry for camera-critical cars and a
shared production pack tier for the remaining field. Pack cars retain unique
paint, number, Kaki badge, driver color, cockpit silhouette, animated wheels,
smoke, sparks, and damage state. Sub-pixel fenders, cage bars, lamps, hubs, and
individual shadow-casting trim are omitted outside showcase distance. This
reduced the audited worst Stock view from roughly 870 to 457 draw calls without
making the field visually anonymous.

## 2026-07-29 — No new third-party production assets

The definitive pass builds on the already licensed vehicle, arena, environment,
Workshop, and audio sources. New road/terrain layers, silhouettes, editor
overlays, HUD treatment, suspension/contact presentation, and effects are
procedural or code-authored. No raw generated raster was introduced as a 3D
environment and no unreviewed third-party model was added.
