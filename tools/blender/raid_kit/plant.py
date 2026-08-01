"""Kaki Rally Raid — authored desert vegetation.

Original project geometry. Nothing here is downloaded, traced, or derived from a
third party, so the kit carries no attribution burden and no licence risk.

    from raid_kit import plant
    plant.build_plants(materials)

Builds, each as an empty parented over one mesh per material:

    RaidScrub-0, RaidScrub-1      dry woody desert bushes (~1.0 m)
    RaidTussock-0, RaidTussock-1  clumps of dry desert grass (~0.5 m)
    RaidDeadwood-0                a fallen, sun-bleached branch tangle
    RaidMarker-0                  Kaki navigation marker: leaning notched post,
                                  painted band, stone cairn

Three things drive every decision in this file.

*Draw calls, not objects.* `raidEnvironment.js` builds one `InstancedMesh` per
mesh part of a prototype, and the glTF exporter splits a mesh into one primitive
per material slot. So the cost of an asset is its **material count**, not its
object count. Every asset here accumulates all of its geometry into one buffer
per material and emits a single mesh from it: 1 part for a tussock, 2 for a
scrub, 3 for the rarely placed marker.

*Silhouette before surface.* A desert bush is mostly negative space — thin woody
stems radiating from a base with sparse foliage at the tips. Blobs of foliage
read as a green potato at any distance. Grass is built from V-folded tapered
blades rather than flat cards: a fold survives being viewed edge-on, which is
most of the time at driving speed, and needs no alpha texture.

*Authored small, scattered large.* The runtime multiplies scrub by up to 1.6 and
tussock by up to 1.5, so these are authored at the bottom of their design band.
Author a 1.6 m bush here and the field ships 2.6 m bushes.

Every asset has its origin at its ground contact point, +Z up, and every random
choice is drawn from a locally seeded RNG so the kit rebuilds byte-identically.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Matrix, Vector

# One seed per asset, so adding an asset never reshuffles the ones before it.
SEEDS = {
    "RaidScrub-0": 0x5C0B0,
    "RaidScrub-1": 0x5C0B1,
    "RaidTussock-0": 0x7055A,
    "RaidTussock-1": 0x7055B,
    "RaidDeadwood-0": 0xDEAD0,
    "RaidMarker-0": 0x4A6E0,
}

SOURCE_TAG = "Kaki Rally Raid original Blender geometry"

# The fallback palette. These are darker and greyer than a desert plant looks in
# isolation on purpose: they are seen against bright hardpack (~0.74, 0.60, 0.40)
# with shadows disabled, so value contrast against sand is the only thing keeping
# them visible. A pretty straw tone that matches the ground is an invisible plant.
WOOD_COLOR = (0.23, 0.17, 0.12)
LEAF_COLOR = (0.29, 0.32, 0.17)
GRASS_COLOR = (0.45, 0.39, 0.21)
STONE_COLOR = (0.31, 0.26, 0.22)
POST_COLOR = (0.31, 0.25, 0.18)
ACCENT_COLOR = (0.85, 0.35, 0.18)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------

class Rng:
    """A tiny explicit PRNG.

    `random.Random` would do, but its stream is a Python implementation detail;
    this one is 30 lines of arithmetic that will produce the same kit on any
    interpreter, forever. Determinism is a hard requirement of the kit, so it is
    worth owning outright.
    """

    __slots__ = ("state",)

    def __init__(self, seed: int):
        self.state = (seed ^ 0x9E3779B9) & 0xFFFFFFFF or 0x1234567

    def next_u32(self) -> int:
        x = self.state
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        self.state = x & 0xFFFFFFFF
        return self.state

    def uniform(self, low: float = 0.0, high: float = 1.0) -> float:
        return low + (high - low) * (self.next_u32() / 4294967296.0)

    def spread(self, amount: float) -> float:
        return self.uniform(-amount, amount)

    def chance(self, probability: float) -> bool:
        return self.uniform() < probability


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def _new_material(name, color, roughness, double_sided=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = not double_sided
    return mat


def _resolve(materials, keys, name, color, roughness, double_sided=False):
    """Take a palette entry if the caller supplied one, otherwise author it.

    The kit builder owns the palette, but this module has to be runnable on its
    own for preview and QA, so a missing key is a fallback rather than an error.
    Foliage is forced double-sided whichever way it arrives: blades are open
    surfaces and would be half invisible under backface culling.
    """
    found = None
    for key in keys:
        if isinstance(materials, dict):
            found = materials.get(key)
        else:
            found = getattr(materials, key, None)
        if found is not None:
            break
    if found is None:
        found = bpy.data.materials.get(name) or _new_material(name, color, roughness, double_sided)
    if double_sided:
        found.use_backface_culling = False
    return found


# ---------------------------------------------------------------------------
# Geometry accumulation
# ---------------------------------------------------------------------------

class Part:
    """One material's worth of geometry, emitted as exactly one mesh."""

    __slots__ = ("verts", "faces", "smooth")

    def __init__(self, smooth=True):
        self.verts = []
        self.faces = []
        self.smooth = smooth

    def add(self, verts, faces, matrix=None):
        base = len(self.verts)
        if matrix is None:
            self.verts.extend(Vector(v) for v in verts)
        else:
            self.verts.extend(matrix @ Vector(v) for v in verts)
        self.faces.extend(tuple(index + base for index in face) for face in faces)

    @property
    def triangles(self):
        return sum(len(face) - 2 for face in self.faces)

    def emit(self, name, parent, material, recalc_normals=True):
        if not self.faces:
            return None
        mesh = bpy.data.meshes.new(f"{name}_Mesh")
        mesh.from_pydata([tuple(v) for v in self.verts], [], self.faces)
        mesh.validate(verbose=False)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.data.materials.append(material)
        obj.parent = parent
        for polygon in mesh.polygons:
            polygon.use_smooth = self.smooth
        _finish(obj, recalc_normals=recalc_normals)
        return obj


def _finish(obj, recalc_normals=True):
    """Consistent normals and a UV set, with no bevel.

    The rest of the kit bevels its primitives, but a 0.03 m bevel is wider than
    a grass blade — it would eat the budget and pinch the geometry into noise.
    Plants carry their detail in the silhouette instead.
    """
    view_layer = bpy.context.view_layer
    previous = view_layer.objects.active
    view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        if recalc_normals:
            bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    except RuntimeError:
        pass
    finally:
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except RuntimeError:
            pass
    obj.select_set(False)
    view_layer.objects.active = previous
    obj["uv_ready"] = True
    return obj


def _finalize(parts, target_height=None):
    """Sit the asset on the ground and pin its authored height.

    Two things the scatter cannot fix for us. Anything below z=0 is buried when
    the runtime drops the asset on a terrain sample, so drooping twigs and roots
    are clamped up onto the contact plane rather than through it. And the height
    is normalised at the end instead of being tuned by hand, because the runtime
    multiplies these by up to 1.6 — an asset that drifts 20% tall during authoring
    ships 20% over its design band."""
    for part in parts:
        for vertex in part.verts:
            if vertex.z < 0.0:
                vertex.z = 0.0
    if target_height:
        high = max((vertex.z for part in parts for vertex in part.verts), default=0.0)
        if high > 1e-6:
            factor = target_height / high
            for part in parts:
                for vertex in part.verts:
                    vertex.x *= factor
                    vertex.y *= factor
                    vertex.z *= factor


def _parent_asset(name):
    parent = bpy.data.objects.new(name, None)
    parent.location = (0.0, 0.0, 0.0)
    parent.empty_display_size = 0.25
    parent["kaki_asset"] = True
    parent["source"] = SOURCE_TAG
    bpy.context.scene.collection.objects.link(parent)
    return parent


# ---------------------------------------------------------------------------
# Primitive generators (local space, +Z growth)
# ---------------------------------------------------------------------------

def tube(points, radii, sides=5, cap_start=True):
    """A swept tapered tube along a polyline, parallel-transported so it does not
    twist. A radius of zero closes the run to a point, which is how every stem
    and twig ends: no cap, no hole, no wasted triangles."""
    pts = [Vector(p) for p in points]
    count = len(pts)
    directions = []
    for index in range(count):
        if index == 0:
            delta = pts[1] - pts[0]
        elif index == count - 1:
            delta = pts[-1] - pts[-2]
        else:
            delta = pts[index + 1] - pts[index - 1]
        if delta.length < 1e-9:
            delta = Vector((0.0, 0.0, 1.0))
        directions.append(delta.normalized())

    reference = Vector((0.0, 0.0, 1.0))
    if abs(directions[0].dot(reference)) > 0.94:
        reference = Vector((1.0, 0.0, 0.0))
    normal = (reference - directions[0] * reference.dot(directions[0])).normalized()

    verts = []
    rings = []
    for index in range(count):
        direction = directions[index]
        normal = normal - direction * normal.dot(direction)
        if normal.length < 1e-6:
            alternate = Vector((1.0, 0.0, 0.0)) if abs(direction.x) < 0.9 else Vector((0.0, 1.0, 0.0))
            normal = alternate - direction * alternate.dot(direction)
        normal.normalize()
        binormal = direction.cross(normal)
        radius = radii[index]
        if radius <= 1e-5:
            rings.append([len(verts)])
            verts.append(pts[index].copy())
            continue
        ring = []
        for step in range(sides):
            angle = math.tau * step / sides
            ring.append(len(verts))
            verts.append(pts[index] + normal * (math.cos(angle) * radius) + binormal * (math.sin(angle) * radius))
        rings.append(ring)

    faces = []
    for index in range(count - 1):
        lower, upper = rings[index], rings[index + 1]
        if len(upper) == 1:
            tip = upper[0]
            for step in range(len(lower)):
                faces.append((lower[step], lower[(step + 1) % len(lower)], tip))
        elif len(lower) == 1:
            tip = lower[0]
            for step in range(len(upper)):
                faces.append((tip, upper[(step + 1) % len(upper)], upper[step]))
        else:
            for step in range(sides):
                nxt = (step + 1) % sides
                faces.append((lower[step], lower[nxt], upper[nxt], upper[step]))
    if cap_start and len(rings[0]) > 1:
        faces.append(tuple(reversed(rings[0])))
    return verts, faces


def blade(height, spread, width, fold=0.35, droop=0.3, segments=4, tip_shrink=0.88):
    """A single grass blade: a tapered V-folded strip growing +Z and curving +X.

    The fold is the whole point. A flat card vanishes when the camera lines up
    with it, which at 90 km/h is constantly; a shallow V always shows one of its
    two faces to the light and keeps a visible edge from any angle, for four
    extra triangles and no texture."""
    def point(t):
        z = height * (t - droop * t * t) / (1.0 - droop)
        return Vector((spread * t * t, 0.0, z))

    verts = []
    faces = []
    rings = []
    for step in range(segments):
        t = step / segments
        position = point(t)
        tangent = (point(min(1.0, t + 0.02)) - point(max(0.0, t - 0.02)))
        tangent = tangent.normalized() if tangent.length > 1e-9 else Vector((0.0, 0.0, 1.0))
        side = Vector((0.0, 1.0, 0.0))
        up = side.cross(tangent)
        up = up.normalized() if up.length > 1e-9 else Vector((1.0, 0.0, 0.0))
        half = width * (1.0 - tip_shrink * t) * 0.5
        first = len(verts)
        verts.append(position - side * half)
        verts.append(position + up * (fold * half * 2.0))
        verts.append(position + side * half)
        rings.append((first, first + 1, first + 2))
    tip = len(verts)
    verts.append(point(1.0))
    for index in range(len(rings) - 1):
        lower, upper = rings[index], rings[index + 1]
        faces.append((lower[0], upper[0], upper[1], lower[1]))
        faces.append((lower[1], upper[1], upper[2], lower[2]))
    last = rings[-1]
    faces.append((last[0], tip, last[1]))
    faces.append((last[1], tip, last[2]))
    return verts, faces


def stone(rng, radius, squash=0.72):
    """A faceted pebble: two rings and two poles, jittered. Twenty-four triangles
    that read as broken rock, against eighty for an icosphere that reads as a
    potato."""
    sides = 6
    verts = [Vector((0.0, 0.0, radius * squash * rng.uniform(0.88, 1.02)))]
    rings = []
    for level, (band, scale) in enumerate(((0.34, 0.78), (-0.2, 1.0))):
        ring = []
        for step in range(sides):
            angle = math.tau * step / sides + level * 0.5
            # Tight wobble. Wide jitter turned the cairn into a pile of shark
            # teeth; a hand-set cairn is rounded river stone, not shrapnel.
            wobble = rng.uniform(0.9, 1.08)
            ring.append(len(verts))
            verts.append(Vector((
                math.cos(angle) * radius * scale * wobble,
                math.sin(angle) * radius * scale * wobble * rng.uniform(0.9, 1.06),
                radius * squash * band * rng.uniform(0.92, 1.1),
            )))
        rings.append(ring)
    base = len(verts)
    verts.append(Vector((0.0, 0.0, -radius * squash * rng.uniform(0.75, 0.95))))

    faces = []
    for step in range(sides):
        nxt = (step + 1) % sides
        faces.append((0, rings[0][nxt], rings[0][step]))
        faces.append((rings[0][step], rings[0][nxt], rings[1][nxt], rings[1][step]))
        faces.append((rings[1][step], rings[1][nxt], base))
    return verts, faces


def _place(origin, direction, roll=0.0):
    """A matrix putting local +Z along `direction`, rolled about it by `roll`."""
    direction = Vector(direction)
    if direction.length < 1e-9:
        direction = Vector((0.0, 0.0, 1.0))
    rotation = direction.normalized().to_track_quat("Z", "X").to_matrix().to_4x4()
    return Matrix.Translation(Vector(origin)) @ rotation @ Matrix.Rotation(roll, 4, "Z")


# ---------------------------------------------------------------------------
# Vegetation
# ---------------------------------------------------------------------------

def _grass_fan(part, rng, count, base_radius, height, width, lean_base, lean_gain,
               droop_range=(0.16, 0.42), curl=(0.34, 0.95), height_falloff=0.5, z=0.0):
    """A splayed fan of blades: tall and near-upright in the middle, shorter and
    flatter at the rim. That gradient is what makes a clump read as a clump
    rather than as a hedgehog."""
    for _ in range(count):
        angle = rng.uniform(0.0, math.tau)
        radial = math.sqrt(rng.uniform()) * base_radius
        centrality = 1.0 - radial / max(base_radius, 1e-6)
        length = height * (1.0 - height_falloff * (1.0 - centrality)) * rng.uniform(0.72, 1.14)
        lean = lean_base + lean_gain * (1.0 - centrality) * rng.uniform(0.5, 1.25)
        droop = rng.uniform(*droop_range)
        verts, faces = blade(
            height=length,
            spread=length * rng.uniform(*curl),
            width=width * rng.uniform(0.7, 1.3),
            # A shallow fold and a lot of curl. A deep fold on a long straight
            # blade is an agave leaf, not grass — the read is set by how much the
            # blade bows over, not by how thick it is.
            fold=rng.uniform(0.16, 0.3),
            droop=droop,
        )
        matrix = (
            Matrix.Translation(Vector((math.cos(angle) * radial, math.sin(angle) * radial, z)))
            @ Matrix.Rotation(angle, 4, "Z")
            @ Matrix.Rotation(lean, 4, "Y")
            @ Matrix.Rotation(rng.spread(0.35), 4, "X")
        )
        part.add(verts, faces, matrix)


def build_tussock(index, materials):
    """Dry tussock grass — the thing that stops hardpack reading as an empty
    plane at eye level, and the highest-weight entry in the scatter table."""
    name = f"RaidTussock-{index}"
    rng = Rng(SEEDS[name])
    parent = _parent_asset(name)
    grass = _resolve(
        materials, ("grass", "dry_grass", "tussock", "RaidGrass"),
        "RaidGrass", GRASS_COLOR, 0.9, double_sided=True,
    )
    part = Part(smooth=True)

    if index == 0:
        # Upright bunchgrass: dense, narrow, a clear vertical tuft.
        _grass_fan(part, rng, count=56, base_radius=0.075, height=0.44, width=0.022,
                   lean_base=0.10, lean_gain=0.58, droop_range=(0.24, 0.5),
                   curl=(0.35, 0.95), height_falloff=0.42)
        # A handful of collapsed dead blades skirting the base breaks the tuft's
        # bottom edge, so it sits in the ground instead of on it.
        _grass_fan(part, rng, count=12, base_radius=0.11, height=0.19, width=0.030,
                   lean_base=1.0, lean_gain=0.4, droop_range=(0.36, 0.5))
        # Seed stalks. Thin, over-tall, and the only part of a tussock that is
        # still legible from 40 m.
        for _ in range(5):
            angle = rng.uniform(0.0, math.tau)
            stalk = 0.60 * rng.uniform(0.88, 1.14)
            verts, faces = blade(height=stalk, spread=stalk * 0.26, width=0.018,
                                 fold=0.5, droop=0.36, segments=3)
            part.add(verts, faces, Matrix.Translation(Vector((math.cos(angle) * 0.03, math.sin(angle) * 0.03, 0.0)))
                     @ Matrix.Rotation(angle, 4, "Z") @ Matrix.Rotation(rng.uniform(0.08, 0.26), 4, "Y"))
    else:
        # Low sprawling clump: wider and flatter, reads as ground cover. Blades
        # are kept narrow and numerous on purpose — a few wide ones turned this
        # into an agave rosette, which is the wrong plant and the wrong biome.
        # Bases spread wide and blades bowed hard over. Blades that all radiate
        # straight from one point are a succulent rosette; grass bows.
        _grass_fan(part, rng, count=56, base_radius=0.13, height=0.42, width=0.017,
                   lean_base=0.26, lean_gain=0.80, droop_range=(0.34, 0.54),
                   curl=(0.6, 1.3), height_falloff=0.48)
        _grass_fan(part, rng, count=18, base_radius=0.17, height=0.19, width=0.021,
                   lean_base=1.05, lean_gain=0.38, droop_range=(0.42, 0.54),
                   curl=(0.6, 1.3))

    # 0.53 rather than a rounder number: the hardpack table scatters Tussock-0 at
    # up to 1.5x, and 0.53 x 1.5 is the top of the 0.4-0.8 m design band exactly.
    _finalize([part], target_height=0.53 if index == 0 else 0.42)
    part.emit(f"{name}-grass", parent, grass, recalc_normals=False)
    return parent


def _branch(part, rng, tips, origin, direction, length, radius, depth, taper=0.55):
    """One woody run, then its children. Recursion is the cheapest way to get a
    stem system that looks grown rather than assembled, and the tip list it fills
    is where foliage is allowed to sit — foliage only ever appears at the end of
    a branch that actually exists."""
    direction = Vector(direction).normalized()
    side = direction.cross(Vector((0.0, 0.0, 1.0)))
    if side.length < 1e-6:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    other = direction.cross(side)

    # Three points: a slight lateral kink plus gravity droop on the outer half.
    droop = Vector((0.0, 0.0, -1.0)) * length * rng.uniform(0.05, 0.26) * (1.0 if depth < 2 else 1.6)
    mid = origin + direction * (length * 0.55) + side * (length * rng.spread(0.16)) + droop * 0.3
    end = origin + direction * length + side * (length * rng.spread(0.22)) + other * (length * rng.spread(0.12)) + droop
    points = [origin, mid, end]
    radii = [radius, radius * taper, radius * taper * taper if depth > 0 else 0.0]
    if depth == 0:
        radii[-1] = 0.0
    part.add(*tube(points, radii, sides=4 if depth > 1 else 3, cap_start=depth >= 2))

    outward = (end - mid).normalized()
    if depth == 0:
        tips.append((end, outward))
        return

    # Always two. A three-way fork adds a whole extra terminal twig and its
    # foliage spray, which is the single most expensive thing in the asset.
    children = 2
    for child in range(children):
        roll = math.tau * (child / children) + rng.spread(0.5)
        splay = rng.uniform(0.35, 0.78) * (1.0 if depth > 1 else 0.72)
        axis = (outward * math.cos(splay)
                + (side * math.cos(roll) + other * math.sin(roll)) * math.sin(splay))
        _branch(part, rng, tips, end, axis,
                length * rng.uniform(0.55, 0.78), radius * taper * 0.85, depth - 1,
                taper=taper)


def _foliage_spray(part, rng, origin, direction, size, count, width=0.013):
    """A small clustered spray at a twig end. Never one blob: a handful of short
    leaves fanned off the twig axis, so the foliage mass is made of edges."""
    for _ in range(count):
        roll = rng.uniform(0.0, math.tau)
        splay = rng.uniform(0.3, 1.1)
        axis = Vector(direction).normalized()
        side = axis.cross(Vector((0.0, 0.0, 1.0)))
        if side.length < 1e-6:
            side = Vector((1.0, 0.0, 0.0))
        side.normalize()
        other = axis.cross(side)
        aim = (axis * math.cos(splay) + (side * math.cos(roll) + other * math.sin(roll)) * math.sin(splay))
        length = size * rng.uniform(0.62, 1.3)
        verts, faces = blade(height=length, spread=length * rng.uniform(0.3, 0.7),
                             width=width * rng.uniform(0.8, 1.3), fold=0.42,
                             droop=rng.uniform(0.2, 0.44), segments=2)
        offset = Vector(origin) + axis * (size * rng.spread(0.3))
        part.add(verts, faces, _place(offset, aim, rng.uniform(0.0, math.tau)))


def build_scrub(index, materials):
    """A dry desert bush: mostly negative space.

    The silhouette is a tangle of thin woody stems radiating from a short base,
    with sparse foliage only at the twig ends. Variant 0 is an upright, denser
    bush; variant 1 is a low sprawling half-dead one with bleached foliage, so a
    field of two prototypes does not read as one prototype twice."""
    name = f"RaidScrub-{index}"
    rng = Rng(SEEDS[name])
    parent = _parent_asset(name)
    wood = _resolve(materials, ("wood", "branch", "RaidWood"), "RaidWood", WOOD_COLOR, 0.92)
    if index == 0:
        foliage = _resolve(materials, ("leaf", "scrub", "foliage", "RaidLeaf"),
                           "RaidLeaf", LEAF_COLOR, 0.9, double_sided=True)
    else:
        # The sparse variant borrows the grass tone. Reusing an existing material
        # gives the field a second look at zero extra draw calls.
        foliage = _resolve(materials, ("grass", "dry_grass", "RaidGrass"),
                           "RaidGrass", GRASS_COLOR, 0.9, double_sided=True)

    # Flat shading. A four-sided twig shaded smooth turns into a soft grey noodle;
    # faceted, it keeps a crisp lit side and a dark side, which is the only
    # shading cue available with scatter shadows switched off.
    stems = Part(smooth=False)
    leaves = Part(smooth=True)
    tips = []

    if index == 0:
        # Upright vase: many stems leaving the base steeply, foliage held high.
        primaries, base_len, base_rad, elevation = 7, 0.35, 0.028, (0.9, 1.34)
        crown_z, spray_size, spray_count, density = 0.09, 0.07, 5, 1.0
    else:
        # Low sprawler: flatter, half dead, thinner foliage — but still foliage.
        # A high-weight scatter entry made entirely of bare sticks reads as
        # debris, and the surface tables place this one as a living plant.
        primaries, base_len, base_rad, elevation = 7, 0.39, 0.026, (0.55, 1.15)
        crown_z, spray_size, spray_count, density = 0.06, 0.06, 5, 0.85

    # A short woody bole. Real desert scrub barely has a trunk; it splits at
    # ankle height, which is exactly what makes it read as scrub and not a tree.
    stems.add(*tube([(0, 0, 0), (0, 0, crown_z * 0.6), (0, 0, crown_z)],
                    [base_rad * 1.7, base_rad * 1.35, base_rad * 1.15], sides=6))

    for primary in range(primaries):
        angle = math.tau * primary / primaries + rng.spread(0.36)
        pitch = rng.uniform(*elevation)
        axis = Vector((math.cos(angle) * math.cos(pitch),
                       math.sin(angle) * math.cos(pitch),
                       math.sin(pitch)))
        start = Vector((math.cos(angle) * base_rad * 0.8, math.sin(angle) * base_rad * 0.8,
                        crown_z * rng.uniform(0.4, 1.0)))
        _branch(stems, rng, tips, start, axis,
                base_len * rng.uniform(0.8, 1.24), base_rad * rng.uniform(0.75, 1.05), 2)

    for position, direction in tips:
        if not rng.chance(density):
            continue
        # Small leaves, many of them. A desert shrub's leaf is a scale, not a
        # frond — long leaves on these twigs read as bamboo, which is the wrong
        # continent.
        _foliage_spray(leaves, rng, position, direction, size=spray_size,
                       count=spray_count, width=0.013)

    _finalize([stems, leaves], target_height=1.0 if index == 0 else 0.86)
    stems.emit(f"{name}-wood", parent, wood)
    leaves.emit(f"{name}-foliage", parent, foliage, recalc_normals=False)
    return parent


def build_deadwood(materials):
    """A fallen, sun-bleached branch tangle: one broken limb resting on its own
    root fan with the far end on the ground, plus the twigs that survived. It is
    a low-frequency silhouette break for empty hardpack, so the read that matters
    is the arch of the main limb against the sky."""
    name = "RaidDeadwood-0"
    rng = Rng(SEEDS[name])
    parent = _parent_asset(name)
    wood = _resolve(materials, ("deadwood", "wood", "RaidWood"), "RaidWood", WOOD_COLOR, 0.92)
    part = Part(smooth=False)
    tips = []

    # Main limb: butt end propped on its own root fan, tapering away to the
    # ground. Kept slim — a fat smooth tube reads as a bone, not as a branch.
    # The kink at the third point is where the limb broke and settled. An even
    # arc reads as a banana; the kink is what sells it as timber.
    spine = [
        Vector((-0.72, 0.05, 0.30)),
        Vector((-0.30, -0.06, 0.38)),
        Vector((0.10, 0.10, 0.30)),
        Vector((0.36, 0.02, 0.11)),
        Vector((0.78, -0.06, 0.07)),
        Vector((1.02, -0.14, 0.03)),
    ]
    part.add(*tube(spine, [0.092, 0.070, 0.078, 0.046, 0.034, 0.0], sides=5, cap_start=True))

    # Broken stubs along the spine. A clean limb reads as a stick; the stubs are
    # what make it read as something that snapped off a tree years ago.
    for point, direction, length in (
        (spine[1], Vector((0.55, 0.7, 0.35)), 0.15),
        (spine[2], Vector((-0.4, -0.8, 0.3)), 0.12),
        (spine[3], Vector((-0.2, 0.85, 0.25)), 0.10),
    ):
        end = point + Vector(direction).normalized() * length
        part.add(*tube([point, end], [0.036, 0.0], sides=4, cap_start=False))

    # A short snapped fragment lying alongside. Anything longer or straighter
    # than this stops reading as debris and starts reading as sawn lumber.
    shard = [Vector((0.16, -0.32, 0.04)), Vector((0.36, -0.27, 0.06)), Vector((0.48, -0.33, 0.02))]
    part.add(*tube(shard, [0.028, 0.022, 0.0], sides=5, cap_start=True))

    # Root fan holding the butt end off the ground. Without it the limb floats.
    for root in range(5):
        angle = math.tau * root / 5 + 0.4
        direction = Vector((math.cos(angle) * 0.5 - 0.7, math.sin(angle) * 0.75, -0.5 + rng.uniform(0.0, 0.45)))
        _branch(part, rng, tips, spine[0] + Vector((-0.04, 0.0, 0.0)), direction,
                rng.uniform(0.2, 0.34), 0.034, 1, taper=0.5)

    # Standing limbs. These carry the silhouette; everything else is ballast.
    for start, direction, length, radius in (
        (spine[1], Vector((-0.3, 0.5, 1.0)), 0.44, 0.040),
        (spine[2], Vector((0.34, -0.42, 1.0)), 0.50, 0.036),
        (spine[3], Vector((0.55, 0.4, 0.9)), 0.30, 0.026),
        (spine[0], Vector((-0.5, -0.35, 1.0)), 0.34, 0.030),
    ):
        _branch(part, rng, tips, start, direction, length, radius, 2, taper=0.5)

    _finalize([part], target_height=0.66)
    part.emit(f"{name}-wood", parent, wood)
    return parent


def build_marker(materials):
    """The Kaki navigation marker.

    Deliberately not a rally bollard and deliberately not anyone's branding: a
    hand-set stone cairn with a leaning weathered post pushed into it, one broad
    painted band, and a notched cat-ear top that is the same silhouette cue the
    Dune Run gate uses. Original to this project."""
    name = "RaidMarker-0"
    rng = Rng(SEEDS[name])
    parent = _parent_asset(name)
    rock = _resolve(materials, ("rock_dark", "stone", "rock", "RaidRockDark"),
                    "RaidRockDark", STONE_COLOR, 0.95)
    pole = _resolve(materials, ("pole", "post", "RaidPole"), "RaidPole", POST_COLOR, 0.78)
    accent = _resolve(materials, ("accent", "RaidAccent"), "RaidAccent", ACCENT_COLOR, 0.55)

    cairn = Part(smooth=False)
    post = Part(smooth=True)
    paint = Part(smooth=True)

    # Cairn: stones get smaller and tighter going up, the way a hand-stacked
    # cairn actually works, with the top stones clamped around the post.
    levels = ((0.0, 0.20, 0.115, 5), (0.135, 0.135, 0.095, 4), (0.245, 0.085, 0.075, 3), (0.335, 0.04, 0.06, 2))
    for height, spacing, size, count in levels:
        for step in range(count):
            angle = math.tau * step / count + height * 7.0
            verts, faces = stone(rng, size * rng.uniform(0.86, 1.12), squash=rng.uniform(0.66, 0.86))
            matrix = (
                Matrix.Translation(Vector((
                    math.cos(angle) * spacing * rng.uniform(0.8, 1.1),
                    math.sin(angle) * spacing * rng.uniform(0.8, 1.1),
                    height + size * 0.55,
                )))
                @ Matrix.Rotation(rng.uniform(0.0, math.tau), 4, "Z")
                @ Matrix.Rotation(rng.spread(0.35), 4, "Y")
            )
            cairn.add(verts, faces, matrix)

    lean = math.radians(7.5)
    axis = Vector((math.sin(lean), 0.0, math.cos(lean)))
    top = axis * 1.78
    post.add(*tube([Vector((0, 0, 0.05)), axis * 0.6, axis * 1.2, top],
                   [0.055, 0.049, 0.042, 0.036], sides=7, cap_start=True))

    # Painted band. One broad ring, sitting proud of the post.
    band_low = axis * 1.06
    band_high = axis * 1.30
    paint.add(*tube([band_low, band_high], [0.052, 0.047], sides=7, cap_start=True))

    # Notched cat-ear cap: a flat plate with a V cut out of the top edge.
    plate = [
        Vector((-0.10, 0.0, 0.0)), Vector((0.10, 0.0, 0.0)),
        Vector((0.10, 0.0, 0.13)), Vector((0.0, 0.0, 0.055)), Vector((-0.10, 0.0, 0.13)),
    ]
    thickness = Vector((0.0, 0.018, 0.0))
    verts = [p - thickness for p in plate] + [p + thickness for p in plate]
    faces = [
        (0, 1, 2, 3), (0, 3, 4),
        (9, 8, 6, 5), (7, 8, 5),
        (0, 5, 6, 1), (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0),
    ]
    paint.add(verts, faces, Matrix.Translation(top - axis * 0.02) @ Matrix.Rotation(lean, 4, "Y"))

    _finalize([cairn, post, paint])
    cairn.emit(f"{name}-cairn", parent, rock)
    post.emit(f"{name}-post", parent, pole)
    paint.emit(f"{name}-paint", parent, accent)
    return parent


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def build_plants(materials=None) -> None:
    """Build every vegetation prototype into the current scene."""
    build_scrub(0, materials)
    build_scrub(1, materials)
    build_tussock(0, materials)
    build_tussock(1, materials)
    build_deadwood(materials)
    build_marker(materials)


PLANT_ASSETS = (
    "RaidScrub-0",
    "RaidScrub-1",
    "RaidTussock-0",
    "RaidTussock-1",
    "RaidDeadwood-0",
    "RaidMarker-0",
)
