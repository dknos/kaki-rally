"""Kaki Rally Raid — ancient ruins and the rift.

    from raid_kit.ruin import build_ruins
    build_ruins(materials)

Builds, each as one mesh object parented to an empty of the same name:

    RaidRuinArch-0      ~15 m wide gateway arch, the track drives under it
    RaidRuinColumn-0    a standing column with two broken companions
    RaidRuinColumn-1    a fallen column lying in drums
    RaidRuinWall-0      a wall fragment with a doorway through it
    RaidAmphitheatre-0  ~72 m ruined tiered ring, half swallowed by a dune
    RaidRiftShard-0     glowing crystal shards standing out of the rift
    RaidRiftVent-0      a fractured vent with glowing cracks radiating out

Original project geometry. Nothing here is downloaded, traced, or derived from
a third party, so the kit carries no attribution burden and no licence risk.

Conventions shared with the rest of the raid kit:

  * +Z up in Blender (the GLB export converts to +Y up).
  * Origin at the ground contact point, and every asset carries a buried skirt
    below z = 0 so the scatter beds it into the terrain instead of perching it.
    The skirts here are deeper than rock.py's, because these are the widest
    assets in the kit: a 15 m arch spans enough terrain that a 1-in-8 slope
    lifts one pier 1.9 m off the sand, and the ring is worse.
  * Deterministic, and free of modifiers. Every random stream is a local
    ``random.Random(seed)``, UVs are a plain dominant-axis projection computed
    here, and no BEVEL modifier is left on any object. Those two things — the
    threaded island packer in ``smart_project`` and the bevel modifier's UV
    interpolation — are the only reason the rock assets need re-projecting in
    the build script, and this module simply does not have them.

``materials`` contract. Every role falls back to a locally authored material of
the documented name, so ``build_ruins({})`` works for the preview; the fallback
also looks the name up in ``bpy.data`` first, so a key mismatch against the
shared palette lands on the shared material rather than quietly authoring a
second, differently coloured one.

    "ruin"        RaidRuinStone   dressed limestone, the lit faces
    "ruin_dark"   RaidRuinShade   weathered recesses, undersides, risers
    "ruin_sand"   RaidRuinSand    the drift burying the ring, arena floor
    "rift_stone"  RaidRiftStone   the scorched rock the rift broke through
    "rift_glow"   RaidRiftGlow    emissive blue, the body of the energy
    "rift_core"   RaidRiftCore    emissive violet-white, the hottest slivers

PALETTE. Tan and pale gold sand over brown-grey stone, deliberately NOT the
saturated terracotta the rest of the v1 kit shipped with. Ruined dressed stone
also reads a little paler and greyer than the natural sandstone around it,
which is what separates a wall from an outcrop at distance.

The glow is authored as emission, not as a bright base colour, for two
reasons: a bright albedo goes black at night, which is precisely when the rift
is supposed to be the most striking thing on the stage; and emission survives
the GLB export as ``emissiveFactor`` plus ``KHR_materials_emissive_strength``,
so the runtime gets the intensity without a bloom-tuning pass per material.
"""

from __future__ import annotations

import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

TAU = math.tau

# The mesa's authored footprint cap. raidEnvironment.js sizes its landmark
# visibility box from that number, so the amphitheatre — the only other asset
# in the kit big enough to matter — is hard-clamped to the same reach rather
# than quietly invalidating the constant.
LANDMARK_MAX_RADIUS = 38.0


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

_ROLE_KEYS = {
    "ruin":       ("ruin", "RaidRuinStone", "raid_ruin"),
    "ruin_dark":  ("ruin_dark", "RaidRuinShade", "raid_ruin_dark"),
    "ruin_sand":  ("ruin_sand", "RaidRuinSand", "raid_ruin_sand"),
    "rift_stone": ("rift_stone", "RaidRiftStone", "raid_rift_stone"),
    "rift_glow":  ("rift_glow", "RaidRiftGlow", "raid_rift_glow"),
    "rift_core":  ("rift_core", "RaidRiftCore", "raid_rift_core"),
}

# role -> (datablock name, base colour, roughness, emission colour, strength).
# Colours are linear, which is what Blender's Base Color and glTF's
# baseColorFactor both want.
_ROLE_FALLBACK = {
    # Warm brown-grey, and only one stop apart. A dressed-stone pair authored
    # with a wide value gap turns every course joint into a painted stripe and
    # the masonry reads as a barber's pole; the shade is a SHADE, not a hole.
    "ruin":       ("RaidRuinStone", (0.288, 0.234, 0.158), 0.90, None, 0.0),
    "ruin_dark":  ("RaidRuinShade", (0.152, 0.126, 0.092), 0.94, None, 0.0),
    "ruin_sand":  ("RaidRuinSand",  (0.400, 0.330, 0.202), 0.96, None, 0.0),
    "rift_stone": ("RaidRiftStone", (0.052, 0.046, 0.062), 0.88, None, 0.0),
    # The rift's albedo is nearly black on purpose. All of its value comes from
    # the emission, so it stays the same colour under any sun angle and does
    # not turn into a pale blue plastic slab at noon.
    #
    # The strengths are low for emission. Anything above about 3 saturates all
    # three channels through the tonemapper and the shard renders WHITE — the
    # hue survives only while the brightest channel is still on the curve, so
    # a strong blue-violet is a matter of restraint, not of power.
    "rift_glow":  ("RaidRiftGlow",  (0.035, 0.040, 0.095), 0.35, (0.055, 0.240, 1.000), 1.15),
    "rift_core":  ("RaidRiftCore",  (0.070, 0.045, 0.110), 0.30, (0.230, 0.075, 1.000), 2.05),
}


def _apply_emission(bsdf, colour, strength):
    """Set both emission sockets, always.

    Blender's Principled BSDF ships Emission Strength at 0.0, so a material
    that sets only the colour exports a black ``emissiveFactor`` and renders as
    dead stone. Setting one without the other is the single easiest way to lose
    the glow silently between here and the GLB.
    """
    for key in ("Emission Color", "Emission"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = (*colour, 1.0)
            break
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = strength


def _ensure_emission(mat, role):
    """Repair a supplied material that carries no emission.

    This guards the SHIPPING path, which is not the path the preview
    exercises. ``build-kaki-raid-environment-kit.py`` authors its palette with
    a three-argument ``material(name, colour, roughness)`` and a table of
    three-tuples: there is nowhere in that shape to put an emission at all. So
    the moment the rift roles are added to that palette in its existing form,
    this module resolves a material that exists, is correctly named, passes the
    build's audit — and is completely dark. The rift would ship black and
    nothing downstream would report it.

    An explicitly supplied emission always wins; this only fills a hole.
    """
    _name, _colour, _roughness, emission, strength = _ROLE_FALLBACK[role]
    if emission is None or mat is None:
        return mat
    if not mat.use_nodes:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        return mat
    socket = bsdf.inputs.get("Emission Strength")
    if socket is not None and (socket.is_linked or socket.default_value > 1e-4):
        return mat
    _apply_emission(bsdf, emission, strength)
    return mat


def _resolve_material(materials, role):
    source = materials if hasattr(materials, "get") else {}
    for key in _ROLE_KEYS[role]:
        found = source.get(key)
        if found is not None:
            return _ensure_emission(found, role)
    name, colour, roughness, emission, strength = _ROLE_FALLBACK[role]
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return _ensure_emission(existing, role)
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        _apply_emission(bsdf, emission, strength)
    return mat


def _material_table(palette, names):
    """Stable material slot order, so exported primitives are predictable."""
    slots = []
    index = {}
    for name in names:
        mat = palette[name]
        if mat.name not in index:
            index[mat.name] = len(slots)
            slots.append(mat)
    return slots, {name: index[palette[name].name] for name in names}


# ---------------------------------------------------------------------------
# Scene plumbing
# ---------------------------------------------------------------------------


def _parent(name):
    parent = bpy.data.objects.new(name, None)
    parent.location = (0.0, 0.0, 0.0)
    parent.empty_display_size = 0.6
    parent["kaki_asset"] = True
    parent["source"] = "Kaki Rally Raid original Blender geometry"
    bpy.context.scene.collection.objects.link(parent)
    return parent


def _project_uvs(bm, scale=0.28):
    """A dominant-axis planar projection, computed here and never touched again.

    Nothing in the kit samples a texture — every material is a flat colour — so
    the UVs only have to exist and be byte-stable run to run. A projection is
    both, and unlike ``smart_project`` it does not depend on a threaded,
    time-budgeted island packer that answers differently on a loaded machine.
    """
    uv_layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        normal = face.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for loop in face.loops:
            co = loop.vert.co
            if axis == 0:
                u, v = co.y, co.z
            elif axis == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            loop[uv_layer].uv = (u * scale, v * scale)


def _finalise(name, bm, parent, slots):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    _project_uvs(bm)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(verbose=False)
    for mat in slots:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj["uv_ready"] = True
    return obj


def _triangles(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


# ---------------------------------------------------------------------------
# Geometry primitives
# ---------------------------------------------------------------------------


def _block(bm, base, size, material_index, rng=None, jitter=0.0,
           yaw=0.0, tilt=(0.0, 0.0), taper=1.0):
    """One dressed ashlar block, origin at the centre of its underside.

    Masonry is the whole reason the ruins read as built rather than eroded, and
    the cue the eye actually uses is the JOINT: a course line that runs almost
    but not quite straight. So every block is jittered independently and each
    course gets its own small yaw, which puts a wobble into the joints without
    ever opening a hole. A single extruded wall profile has no joints at all and
    reads as poured concrete.
    """
    sx, sy, sz = size
    rot = (Matrix.Rotation(yaw, 3, "Z")
           @ Matrix.Rotation(tilt[0], 3, "X")
           @ Matrix.Rotation(tilt[1], 3, "Y"))
    origin = Vector(base)
    corners = []
    for level in (0, 1):
        scale = 1.0 if level == 0 else taper
        for cx, cy in ((-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)):
            local = Vector((cx * sx * 0.5 * scale, cy * sy * 0.5 * scale, level * sz))
            if rng is not None and jitter > 0.0:
                local.x += rng.uniform(-jitter, jitter) * sx
                local.y += rng.uniform(-jitter, jitter) * sy
                local.z += rng.uniform(-jitter, jitter) * sz
            corners.append(origin + (rot @ local))
    v = [bm.verts.new(c) for c in corners]
    faces = (
        bm.faces.new((v[0], v[1], v[2], v[3])),
        bm.faces.new((v[4], v[5], v[6], v[7])),
        bm.faces.new((v[0], v[1], v[5], v[4])),
        bm.faces.new((v[1], v[2], v[6], v[5])),
        bm.faces.new((v[2], v[3], v[7], v[6])),
        bm.faces.new((v[3], v[0], v[4], v[7])),
    )
    for face in faces:
        face.material_index = material_index
        face.smooth = False
    return faces


def _stone(rng, mat, dark=0.22):
    """Pick a course colour.

    Sparsely and randomly, never alternately. Every second block being the dark
    tone lays a perfect checker over the wall and the eye reads the pattern
    instead of the stone; one block in five reads as a differently weathered
    stone in an otherwise even wall, which is what a ruin actually looks like.
    """
    return mat["ruin_dark"] if rng.random() < dark else mat["ruin"]


def _rubble(bm, rng, centre, size, material_index, flat=0.55):
    """A fallen fragment: a block on a random lie, half sunk into the sand.

    Rubble that all sits square reads as unplaced level-editor props. Tipping
    each piece onto its own axis is what makes a scatter of six boxes read as a
    collapse, and sinking it puts the contact into the ground instead of on it.
    """
    return _block(
        bm,
        (centre[0], centre[1], centre[2] - size * flat * 0.55),
        (size * rng.uniform(0.8, 1.5), size * rng.uniform(0.7, 1.3), size * flat),
        material_index,
        rng=rng,
        jitter=0.09,
        yaw=rng.uniform(0.0, TAU),
        tilt=(rng.uniform(-0.34, 0.34), rng.uniform(-0.34, 0.34)),
        taper=rng.uniform(0.72, 1.0),
    )


def _bridge(bm, rings, columns, material_of, smooth=False):
    """Bridge a stack of closed rings, bottom to top.

    ``material_of(band, column)`` picks the material for each quad, which is
    what lets one continuous lathe carry stone, shadow and sand without ever
    splitting into separate objects that could show daylight between them.
    """
    for band in range(len(rings) - 1):
        lower = rings[band]
        upper = rings[band + 1]
        for column in range(columns):
            nxt = (column + 1) % columns
            face = bm.faces.new((lower[column], lower[nxt], upper[nxt], upper[column]))
            face.material_index = material_of(band, column)
            face.smooth = smooth


def _harmonic(rng, terms):
    """A smooth periodic function of a lathe angle, same as landmark.py.

    Used here to take the machined perfection off a circle. A ruin has settled
    for two thousand years; a plan that is still a true circle reads as CAD.
    """
    parts = [(k, amp, rng.uniform(0.0, TAU)) for k, amp in terms]

    def field(angle):
        return sum(amp * math.sin(k * angle + phase) for k, amp, phase in parts)

    return field


def _arc_bench(centre, half_width, edge, drop):
    """A flat-bottomed step down over an arc: a section of wall gone.

    Flat-bottomed matters, exactly as it does for the mesa rim. A cosine dip
    tilts the whole wall and the ring turns into a bowl; a bench keeps the
    surviving wall LEVEL and takes a bite out of one arc, which is what a
    collapse actually looks like.
    """
    edge = max(edge, 1e-4)

    def field(angle):
        delta = abs((angle - centre + math.pi) % TAU - math.pi)
        if delta >= half_width:
            return 0.0
        if delta <= half_width - edge:
            return drop
        ramp = (half_width - delta) / edge
        return drop * 0.5 * (1.0 - math.cos(math.pi * ramp))

    return field


# ---------------------------------------------------------------------------
# RaidRuinArch-0
# ---------------------------------------------------------------------------

ARCH_CLEAR = 9.0            # inner face to inner face; a raid truck needs ~2.5
ARCH_PIER = 3.45            # pier width along the track's cross axis
ARCH_DEPTH = 3.4            # pier depth along the direction of travel
ARCH_SPRING_Z = 6.2         # top of the piers, where the arch starts
ARCH_FOOTING_Z = -2.2       # buried footing: a 15 m span needs a deep one
ARCH_VOUSSOIRS = 13


def _build_arch(palette):
    """A gateway arch, still standing, with the wall above it fallen away.

    Two things stop this reading as a croquet hoop. First the arch is built as
    real voussoirs — separate wedge stones with jittered joints — because the
    radial joint lines are the only cue that tells the eye this is a masonry
    arch rather than a bent tube. Second the collapse is asymmetric: the left
    pier keeps three courses of the wall that stood above it and a cornice, the
    right pier is sheared off just above the springing and undercut at the
    base. A symmetric ruin reads as a monument; a lopsided one reads as damage.
    """
    name = "RaidRuinArch-0"
    parent = _parent(name)
    rng = random.Random(0x41524348)
    slots, mat = _material_table(palette, ("ruin", "ruin_dark", "ruin_sand"))

    bm = bmesh.new()
    half = ARCH_CLEAR * 0.5
    pier_centre = half + ARCH_PIER * 0.5

    for side in (-1.0, 1.0):
        x = side * pier_centre
        # Plinth. Wider than the pier and buried deep, so the arch is standing
        # in the ground rather than resting on it.
        _block(
            bm, (x, 0.0, ARCH_FOOTING_Z),
            (ARCH_PIER + 0.9, ARCH_DEPTH + 0.9, abs(ARCH_FOOTING_Z) + 0.55),
            mat["ruin_dark"], rng=rng, jitter=0.012,
        )
        # Courses. Each one steps in a little and carries its own yaw, so the
        # joints wander and the pier tapers the way a load-bearing pier does.
        z = ARCH_FOOTING_Z + abs(ARCH_FOOTING_Z) + 0.55
        courses = (1.35, 1.20, 1.10, 1.05, 1.05)
        for index, height in enumerate(courses):
            walk = index / (len(courses) - 1)
            width = ARCH_PIER * (1.0 - 0.055 * walk)
            depth = ARCH_DEPTH * (1.0 - 0.045 * walk)
            # The right pier is eaten back at the foot: wind-blown sand scours
            # the bottom metre of anything standing in a desert, and the
            # undercut is what makes the pier look old rather than unfinished.
            if side > 0.0 and index == 0:
                width *= 0.86
                depth *= 0.88
            _block(
                bm, (x + rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), z),
                (width, depth, height),
                _stone(rng, mat),
                rng=rng, jitter=0.022, yaw=rng.uniform(-0.020, 0.020), taper=0.985,
            )
            z += height

    # Impost band: the projecting course the arch springs from. It is the one
    # horizontal in the whole asset, and it is what makes the piers read as
    # supporting the arch rather than merely touching it.
    for side in (-1.0, 1.0):
        _block(
            bm, (side * pier_centre, 0.0, ARCH_SPRING_Z - 0.55),
            (ARCH_PIER + 0.42, ARCH_DEPTH + 0.42, 0.55),
            mat["ruin"], rng=rng, jitter=0.016,
        )

    # The arch ring. Wedges between an intrados of `half` and an extrados 1.55 m
    # out, so the ring is a real thickness of stone with a visible soffit.
    inner = half
    outer = half + 1.55
    for index in range(ARCH_VOUSSOIRS):
        a0 = math.pi * index / ARCH_VOUSSOIRS
        a1 = math.pi * (index + 1) / ARCH_VOUSSOIRS
        # A few stones sit proud and a few have slipped: a dead-true ring is a
        # machined part, and the crown of a ruined arch is always the loosest
        # place in it.
        push = rng.uniform(-0.05, 0.09)
        drop = rng.uniform(-0.035, 0.035)
        depth = ARCH_DEPTH * rng.uniform(0.86, 0.99)
        corners = []
        for y in (-depth * 0.5, depth * 0.5):
            for angle, radius in ((a0, inner), (a1, inner), (a1, outer + push), (a0, outer + push)):
                # `math.pi - angle` sweeps from +x to -x, so voussoir 0 sits on
                # the right springing and the loop climbs over the crown.
                sweep = math.pi - angle
                corners.append(Vector((
                    math.cos(sweep) * radius,
                    y,
                    ARCH_SPRING_Z + math.sin(sweep) * radius + drop,
                )))
        v = [bm.verts.new(c) for c in corners]
        soffit = mat["ruin_dark"]
        stone = _stone(rng, mat, dark=0.26)
        for quad, material in (
            ((v[0], v[1], v[2], v[3]), stone),   # near face
            ((v[4], v[5], v[6], v[7]), stone),   # far face
            ((v[0], v[1], v[5], v[4]), soffit),  # the underside of the arch
            ((v[3], v[2], v[6], v[7]), stone),   # extrados
            ((v[1], v[2], v[6], v[5]), stone),   # radial joint
            ((v[0], v[3], v[7], v[4]), stone),   # radial joint
        ):
            face = bm.faces.new(quad)
            face.material_index = material
            face.smooth = False

    # Spandrel: the wall that fills the corner between the arch and the pier.
    # Without it the ring floats on two posts and the whole thing reads as a
    # croquet hoop rather than a gate cut through a wall.
    for side, courses in ((-1.0, 5), (1.0, 2)):
        z = ARCH_SPRING_Z
        for index in range(courses):
            height = 1.02 + rng.uniform(-0.05, 0.05)
            # The inner edge of the spandrel has to clear the extrados, which
            # moves inward as the courses climb.
            rise = z + height * 0.5 - ARCH_SPRING_Z
            span = outer + 0.20
            reach = math.sqrt(max(span * span - rise * rise, 0.0)) if rise < span else 0.0
            inner_x = max(reach, half + 0.4)
            outer_x = pier_centre + ARCH_PIER * 0.5
            if inner_x >= outer_x - 0.35:
                break
            width = outer_x - inner_x
            _block(
                bm, (side * (inner_x + width * 0.5), 0.0, z),
                (width, ARCH_DEPTH * 0.94, height),
                _stone(rng, mat),
                rng=rng, jitter=0.028, yaw=rng.uniform(-0.024, 0.024),
            )
            z += height
        # The cornice that survived on the tall side. One overhanging course at
        # the top of a ragged stump is worth more silhouette than three more
        # courses of the same wall.
        if courses > 3:
            _block(
                bm, (side * (pier_centre - 0.25), 0.0, z),
                (ARCH_PIER + 0.75, ARCH_DEPTH + 0.55, 0.62),
                mat["ruin"], rng=rng, jitter=0.02, yaw=rng.uniform(-0.03, 0.03),
            )

    # Fallen blocks. Concentrated on the right, under the side that failed,
    # which tells the eye where the missing stone went.
    for _ in range(7):
        x = rng.uniform(2.0, 10.5) * rng.choice((1.0, 1.0, -1.0))
        y = rng.uniform(-3.6, 3.6)
        _rubble(bm, rng, (x, y, 0.0), rng.uniform(0.7, 1.5),
                mat["ruin"] if rng.random() < 0.5 else mat["ruin_dark"])
    # A drift of sand banked against the windward pier.
    _block(
        bm, (-pier_centre - 1.1, 0.9, -0.5), (2.6, 4.4, 1.05), mat["ruin_sand"],
        rng=rng, jitter=0.10, yaw=0.22, tilt=(0.0, 0.30), taper=0.42,
    )

    _finalise(f"{name}-body", bm, parent, slots)
    return parent


# ---------------------------------------------------------------------------
# RaidRuinColumn-0 / RaidRuinColumn-1
# ---------------------------------------------------------------------------

COLUMN_FLUTES = 8


def _column_shaft(bm, rng, mat, centre, radius, height, columns, rings, snap):
    """One fluted shaft, snapped off at the top.

    The break is the point of the asset, so it is authored rather than implied:
    the top ring's height is pushed around per column and then capped to a
    single centre vertex, which gives a jagged fracture plane instead of the
    flat disc a lathe would otherwise leave. A column sawn off level reads as a
    bollard.
    """
    flute = _harmonic(rng, ((COLUMN_FLUTES, 0.052), (COLUMN_FLUTES * 2, 0.018)))
    lean = (rng.uniform(-0.020, 0.020), rng.uniform(-0.020, 0.020))
    stack = []
    for index, (level, factor) in enumerate(rings):
        z = level * height
        # Entasis: the slight swell that stops a shaft looking pinched. It is
        # a real 2 500-year-old trick and it is nearly free here.
        swell = 1.0 + 0.022 * math.sin(level * math.pi)
        verts = []
        for column in range(columns):
            angle = TAU * column / columns
            r = radius * factor * swell * (1.0 + flute(angle))
            verts.append(bm.verts.new((
                centre[0] + lean[0] * z + math.cos(angle) * r,
                centre[1] + lean[1] * z + math.sin(angle) * r,
                centre[2] + z,
            )))
        stack.append(verts)
    # Jag the top ring. `snap` is how violent the break is.
    top = stack[-1]
    for column, vert in enumerate(top):
        vert.co.z += (rng.uniform(-1.0, 1.0) ** 3) * snap

    # ONE dry joint, plus the torus at the foot. Marking every joint dark
    # bands the shaft like a barber's pole and destroys the vertical read that
    # is the entire point of a column; a single shadow line partway up gives
    # the same "this is stacked drums" information for a fifth of the cost.
    joint = max(2, len(rings) // 2)

    def material_of(band, column):
        return mat["ruin_dark"] if band in (0, joint) else mat["ruin"]

    _bridge(bm, stack, columns, material_of)
    # The fracture is capped to a single vertex a little above the MEAN of the
    # jagged rim, not above its highest point: pinning it to the peak would
    # rebuild the neat cone the jagged rim exists to destroy.
    apex = bm.verts.new((
        centre[0] + lean[0] * height + rng.uniform(-0.1, 0.1) * radius,
        centre[1] + lean[1] * height + rng.uniform(-0.1, 0.1) * radius,
        sum(vert.co.z for vert in top) / len(top) + snap * 0.25,
    ))
    for column in range(columns):
        nxt = (column + 1) % columns
        face = bm.faces.new((top[column], top[nxt], apex))
        face.material_index = mat["ruin_dark"]
        face.smooth = False


_SHAFT_RINGS = (
    (0.000, 1.26),   # buried footing, wider than the shaft
    (0.055, 1.18),   # the torus at the foot of the column
    (0.085, 0.99),
    (0.340, 0.975),
    (0.620, 0.955),
    (0.860, 0.940),
    (1.000, 0.930),
)


def _build_columns(palette):
    """A standing column with two companions broken at different heights.

    Three heights rather than one, because a colonnade is read as a RHYTHM.
    One column is a post; a tall one, a half one and a stub together say that
    something long has fallen down here, and the instancing gets a whole ruin
    field out of a single prototype.
    """
    name = "RaidRuinColumn-0"
    parent = _parent(name)
    rng = random.Random(0x434F4C30)
    slots, mat = _material_table(palette, ("ruin", "ruin_dark", "ruin_sand"))

    bm = bmesh.new()

    plan = (
        # (x, y, height, radius, columns, rings used, break violence)
        (0.0, 0.0, 6.30, 0.55, 14, len(_SHAFT_RINGS), 0.40),
        (2.75, -1.15, 2.60, 0.52, 12, 5, 0.34),
        (-2.35, 1.45, 0.95, 0.54, 10, 4, 0.22),
    )
    for x, y, height, radius, columns, ring_count, snap in plan:
        rings = _SHAFT_RINGS[:ring_count]
        if ring_count < len(_SHAFT_RINGS):
            # Re-normalise the shortened profile so a stub is still a full
            # column that broke, not a scale model of a whole one.
            top = rings[-1][0]
            rings = tuple((level / top, factor) for level, factor in rings)
        # The stylobate slab each column stands on, buried to its shoulders.
        _block(bm, (x, y, -0.85), (radius * 3.1, radius * 3.1, 1.05),
               mat["ruin_dark"], rng=rng, jitter=0.03, yaw=rng.uniform(-0.06, 0.06))
        _column_shaft(bm, rng, mat, (x, y, 0.16), radius, height, columns, rings, snap)

    # The drum that came off the tall one, plus the usual scatter.
    _block(bm, (-1.55, -2.05, 0.16), (1.16, 1.16, 0.62), mat["ruin"],
           rng=rng, jitter=0.05, yaw=0.42, tilt=(0.20, -0.12))
    for _ in range(6):
        angle = rng.uniform(0.0, TAU)
        radius = rng.uniform(1.6, 4.4)
        _rubble(bm, rng, (math.cos(angle) * radius, math.sin(angle) * radius, 0.0),
                rng.uniform(0.34, 0.78),
                mat["ruin"] if rng.random() < 0.55 else mat["ruin_dark"])

    _finalise(f"{name}-body", bm, parent, slots)
    return parent


def _build_fallen(palette):
    """A toppled column lying in the drums it broke into.

    The drums are laid on a slightly curved line and each one is rolled a
    little further than the last, because a column does not fall and stay in a
    straight rank — it fell, the drums bounced, and the sand has been eating
    them since. They are sunk to a third of their depth for the same reason.
    """
    name = "RaidRuinColumn-1"
    parent = _parent(name)
    rng = random.Random(0x434F4C31)
    slots, mat = _material_table(palette, ("ruin", "ruin_dark", "ruin_sand"))

    bm = bmesh.new()
    sides = 10
    radius = 0.55
    x = -3.4
    roll = rng.uniform(0.0, 0.4)
    for index in range(4):
        length = rng.uniform(1.25, 1.65)
        yaw = rng.uniform(-0.20, 0.20) + index * 0.055
        y = math.sin(index * 0.9) * 0.42 + rng.uniform(-0.12, 0.12)
        # Sunk to a third of the drum: the sand has had two thousand years.
        sink = radius * rng.uniform(0.30, 0.42)
        axis = Vector((math.cos(yaw), math.sin(yaw), 0.0))
        up = Vector((0.0, 0.0, 1.0))
        side = axis.cross(up)
        centre = Vector((x + length * 0.5, y, radius - sink))
        roll += rng.uniform(0.2, 0.7)
        rings = []
        for end in (-0.5, 0.5):
            verts = []
            for column in range(sides):
                angle = TAU * column / sides + roll
                # Drum ends are chipped, so the two rings do not share a radius.
                r = radius * (1.0 + rng.uniform(-0.045, 0.045))
                offset = side * (math.cos(angle) * r) + up * (math.sin(angle) * r)
                verts.append(bm.verts.new(centre + axis * (length * end) + offset))
            rings.append(verts)
        # One or two weathered facets per drum, chosen at random rather than
        # every third one. A regular pattern down a rank of drums reads as a
        # decal, and the facets are the only thing telling the eye these are
        # round stones lying on their sides.
        dark_facets = {rng.randrange(sides) for _ in range(2)}
        _bridge(bm, rings, sides,
                lambda band, column: mat["ruin_dark"] if column in dark_facets else mat["ruin"])
        for ring, flip in ((rings[0], True), (rings[1], False)):
            hub = bm.verts.new(centre + axis * (length * (-0.5 if flip else 0.5)))
            for column in range(sides):
                nxt = (column + 1) % sides
                face = bm.faces.new((ring[column], ring[nxt], hub))
                face.material_index = mat["ruin_dark"]
                face.smooth = False
        x += length + rng.uniform(0.10, 0.55)

    # The capital, thrown clear of the line, and the debris of the break.
    _block(bm, (3.9, 1.05, -0.20), (1.35, 1.35, 0.70), mat["ruin"],
           rng=rng, jitter=0.06, yaw=0.75, tilt=(0.26, 0.14), taper=0.80)
    for _ in range(5):
        _rubble(bm, rng, (rng.uniform(-4.0, 4.6), rng.uniform(-2.2, 2.2), 0.0),
                rng.uniform(0.26, 0.60), mat["ruin_dark"])

    _finalise(f"{name}-body", bm, parent, slots)
    return parent


# ---------------------------------------------------------------------------
# RaidRuinWall-0
# ---------------------------------------------------------------------------


def _build_wall(palette):
    """A wall fragment with a doorway punched through it.

    The opening is the asset. A blank slab of stone is a barrier; a slab with a
    hole in it that you can see the desert through is architecture, and it
    tells the player something was built here without needing a single extra
    triangle of ornament. The head of the opening keeps its lintel, because a
    doorway whose lintel has gone is just a gap.
    """
    name = "RaidRuinWall-0"
    parent = _parent(name)
    rng = random.Random(0x57414C4C)
    slots, mat = _material_table(palette, ("ruin", "ruin_dark", "ruin_sand"))

    bm = bmesh.new()
    thickness = 1.05
    left = -4.6
    right = 4.6
    door_left = -1.05
    door_right = 0.95
    door_head = 3.05
    courses = (0.86, 0.78, 0.72, 0.70)

    def pier(x0, x1, top, tag):
        z = -1.15                       # buried footing
        _block(bm, ((x0 + x1) * 0.5, 0.0, z), (x1 - x0 + 0.24, thickness + 0.24, 1.30),
               mat["ruin_dark"], rng=rng, jitter=0.02)
        z = 0.15
        index = 0
        while z < top - 0.05:
            height = min(courses[index % len(courses)], top - z)
            # Two or three stones per course. The stagger between courses is
            # what reads as bonded masonry rather than a stack of planks.
            stones = 2 if (x1 - x0) < 2.6 else 3
            edge = x0
            offset = rng.uniform(-0.22, 0.22) if index % 2 else 0.0
            for stone in range(stones):
                width = (x1 - x0) / stones
                if stone == 0:
                    span = width + offset
                elif stone == stones - 1:
                    span = width - offset if stones == 2 else width
                else:
                    span = width - offset
                span = max(span, 0.45)
                span = min(span, x1 - edge)
                if span <= 0.05:
                    break
                _block(
                    bm, (edge + span * 0.5, rng.uniform(-0.03, 0.03), z),
                    (span * 0.97, thickness * rng.uniform(0.94, 1.02), height),
                    _stone(rng, mat),
                    rng=rng, jitter=0.026, yaw=rng.uniform(-0.014, 0.014),
                )
                edge += span
            z += height
            index += 1
        return z, tag

    # Deliberately unequal: the left pier keeps nearly its full height, the
    # right has come down to chest height. The ragged diagonal between them is
    # the entire silhouette of the asset.
    pier(left, door_left, 4.55, "tall")
    pier(door_right, right, 2.35, "short")

    # Lintel plus the two courses that survived above the opening.
    _block(bm, ((door_left + door_right) * 0.5 - 0.05, 0.0, door_head),
           (door_right - door_left + 0.95, thickness + 0.10, 0.62),
           mat["ruin"], rng=rng, jitter=0.016)
    _block(bm, ((door_left + door_right) * 0.5 - 0.30, 0.0, door_head + 0.62),
           (door_right - door_left + 0.30, thickness * 0.98, 0.66),
           mat["ruin_dark"], rng=rng, jitter=0.03, yaw=0.015)

    # The broken crest. Individual stones at falling heights, so the top edge
    # steps down instead of running as one machined line.
    crest = 4.55
    x = left
    while x < door_left - 0.2:
        width = rng.uniform(0.55, 1.05)
        height = rng.uniform(0.20, 0.62)
        _block(bm, (x + width * 0.5, rng.uniform(-0.05, 0.05), crest),
               (width * 0.95, thickness * rng.uniform(0.88, 1.0), height),
               mat["ruin"], rng=rng, jitter=0.06, yaw=rng.uniform(-0.05, 0.05))
        x += width + rng.uniform(0.02, 0.16)
        crest -= rng.uniform(0.0, 0.30)

    for _ in range(6):
        _rubble(bm, rng, (rng.uniform(-4.8, 5.4), rng.uniform(-2.6, 2.6), 0.0),
                rng.uniform(0.32, 0.82),
                mat["ruin"] if rng.random() < 0.5 else mat["ruin_dark"])
    # Sand banked into the lee of the standing pier.
    _block(bm, (-2.6, 1.35, -0.45), (4.6, 2.2, 0.95), mat["ruin_sand"],
           rng=rng, jitter=0.09, tilt=(0.26, 0.0), taper=0.40)

    _finalise(f"{name}-body", bm, parent, slots)
    return parent


# ---------------------------------------------------------------------------
# RaidAmphitheatre-0
# ---------------------------------------------------------------------------

AMPHI_COLUMNS = 64
ARENA_RADIUS = 12.0
PODIUM_Z = 1.70
AMPHI_TIERS = 7
AMPHI_TREAD = 2.50
AMPHI_RISER = 1.15
AMPHI_WALL_THICK = 2.90
AMPHI_WALL_Z = 12.40
AMPHI_APRON = 3.60           # the sand apron banked against the outside
AMPHI_DRIFT = 10.50          # how deep the dune buries the seating


def _build_amphitheatre(palette):
    """The landmark: a tiered ring with a dune pouring through the breach.

    Three decisions carry this asset.

    * It is ONE continuous lathe from the arena floor, up the seating, over the
      wall and down the outside into a buried skirt. A ring assembled from
      separate tier objects shows daylight between every step of it the moment
      it sits on sloping ground, and it is 68 m across, so it always does.
    * The burial is a HEIGHT FIELD, not a decoration. Every vertex takes the
      max of its structural height and the dune surface, and any face whose
      corners are mostly drowned turns to sand. That means the dune genuinely
      swallows six of the seven tiers on one side and leaves a driveable ramp
      from the desert floor up over the wall and down into the arena, instead
      of a sand-coloured stripe painted on intact stone.
    * The breach and the dune share an azimuth. The wall fell, and then the
      desert came in through the hole. Putting them on opposite sides costs
      nothing and loses the entire story.
    """
    name = "RaidAmphitheatre-0"
    parent = _parent(name)
    rng = random.Random(0x414D5048)
    slots, mat = _material_table(palette, ("ruin", "ruin_dark", "ruin_sand"))

    # A ruin has settled. Low harmonics take the CAD perfection off the plan
    # without ever stopping the tiers reading as concentric.
    settle = _harmonic(rng, ((1, 0.034), (2, 0.026), (3, 0.018), (5, 0.010)))
    crumble = [rng.uniform(-0.95, 0.45) for _ in range(AMPHI_COLUMNS)]
    # Each course of seating has crept and slumped over two millennia, so no
    # step is level all the way round. Without this the tiers render as a
    # machined thread and the ring reads as a cooling tower.
    creep = [rng.uniform(-0.14, 0.14) for _ in range(AMPHI_COLUMNS)]
    # Shallow piers up the outside of the wall. High harmonics on the radius
    # alone, so they cost no geometry whatever and still put vertical shadow
    # into the one surface the player sees from ground level.
    # k must stay well under half the column count or the pier pattern aliases
    # against the lathe and the wall goes lumpy instead of piered. At 64
    # columns, k=16 is four columns per pier and is the practical ceiling.
    pilaster = _harmonic(rng, ((8, 0.12), (16, 0.26)))
    breach = 2.30

    # Radial aisles. An amphitheatre is read from the air by the SPOKES as much
    # as by the rings — they are what says "seating for people" rather than
    # "concentric wall". Two columns wide, for exactly the reason the rift
    # cracks are: a one-column groove has no quad of its own to shade.
    aisles = {(int(step * AMPHI_COLUMNS / 6) + offset) % AMPHI_COLUMNS
              for step in range(6) for offset in (0, 1)}
    bench_main = _arc_bench(breach, 1.02, 0.34, 6.20)
    bench_side = _arc_bench(breach + 2.55, 0.42, 0.20, 3.10)
    slot = _arc_bench(breach - 2.05, 0.13, 0.07, 2.40)
    wall_wave = _harmonic(rng, ((1, 0.42), (2, 0.30), (3, 0.20), (5, 0.11)))

    tier_top = PODIUM_Z + AMPHI_TIERS * AMPHI_RISER
    wall_outer = ARENA_RADIUS + AMPHI_TIERS * AMPHI_TREAD + AMPHI_WALL_THICK
    apron_radius = wall_outer + AMPHI_APRON

    def wall_top(angle, column):
        height = (AMPHI_WALL_Z + wall_wave(angle)
                  - bench_main(angle) - bench_side(angle) - slot(angle)
                  + crumble[column])
        # Never below the seating it retains: a wall that has fallen leaves a
        # footing, and a zero-height band would make degenerate faces.
        return max(height, tier_top + 0.12)

    # The dune does not have a clean edge. A smooth gaussian quantised onto
    # 64 quads leaves a stepped wedge that reads as a texture error, so the
    # crest is pushed around by a few low harmonics and the sand/stone
    # boundary meanders instead of stepping.
    # The high terms are ripple. Without them the dune is a bald, perfectly
    # smooth mound, which is exactly what it looked like from the seat.
    dune_edge = _harmonic(rng, ((3, 0.115), (5, 0.075), (8, 0.045),
                                (13, 0.030), (21, 0.018)))

    def drift(angle):
        delta = (angle - breach + math.pi) % TAU - math.pi
        return (AMPHI_DRIFT * math.exp(-((delta / 0.98) ** 2))
                * (1.0 + dune_edge(angle)))

    def dune_profile(radius):
        """How the dune stands across the ring, from arena to outer apron.

        The exponent is the whole fix. A dune whose surface climbs at the same
        average slope as the seating (1.15 m of riser per 2.5 m of tread, so
        0.46) never gets above the stone anywhere and buries precisely nothing
        — which is exactly what the first version of this did. Pushing the
        exponent well below 1 makes the sand surface CONVEX, so it stands proud
        of the steps across the whole middle of the ring and only ties back in
        at the arena rim.
        """
        if radius <= ARENA_RADIUS:
            return 0.0
        crest = ARENA_RADIUS + AMPHI_TIERS * AMPHI_TREAD
        if radius <= crest:
            return ((radius - ARENA_RADIUS) / (crest - ARENA_RADIUS)) ** 0.50
        if radius <= wall_outer:
            return 1.0 - 0.30 * (radius - crest) / max(wall_outer - crest, 1e-4)
        return max(0.0, 0.70 * (1.0 - (radius - wall_outer) / (AMPHI_APRON + 1.4)))

    bm = bmesh.new()

    # (radius, height, band material, may the dune bury it, is it seating,
    # does it carry the outer-wall relief). Height is either a number, or a
    # callable of (angle, column) for the courses that have to follow the
    # broken top of the wall down into the breach. Bottom of the stack is the
    # arena floor; the list climbs the seating and comes back down the outside.
    def cornice(angle, column):
        return wall_top(angle, column) - 0.95

    def string_course(angle, column):
        return max((wall_top(angle, column) - 0.55) * 0.50, 0.35)

    def string_under(angle, column):
        return max(string_course(angle, column) - 0.62, 0.10)

    plan = [(ARENA_RADIUS, 0.0, "ruin_sand", True, False, False),
            (ARENA_RADIUS, PODIUM_Z, "ruin_dark", True, True, False)]
    radius = ARENA_RADIUS
    z = PODIUM_Z
    for tier in range(AMPHI_TIERS):
        radius += AMPHI_TREAD
        plan.append((radius, z, "ruin", True, True, False))          # tread
        z += AMPHI_RISER
        plan.append((radius, z, "ruin_dark", True, True, False))     # riser
    plan.append((radius, None, "ruin", True, False, False))          # inner face
    plan.append((wall_outer, None, "ruin_dark", True, False, True))  # top, outward
    # The outside of the wall is the single biggest surface on the asset and
    # the only one the player sees from the desert floor. Left as one band from
    # the top to the sand it renders as a blank concrete drum, so it is broken
    # by a projecting cornice and a string course — two horizontals that throw
    # real shadow lines — and by shallow pilasters carried on the radius, which
    # cost nothing at all because they ride harmonics already being evaluated.
    plan.append((wall_outer + 0.34, cornice, "ruin_dark", True, False, True))
    plan.append((wall_outer, string_course, "ruin", True, False, True))
    plan.append((wall_outer + 0.24, string_under, "ruin_dark", True, False, True))
    plan.append((wall_outer, -0.55, "ruin", True, False, True))
    # The apron drops as it goes OUT, not up. Flaring upward would leave a
    # horizontal ring of sand facing the sun all the way round the ring and it
    # renders as a saucer the asset is standing on; flaring downward puts that
    # surface under the desert where it belongs, and the dune side still banks
    # up over it because the height field wins the max().
    plan.append((apron_radius, -0.95, "ruin_sand", True, False, False))
    plan.append((apron_radius + 1.20, -2.60, "ruin_sand", False, False, False))

    rings = []
    sanded = []
    for entry_radius, entry_z, _band, buriable, seating, relief in plan:
        verts = []
        flags = []
        for column in range(AMPHI_COLUMNS):
            angle = TAU * column / AMPHI_COLUMNS
            r = entry_radius * (1.0 + settle(angle))
            if relief:
                r += pilaster(angle)
            if callable(entry_z):
                height = entry_z(angle, column)
            elif entry_z is None:
                height = wall_top(angle, column)
            else:
                height = entry_z
            if seating:
                height += creep[column]
                if column in aisles:
                    height -= 0.80
            sand = drift(angle) * dune_profile(r) if buriable else -99.0
            drowned = sand > height + 0.05
            if drowned:
                height = sand
            verts.append(bm.verts.new((math.cos(angle) * r, math.sin(angle) * r, height)))
            flags.append(drowned)
        rings.append(verts)
        sanded.append(flags)

    band_material = [entry[2] for entry in plan]

    def material_of(band, column):
        nxt = (column + 1) % AMPHI_COLUMNS
        drowned = (sanded[band][column] + sanded[band][nxt]
                   + sanded[band + 1][column] + sanded[band + 1][nxt])
        if drowned >= 3:
            return mat["ruin_sand"]
        if column in aisles and nxt in aisles:
            return mat["ruin_dark"]
        return mat[band_material[band]]

    _bridge(bm, rings, AMPHI_COLUMNS, material_of)

    # Arena floor: sand, dished very slightly so it does not render as a mirror
    # disc when the sun is high.
    hub = bm.verts.new((0.0, 0.0, -0.22))
    floor = rings[0]
    for column in range(AMPHI_COLUMNS):
        nxt = (column + 1) % AMPHI_COLUMNS
        face = bm.faces.new((floor[column], floor[nxt], hub))
        face.material_index = mat["ruin_sand"]
        face.smooth = False

    # A colonnade remnant along the top of the wall, only where the wall is
    # still tall enough to have carried one. Small blocks, but they are the
    # highest thing on the asset, so they own the silhouette at a kilometre.
    for step in range(18):
        column = int(step * AMPHI_COLUMNS / 18)
        angle = TAU * column / AMPHI_COLUMNS
        top = wall_top(angle, column)
        if top < AMPHI_WALL_Z - 0.55:
            continue
        r = (wall_outer - AMPHI_WALL_THICK * 0.5) * (1.0 + settle(angle))
        _block(
            bm, (math.cos(angle) * r, math.sin(angle) * r, top - 0.15),
            (1.25, 1.25, rng.uniform(2.2, 4.6)),
            _stone(rng, mat, dark=0.3),
            rng=rng, jitter=0.05, yaw=angle + rng.uniform(-0.08, 0.08), taper=0.88,
        )

    # The collapse itself: blocks off the wall lying in the arena and on the
    # seating under the breach, which is what makes the gap read as fallen
    # masonry rather than as a doorway someone left.
    for _ in range(22):
        angle = breach + rng.uniform(-1.15, 1.15)
        r = rng.uniform(ARENA_RADIUS * 0.35, wall_outer + 2.2)
        height = 0.0
        for band, entry in enumerate(plan):
            entry_radius, entry_z = entry[0], entry[1]
            if isinstance(entry_z, (int, float)) and entry_radius <= r:
                height = max(height, entry_z)
        height = max(height, drift(angle) * dune_profile(r))
        _rubble(bm, rng, (math.cos(angle) * r, math.sin(angle) * r, height),
                rng.uniform(0.9, 2.3),
                mat["ruin"] if rng.random() < 0.55 else mat["ruin_dark"])

    # The arena floor is the one big flat surface in the asset and it renders
    # as a swimming pool if it is left empty. Fallen seating and a broken
    # stretch of the podium wall give it something for the eye to land on, and
    # they are the props the player actually drives between.
    for index in range(11):
        angle = rng.uniform(0.0, TAU)
        r = ARENA_RADIUS * math.sqrt(rng.random()) * 0.92
        _rubble(bm, rng, (math.cos(angle) * r, math.sin(angle) * r, 0.0),
                rng.uniform(0.7, 1.9), _stone(rng, mat, dark=0.4))
    for index in range(5):
        angle = breach + math.pi + rng.uniform(-0.8, 0.8)
        r = ARENA_RADIUS * (1.0 + settle(angle)) - 0.5
        _block(
            bm, (math.cos(angle) * r, math.sin(angle) * r, -0.3),
            (1.6, 1.1, rng.uniform(0.8, 1.9)), _stone(rng, mat, dark=0.5),
            rng=rng, jitter=0.07, yaw=angle + 1.5708 + rng.uniform(-0.2, 0.2),
            taper=0.85,
        )

    # Hard clamp to the footprint raidEnvironment.js sizes its landmark
    # visibility box against.
    reach = max(math.hypot(v.co.x, v.co.y) for v in bm.verts)
    if reach > LANDMARK_MAX_RADIUS:
        shrink = LANDMARK_MAX_RADIUS / reach
        for vert in bm.verts:
            vert.co.x *= shrink
            vert.co.y *= shrink

    body = _finalise(f"{name}-body", bm, parent, slots)
    body["landmark_reach"] = min(reach, LANDMARK_MAX_RADIUS)
    return parent


# ---------------------------------------------------------------------------
# RaidRiftShard-0
# ---------------------------------------------------------------------------

_SHARD_PLAN = (
    # (x, y, height, radius, sides, tilt x, tilt y, seed offset)
    (0.00, 0.00, 5.40, 0.86, 7, 0.10, -0.06, 0),
    (1.55, 0.95, 3.05, 0.52, 6, -0.16, 0.13, 1),
    (-1.25, 1.05, 1.85, 0.40, 5, 0.19, 0.21, 2),
    (0.75, -1.60, 1.15, 0.30, 5, -0.12, -0.24, 3),
)


def _build_shard(palette):
    """Crystal shards standing out of the rift.

    A crystal is read by its FACETS, so the shards are prisms with only five to
    seven sides and a per-column radius that is fixed for the whole height: a
    facet therefore runs unbroken from the ground to the tip and catches one
    single value of light. Rounding them off, or jittering per ring, turns the
    crystal into a carrot.

    The colour is a gradient up the shard — scorched stone at the collar, blue
    body, violet-white core at the tip — because a shard that glows uniformly
    from the sand upwards has no contact with the ground and looks pasted on.
    """
    name = "RaidRiftShard-0"
    parent = _parent(name)
    rng = random.Random(0x53484152)
    slots, mat = _material_table(palette, ("rift_stone", "rift_glow", "rift_core"))

    bm = bmesh.new()
    # (height fraction, radius fraction). The kink at 0.55 is what stops the
    # shard being a cone: a crystal grows in segments and changes direction.
    profile = ((-0.10, 1.02), (0.06, 1.00), (0.34, 0.92), (0.63, 0.74), (0.87, 0.40))

    for x, y, height, radius, sides, tilt_x, tilt_y, offset in _SHARD_PLAN:
        shard_rng = random.Random(0x53484152 + offset * 7919)
        # Fixed per facet, for the whole height.
        facet = [1.0 + shard_rng.uniform(-0.30, 0.30) for _ in range(sides)]
        spin = shard_rng.uniform(0.0, TAU)
        lean = (Matrix.Rotation(tilt_x, 3, "X") @ Matrix.Rotation(tilt_y, 3, "Y"))
        base = Vector((x, y, 0.0))
        rings = []
        for level, factor in profile:
            verts = []
            for column in range(sides):
                angle = TAU * column / sides + spin
                r = radius * factor * facet[column]
                local = Vector((math.cos(angle) * r, math.sin(angle) * r, level * height))
                verts.append(bm.verts.new(base + (lean @ local)))
            rings.append(verts)

        def material_of(band, column, _sides=sides):
            if band == 0:
                return mat["rift_stone"]
            # Two facets lit, one dark, all the way up. Against an odd number
            # of sides the pattern never closes, so the shard reads as an
            # irregular crystal rather than as a striped cone.
            return mat["rift_stone"] if column % 3 == 0 else mat["rift_glow"]

        _bridge(bm, rings, sides, material_of)
        tip = bm.verts.new(base + (lean @ Vector((
            shard_rng.uniform(-0.10, 0.10) * radius,
            shard_rng.uniform(-0.10, 0.10) * radius,
            height,
        ))))
        for column in range(sides):
            nxt = (column + 1) % sides
            face = bm.faces.new((rings[-1][column], rings[-1][nxt], tip))
            # The tip is the hottest thing in the asset and it is the part that
            # survives to the horizon, so it gets the bright core material.
            face.material_index = mat["rift_core"]
            face.smooth = False
        # Cap the buried end so the shard is a closed solid.
        hub = bm.verts.new(base + (lean @ Vector((0.0, 0.0, -0.10 * height - 0.35))))
        for column in range(sides):
            nxt = (column + 1) % sides
            face = bm.faces.new((rings[0][column], rings[0][nxt], hub))
            face.material_index = mat["rift_stone"]
            face.smooth = False

    # The broken collar of rock the shards came up through. Plates tipped
    # outward, away from the shard: that is what upthrust looks like, and it
    # gives the base a shadow so the glow has something to sit against.
    for index in range(9):
        angle = TAU * index / 9 + rng.uniform(-0.16, 0.16)
        r = rng.uniform(1.05, 1.95)
        _block(
            bm, (math.cos(angle) * r, math.sin(angle) * r, -0.32),
            (rng.uniform(0.7, 1.3), rng.uniform(0.45, 0.9), rng.uniform(0.55, 1.15)),
            mat["rift_stone"], rng=rng, jitter=0.10,
            yaw=angle + rng.uniform(-0.3, 0.3),
            tilt=(math.sin(angle) * 0.34, -math.cos(angle) * 0.34),
            taper=rng.uniform(0.55, 0.85),
        )
    # A few glowing splinters low down, so the light does not all live at head
    # height.
    for index in range(5):
        angle = TAU * index / 5 + 0.4
        r = rng.uniform(1.3, 2.3)
        _block(
            bm, (math.cos(angle) * r, math.sin(angle) * r, -0.15),
            (0.22, 0.16, rng.uniform(0.40, 0.85)),
            mat["rift_glow"], rng=rng, jitter=0.08,
            yaw=angle, tilt=(math.sin(angle) * 0.5, -math.cos(angle) * 0.5), taper=0.25,
        )

    _finalise(f"{name}-body", bm, parent, slots)
    return parent


# ---------------------------------------------------------------------------
# RaidRiftVent-0
# ---------------------------------------------------------------------------

VENT_COLUMNS = 32
# The first column of each fracture. A crack is TWO columns wide, never one:
# a quad only glows when both of its columns are inside the fracture, so a
# one-column crack has no lit quad anywhere along it and renders as nothing at
# all. This is not a tuning detail — a one-column crack is invisible.
VENT_CRACKS = (2, 8, 14, 20, 26)
VENT_CRACK_WIDTH = 2


def _build_vent(palette):
    """A fractured vent with energy cracks radiating out across the sand.

    Two failure modes decided the shape.

    * The glow must live ABOVE the contact plane. A vent modelled as a hole
      with light at the bottom of it is invisible the moment it is dropped on a
      heightfield, because the terrain closes over the throat. So the ground
      here is broken UPWARD: a low mound with the fractured throat standing
      proud of it, and the brightest surface at +0.2 m rather than -1 m.
    * The cracks are cut INTO the mound, not laid on top of it as decals. A
      flat emissive quad spanning eight metres of desert only lies flush on
      dead-level ground; a groove in the asset's own surface is correct on any
      slope, and it can never z-fight with the terrain.

    The cracks are therefore columns of the lathe that are pulled down and
    given the glow material. They run from the lip out to the toe of the mound
    and narrow as they go, which is what a radiating fracture does.
    """
    name = "RaidRiftVent-0"
    parent = _parent(name)
    rng = random.Random(0x56454E54)
    slots, mat = _material_table(palette, ("rift_stone", "rift_glow", "rift_core", "ruin_sand"))

    bm = bmesh.new()
    jitter = [rng.uniform(-0.055, 0.055) for _ in range(VENT_COLUMNS)]
    lip = [rng.uniform(-0.16, 0.24) for _ in range(VENT_COLUMNS)]

    def crack_strength(column):
        """1.0 inside a fracture, 0.4 on the lip either side of it, else 0."""
        best = 0.0
        for start in VENT_CRACKS:
            for step in range(VENT_CRACK_WIDTH):
                if (start + step) % VENT_COLUMNS == column:
                    return 1.0
            for edge in (start - 1, start + VENT_CRACK_WIDTH):
                if edge % VENT_COLUMNS == column:
                    best = max(best, 0.40)
        return best

    # (radius, height, depth of the fracture groove at this radius, material).
    # Bottom of the list is the buried toe; the lathe climbs inward and upward
    # to the glowing throat.
    plan = (
        (6.90, -1.30, 0.00, "ruin_sand"),   # buried skirt
        (6.10, 0.06, 0.10, "ruin_sand"),    # toe of the mound
        (4.40, 0.34, 0.26, "ruin_sand"),
        (3.10, 0.74, 0.38, "rift_stone"),
        (2.05, 1.24, 0.44, "rift_stone"),   # the lip: broken plates standing up
        (1.55, 0.86, 0.16, "rift_stone"),   # inner face, dropping into the throat
        (1.25, 0.50, 0.00, "rift_glow"),
    )

    # Pinch the two columns of each fracture toward each other. A crack has to
    # be two columns wide to have a quad of its own, but two columns of a
    # 32-sided lathe is a 22 degree wedge — that renders as a spilled tin of
    # paint, not as a fissure. Squeezing the pair together narrows the lit quad
    # to about four degrees while leaving the topology, and therefore the
    # triangle count, exactly as it was.
    step = TAU / VENT_COLUMNS
    skew = [0.0] * VENT_COLUMNS
    for start in VENT_CRACKS:
        skew[start % VENT_COLUMNS] += step * 0.34
        skew[(start + 1) % VENT_COLUMNS] -= step * 0.34

    rings = []
    for radius, height, groove, _band in plan:
        verts = []
        for column in range(VENT_COLUMNS):
            angle = TAU * column / VENT_COLUMNS + skew[column]
            r = radius * (1.0 + jitter[column])
            crack = crack_strength(column)
            z = height + lip[column] * (0.55 if radius < 3.0 else 0.12) - groove * crack
            verts.append(bm.verts.new((math.cos(angle) * r, math.sin(angle) * r, z)))
        rings.append(verts)

    band_material = [entry[3] for entry in plan]
    groove_depth = [entry[2] for entry in plan]

    def material_of(band, column):
        nxt = (column + 1) % VENT_COLUMNS
        # A quad is glowing if BOTH of its columns are in the fracture and the
        # band it sits in has a groove to be lit at the bottom of.
        if groove_depth[band] > 0.04 and groove_depth[band + 1] > 0.0:
            if crack_strength(column) > 0.55 and crack_strength(nxt) > 0.55:
                return mat["rift_glow"]
        return mat[band_material[band]]

    _bridge(bm, rings, VENT_COLUMNS, material_of)

    # The throat floor. Sits at +0.20, above the contact plane, so it is never
    # swallowed by the terrain, and it is the one surface using the hot core
    # material — the single brightest point of the whole stage.
    hub = bm.verts.new((0.0, 0.0, 0.26))
    inner = rings[-1]
    for column in range(VENT_COLUMNS):
        nxt = (column + 1) % VENT_COLUMNS
        face = bm.faces.new((inner[column], inner[nxt], hub))
        face.material_index = mat["rift_core"]
        face.smooth = False

    # Plates of the old ground surface, levered up around the lip. They are
    # what stop the mound reading as a mud volcano.
    for index in range(7):
        angle = TAU * index / 7 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(2.2, 3.4)
        _block(
            bm, (math.cos(angle) * r, math.sin(angle) * r, 0.30),
            (rng.uniform(1.0, 1.9), rng.uniform(0.7, 1.2), rng.uniform(0.20, 0.34)),
            mat["rift_stone"], rng=rng, jitter=0.09,
            yaw=angle + 1.5708 + rng.uniform(-0.25, 0.25),
            tilt=(math.sin(angle) * 0.42, -math.cos(angle) * 0.42),
        )
    # Small shards standing in the throat, so the glow has an occluder in front
    # of it and reads as depth rather than as a lit disc.
    for index in range(4):
        angle = TAU * index / 4 + 0.7
        r = rng.uniform(0.55, 1.15)
        _block(
            bm, (math.cos(angle) * r, math.sin(angle) * r, 0.24),
            (0.30, 0.24, rng.uniform(0.65, 1.35)),
            mat["rift_glow"], rng=rng, jitter=0.07,
            yaw=angle, tilt=(math.sin(angle) * 0.30, -math.cos(angle) * 0.30), taper=0.20,
        )

    _finalise(f"{name}-body", bm, parent, slots)
    return parent


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_ruins(materials) -> None:
    """Create every Raid ruin and rift asset in the current scene."""
    palette = {role: _resolve_material(materials, role) for role in _ROLE_KEYS}

    built = [
        _build_arch(palette),
        _build_columns(palette),
        _build_fallen(palette),
        _build_wall(palette),
        _build_amphitheatre(palette),
        _build_shard(palette),
        _build_vent(palette),
    ]

    bpy.context.view_layer.update()
    for parent in built:
        for child in parent.children:
            print(f"[raid-ruin] {child.name}: {_triangles(child)} triangles")
