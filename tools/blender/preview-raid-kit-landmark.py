"""Visual QA for the Kaki Rally Raid landmark assets.

  /home/nemoclaw/bin/blender -b --python tools/blender/preview-raid-kit-landmark.py

Renders two panels into one sheet:
  LEFT   close three-quarter view, mesa plus spire, ground plane for scale.
  RIGHT  far silhouette, camera 800 m back on a long lens, both landmarks
         against sky and a real horizon. This is the view that matters: the
         player's complaint was that the old mesa read as stacked boxes
         floating in the sky at distance.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from raid_kit import landmark as landmark_module  # noqa: E402

PREVIEW = REPO / "docs" / "qa" / "assets" / "raid-kit-landmark-preview.png"
SCRATCH = Path("/tmp/claude-1000/-home-nemoclaw/39717c4d-d4ce-4327-ab0d-e86183347b41/scratchpad")

PANEL_W = 1100
PANEL_H = 860


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.objects):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def material(name, color, roughness=0.9):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def triangle_count(parent):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for child in parent.children:
        if child.type != "MESH":
            continue
        mesh = child.evaluated_get(depsgraph).to_mesh()
        mesh.calc_loop_triangles()
        total += len(mesh.loop_triangles)
        child.evaluated_get(depsgraph).to_mesh_clear()
    return total


def render_to(path, camera):
    scene = bpy.context.scene
    scene.camera = camera
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def stitch(left_path, right_path, out_path):
    panels = []
    for path in (left_path, right_path):
        image = bpy.data.images.load(str(path))
        image.colorspace_settings.name = "sRGB"
        width, height = image.size
        buffer = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(buffer)
        panels.append(buffer.reshape(height, width, 4))
        bpy.data.images.remove(image)
    combined = np.concatenate(panels, axis=1)
    height, width, _ = combined.shape
    out = bpy.data.images.new("landmark-preview", width, height, alpha=True, float_buffer=False)
    out.colorspace_settings.name = "sRGB"
    out.pixels.foreach_set(combined.reshape(-1))
    out.filepath_raw = str(out_path)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)


def main():
    reset_scene()

    palette = {
        "rock": material("RaidRock", (0.355, 0.205, 0.115), roughness=0.92),
        "rock_dark": material("RaidRockDark", (0.230, 0.128, 0.072), roughness=0.95),
        "rock_warm": material("RaidRockWarm", (0.470, 0.300, 0.160), roughness=0.90),
        "sand": material("RaidSandApron", (0.560, 0.400, 0.230), roughness=0.96),
    }
    ground_mat = material("PreviewGround", (0.600, 0.440, 0.260), roughness=0.98)

    landmark_module.build_landmarks(palette)

    mesa = bpy.data.objects["RaidMesa-0"]
    spire = bpy.data.objects["RaidSpire-0"]
    spire.location = (46.0, -14.0, 0.0)
    spire.scale = (2.4, 2.4, 2.4)

    bpy.ops.mesh.primitive_plane_add(size=9000, location=(0, 0, -0.05))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    ground.data.materials.append(ground_mat)

    world = bpy.data.worlds.new("PreviewSky") if not bpy.data.worlds else bpy.data.worlds[0]
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.42, 0.58, 0.82, 1.0)
    background.inputs["Strength"].default_value = 0.55

    # Raking low sun: a landmark is judged on the shadow it carves into itself.
    bpy.ops.object.light_add(type="SUN", location=(-120, -160, 220))
    sun = bpy.context.object
    sun.data.energy = 3.1
    sun.data.color = (1.0, 0.90, 0.76)
    sun.rotation_euler = (math.radians(62), 0.0, math.radians(46))

    # Close three-quarter view.
    bpy.ops.object.camera_add(location=(-68.0, -96.0, 26.0))
    near = bpy.context.object
    near.name = "CloseCam"
    near.data.lens = 38.0
    near.data.clip_start = 0.1
    near.data.clip_end = 6000.0
    near.rotation_euler = (math.radians(80.5), 0.0, math.radians(-34.0))

    # Far silhouette. 800 m back, long lens, horizon in frame.
    bpy.ops.object.camera_add(location=(18.0, -800.0, 16.0))
    far = bpy.context.object
    far.name = "FarCam"
    far.data.lens = 330.0
    far.data.clip_start = 0.5
    far.data.clip_end = 6000.0
    far.rotation_euler = (math.radians(89.2), 0.0, 0.0)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = PANEL_W
    scene.render.resolution_y = PANEL_H
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"

    SCRATCH.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    left = SCRATCH / "landmark-close.png"
    right = SCRATCH / "landmark-far.png"
    render_to(left, near)
    render_to(right, far)
    stitch(left, right, PREVIEW)

    print("TRI RaidMesa-0", triangle_count(mesa))
    print("TRI RaidSpire-0", triangle_count(spire))
    for parent, label, divisor in ((mesa, "MESA", 1.0), (spire, "SPIRE", 2.4)):
        reach = 0.0
        top = 0.0
        low = 0.0
        for child in parent.children:
            if child.type != "MESH":
                continue
            for vert in child.data.vertices:
                world = child.matrix_world @ vert.co
                reach = max(reach, math.hypot(world.x, world.y) / divisor)
                top = max(top, world.z / divisor)
                low = min(low, world.z / divisor)
        print(f"{label} reach {reach:.2f} height {top:.2f} skirt {low:.2f}")
    print(f"Wrote {PREVIEW}")


if __name__ == "__main__":
    main()
