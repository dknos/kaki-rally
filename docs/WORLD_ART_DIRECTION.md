# Kaki Rally world art direction

## North star

Kaki Rally is a plausible grassroots motorsport culture with a playful cat-made
design language—not an architectural visualizer and not a neon theme pack.
World dressing should read 70% functional infrastructure and 30% Kaki character.
The racing line, landing zones, checkpoint silhouettes, and chase-camera corridor
always win over decorative density.

## Shared visual grammar

- Chunky silhouettes, intentional bevels, readable foundations, and metric scale.
- Cream/warm-gray facilities, warm painted steel, weathered timber, and legible
  concrete; mint technical equipment, coral/amber event accents, and safety
  orange only where it communicates a hazard.
- Geometry-only paw, ear, whisker, and cat-eye motifs used sparingly at hero
  moments. No real manufacturer or motorsport branding.
- Dirt, fading, and wear remain broad enough to read at racing distance. Avoid
  tiny hardware, baked directional lighting, glass refraction, and random color.
- Every visible module owns LOD0/1/2 and a `_COL` proxy. Runtime collision truth
  stays in the existing gameplay systems; kit collision nodes are metadata and
  future-safe proxies, not a physics rewrite.

## Composition layers

Macro layers establish one or two sector landmarks and a distant facility
silhouette. Medium layers create service, spectator, safety, and utility zones.
Micro layers add flags, marshal posts, bins, signs, tools, and small clutter in
bounded groups. A normal drive should encounter a designed beat every 15–25
seconds without forming false openings or hiding an apex.

Placement is deterministic from mode/course/theme identity. Buildings sample
terrain height, preserve a track-width-plus-4.5 m exclusion, and face the route.
Trials uses simple depth bands and strong profiles because its camera is side-on.
Monster perimeter art stays outside the destruction contract. Dune and Raid
infrastructure stays beyond the free-driving corridor.

## Venue identities

- Borrowed Post Switchback: postal depot, timber fencing, improvised rural
  service bridge, warm utility hardware.
- Nobody's Turn: contradictory municipal bypass, guardhouse, concrete barriers,
  retaining works, and one oversized fictional direction cue.
- Kiln-Shift Circuit: brickworks/kiln silhouettes, conveyor, hot dust, retaining
  walls, and service sheds.
- Quiet Toll Run: covered toll plaza, compact booth, emergency/service bay,
  fog-readable lights, and mountain retaining infrastructure.
- Glass Mile: restrained clean-industry lab, precise barriers, solar/technical
  equipment, landscaped utility edges; no expensive transparent shell.
- Chalkline Loop: pale quarry massing, conveyor silhouette, culvert, retaining
  modules, fence, and service structures.
- Whisker Yard: warehouse frontages, docks, tanks, pipe rack, yard office,
  fencing, drainage logic, floodlights, and readable drift chevrons.
- Thunderbowl: layered wall/catch fence/grandstand/press/scoreboard/pits/lights;
  concrete and clay are configurations of one scrappy short-track facility.
- Monster Smash: county-fair arena upgraded with entry, staging, stands,
  scoreboard, concessions, backstage service, perimeter safety, and lighting.
- Whiskerwind/Mirage: temporary timing and bivouac infrastructure with wind,
  water, shade, and recovery cues.
- Sunspine: sparse radio/solar/waypoint technical language and distant anchors.
- Big Litterbox: earthworks recovery/service language that preserves free-drive
  space, plus sculpted mesas and a readable wreck landmark.
- Trials Meadow: timber/painted-steel proving ground, flags and viewing stand.
- Trials Quarry: culvert/scaffold/catwalk/shed silhouettes without outdoor cloud
  puffs crossing the cave backdrop.
- Trials Crown: paired championship arches, premium stands/platforms, banners,
  and a ceremonial finish profile.
- Draw Your Track: industrial, desert, stadium/dirt, or roadside weighted
  compositions behind unchanged feature IDs, footprints, collisions, and KDT
  save contracts.

## Quality tiers and motion

Low begins with LOD1 architecture, LOD2 repeats, shorter draw distance, and at
least two shared animated cues; it remains intentionally composed. Medium uses
the intended landmark set and moderate repeats. High/Ultra retain LOD0 hero art,
longer landmark distance, micro-dressing, and selected shadows.

Wind flags and beacons share one bounded deterministic update list (maximum 18),
pause with their environment owner, simplify under reduced motion, and disappear
on release. No world-v3 kit creates a light, timer, audio loop, renderer, or
physics body of its own.

## Rights boundary

Only rights-ledger GREEN files enter `assets/`. BIMobject candidates reviewed in
this wave were rejected for public-game use; the production kits are clean-room
originals made from generic functional requirements, with zero source imports.
