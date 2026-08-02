# Kaki Rally world-asset placeholder audit (Phase 1)

**Wave:** `feat/kaki-world-asset-overhaul`  
**Base commit:** `c746cc7`  
**Date:** 2026-08-02  
**Method:** seven parallel source audits, each required to verify claims by reading
code on disk rather than commit history. Findings below were spot-checked by hand
against the named files before any fix was written.

## Summary

- Objects examined: **76**
- Class A (invisible collision proxy, not a defect): **5**
- Class B (intentional stylised geometry, acceptable): **23**
- Class C (adequate distant LOD, acceptable): **5**
- Class D (**unacceptable visible placeholder**): **43**

Class-D breakdown by priority:

| Priority | Count | Meaning |
| --- | --- | --- |
| P0 | 4 | dominates the scene or visibly breaks immersion |
| P1 | 18 | frequently visible during normal driving |
| P2 | 19 | secondary dressing or polish |
| P3 | 2 | distant or optional detail |

The wave commits to clearing every P0 and P1.

## Headline finding: the biggest wins are bugs, not missing art

The audit's most important result is that several of the worst player-visible
problems are not "we never authored that asset". They are defects that hide or
misplace art the project **already ships**. Four of them were confirmed by hand:

1. **Drift Attack judging zones never appear on the route.** `freezeZone`
   (`src/racing/drift/driftAttack.js:24`) emits `kind` / `from` / `to`, but
   `src/racing/racingEnvironment.js:1213` reads `zone.fraction` and `zone.type`.
   Both are `undefined`, so `_sampleAtFraction(samples, undefined)` resolves to
   index 0 and every marker of every layout stacks on the start line. The HUD
   reads `0/4 ZONES`. This is the entire visual identity of the mode.

2. **~370 lines of Trials theme dressing are unreachable.**
   `src/racing/trialsEnvironment.js:1227` branches on `if (session.assetLease?.ready)`,
   but `ready` is always `Promise.all(...)` (`src/racing/racingAssets.js:144`), which
   is always truthy. The `else` arms holding `_addMeadowStory`, `_addQuarryStory` and
   `_addCrownStory` are dead whenever a lease exists, which is always. Windmills with
   animated rotors, cat pennants, quarry spires, glowmoss crystals, floating islands
   and cloudway ribbons are all authored and none of them render.

3. **28% of the course workshop kit is permanently invisible.**
   `assets/racing/workshop/kaki-course-workshop-kit-v1.glb` was post-processed with
   `EXT_mesh_gpu_instancing`, which hoisted 29 unnamed instanced nodes to the glTF
   scene root and detached them from their `feature_*` / `bridge_*` parents.
   `courseFeatureRuntime.js` only clones subtrees found via
   `scene.getObjectByName(feature.assetNode)`, so 39,570 of 141,221 triangles are
   never rendered. This affects every Draw Your Track course and every Trials
   Workshop custom track.

4. **Monster Smash asks the player to smash invisible targets.** Once
   `arenaTrafficKit` attaches, 13 crushable haybale and stuntman targets stop
   rendering while still colliding and still awarding score.

Fixing these costs little and needs almost no new art. Items 1 and 3 in particular
reuse kits that are **already leased**, so they need no manifest change at all.

## Notable negative result: scenery placement is clean

The Off-Road GP audit reimplemented `_distanceSqToTrack2D`, `_acceptTracksideSite`,
`_makeScatterSites` and `_makeDressingSites` offline and swept every authored prop's
real GLB bounding box against all six courses. **Zero props cross the road edge.**
Tightest margin in the game is a single accent boulder in Quiet Toll Run at 0.24 m
outside the road edge.

Two structural risks were noted even though nothing currently intersects:
`_buildAuthoredBiomeScatter` applies a lateral push *after* `_acceptTracksideSite`
has already validated the site, and the accent slot is biome-asymmetric (cinder,
void and cave get a 3.42 m rock blob where other biomes get sub-metre plants).
Cheap hardening is to re-validate the pushed position against the prop's own
footprint radius.

## Per-area state

### src/racing/dunes/ and src/racing/raid/ (Kaki Dune Run: Whiskerwind Circuit, Sunspine Ridge Run, Mirage Mile, Big Litterbox; Kaki Rally Raid)

6 examined, 2 class-D.

> WHAT I READ (all verified on disk at HEAD c746cc7, not from commit history):
>
> - Full: src/racing/dunes/duneEnvironment.js (465 lines), src/racing/raid/raidEnvironment.js (383 lines), tools/blender/build-kaki-dune-environment-kit.py (590 lines, targeted sections).
>
> - Grepped for scene-graph adds and geometry/material construction across all 30 files in src/racing/dunes/ and src/racing/raid/ (13111 lines).
>
> - Parsed both GLB kits binary-directly with a custom glTF JSON-chunk reader: node hierarchy, per-mesh tri counts, material assignment per primitive, and world-space bounding boxes composed through the node TRS chain.
>
> - Ran src/racing/dunes/duneEvents.js in node (it is pure JS, no three dependency) to compute real route samples for all 8 dune-runtime courses and measure actual distances from the racing line to scenery placements.
>
> METHOD NOTE -- why I did not flag on materials: both kits report images:0, textures:0. Every material in BOTH the dune and raid kits is a flat baseColorFactor with per-material roughness/metallic. Applied literally, a "flat colour = placeholder" test would flag the entire raid kit, which the task states is already fixed -- and my node dump proves it is genuinely authored. Untextured flat-shaded PBR with paired sun/shade materials is the deliberate house style here. So I classified on FORM and SILHOUETTE only: a piece is D only when its shape fails to read as the thing it depicts, judged against the authoring level of its neighbours in the same kit.
>
> OVERALL STATE:
>
> - src/racing/raid/ is CLEAN. Commit 46d6f7e did real work and it is on disk. 26 authored prototypes, 232-3524 tris each, coherent multi-material stratification, all references resolve. Nothing to re-report. The only primitives are the terrain patch and VFX billboards.
>
> - src/racing/dunes/ is MOSTLY authored -- 15 kit prototypes, of which 13 have genuine authored form (icosphere rock spires and arch, curve-swept palm and scrub foliage, a cat-ear rally gate with paw pad, a hand-built tensioned canopy, triangular flag cloth). Two prototypes were never authored past primitive blockout: the mesa and the wreck. That is the whole defect list: 2 D findings out of ~25 prototypes across both areas.
>
> - duneMode.js (1394 lines, the largest file in the area) constructs NO geometry at all -- grep for Geometry/Mesh/Material/Sprite/CanvasTexture returns nothing. All dune visuals come from the kit, duneClipmap/duneMaterial, and the dust/rooster-tail VFX. duneMaterial.js is a real node material sampling height, coarse/recent deformation offset and compaction, plus a repeating detail texture. Not a placeholder.
>
> THREE ADJACENT GAPS I FOUND BUT AM NOT REPORTING AS PLACEHOLDER DEFECTS (they are different bug classes, flagging so they are not lost):
>
> 1. No dune scenery has collision. duneVehiclePhysics.js declares obstacleContact at line 222 and resets it to false at line 418, but nothing ever sets it true, and no code consumes the collision_proxy flag beyond hiding the mesh. The arch's authored _COLLIDER box is therefore dead weight, and the wreck -- which overlaps the driveable corridor on Mirage Mile and sits 4 m inside it on Big Litterbox -- is drive-through. This is why I set collisionRequired:true on both D findings: whatever replaces them should be solid.
>
> 2. RaidMarker-0 is fully authored in the raid kit (336-tri cairn + notched post + painted accent, described in tools/blender/raid_kit/plant.py:689) but is referenced by NOTHING in raidEnvironment.js -- it is in neither SURFACE_SCATTER nor LANDMARK_ASSETS. raidMode.js adds only the terrain patch, scatter root, sun/sky, vehicle, camera, dust and trails, so streamed Raid draws no route markers at all. Authored-but-unwired content gap, not a placeholder.
>
> 3. Dunes has no equivalent of raid's LANDMARK_VISIBLE_HALF_EXTENT guard (raidEnvironment.js:135, added by 80e1236). The dune sky shell radius is min(620, max(420, worldSize*0.65)) and is recentred on the kart each frame, while mesas sit at a fixed worldSize*0.48 from world origin -- on Mirage Mile a mesa can be ~937 m from the kart, so instances falling between 620 m and the 800 m camera far plane draw outside the sky shell. Same bug class 80e1236 fixed for raid. Rendering issue, out of scope for a placeholder audit.
>

### Drift Attack / Whisker Yard layouts and Kaki Stock Cup / Thunderbowl (concrete + clay)

10 examined, 10 class-D.

> WHAT I READ (all verified on disk at HEAD c746cc7, not from commit history): src/racing/racingEnvironment.js in full (1502 lines; `_buildDisciplineVenue` 1201-1309 is the only venue-specific presentation code for either mode, plus `_buildCurbsAndRails` 733-791 and `_buildInfrastructure` 1100-1189 which both branch on stock); src/racing/tracks.js in full (STOCK_VARIANTS, STOCK_POINTS, getCourseDefinition stock/drift branches); src/racing/drift/driftAttack.js in full (DRIFT_LAYOUTS, freezeZone, judge); src/racing/index.js `_buildCourse` 432-522, `_buildFeaturePads` 324-388, `_buildSamples` 264-281, `_featureGroundAt`, lease creation 2832; src/racing/drawTrackGeneration.js `applyElevation` 41-80; src/racing/racingAssets.js and racingManifest.js in full; src/racing/courseFeatureCatalog.js scenery entries. I also dumped the glTF JSON node/mesh/material tables of kaki-rally-environment-kit-v2.glb, kaki-course-workshop-kit-v1.glb, monster-arena-environment-kit-v1.glb and arena-audience-bank-v1.glb, and read the three QA screenshots in docs/qa/targeted/webgl-stock/ and docs/qa/targeted/webgl-drift/ to confirm what is actually on screen.
>
> STATE OF THE AREA. Neither venue has any authored geometry. `_buildDisciplineVenue` is 108 lines of `new THREE.BoxGeometry` / `CylinderGeometry` / `ConeGeometry` / `SphereGeometry` on flat-colour MeshStandardMaterials — not one `map`, `normalMap` or `roughnessMap` in the whole function. It does not even receive `assetLease` as a parameter, so it structurally cannot use authored art. This is not a case of "the assets don't exist yet": `courseWorkshopKit` (assets/racing/workshop/kaki-course-workshop-kit-v1.glb) is leased for EVERY rally course via RALLY_COURSE_ASSETS, including drift (art course `twilight`) and stock, and its scene root contains `feature_drift_zone`, `feature_floodlights`, `feature_grandstand`, `feature_crowd`, `feature_billboard`, `feature_repair_bay`, `feature_boost_pad`, `feature_tire_wall`, `feature_cone_chicane`, `feature_flags` with authored materials. Both venues download and pay memory for that kit and use exactly none of it — it is only wired up for Draw Your Track (index.js:483-492, gated on `course.mode === 'draw'`). Six of my ten findings are therefore zero-manifest-change swaps.
>
> REPLACEMENT COST SPLIT, for triage:
>
> - Already leased, no manifest change: feature_drift_zone, feature_floodlights, feature_grandstand, feature_crowd, feature_repair_bay, feature_boost_pad, feature_small_kicker/feature_large_launch, feature_billboard, bridge_guardrail_module.
>
> - Needs a NEW manifest entry in racingManifest.js: ArenaKit_GrandstandBay_Mesh, ArenaKit_LightTower_Mesh, ArenaKit_ScoreboardFrame_Mesh, ArenaKit_Guardrail_Mesh, ArenaKit_ConcreteBarrier_Mesh, ArenaKit_Cone_Mesh (all in monster-arena-environment-kit-v1.glb, single shared Arena_Palette_PBR material, currently only leased in monster mode).
>
> Watch footprints on any swap: feature_grandstand is [15, 8, 8] against the current 6.8 x 2.3 x 3.1 box at `halfWidth + 10.5`, so a naive swap will crowd the track.
>
> SEPARATE OBSERVATION — NOT IN findings, different defect class (transform/placement, not placeholder geometry). Reporting it here so it isn't lost, and because two of the four items live in shared code that another area's audit owns. The Thunderbowl runs a real 27-degree bank: tracks.js:44 sets `bankProfile.corner = -0.47` rad, `applyElevation` (drawTrackGeneration.js:50) writes it to `sample.bank`, `_ribbonGeometry` (racingEnvironment.js:213-219) tilts the road/shoulder/basin by `tan(bank) * lateralOffset`, and `_featureGroundAt` applies the identical `Math.tan(roadSample.bank) * lateralOffset` to the car, so the vehicle genuinely drives the tilt. Nothing else in the scene knows about it:
>
> (1) There is no bowl. `_terrainGeometry` pins the ground to `routeHeight - 0.26` = a flat -0.26 m within `trackWidth * 0.62 + 2.4` = 11.6 m of centre (stock has no elevationProfile, so authoredElevation is 0). At the corners the basin ribbon reaches +/-5.2 m at its 10.3 m half-width. So half the banked track floats ~5 m above a flat plane with a void underneath, and the other half is submerged inside the terrain mesh — the low groove puts car and camera under a solid receive-shadow ground plane.
>
> (2) Curbs and guardrails (`_buildCurbsAndRails` lines 745-768) use `sample.y + 0.24 / 0.86 / 1.16` with no bank term and no roll rotation, so they detach from the track edge on every corner. Directly visible in webgl-stock-pack.png as a line of yellow and red bars floating out on the dark terrain, and in webgl-stock.png bottom-right.
>
> (3) The ceremonial start gate (`_buildInfrastructure` line 1103-1138) spans +/-`trackWidth * 0.62` = +/-9.2 m at y = 0 and is placed on samples[0], which for the stock oval is a corner (bank -0.47) — one leg ends up ~4.7 m airborne and the other ~4.7 m underground. webgl-stock-pack.png shows it as a single curving leg with no second foot.
>
> (4) The checkered finish plane (line 1145-1149) is a flat PlaneGeometry at y + 0.125, so it sits detached from the banked surface it is supposed to be painted on — also visible in webgl-stock-pack.png.
>
> Items (3) and (4) are in `_buildInfrastructure`, which is shared by all circuit modes; whoever audits the shared rally environment should own those. Items (1) and (2) are Thunderbowl-specific. I left the clay cushion in `findings` despite overlapping this cluster because it is a placeholder shape independently of the bank, but its replacement must be bank-aware.
>
> ONE MORE THING WORTH A LOOK, not filed as a finding. Both venues run the shared biome scatter (`_makeScatterSites` places props on BOTH sides at `halfWidth + 13.5..` from the centreline), which for the Thunderbowl means the oval's infield gets filled with the base chapter's trees, rock spires and glow crystals — webgl-stock.png (cinder-based clay variant) shows glowing orange crystals and dead trees ringing a concrete short oval. The props themselves are authored kit pieces (classification B/C, not placeholders), so this is an art-direction mismatch rather than a placeholder defect, but a stadium infield probably wants suppression or a venue-specific dressing set.
>

### Monster Smash — src/racing/monsterArena.js + src/racing/monsterDestruction.js

15 examined, 7 class-D.

> WHAT I READ (all verified against current disk state on HEAD c746cc7, not commit history): src/racing/monsterArena.js in full (1547 lines), src/racing/monsterDestruction.js in full (1685 lines), plus the call sites and data needed to decide visibility — src/racing/index.js:2655-2990, src/racing/racingManifest.js:100-145, src/racing/monsterArenaDefinition.js (bounds, dressing, targets, domino run generation), src/racing/monsterDestructionRules.js MONSTER_TARGET_CLASSES, src/app/rallyMenu.js:407-420. I also parsed the three GLBs directly (JSON chunk node/material/accessor data) and stat'd every texture URL in the manifest.
>
> THE ONE FACT THAT DRIVES MOST OF THIS AREA: default play never runs attachMonsterEnvironmentKit. session.monsterProductionAssets is true only when options.monsterProductionAssets === true or ?monsterAssets=full is in the URL (index.js:2727-2731), and grepping the whole tree shows NO caller ever passes that option — rallyMenu only passes monsterArena / monsterEvent / monsterVehicle. So ordinary play always takes attachMonsterStoryDressing, which instances 12 of the 21 modules in monster-arena-environment-kit-v1.glb and hides only the freestyle containers. The other 9 modules (ConcreteBarrier, Guardrail, FencePanel, GrandstandBay, LightTower, ScoreboardFrame, BrokenBarrier, ExteriorTree, EventTent) are downloaded, parsed and sitting in memory unused, while the procedural primitives they were authored to replace stay on screen. Five of my seven D findings are that single gap; fixing them costs no additional download.
>
> ASSET STATE IS HEALTHY, which is why I found no missing-texture P0: all 10 monster textures resolve on disk (crowd cards, VFX atlas, dirt colour/normal/roughness/macro, ground decals, backdrop, key art, truck decal), all 3 GLBs exist, and every ArenaTraffic_* / ArenaKit_* node name referenced in code resolves in its GLB. The terrain, ramps, decals and horizon are genuinely authored and textured.
>
> THE P0 IS A COVERAGE HOLE, NOT A MISSING ASSET: MONSTER_TARGET_CLASSES has 11 kinds, TRAFFIC_MODEL_NAMES has 9. Running the definition module gives pileup-pyramid-yard = {pickup 21, wagon 34, sedan 31, crown 1, bus 8, van 12, rv 2, haybale 8, stuntman 5}. The 13 haybale/stuntman targets never get visualInstances, yet bodies/roofs/canopies are hidden globally — and they are not background props, they are the FLAMING BALE TUNNEL (x=±6.2, z=-8..4.3) and the STUNT TEAM WIPEOUT line (z≈31-34), both named signature scoring features straddling the main launch lane out of the (0,-54) spawn. Crown Chaos is unaffected (no haybale/stuntman).
>
> GAMEPLAY CONTRACTS — nothing I flagged can break them. Collision and scoring for every crushable read MONSTER_TARGET_CLASSES stats through monsterOrientedMotionSweep / evaluateMonsterTargetImpact, never mesh geometry, so all of these are pure presentation (collisionRequired false everywhere except the P0, where the target must stay hittable and already is). Two live contracts to respect when fixing: the pooled wheel 'pop' displacement is driven by axleCrush and is the tell that an axle has been crushed, so shrink or gate it rather than delete it; and the domino pose is authoritative through _syncDominoPose (it writes target.x/y/z/bottom/top/pitch/roll that _findDominoStrike and _resolveDominoBodyContacts consume), so the wheel/bumper fix must read that matrix via _composeDominoPart, never write to it.
>
> ONE ADJACENT ISSUE, DELIBERATELY NOT FILED AS A FINDING because it is a proportion bug rather than placeholder geometry: TRAFFIC_MODEL_DIMENSIONS.crown is {width 2.12, height 2.12, length 3.7} while MONSTER_TARGET_CLASSES.crown is {width 2.45, height 1.7, length 4.55}. The stats/base division at lines 1464-1466 therefore renders the hero crown target at 1.16 × 0.80 × 1.23 — squashed 20% vertically and stretched 23% long. Every other class lands within ~13% (bus worst at 1.128 length). Worth a look by whoever owns the traffic kit; the fix is the dimension table, not the mesh.
>

### Draw Your Track — src/racing/courseFeatureCatalog.js, courseFeatureRuntime.js, drawTrackGeneration.js, drawTrackUI.js (feature-catalog presentation + theme auto-dressing)

17 examined, 17 class-D.

> WHAT I READ (all verified on disk at HEAD c746cc7, not from commit history): all 174 lines of src/racing/courseFeatureCatalog.js, all 565 of src/racing/courseFeatureRuntime.js, all 470 of src/racing/drawTrackGeneration.js, the relevant parts of the 3615-line src/racing/drawTrackUI.js (imports, featureThumbnailStyle/featureCardHtml L184-195, placement rendering L3280-3345), plus src/racing/drawTrackThemes.js (theme auto-dressing), src/racing/index.js:432-522 + 1050-1095, src/racing/tracks.js:234-300, src/racing/courseFeatureSurfaces.js:130-400, src/racing/racingManifest.js, src/racing/racingAssets.js, tools/blender/build-kaki-course-workshop-kit.py (all 948 lines), and I parsed assets/racing/workshop/kaki-course-workshop-kit-v1.glb directly (736 nodes / 583 meshes / 32 materials / 79 scene roots) to diff authored vs shipped node hierarchies. A working copy of the diff table is at /tmp/claude-1000/-home-nemoclaw/13d9da5e-d8ae-4306-802d-beb7d05f2f5b/scratchpad/draw-track-audit-findings.md.
>
> FULL FEATURE ID LIST AND CURRENT VISUAL IMPLEMENTATION (42 catalog entries, all assetId 'courseWorkshopKit', all authored Blender-Python geometry in kaki-course-workshop-kit-v1.glb, no procedural fallback anywhere):
>
> - jumps: small-kicker (feature_small_kicker, 5426 tris, COMPLETE apart from 4 bolts), large-launch-ramp (feature_large_launch, 6052), tabletop (feature_tabletop, 3638), double-jump (feature_double_jump, 11158), roller-bumps (feature_rollers, 1322), step-up (feature_step_up, 5240), step-down (feature_step_down, 5240)
>
> - utilities: boost-pad (feature_boost_pad, 656, complete), repair-bay (feature_repair_bay, 650, complete), checkpoint-gate (feature_checkpoint_gate, 1758, complete), trials-finish-gate (reuses feature_checkpoint_gate), trials-time-bonus (reuses feature_turbo_gate)
>
> - challenges: speed-trap / jump-distance-gate / turbo-gate / trials-style-gate / trials-destruction-gate (gate() variants, 1758 each, complete), drift-zone (feature_drift_zone, 228, complete), crown-jump-ring (feature_crown_ring, 477, complete), precision-landing (feature_landing_zone, 878, complete)
>
> - hazards: mud-patch / deep-gravel / ice-patch / oil-slick / water-splash (flat blob() decals, 18-978 tris, complete), rumble-strip, cone-chicane, barrier-chicane, tire-wall
>
> - destructibles: wooden-crates (1622, complete), hay-bales, barrel-stack, rock-pile (880, complete), toy-cars (5352, complete), kaki-delivery-cart / ore-cart (3660, missing only its badge decal), crown-targets (903, complete), smash-target-chain (1490, complete)
>
> - scenery: direction-signs (226, complete), billboard (1874, complete), floodlights (1080, complete), crowd-section, grandstand, foliage-group, rally-flags (564, complete), construction-equipment (3338, complete), theme-landmark (991, complete)
>
> - bridge kit (not catalog entries, driven by courseFeatureRuntime.buildCourseBridgeVisuals): bridge_deck_module, bridge_guardrail_module, bridge_support_{standard,tall,huge}, bridge_portal_{standard,tall,huge}
>
> NON-DEFECTS I CHECKED AND CLEARED:
>
> - drawTrackGeneration.js TrackMeshBuilder.buildOverpasses (L88-319) is a primitive Box/Capsule/Sphere bridge kit with flat MeshStandardMaterial colours — it is DEAD CODE. index.js:467-476 only calls it when course.mode !== 'draw', and course.overpasses is only ever populated for mode === 'draw' (tracks.js:234-255; no RACE_COURSES entry defines overpasses). bridges.length is always 0 on that path so it returns null before creating anything. Not player-visible; do not spend art time on it, but it is a live trap if anyone ever adds overpasses to a stock course.
>
> - drawTrackUI.js contains zero THREE.js — it is a pure DOM/2D-canvas editor. Feature cards and on-canvas stamps use real 256x192 Blender-rendered thumbnails from a 1792x1152 7x6 atlas. Nothing driving-visible.
>
> - Theme auto-dressing (drawTrackThemes.js compileDrawTrackCourse) emits real catalog placements (small-kicker / large-launch-ramp / tabletop / boost-pad / repair-bay) through the same validator as manual stamps, and deliberately zeroes the legacy rampFractions/boostFractions/repairFractions pads. No primitive fallback. Correct.
>
> - themeStyle()/themedMaterial() (courseFeatureRuntime.js:28-50) recolours materials named variant_paint/trim/structure/emissive per theme. THEME_MATERIALS has no 'dirt' or 'dune' key, but both fall through to industrial via course.id === 'cinder'. Deliberate, classification B.
>
> - Hazard surfaces (mud 18 tris, oil 18, ice 18+6 glints, water 18+6 glints) are intentionally flat road decals with proper PBR roughness/metalness. Classification B, not placeholders.
>
> - 30 of 32 kit materials are untextured flat PBR colour (one shared 4x4 decal atlas). That is the kit's deliberate kawaii art direction, not a missing-texture defect. B.
>
> - Missing-node handling: if a node fails to resolve the runtime records it in diagnostics.missing and draws nothing — there is no grey-box placeholder anywhere in this area. Every D above is missing geometry, not stand-in geometry.
>
> SUB-NOTICEABLE LOSSES FROM THE SAME ROOT CAUSE (rolled up here rather than filed as D, they will be fixed by the same re-export): 26 of 28 ramp bolts (75 mm cylinders) across all seven jumps; the 3 bridge_support_*_support_badge decals; huge_portal_badge; cart_kaki_badge on the delivery cart / ore cart; 2 of 7 large-launch crossbraces.
>
> BLAST RADIUS: this is NOT Draw-only. buildTrialsCourseFeatureVisuals (courseFeatureRuntime.js:513) resolves nodes from the same kit by the same getObjectByName call, so Trials Workshop stamps the identical broken pieces.
>
> CORROBORATION: the editor thumbnail atlas is rendered inside the Blender scene BEFORE the packing step (build script render_thumbnails() runs on the live scene), which is why the palette shows a complete 7-cone chicane, a full tyre wall and a stand full of cats that the game never draws. That mismatch is evidence for the diagnosis, not a separate defect.
>
> CONFIDENCE / UNCERTAINTY: the per-feature name diffs are deterministic and airtight (the builder is a fixed script with no randomness in the affected groups, and the orphan instance counts reconstruct the authored totals exactly). I could NOT find the packing step in the repo — the Blender script exports a plain GLB with export_scene.gltf, so the meshopt/quantization/instancing pass is run out-of-band and is not under version control. I am therefore describing the mechanism from the shipped file's contents, not from a script I read. The one finding derived from arithmetic rather than a name diff is the Skyway tiling-gap item (courseFeatureRuntime.js:376); the 58% coverage figure is analytic and spacing-independent, but I did not render a frame to confirm how objectionable it looks.
>

### src/racing/trialsEnvironment.js + src/racing/trialsMode.js (Trials Meadow / Trials Quarry / Trials Crown)

17 examined, 4 class-D.

> WHAT I READ (all verified on disk at HEAD c746cc7, not from commit history): src/racing/trialsEnvironment.js in full (1305 lines), src/racing/trialsMode.js (build/enter path, obstacle + arch + particle + vehicle construction, session setup), src/racing/trialsTracks.js in full, src/racing/racingAssets.js in full, src/racing/racingManifest.js (TRIALS_COURSE_ASSETS), src/racing/cameras/isometricCameraRig.js + cameraRigMath.js + racingCameraProfile.js for the actual frame math, vendor/three/build/three.core.js:35488 for the ExtrudeGeometry UV generator, and I parsed assets/racing/models/kaki-rally-environment-kit-v2.glb and decoded all three backdrop webps to look at them. There are no tests in this repo and no BoxGeometry anywhere in the Trials files — the team is already past the box-proxy stage here.
>
> THE ROUTING FACT THAT DEFINES WHAT THE VENUES ACTUALLY LOOK LIKE (headline, not a finding row): the three procedural theme-dressing functions _addMeadowStory, _addQuarryStory, _addCrownStory and their shared _addCatPennants are UNREACHABLE in the browser. buildTrialsEnvironment lines 1227-1233 branch on `if (session.assetLease?.ready)` with the procedural stories on the else arms; enterTrialsMode always assigns session.assetLease from createRallyAssetLease before calling buildTrialsEnvironment (trialsMode.js:1565-1575) and that factory always returns an object with a truthy `ready` promise (racingAssets.js:144). So ~370 lines of dressing never ship: windmills with animated rotors, cat pennants, meadow flowers and mochi groves, quarry rockfall/spires/glowmoss crystals/catworks portals, crown roadside crests, floating islands, cloudway ribbons and the cat-pennant "cloud palace". world.rotors is consequently always empty and the rotor animation loop is dead too. Net effect: each venue's midground is ONLY the authored GLB kit — for Meadow that is ~24 trees split across two variants plus ~12 fern clusters over 780 metres, all parked at z -9.4/-5.35 behind the track, with nothing in front of the racing line and nothing above it. That is what makes the venues feel thin, and it is a bigger lever than any single prop swap.
>
> RELATED FRAGILITY: _addAuthoredTrialsStory is fired from `.then()` with a bare `.catch(() => {})` (line 1230) and only adds its group `if (count > 0)` (line 1184). Since the procedural fallback is now unreachable, a failed or slow kaki-rally-environment-kit-v2.glb load silently yields terrain-and-sky only, with zero dressing and no error surfaced to the player.
>
> FRAME COMPOSITION AS IT ACTUALLY RENDERS (ortho side camera, half-height ~10.8-12.2, half-width ~19, camera at vehicle.z+41 with only ~2.1 degrees of downward pitch, so frame spans roughly ground-8.4 to ground+13.2): the bottom ~40-50% is the extruded terrain cross-section — untextured pale earth cap (finding 1), plus the 34% illustrated cutaway overlay, 5-6 strata pinstripes and heptagon inclusions. The top half is the authored backdrop plate under a 16% horizon wash, with unlit white sphere puffs crossing it on crests and airtime. Midground is the thin authored tree line. The turf/trail/shoulder strips are seen almost edge-on and contribute nearly nothing. Nothing in Trials is a collision proxy: physics comes entirely from sampleTrialsGround's height field and obstacle hits are swept against data.x/width/height, so every mesh here is presentation-only and free to change.
>
> DEAD-PIXEL GROUP worth fixing together: painted sky plane (overpainted by the cover-fit backdrop), sun disc + halo (30-45 units above frame top and pinned 48 units right of a 19-unit half-width), and the gap glimmer ribbons (2-8 units below frame bottom at every authored gap). Three atmosphere systems, three textures/materials, zero pixels.
>
> Confidence: high on the ExtrudeGeometry UV finding (confirmed in the vendored source, and the same file scales UVs correctly in two other places). High on the routing/dead-branch and dead-pixel findings (pure control flow and arithmetic). The two cloud rows involve an art judgment — Quarry is objectively wrong (clouds inside a cave), Meadow/Crown is a quality-mismatch call against the painted plates, so treat that one as a recommendation rather than a bug.
>

### src/racing/racingEnvironment.js — Off-Road GP six venues (circuit mode) + everything the module builds

11 examined, 3 class-D.

> WHAT I READ (all verified on disk at HEAD c746cc7, not from commit history): all 1501 lines of src/racing/racingEnvironment.js; src/racing/tracks.js (venue->course-id mapping); src/racing/rallyGrass.js + rallyGrassLayout.js; src/racing/racingAssets.js + racingManifest.js; src/racing/racingVehicles.js:285-345; src/racing/index.js (_buildCourse 432-500, session/lease setup 2820-2900, phase machine); src/racing/drawTrackGeneration.js applyElevation; drawTrackElevation.js sampleElevationProfile. I decoded assets/racing/models/kaki-rally-environment-kit-v2.glb (node names, per-mesh tri counts, per-primitive materials, position-buffer hashes, bboxes) and rendered assets/racing/kaki-rally-decal-atlas-imagegen-v1.webp to confirm it is a 4x4 contact sheet.
>
> VENUE MAP: the six Off-Road GP venues are circuit mode over course ids forest=Borrowed Post Switchback, twilight=Nobody's Turn, cinder=Kiln-Shift Circuit, void=Quiet Toll Run, cave=Glass Mile, kakiland=Chalkline Loop. All six take an identical code path — same profile table, same scatter, same infrastructure. `_buildDisciplineVenue` returns immediately for circuit, and `_buildCurbsAndRails`' stockWall branch (guard posts/rails) never fires. So every D I found in circuit mode is a defect in all six venues at once, and the grandstand row is not in these venues at all.
>
> SCENERY PLACEMENT VS THE RACING LINE — HEADLINE NEGATIVE RESULT, this is clean. I reimplemented `_distanceSqToTrack2D`, `_acceptTracksideSite`, `_makeScatterSites` and `_makeDressingSites` verbatim against samples rebuilt with the real CatmullRomCurve3(points, closed, 'centripetal', 0.4) at 192 samples plus applyElevation's finite-difference normal recompute, then swept each authored prop's actual GLB bounding box (9x9 grid of footprint points, rotated by the instance yaw via three's Euler-Y convention, scaled by the real per-tier factor) against the whole circuit. Result: ZERO props cross the road edge in any of the six venues. Worst-case margins from the road edge — forest 12.59 m primary / 13.08 m accent; twilight 1.68 / 1.63; cinder 3.63 / 0.59; void 6.85 / 0.24; cave 6.79 / 1.93; kakiland 2.45 / 2.85. The tightest instance in the game is a single accent boulder in Quiet Toll Run sitting 0.24 m outside the road edge (it does overhang the shoulder ribbon, which is 1.5 m wider than the road each side). Two structural reasons that margin is thin and could go negative on a future course: (1) `_buildAuthoredBiomeScatter` lines 1018-1027 apply a lateral push AFTER `_acceptTracksideSite` already validated the site — up to 2.5 m for primary-derived accents and +/-0.7 m for dressing accents, none of it re-checked; (2) the accent slot is biome-asymmetric — forest/twilight/kakiland get sub-metre plants (fern/reed/flower, ~0.8 m footprint) but cinder, void and cave all get the 3.42 m-wide rock blob as their accent, against a dressing-site clearance requirement of only max(2.4, scale*1.75). Cheap hardening: re-run `_acceptTracksideSite` on the pushed accent position with the prop's own footprint radius. Not filed as a finding because nothing currently intersects.
>
> WHY collisionRequired IS false ON EVERY ROW: the module docstring (lines 5-12) states it "never creates or mutates path samples, collision widths, feature indices, or physics state", every mesh is tagged userData.presentationOnly, and `grep -rn sceneryLayout src/` returns exactly one hit — the write at line 1411 — with zero consumers. Recommending collision on any of this would violate the module's stated contract; the sponsor boards and grandstands are meant to be driven through.
>
> NOT DEFECTS, checked and dismissed: terrain (`_terrainGeometry`, 72x72 sculpted plane with per-vertex colour, route-foundation blending and a translucent unlit art pass over a full PBR layer with normal+roughness maps per biome); road layering (basin/shoulder/road/crown-wear/tyre-grooves/edge-paint ribbons with real colour+normal+roughness maps and distance-correct UVs); the grass layer (createRallyGrassLayer builds curved tapered multi-blade clumps with per-vertex base-to-tip and soil colouring, seed heads, forbs, per-instance tint, TSL tip-weighted wind, per-biome density 0.2-1.08 and a road clearance of trackWidth*0.5+3.15). Minor cosmetic thing I noticed but did not file: the two start-gate beacon rings at line 1131-1136 sit at x = +/-trackWidth*0.48, roughly 0.9 m inboard of where the arch tube actually is at y=4.95, so they float unattached beside the arch — they pulse via the glow-material update, so this reads as intentional.
>
> CONFIDENCE / LIMITS: findings 1 and 2 are verified by reading source plus offline numeric reproduction of the module's own placement and terrain functions; I did not run the game in a browser, so I have not seen the boards rendered. Finding 3 is verified as code (the boxes and the contradicting comment are on disk) but I did not launch Kaki Stock Cup. The only claim I could not settle is the load-window pop described in the fallbackScatter row — 3.4 s of countdown against a ~5.2 MB lease is plausible either way and I am explicitly not asserting it is player-visible.
>

### Asset system contracts: racingManifest.js / racingAssets.js / core/assets.js / assets/racing GLB inventory / tools/blender builder template

0 examined, 0 class-D.

> CONTRACT DOCUMENTATION (no placeholder hunt). Files read in full: src/racing/racingManifest.js, src/racing/racingAssets.js, src/core/assets.js, src/racing/crash/crashManifest.js, tools/blender/build-kaki-raid-environment-kit.py, tools/blender/build-kaki-dune-environment-kit.py, tools/validate-rally-assets.mjs, tools/validate-production-assets.mjs, tools/generate-asset-inventory.mjs. Read in part: build-kaki-course-workshop-kit.py (set_metadata/export_glb/render_thumbnails/main), courseFeatureCatalog.js (entry() factory), courseFeatureRuntime.js, racingEnvironment.js, trialsEnvironment.js, dunes/duneEnvironment.js, crash/crashWorld.js, crash/crashAssets.js, raid/raidMode.js, dunes/duneMode.js, trialsMode.js, index.js. Every GLB under assets/racing/ was parsed directly (JSON chunk dump) for node names, extras, materials, generator string and extensions.
>
> =====================================================================
>
> 1. src/racing/racingManifest.js -- RALLY_ASSET_MANIFEST SHAPE
>
> =====================================================================
>
> Module is deliberately renderer-free (no `three` import) so Node validators can import it. Three frozen exports plus two pure functions.
>
> `export const RALLY_ASSET_MANIFEST = Object.freeze({ <id>: Object.freeze(spec), ... })` -- 61 entries.
>
> Spec shape (only 3 keys exist anywhere in the file):
>
> { url: string, kind: 'model'|'color'|'normal'|'data', repeat?: [number, number] }
>
> - `url` is ALWAYS a repo-relative POSIX path with no leading slash, no scheme, no query/hash. Enforced by assertLocalUrl() in tools/validate-rally-assets.mjs.
>
> - `kind` drives exactly two behaviours in racingAssets.js:
>
> 'model' -> GLTFLoader path (DRACO + Meshopt already wired).
>
> anything else -> TextureLoader path. `colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace`.
>
> NOTE: 'normal' and 'data' are the SAME code path. The distinction is documentation only, not behaviour.
>
> - `repeat` present -> `wrapS = wrapT = THREE.RepeatWrapping; texture.repeat.fromArray(spec.repeat)`.
>
> `repeat` absent -> `ClampToEdgeWrapping` on both axes. There is no way to get RepeatWrapping at 1x1 except `repeat: [1,1]`.
>
> - Anisotropy is always `Math.min(8, capabilities.maxAnisotropy || 1)`.
>
> ID naming convention (observed, not enforced): lowerCamelCase, no prefix namespacing. Family groupings are by name stem -- `ground<Biome>V2Color/Normal/Roughness`, `monsterArena<Thing>`, `sky<Time>`, `chapter<Biome>`, `trials<X>BackdropV2`, `<mode>EnvironmentKit`. Version suffixes live in the FILE name (`-v1.glb`, `-v2.webp`), not in the id -- e.g. `monsterDecal` -> `kitty-monster-truck-decal-oekaki-v2.webp`. A rebuild bumps the file and edits one manifest line; ids stay stable.
>
> Course->id mapping tables:
>
> `export const RALLY_COURSE_ASSETS = Object.freeze({ forest, twilight, cinder, void, cave, kakiland })`  each a frozen string[] of manifest ids.
>
> `export const TRIALS_COURSE_ASSETS = Object.freeze({ meadow, quarry, crown })` same shape.
>
> Both tables include `'environmentKitV2'` and `'courseWorkshopKit'` in EVERY entry -- those two GLBs are the shared circuit/trials backbone.
>
> Working-set resolvers (exact signatures):
>
> `export function rallyAssetIds(courseId, mode = 'circuit', monsterVehicleId = 'meowster', { monsterProductionAssets = false } = {})`
>
> - `mode === 'monster'` -> hardcoded list; body asset chosen by monsterVehicleId ('cyber'->cyberKakiBody, 'tipsy'->tipsyTumblerBody, else mightyMeowsterBody); `monsterProductionAssets` gates only `'monsterAudienceBank'`.
>
> - `mode === 'dunes'` -> hardcoded list; `isRallyRaid = ['buggy','prototype','truck'].includes(monsterVehicleId)` SUPPRESSES the body asset (rally-raid vehicles are procedural).
>
> - default -> `new Set(['decalAtlas'])` + RALLY_COURSE_ASSETS[courseId] (falls back to `.forest` on unknown id, does NOT throw).
>
> - There is NO 'raid', 'trials', 'crash' or 'drift' branch. Adding a new mode here is optional (see route (b) below).
>
> `export function trialsAssetIds(courseId)` -> `['decalAtlas','monsterDecal', ...(TRIALS_COURSE_ASSETS[courseId] || TRIALS_COURSE_ASSETS.meadow)]`.
>
> THREE WAYS TO DECLARE A NEW KIT'S IDS -- pick one, they are the whole surface:
>
> (a) Central: add `Object.freeze({url, kind})` to RALLY_ASSET_MANIFEST, then wire into RALLY_COURSE_ASSETS / TRIALS_COURSE_ASSETS or a new mode branch in rallyAssetIds(). Gets validated by validate-rally-assets.mjs for free.
>
> Used by: circuit, trials, monster, dunes.
>
> (b) Central manifest entry + explicit call-site list: keep the entry in RALLY_ASSET_MANIFEST but pass `assetIds: [...]` at the lease call. Still validated. Used by Raid -- src/racing/raid/raidMode.js:221
>
> session.assetLease = createRallyAssetLease({ mode: 'raid', assetIds: ['raidEnvironmentKit','tipsyTumblerBody','monsterDecal'], renderer: state.renderer || null });
>
> CAVEAT: `mode: 'raid'` there is INERT. rallyAssetIds has no 'raid' branch, and `assetIds` short-circuits the resolver entirely (`const ids = assetIds || (...)`). Do not copy it expecting it to select anything.
>
> (c) Mode-local frozen manifest + ids array, injected via `manifest:` + `assetIds:`. Template is src/racing/crash/crashManifest.js:
>
> export const CATASTROPHE_ASSET_MANIFEST = Object.freeze({ decalAtlas: {...}, crashVehicleKitV2: {...}, crashEnvironmentV2: {...}, skyTwilight: {...} });
>
> export const CATASTROPHE_ASSET_IDS = Object.freeze(['decalAtlas','crashVehicleKitV2','crashEnvironmentV2','skyTwilight']);
>
> consumed by crashAssets.js:361 `createRallyAssetLease({ renderer, assetIds: CATASTROPHE_ASSET_IDS, manifest: CATASTROPHE_ASSET_MANIFEST })`.
>
> COST: validate-rally-assets.mjs iterates ONLY RALLY_ASSET_MANIFEST, so route (c) needs its own validator (tools/validate-kaki-catastrophe-assets.mjs is the precedent). Use (c) only for gated/frozen experiments.
>
> =====================================================================
>
> 2. src/racing/racingAssets.js -- LEASE CONTRACT
>
> =====================================================================
>
> Module-level singletons shared by every lease: `const _cache = new Map()`, one `THREE.TextureLoader`, one `GLTFLoader` with `setMeshoptDecoder(MeshoptDecoder)` and `setDRACOLoader(new DRACOLoader())`. The vendored r185 DRACOLoader self-resolves its worker/WASM -- do not call setDecoderPath.
>
> EXACT SIGNATURE (racingAssets.js:82-92):
>
> export function createRallyAssetLease({
>
> courseId = 'forest',
>
> mode = 'circuit',
>
> monsterVehicleId = 'meowster',
>
> renderer = null,
>
> rendererService = null,
>
> trials = false,
>
> monsterProductionAssets = false,
>
> assetIds = null,
>
> manifest = RALLY_ASSET_MANIFEST,
>
> } = {})
>
> Resolution order inside: `const ids = assetIds || (trials ? trialsAssetIds(courseId) : rallyAssetIds(courseId, mode, monsterVehicleId, { monsterProductionAssets }))`. So `assetIds` beats `trials` beats `mode`.
>
> `renderer`/`rendererService` are ONLY used for anisotropy: `_acquire(id, rendererService || renderer, manifest)` -> `getCapabilitiesForRendererSource(...)`. Either is fine; pass whichever the mode holds.
>
> RETURNED OBJECT (the full surface -- nothing else exists):
>
> {
>
> ids,                 // string[] copy of the resolved id list
>
> textures,            // { [id]: THREE.Texture }  -- SYNCHRONOUSLY populated, usable immediately (image may still be decoding)
>
> models,              // { [id]: GLTF }           -- EMPTY OBJECT until a promise resolves. See the trap below.
>
> texturesByUrl,       // { [manifestUrl]: THREE.Texture }
>
> getTextureByUrl(url),
>
> getModelMesh(name, modelId = 'environmentKitV2'),
>
> getModelMeshes(name, modelId = 'environmentKitV2'),
>
> whenReady(id),
>
> ready,               // Promise
>
> release(),
>
> }
>
> THE #1 TRAP -- `models` IS LAZILY POPULATED.
>
> `models[id] = entry.gltf` happens ONLY inside `whenReady(id).then(...)` (line 141) and inside the top-level `ready.then(...)` (line 147). Reading `lease.models.myKit` before either resolves yields `undefined`. Every real consumer gates on a promise:
>
> - courseFeatureRuntime.js:233/460/553  `assetLease.whenReady('courseWorkshopKit').then(populate)` then reads `assetLease.models.courseWorkshopKit.scene.getObjectByName(...)` inside populate.
>
> - raid/raidMode.js:225 `await session.assetLease.ready;` then `session.assetLease.models?.raidEnvironmentKit?.scene || session.assetLease.models?.raidEnvironmentKit || null`.
>
> - crash/crashWorld.js:168 `assetLease.whenReady('crashEnvironmentV2').then((gltf) => ...)` -- uses the RESOLVED VALUE rather than `models`, which is the cleanest pattern.
>
> - index.js:2948/2961/2969/2980 `whenReady(bodyAssetId | 'arenaTrafficKit' | 'monsterEnvironmentKit' | 'monsterAudienceBank').then((model) => ...)`.
>
> `ready` -- `Promise.all(entries.map(e => e.ready)).then(() => { /* fill models */ return { textures, models }; })`. Resolves to `{ textures, models }`. Rejects LOUDLY: any single failure rejects with `new Error("Kaki Rally production asset failed: " + spec.url)` after `console.error("[Kaki Rally assets] Failed to load " + id + " from " + url + ": " + detail)`. There is no silent fallback. Modes that must not hard-fail attach `.catch()` and stash `session.assetError` (index.js:2846, trialsMode.js:1571).
>
> `whenReady(id)` -- `if (!entry) return Promise.reject(new Error("[Kaki Rally assets] Asset " + id + " is not part of this lease"))`. Otherwise `entry.ready.then(asset => { if (entry.kind === 'model') models[id] = entry.gltf; return asset; })`. Resolves to the GLTF object for models, the THREE.Texture for textures. Use this to start building one kit without waiting for the whole working set -- the reason Monster can show the arena before the audience bank lands.
>
> `getModelMesh(name, modelId = 'environmentKitV2')` -- `models[modelId]?.scene?.getObjectByName?.(name)`; if the hit is already a Mesh, returns it; otherwise traverses and returns the FIRST descendant mesh; returns `null` on miss.
>
> `getModelMeshes(name, modelId = 'environmentKitV2')` -- same lookup; returns `[object]` if it is a Mesh, otherwise ALL descendant meshes; returns `[]` on miss. Different empty sentinel from getModelMesh (`[]` vs `null`) -- callers handle both:
>
> src/racing/racingEnvironment.js:989-990 and src/racing/trialsEnvironment.js:1149-1150
>
> const sources = assetLease.getModelMeshes?.(name) || [assetLease.getModelMesh?.(name)].filter(Boolean);
>
> Both real callers RELY ON THE DEFAULT modelId. A new kit MUST pass modelId explicitly (`getModelMeshes('MyProp-0', 'myEnvironmentKit')`) or it silently reads the wrong GLB.
>
> These return SHARED meshes out of the cached gltf, NOT clones. racingEnvironment feeds `source.geometry` / `source.material` straight into InstancedMesh, so mutating either mutates the cache for every lease holder. Clone first if you need per-instance materials (see src/core/assets.js `prepareRallyClone`).
>
> `getTextureByUrl(url)` -- path normaliser, not a raw map read. Replaces backslashes, slices from the LAST `/assets/`, strips a leading `../../` and a leading `/`, then does `texturesByUrl[normalized] || null`. Exists so authored CSS/JSON theme data can reference textures by whatever path form it happens to hold. Consumers: index.js:462 (`textureResolver: assetLease?.getTextureByUrl?.bind(assetLease) || null`), trialsEnvironment.js:174-175 (tries relativePath then the raw url).
>
> `release()` -- idempotent (`if (released) return`). Decrements each entry's refs; at 0 disposes and does `_cache.delete(entry.url)`. Texture entries: `entry.texture.dispose()`. Model entries: traverses `gltf.scene` collecting geometries, materials, and every `material[key]` where `value?.isTexture`, disposes textures then materials then geometries. Called defensively everywhere: `try { session.assetLease?.release(); } catch (_) {}` at index.js:3934, raidMode.js:699, trialsMode.js:1774, crashMode.js:1154, duneMode.js:1261.
>
> REFCOUNT KEY IS THE URL, NOT THE ID -- `_cache.get(spec.url)` / `_cache.set(spec.url, entry)` / `_cache.delete(entry.url)`. Two ids pointing at one file share one refcount, ACROSS MANIFESTS. `decalAtlas` resolves to the same URL in RALLY_ASSET_MANIFEST and CATASTROPHE_ASSET_MANIFEST, so a Crash lease and a Circuit lease refcount the same entry. A new kit must never reuse a URL under a second id unless that sharing is intended.
>
> `_acquire(id, rendererSource, manifest = RALLY_ASSET_MANIFEST)` throws synchronously on an unknown id: `new Error("[Kaki Rally assets] Unknown manifest id: " + id)`. Typos in `assetIds` fail at lease construction, not at load.
>
> `export function getRallyAssetCacheSnapshot()` -> `[{ id, url, refs, kind, loaded, colorSpace }]`. `loaded` is `kind==='model' ? !!gltf?.scene : !!texture?.image`. Diagnostics only; used by index.js and trialsMode.js.
>
> =====================================================================
>
> 3. src/core/assets.js -- THE OTHER, OLDER LOADER (drivers/breakroom)
>
> =====================================================================
>
> Separate system. No manifest, no `kind`, models only, and it SWALLOWS errors where racingAssets rejects. Do not extend a world kit through this path.
>
> export const BASE = 'assets/breakroom/';
>
> export const GLTF_CACHE = {};                                  // key -> gltf, mutated global
>
> export function lazyLoadGLTF(key, path)                        // -> Promise<boolean>, resolve(false) on failure
>
> export function cloneCached(key)                               // SkeletonUtils.clone(gltf.scene) | null
>
> export function createDriverAssetLease(ids = ['kitty'])        // -> { ids, ready: Promise<true>, release(): boolean }
>
> export function prepareRallyClone(root, { tint = 0xffffff } = {})   // castShadow+receiveShadow on every mesh, clones+tints materials, returns root
>
> export async function createDriverMesh(id = 'kitty')           // -> THREE.Group named `kaki-rally-driver-${id}`, auto-fitted to HERO.targetHeight, XZ-centred, Y min at 0
>
> export function disposeDriverMesh(root)
>
> export function disposeCachedGLTF(key)                         // no-op returning false if refs > 0
>
> export function getAssetDiagnostics()                          // [{ key, path, refs, status, error, roots }]
>
> export function disposeAssetService()
>
> Cache key is `key` (not the URL), with a hard guard: requesting the same key with a different path throws `Asset key ${key} was requested with two paths`. `createDriverAssetLease.ready` DOES throw if any entry ended in status 'error' (`Driver assets failed to load: <paths>`), so the error surfacing is deferred rather than absent. Paths come from `AVATARS`/`HERO` in src/config.js, not from a manifest.
>
> =====================================================================
>
> 4. assets/racing/ -- GLB INVENTORY AND PER-KIT NODE NAMING
>
> =====================================================================
>
> 14 GLBs, all verified by parsing the JSON chunk.
>
> assets/racing/models/kaki-rally-environment-kit-v2.glb           844K   14 nodes / 14 meshes / 20 mats / 0 images   Blender I/O v5.1.19
>
> assets/racing/workshop/kaki-course-workshop-kit-v1.glb          1.0M  736 nodes /583 meshes / 32 mats / 1 image     glTF-Transform v4.3.0
>
> assets/racing/raid/kaki-raid-environment-kit-v1.glb             1.3M   48 nodes / 26 meshes / 15 mats / 0 images    Blender I/O v5.1.19
>
> assets/racing/dunes/kaki-dune-environment-kit-v1.glb            656K  140 nodes /125 meshes / 14 mats / 0 images    Blender I/O v5.1.19
>
> assets/racing/models/arena-traffic-kit-runtime-v2.glb           1.0M  (shipped, decimated/instanced derivative)
>
> assets/racing/models/arena-traffic-kit-v1.glb                   2.3M  (archival source, NOT in the manifest)
>
> assets/racing/models/mighty-meowster-body-v1.glb                220K
>
> assets/racing/models/cyber-kaki-body-v1.glb                     280K
>
> assets/racing/monster-arena/models/monster-arena-environment-kit-v1.glb   784K
>
> assets/racing/monster-arena/models/arena-audience-bank-v1.glb   2.2M  (opt-in via monsterProductionAssets)
>
> assets/racing/monster-arena/models/tipsy-tumbler-monster-truck-v2.glb     3.1M
>
> assets/racing/crash/kaki-catastrophe-vehicles-v2.glb            1.8M  (frozen experiment, manifest (c))
>
> assets/racing/crash/pawprint-moonpaw-environment-v2.glb         1.2M  (frozen experiment)
>
> assets/racing/crash/kaki-crash-kit-v1.glb                       1.1M  (NOT referenced by any manifest)
>
> Directory convention: shared/vehicle GLBs in `assets/racing/models/`; per-mode kits in `assets/racing/<mode>/` (workshop, raid, dunes, crash) with monster-arena further split into `models/ materials/ decals/ vfx/`. Textures live beside the kit (`terrain-v2/`, `backdrops-v2/`, `monster-arena/materials/`) or in the global `assets/textures/`. File naming: `kaki-<subject>-<role>-v<N>.<ext>` for authored, `<subject>-<generator>-v<N>.webp` for generated art (`-grok-`, `-imagegen-`, `-oekaki-`, `-gpt-`).
>
> THERE IS NO GLOBAL NODE-NAMING RULE. Four different conventions ship, each bound by a different runtime table. Pick one deliberately:
>
> A. environmentKitV2 -- flat `snake_case`, biome-prefixed, one Mesh per root, NO extras, NO textures (20 flat-colour materials, KHR_materials_emissive_strength only).
>
> Roots: forest_tree_gnarled_a/_b, forest_fern_cluster, twilight_tree_lantern, twilight_reed_cluster, cinder_basalt_cluster, cinder_dead_tree, void_bone_spires, void_grave_cluster, cave_stalagmite_cluster, cave_rubble_cluster, cave_timber_brace, kakiland_blossom_tree, kakiland_flower_cluster.
>
> Bound by `AUTHORED_BIOME_PROPS` (src/racing/racingEnvironment.js:43-50): `{ <courseId>: { primary: string[], accent: string } }`. Consumed via getModelMeshes -> InstancedMesh.
>
> There is NO committed Blender builder for this kit in tools/blender/.
>
> B. Workshop kit -- `feature_<slug>` and `bridge_<slug>` EMPTY roots with mesh children named `<slug>_<part>_<index>` (e.g. `kicker_edge_rail_-1_0_3`, `launch_grippy_deck_0`, `tabletop_kaki_badge`).
>
> 42 `feature_*` roots (small_kicker, large_launch, tabletop, double_jump, rollers, step_up, step_down, boost_pad, repair_bay, checkpoint_gate, speed_trap, jump_gate, turbo_gate, drift_zone, crown_ring, landing_zone, mud_patch, gravel, ice, oil, water, rumble, cone_chicane, barrier_chicane, tire_wall, crates, hay_bales, barrels, rocks, toy_cars, delivery_cart, crown_targets, smash_chain, direction_signs, billboard, floodlights, crowd, grandstand, foliage, flags, construction, landmark) + 8 `bridge_*` modules (deck_module, guardrail_module, support_standard/tall/huge, portal_standard/tall/huge).
>
> Root extras (exactly 50 nodes carry extras, all roots): features get `{ catalogIndex: <int>, productionReady: true, collisionSource: "shared catalog footprint and surface profile" }`; bridge modules get `{ productionReady: true, collisionSource: "elevated spline and bridge volume", moduleFamily: "Kaki Skyway" }`. Written by `set_metadata()` at build-kaki-course-workshop-kit.py:793-808.
>
> Bound by `courseFeatureCatalog.js` `entry({ id, node, ... })` -> frozen `{ assetId: 'courseWorkshopKit', assetNode: node, ... }` (line 63). Runtime does `assetLease.models.courseWorkshopKit.scene.getObjectByName(runtime.feature.assetNode)` (courseFeatureRuntime.js:215-217) and pushes a miss onto `diagnostics.missing`. So the node name is a HARD contract between the GLB and the catalog.
>
> ~30 unnamed (`None`) scene roots remain -- EXT_mesh_gpu_instancing holder nodes left by the optimizer; harmless, but it means "every root is named" is false for this kit.
>
> C. Raid kit -- `Raid<Thing>-<index>` EMPTY root, one or more mesh children `Raid<Thing>-<index>-<part>`.
>
> Roots: RaidBoulder-0/1/2, RaidSlab-0/1, RaidGravel-0/1, RaidMesa-0, RaidSpire-0, RaidScrub-0/1, RaidTussock-0/1, RaidDeadwood-0, RaidMarker-0, RaidRuinArch-0, RaidRuinColumn-0/1, RaidRuinWall-0, RaidAmphitheatre-0, RaidRiftShard-0, RaidRiftVent-0.
>
> Root extras: `{ kaki_asset: true, source: "Kaki Rally Raid original Blender geometry" }`. Mesh-child extras: `{ uv_ready: true }` plus optional `kaki_size: <metres>` (rocks) or `landmark_reach: 38.0` (mesa).
>
> Materials are `RaidRock/RockDark/RockWarm/SandApron/Wood/Leaf/Grass/Pole/Accent/RuinStone/RuinShade/RuinSand/RiftStone/RiftGlow/RiftCore` -- one shared 15-entry palette, all flat colour, two emissive.
>
> D. Dune kit -- `Dune<Thing>_<Variant>` roots, with an explicit `_LOD0`/`_LOD1` suffix where LOD exists, children `<Root>_<Part>_<Index>`.
>
> Roots: DuneRockSpire_A_LOD0/_LOD1, DuneRockArch_A_LOD0, DuneMesa_A_LOD0/_LOD1, DuneScrub_A/_B, DuneDeadwood_A, DuneRallyGate_Master, DuneRouteFlag_Master, DuneServiceCamp_A, DuneOasis_A, DuneWreckedRallyProp_A, DuneSign_PawRoute, DuneDestructibleSupplyStack_A.
>
> Root extras: `{ kaki_asset: true, source: "Kaki Dune Run custom Blender geometry" }` + `lod: 0|1` on LOD roots + ad-hoc gameplay props (`route_clearance_width: 5.1` on the gate). Mesh extras: `{ uv_ready: true, optimized: true, casts_shadow: true, receives_shadow: true }`, plus `destructible: true` on supply crates.
>
> LOD NODE CONVENTION -- exactly ONE live mechanism, and one dead one:
>
> LIVE: dune root-name suffix `_LOD0`/`_LOD1`. src/racing/dunes/duneEnvironment.js `addLodAsset(environment, gltf, name, x, z, yaw, scale = 1)` clones `${name}_LOD0` and `${name}_LOD1` and builds a `THREE.LOD` named `${name}-dune-lod`. If `_LOD1` is absent the LOD degrades to one level. A new kit that wants distance LOD must use this exact suffix.
>
> DEAD: src/racing/courseFeatureRuntime.js:224 `if (object.userData?.lod === 0) object.visible = false;` inside the `quality === 'low' && category === 'scenery'` branch. VERIFIED NO-OP: zero nodes in kaki-course-workshop-kit-v1.glb carry `extras.lod` (I grepped the full extras dump), and nothing in src/ ever assigns `userData.lod`. Do not treat this as an existing per-node LOD convention -- it is aspirational. Workshop LOD is DATA-driven instead, via `DEFAULT_LOD` in courseFeatureCatalog.js: `{ highDistance: 54, mediumDistance: 108, cullDistance: 220, lowQualityDensity: 0.62 }`.
>
> COLLISION NODE CONVENTION -- TWO INCOMPATIBLE ONES, BOTH LIVE. Match the mode you are building for.
>
> Dunes (src/racing/dunes/duneEnvironment.js:24, inside cloneAsset):
>
> const collider = object.name.includes('_COLLIDER') || object.userData?.collision_proxy;
>
> object.visible = !collider; object.castShadow = !collider; object.receiveShadow = !collider;
>
> i.e. name SUFFIX `_COLLIDER` (substring match) OR `extras.collision_proxy === true`. Confirmed shipping: node `DuneRockArch_A_COLLIDER` exists in the GLB with `extras = { uv_ready: true, optimized: true, collision_proxy: true }` and IS correctly hidden at runtime. Authored at build-kaki-dune-environment-kit.py:245-248 (`display_type = "WIRE"`, `hide_render = True`, `["collision_proxy"] = True`). Note Blender's exporter does NOT skip hide_render objects, which is why the runtime filter is required.
>
> Crash (src/racing/crash/crashWorld.js:32):
>
> const explicit = object.name.startsWith('COLLIDER_') || object.userData?.collision === true;
>
> i.e. name PREFIX `COLLIDER_` OR `extras.collision === true`. Different prefix, different extras key.
>
> Raid, workshop and environmentKitV2 ship NO collision nodes at all. The workshop kit instead declares `collisionSource: "shared catalog footprint and surface profile"` -- collision comes from the catalog's `footprint` / `collision` / `surface` data fields, never from geometry.
>
> Also note `cloneAsset` in duneEnvironment.js RE-CENTRES every clone (XZ to bounds centre, Y to bounds min) because the dune kit is authored as a review sheet with pieces laid out at scattered locations. The raid kit does NOT need this -- its builder audits that every root sits at (0,0,0) with a buried skirt below z=0. Authoring at origin is strictly better; prefer it.
>
> =====================================================================
>
> 5. tools/blender/ -- BUILDER SCRIPT TEMPLATE
>
> =====================================================================
>
> Six files + a `raid_kit/` package. Only THREE runtime kits have a committed builder: workshop, dunes, raid. environmentKitV2, the monster-arena kits, the traffic kits, the crash kits and every vehicle body have NO builder in-tree.
>
> build-kaki-course-workshop-kit.py   43K  monolithic
>
> build-kaki-dune-environment-kit.py  22K  monolithic  (older convention)
>
> build-kaki-raid-environment-kit.py  21K  orchestrator only  (NEWER convention -- from 46d6f7e; extend THIS)
>
> raid_kit/{rock,landmark,plant,ruin}.py  26K/24K/33K/62K  geometry modules
>
> raid_kit/preview_plants.py, preview-raid-kit-{rock,landmark,ruin}.py  standalone per-family preview harnesses
>
> There are TWO distinct templates, not one.
>
> --- SHARED SPINE (all three) ---
>
> """Docstring: what it builds, the exact invocation `blender -b --python tools/blender/<script>.py`, and an explicit originality statement ("Original project geometry. Nothing here is downloaded, traced, or derived from a third party, so the kit carries no attribution burden and no licence risk.")"""
>
> from __future__ import annotations
>
> REPO = Path(__file__).resolve().parents[2]
>
> OUTPUT  = REPO / "assets" / "racing" / <mode> / "<kit>-v1.glb"
>
> PREVIEW = REPO / "docs" / "qa" / "assets" / "<kit>-v1.png"
>
> reset_scene()            # select_all+delete, then purge zero-user datablocks from meshes/curves/materials/cameras/lights[/objects/images]
>
> material(name, colour, roughness, ...)   # Principled BSDF, Metallic 0, flat Base Color -- NO TEXTURES ANYWHERE IN ANY KIT
>
> ... build geometry ...
>
> ... render a QA contact sheet to docs/qa/assets/ ...
>
> ... delete/hide preview-only objects so they never reach the GLB ...
>
> bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT.with_suffix(".blend")))   # the .blend sits beside the .glb
>
> bpy.ops.export_scene.gltf(...)
>
> print(f"Wrote {OUTPUT}"); print(f"Wrote {PREVIEW}")
>
> if __name__ == "__main__": main()
>
> EXPORT CALL -- byte-identical in the raid and dune builders; the workshop builder omits the last four flags:
>
> bpy.ops.export_scene.gltf(
>
> filepath=str(OUTPUT),
>
> export_format="GLB",
>
> export_apply=True,        # bakes modifiers
>
> export_yup=True,          # Blender +Z up -> glTF +Y up. Author +Z up.
>
> export_materials="EXPORT",
>
> export_cameras=False,
>
> export_lights=False,
>
> export_extras=True,       # LOAD-BEARING: this is the ONLY thing carrying Blender custom props into node.extras -> three.js userData. Without it catalogIndex / productionReady / collisionSource / uv_ready / kaki_size / lod / collision_proxy / destructible all vanish and every runtime filter above silently fails.
>
> export_animations=False,
>
> export_texcoords=True,
>
> export_normals=True,
>
> export_tangents=False,
>
> )
>
> --- TEMPLATE 1: RAID (canonical -- copy this for a new kit) ---
>
> Separation of concerns: the top-level script owns the PALETTE, the CONTACT SHEET and the EXPORT, and owns nothing about shapes. Geometry lives in `tools/blender/raid_kit/<family>.py`, imported after `sys.path.insert(0, str(REPO / "tools" / "blender"))` and called as `build_rocks(palette)` / `build_landmarks(palette)` / `build_plants(palette)` / `build_ruins(palette)`.
>
> * PALETTE_SPEC: dict of role-key -> tuple. 3-tuple `(datablock_name, (r,g,b) linear, roughness)` for plain, 5-tuple `(name, colour, roughness, emission_rgb, strength)` for emissive. `build_palette()` returns `{key: material(*spec)}`. Every geometry module looks a missing key up BY DATABLOCK NAME in bpy.data before authoring anything, so a key mismatch lands on the shared palette rather than silently creating a second differently-coloured set. The colour choices are documented with the reasoning (value relationship to the ground albedo under the mode's actual sun strength; hue/chroma ratio) -- follow that, the comments are the spec.
>
> * `RUNTIME_ASSETS = (...)` -- a literal tuple of EVERY name the runtime looks up, with inline comments justifying entries that are not yet consumed. This is the manifest of the kit.
>
> * `TRIANGLE_BUDGET = 1500` with `TRIANGLE_BUDGET_OVERRIDE = { "RaidAmphitheatre-0": 6000 }`. The comment states the rule: an override is a PROMISE about how the asset is scattered (instanced hundreds of times vs capped at twelve landmark instances).
>
> * `audit(palette)` -- the hard gate. Collects `problems` and `raise SystemExit("raid kit audit failed")` at the end. Checks: (1) `{m.name for m in bpy.data.materials if m.users > 0}` minus the palette names must be empty (no stray materials); and per RUNTIME_ASSETS name: (2) object exists, (3) `obj.parent is None` (is a root), (4) `tuple(obj.location) == (0,0,0)`, (5) has at least one MESH child, (6) total evaluated `loop_triangles` across children <= budget. Prints a one-line-per-asset report with tri count and world-space bbox in metres.
>
> * REPRODUCIBILITY: `bake_modifiers(obj)` applies the whole modifier stack up front, then `deterministic_box_uvs(obj, scale=0.5)` replaces the unwrap with a per-face projection onto the dominant normal axis. The docstring explains exactly why: `bpy.ops.uv.smart_project` packs islands with a threaded, time-budgeted search, and the BEVEL modifier interpolates UVs onto new arris faces non-deterministically -- together they were the only thing stopping byte-identical rebuilds. Nothing in any kit samples a texture, so UVs only have to exist and be stable.
>
> * CONTACT SHEET: multiple panels because one frame cannot judge a 0.42 m tussock and a 21 m mesa. `panel(layout)` hides EVERY runtime asset then places+reveals only the listed `(name, x, y, yaw)` tuples -- `show(obj, visible)` walks `children_recursive` because `hide_render` on an empty does not hide its meshes. Renders EEVEE, AgX view transform, exposure -0.35, 64 TAA samples, low raking key sun (energy 3.0, warm) + cool fill (0.45), 1600x640 per panel, then `stack_panels()` concatenates the numpy pixel buffers (REVERSED -- Blender buffers are bottom-up) into one PNG at docs/qa/assets/. Scratch objects are removed and every asset is reset to origin before export.
>
> * Geometry-module contract (raid_kit/rock.py docstring is the template): module docstring states the call form, the recognised `materials` role keys, that every key may be missing so `build_rocks({})` works for the standalone preview harness, the list of assets built with their approximate metre sizes, the origin/ground-contact rule ("authored around its own origin at the ground contact point with +Z up, and every asset carries a shallow buried skirt below z=0 so the scatter beds it into the terrain instead of perching it on top"), the originality statement, and a prose explanation of the modelling approach and why the naive version was rejected.
>
> --- TEMPLATE 2: DUNE (older, monolithic -- do NOT copy for new work) ---
>
> One file, inline primitive helpers, no audit gate, non-deterministic UVs.
>
> parent_asset(name, location)                        -> empty, stamps ["kaki_asset"]=True and ["source"]="Kaki Dune Run custom Blender geometry"
>
> finish_mesh(obj, bevel=0.08, smooth=True, uv=True)  -> shade smooth, BEVEL modifier (width, segments=2, limit_method="ANGLE"), smart_project(angle_limit=66deg, island_margin=0.025) wrapped in try/except RuntimeError, stamps ["uv_ready"]=True and ["optimized"]=True
>
> cube(name, parent, location, scale, mat, bevel=0.08, rotation=(0,0,0))
>
> cylinder(name, parent, location, radius, depth, mat, vertices=12, rotation=(0,0,0), bevel=0.05)
>
> ico(name, parent, location, scale, mat, subdivisions=2, rotation=(0,0,0), bevel=0.05)
>
> cone(name, parent, location, radius1, radius2, depth, mat, vertices=10, rotation=(0,0,0))
>
> tube(name, parent, points, radius, mat, resolution=1)          # POLY curve + bevel_depth, converted to mesh
>
> triangular_flag(name, parent, location, scale, mat, flip=False)  # from_pydata
>
> aim_at(obj, target)                                             # direction.to_track_quat("-Z","Y").to_euler()
>
> each asset is `build_<thing>(location, *materials) -> parent`; modifiers are NOT baked (relies on export_apply); pieces are laid out on a review sheet at scattered XY, which is why the runtime has to re-centre.
>
> The raid builder's `deterministic_box_uvs` docstring explicitly names this script's smart_project as the bug it fixed.
>
> --- TEMPLATE 3: WORKSHOP (data-bound, catalog-coupled) ---
>
> Monolithic like dune, but adds two things a new gameplay kit needs:
>
> * `main()` asserts the built roots match the declared name lists before export:
>
> assert set(roots_by_name) == set(FEATURE_NAMES), "Catalog roots are missing or duplicated"
>
> assert {root.name for root in MODULE_ROOTS} == set(BRIDGE_MODULE_NAMES), "Bridge modules are missing or duplicated"
>
> ROOTS[:] = [roots_by_name[name] for name in FEATURE_NAMES]     # ordering is load-bearing: catalogIndex is the enumerate() index
>
> * `set_metadata()` stamps scene-level provenance (`title`, `author`, `license`, `sourceConcept`, `catalogRoots`, `bridgeModules`) and the per-root extras listed in section 4B.
>
> * `render_thumbnails()` renders each feature root alone under an ORTHO camera auto-framed to its bounds (`ortho_scale = max_dim * 1.48`) at 256x192 and composites a 7x6 atlas to `assets/racing/workshop/kaki-course-feature-thumbnails-v1.webp` (declared as `COURSE_FEATURE_THUMBNAIL_ATLAS` in courseFeatureCatalog.js, indexed by each entry's `frame`/`previewFrame`). A new palette kit with a picker UI needs this pass.
>
> REPRODUCIBILITY GAP WORTH KNOWING BEFORE YOU BUILD:
>
> build-kaki-course-workshop-kit.py `export_glb()` emits a plain Blender GLB, but the file on disk reports `generator: "glTF-Transform v4.3.0"` and carries EXT_meshopt_compression, KHR_mesh_quantization, EXT_texture_webp and EXT_mesh_gpu_instancing. I grepped the entire repo (package.json, tools/, *.mjs, *.py, *.sh, *.md) for `gltf-transform` / `gltfpack` / `meshopt` / `quantize`: the ONLY hits are the vendored three.js `meshopt_decoder.module.js` in prune-three-vendor.mjs and generate-asset-inventory.mjs. So the shipped workshop kit was optimized by an OUT-OF-TREE step that is not committed and not scripted, and running the committed builder will NOT reproduce the shipped artifact (it will produce a larger, uncompressed, un-instanced GLB with all node names intact). If a new kit needs to fit the 5 MiB/file budget it will likely need the same undocumented step -- and whatever runs it MUST preserve the names of every node the runtime resolves by `getObjectByName`, since the existing optimizer already stripped ~30 root names to `None`. Raid and dune ship raw Blender output with no extensions at all, which is the safe default.
>
> =====================================================================
>
> 6. GATES A NEW KIT MUST PASS
>
> =====================================================================
>
> `npm run test:assets` = `node tools/validate-rally-assets.mjs && node tools/generate-asset-inventory.mjs --check`.
>
> tools/validate-rally-assets.mjs (imports RALLY_ASSET_MANIFEST, RALLY_COURSE_ASSETS, TRIALS_COURSE_ASSETS, rallyAssetIds, trialsAssetIds -- route (c) manifests are invisible to it):
>
> - URL: non-empty, no scheme (`/^[a-z][a-z\d+.-]*:/i`), not protocol-relative, not absolute, no backslashes, no `..` segment, no `?` or `#`, resolves inside REPO_ROOT. Duplicate URLs across ids are a FAILURE (case-insensitive compare).
>
> - File exists, non-empty, `<= 5 MiB` per file (MAX_RUNTIME_FILE_BYTES).
>
> - Sum of all manifest files `<= 32 MiB` (MAX_MANIFEST_TOTAL_BYTES).
>
> - Every computed working set `<= 20 MiB` (MAX_RUNTIME_TOTAL_BYTES). Sets enumerated: circuit x 6 courses, monster x 6 courses x 3 vehicles, trials x 3 courses. NOTE: dunes and raid working sets are NOT enumerated here -- a dune/raid-only kit escapes the 20 MiB check.
>
> - Models: extension `.glb`, magic `glTF`, version 2, and `readUInt32LE(8) === buffer.length` (the GLB length header must match the file size exactly).
>
> - Images: `.png`/`.jpg`/`.jpeg`/`.webp` only, header-parsed for real dimensions, integer w/h > 0, `<= 4096 px` on either edge (MAX_IMAGE_EDGE).
>
> - Course mappings: non-empty, no repeated id within a course, every id defined in the manifest.
>
> - Two bespoke provenance checks (arenaTrafficKit must point at the `-runtime-v2` derivative and its scene extras must carry `derivativeSource` + per-source `asian3dmodel` / `CC-BY-4.0` / sketchfab URL; decalAtlas runtime webp must be 1024x1024 and smaller than its archival PNG source under assets/source/imagegen/). A new third-party-derived kit needs an equivalent check added here.
>
> tools/generate-asset-inventory.mjs --check: rebuilds docs/ASSET_INVENTORY.json (sha256 + bytes + reverse reference list for every file under `assets/`, `images/`, plus a hardcoded RUNTIME_SUPPORT list) and asserts the on-disk file is byte-identical. ANY new or changed asset fails `--check` until `npm run assets:inventory` is run. It also asserts every path referenced from `src/` or `index.html` is actually shipped, and does an exact-case filesystem check (`assertExactCase`) -- a case-mismatched path passes on WSL/macOS and 404s on GitHub Pages.
>
> tools/validate-production-assets.mjs (`npm run test:production-assets`, network): HEAD-fetches every inventory entry under assets/ images/ vendor/ against `https://dknos.github.io/kaki-rally/` (overridable by argv URL or `KAKI_RALLY_PRODUCTION_URL`), concurrency 8.
>
> Lease-lifecycle smoke gate: tools/smoke-racing-lifecycle.mjs is SOURCE-REGEX based, not runtime. It asserts `export function createRallyAssetLease\s*\(` exists in racingAssets.js and that rally/dunes/trials each contain a literal `session.assetLease = createRallyAssetLease(`. A new mode adding a lease should follow that exact statement form or the regex will need updating.
>
> =====================================================================
>
> 7. MINIMAL CHECKLIST TO ADD A NEW KIT
>
> =====================================================================
>
> 1. Write tools/blender/build-kaki-<name>-kit.py following the RAID template (orchestrator + `<name>_kit/` geometry modules, shared palette dict, RUNTIME_ASSETS tuple, TRIANGLE_BUDGET, audit() with SystemExit, bake_modifiers + deterministic_box_uvs, multi-panel contact sheet to docs/qa/assets/, the exact 11-flag export call with export_extras=True).
>
> 2. Author every root at origin (0,0,0), +Z up in Blender, ground contact at z=0 with a buried skirt; one empty root per prototype, mesh children beneath it.
>
> 3. Pick and stay inside ONE naming convention; if you need runtime LOD use the `_LOD0`/`_LOD1` root suffix; if you need a hidden collider use `_COLLIDER` + `collision_proxy: true` for dune-style runtimes or `COLLIDER_` prefix + `collision: true` for crash-style, and confirm which filter your mode actually runs.
>
> 4. Output to `assets/racing/<mode>/kaki-<name>-kit-v1.glb`; keep the sibling `.blend`.
>
> 5. Add `Object.freeze({ url, kind: 'model' })` to RALLY_ASSET_MANIFEST (route a/b) unless the kit is a frozen experiment (route c + its own validator).
>
> 6. Wire ids: a mode branch in `rallyAssetIds()` / an entry in RALLY_COURSE_ASSETS, or an explicit `assetIds: [...]` at the `createRallyAssetLease` call.
>
> 7. Consume ONLY inside `await lease.ready` or `lease.whenReady(id).then(...)`; never read `lease.models[id]` eagerly. Pass `modelId` explicitly to getModelMesh/getModelMeshes. Clone before mutating a returned mesh's geometry or material.
>
> 8. `try { session.assetLease?.release(); } catch (_) {}` on mode exit.
>
> 9. Run `npm run test:assets` and `npm run assets:inventory`; keep the GLB under 5 MiB and the working set under 20 MiB.
>
> No defects to report -- this audit area was scoped to contract documentation and the findings array is intentionally empty. Two contract caveats surfaced that are NOT visible-placeholder defects but will bite a new kit author: the dead `userData.lod` cull at src/racing/courseFeatureRuntime.js:224 (no node in the workshop kit carries `extras.lod` and nothing assigns it at runtime), and the uncommitted glTF-Transform optimization stage that produced the shipped workshop kit.
>

## Class-D defect register

Status values: `open`, `fixed`, `deferred`.

### P0

#### P0-01 · `src/racing/courseFeatureRuntime.js:215`

- **Node:** `courseWorkshopKit scene root — 29 unnamed EXT_mesh_gpu_instancing nodes`
- **Mode / venue:** draw + trials / every Draw Your Track course and every Trials Workshop custom track
- **Player visible:** True
- **Collision required:** False
- **Problem:** SYSTEMIC ROOT CAUSE. assets/racing/workshop/kaki-course-workshop-kit-v1.glb was put through an out-of-band meshopt/instancing post-process (EXT_meshopt_compression + KHR_mesh_quantization + EXT_mesh_gpu_instancing) that hoisted every repeated mesh into 29 UNNAMED instanced nodes parented at the glTF SCENE ROOT, detaching them from their feature_*/bridge_* parents. Scene roots = 79 = 42 feature roots + 8 bridge modules + 29 orphans. courseFeatureRuntime.js reaches geometry only via scene.getObjectByName(feature.assetNode) (L215-216 circuit, L513 trials, L324-326 bridges) and clones that subtree, so the orphans are never cloned and never rendered. Triangle accounting: 101,651 tris reachable from the named roots vs 39,570 tris (28% of the kit) orphaned and permanently invisible. Verified by diffing the deterministic authoring script tools/blender/build-kaki-course-workshop-kit.py against the node names actually present under each root, and cross-checked: every orphan group (count x tris x material) reconstructs the script's authored totals exactly.
- **Replacement:** Re-export/re-pack kaki-course-workshop-kit-v1.glb so instanced nodes stay parented under their feature_*/bridge_* root (run the packer with instancing off, or with node hierarchy preserved). Secondary belt-and-braces: courseFeatureRuntime.js already handles object.isInstancedMesh in buildModuleTemplate (L156-161) — extend the same handling to prepareClone AND re-attach root-level instanced nodes to the feature whose bounds contain them at load time.
- **Status:** open

#### P0-02 · `src/racing/courseFeatureRuntime.js:393`

- **Node:** `bridge_guardrail_module`
- **Mode / venue:** draw / every drawn course that has an overpass (Kaki Skyway)
- **Player visible:** True
- **Collision required:** False
- **Problem:** The authoring script builds 2 kickboards, 6 posts, 6 post caps, 2 top rails and 4 braces. The shipped GLB subtree contains only ONE post (guardrail_post_-1_-1.55) and ONE cap (guardrail_post_cap_-1_-1.55) — 5 posts and 5 caps are orphaned (matches the detached 5x108 variant_structure + 5x108 variant_trim groups exactly). Result: the skyway guardrail renders as a top rail floating ~1 m above the kickboard with a single post holding it up, on both sides, on every instance along the bridge. This needs no player action — it appears on any drawn track with a bridge and sits at the player's shoulder on the racing line. QA data confirms it ships: docs/qa/browser-matrix.json multiOverpass reports railModules=76, missing=[].
- **Replacement:** Re-export the kit with bridge_guardrail_module's 6 posts + 6 caps parented under the module root (same fix as the systemic finding).
- **Status:** open

#### P0-03 · `src/racing/monsterDestruction.js:485`

- **Node:** `attachMonsterTrafficModels → arena.bodies/roofs/canopies .visible = false`
- **Mode / venue:** Monster Smash / Pileup Pyramid Yard
- **Player visible:** True
- **Collision required:** True
- **Problem:** attachMonsterTrafficModels iterates Object.keys(TRAFFIC_MODEL_NAMES) (9 kinds) but then hides the procedural fallback UNCONDITIONALLY at lines 485-487. MONSTER_TARGET_CLASSES defines two further kinds — haybale and stuntman — that have no ArenaTraffic_* module, so they never receive target.visualInstances. Verified by running the definition module: pileup-pyramid-yard contains 8 haybale + 5 stuntman targets. Once arenaTrafficKit resolves (it is a DEFAULT asset, racingManifest.js:127), those 13 crushable targets render as nothing but 4 tiny torus rings (haybale wheel 0.08 → scale 0.222), 2 detachable panels and 2 bumper capsules. They are not obscure: fire-bale-0-* / fire-bale-1-* form the 'FLAMING BALE TUNNEL' at x=±6.2, z=-8..+4.3, and stunt-line-0..4 form the 'STUNT TEAM WIPEOUT' row at z≈31-34, x=-14..+14 — both straddle the main launch lane from the 'main' spawn at (0,-54). They still collide (monsterOrientedMotionSweep on stats) and still award signature scores, so the player is asked to smash targets that are effectively invisible. Before the kit attaches they render correctly, so this is an attach-time regression, not a missing-asset state.
- **Replacement:** Two options. Minimal: make the fallback hide per-class — only hide bodies/roofs/canopies for targets that actually acquired visualInstances (or keep the three meshes visible and scale the instanced matrices of modelled targets to ~0 as the code already does for inactive targets at lines 1296-1298). Correct: author ArenaTraffic_Haybale (round straw bale, burning variant) and ArenaTraffic_Stuntman (standing figure, 3.4 m) into arena-traffic-kit-runtime-v2.glb and add both to TRAFFIC_MODEL_NAMES + TRAFFIC_MODEL_DIMENSIONS. Do not change stats — collision/scoring read MONSTER_TARGET_CLASSES, not the mesh.
- **Status:** open

#### P0-04 · `src/racing/racingEnvironment.js:1223`

- **Node:** `whisker-yard-judging-zones`
- **Mode / venue:** drift / Whisker Yard
- **Player visible:** True
- **Collision required:** False
- **Problem:** The judging zones are the entire visual identity of Drift Attack and they do not exist on the route. Two separate defects. (1) Geometry: CylinderGeometry(0.34, 0.42, 0.14, 18) pucks with a flat emissive MeshStandardMaterial (color 0xffc15d / emissive 0xff6c9c, no map/normalMap/roughnessMap) — untextured primitives, 0.34 m radius, sitting 1.2 m off the centreline. (2) Data-contract mismatch: line 1213 reads `zone.fraction` and lines 1218/1220 read `zone.type`, but `freezeZone` in src/racing/drift/driftAttack.js:24-35 only emits `from`, `to`, `kind`, `targetLateral`, `width`, `targetSpeed`. `_sampleAtFraction(samples, undefined)` → `Number(undefined) || 0` → index 0, so EVERY marker of every layout is placed on samples[0], and sx/sz always take the else branch (0.84/0.84). Net result: 4-5 pucks piled on top of each other at the start line and zero markers anywhere else on the loop. Corroborated by docs/qa/targeted/webgl-drift/webgl-drift.png — HUD reads "0/4 ZONES" and no marker is visible anywhere along Wall Run. Verified nothing else in the codebase writes `fraction`/`type` onto driftZones (only tracks.js:323 assigns `driftZones: layout.zones`).
- **Replacement:** `feature_drift_zone` from courseWorkshopKit (assets/racing/workshop/kaki-course-workshop-kit-v1.glb — ALREADY leased for the twilight art course, zero manifest change; contains drift_zone_arrow_-6/0/6_mesh with authored workshop_decal materials, catalog footprint [8.5, 18, 1] at courseFeatureCatalog.js:110). CRITICAL: the fix must also remap the fields — from/to → placement span along the spline, kind → variant (initiation/clipping/transition/outside). Swapping geometry alone still piles all arrows on samples[0].
- **Status:** open

### P1

#### P1-01 · `src/racing/courseFeatureCatalog.js:127`

- **Node:** `feature_cone_chicane`
- **Mode / venue:** draw + trials / any course where the player stamps Cone Chicane
- **Player visible:** True
- **Collision required:** True
- **Problem:** The script authors 7 cones x (foot box + cone body + reflective band) = 21 meshes. The GLB subtree contains exactly ONE mesh: chicane_cone_0_foot, a flat 0.9 m black rubber disc. All 7 cone bodies (7x60 variant_paint), all 7 reflective bands (7x256 workshop_chalk) and 6 of 7 feet (6x108 workshop_rubber) are orphaned. The collision is fully implemented and honoured: courseFeatureSurfaces.js:141-164 builds 7 components at radius 0.42 with alternating lateral offsets from collisionProfile.count, and index.js:1068 applies soft-obstacle response to them. The player slaloms through and bumps 7 invisible cones while seeing one black disc on the tarmac.
- **Replacement:** Re-export the kit with all 21 chicane_cone_* meshes parented under feature_cone_chicane.
- **Status:** open

#### P1-02 · `src/racing/courseFeatureCatalog.js:129`

- **Node:** `feature_tire_wall`
- **Mode / venue:** draw + trials / any course where the player stamps Tire Wall
- **Player visible:** True
- **Collision required:** True
- **Problem:** The script authors 10 tyre tori (2 rows x 5) plus 2 painted endcaps. The GLB subtree contains ONLY the 2 endcaps; all 10 tyres are orphaned (detached group 10x256 workshop_rubber = torus, exact match). A 'Tire Wall' renders as two isolated painted posts with empty air between them, while the destructible collision (radius 2.8, durability 70) still occupies the gap — the player crashes into an invisible wall.
- **Replacement:** Re-export the kit with the 10 tire_wall_{row}_{column} tori parented under feature_tire_wall.
- **Status:** open

#### P1-03 · `src/racing/courseFeatureCatalog.js:147`

- **Node:** `feature_grandstand`
- **Mode / venue:** draw / any course where the player stamps Grandstand Module
- **Player visible:** True
- **Collision required:** False
- **Problem:** cat_spectator() authors head + ears + body per spectator, 3 rows x 8 = 24 spectators. The GLB subtree contains 24 stand_cat_*_ears meshes (2-triangle ear plates) and ZERO heads and ZERO bodies — all 48 icospheres are orphaned. The grandstand renders as steps, seats, legs and 24 disembodied pairs of cat ears floating in the air. Verified by count: the orphan 80-tri icosphere groups total 78 = 39 heads + 39 bodies across grandstand (24+24) and crowd (15+15).
- **Replacement:** Re-export the kit with stand_cat_*_head and stand_cat_*_body parented under feature_grandstand.
- **Status:** open

#### P1-04 · `src/racing/courseFeatureCatalog.js:146`

- **Node:** `feature_crowd`
- **Mode / venue:** draw / any course where the player stamps Crowd Section
- **Player visible:** True
- **Collision required:** False
- **Problem:** 18 spectators authored (head + ears + body). The GLB subtree has 18 ears but only 3 heads and 3 bodies (crowd_cat_0_4, 1_1, 1_6 — the three whose material is workshop_foliage_light, i.e. the group too small for the packer to instance). The other 15 spectators are floating ear plates with nothing under them, right behind the safety barrier at trackside.
- **Replacement:** Re-export the kit with all crowd_cat_*_head and crowd_cat_*_body parented under feature_crowd.
- **Status:** open

#### P1-05 · `src/racing/courseFeatureCatalog.js:99`

- **Node:** `feature_tabletop`
- **Mode / venue:** draw + trials / auto-dressed onto drawn tracks (drawTrackThemes.js compileDrawTrackCourse autoPlacements)
- **Player visible:** True
- **Collision required:** False
- **Problem:** This is one of only three jump profiles the theme auto-dressing places without player action (small-kicker / large-launch-ramp / tabletop, drawTrackThemes.js:166-176), so it is seen on ordinary drawn tracks. Script authors 8 crossbraces and 18 edge rails; the GLB subtree has ZERO crossbraces and 12 rails — the 3 plateau rail segments per side (identical geometry) and all 8 structural crossbraces are orphaned. The 18 m tabletop renders with an unsupported deck and rail gaps along the flat top the player lands on.
- **Replacement:** Re-export the kit with tabletop_crossbrace_0_* and the missing tabletop_edge_rail_*_0_{3,4,5} parented under feature_tabletop.
- **Status:** open

#### P1-06 · `src/racing/courseFeatureRuntime.js:376`

- **Node:** `bridge_deck_module / bridge_guardrail_module instancing stride`
- **Mode / venue:** draw / every drawn course that has an overpass
- **Player visible:** True
- **Collision required:** False
- **Problem:** Separate defect from the orphan-geometry one, same file. span = hypot(next - previous) * 0.58 = 1.16 x sample spacing, but deck modules are emitted every deckStep=2 samples and rails every railStep=4. Deck coverage is therefore 1.16/2 = 58% of the elevated run (29% at quality 'low', deckStep=4); guardrail coverage is ~31%. The 0.58 factor is calibrated for a step of 1. The Skyway therefore renders as a chain of disconnected deck slabs with ~40% gaps and intermittent railings under a continuous road surface. Analytical result is independent of sample spacing, so it reproduces on every size preset. QA numbers are consistent (deckModules 155 / railModules 76 over a 1633.8 m route with 5 overpasses).
- **Replacement:** Set span to the full inter-module stride (deckStep x sample spacing, plus a few percent overlap) rather than 0.58 x the prev->next distance, and scale railStep the same way — no new art required.
- **Status:** open

#### P1-07 · `src/racing/index.js:378`

- **Node:** `repair bay pad (_buildFeaturePads)`
- **Mode / venue:** drift + stock / Whisker Yard + Kaki Thunderbowl
- **Player visible:** True
- **Collision required:** False
- **Problem:** Both venues set `repairFractions: [0.88]` (tracks.js:294 for stock, tracks.js:321 for drift), so `_buildFeaturePads` builds one repair bay per course. It is a `_roundedPadGeometry(3.2, 6.8, 0.08, 0.32)` slab plus three CapsuleGeometry(0.15, 5.1) sausages, ALL sharing one solid mint-emissive MeshStandardMaterial (color 0x63ffc2, emissive 0x21d895, emissiveIntensity 1.2, no map, line 369-374). No pit-lane markings, no bay structure, no signage. It is placed ON the racing surface at `-(trackWidth * 0.36)` lateral (= 5.33 m in, inside the 7.4 m half-width) at y+0.18, so the player drives over a glowing green blob with three glowing green sausages on it — 8 times per Stock Cup race. The Thunderbowl HUD explicitly advertises it ("GREEN PIT LANE REPAIRS DAMAGE", visible in docs/qa/targeted/webgl-stock/webgl-stock.png), so it is a feature the player is told to look for.
- **Replacement:** `feature_repair_bay` from courseWorkshopKit — the node exists in the GLB scene root and the kit is already leased for every rally course, so this is a zero-manifest-change swap. Route it through the same authored-asset path `buildCircuitFeatureVisuals` already uses for Draw Your Track (index.js:483-492).
- **Status:** open

#### P1-08 · `src/racing/index.js:340`

- **Node:** `ramp deck + rails (_buildFeaturePads)`
- **Mode / venue:** drift / Whisker Yard
- **Player visible:** True
- **Collision required:** False
- **Problem:** Whisker Yard has jump kickers on it that nobody authored for it. The drift branch of `getCourseDefinition` (tracks.js:307-327) spreads `...driftBase` (= RACE_COURSES.twilight, because `artCourseId: 'twilight'`) and then never overrides `rampFractions` or `boostFractions` — unlike the stock branch, which explicitly zeroes both at tracks.js:292-293. So all three drift layouts inherit twilight's `rampFractions: [0.29, 0.74]` and build two launch ramps against a completely different spline. The geometry itself is placeholder: `_roundedPadGeometry(trackWidth * 0.62, 5.1, 0.32, 0.3)` deck tilted -0.11 rad on a flat-colour MeshStandardMaterial (0x7b5133, no map, line 328-332) plus two emissive CapsuleGeometry rails. A ramp deck is visible crossing the road in the distance in docs/qa/targeted/webgl-drift/webgl-drift.png.
- **Replacement:** Preferred: delete them — add `rampFractions: []` and `boostFractions: []` to the drift return object in tracks.js:310-326, matching what the stock branch already does. A drift venue should not have jump kickers. If ramps are genuinely wanted, use `feature_small_kicker` / `feature_large_launch` from courseWorkshopKit (already leased; authored workshop_laminated_wood + grippy-deck materials, versus the current flat 0x7b5133).
- **Status:** open

#### P1-09 · `src/racing/monsterArena.js:773`

- **Node:** `barriers / 'crown-chaos-safety-barrier' — instanced BoxGeometry(1,1,1)`
- **Mode / venue:** Monster Smash / both arenas (Crown Chaos + Pileup Pyramid)
- **Player visible:** True
- **Collision required:** False
- **Problem:** Untextured BoxGeometry scaled 6.5 × 1.25 × 0.45, MeshStandardMaterial with no map/normalMap/roughnessMap and three flat instance colours (0xffd274 / 0xff6ca7 / 0x62dff2). 40+ instances form the arena perimeter ring at (stadiumX-2, stadiumZ-2) = 80×61 for Crown Chaos and 118×86 for Pileup — the closest environment geometry to the racing line. Gameplay bounds are ±88/±68 (softX/softZ 78/59) and ±126/±94 (116/84), so the ring sits partway up the stadium-berm slope well inside the drivable area; I found no collision backing it (resolveMonsterArenaBounds clamps only at bounds; monsterArenaContact returns no barrier contact), so the berm carries the player right up to these boxes at close range. Authored ArenaKit_ConcreteBarrier, ArenaKit_Guardrail and ArenaKit_FencePanel all exist in monster-arena-environment-kit-v1.glb, which IS in the default asset list (racingManifest.js:128) and IS already downloaded and parsed on this path — attachMonsterStoryDressing simply never instances them, because _stadiumModulePlacements is only called from attachMonsterEnvironmentKit, which requires ?monsterAssets=full (index.js:2727-2731; no caller passes options.monsterProductionAssets).
- **Replacement:** Add ArenaKit_ConcreteBarrier + ArenaKit_Guardrail + ArenaKit_FencePanel (and optionally ArenaKit_BrokenBarrier) to attachMonsterStoryDressing using the existing _stadiumModulePlacements barriers/guardrails/fences arrays. Zero extra download; the GLB is already in memory. Keep the procedural ring as the pre-attach fallback.
- **Status:** open

#### P1-10 · `src/racing/monsterDestruction.js:373`

- **Node:** `wheels / 'arena-pop-wheels' — TorusGeometry(0.28, 0.12, 5, 8)`
- **Mode / venue:** Monster Smash / both arenas (Crown Chaos + Pileup Pyramid)
- **Player visible:** True
- **Collision required:** False
- **Problem:** An 8-sided open torus (outer radius 0.40, hole radius 0.16, 5 radial segments) is instanced 4× per target and rendered permanently — attachMonsterTrafficModels hides only bodies/roofs/canopies. I read the traffic GLB accessor data: ArenaTraffic_Sedan_Body_0 already contains 4 modelled wheels (radius ~0.21, centre y=0.21, outer face |x|≈0.95, 4 even 55-vertex corner clusters). The pooled ring for a sedan lands at radius 0.40, y=0.36, |x|=1.1475 with instance scale 1.0 — ~1.9× the modelled radius, 0.15 m too high, and its tube reaches x=1.2675 versus a 1.145 body flank, so it protrudes past the car's side as a chunky octagonal donut with a visible hole. 144 rings in Crown Chaos, 488 in Pileup. Second, separate defect at the placement loop (lines 1506-1517): unlike bodies/roofs/canopies/visualInstances, the wheel loop has no dominoGroup branch, so for the 78 domino cars standing vertically on their bumpers the 4 rings are laid out flat on the ground in a width × 0.62·length rectangle around the base, ±1.29 m fore/aft of a car that has almost no XZ footprint.
- **Replacement:** Keep the pooled InstancedMesh — the axleCrush-driven 'pop' displacement (line 1511) is a gameplay tell and must survive. (a) While arena.trafficModelsAttached, drive the rest pose to scale ~0 and only reveal a ring when axleCrush > 0.16; or rescale to ~stats.wheel*0.58 and inboard to stats.width*0.43 so it reads as the modelled tyre. (b) Add a _composeDominoPart branch mirroring lines 1369-1379 so domino cars carry their wheels. Best long-term: add an ArenaTraffic_Wheel module to the kit and instance that for the pop-off pool.
- **Status:** open

#### P1-11 · `src/racing/racingEnvironment.js:1278`

- **Node:** `thunderbowl-concrete-grandstands / thunderbowl-clay-grandstands`
- **Mode / venue:** stock / Kaki Thunderbowl (concrete + clay)
- **Player visible:** True
- **Collision required:** False
- **Problem:** The stadium the venue is named after is six literal boxes. `standGeometry = new THREE.BoxGeometry(6.8, 2.3, 3.1)` (line 1254) with a flat-colour MeshStandardMaterial (0x788697 concrete / 0x8a4f58 clay, no map, no normalMap, no roughnessMap, line 1246-1252), instanced 6 times at `trackWidth * 0.5 + 10.5` lateral. No crowd, no roof, no structure, no stairs — an unlit grey slab. Visible on the horizon in docs/qa/targeted/webgl-stock/webgl-stock.png as flat grey rectangles against the sky. Only 6 modules for a 128 x 102 m oval that is lapped 8 times, so they read as stray blocks rather than a bowl.
- **Replacement:** Cheapest: `feature_grandstand` (footprint [15, 8, 8], courseFeatureCatalog.js:147) + `feature_crowd` ([12, 5.5, 4.4], line 146) from courseWorkshopKit — already leased for every biome including stock, zero manifest change. Higher fidelity but needs a NEW manifest entry: `ArenaKit_GrandstandBay_Mesh` from assets/racing/monster-arena/models/monster-arena-environment-kit-v1.glb (authored Arena_Palette_PBR). NOTE footprint delta: 15 x 8 x 8 vs the current 6.8 x 2.3 x 3.1 — the `trackWidth * 0.5 + 10.5` offset and the 6 fractions must be re-spaced or the stands will crowd the track.
- **Status:** open

#### P1-12 · `src/racing/racingEnvironment.js:1306`

- **Node:** `thunderbowl-clay-cushion`
- **Mode / venue:** stock / Kaki Thunderbowl · Clay
- **Player visible:** True
- **Collision required:** False
- **Problem:** `ConeGeometry(0.72, 1.25, 7)` (line 1298) with a flat brown MeshStandardMaterial (0xb87655, no maps, line 1297), instanced 6 times. A dirt-oval cushion is a continuous packed-clay berm banked up along the outer wall — the whole point of the surface, and tracks.js:52 sells it in the tagline ("lean on the cushion") with a real `cushionGrip: 0.66` physics value. What ships is six isolated 7-sided cones that read as traffic cones. This is the closest venue dressing to the racing line (`trackWidth * 0.5 + 1.8` = 9.7 m from centre, 1.8 m past the track edge) so it is in frame constantly. Secondary: the transform (line 1304) uses `sample.y + 0.62` with no bank term while the road ribbon IS banked (_ribbonGeometry line 213-219 applies `tan(sample.bank)`, and stock corner bank is -0.47 rad per tracks.js:44/61), so on the corners the cones sit roughly 4 m above or below the track edge they are supposed to line. Any replacement must be bank-aware.
- **Replacement:** An authored continuous berm ribbon along the outer edge, built with the same `_ribbonGeometry` cross-section helper so it inherits `tan(sample.bank)` — reuse the clay road maps already loaded via ROAD_ASSETS. If discrete markers really are the intent, `ArenaKit_Cone_Mesh` from the monster-arena kit (NEW manifest entry required).
- **Status:** open

#### P1-13 · `src/racing/racingEnvironment.js:788`

- **Node:** `rally-guard-posts / rally-guard-rails (stockWall branch)`
- **Mode / venue:** stock / Kaki Thunderbowl (concrete + clay)
- **Player visible:** True
- **Collision required:** False
- **Problem:** The Thunderbowl's retaining barrier — the single most-seen object in an oval race — is built from the wrong primitive generator. Line 784 calls `_spireGeometry(1.25, 0.18, 6, rc, 31)`, which is the noise-wobbled rock/crystal spire builder used for `cinder-rock-spires` and `void-rift-crystals` (lines 972-981), reused verbatim as fence posts. Rails are `CapsuleGeometry(0.12, 1.35, 3, 6)`. Both share one flat MeshStandardMaterial (0x948b88, roughness 0.42, metalness 0.64, no map/normalMap, line 787). A short oval running a 27-degree bank needs a solid continuous concrete wall with catch fence, not lumpy rock-shaped posts with sausage rails every 6th sample. Also note the transforms (lines 755-768) use `sample.y + 0.86 / + 1.16` with no bank term, so on the banked corners the whole barrier detaches from the track edge — clearly visible in docs/qa/targeted/webgl-stock/webgl-stock-pack.png where the tan and red bars float out over the dark terrain well away from the ribbon edge.
- **Replacement:** `bridge_guardrail_module` from courseWorkshopKit (already leased) as a stopgap, or a purpose-built banked concrete wall ribbon driven by `_ribbonGeometry` so it inherits the bank. Higher fidelity: `ArenaKit_Guardrail_Mesh` / `ArenaKit_ConcreteBarrier_Mesh` from monster-arena-environment-kit-v1.glb (NEW manifest entry). SCOPE WARNING: `_buildCurbsAndRails` is shared with monster mode (`stockWall = course.mode === 'stock' || course.mode === 'monster'`, line 734) — the change must stay inside the `if (stockWall)` block at lines 783-790, or be gated on `course.mode === 'stock'`.
- **Status:** open

#### P1-14 · `src/racing/racingEnvironment.js:1151`

- **Node:** `sponsorGeometry / sponsorMaterial → 'rally-decal-atlas-board' panel`
- **Mode / venue:** circuit (also drift/stock/draw — every non-monster course) / All six Off-Road GP venues: Borrowed Post Switchback (forest), Nobody's Turn (twilight), Kiln-Shift Circuit (cinder), Quiet Toll Run (void), Glass Mile (cave), Chalkline Loop (kakiland)
- **Player visible:** True
- **Collision required:** False
- **Problem:** PlaneGeometry(5.2, 3.25) is built with default 0..1 UVs and given `map: atlasTexture`, where atlasTexture is kaki-rally-decal-atlas-imagegen-v1.webp — a 1024x1024 4x4 CONTACT SHEET of 16 separate stickers (verified by decoding the image: paw shield, crown wheel, cannon star, fishbone, wrenches, checker paw, moon, flame tyre, claws, crystals, comet, mud shield, blossom, yarn, cat eye, KAKI wordmark), each cell framed by a pink dashed border on a dark purple field. buildRallyEnvironment lines 1382-1385 explicitly set wrapS/wrapT = ClampToEdge and repeat(1,1), so the WHOLE sheet is squashed from 1:1 onto a 1.6:1 opaque DoubleSide panel. Three of these are placed per course at lateral trackWidth*0.5 + 8.2 (8.2 m from the road edge, at course fractions 0.12 / 0.43 / 0.71) — squarely in the driving sightline. The clincher: this repo already has the atlas cell convention — `_atlasPlaneGeometry(width, height, tile)` at src/racing/racingVehicles.js:305 rewrites the four plane UVs to a 4x4 cell and is used for every kart decal. The environment ignores it. This is a raw sprite sheet rendered in-world.
- **Replacement:** Give each board a single atlas cell by rewriting the plane UVs (reuse/export `_atlasPlaneGeometry`'s tile convention, one geometry per board, tile chosen from _courseSalt so venues differ), or author a dedicated trackside banner texture. MUST be UV-based, not texture.offset/repeat: the atlas Texture object is caller-owned (passed in as `atlasTexture` from index.js:460) and shared with the kart decal materials, so mutating offset/repeat would corrupt every vehicle decal.
- **Status:** open

#### P1-15 · `src/racing/trialsEnvironment.js:513`

- **Node:** `trials-terrain-mass-{rangeIndex} (THREE.ExtrudeGeometry + materials.earth)`
- **Mode / venue:** trials / Meadow, Quarry, Crown
- **Player visible:** True
- **Collision required:** False
- **Problem:** The extruded terrain mass is the single dominant surface in the lower half of every Trials frame (the +Z cross-section cap at z=+4.4, facing the ortho side camera at vehicle.z+41), and its authored ground texture never resolves. ExtrudeGeometry's cap UVs come from WorldUVGenerator.generateTopUV, which I confirmed in the vendored build (vendor/three/build/three.core.js:35490) returns raw world (x,y) with no normalisation. materials.earth (line 377) is built with map/normalMap/roughnessMap at repeat [3.8, 2.4] (lines 373-375), so the cap tiles 3.8 times per world metre horizontally and 2.4 vertically. Across a ~38-unit-wide ortho frame that is ~13 px per tile at 1080p, i.e. mipmapped into a featureless wash. The same three textures are used correctly elsewhere in the file: _stripGeometry divides x by 12 (line 324) and _sideRibbonGeometry divides x by 18 (line 345) — the extrude path divides by nothing, so this cap was never UV-authored. Combined with color .lerp(0xffffff, 0.58) on line 378 the wall reads as a pale flat slab sitting under a fully painted backdrop.
- **Replacement:** No new asset needed. Supply a custom UVGenerator to ExtrudeGeometry, or rescale geometry.attributes.uv after construction to roughly x/12, y/12 so the existing forest/cave/kakiland terrain-v2 maps land at the same density as the turf/trail strips.
- **Status:** open

#### P1-16 · `src/racing/trialsEnvironment.js:789`

- **Node:** `trials-cloud-bank (InstancedMesh, SphereGeometry(1,12,8) + MeshBasicMaterial)`
- **Mode / venue:** trials / Quarry
- **Player visible:** True
- **Collision required:** False
- **Problem:** Quarry's authored backdrop (assets/racing/backdrops-v2/trials-quarry-backdrop.webp) is an enclosed CAVE interior — rock ceiling, timber braces, hanging paw lanterns, a god-ray shaft. The generic cloud bank is still built for it and drifts horizontally across that cave. It is in frame: puffs sit at y = baseline+34+hash*12 with baseline = min(4.5)-15 = -10.5, so y 23.5-35.5 with the lowest puff edge near 21.4; the side camera's frame top is ground+13.2, and quarry terrain runs 12-30 over most of the back half (x=620 onward), so white blobs cross the cave roof for large stretches. The material is MeshBasicMaterial (unlit, fog:false, depthWrite:false), transparent renderOrder 0, so it draws over the backdrop as flat untextured ellipses. Note the themeId==='quarry' special-casing on both colour (0xe9eef0) and opacity (0.48) at lines 783-786 — someone already noticed it read wrong here and dimmed it rather than removing it.
- **Replacement:** Suppress the cloud bank entirely when the venue backdrop is an interior (add a `clouds: false` flag to TRIALS_WORLD_PROFILES.quarry) and, if drifting parallax is wanted, swap in a cave-appropriate element: instanced dust motes / glowmoss spore drift, or a scrolling low-opacity god-ray plane.
- **Status:** open

#### P1-17 · `tools/blender/build-kaki-dune-environment-kit.py:456`

- **Node:** `DuneMesa_A_LOD0 / DuneMesa_A_LOD1 (build_mesa)`
- **Mode / venue:** Kaki Dune Run + Kaki Rally Raid (raid stages run on the dune runtime via duneRallyRaid.js) / All 8 dune-runtime courses: whiskerwind, sunspine, mirage, litterbox, raid-prologue, raid-wadi-crossing, raid-saltline, raid-night-ridge
- **Player visible:** True
- **Collision required:** True
- **Problem:** build_mesa emits nothing but 4 (LOD0) / 2 (LOD1) nested beveled boxes: bpy.ops.mesh.primitive_cube_add scaled to width 5.6-3.44, stacked on Z, with per-layer rotations of only 0.02-0.035 rad. No displacement, no noise, no sculpt. GLB bounds measure LOD0 at 11.20 x 4.49 x 5.60 m and LOD1 at 11.20 x 2.60 x 5.60 m. duneEnvironment.js:220-232 places 8 of these at worldSize*0.48 with scale 3.8/4.6/5.4, so on-screen they are 42.6-60.5 m wide and 17.1-24.2 m tall (LOD0) or 9.9-14.0 m tall (LOD1) -- the entire horizon silhouette of every dune map. I computed the actual min distance from each course's routeRuntime.samples to the 8 ring positions: on mirage the nearest mesa is 63 m from the racing line, raid-saltline 56 m, raid-prologue 103 m -- all inside the addLodAsset 125 m LOD0 switch (duneEnvironment.js:72), so the player sees the 4-tier box stack close up. On the other 5 courses every mesa is 141-275 m out, so LOD1's TWO stacked boxes are permanently the only skyline feature. This is not the house style: flat untextured PBR with paired sun/shade materials is used across both kits deliberately, but every other kit piece has authored form. The damning contrast is in-repo and same-role: RaidMesa-0 in the raid kit is 1448 tris across RaidSandApron/RaidRockDark/RaidRock/RaidRockWarm with a sculpted apron, while the dune mesa is 108 tris per rectangular slab.
- **Replacement:** Port the tools/blender/raid_kit/ sculpt approach that produced RaidMesa-0 (1448 tris, 4-material stratification, sand apron at the base) to build_mesa. RaidMesa-0 is the in-repo reference for exactly this asset role and already ships. Keep the 2-tier LOD1 but give it a sculpted profile rather than 2 boxes, since 5 of 8 courses never see LOD0.
- **Status:** open

#### P1-18 · `tools/blender/build-kaki-dune-environment-kit.py:406`

- **Node:** `DuneWreckedRallyProp_A (build_wreck)`
- **Mode / venue:** Kaki Dune Run + Kaki Rally Raid (dune runtime) / All 8 dune-runtime courses as a fixed landmark at route progress 0.31; additionally at every draw-track 'construction-equipment' and 'toy-cars' placement
- **Player visible:** True
- **Collision required:** True
- **Problem:** A wrecked rally car is built from 6 primitives: Wreck_CrushedBody is one beveled cube scaled (1.25, 2.05, 0.52) tilted 0.06/0.08/-0.08 rad, Wreck_CollapsedRoof is a (0.88, 0.92, 0.18) slab, Wreck_BentBumper a (1.45, 0.12, 0.12) bar, plus 4 cylinders for wheels. Total 108 tris for the body. GLB bounds are 2.98 x 1.62 x 4.56 m -- correctly car-sized, which is what makes it read as a red box with four cylinders rather than as a wreck. No wheel arches, no glazing, no panel breakup, no debris. Within the SAME kit, DuneScrub_A got 5 authored branch meshes plus 5 leaf clusters plus a stem (~1900 tris) and DuneOasis_A got 16 curve-swept palm leaves; the hero wreck landmark got the least authoring of anything in the file. Proximity makes it unavoidable: duneEnvironment.js:184 places it at progress 0.31 at 11 m lateral offset. Against the per-event routeWidth values (whiskerwind 24, sunspine 19, mirage 22, litterbox 30) the 2.98 m wide prop centered at 11 m spans 9.65-12.35 m lateral, which OVERLAPS the driveable corridor on mirage (half-width 11 m) and sits 4 m inside it on Big Litterbox (half-width 15 m). The player drives within a few metres of it every lap. It is also the fallback for three different semantic roles -- drawPlacementAsset (duneEnvironment.js:250) returns it for both 'construction-equipment' and 'toy-cars' -- so one red box-car stands in for a wreck, a digger, and a toy car.
- **Replacement:** Author a real wrecked-vehicle prop: silhouette-breaking crumple on the body shell, wheel arches, a detached/leaning wheel, an open hood or torn panel. assets/racing/crash/kaki-catastrophe-vehicles-v2.glb may have a reusable body shell to crush rather than modelling from scratch. Separately, give 'construction-equipment' and 'toy-cars' their own kit pieces instead of aliasing the wreck.
- **Status:** open

### P2

#### P2-01 · `src/racing/courseFeatureCatalog.js:102`

- **Node:** `feature_step_up`
- **Mode / venue:** draw + trials / any course where the player stamps Step-Up
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 8 crossbraces (range(0,45,6)) plus 18 edge rails and 4 bolts. The GLB subtree has all 18 rails but ZERO crossbraces and zero bolts. The 15 m ramp reads as a bare laminated shell with no visible substructure, unlike small-kicker which is complete.
- **Replacement:** Re-export the kit with step-up_crossbrace_0_* parented under feature_step_up.
- **Status:** open

#### P2-02 · `src/racing/courseFeatureCatalog.js:103`

- **Node:** `feature_step_down`
- **Mode / venue:** draw + trials / any course where the player stamps Step-Down
- **Player visible:** True
- **Collision required:** False
- **Problem:** Identical to step-up: 8 authored crossbraces and 4 bolts are orphaned; only the 18 edge rails, deck, 2 laminated sides and badge survive under feature_step_down.
- **Replacement:** Re-export the kit with step-down_crossbrace_0_* parented under feature_step_down.
- **Status:** open

#### P2-03 · `src/racing/courseFeatureCatalog.js:100`

- **Node:** `feature_double_jump`
- **Mode / venue:** draw + trials / any course where the player stamps Double Jump
- **Player visible:** True
- **Collision required:** False
- **Problem:** The double profile produces two runs; the script authors 9 crossbraces on run 0 and 7 on run 1 (16 total). The GLB subtree contains exactly one (double_crossbrace_0_10) — 15 are orphaned. Both takeoff and landing lips render with unsupported overhanging decks across a 5.2 m gap the player jumps.
- **Replacement:** Re-export the kit with double_crossbrace_0_* and double_crossbrace_1_* parented under feature_double_jump.
- **Status:** open

#### P2-04 · `src/racing/courseFeatureCatalog.js:101`

- **Node:** `feature_rollers`
- **Mode / venue:** draw + trials / any course where the player stamps Roller Bumps
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 16 edge-rail beams (8 segments x 2 sides). The GLB subtree has exactly ONE (rollers_edge_rail_-1_0_0) — the sine profile makes every segment geometrically identical so the packer instanced all 15 others to the scene root (detached group 15x276 variant_trim, exact match). The 16 m roller section renders with one stub of rail on one side and nothing on the other.
- **Replacement:** Re-export the kit with rollers_edge_rail_{-1,1}_0_* parented under feature_rollers.
- **Status:** open

#### P2-05 · `src/racing/courseFeatureCatalog.js:126`

- **Node:** `feature_rumble`
- **Mode / venue:** draw + trials / any course where the player stamps Rumble Strip
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 16 alternating white/painted teeth spanning the 10 m strip (z = -4.75 to +4.7). The GLB subtree has 2 (rumble_tooth_0 at z=4.75, rumble_tooth_1 at z=4.12); the other 14 are orphaned (7x108 workshop_chalk + 7x108 variant_paint). A 10 m rumble strip renders as two 0.5 m teeth at one end, while the rumble surface profile still applies grip/drag along the whole footprint.
- **Replacement:** Re-export the kit with rumble_tooth_2..15 parented under feature_rumble.
- **Status:** open

#### P2-06 · `src/racing/courseFeatureCatalog.js:133`

- **Node:** `feature_hay_bales`
- **Mode / venue:** draw + trials / any course where the player stamps Hay Bales
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 5 hay cylinders plus 10 rope band tori (2 per bale). The GLB subtree has the 5 bales and ZERO ropes (detached group 10x256 workshop_rope, exact match). The bales render as untied flat-shaded yellow cylinders — the single detail that made them read as hay bales rather than primitives is gone.
- **Replacement:** Re-export the kit with hay_rope_*_* parented under feature_hay_bales.
- **Status:** open

#### P2-07 · `src/racing/courseFeatureCatalog.js:134`

- **Node:** `feature_barrels`
- **Mode / venue:** draw + trials / any course where the player stamps Barrel Stack
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 3 barrels x (drum + 3 hoop bands + cap) = 15 meshes. The GLB subtree has 6 (3 drums + 3 caps) — all 9 hoop bands are orphaned (detached group 9x256 variant_structure, exact match). The barrels render as bare capped cylinders.
- **Replacement:** Re-export the kit with barrel_*_band_* parented under feature_barrels.
- **Status:** open

#### P2-08 · `src/racing/courseFeatureCatalog.js:128`

- **Node:** `feature_barrier_chicane`
- **Mode / venue:** draw + trials / any course where the player stamps Barrier Chicane
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 3 barriers x (body + 3 hazard stripes + 2 ground feet) = 18 meshes. The GLB subtree has 7: 3 bodies, 3 stripes (barrier_left x2, barrier_exit x1) and 1 foot. Six stripes and five feet are orphaned, so two of the three barriers render unstriped and all but one float without their ground feet.
- **Replacement:** Re-export the kit with barrier_*_stripe_* and barrier_*_foot_* parented under feature_barrier_chicane.
- **Status:** open

#### P2-09 · `src/racing/index.js:358`

- **Node:** `boost pad plates (_buildFeaturePads)`
- **Mode / venue:** drift / Whisker Yard
- **Player visible:** True
- **Collision required:** False
- **Problem:** Same inheritance leak as the ramps: the drift branch of `getCourseDefinition` (tracks.js:307-327) never overrides `boostFractions`, so all three Whisker Yard layouts inherit twilight's `[0.08, 0.53, 0.9]` and build three boost pads. Each pad is five `_roundedPadGeometry(trackWidth * 0.14, 2.7, 0.07, 0.18)` lozenges sharing one solid emissive MeshStandardMaterial in `course.accent` (0x71d7ff for twilight, no map, line 333-337) — flat glowing bars with no chevrons, arrows or direction cue. The pale-cyan lozenges scattered across the road in docs/qa/targeted/webgl-drift/webgl-drift.png match this material exactly.
- **Replacement:** Preferred: remove with the ramps by setting `boostFractions: []` in the drift return object in tracks.js:310-326. If kept, use `feature_boost_pad` from courseWorkshopKit (already leased — the GLB contains authored boost_chevron_-0.9_mesh / boost_chevron_0.55_mesh with workshop_decal materials).
- **Status:** open

#### P2-10 · `src/racing/monsterArena.js:986`

- **Node:** `gantry / 'pileup-{car,bus}-pyramid-gantry' — BoxGeometry poles, beam, beacons`
- **Mode / venue:** Monster Smash / Pileup Pyramid Yard
- **Player visible:** True
- **Collision required:** False
- **Problem:** Each impact pad gets 2× BoxGeometry(0.5,10,0.5) poles, a BoxGeometry(width-2.4, 0.65, 0.65) beam and 5× BoxGeometry(1.1,0.32,0.24) beacons, on flat untextured materials (steel 0x242b31, lamp 0xffd36d — no maps of any kind). They stand 2.2 m off the near edge of the car and bus pyramids, i.e. framing the two primary crush targets the isometric camera is deliberately pointed at (see the comment at line 988). Nothing hides them in default play: the story-dressing hide branch at line 1311 is gated on definition.dressing !== 'pyramid-yard', and the gantry hide at line 1260 only runs in attachMonsterEnvironmentKit.
- **Replacement:** Author an ArenaKit_Gantry module (truss uprights + lamp bar) into the environment kit and instance it from attachMonsterStoryDressing at the same two placements; ArenaKit_Scaffold is the closest already-loaded module and would be an acceptable stopgap. At minimum give the steel material the Arena_Palette_PBR map the rest of the kit uses. Purely decorative — no collision or scoring reads these.
- **Status:** open

#### P2-11 · `src/racing/monsterArena.js:763`

- **Node:** `stands / 'crown-chaos-grandstand-tiers' + the four light towers (lines 790-807)`
- **Mode / venue:** Monster Smash / both arenas (Crown Chaos + Pileup Pyramid)
- **Player visible:** True
- **Collision required:** False
- **Problem:** The grandstand is instanced BoxGeometry(1,1,1) on a flat 0x464756 MeshStandardMaterial with no maps, 3 tiers × ~2×(2·longSegments+1) + 2×(2·shortSegments+1) segments, wrapping the whole arena. The four floodlight towers are a CylinderGeometry pole plus a BoxGeometry(5.8,1.3,0.9) lamp, 22 m tall, silhouetted against the sky from anywhere in the bowl. Both live in the group literally named '<id>-stadium-loading-fallback' (line 693) and are hidden only by attachMonsterEnvironmentKit (line 1253), which never runs by default. ArenaKit_GrandstandBay and ArenaKit_LightTower are in the already-parsed kit and unused on this path. Weigh this one rather than treat it as an obvious bug: the docstring at 1272-1277 says keeping the cheap shell is intentional, ~50 GrandstandBay placements is a real cost the 12 story modules are not, and the textured crowd cards in front (added to group, always visible) carry most of the read.
- **Replacement:** Instance ArenaKit_GrandstandBay (stadium.stands, ~50 placements) and ArenaKit_LightTower (4 placements) from attachMonsterStoryDressing, hiding the corresponding fallback meshes only when the instancing succeeds. If the bay count is too expensive, the 4 towers alone are cheap and remove the most conspicuous untextured silhouette.
- **Status:** open

#### P2-12 · `src/racing/monsterDestruction.js:1498`

- **Node:** `bumpers / 'arena-detachable-bumpers' — CapsuleGeometry(0.1, 1.9)`
- **Mode / venue:** Monster Smash / Pileup Pyramid Yard
- **Player visible:** True
- **Collision required:** False
- **Problem:** Same root cause as the pop-wheels: the pooled detail meshes (wheels, bumpers) are the only per-target visuals lacking the dominoGroup branch that bodies, roofs, canopies and visualInstances all have. bumperPoint is _localPoint(target, …, front * (stats.length*0.5 + …)) taken from target.x/z, and the composed pitch comes only from axleCrush — so on the 78 domino cars standing vertically on their bumpers, the two capsules float roughly ±2.1 m in front of and behind the car at y = ground + stats.wheel*0.72, horizontal and completely detached from a car that is standing on end. 156 floating bars along the perimeter run the player is meant to topple. For upright cars this is harmless: half-span 1.05 in X against a 1.145 body flank puts them inside the authored silhouette — do not 'fix' those.
- **Replacement:** Add a _composeDominoPart branch to the bumper (and panel) placement in the same pass as the wheels, so the detail meshes inherit the domino pose matrix. Alternatively scale bumpers to ~0 while target.dominoGroup && target.dominoState !== 'fallen'. Presentation only — bumpers are never read by collision or scoring.
- **Status:** open

#### P2-13 · `src/racing/racingEnvironment.js:1239`

- **Node:** `whisker-yard-floodlight-poles / whisker-yard-floodlight-heads`
- **Mode / venue:** drift / Whisker Yard
- **Player visible:** True
- **Collision required:** False
- **Problem:** A floodlight built as a lollipop. `CylinderGeometry(0.075, 0.12, 5.6, 8)` pole (line 1225) with a flat MeshStandardMaterial (0x263142, no maps, line 1227), topped by a bare `SphereGeometry(0.22, 10, 7)` (line 1226) that reuses `zoneMaterial` — the same orange/pink judging-puck material — as its lamp head. No housing, no gantry, no lamp array, and no actual light is emitted (unlike the catalog entry, which declares `gameplay: { kind: 'local-light' }`). Only 3 instances are placed (fractions 0.16/0.48/0.82) across a loop that is 500 m+ on the Wall Run layout, so they read as isolated sticks rather than venue lighting. None are in frame in docs/qa/targeted/webgl-drift/webgl-drift.png.
- **Replacement:** `feature_floodlights` from courseWorkshopKit (footprint [5, 3, 8.8], courseFeatureCatalog.js:145) — already leased for the twilight art course, zero manifest change, and carries the `local-light` gameplay hook. Higher fidelity: `ArenaKit_LightTower_Mesh` from monster-arena-environment-kit-v1.glb (NEW manifest entry). Increase the instance count while you are in there.
- **Status:** open

#### P2-14 · `src/racing/racingEnvironment.js:1287`

- **Node:** `thunderbowl-scoring-pylon`
- **Mode / venue:** stock / Kaki Thunderbowl (concrete + clay)
- **Player visible:** True
- **Collision required:** False
- **Problem:** A box on a box standing in for the oval's scoreboard. `BoxGeometry(1.65, 7.5, 1.65)` body (line 1281) + `BoxGeometry(3.1, 1.6, 0.38)` 'display' (line 1282), both flat-colour MeshStandardMaterials with no map (0x334052 / 0x9b586a body line 1283, emissive 0xffcf5b glow cap line 1284). The display face carries no scoreboard texture at all despite the decal atlas already being loaded and passed into `_buildInfrastructure` for the sponsor boards. Two placement bugs make it read as broken rather than stylized: (a) `_placeObject(pylon, pylonSample, ..., 0)` at line 1293 puts the group origin at track level while `pylonBody` sits at local y = 0, so the centred 7.5 m box is half buried — only 3.75 m is above ground; (b) `pylonTop.position.y = 4.0` while the body top is at 3.75, so the glowing cap floats 0.25 m clear of the tower. Visible as a plain dark rectangle against the sky in docs/qa/targeted/webgl-stock/webgl-stock.png.
- **Replacement:** `ArenaKit_ScoreboardFrame_Mesh` from assets/racing/monster-arena/models/monster-arena-environment-kit-v1.glb (NEW manifest entry, authored Arena_Palette_PBR). Zero-cost alternative: `feature_billboard` from courseWorkshopKit ([8.5, 2.5, 6.2], courseFeatureCatalog.js:144, already leased) with a scoreboard frame from the decal atlas. Either way lift the body so its base sits at ground level and seat the cap flush.
- **Status:** open

#### P2-15 · `src/racing/racingEnvironment.js:1279`

- **Node:** `thunderbowl-spectator-rows`
- **Mode / venue:** stock / Kaki Thunderbowl (concrete + clay)
- **Player visible:** True
- **Collision required:** False
- **Problem:** 'Spectators' are thin floating slabs. `BoxGeometry(6.2, 0.18, 0.36)` (line 1255) on a flat-colour MeshStandardMaterial with no map (0xe9b66d concrete / 0xd47a5d clay, line 1253), three rows per stand. They are not people or seats — they are 18 cm sheets of solid colour. They also float: rows are placed at `sample.y + 2.25 + row * 0.33` (line 1269) while the parent stand's top is `1.08 + (2.3 * sy) / 2`, which for the `index % 3 === 0` stands (sy = 1) is 2.23 — so rows 2 and 3 hang 0.35 m and 0.68 m in the air above their own grandstand. Reads as a pink/tan pixel grid on the horizon in docs/qa/targeted/webgl-stock/webgl-stock.png.
- **Replacement:** Fold into the grandstand replacement: `feature_crowd` from courseWorkshopKit ([12, 5.5, 4.4], courseFeatureCatalog.js:146, already leased — the GLB contains authored crowd_cat_*/stand_cat_* meshes). Delete this instanced mesh once the grandstand carries its own occupants rather than trying to seat slabs on a box.
- **Status:** open

#### P2-16 · `src/racing/racingEnvironment.js:1181`

- **Node:** `'rally-decal-atlas-board' group (panel + frameGeometry half-torus)`
- **Mode / venue:** circuit / All six Off-Road GP venues (3 boards each, 18 total)
- **Player visible:** True
- **Collision required:** False
- **Problem:** The board assembly floats with nothing under it. panel.position.y = 2.25 on a 3.25-tall plane puts the panel bottom at local y = 0.625; frame.position.y = 0.65 on a TorusGeometry(2.95, 0.13, 6, 24, Math.PI) puts the half-arch's two feet at y = 0.65 — the arch has no legs reaching the ground. `_placeObject(board, sample, placement.side * lateral, 0)` anchors the group to the TRACK-PLANE y (sample.y, which is 0 for all six courses — none define an elevationProfile, verified via drawTrackElevation.js:66 returning 0 for undefined input), not to the sculpted terrain. Root cause is structural: `_buildGround` returns `heightAt` into `terrain` (line 1388) but `_buildInfrastructure` is called at line 1425 with `(group, course, profile, samples, rc, env, decalAtlas)` — the sampler is never threaded in, so the boards cannot know the ground height. I reproduced `_terrainGeometry` + `_createTerrainHeightSampler` offline and evaluated all 18 accepted board positions: terrain there is -0.03 to -0.55, giving a visible gap of 0.65 m (Glass Mile board 0) to 1.20 m (Borrowed Post Switchback board 2) under every board in every venue.
- **Replacement:** Thread `terrain.heightAt` into `_buildInfrastructure` and sample it at the board XZ before `_placeObject`; then either drop the half-torus feet to ground level (frame.position.y = 0) or add two short posts from the arch feet to the terrain so the panel reads as a mounted board.
- **Status:** open

#### P2-17 · `src/racing/racingEnvironment.js:1254`

- **Node:** `standGeometry / seatGeometry → 'thunderbowl-concrete-grandstands', 'thunderbowl-clay-grandstands', 'thunderbowl-spectator-rows'`
- **Mode / venue:** stock only — `_buildDisciplineVenue` returns without building anything when course.mode === 'circuit' / Kaki Thunderbowl (concrete + clay). NOT built in any of the six Off-Road GP venues.
- **Player visible:** True
- **Collision required:** False
- **Problem:** Six grandstands are BoxGeometry(6.8, 2.3, 3.1) with three BoxGeometry(6.2, 0.18, 0.36) bars stacked above each as 'spectator rows' — flat-colour MeshStandardMaterial (0x788697 / 0x8a4f58), no texture, no map, no spectators, placed at trackWidth*0.5 + 10.5 from the racing line. The file convicts itself twelve lines further up: the comment at lines 1186-1188 says the four wedge spectator stands were deleted from the shared kit because 'Their oversized, unoccupied silhouettes looked like stray blocks in the isometric view.' The same standard was never applied to the stock path, which still ships literal blocks with bar seats. Reported for completeness because racingEnvironment.js builds it; it is out of the stated Off-Road GP audit area.
- **Replacement:** Authored grandstand prop in the GLB kit (raked seating deck + roof + crowd-card strip, matching the flat-colour low-poly bar of kaki-rally-environment-kit-v2.glb), or an instanced crowd-card texture over the existing deck. Not urgent for Off-Road GP.
- **Status:** open

#### P2-18 · `src/racing/trialsEnvironment.js:789`

- **Node:** `trials-cloud-bank (InstancedMesh, SphereGeometry(1,12,8) + MeshBasicMaterial)`
- **Mode / venue:** trials / Meadow, Crown
- **Player visible:** True
- **Collision required:** False
- **Problem:** Both sky venues already ship high-quality painted cloudscapes in their backdrop plates — Meadow has soft shaded cat-face clouds, Crown is a full pastel cloud kingdom with volumetric painted cumulus. The procedural bank draws 4-puff clusters of unlit MeshBasicMaterial spheres (0xfffbff @ 0.76) on top of that art with hard silhouette edges, no shading, no fog and no softness, so the flat white blobs read as untextured proxies parked in front of finished painting. Visible intermittently: clouds sit at y baseline+34 (meadow, baseline -10 -> 24-36) and baseline+42 (crown, baseline -3 -> 39-51); the frame top is ground+13.2, so they enter frame on every crest above ~y9 (meadow) / ~y24 (crown) and on all big air. Horizontal spacing is 92 units against a ~38-unit frame width, so they appear in bursts rather than continuously — which is why this is P2 rather than P1.
- **Replacement:** Either delete the bank and let the authored backdrop own the sky, or replace the sphere puffs with camera-facing soft cloud billboards using an alpha cloud sprite sheet cut from the same painted plates (instanced PlaneGeometry + transparent alpha map + fog enabled), so silhouettes and shading match the backdrop.
- **Status:** open

#### P2-19 · `src/racing/trialsMode.js:635`

- **Node:** `vehicle blob shadow (CircleGeometry(1.8|2.7, 26) + black MeshBasicMaterial @0.25)`
- **Mode / venue:** trials / Meadow, Quarry, Crown
- **Player visible:** False
- **Collision required:** False
- **Problem:** The truck/buggy has no readable grounding cue in the one camera where silhouette separation matters most. The blob is a horizontal circle (rotation.x = -PI/2, line 640) lying on the ground plane, but the Trials ortho rig sits only ~1.5-2.3 units above its focus at 41 units of depth (isometricCameraRig.js:54-66), i.e. ~2-3 degrees of pitch, so the ellipse is seen essentially edge-on and collapses to a hairline. There is also no real shadow to fall back on: _addLighting (trialsEnvironment.js:616-631) creates a HemisphereLight and two DirectionalLights and never sets castShadow on any of them, so every castShadow = true in the Trials build path (arches, obstacles, authored kit instances, wheels) is a no-op. Result: vehicle, obstacles and props all float without contact.
- **Replacement:** Replace the ground-plane circle with a camera-facing soft-shadow billboard (PlaneGeometry + radial-gradient alpha sprite, fading with air height using the existing air term at line 836), and/or enable castShadow on the key DirectionalLight with a shadow camera fitted to the ~40-unit frame.
- **Status:** open

### P3

#### P3-01 · `src/racing/courseFeatureCatalog.js:148`

- **Node:** `feature_foliage`
- **Mode / venue:** draw + trials / any course where the player stamps Trees / Foliage Group
- **Player visible:** True
- **Collision required:** False
- **Problem:** Script authors 4 trees plus 9 ring shrubs alternating FOLIAGE / FOLIAGE_LIGHT. The GLB subtree has the 4 trees and only 4 shrubs (indices 1,3,5,7 — the FOLIAGE_LIGHT ones); the 5 dark-green FOLIAGE shrubs are orphaned (detached group 5x80 workshop_foliage, exact match). The shrub ring renders with a visible gap every other position.
- **Replacement:** Re-export the kit with foliage_shrub_{0,2,4,6,8} parented under feature_foliage.
- **Status:** open

#### P3-02 · `src/racing/monsterArena.js:568`

- **Node:** `trees / trunks / tentRoofs / tentSides — '<id>-exterior-tree-line', 'crown-chaos-exterior-fairground-roofs'`
- **Mode / venue:** Monster Smash / both arenas (Crown Chaos + Pileup Pyramid)
- **Player visible:** True
- **Collision required:** False
- **Problem:** 72 DodecahedronGeometry(1,0) blobs on MeshBasicMaterial({color: 0x58a968, toneMapped: false}) form the exterior tree line, and 6 ConeGeometry/CylinderGeometry tents use MeshBasicMaterial in flat 0xff4f9b / 0x36cfe9 (lines 606-607). Being MeshBasic and toneMapped:false they take no arena lighting at all, so they read as flat paper cutouts against a lit backdrop. ArenaKit_ExteriorTree and ArenaKit_EventTent are in the already-parsed kit and are instanced only in attachMonsterEnvironmentKit (lines 1249-1250); attachMonsterStoryDressing neither instances them nor hides the procedural versions (the hide at 1256-1258 is env-kit only). Ranked P3 because from a ground chase camera the stand tops (~9.4 m at 82 m) occlude the tree tops (~7-8 m at 103 m) — but the arena has 6.6-7.2 m launch ramps and a free-look camera, so they clear the stands whenever the player is airborne.
- **Replacement:** Instance ArenaKit_ExteriorTree (story.exteriorTrees, 56 placements) and ArenaKit_EventTent (6 placements) from attachMonsterStoryDressing and hide the procedural blobs on success — the placement arrays already exist in _storyModulePlacements and are simply unused on this path. If the instance count is unwelcome, at minimum move the tree/tent materials to MeshStandardMaterial with toneMapped:true so they sit in the lighting.
- **Status:** open

