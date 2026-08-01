"""Build the authored Kaki Rally Raid environment kit and a visual QA contact sheet.

Blender 5.x:
  blender -b --python tools/blender/build-kaki-raid-environment-kit.py

Original project geometry. Nothing here is downloaded, traced, or derived from a
third party, so the kit carries no attribution burden and no licence risk.

The geometry itself lives in `tools/blender/raid_kit/`:

  rock.py      boulders, bedded sandstone shelves, loose stone clusters
  landmark.py  the mesa and the wind-eroded spire
  plant.py     scrub, tussock grass, deadwood, the navigation marker
  ruin.py      the amphitheatre, arch, columns, wall, rift shard and vent

This file owns the shared palette, the layout for the contact sheet, and the
export. It owns nothing about the shapes themselves.

The kit is scattered by src/racing/raid/raidEnvironment.js. Every asset is
authored around its own origin at ground level, +Z up in Blender, exported +Y up,
so the scatter can drop it straight onto a terrain sample without a per-asset
offset table.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "assets" / "racing" / "raid" / "kaki-raid-environment-kit-v1.glb"
PREVIEW = REPO / "docs" / "qa" / "assets" / "kaki-raid-environment-kit-v1.png"

sys.path.insert(0, str(REPO / "tools" / "blender"))

from raid_kit import landmark as landmark_module  # noqa: E402
from raid_kit import plant as plant_module  # noqa: E402
from raid_kit import rock as rock_module  # noqa: E402
from raid_kit import ruin as ruin_module  # noqa: E402

PANEL_W = 1600
PANEL_H = 640

# Every asset name the runtime looks up. Checked against the scene after the
# build so a renamed prototype fails here rather than silently disappearing from
# the desert.
RUNTIME_ASSETS = (
    "RaidBoulder-0", "RaidBoulder-1", "RaidBoulder-2",
    "RaidSlab-0", "RaidSlab-1",
    "RaidGravel-0", "RaidGravel-1",
    "RaidScrub-0", "RaidScrub-1",
    "RaidTussock-0", "RaidTussock-1",
    "RaidDeadwood-0",
    "RaidSpire-0", "RaidMesa-0",
    # Not currently referenced by raidEnvironment.js, but it shipped in v1 and
    # the route/roadbook work is the obvious consumer. Removing it from the GLB
    # would be a silent capability loss.
    "RaidMarker-0",
    # Ruins and the rift, scattered in the ruin-flat and rift-crater zones of
    # the Rift of Nine Tails.
    "RaidRuinArch-0", "RaidRuinColumn-0", "RaidRuinColumn-1", "RaidRuinWall-0",
    "RaidAmphitheatre-0", "RaidRiftShard-0", "RaidRiftVent-0",
)

# A single asset is instanced hundreds of times, so this is a hard ceiling.
TRIANGLE_BUDGET = 1500

# Except where an asset is not instanced hundreds of times. A landmark is capped
# at twelve instances by raidEnvironment.js and is meant to be read from a
# kilometre away, so it gets the landmark allowance instead. Nothing else may
# opt out: an override here is a promise about how the asset is scattered.
TRIANGLE_BUDGET_OVERRIDE = {
    "RaidAmphitheatre-0": 6000,
}


# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
#
# One warm desert palette shared by all four modules. Values are linear, which
# is what Blender's Base Color and glTF's baseColorFactor both want.
#
# Two constraints set these numbers.
#
# 1. VALUE. The Raid ground is 0xc0a071 hardpack to 0xa89170 gravel — 0.371 and
#    0.267 linear luminance — and raidMode lights it with a 3.1-strength sun.
#    Stone authored at a similar albedo blows out to a value LIGHTER than the
#    sand it stands on, and a light flat-faceted block on dark ground reads as a
#    cardboard carton, not as rock. Stone sits near 0.20, a little over half the
#    hardpack, so the sun can brighten it without inverting the relationship.
# 2. HUE. This is what the first version got wrong, and it is why these numbers
#    moved. The value relationship was already right — rock was 0.175 against
#    sand's 0.286, about 61% — but the CHROMA was not: rock ran R:G:B at
#    3.75 : 2.00 : 1.00, which is terracotta, and under a warm sun it read as
#    fired clay rather than as desert stone. The reference is warm tan sand
#    against brown-GREY stone, so the whole stone family is now pulled to about
#    1.8 : 1.5 : 1.0 at the same luminance it always had. Nothing got darker;
#    the orange came out.
#
#    ruin.py already authored its own family in that ratio, so the stone here is
#    retoned TOWARDS the ruins rather than the ruins being dragged back.
PALETTE_SPEC = {
    "rock":       ("RaidRock",       (0.238, 0.196, 0.132), 0.92),
    "rock_dark":  ("RaidRockDark",   (0.108, 0.088, 0.060), 0.95),
    "rock_warm":  ("RaidRockWarm",   (0.333, 0.274, 0.185), 0.90),
    "sand":       ("RaidSandApron",  (0.430, 0.330, 0.196), 0.96),
    "wood":       ("RaidWood",       (0.150, 0.118, 0.078), 0.93),
    "leaf":       ("RaidLeaf",       (0.235, 0.250, 0.125), 0.90),
    "grass":      ("RaidGrass",      (0.400, 0.315, 0.150), 0.92),
    "pole":       ("RaidPole",       (0.270, 0.222, 0.158), 0.78),
    # The navigation marker is a SIGNAL, not scenery. It is the one place in the
    # kit that is allowed to be saturated, because its whole job is to not look
    # like the desert.
    "accent":     ("RaidAccent",     (0.760, 0.280, 0.130), 0.60),
    # Ruins and the rift. Authored in ruin.py and repeated here so the module
    # finds them by key instead of falling through to its own fallbacks — a
    # fallback would author a material outside the palette and audit() would
    # (correctly) fail the build for it.
    "ruin":       ("RaidRuinStone",  (0.288, 0.234, 0.158), 0.90),
    "ruin_dark":  ("RaidRuinShade",  (0.152, 0.126, 0.092), 0.94),
    "ruin_sand":  ("RaidRuinSand",   (0.400, 0.330, 0.202), 0.96),
    "rift_stone": ("RaidRiftStone",  (0.052, 0.046, 0.062), 0.88),
    # The rift glows. Its albedo is nearly black on purpose: all of its value
    # comes from the emission, so it keeps its hue at any sun angle. Strengths
    # stay low because anything much above 3 saturates all three channels
    # through the tonemapper and the shard renders white.
    "rift_glow":  ("RaidRiftGlow",   (0.035, 0.040, 0.095), 0.35, (0.055, 0.240, 1.000), 1.15),
    "rift_core":  ("RaidRiftCore",   (0.070, 0.045, 0.110), 0.30, (0.230, 0.075, 1.000), 2.05),
}


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.objects,
        bpy.data.images,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, colour, roughness, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        # BOTH sockets, always. Blender ships Emission Strength at 0.0, so a
        # material that sets only the colour exports a black emissiveFactor and
        # renders as dead stone — the easiest way to lose the rift's glow
        # silently between here and the GLB.
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def build_palette():
    """Author the shared palette.

    The datablock names deliberately match every module's own fallback name.
    rock.py, plant.py and ruin.py look a missing key up by name in bpy.data
    before creating anything, so even a key mismatch lands on this palette
    instead of quietly authoring a second, differently coloured set of
    materials — which audit() would then fail as a stray.

    Entries are 3-tuples for plain materials and 5-tuples for the two emissive
    rift materials.
    """
    return {key: material(*spec) for key, spec in PALETTE_SPEC.items()}


ROCK_ASSETS = (
    "RaidBoulder-0", "RaidBoulder-1", "RaidBoulder-2",
    "RaidSlab-0", "RaidSlab-1", "RaidGravel-0", "RaidGravel-1",
)


def bake_modifiers(obj):
    """Apply the object's modifier stack now instead of at export time."""
    if not obj.modifiers:
        return
    view_layer = bpy.context.view_layer
    previous = view_layer.objects.active
    for other in list(bpy.context.selected_objects):
        other.select_set(False)
    view_layer.objects.active = obj
    obj.select_set(True)
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    view_layer.objects.active = previous


def deterministic_box_uvs(obj, scale=0.5):
    """Replace an unwrap with a plain box projection.

    Two separate steps in the rock pipeline are irreproducible, and both only
    affect TEXCOORD_0 -- vertex positions come out byte-identical every time:

      * `bpy.ops.uv.smart_project` packs islands with a threaded, time-budgeted
        search, so the same mesh unwraps differently run to run;
      * the BEVEL modifier interpolates UVs onto the arris faces it creates
        non-deterministically, so even a stable input unwrap drifts once the
        modifier is evaluated at export.

    Together they were the only thing stopping this kit rebuilding identically.
    Baking the modifier first and then projecting kills both: the projection is
    computed on final geometry, so export has nothing left to interpolate.
    Nothing in the kit samples a texture -- every material is a flat colour --
    so the UVs only have to exist and be stable, and a per-face projection onto
    the dominant normal axis is both.
    """
    mesh = obj.data
    uv = mesh.uv_layers.active or mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        normal = polygon.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for loop_index in polygon.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if axis == 0:
                u, v = co.y, co.z
            elif axis == 1:
                u, v = co.x, co.z
            else:
                u, v = co.x, co.y
            uv.data[loop_index].uv = (u * scale, v * scale)


def triangles(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    evaluated.to_mesh_clear()
    return count


def audit(palette):
    """Fail loudly on the three things that can silently ruin the kit: a missing
    prototype, a module that authored its own materials because a palette key
    did not match, and an asset over the instancing budget."""
    problems = []

    expected = {mat.name for mat in palette.values()}
    actual = {mat.name for mat in bpy.data.materials if mat.users > 0}
    stray = actual - expected
    if stray:
        problems.append(f"modules authored materials outside the palette: {sorted(stray)}")

    bpy.context.view_layer.update()
    for name in RUNTIME_ASSETS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            problems.append(f"missing runtime asset {name}")
            continue
        if obj.parent is not None:
            problems.append(f"{name} is not a root object")
        if tuple(obj.location) != (0.0, 0.0, 0.0):
            problems.append(f"{name} origin is not at (0,0,0)")
        meshes = [child for child in obj.children_recursive if child.type == "MESH"]
        if not meshes:
            problems.append(f"{name} has no mesh children")
            continue
        total = sum(triangles(mesh) for mesh in meshes)
        slots = {slot.material.name for mesh in meshes for slot in mesh.material_slots if slot.material}
        world = [mesh.matrix_world @ Vector(corner)
                 for mesh in meshes for corner in mesh.bound_box]
        size = (
            max(p.x for p in world) - min(p.x for p in world),
            max(p.y for p in world) - min(p.y for p in world),
            max(p.z for p in world) - min(p.z for p in world),
        )
        budget = TRIANGLE_BUDGET_OVERRIDE.get(name, TRIANGLE_BUDGET)
        flag = "  OVER BUDGET" if total > budget else ""
        print(f"[raid-kit] {name:<18} {total:>5} tris  "
              f"{size[0]:6.2f} x {size[1]:6.2f} x {size[2]:6.2f} m  "
              f"{len(meshes)} mesh / {len(slots)} mat{flag}")
        if total > budget:
            problems.append(f"{name} is {total} triangles, over the {budget} budget")

    if problems:
        for problem in problems:
            print(f"[raid-kit] FAIL {problem}")
        raise SystemExit("raid kit audit failed")


# ---------------------------------------------------------------------------
# Contact sheet
# ---------------------------------------------------------------------------

def build_world():
    world = bpy.data.worlds.new("Raid Kit Sky")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.46, 0.55, 0.68, 1.0)
    background.inputs["Strength"].default_value = 0.55
    bpy.context.scene.world = world


def show(obj, visible):
    """hide_render on an empty does not hide its meshes, so set it on the whole
    subtree. Panels that do not want an asset must actually hide it: parking a
    21 m mesa off to one side still puts it on the horizon."""
    obj.hide_render = not visible
    for child in obj.children_recursive:
        child.hide_render = not visible


def panel(layout):
    """Hide every prototype, then place and reveal only the ones this panel
    wants. `layout` is (name, x, y, yaw) tuples."""
    for name in RUNTIME_ASSETS:
        show(bpy.data.objects[name], False)
    for name, x, y, yaw in layout:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise SystemExit(f"missing asset {name}")
        obj.location = (x, y, 0.0)
        obj.rotation_euler = (0.0, 0.0, yaw)
        show(obj, True)


def stack_panels(paths, out_path):
    """Blender image buffers are bottom-up, so panels go in reversed."""
    planes = []
    width = 0
    for path in reversed(paths):
        image = bpy.data.images.load(str(path))
        width = image.size[0]
        planes.append(np.array(image.pixels[:]).reshape(image.size[1], image.size[0], 4))
    combined = np.concatenate(planes, axis=0)
    result = bpy.data.images.new("RaidKitContactSheet", width=width, height=combined.shape[0])
    result.pixels = combined.ravel().tolist()
    result.filepath_raw = str(out_path)
    result.file_format = "PNG"
    result.save()


def render_contact_sheet(palette):
    """Three panels, because the kit spans 0.42 m tussocks and a 21 m mesa and a
    single frame that fits the mesa cannot be used to judge the grass."""
    scratch = []

    build_world()
    bpy.ops.mesh.primitive_plane_add(size=1400, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = "Contact Sheet Ground"
    ground.data.materials.append(material("ContactSheetSand", (0.520, 0.372, 0.212), 0.97))
    scratch.append(ground)

    # A low raking sun. Undercuts, bedding and blade separation only exist
    # visually if something is casting across them.
    bpy.ops.object.light_add(type="SUN", location=(-40, -30, 40))
    key = bpy.context.object
    key.name = "Contact Sheet Key"
    key.data.energy = 3.0
    key.data.color = (1.0, 0.87, 0.68)
    key.data.angle = math.radians(1.6)
    key.rotation_euler = (math.radians(56), 0.0, math.radians(-48))
    scratch.append(key)

    bpy.ops.object.light_add(type="SUN", location=(30, 34, 40))
    fill = bpy.context.object
    fill.name = "Contact Sheet Fill"
    fill.data.energy = 0.45
    fill.data.color = (0.60, 0.72, 1.0)
    fill.rotation_euler = (math.radians(36), 0.0, math.radians(132))
    scratch.append(fill)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = PANEL_W
    scene.render.resolution_y = PANEL_H
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -0.35
    for attribute, value in (
        ("taa_render_samples", 64),
        ("use_shadows", True),
        ("use_raytracing", True),
    ):
        if hasattr(scene.eevee, attribute):
            setattr(scene.eevee, attribute, value)

    panels = []

    def render(camera_location, camera_rotation, lens, tag):
        bpy.ops.object.camera_add(location=camera_location, rotation=camera_rotation)
        camera = bpy.context.object
        camera.name = f"Contact Sheet {tag}"
        camera.data.lens = lens
        scene.camera = camera
        path = PREVIEW.parent / f"_raid-kit-{tag}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        panels.append(path)
        scratch.append(camera)

    # -- Panel 1: the metre-scale props at walking distance. -----------------
    # Left to right: grass, scrub, deadwood, marker, gravel.
    panel((
        ("RaidTussock-0", -4.3, 0.5, 0.0),
        ("RaidTussock-1", -3.0, -0.5, 1.1),
        ("RaidScrub-0", -1.5, 0.4, 0.4),
        ("RaidScrub-1", 0.3, -0.6, 2.2),
        ("RaidDeadwood-0", 2.1, 0.3, 0.9),
        ("RaidMarker-0", 3.4, 0.9, 0.3),
        ("RaidGravel-0", 4.4, -0.7, 0.0),
    ))
    render((0.0, -8.5, 1.50), (math.radians(87), 0, 0), 32.0, "props")

    # -- Panel 2: the rock family at eye height. ----------------------------
    panel((
        ("RaidBoulder-0", -11.2, 1.0, 0.6),
        ("RaidBoulder-1", -8.0, -0.6, 2.3),
        ("RaidBoulder-2", -3.6, 0.8, 4.1),
        ("RaidSlab-0", 1.6, -0.6, 1.0),
        ("RaidSlab-1", 8.2, 0.8, 5.4),
        ("RaidGravel-1", -4.0, -7.0, 0.0),
        ("RaidTussock-0", -9.0, -5.5, 0.0),
        ("RaidScrub-0", 3.4, -6.5, 1.7),
    ))
    render((0.4, -24.0, 1.65), (math.radians(88), 0, math.radians(-2)), 34.0, "rock")

    # -- Panel 3: the landmarks at navigation distance, with metre-scale props
    # in the near field so the eye has something to measure them against.
    panel((
        ("RaidMesa-0", -46.0, 300.0, 0.7),
        ("RaidSpire-0", 62.0, 215.0, 2.1),
        ("RaidSlab-1", -22.0, 62.0, 0.4),
        ("RaidBoulder-2", 26.0, 74.0, 1.2),
        ("RaidMarker-0", 6.0, 28.0, 0.0),
        ("RaidScrub-0", -6.0, 26.0, 0.9),
    ))
    render((0.0, -18.0, 5.5), (math.radians(88.4), 0, 0), 50.0, "landmark")

    # -- Panel 4: the ruins and the rift, at driving distance. The amphitheatre
    # is 71 m across, so it sits far back and the metre-scale masonry comes
    # forward: the panel has to be usable for judging both.
    panel((
        ("RaidAmphitheatre-0", -18.0, 190.0, 0.5),
        ("RaidRuinArch-0", 2.0, 46.0, 0.1),
        ("RaidRuinColumn-0", -16.0, 34.0, 0.6),
        ("RaidRuinColumn-1", -10.0, 26.0, 2.4),
        ("RaidRuinWall-0", 20.0, 60.0, 1.2),
        ("RaidRiftShard-0", -26.0, 62.0, 3.1),
        ("RaidRiftVent-0", 26.0, 26.0, 0.8),
        ("RaidScrub-0", 8.0, 20.0, 1.4),
    ))
    render((0.0, -6.0, 4.2), (math.radians(87.6), 0, 0), 42.0, "ruin")

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    stack_panels(panels, PREVIEW)
    for path in panels:
        path.unlink(missing_ok=True)

    # Preview-only objects never reach the GLB.
    for obj in scratch:
        bpy.data.objects.remove(obj, do_unlink=True)
    for name in RUNTIME_ASSETS:
        obj = bpy.data.objects.get(name)
        obj.location = (0.0, 0.0, 0.0)
        obj.rotation_euler = (0.0, 0.0, 0.0)
        show(obj, True)


def main():
    reset_scene()
    palette = build_palette()

    rock_module.build_rocks(palette)
    landmark_module.build_landmarks(palette)
    plant_module.build_plants(palette)
    ruin_module.build_ruins(palette)

    for name in ROCK_ASSETS:
        for child in bpy.data.objects[name].children_recursive:
            if child.type == "MESH":
                bake_modifiers(child)
                deterministic_box_uvs(child)

    audit(palette)
    render_contact_sheet(palette)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT.with_suffix(".blend")))
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_animations=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
    )
    print(f"Wrote {OUTPUT}")
    print(f"Wrote {PREVIEW}")


if __name__ == "__main__":
    main()
