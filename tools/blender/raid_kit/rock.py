"""Authored rock assets for the Kaki Rally Raid desert kit.

    from raid_kit.rock import build_rocks
    build_rocks(materials)

`materials` is a mapping of role name to `bpy.types.Material`. Recognised keys:

    "rock"       the lit sandstone body colour
    "rock_dark"  the recessed / undercut / shadowed-bed colour

Either may be missing (or the whole mapping may be empty) and this module makes
its own warm desert fallback, so the preview script can call `build_rocks({})`.

Builds, each as one mesh object parented to an empty of the same name:

    RaidBoulder-0  ~1.5 m   RaidBoulder-1  ~2.6 m   RaidBoulder-2  ~4.0 m
    RaidSlab-0     ~5 m     RaidSlab-1     ~8 m
    RaidGravel-0   ~2.4 m across            RaidGravel-1   ~4 m across

Every asset is authored around its own origin at the ground contact point with
+Z up, and every asset carries a shallow buried skirt below z=0 so the scatter
beds it into the terrain instead of perching it on top.

Original project geometry. Nothing here is downloaded, traced or derived from a
third party, so the kit carries no attribution burden and no licence risk.

How the rock is made, and why it is not the old jittered icosphere:

* The mass is a lofted stack of irregular rings whose radius profile goes wide
  at the ground, pinches into an eroded waist, swells back out into an
  oversailing shoulder and then tapers. The silhouette moves back inward as it
  rises, so it is genuinely non-convex: it has an overhang. A jittered sphere
  never can.
* The ring outline is driven by coherent angular lobes shared down the whole
  stack, not per-vertex white noise, so the rock has a few big asymmetric
  masses rather than a uniformly bumpy skin.
* Flat cleavage planes are then cut through the mass with `bisect_plane`, which
  leaves a perfectly flat broken face meeting the rest of the form at a hard
  arris. That is what makes rock read as fractured stone.
* Slabs are built bed by bed as sandstone is: thin horizontal beds of varying
  thickness, each rotated and offset a little, with resistant beds left
  oversailing the softer beds below them to throw an undercut shadow.
* Faces that point downward or sit low in the form take the darker material, so
  undercuts and ground contact read dark without any texture work.
"""

from __future__ import annotations

import math
from random import Random

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

_ROLE_KEYS = {
    "rock": ("rock", "RaidRock", "raid_rock"),
    "rock_dark": ("rock_dark", "RaidRockDark", "raid_rock_dark"),
}
_ROLE_FALLBACK = {
    "rock": ("RaidRock", (0.298, 0.238, 0.190), 0.90),
    "rock_dark": ("RaidRockDark", (0.132, 0.101, 0.082), 0.96),
}


def _resolve_material(materials, role):
    source = materials if hasattr(materials, "get") else {}
    for key in _ROLE_KEYS[role]:
        found = source.get(key)
        if found is not None:
            return found
    name, colour, roughness = _ROLE_FALLBACK[role]
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


# ---------------------------------------------------------------------------
# Scene plumbing
# ---------------------------------------------------------------------------


def _parent_asset(name):
    parent = bpy.data.objects.new(name, None)
    parent.location = (0.0, 0.0, 0.0)
    parent.empty_display_size = 0.4
    parent["kaki_asset"] = True
    parent["source"] = "Kaki Rally Raid original Blender geometry"
    bpy.context.scene.collection.objects.link(parent)
    return parent


def _finalise(name, bm, parent, mats, bevel_width, bevel_angle=32.0):
    """Turn a finished bmesh into a flat-shaded, bevelled, UV'd child object."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(verbose=False)
    for polygon in mesh.polygons:
        polygon.use_smooth = False

    obj = bpy.data.objects.new(name, mesh)
    for mat in mats:
        mesh.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = parent

    if bevel_width > 0.0:
        modifier = obj.modifiers.new("Arris bevel", "BEVEL")
        modifier.width = bevel_width
        modifier.segments = 1
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(bevel_angle)
        if hasattr(modifier, "use_clamp_overlap"):
            modifier.use_clamp_overlap = True
        elif hasattr(modifier, "clamp_overlap"):
            modifier.clamp_overlap = True

    _unwrap(obj)
    obj["uv_ready"] = True
    return obj


def _unwrap(obj):
    view_layer = bpy.context.view_layer
    previous = view_layer.objects.active
    for other in bpy.context.selected_objects:
        other.select_set(False)
    view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.03)
        bpy.ops.object.mode_set(mode="OBJECT")
    except RuntimeError:
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except RuntimeError:
            pass
    obj.select_set(False)
    view_layer.objects.active = previous


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


class _Lobes:
    """A coherent angular radius profile.

    A rock's plan outline is a few big asymmetric masses, not a fuzz of noise.
    Summing three low harmonics with fixed phases gives exactly that, and using
    the same profile down a whole stack of rings keeps those masses vertically
    continuous the way real weathered stone is.
    """

    def __init__(self, rng, strength=0.18):
        self.terms = [
            (2, rng.uniform(0.0, math.tau), strength),
            (3, rng.uniform(0.0, math.tau), strength * 0.72),
            (5, rng.uniform(0.0, math.tau), strength * 0.38),
        ]

    def __call__(self, angle):
        total = 0.0
        for harmonic, phase, amplitude in self.terms:
            total += math.sin(angle * harmonic + phase) * amplitude
        return 1.0 + total


def _loft(bm, rings, segments, lobes, rng, grain, mat_rock, pinch_phase=0.0):
    """Bridge a stack of rings into a closed, capped, non-convex mass.

    `rings` is a list of (z, radius, offset_x, offset_y, squash_y, pinch). The
    radius column is free to go back up as z rises: that is where the overhang
    comes from.

    `pinch` biases a ring toward one side of the rock. Without it, an eroded
    waist runs the whole way round and the overhang above it reads as a painted
    stripe. Real stone is undercut on the weather side and buried on the other,
    so the pinch is applied on one azimuth only and the overhang becomes a
    broken shoulder on one flank.
    """
    base_angles = [i * math.tau / segments for i in range(segments)]
    ring_verts = []
    for level, ring in enumerate(rings):
        z, radius, ox, oy, squash = ring[:5]
        pinch = ring[5] if len(ring) > 5 else 0.0
        forced_twist = ring[6] if len(ring) > 6 else None
        phase = ring[7] if len(ring) > 7 else pinch_phase
        # A small per-ring twist stops the facets stacking into vertical columns.
        twist = rng.uniform(-0.16, 0.16) if forced_twist is None else forced_twist
        verts = []
        for angle in base_angles:
            a = angle + twist
            r = radius * lobes(a)
            r *= 1.0 - pinch * math.cos(a - phase)
            r *= 1.0 + rng.uniform(-grain, grain)
            verts.append(
                bm.verts.new((
                    math.cos(a) * r + ox,
                    math.sin(a) * r * squash + oy,
                    z + rng.uniform(-grain, grain) * radius * 0.35,
                ))
            )
        ring_verts.append(verts)

    faces = []
    for level in range(len(ring_verts) - 1):
        lower = ring_verts[level]
        upper = ring_verts[level + 1]
        for i in range(segments):
            j = (i + 1) % segments
            faces.append(bm.faces.new((lower[i], lower[j], upper[j], upper[i])))
    faces.append(bm.faces.new(tuple(ring_verts[0])))
    faces.append(bm.faces.new(tuple(ring_verts[-1])))
    for face in faces:
        face.material_index = mat_rock
    bm.verts.index_update()
    bm.faces.index_update()
    made = [vert for ring in ring_verts for vert in ring]
    return faces, made


def _cleave(bm, plane_co, plane_no, material_index=0):
    """Slice a flat fracture face through the mass and cap it.

    Everything on the side the normal points at is thrown away, so the survivor
    gains a dead-flat face meeting the rest of the form at a hard arris. This is
    the single operation that most makes stylised geometry read as broken rock.
    """
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    result = bmesh.ops.bisect_plane(
        bm,
        geom=geom,
        dist=1e-5,
        plane_co=Vector(plane_co),
        plane_no=Vector(plane_no).normalized(),
        clear_outer=True,
        clear_inner=False,
    )
    cut_edges = [e for e in result["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if cut_edges:
        filled = bmesh.ops.holes_fill(bm, edges=cut_edges, sides=0)
        for face in filled["faces"]:
            face.material_index = material_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def _extent_along(bm, direction):
    axis = Vector(direction).normalized()
    values = [vert.co.dot(axis) for vert in bm.verts]
    return min(values), max(values)


def _cleave_fraction(bm, direction, keep, material_index=0):
    """Cut away the outer `1 - keep` of the mass along `direction`."""
    axis = Vector(direction).normalized()
    low, high = _extent_along(bm, axis)
    plane_co = axis * (low + (high - low) * keep)
    _cleave(bm, plane_co, axis, material_index=material_index)


def _shade_recesses(bm, dark_index, ground_band, down_threshold=-0.15):
    """Darken what the sun cannot reach.

    Undersides of overhangs and the flare where the rock meets the sand are the
    two places a desert rock is reliably dark, and they are exactly the places a
    single flat colour turns to mush.
    """
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for face in bm.faces:
        centre = face.calc_center_median()
        if face.normal.z < down_threshold or centre.z < ground_band:
            face.material_index = dark_index


def _hull_stone(bm, rng, centre, size, flatten, material_index):
    """A small angular chip: convex hull of a squashed point cloud.

    At gravel scale the eye reads facet count and outline, so a hull of a dozen
    points is both the cheapest and the most convincing thing available. The
    chip is then tipped onto a random lie: stones that all lie dead flat vanish
    into the sand, stones propped at angles catch the sun and read as rubble.
    """
    tilt_axis = Vector((rng.uniform(-1.0, 1.0), rng.uniform(-1.0, 1.0), 0.0))
    if tilt_axis.length < 0.2:
        tilt_axis = Vector((1.0, 0.0, 0.0))
    lie = Matrix.Rotation(rng.uniform(0.15, 0.75), 4, tilt_axis.normalized())
    yaw = Matrix.Rotation(rng.uniform(0.0, math.tau), 4, "Z")
    orient = lie @ yaw
    points = []
    for _ in range(rng.randint(7, 10)):
        theta = rng.uniform(0.0, math.tau)
        phi = math.acos(rng.uniform(-1.0, 1.0))
        r = size * rng.uniform(0.62, 1.0)
        local = Vector((
            math.sin(phi) * math.cos(theta) * r,
            math.sin(phi) * math.sin(theta) * r * rng.uniform(0.7, 1.15),
            math.cos(phi) * r * flatten,
        ))
        local = orient @ local
        points.append(bm.verts.new((centre[0] + local.x, centre[1] + local.y, centre[2] + local.z)))
    result = bmesh.ops.convex_hull(bm, input=points, use_existing_faces=False)
    junk = set(result.get("geom_interior", [])) | set(result.get("geom_unused", []))
    if junk:
        bmesh.ops.delete(bm, geom=list(junk), context="VERTS")
    bm.verts.index_update()
    bm.faces.index_update()
    faces = [item for item in result["geom"] if isinstance(item, bmesh.types.BMFace) and item.is_valid]
    for face in faces:
        face.material_index = material_index
    return faces


# ---------------------------------------------------------------------------
# Boulders
# ---------------------------------------------------------------------------

# (z fraction, radius fraction, lateral drift fraction) per ring, bottom to top.
# The radius column is deliberately not monotonic: 1.00 at the ground flare,
# pinched to 0.82 at the eroded waist, back out to 0.95 at the oversailing
# shoulder. That in-out-in profile is the overhang, and it is the thing the old
# icosphere boulders could never have.
_BOULDER_PROFILES = {
    0: {
        "size": 1.5,
        "height": 0.85,
        "width": 0.84,
        "squash": 0.78,
        "rings": [
            (-0.17, 0.88, 0.00, 0.00),
            (0.00, 0.98, 0.02, 0.04),
            (0.21, 0.86, 0.07, 0.26),
            (0.47, 0.95, 0.15, 0.02),
            (0.72, 0.87, 0.21, 0.10),
            (0.91, 0.72, 0.25, 0.06),
            (1.00, 0.52, 0.27, 0.00),
        ],
        "segments": 10,
        "grain": 0.07,
        "tilt": 11.0,
        "tilt_axis": (0.86, 0.51, 0.0),
        # Near-horizontal normals so the cut lands as a vertical broken face on
        # the flank. Cuts with a strong upward normal just lop the top off and
        # leave a pyramid, which is not what stone does.
        "cleaves": [
            ((0.94, 0.30, 0.16), 0.82),
            ((-0.62, 0.78, 0.10), 0.86),
            ((-0.28, -0.90, 0.34), 0.88),
        ],
    },
    1: {
        "size": 2.6,
        "height": 1.52,
        "width": 1.32,
        "squash": 0.84,
        "rings": [
            (-0.15, 0.90, 0.00, 0.00),
            (0.00, 0.97, 0.01, 0.05),
            (0.15, 0.85, 0.05, 0.30),
            (0.33, 0.91, 0.10, 0.12),
            (0.55, 0.99, 0.18, 0.00),
            (0.76, 0.85, 0.25, 0.14),
            (0.92, 0.68, 0.31, 0.08),
            (1.00, 0.45, 0.34, 0.00),
        ],
        "segments": 11,
        "grain": 0.065,
        "tilt": 9.0,
        "tilt_axis": (-0.42, 0.91, 0.0),
        "cleaves": [
            ((0.88, -0.46, 0.14), 0.80),
            ((-0.55, -0.83, 0.08), 0.85),
            ((0.16, 0.96, 0.24), 0.86),
            ((0.30, 0.20, 0.93), 0.90),
        ],
    },
    2: {
        "size": 4.0,
        "height": 2.36,
        "width": 1.84,
        "squash": 0.80,
        "rings": [
            (-0.14, 0.91, 0.00, 0.00),
            (0.00, 0.97, 0.01, 0.04),
            (0.11, 0.86, 0.03, 0.32),
            (0.25, 0.93, 0.08, 0.14),
            (0.41, 1.00, 0.14, 0.00),
            (0.58, 0.88, 0.21, 0.18),
            (0.76, 0.86, 0.29, 0.06),
            (0.91, 0.72, 0.35, 0.12),
            (1.00, 0.50, 0.39, 0.00),
        ],
        "segments": 12,
        "grain": 0.06,
        "tilt": 7.5,
        "tilt_axis": (0.68, -0.73, 0.0),
        "cleaves": [
            ((0.96, 0.24, 0.12), 0.78),
            ((-0.44, 0.89, 0.10), 0.84),
            ((-0.38, -0.92, 0.18), 0.86),
            ((0.62, -0.40, 0.67), 0.90),
        ],
    },
}


def _build_boulder(index, rock, rock_dark):
    spec = _BOULDER_PROFILES[index]
    name = f"RaidBoulder-{index}"
    parent = _parent_asset(name)
    rng = Random(0x80051E + index * 7919)

    height = spec["height"]
    width = spec["width"]
    lean = Vector((rng.uniform(-1.0, 1.0), rng.uniform(-1.0, 1.0)))
    if lean.length < 0.4:
        lean = Vector((0.7, -0.5))
    lean.normalize()
    lean *= width * 0.30

    lobes = _Lobes(rng, strength=0.20)
    # The azimuth the weather came from. Every pinched ring is undercut on this
    # side and left full on the other.
    weather = math.atan2(lean.y, lean.x) + math.pi
    rings = [
        (
            z * height,
            r * width,
            lean.x * drift,
            lean.y * drift,
            spec["squash"],
            pinch,
        )
        for z, r, drift, pinch in spec["rings"]
    ]

    bm = bmesh.new()
    _loft(bm, rings, spec["segments"], lobes, rng, spec["grain"], 0, pinch_phase=weather)
    for normal, keep in spec["cleaves"]:
        _cleave_fraction(bm, normal, keep, material_index=0)

    # A boulder is a block that fell and settled, not a thing that grew
    # upright. Tipping the whole mass a few degrees swings every cleavage
    # plane off the horizon, which is what stops a faceted lump reading as a
    # loaf of bread. The footing is then trimmed flat and buried.
    tip = Matrix.Rotation(math.radians(spec["tilt"]), 4, Vector(spec["tilt_axis"]).normalized())
    # Tipping lifts the downhill half of the ground flare into the air, which
    # would leave the rock standing on a visible pancake. Dropping the mass by
    # half the rise puts the flare back on the sand all the way round.
    sink = width * math.sin(math.radians(spec["tilt"])) * 0.55
    for vert in bm.verts:
        vert.co = tip @ vert.co
        vert.co.z -= sink
    _cleave(bm, (0.0, 0.0, -height * 0.10), (0.0, 0.0, -1.0), material_index=1)

    _shade_recesses(bm, 1, ground_band=-height * 0.02, down_threshold=-0.38)

    obj = _finalise(f"{name}-mass", bm, parent, (rock, rock_dark), bevel_width=spec["size"] * 0.014)
    obj["kaki_size"] = spec["size"]
    return parent


# ---------------------------------------------------------------------------
# Bedded slabs
# ---------------------------------------------------------------------------

# (relative bed radius, bed thickness in metres of the 1.0 slab). A bed wider
# than the bed under it is a resistant cap oversailing softer stone, and the
# undercut it throws is the whole reason a sandstone shelf reads as sandstone.
_SLAB_PROFILES = {
    0: {
        "size": 5.0,
        "length": 2.10,
        "squash": 0.60,
        "beds": [(1.00, 0.42), (0.94, 0.26), (0.98, 0.30), (0.91, 0.24), (0.96, 0.26)],
        "soft_pinch": 0.09,
        "dip": 5.0,
        "retreat": 0.11,
        "shear": 0.17,
        "segments": 12,
        "grain": 0.055,
        # Never the top bed: a dark crown reads as a lid on a box.
        "dark_beds": (1, 3),
        "cleaves": [((0.97, 0.22, 0.06), 0.80), ((0.48, 0.87, 0.06), 0.86), ((-0.36, -0.93, 0.05), 0.88)],
    },
    1: {
        "size": 8.0,
        "length": 3.55,
        "squash": 0.58,
        "beds": [
            (1.00, 0.60),
            (0.92, 0.24),
            (0.97, 0.30),
            (0.87, 0.44),
            (0.94, 0.26),
            (0.83, 0.34),
        ],
        "soft_pinch": 0.13,
        "dip": 7.0,
        "retreat": 0.12,
        "shear": 0.22,
        "segments": 14,
        "grain": 0.05,
        "dark_beds": (1, 3, 5),
        "cleaves": [((0.94, -0.33, 0.05), 0.80), ((0.42, 0.90, 0.06), 0.86), ((-0.72, 0.69, 0.05), 0.87)],
    },
}


def _build_slab(index, rock, rock_dark):
    spec = _SLAB_PROFILES[index]
    name = f"RaidSlab-{index}"
    parent = _parent_asset(name)
    rng = Random(0x51AB00 + index * 6151)

    length = spec["length"]
    segments = spec["segments"]
    weather = rng.uniform(0.0, math.tau)
    lobes = _Lobes(rng, strength=0.16)

    # One mass, not a pile of plates. Beds are cut into a single lofted block by
    # stepping the radius between paired rings: a hard bed holds its full width
    # for its whole thickness, the soft bed above steps in, and the next hard
    # bed steps back out over it. That reads as bedded sandstone from any angle,
    # whereas stacking separate plates leaves daylight under every one of them
    # and reads as scrap timber.
    eps = 0.014
    beds = spec["beds"]
    rings = [(-0.34, beds[0][0] * 1.03 * length, 0.0, 0.0, spec["squash"], 0.0, 0.0, weather)]
    soft_bands = []
    z = 0.0
    for bed, (radius, thickness) in enumerate(beds):
        walk = bed / max(1, len(beds) - 1)
        # Each bed is eaten back on its own azimuth. If every recess sits on the
        # same side the grooves run dead parallel and the outcrop reads as
        # machined stair treads instead of weathered stone.
        phase = weather + rng.uniform(-1.5, 1.5) + bed * 0.9
        drift_x = walk * spec["retreat"] * length + rng.uniform(-0.04, 0.04) * length
        drift_y = walk * spec["retreat"] * 0.4 * length + rng.uniform(-0.04, 0.04) * length
        twist = walk * spec["shear"] + rng.uniform(-0.05, 0.05)
        soft = bed in spec["dark_beds"]
        pinch = spec["soft_pinch"] if soft else 0.05
        squash = spec["squash"] * rng.uniform(0.96, 1.04)
        r = radius * length
        rings.append((z, r, drift_x, drift_y, squash, pinch, twist, phase))
        rings.append((z + thickness, r * 0.985, drift_x, drift_y, squash, pinch * 0.8, twist, phase))
        if soft:
            soft_bands.append((z - eps, z + thickness + eps))
        z += thickness + eps
    # A modest broken crown, offset off the stack axis, so the top is not a
    # table top.
    rings.append((
        z + beds[-1][1] * 0.42,
        beds[-1][0] * 0.58 * length,
        spec["retreat"] * length * 1.5,
        spec["retreat"] * 0.6 * length,
        spec["squash"],
        0.0,
        spec["shear"] * 1.3,
        weather,
    ))

    bm = bmesh.new()
    _loft(bm, rings, segments, lobes, rng, spec["grain"], 0, pinch_phase=weather)

    # Colour the soft beds darker. Because those are exactly the beds that were
    # pinched back, the colour change lands inside a recess and reads as depth
    # rather than as a painted stripe.
    for face in bm.faces:
        height = face.calc_center_median().z
        for low, high in soft_bands:
            if low <= height <= high:
                face.material_index = 1
                break

    # A shallow structural dip: bedding that is very slightly tilted reads as
    # real geology, dead level reads as level design.
    dip = Matrix.Rotation(math.radians(spec["dip"]), 4, "Y")
    for vert in bm.verts:
        vert.co = dip @ vert.co

    # The broken end. A shelf that is intact all the way round is a plinth; a
    # shelf with one sheared face is an outcrop the desert has taken a bite out
    # of.
    for normal, keep in spec["cleaves"]:
        _cleave_fraction(bm, normal, keep, material_index=0)
    _cleave(bm, (0.0, 0.0, -0.28), (0.0, 0.0, -1.0), material_index=1)
    _shade_recesses(bm, 1, ground_band=-0.14, down_threshold=-0.50)

    obj = _finalise(f"{name}-shelf", bm, parent, (rock, rock_dark), bevel_width=spec["size"] * 0.006)
    obj["kaki_size"] = spec["size"]
    return parent


# ---------------------------------------------------------------------------
# Gravel clusters
# ---------------------------------------------------------------------------

_GRAVEL_PROFILES = {
    0: {"spread": 1.05, "count": 14, "small": (0.12, 0.26), "anchors": 3, "anchor": (0.42, 0.62)},
    1: {"spread": 1.85, "count": 17, "small": (0.15, 0.34), "anchors": 4, "anchor": (0.54, 0.92)},
}


def _build_gravel(index, rock, rock_dark):
    spec = _GRAVEL_PROFILES[index]
    name = f"RaidGravel-{index}"
    parent = _parent_asset(name)
    rng = Random(0x6A4E10 + index * 4931)

    bm = bmesh.new()

    def place(size_range, count, sink):
        for _ in range(count):
            angle = rng.uniform(0.0, math.tau)
            # Square-root radius keeps the cluster dense in the middle and
            # thinning at the rim, which is how loose stone actually lies.
            radius = spec["spread"] * math.sqrt(rng.random())
            size = rng.uniform(*size_range)
            centre = (
                math.cos(angle) * radius,
                math.sin(angle) * radius,
                size * sink,
            )
            dark = rng.random() < 0.34
            _hull_stone(
                bm, rng, centre, size,
                flatten=rng.uniform(0.52, 0.80),
                material_index=1 if dark else 0,
            )

    # Anchors first so the cluster has a couple of masses to read against.
    place(spec["anchor"], spec["anchors"], sink=0.18)
    place(spec["small"], spec["count"], sink=0.10)

    # Everything below the contact plane is cut away: the stones then sit half
    # buried in the sand rather than balancing on it.
    _cleave(bm, (0.0, 0.0, -0.02), (0.0, 0.0, -1.0), material_index=1)
    _shade_recesses(bm, 1, ground_band=-1.0, down_threshold=-0.55)

    obj = _finalise(f"{name}-stones", bm, parent, (rock, rock_dark), bevel_width=0.006, bevel_angle=44.0)
    obj["kaki_size"] = spec["spread"] * 2.0
    return parent


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def build_rocks(materials) -> None:
    """Create every Raid rock asset in the current scene."""
    rock = _resolve_material(materials, "rock")
    rock_dark = _resolve_material(materials, "rock_dark")

    built = []
    for index in range(3):
        built.append(_build_boulder(index, rock, rock_dark))
    for index in range(2):
        built.append(_build_slab(index, rock, rock_dark))
    for index in range(2):
        built.append(_build_gravel(index, rock, rock_dark))

    bpy.context.view_layer.update()
    for parent in built:
        for child in parent.children:
            print(f"[raid-rock] {child.name}: {_triangles(child)} triangles")
