"""Kaki Rally Raid — landmark geometry (mesa, spire).

These are the two assets the player navigates by, so they are authored for
SILHOUETTE first. Everything here is built as a single seeded lathe with
per-column erosion fields rather than as stacked primitives, because a cone
plus a cylinder plus a cone reads as three floating tiers the moment it is
more than a couple of hundred metres away.

Original project geometry. Nothing is downloaded, traced, or derived from a
third party, so the kit carries no attribution burden.

Conventions shared with the rest of the raid kit:
  * +Z up in Blender (the GLB export converts to +Y up).
  * Origin at the ground contact point: the talus toe sits on z = 0, and a
    short buried skirt runs below it so a landmark dropped on sloping terrain
    does not show daylight under its apron.
  * Deterministic. Every random stream is a local ``random.Random(seed)``;
    this module never touches the global ``random`` state, so import order
    across sibling kit modules cannot shift the result.

``materials`` contract — a dict of Blender materials:
    "rock"       required — main cliff tone
    "rock_dark"  required — recessed strata, scree, under-cap shadow band
    "sand"       required — talus apron blending into the desert floor
    "rock_warm"  optional — sun-bleached caprock; falls back to "rock"

Footprint contract — ``raidEnvironment.js`` derives
``LANDMARK_VISIBLE_HALF_EXTENT`` from the mesa's baked footprint (38.4 m from
its own centre). ``MESA_MAX_RADIUS`` below is the authored cap and the build
hard-clamps to it, so that constant stays valid.
"""

from __future__ import annotations

import math
import random

import bmesh
import bpy

TAU = math.tau

# Hard XY cap. raidEnvironment.js sizes its landmark visibility box from this.
MESA_MAX_RADIUS = 38.0


# ---------------------------------------------------------------------------
# Seeded field helpers
# ---------------------------------------------------------------------------

def _harmonic(rng, terms):
    """A smooth periodic function of the lathe angle.

    Low harmonics give buttresses and re-entrants (the big silhouette win);
    high harmonics give the vertical fluting that only reads up close. Because
    the function depends on angle alone, a flute runs the full height of the
    cliff instead of dissolving into per-vertex noise.
    """
    parts = [(k, amp, rng.uniform(0.0, TAU)) for k, amp in terms]

    def field(angle):
        return sum(amp * math.sin(k * angle + phase) for k, amp, phase in parts)

    return field


def _gullies(rng, count, width, depth):
    """Water-cut gullies, each with a spur of harder rock standing beside it.

    A gully modelled as a symmetric dent just darkens a strip of wall and reads
    as a painted stripe. Pairing every cut with a raised spur on one side gives
    each gully a lit face and a shadowed face, which is what actually reads as a
    channel carved into rock.
    """
    cuts = []
    for _ in range(count):
        cuts.append((
            rng.uniform(0.0, TAU),
            width * rng.uniform(0.75, 1.25),
            depth * rng.uniform(0.7, 1.15),
            rng.choice((-1.0, 1.0)),
        ))
    limit = depth * 1.25

    def field(angle):
        total = 0.0
        for centre, half, deep, side in cuts:
            delta = (angle - centre + math.pi) % TAU - math.pi
            total += deep * math.exp(-((delta / half) ** 2))
            spur = (delta - side * 2.0 * half) / (1.35 * half)
            total -= deep * 0.35 * math.exp(-(spur ** 2))
        # Two gullies that happen to land near each other must not add into one
        # trench deep enough to render as a black bar painted down the wall.
        return min(max(total, -limit), limit)

    return field, [cut[0] for cut in cuts]


def _arc_bench(centre, half_width, edge, drop):
    """A flat-bottomed step down over an arc: a collapsed bench in a caprock rim.

    Flat-bottomed matters. A cosine-eased dip tilts the whole summit and the
    butte turns into a loaf of bread; a bench keeps the top FLAT and takes a
    bite out of one side, which is what a broken rim actually looks like.
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
# Mesh helpers
# ---------------------------------------------------------------------------

def _resolve_materials(materials):
    rock = materials["rock"]
    dark = materials["rock_dark"]
    sand = materials["sand"]
    warm = materials.get("rock_warm", rock)
    return {"rock": rock, "rock_dark": dark, "sand": sand, "rock_warm": warm}


def _material_table(palette, names):
    """Stable material slot order so the exported primitives are predictable."""
    slots = []
    index = {}
    for name in names:
        mat = palette[name]
        if mat.name not in index:
            index[mat.name] = len(slots)
            slots.append(mat)
    return slots, {name: index[palette[name].name] for name in names}


def _chunk(bm, centre, radii, rng, material_index, smooth=False):
    """A 12-triangle angular rock lump: hexagonal ring pinched to a point top
    and bottom, then jittered. Cheap enough to sprinkle a dozen of them and
    still stay inside the landmark polygon budget."""
    cx, cy, cz = centre
    rx, ry, rz = radii
    ring = []
    for i in range(6):
        angle = TAU * i / 6.0 + rng.uniform(-0.24, 0.24)
        stretch = rng.uniform(0.72, 1.24)
        ring.append(
            bm.verts.new((
                cx + math.cos(angle) * rx * stretch,
                cy + math.sin(angle) * ry * stretch,
                cz + rng.uniform(-0.18, 0.18) * rz,
            ))
        )
    top = bm.verts.new((cx + rng.uniform(-0.3, 0.3) * rx, cy + rng.uniform(-0.3, 0.3) * ry, cz + rz))
    bottom = bm.verts.new((cx, cy, cz - rz * 1.4))
    for i in range(6):
        a = ring[i]
        b = ring[(i + 1) % 6]
        for face in (bm.faces.new((a, b, top)), bm.faces.new((b, a, bottom))):
            face.material_index = material_index
            face.smooth = smooth


def _finalise(bm, name, slots, parent, smooth_default=False):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mat in slots:
        mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent
    obj["uv_ready"] = True
    return obj


def _cylindrical_uvs(bm, columns, height, column_of):
    """Seam-free cylindrical unwrap driven by the lathe column index, so the
    wrap-around column does not smear a whole texture width across one face."""
    uv_layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        cols = [column_of.get(loop.vert, None) for loop in face.loops]
        wrap = any(c is not None for c in cols) and (
            max(c for c in cols if c is not None) - min(c for c in cols if c is not None) > columns * 0.5
        )
        for loop in face.loops:
            col = column_of.get(loop.vert)
            if col is None:
                u = 0.5
            else:
                u = col / columns
                if wrap and col == 0:
                    u = 1.0
            loop[uv_layer].uv = (u, loop.vert.co.z / max(height, 1e-5))


def _parent(name):
    parent = bpy.data.objects.new(name, None)
    parent.location = (0.0, 0.0, 0.0)
    parent["kaki_asset"] = True
    parent["source"] = "Kaki Rally Raid original Blender geometry"
    bpy.context.scene.collection.objects.link(parent)
    return parent


# ---------------------------------------------------------------------------
# RaidMesa-0
# ---------------------------------------------------------------------------

MESA_COLUMNS = 44
MESA_RADIUS = 25.0
MESA_FOOT_Z = 3.60          # where the talus stops and the wall starts
MESA_WALL_TOP_Z = 18.60     # top of the bedded wall, under the caprock
MESA_RIM_Z = 20.90          # caprock rim height where the rim is unbroken

# Apron rings: (z, radius factor, material of the band above). The talus is a
# steep cone, not a saucer.
#
# The buried skirt is WIDER than the toe on purpose. Flaring outwards as it
# rises would leave a near-horizontal annulus at ground level facing straight at
# the sun, which renders as a bright ring round the base and reads as a saucer.
# Flaring outwards as it DROPS puts that surface below the sand where it belongs.
MESA_APRON = (
    (-1.70, 1.290, "sand"),      # buried skirt, hides gaps on sloping terrain
    (0.00, 1.205, "sand"),       # thin sand fringe where the talus meets desert
    (0.90, 1.165, "rock_dark"),  # coarse scree, already rock-coloured
    (2.20, 1.095, "rock_dark"),
)

# Wall strata: (z, inset, material of the band above). Insets are deliberately
# shallow. Deep even bands ring the wall as unbroken horizontals and the whole
# thing reads as a stack of pancakes — the exact failure of the old mesa. The
# bedding is a colour cue; the VERTICAL fluting and gullies carry the form.
MESA_STRATA = (
    (3.60, 0.000, "rock"),
    (4.80, 0.014, "rock_dark"),  # one thin dark bed low on the wall
    (7.10, 0.003, "rock"),
    (8.60, 0.020, "rock"),
    (11.40, 0.006, "rock"),
    (12.60, 0.009, "rock"),
    (15.20, 0.020, "rock_dark"), # the one real undercut, high on the wall
    (16.30, 0.005, "rock"),
    (18.60, 0.002, "rock"),
)


def _build_mesa(palette):
    name = "RaidMesa-0"
    parent = _parent(name)
    rng = random.Random(0x4D455341)

    slots, mat = _material_table(palette, ("sand", "rock_dark", "rock", "rock_warm"))

    # Big forms. A butte is an erosion remnant, so its plan is a lopsided blob
    # with noses and bays, never a circle. The k=1 term is what makes it lopsided
    # and it is the single biggest silhouette win at a kilometre.
    buttress = _harmonic(rng, ((1, 0.112), (2, 0.094), (3, 0.078), (5, 0.049), (7, 0.028)))
    flute = _harmonic(rng, ((11, 0.036), (17, 0.024), (23, 0.014)))
    # Many shallow gullies, not a few deep ones. A deep cut turns its facet far
    # enough from the sun that it renders as a flat black bar painted on the
    # wall; shallow cuts read as carved channels.
    gully, gully_angles = _gullies(rng, 6, 0.165, 0.070)
    # A gully that runs dead vertical presents one unbroken facet from talus to
    # caprock and renders as a stripe painted on the wall. Drifting its centre
    # with height makes it snake, so every bedding course catches the light at a
    # different angle and it reads as a carved channel.
    gully_drift_phase = rng.uniform(0.0, TAU)

    # The rim stays FLAT — that is the whole identity of a butte — and is broken
    # instead by two collapsed benches and a narrow slot. Tilting the rim turns
    # the silhouette into a loaf; biting chunks out of a level rim keeps it a
    # butte and still stops it reading as a tin can.
    rim_wave = _harmonic(rng, ((1, 0.46), (2, 0.34), (3, 0.22), (5, 0.13)))
    bench_a = _arc_bench(rng.uniform(0.0, TAU), 0.98, 0.30, 4.40)
    bench_b = _arc_bench(rng.uniform(0.0, TAU), 0.46, 0.20, 2.30)
    slot = _arc_bench(rng.uniform(0.0, TAU), 0.13, 0.07, 3.10)
    column_jitter = [rng.uniform(-0.009, 0.009) for _ in range(MESA_COLUMNS)]
    # A caprock edge is crumbling blocks, not a machined lip.
    rim_crumble = [rng.uniform(-0.34, 0.20) for _ in range(MESA_COLUMNS)]
    # Per-strata angular phase, so bedding lines undulate around the wall
    # instead of ringing it as perfect horizontals.
    band_wave = [_harmonic(rng, ((2, 0.5), (3, 0.34))) for _ in MESA_STRATA]

    def rim_height(angle, column=None):
        height = MESA_RIM_Z + rim_wave(angle) - bench_a(angle) - bench_b(angle) - slot(angle)
        if column is not None:
            height += rim_crumble[column]
        return height

    def wall_taper(z):
        """The wall leans in as it rises, with a slight belly. A dead-vertical
        wall of constant radius is a cylinder no matter what is carved on it."""
        t = (z - MESA_FOOT_Z) / (MESA_WALL_TOP_Z - MESA_FOOT_Z)
        t = min(max(t, 0.0), 1.0)
        return 1.020 - 0.125 * t + 0.030 * math.sin(t * math.pi)

    def plan(angle, column, relief=1.0):
        """`relief` fades the vertical structure with height: a buttress is a
        pier of rock leaning against the wall, thickest where it meets the
        talus. Fading it upwards puts diagonals into the silhouette, which is
        what separates a butte from a drum."""
        return 1.0 + buttress(angle) * relief + column_jitter[column]

    bm = bmesh.new()
    column_of = {}
    rings = []
    smooth_band = []
    band_material = []

    for z, factor, band in MESA_APRON:
        verts = []
        for column in range(MESA_COLUMNS):
            angle = TAU * column / MESA_COLUMNS
            # Talus fans out below a gully: that is where the debris lands. The
            # fans are what stop the toe reading as a saucer rim.
            radius = MESA_RADIUS * factor * (
                plan(angle, column, 1.15) + gully(angle) * 0.85 + flute(angle) * 0.55
            )
            vert = bm.verts.new((math.cos(angle) * radius, math.sin(angle) * radius, z))
            column_of[vert] = column
            verts.append(vert)
        rings.append(verts)
        smooth_band.append(True)
        band_material.append(mat[band])

    for index, (z, inset, band) in enumerate(MESA_STRATA):
        wave = band_wave[index]
        t = (z - MESA_FOOT_Z) / (MESA_WALL_TOP_Z - MESA_FOOT_Z)
        drift = 0.155 * math.sin(t * 2.7 + gully_drift_phase)
        twist = 0.11 * t
        verts = []
        for column in range(MESA_COLUMNS):
            angle = TAU * column / MESA_COLUMNS
            scale = plan(angle, column, 1.22 - 0.44 * t)
            # Gullies cut top to bottom, biting hardest at the foot and healing
            # out under the caprock. They are what breaks the bedding lines into
            # separate cliff faces instead of one continuous ring.
            scale -= gully(angle + drift) * (0.14 + 0.94 * (1.0 - t) ** 0.8)
            scale += flute(angle + twist) * (0.55 + t * 0.45)
            scale -= inset * (1.0 + 0.4 * wave(angle))
            radius = MESA_RADIUS * wall_taper(z) * scale
            vert = bm.verts.new((
                math.cos(angle) * radius,
                math.sin(angle) * radius,
                z + wave(angle) * 0.60,
            ))
            column_of[vert] = column
            verts.append(vert)
        rings.append(verts)
        smooth_band.append(False)
        band_material.append(mat[band])

    # Caprock. Continuous with the wall — no ring-shaped overhang, because a
    # uniform lip plus the shadow under it is exactly what made pass one read as
    # a table top balanced on a drum. The cap earns its separation from the rim
    # profile and from colour, not from a ledge.
    cap_jut = _harmonic(rng, ((2, 0.5), (3, 0.4), (5, 0.28)))
    for drop, base_factor, band in ((1.30, 0.888, "rock"), (0.0, 0.862, "rock_warm")):
        verts = []
        for column in range(MESA_COLUMNS):
            angle = TAU * column / MESA_COLUMNS
            jut = max(0.0, cap_jut(angle)) * 0.05 if drop > 0.0 else 0.0
            scale = plan(angle, column, 0.72) + jut + flute(angle) * 0.35 - gully(angle) * 0.45
            radius = MESA_RADIUS * base_factor * scale
            vert = bm.verts.new((
                math.cos(angle) * radius,
                math.sin(angle) * radius,
                rim_height(angle, None if drop > 0.0 else column) - drop,
            ))
            column_of[vert] = column
            verts.append(vert)
        rings.append(verts)
        smooth_band.append(False)
        band_material.append(mat[band])

    # Plateau. Level with the unbroken rim, so the top stays flat; where a bench
    # has collapsed it drops with the rim and the interior slopes back up to the
    # summit, which reads as a broken shelf rather than as a dish.
    plateau = []
    for column in range(MESA_COLUMNS):
        angle = TAU * column / MESA_COLUMNS
        radius = MESA_RADIUS * 0.62 * (1.0 + buttress(angle) * 0.5)
        rim = rim_height(angle)
        vert = bm.verts.new((
            math.cos(angle) * radius,
            math.sin(angle) * radius,
            min(rim - 0.55, MESA_RIM_Z - 0.50),
        ))
        column_of[vert] = column
        plateau.append(vert)
    rings.append(plateau)
    smooth_band.append(False)
    band_material.append(mat["rock_warm"])

    # Level with the plateau ring, so the summit fan stays a flat top rather
    # than a low tent with radial creases in it.
    summit = bm.verts.new((MESA_RADIUS * 0.11, -MESA_RADIUS * 0.07, MESA_RIM_Z - 0.34))

    for index in range(len(rings) - 1):
        lower = rings[index]
        upper = rings[index + 1]
        for column in range(MESA_COLUMNS):
            nxt = (column + 1) % MESA_COLUMNS
            face = bm.faces.new((lower[column], lower[nxt], upper[nxt], upper[column]))
            face.material_index = band_material[index]
            face.smooth = smooth_band[index]
    for column in range(MESA_COLUMNS):
        nxt = (column + 1) % MESA_COLUMNS
        face = bm.faces.new((plateau[column], plateau[nxt], summit))
        face.material_index = mat["rock_warm"]
        face.smooth = False

    # Fallen blocks and scree fans. Placed under the gullies, because that is
    # where a real talus cone builds, and they give the eye something of known
    # size to measure the cliff against.
    scree_rng = random.Random(0x53435245)
    for angle in gully_angles[:2]:
        for _ in range(2):
            a = angle + scree_rng.uniform(-0.24, 0.24)
            radius = MESA_RADIUS * scree_rng.uniform(1.00, 1.26)
            size = scree_rng.uniform(1.0, 2.2)
            _chunk(
                bm,
                (math.cos(a) * radius, math.sin(a) * radius, size * 0.5),
                (size * 1.5, size * 1.35, size),
                scree_rng,
                mat["rock_dark"],
            )
    for _ in range(3):
        a = scree_rng.uniform(0.0, TAU)
        radius = MESA_RADIUS * scree_rng.uniform(0.98, 1.18)
        size = scree_rng.uniform(1.6, 3.0)
        _chunk(
            bm,
            (math.cos(a) * radius, math.sin(a) * radius, size * 0.42),
            (size * 1.7, size * 1.4, size * 0.85),
            scree_rng,
            mat["rock"],
        )

    # Hard clamp to the footprint raidEnvironment.js was sized against.
    reach = max(math.hypot(v.co.x, v.co.y) for v in bm.verts)
    if reach > MESA_MAX_RADIUS:
        shrink = MESA_MAX_RADIUS / reach
        for vert in bm.verts:
            vert.co.x *= shrink
            vert.co.y *= shrink

    _cylindrical_uvs(bm, MESA_COLUMNS, MESA_RIM_Z + 3.0, column_of)
    body = _finalise(bm, f"{name}-body", slots, parent)
    body["landmark_reach"] = min(reach, MESA_MAX_RADIUS)
    return parent


# ---------------------------------------------------------------------------
# RaidSpire-0
# ---------------------------------------------------------------------------

SPIRE_COLUMNS = 22
SPIRE_RADIUS = 2.05

# (z, radius factor, material of the band above). Wide flared foot, pinched
# waist, a resistant flare, then a broken point: a wind-eroded hoodoo profile,
# not a cone.
SPIRE_RINGS = (
    (-0.60, 1.34, "sand"),
    (0.00, 1.26, "sand"),        # thin sand fringe, same trick as the mesa toe
    (0.55, 1.15, "rock_dark"),
    (1.40, 0.860, "rock"),
    (2.45, 0.640, "rock"),
    (3.35, 0.360, "rock_dark"),  # first neck, wind-scoured and deep
    (4.20, 0.520, "rock"),       # resistant bed flares back out over the neck
    (5.20, 0.295, "rock"),       # second, tighter neck
    (6.00, 0.430, "rock_dark"),  # the cap block a hoodoo balances on
    (6.80, 0.245, "rock"),
    (7.60, 0.215, "rock"),
    (8.30, 0.130, "rock"),
)
SPIRE_TIP_Z = 8.70


def _build_spire(palette):
    name = "RaidSpire-0"
    parent = _parent(name)
    rng = random.Random(0x53504952)

    slots, mat = _material_table(palette, ("sand", "rock_dark", "rock"))

    # A spire is thin, so the angular field has to be violent to read at all.
    lobes = _harmonic(rng, ((1, 0.105), (2, 0.098), (3, 0.072), (5, 0.044)))
    flute = _harmonic(rng, ((7, 0.078), (11, 0.048), (15, 0.027)))
    column_jitter = [rng.uniform(-0.040, 0.040) for _ in range(SPIRE_COLUMNS)]

    # Lean and sway. Offsetting each ring centre kills the solid-of-revolution
    # read that made the old cone look like a traffic bollard.
    lean = (rng.uniform(0.075, 0.135) * rng.choice((-1, 1)), rng.uniform(0.075, 0.135) * rng.choice((-1, 1)))
    sway_phase = rng.uniform(0.0, TAU)

    def centre_of(z):
        t = max(0.0, z) / SPIRE_TIP_Z
        bend = t ** 1.7
        sway = math.sin(t * 2.6 + sway_phase) * 0.16
        return (
            lean[0] * SPIRE_TIP_Z * bend + math.cos(sway_phase) * sway,
            lean[1] * SPIRE_TIP_Z * bend + math.sin(sway_phase) * sway,
        )

    bm = bmesh.new()
    column_of = {}
    rings = []
    band_material = []

    for z, factor, band in SPIRE_RINGS:
        t = max(0.0, z) / SPIRE_TIP_Z
        # The flutes twist as they climb, the way wind-scoured rock does.
        twist = t * 0.9
        cx, cy = centre_of(z)
        verts = []
        for column in range(SPIRE_COLUMNS):
            angle = TAU * column / SPIRE_COLUMNS
            scale = 1.0 + lobes(angle) + column_jitter[column]
            scale += flute(angle + twist) * (0.4 + t * 0.9)
            radius = SPIRE_RADIUS * factor * scale
            vert = bm.verts.new((
                cx + math.cos(angle) * radius,
                cy + math.sin(angle) * radius,
                z + lobes(angle) * (0.55 if z > 0.2 else 0.0),
            ))
            column_of[vert] = column
            verts.append(vert)
        rings.append(verts)
        band_material.append(mat[band])

    tip_cx, tip_cy = centre_of(SPIRE_TIP_Z)
    tip = bm.verts.new((tip_cx + 0.16, tip_cy - 0.11, SPIRE_TIP_Z))

    for index in range(len(rings) - 1):
        lower = rings[index]
        upper = rings[index + 1]
        smooth = index == 0
        for column in range(SPIRE_COLUMNS):
            nxt = (column + 1) % SPIRE_COLUMNS
            face = bm.faces.new((lower[column], lower[nxt], upper[nxt], upper[column]))
            face.material_index = band_material[index]
            face.smooth = smooth
    for column in range(SPIRE_COLUMNS):
        nxt = (column + 1) % SPIRE_COLUMNS
        face = bm.faces.new((rings[-1][column], rings[-1][nxt], tip))
        face.material_index = mat["rock"]
        face.smooth = False

    scree_rng = random.Random(0x53505243)
    for _ in range(5):
        a = scree_rng.uniform(0.0, TAU)
        radius = SPIRE_RADIUS * scree_rng.uniform(1.15, 1.75)
        size = scree_rng.uniform(0.16, 0.42)
        _chunk(
            bm,
            (math.cos(a) * radius, math.sin(a) * radius, size * 0.45),
            (size * 1.6, size * 1.3, size),
            scree_rng,
            mat["rock_dark"],
        )

    _cylindrical_uvs(bm, SPIRE_COLUMNS, SPIRE_TIP_Z, column_of)
    _finalise(bm, f"{name}-body", slots, parent)
    return parent


# ---------------------------------------------------------------------------

def build_landmarks(materials) -> None:
    """Create RaidMesa-0 and RaidSpire-0 in the current scene."""
    palette = _resolve_materials(materials)
    _build_mesa(palette)
    _build_spire(palette)
