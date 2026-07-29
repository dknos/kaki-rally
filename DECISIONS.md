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
