"""Build the authored Kaki Rally Raid environment kit and a visual QA contact sheet.

Blender 5.x:
  blender -b --python tools/blender/build-kaki-raid-environment-kit.py

Original project geometry. Nothing here is downloaded, traced, or derived from a
third party, so the kit carries no attribution burden and no licence risk.

The kit is scattered by src/racing/raid/raidEnvironment.js. Every asset is
authored around its own origin at ground level, +Y up, so the scatter can drop
it straight onto a terrain sample without a per-asset offset table.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import bpy

REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "assets" / "racing" / "raid" / "kaki-raid-environment-kit-v1.glb"
PREVIEW = REPO / "docs" / "qa" / "assets" / "kaki-raid-environment-kit-v1.png"

random.seed(0x52414944)


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
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, metallic=0.0, roughness=0.82):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def parent_asset(name):
    parent = bpy.data.objects.new(name, None)
    parent.location = (0.0, 0.0, 0.0)
    parent["kaki_asset"] = True
    parent["source"] = "Kaki Rally Raid original Blender geometry"
    bpy.context.scene.collection.objects.link(parent)
    return parent


def finish_mesh(obj, bevel=0.05, smooth=True):
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("Production bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
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
    obj["uv_ready"] = True
    return obj


def ico(name, parent, location, scale, mat, subdivisions=2, rotation=(0, 0, 0), bevel=0.04):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel)
    return obj


def cube(name, parent, location, scale, mat, rotation=(0, 0, 0), bevel=0.06):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel, smooth=False)
    return obj


def cylinder(name, parent, location, radius, depth, mat, vertices=10, rotation=(0, 0, 0), bevel=0.03):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel)
    return obj


def cone(name, parent, location, radius1, radius2, depth, mat, vertices=8, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=0.02)
    return obj


def jitter_vertices(obj, amount, seed):
    """Break primitive silhouettes so a scattered field never reads as a row of
    identical spheres. Deterministic per asset, so the kit rebuilds identically."""
    rng = random.Random(seed)
    for vertex in obj.data.vertices:
        vertex.co.x += rng.uniform(-amount, amount)
        vertex.co.y += rng.uniform(-amount, amount)
        vertex.co.z += rng.uniform(-amount, amount * 0.6)


# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------

def build_boulder(index, rock, rock_dark):
    name = f"RaidBoulder-{index}"
    parent = parent_asset(name)
    scale = (1.0 + index * 0.42, 0.86 + index * 0.36, 0.72 + index * 0.3)
    body = ico(f"{name}-body", parent, (0, 0, scale[2] * 0.78), scale, rock, subdivisions=2)
    jitter_vertices(body, 0.19 + index * 0.05, 11 + index)
    # A second smaller mass makes the silhouette read as broken rock rather than
    # a potato, and gives the shading something to catch.
    chip = ico(
        f"{name}-chip", parent,
        (scale[0] * 0.62, scale[1] * 0.28, scale[2] * 0.42),
        (scale[0] * 0.42, scale[1] * 0.4, scale[2] * 0.4),
        rock_dark, subdivisions=1,
    )
    jitter_vertices(chip, 0.13, 91 + index)
    return parent


def build_rock_slab(index, rock, rock_dark):
    name = f"RaidSlab-{index}"
    parent = parent_asset(name)
    tilt = math.radians(6 + index * 9)
    base = cube(f"{name}-base", parent, (0, 0, 0.28 + index * 0.1), (2.5 + index * 1.1, 1.7 + index * 0.7, 0.5 + index * 0.22), rock, rotation=(tilt, 0, math.radians(index * 17)))
    jitter_vertices(base, 0.1, 31 + index)
    cap = cube(f"{name}-cap", parent, (0.35, -0.2, 0.72 + index * 0.26), (1.5 + index * 0.6, 1.05 + index * 0.4, 0.3), rock_dark, rotation=(tilt * 0.6, 0, math.radians(index * 24)))
    jitter_vertices(cap, 0.08, 57 + index)
    return parent


def build_spire(rock, rock_dark):
    name = "RaidSpire-0"
    parent = parent_asset(name)
    body = cone(f"{name}-body", parent, (0, 0, 3.1), 1.9, 0.55, 6.2, rock, vertices=9)
    jitter_vertices(body, 0.24, 71)
    skirt = ico(f"{name}-skirt", parent, (0, 0, 0.7), (2.5, 2.2, 0.8), rock_dark, subdivisions=1)
    jitter_vertices(skirt, 0.2, 73)
    return parent


def build_mesa(rock, rock_dark, sand):
    """A distant landmark. Big enough to navigate by, which is the whole point of
    a landmark in a roadbook discipline."""
    name = "RaidMesa-0"
    parent = parent_asset(name)
    base = cone(f"{name}-base", parent, (0, 0, 9.0), 30.0, 21.0, 18.0, rock, vertices=11)
    jitter_vertices(base, 1.5, 101)
    cap = cylinder(f"{name}-cap", parent, (0, 0, 19.2), 21.4, 3.0, rock_dark, vertices=11)
    jitter_vertices(cap, 0.7, 103)
    apron = cone(f"{name}-apron", parent, (0, 0, 1.4), 38.0, 30.0, 2.9, sand, vertices=13)
    jitter_vertices(apron, 0.8, 107)
    return parent


def build_scrub(index, wood, leaf):
    name = f"RaidScrub-{index}"
    parent = parent_asset(name)
    cylinder(f"{name}-stem", parent, (0, 0, 0.22), 0.07, 0.45, wood, vertices=6)
    rng = random.Random(200 + index)
    for lobe in range(3 + index):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(0.12, 0.4)
        blob = ico(
            f"{name}-lobe{lobe}", parent,
            (math.cos(angle) * radius, math.sin(angle) * radius, 0.45 + rng.uniform(0, 0.3)),
            (0.34 + rng.uniform(0, 0.16), 0.3 + rng.uniform(0, 0.15), 0.26 + rng.uniform(0, 0.14)),
            leaf, subdivisions=1,
        )
        jitter_vertices(blob, 0.1, 300 + index * 10 + lobe)
    return parent


def build_tussock(index, grass):
    """Dry tussock grass. Cheap, and the thing that stops hardpack reading as an
    empty plane at eye level."""
    name = f"RaidTussock-{index}"
    parent = parent_asset(name)
    rng = random.Random(400 + index)
    for blade in range(5 + index * 2):
        angle = rng.uniform(0, math.tau)
        lean = rng.uniform(0.12, 0.42)
        height = rng.uniform(0.3, 0.62)
        cone(
            f"{name}-blade{blade}", parent,
            (math.cos(angle) * 0.06, math.sin(angle) * 0.06, height * 0.5),
            0.055, 0.006, height, grass, vertices=4,
            rotation=(math.cos(angle) * lean, math.sin(angle) * lean, 0),
        )
    return parent


def build_deadwood(wood):
    name = "RaidDeadwood-0"
    parent = parent_asset(name)
    cylinder(f"{name}-trunk", parent, (0, 0, 0.85), 0.17, 1.7, wood, vertices=7, rotation=(math.radians(7), 0, 0))
    cylinder(f"{name}-limb0", parent, (0.42, 0.1, 1.42), 0.085, 1.0, wood, vertices=6, rotation=(0, math.radians(64), 0))
    cylinder(f"{name}-limb1", parent, (-0.36, -0.16, 1.24), 0.07, 0.86, wood, vertices=6, rotation=(math.radians(20), math.radians(-58), 0))
    cylinder(f"{name}-limb2", parent, (0.06, 0.38, 1.62), 0.06, 0.66, wood, vertices=6, rotation=(math.radians(-52), 0, 0))
    return parent


def build_marker(pole, accent, dark):
    """Original Kaki navigation marker. Deliberately not a Dakar-style bollard:
    a leaning cairn-topped post with a painted band."""
    name = "RaidMarker-0"
    parent = parent_asset(name)
    cylinder(f"{name}-post", parent, (0, 0, 1.0), 0.075, 2.0, pole, vertices=8, rotation=(math.radians(4), 0, 0))
    cylinder(f"{name}-band", parent, (0, 0, 1.52), 0.098, 0.3, accent, vertices=8)
    ico(f"{name}-cairn0", parent, (0.16, 0.06, 0.2), (0.3, 0.26, 0.19), dark, subdivisions=1)
    ico(f"{name}-cairn1", parent, (-0.12, -0.14, 0.34), (0.22, 0.2, 0.16), dark, subdivisions=1)
    ico(f"{name}-cairn2", parent, (0.04, 0.1, 0.5), (0.15, 0.14, 0.12), dark, subdivisions=1)
    return parent


def build_gravel_cluster(index, rock, rock_dark):
    """Low scatter for wadi floors. Reads as loose stone underfoot without the
    cost of instancing hundreds of individual pebbles."""
    name = f"RaidGravel-{index}"
    parent = parent_asset(name)
    rng = random.Random(500 + index)
    for stone in range(6 + index * 3):
        angle = rng.uniform(0, math.tau)
        radius = rng.uniform(0.1, 1.15 + index * 0.5)
        scale = rng.uniform(0.09, 0.24)
        blob = ico(
            f"{name}-stone{stone}", parent,
            (math.cos(angle) * radius, math.sin(angle) * radius, scale * 0.55),
            (scale * 1.35, scale * 1.1, scale * 0.8),
            rock if stone % 2 == 0 else rock_dark, subdivisions=1,
        )
        jitter_vertices(blob, scale * 0.3, 600 + index * 20 + stone)
    return parent


def main():
    reset_scene()

    rock = material("RaidRock", (0.44, 0.38, 0.31), roughness=0.92)
    rock_dark = material("RaidRockDark", (0.31, 0.26, 0.22), roughness=0.95)
    sand = material("RaidSandApron", (0.74, 0.60, 0.40), roughness=0.96)
    wood = material("RaidWood", (0.36, 0.28, 0.20), roughness=0.9)
    leaf = material("RaidLeaf", (0.42, 0.44, 0.26), roughness=0.88)
    grass = material("RaidGrass", (0.62, 0.56, 0.32), roughness=0.9)
    pole = material("RaidPole", (0.80, 0.78, 0.72), roughness=0.6, metallic=0.15)
    accent = material("RaidAccent", (0.85, 0.35, 0.18), roughness=0.55)

    for index in range(3):
        build_boulder(index, rock, rock_dark)
    for index in range(2):
        build_rock_slab(index, rock, rock_dark)
    build_spire(rock, rock_dark)
    build_mesa(rock, rock_dark, sand)
    for index in range(2):
        build_scrub(index, wood, leaf)
    for index in range(2):
        build_tussock(index, grass)
    build_deadwood(wood)
    build_marker(pole, accent, rock_dark)
    for index in range(2):
        build_gravel_cluster(index, rock, rock_dark)

    # Lay the kit out on a grid for the QA contact sheet only. The runtime reads
    # each asset by name and re-places it, so this layout never ships.
    roots = [obj for obj in bpy.data.objects if obj.parent is None and obj.get("kaki_asset")]
    roots.sort(key=lambda obj: obj.name)
    # The mesa is a 60 m landmark and would swallow a contact sheet laid out for
    # metre-scale props, so it gets its own space well behind the grid.
    grid = [obj for obj in roots if obj.name != "RaidMesa-0"]
    mesa = next((obj for obj in roots if obj.name == "RaidMesa-0"), None)
    for index, obj in enumerate(grid):
        obj.location = ((index % 4) * 8.0 - 12.0, (index // 4) * 8.0 - 8.0, 0.0)
    if mesa:
        mesa.location = (0.0, 62.0, 0.0)

    scene = bpy.context.scene
    bpy.ops.object.camera_add(location=(0, -62, 34), rotation=(math.radians(66), 0, 0))
    camera = bpy.context.object
    camera.name = "Raid Kit Preview Camera"
    scene.camera = camera
    bpy.ops.object.light_add(type="SUN", location=(-16, -22, 32))
    key = bpy.context.object
    key.name = "Preview Warm Sun"
    key.data.energy = 4.2
    bpy.ops.object.light_add(type="AREA", location=(20, 12, 22))
    fill = bpy.context.object
    fill.name = "Preview Cool Fill"
    fill.data.energy = 260.0
    fill.data.size = 22.0

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.filepath = str(PREVIEW)
    scene.view_settings.view_transform = "AgX"
    bpy.ops.render.render(write_still=True)

    # Reset the layout so the shipped GLB has every asset at its own origin.
    for obj in roots:
        obj.location = (0.0, 0.0, 0.0)
    for preview_only in (camera, key, fill):
        preview_only.hide_viewport = True
        preview_only.hide_render = True

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
