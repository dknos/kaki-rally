"""Visual QA for the Kaki Rally Raid vegetation.

    /home/nemoclaw/bin/blender -b --python tools/blender/raid_kit/preview_plants.py

Renders two stacked panels to docs/qa/assets/raid-kit-plant-preview.png:

    top     a close walk-up, ~7 m, for silhouette and construction
    bottom  the same row at 15 m with a scattered field behind it

The bottom panel is the one that decides whether an asset ships. In game these
sit on bright hardpack with shadows off, so the preview lights them the same way
— sun-dominant over a sand plane, minimal fill. A plant that reads beautifully
against a dark void and vanishes against sand is a plant that does not work.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import plant  # noqa: E402  (needs the sys.path insert above)

PREVIEW = REPO / "docs" / "qa" / "assets" / "raid-kit-plant-preview.png"
SCRATCH = Path("/tmp/claude-1000/-home-nemoclaw/39717c4d-d4ce-4327-ab0d-e86183347b41/scratchpad")

WIDTH, HEIGHT = 1280, 720
SAND = (0.74, 0.60, 0.40)
CLOSE_EYE = (0.0, -5.6, 0.95)
ARC_RADIUS = 5.0


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights, bpy.data.objects):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def aim_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def report():
    total = 0
    print("\n--- vegetation triangle budget ---")
    for name in plant.PLANT_ASSETS:
        root = bpy.data.objects.get(name)
        if root is None:
            print(f"  {name:<16} MISSING")
            continue
        tris = 0
        parts = 0
        materials = set()
        low = high = None
        for child in root.children:
            if child.type != "MESH":
                continue
            parts += 1
            tris += sum(len(polygon.vertices) - 2 for polygon in child.data.polygons)
            for slot in child.material_slots:
                if slot.material:
                    materials.add(slot.material.name)
            for corner in child.bound_box:
                world = child.matrix_world @ Vector(corner)
                low = world.z if low is None else min(low, world.z)
                high = world.z if high is None else max(high, world.z)
        total += tris
        print(f"  {name:<16} {tris:>5} tris  {parts} part(s)  {len(materials)} material(s)  "
              f"z {low:+.3f}..{high:.3f}  ({', '.join(sorted(materials))})")
    print(f"  {'TOTAL':<16} {total:>5} tris\n")


def build_field(rng_seed=0x5CA7):
    """Copies of the prototypes scattered behind the row, sharing mesh data, so
    the 15 m panel shows a field rather than a museum shelf."""
    rng = plant.Rng(rng_seed)
    field = bpy.data.objects.new("PreviewField", None)
    bpy.context.scene.collection.objects.link(field)
    sources = [bpy.data.objects.get(name) for name in plant.PLANT_ASSETS]
    weights = [1.0, 1.0, 3.0, 2.4, 0.4, 0.25]
    total = sum(weights)
    for _ in range(190):
        roll = rng.uniform(0.0, total)
        pick = 0
        while pick < len(weights) - 1 and roll > weights[pick]:
            roll -= weights[pick]
            pick += 1
        source = sources[pick]
        if source is None:
            continue
        x = rng.uniform(-26.0, 26.0)
        y = rng.uniform(7.0, 44.0)
        scale = rng.uniform(0.8, 1.45)
        clone = bpy.data.objects.new(f"FieldCopy_{pick}_{int(x * 100)}_{int(y * 100)}", None)
        clone.location = (x, y, 0.0)
        clone.rotation_euler = (0.0, 0.0, rng.uniform(0.0, math.tau))
        clone.scale = (scale, scale, scale)
        clone.parent = field
        bpy.context.scene.collection.objects.link(clone)
        for child in source.children:
            if child.type != "MESH":
                continue
            copy = bpy.data.objects.new(child.name + "_field", child.data)
            copy.parent = clone
            bpy.context.scene.collection.objects.link(copy)
    return field


def main():
    reset_scene()
    SCRATCH.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)

    plant.build_plants(None)
    report()

    # The row is laid out on an arc centred on the close camera rather than on a
    # straight line, so every asset is the same distance from it and the panel
    # spends its pixels on plants instead of on empty foreground sand.
    roots = [bpy.data.objects.get(name) for name in plant.PLANT_ASSETS]
    for index, root in enumerate(roots):
        if not root:
            continue
        angle = (index - (len(roots) - 1) / 2) / max(len(roots) - 1, 1) * 0.90
        root.location = (math.sin(angle) * ARC_RADIUS, CLOSE_EYE[1] + math.cos(angle) * ARC_RADIUS, 0.0)
        root.rotation_euler = (0.0, 0.0, -angle)

    build_field()

    # Ground. Bright hardpack, exactly what these have to survive being seen on.
    bpy.ops.mesh.primitive_plane_add(size=220, location=(0, 20, 0))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    ground.data.materials.append(plant._new_material("PreviewSand", SAND, 0.96))

    # Neutral 1.7 m scale reference — driver eye height — beside the row.
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.045, depth=1.7,
                                        location=(math.sin(-0.78) * ARC_RADIUS,
                                                  CLOSE_EYE[1] + math.cos(-0.78) * ARC_RADIUS, 0.85))
    ruler = bpy.context.object
    ruler.name = "PreviewScaleRef"
    ruler.data.materials.append(plant._new_material("PreviewRuler", (0.10, 0.10, 0.12), 0.7))

    scene = bpy.context.scene
    world = scene.world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.42, 0.52, 0.68, 1.0)
    background.inputs["Strength"].default_value = 0.55

    bpy.ops.object.light_add(type="SUN", location=(-9, -6, 14))
    sun = bpy.context.object
    sun.name = "PreviewSun"
    sun.data.energy = 3.0
    sun.data.angle = math.radians(2.0)
    sun.data.color = (1.0, 0.94, 0.84)
    aim_at(sun, (2, 4, 0))

    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"

    bpy.ops.object.camera_add(location=(0, -7.0, 1.45))
    camera = bpy.context.object
    camera.name = "PreviewCamera"
    scene.camera = camera

    # Burn the label into each panel. Guessing which half of a stitched image is
    # which cost a whole review round; the renderer can just say so.
    scene.render.use_stamp = True
    scene.render.use_stamp_note = True
    scene.render.use_stamp_date = False
    scene.render.use_stamp_time = False
    scene.render.use_stamp_render_time = False
    scene.render.use_stamp_frame = False
    scene.render.use_stamp_scene = False
    scene.render.use_stamp_filename = False
    scene.render.use_stamp_camera = False
    scene.render.use_stamp_lens = False
    scene.render.stamp_font_size = 26

    panels = []
    for label, location, lens, target, height in (
        # Close walk-up at the arc centre: construction and silhouette.
        ("CLOSE  5 m", CLOSE_EYE, 28, (0.0, CLOSE_EYE[1] + 4.6, 0.50), 600),
        # The one that decides whether an asset ships: 15 m, driver eye height.
        # Letterboxed, because half a 16:9 frame at this range is empty foreground.
        ("FIELD  15 m", (0.0, -15.4, 1.60), 50, (0.0, 0.6, 0.62), 440),
    ):
        camera.location = location
        camera.data.lens = lens
        aim_at(camera, target)
        scene.render.resolution_y = height
        scene.render.stamp_note_text = label
        path = SCRATCH / f"raid-plant-{label.split()[0].lower()}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        panels.append(path)

    stitch(panels, PREVIEW)
    print(f"Wrote {PREVIEW}")


def stitch(paths, destination):
    """Stack the panels, close view on top.

    Blender hands back a bottom-up pixel buffer, so array row 0 is the bottom of
    the image and the panel that should appear on top has to go last. The burnt-in
    stamps are what proved which way round it goes."""
    rows = []
    for path in paths:
        image = bpy.data.images.load(str(path))
        pixels = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)
        rows.append(pixels)
        bpy.data.images.remove(image)
    combined = np.concatenate(list(reversed(rows)), axis=0)
    out = bpy.data.images.new("RaidPlantPreview", width=combined.shape[1], height=combined.shape[0])
    out.pixels = combined.ravel().tolist()
    out.filepath_raw = str(destination)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)


if __name__ == "__main__":
    main()
