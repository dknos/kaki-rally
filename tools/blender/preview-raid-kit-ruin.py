"""Visual QA for the Kaki Rally Raid ruin and rift assets.

  /home/nemoclaw/bin/blender -b --python tools/blender/preview-raid-kit-ruin.py

Three stacked panels, because these assets span a 1 m rubble block and a 72 m
amphitheatre and no single frame can be used to judge both:

  TOP     the architecture at driving distance, with a vehicle-sized proxy box
          under the arch. The arch has one job — the track goes through it —
          so the proxy is the acceptance test, not decoration.
  MIDDLE  the rift at dusk with the sun almost out. Emission is the whole point
          of those two assets and a daylight render cannot show whether it
          reads; this panel is deliberately dark.
  THIRD   the amphitheatre from the air, which is where the dune burial and
          the breach either read as one collapse or fall apart.
  BOTTOM  the same ring from a driver's eye at ground level. This is the only
          view the player ever actually gets of it, and an asset that reads
          from a helicopter and not from the seat is not finished.

It also exports a GLB and parses it, because a glowing material that loses its
emission at export is the single most likely silent failure in this module.
The palette used here is the TAN target, not the shipped v1 orange, so the
critique is made against the colours the assets are meant to have.
"""

from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import bpy
import numpy as np

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from raid_kit import ruin as ruin_module  # noqa: E402

PREVIEW = REPO / "docs" / "qa" / "assets" / "raid-kit-ruin-preview.png"
SCRATCH = Path("/tmp/claude-1000/-home-nemoclaw/39717c4d-d4ce-4327-ab0d-e86183347b41/scratchpad")

PANEL_W = 1500
PANEL_H = 640

ASSETS = (
    "RaidRuinArch-0", "RaidRuinColumn-0", "RaidRuinColumn-1", "RaidRuinWall-0",
    "RaidAmphitheatre-0", "RaidRiftShard-0", "RaidRiftVent-0",
)
BUDGET = {name: 1500 for name in ASSETS}
BUDGET["RaidAmphitheatre-0"] = 6000

# The tan target: warm pale gold sand over brown-grey stone. Deliberately not
# the saturated terracotta the v1 kit shipped with.
PALETTE = {
    "ruin":       ("RaidRuinStone", (0.288, 0.234, 0.158), 0.90, None, 0.0),
    "ruin_dark":  ("RaidRuinShade", (0.152, 0.126, 0.092), 0.94, None, 0.0),
    "ruin_sand":  ("RaidRuinSand",  (0.400, 0.330, 0.202), 0.96, None, 0.0),
    "rift_stone": ("RaidRiftStone", (0.052, 0.046, 0.062), 0.88, None, 0.0),
    "rift_glow":  ("RaidRiftGlow",  (0.035, 0.040, 0.095), 0.35, (0.055, 0.240, 1.000), 1.15),
    "rift_core":  ("RaidRiftCore",  (0.070, 0.045, 0.110), 0.30, (0.230, 0.075, 1.000), 2.05),
}
GROUND = (0.365, 0.300, 0.186)


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                   bpy.data.lights, bpy.data.objects, bpy.data.images):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def material(name, colour, roughness, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        for key in ("Emission Color", "Emission"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def show(obj, visible):
    obj.hide_render = not visible
    for child in obj.children_recursive:
        child.hide_render = not visible


def place(layout):
    for name in ASSETS:
        show(bpy.data.objects[name], False)
    for name, x, y, yaw in layout:
        obj = bpy.data.objects[name]
        obj.location = (x, y, 0.0)
        obj.rotation_euler = (0.0, 0.0, yaw)
        show(obj, True)


def stack(paths, out_path):
    """Blender image buffers are bottom-up, so panels go in reversed."""
    planes = []
    width = 0
    for path in reversed(paths):
        image = bpy.data.images.load(str(path))
        image.colorspace_settings.name = "sRGB"
        width, height = image.size
        buffer = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(buffer)
        planes.append(buffer.reshape(height, width, 4))
        bpy.data.images.remove(image)
    combined = np.concatenate(planes, axis=0)
    out = bpy.data.images.new("ruin-preview", width, combined.shape[0], alpha=True)
    out.colorspace_settings.name = "sRGB"
    out.pixels.foreach_set(combined.reshape(-1))
    out.filepath_raw = str(out_path)
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(out)


def report():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    from mathutils import Vector
    failures = []
    for name in ASSETS:
        parent = bpy.data.objects[name]
        meshes = [child for child in parent.children_recursive if child.type == "MESH"]
        total = 0
        corners = []
        for mesh_obj in meshes:
            if mesh_obj.modifiers:
                failures.append(f"{name} still carries a modifier")
            evaluated = mesh_obj.evaluated_get(depsgraph)
            mesh = evaluated.to_mesh()
            mesh.calc_loop_triangles()
            total += len(mesh.loop_triangles)
            evaluated.to_mesh_clear()
            corners += [mesh_obj.matrix_world @ Vector(c) for c in mesh_obj.bound_box]
        size = tuple(max(p[i] for p in corners) - min(p[i] for p in corners) for i in range(3))
        low = min(p.z for p in corners)
        flag = "  OVER BUDGET" if total > BUDGET[name] else ""
        print(f"[ruin-qa] {name:<20} {total:>5} tris   "
              f"{size[0]:6.2f} x {size[1]:6.2f} x {size[2]:6.2f} m   skirt {low:6.2f}{flag}")
        if total > BUDGET[name]:
            failures.append(f"{name} is {total} tris, over its {BUDGET[name]} budget")
        if low > -0.15:
            failures.append(f"{name} has no buried skirt (lowest vertex {low:.2f})")
    return failures


def verify_glb_emission():
    """Export and read the GLB back. Emission that only exists in Blender is
    worth nothing; the runtime sees the glTF."""
    path = SCRATCH / "raid-ruin-emission-check.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_animations=False,
    )
    raw = path.read_bytes()
    length, chunk_type = struct.unpack_from("<II", raw, 12)
    assert chunk_type == 0x4E4F534A, "first GLB chunk is not JSON"
    gltf = json.loads(raw[20:20 + length].decode("utf-8"))

    failures = []
    used = gltf.get("extensionsUsed", [])
    print(f"[ruin-qa] glTF extensionsUsed: {used}")
    for mat in gltf.get("materials", []):
        name = mat.get("name", "?")
        if not name.startswith("RaidRift"):
            continue
        factor = mat.get("emissiveFactor", [0.0, 0.0, 0.0])
        strength = (mat.get("extensions", {})
                    .get("KHR_materials_emissive_strength", {})
                    .get("emissiveStrength"))
        print(f"[ruin-qa] {name:<16} emissiveFactor {factor}  emissiveStrength {strength}")
        if name in ("RaidRiftGlow", "RaidRiftCore"):
            if max(factor) <= 0.0:
                failures.append(f"{name} exported a black emissiveFactor")
            if not strength or strength <= 1.0:
                failures.append(f"{name} lost KHR_materials_emissive_strength")
    if "KHR_materials_emissive_strength" not in used:
        failures.append("KHR_materials_emissive_strength missing from extensionsUsed")
    return failures


def verify_shared_palette_guard():
    """Simulate the SHIPPING palette, which cannot carry an emission.

    build-kaki-raid-environment-kit.py authors materials with a three-argument
    `material(name, colour, roughness)`. If the rift roles are added to that
    table in its current shape, this module is handed a correctly named but
    completely dark material. The module is supposed to notice and repair it;
    this asserts that it does, because the preview's own palette DOES carry
    emission and therefore never exercises this path.
    """
    from raid_kit.ruin import _resolve_material  # noqa: PLC0415
    failures = []
    for role, name in (("rift_glow", "SharedGlowProbe"), ("rift_core", "SharedCoreProbe")):
        plain = bpy.data.materials.new(name)
        plain.use_nodes = True
        bsdf = plain.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Emission Strength"].default_value = 0.0
        resolved = _resolve_material({role: plain}, role)
        strength = resolved.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value
        print(f"[ruin-qa] shared-palette guard {role}: strength {strength:.2f}")
        if strength <= 0.0:
            failures.append(f"{role} stayed dark when handed an emission-free material")
        bpy.data.materials.remove(resolved)
    return failures


def main():
    guard_failures = verify_shared_palette_guard()
    reset_scene()
    palette = {role: material(*spec) for role, spec in PALETTE.items()}
    ruin_module.build_ruins(palette)

    failures = list(guard_failures)
    failures += report()
    failures += verify_glb_emission()

    ground_mat = material("PreviewGround", GROUND, 0.97)
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, -0.02))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    ground.data.materials.append(ground_mat)

    # Vehicle proxy: 4.4 x 2.0 x 1.75 m, the size of a raid truck. Nothing in
    # the panel means anything without it.
    proxy_mat = material("PreviewProxy", (0.055, 0.075, 0.095), 0.55)
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.875))
    proxy = bpy.context.object
    proxy.name = "ScaleProxy"
    proxy.scale = (4.4, 2.0, 1.75)
    proxy.data.materials.append(proxy_mat)

    world = bpy.data.worlds.new("RuinSky")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")

    bpy.ops.object.light_add(type="SUN", location=(-70, -90, 90))
    sun = bpy.context.object
    sun.data.angle = math.radians(1.4)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = PANEL_W
    scene.render.resolution_y = PANEL_H
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    for attribute, value in (("taa_render_samples", 96), ("use_shadows", True),
                             ("use_raytracing", True), ("use_bloom", True)):
        if hasattr(scene.eevee, attribute):
            setattr(scene.eevee, attribute, value)

    SCRATCH.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    panels = []

    def render(tag, location, rotation, lens, exposure):
        bpy.ops.object.camera_add(location=location, rotation=rotation)
        camera = bpy.context.object
        camera.name = f"Cam-{tag}"
        camera.data.lens = lens
        camera.data.clip_end = 8000.0
        scene.camera = camera
        scene.view_settings.exposure = exposure
        path = SCRATCH / f"ruin-{tag}.png"
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        panels.append(path)

    # -- Panel 1: architecture at driving distance, daylight. ----------------
    background.inputs["Color"].default_value = (0.45, 0.56, 0.72, 1.0)
    background.inputs["Strength"].default_value = 0.65
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.90, 0.76)
    sun.rotation_euler = (math.radians(58), 0.0, math.radians(-42))
    proxy.hide_render = False
    proxy.location = (0.0, 6.0, 0.875)
    place((
        ("RaidRuinArch-0", 0.0, 0.0, 0.0),
        ("RaidRuinWall-0", 14.0, 3.0, 0.55),
        ("RaidRuinColumn-0", -13.0, 1.0, 0.3),
        ("RaidRuinColumn-1", -6.5, 9.5, 2.2),
    ))
    render("arch", (-2.0, 46.0, 9.0), (math.radians(85), 0.0, math.radians(184)), 40.0, -0.30)

    # -- Panel 2: the rift at dusk. -----------------------------------------
    background.inputs["Color"].default_value = (0.055, 0.070, 0.115, 1.0)
    background.inputs["Strength"].default_value = 0.75
    sun.data.energy = 0.55
    sun.data.color = (0.55, 0.62, 1.0)
    sun.rotation_euler = (math.radians(72), 0.0, math.radians(20))
    proxy.location = (9.0, 5.0, 0.875)
    place((
        ("RaidRiftShard-0", 0.0, 0.0, 0.4),
        ("RaidRiftVent-0", -9.5, 2.5, 1.1),
        ("RaidRuinColumn-0", 6.0, 9.0, 1.4),
    ))
    render("rift", (-2.0, -17.0, 4.2), (math.radians(82), 0.0, 0.0), 32.0, 0.15)

    # -- Panel 3: the amphitheatre from the air. -----------------------------
    background.inputs["Color"].default_value = (0.45, 0.56, 0.72, 1.0)
    background.inputs["Strength"].default_value = 0.65
    sun.data.energy = 3.2
    sun.data.color = (1.0, 0.90, 0.76)
    sun.rotation_euler = (math.radians(52), 0.0, math.radians(-52))
    proxy.location = (0.0, -2.0, 0.875)
    place((
        ("RaidAmphitheatre-0", 0.0, 0.0, math.radians(138.0)),
        ("RaidRuinArch-0", 54.0, -18.0, 0.9),
        ("RaidRiftShard-0", -46.0, 26.0, 0.0),
    ))
    render("amphi", (14.0, -132.0, 41.0), (math.radians(73), 0.0, math.radians(6)), 46.0, -0.35)

    # -- Panel 4: the ring from the driver's seat, on the dune side. ---------
    proxy.location = (40.0, -68.0, 0.875)
    proxy.rotation_euler = (0.0, 0.0, math.radians(24))
    place((
        ("RaidAmphitheatre-0", 0.0, 0.0, math.radians(138.0)),
        ("RaidRuinColumn-0", 44.0, -34.0, 0.8),
    ))
    render("ground", (58.0, -98.0, 2.2), (math.radians(90), 0.0, math.radians(29)), 34.0, -0.30)

    stack(panels, PREVIEW)
    for path in panels:
        path.unlink(missing_ok=True)
    print(f"Wrote {PREVIEW}")

    if failures:
        for failure in failures:
            print(f"[ruin-qa] FAIL {failure}")
        raise SystemExit("ruin preview checks failed")
    print("[ruin-qa] all checks passed")


if __name__ == "__main__":
    main()
