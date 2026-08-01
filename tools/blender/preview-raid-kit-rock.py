"""Visual QA for the Kaki Rally Raid rock assets only.

    /home/nemoclaw/bin/blender -b --python tools/blender/preview-raid-kit-rock.py

Builds nothing but `raid_kit.rock`, beds it into a sand plane under a low warm
sun and renders two stacked panels:

  top     boulders at 1.65 m eye height, the "does it read as rock" test
  middle  slabs and gravel at eye height, where bedding and undercut are judged
  bottom  the 200 m view, where each asset is a few dozen pixels: the
          silhouette test that decides whether the kit survives at scatter
          distance

Result: docs/qa/assets/raid-kit-rock-preview.png
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import numpy as np

REPO = Path(__file__).resolve().parents[2]
PREVIEW = REPO / "docs" / "qa" / "assets" / "raid-kit-rock-preview.png"
PANEL_W = 1440
PANEL_H = 700

sys.path.insert(0, str(REPO / "tools" / "blender"))
from raid_kit import rock as rock_module  # noqa: E402


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.objects,
        bpy.data.images,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, colour, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def build_world():
    world = bpy.data.worlds.new("Raid Preview Sky")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.42, 0.52, 0.66, 1.0)
    background.inputs["Strength"].default_value = 0.5
    bpy.context.scene.world = world


def render_panel(camera, path):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def stack_panels(paths, out_path):
    """Blender image buffers are bottom-up, so panels go in reversed."""
    planes = []
    width = 0
    for path in reversed(paths):
        image = bpy.data.images.load(str(path))
        width = image.size[0]
        planes.append(np.array(image.pixels[:]).reshape(image.size[1], image.size[0], 4))
    combined = np.concatenate(planes, axis=0)
    result = bpy.data.images.new("RaidRockPreview", width=width, height=combined.shape[0])
    result.pixels = combined.ravel().tolist()
    result.filepath_raw = str(out_path)
    result.file_format = "PNG"
    result.save()


def main():
    reset_scene()
    build_world()

    rock = material("RaidRock", (0.298, 0.238, 0.190), 0.90)
    rock_dark = material("RaidRockDark", (0.132, 0.101, 0.082), 0.96)
    sand = material("RaidPreviewSand", (0.72, 0.585, 0.395), 0.96)

    rock_module.build_rocks({"rock": rock, "rock_dark": rock_dark})

    bpy.ops.mesh.primitive_plane_add(size=600, location=(0, 0, 0))
    ground = bpy.context.object
    ground.name = "Preview Ground"
    ground.data.materials.append(sand)

    layout = [
        ("RaidGravel-0", (-11.4, 1.2), 0.0),
        ("RaidBoulder-0", (-8.2, -0.3), 0.6),
        ("RaidBoulder-1", (-4.8, 0.5), 2.3),
        ("RaidBoulder-2", (0.4, -0.4), 4.1),
        ("RaidSlab-0", (6.4, 0.9), 1.0),
        ("RaidSlab-1", (13.8, -0.2), 5.4),
        ("RaidGravel-1", (20.4, 1.4), 0.0),
    ]
    for name, (x, y), yaw in layout:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise SystemExit(f"missing asset {name}")
        obj.location = (x, y, 0.0)
        obj.rotation_euler = (0.0, 0.0, yaw)

    # A low raking sun. Undercuts and cleavage planes only exist visually if
    # something is casting across them.
    bpy.ops.object.light_add(type="SUN", location=(-24, -18, 20))
    key = bpy.context.object
    key.name = "Warm Key"
    key.data.energy = 2.6
    key.data.color = (1.0, 0.86, 0.66)
    key.data.angle = math.radians(1.4)
    key.rotation_euler = (math.radians(58), 0.0, math.radians(-52))

    bpy.ops.object.light_add(type="SUN", location=(18, 22, 26))
    fill = bpy.context.object
    fill.name = "Sky Fill"
    fill.data.energy = 0.4
    fill.data.color = (0.62, 0.73, 1.0)
    fill.rotation_euler = (math.radians(38), 0.0, math.radians(128))

    bpy.ops.object.camera_add(
        location=(-9.6, -8.6, 1.65), rotation=(math.radians(88), 0, math.radians(-31))
    )
    boulders = bpy.context.object
    boulders.name = "Walk Up Boulders"
    boulders.data.lens = 30.0

    bpy.ops.object.camera_add(
        location=(3.2, -10.2, 1.65), rotation=(math.radians(89), 0, math.radians(-33))
    )
    shelves = bpy.context.object
    shelves.name = "Walk Up Shelves"
    shelves.data.lens = 30.0

    bpy.ops.object.camera_add(location=(4.5, -200.0, 20.0), rotation=(math.radians(86.5), 0, 0))
    far = bpy.context.object
    far.name = "Scatter Distance"
    far.data.lens = 90.0

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = PANEL_W
    scene.render.resolution_y = PANEL_H
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = -0.4
    for attribute, value in (
        ("taa_render_samples", 64),
        ("use_shadows", True),
        ("use_raytracing", True),
        ("use_shadow_jitter_viewport", True),
    ):
        if hasattr(scene.eevee, attribute):
            setattr(scene.eevee, attribute, value)

    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    scratch = PREVIEW.parent
    panels = []
    for camera, tag in ((boulders, "boulders"), (shelves, "shelves"), (far, "far")):
        path = scratch / f"_raid-rock-{tag}.png"
        render_panel(camera, path)
        panels.append(path)
    stack_panels(panels, PREVIEW)
    for path in panels:
        path.unlink(missing_ok=True)
    print(f"[raid-rock] wrote {PREVIEW}")


if __name__ == "__main__":
    main()
