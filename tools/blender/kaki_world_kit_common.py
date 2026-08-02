"""Deterministic clean-room builders for Kaki Rally world-liveness kits.

This module deliberately consumes no third-party geometry or textures.  The
focused ``build-kaki-*.py`` entry points below provide kit specifications; this
file supplies a compact, repeatable construction vocabulary and the production
export checks shared by every kit.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for blocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
        bpy.data.images,
    ):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "BLENDER_EEVEE"


def make_material(name, color, roughness=0.68, metallic=0.05, emission=None):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (*color, 1.0)
    material["source"] = "Original Kaki Rally procedural PBR palette"
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = 0.08
        bsdf.inputs["Coat Roughness"].default_value = 0.45
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 2.2
    return material


def palette():
    return {
        "cream": make_material("KR_MAT_FACILITY_CREAM", (0.78, 0.73, 0.61), 0.72),
        "warm": make_material("KR_MAT_WARM_GRAY", (0.32, 0.34, 0.32), 0.76, 0.08),
        "dark": make_material("KR_MAT_DARK_STRUCTURE", (0.075, 0.095, 0.10), 0.58, 0.32),
        "steel": make_material("KR_MAT_WEATHERED_STEEL", (0.27, 0.31, 0.31), 0.49, 0.68),
        "mint": make_material("KR_MAT_KAKI_TECH_MINT", (0.15, 0.65, 0.55), 0.42, 0.18),
        "coral": make_material("KR_MAT_KAKI_EVENT_CORAL", (0.86, 0.22, 0.13), 0.48, 0.12),
        "amber": make_material("KR_MAT_KAKI_EVENT_AMBER", (1.0, 0.54, 0.08), 0.46, 0.08),
        "safety": make_material("KR_MAT_SAFETY_ORANGE", (0.95, 0.20, 0.035), 0.43, 0.10),
        "white": make_material("KR_MAT_EDGE_CREAM", (0.92, 0.87, 0.71), 0.62, 0.04),
        "concrete": make_material("KR_MAT_READABLE_CONCRETE", (0.47, 0.47, 0.42), 0.91),
        "clay": make_material("KR_MAT_THUNDER_CLAY", (0.47, 0.20, 0.075), 0.94),
        "timber": make_material("KR_MAT_WEATHERED_TIMBER", (0.37, 0.20, 0.075), 0.84),
        "brick": make_material("KR_MAT_KILN_BRICK", (0.45, 0.17, 0.085), 0.88),
        "glass": make_material("KR_MAT_TEST_LAB_GLASS", (0.11, 0.34, 0.36), 0.25, 0.35),
        "sand": make_material("KR_MAT_DESERT_STRUCTURE", (0.61, 0.43, 0.22), 0.89),
        "rubber": make_material("KR_MAT_EVENT_RUBBER", (0.025, 0.03, 0.028), 0.93),
        "emissive": make_material(
            "KR_MAT_EVENT_EMISSIVE", (0.16, 0.72, 0.62), 0.34, 0.15, (0.16, 0.72, 0.62)
        ),
        "lamp": make_material(
            "KR_MAT_WARM_LAMP", (1.0, 0.63, 0.23), 0.28, 0.06, (1.0, 0.45, 0.12)
        ),
        "collision": make_material("KR_MAT_COLLISION_PROXY", (0.025, 0.03, 0.035), 1.0),
    }


def empty(name, parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


def finish_mesh(obj, bevel=0.06):
    if bevel > 0:
        modifier = obj.modifiers.new("Kaki softened production edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        modifier.angle_limit = math.radians(30)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
    obj["original_clean_room_geometry"] = True
    obj["units"] = "meters"
    return obj


def box(parent, name, size, location=(0, 0, 0), mat=None, bevel=0.06, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] * 0.5, size[1] * 0.5, size[2] * 0.5)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = parent
    if mat:
        obj.data.materials.append(mat)
    return finish_mesh(obj, min(bevel, min(size) * 0.18))


def cylinder(parent, name, radius, depth, location=(0, 0, 0), mat=None, vertices=12, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=max(6, vertices), radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    if mat:
        obj.data.materials.append(mat)
    return finish_mesh(obj, min(0.045, radius * 0.18))


def cone(parent, name, radius1, radius2, depth, location=(0, 0, 0), mat=None, vertices=12):
    bpy.ops.mesh.primitive_cone_add(
        vertices=max(6, vertices), radius1=radius1, radius2=radius2, depth=depth, location=location
    )
    obj = bpy.context.object
    obj.name = name
    obj.parent = parent
    if mat:
        obj.data.materials.append(mat)
    return finish_mesh(obj, min(0.035, radius1 * 0.15))


def beam(parent, name, a, b, width, mat):
    start = Vector(a)
    end = Vector(b)
    delta = end - start
    obj = box(parent, name, (width, width, delta.length), (start + end) * 0.5, mat, width * 0.22)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    return obj


def paw_badge(parent, prefix, location, scale, mat):
    x, y, z = location
    cylinder(parent, f"{prefix}_Pad", scale * 0.34, scale * 0.16, (x, y, z), mat, 10, (math.pi / 2, 0, 0))
    for index, dx in enumerate((-0.28, -0.09, 0.12, 0.31)):
        cylinder(
            parent,
            f"{prefix}_Toe_{index}",
            scale * 0.12,
            scale * 0.18,
            (x + dx * scale, y, z + scale * (0.34 + (index % 2) * 0.08)),
            mat,
            8,
            (math.pi / 2, 0, 0),
        )


def railing(parent, prefix, length, y, z, mat, posts=5):
    beam(parent, f"{prefix}_Top", (-length / 2, y, z), (length / 2, y, z), 0.075, mat)
    for index in range(posts):
        x = -length / 2 + length * index / max(1, posts - 1)
        beam(parent, f"{prefix}_Post_{index}", (x, y, z - 0.85), (x, y, z), 0.065, mat)


def truss(parent, prefix, width, height, y, mat, detail=1):
    beam(parent, f"{prefix}_L", (-width / 2, y, 0), (-width / 2, y, height), 0.12, mat)
    beam(parent, f"{prefix}_R", (width / 2, y, 0), (width / 2, y, height), 0.12, mat)
    beam(parent, f"{prefix}_Top", (-width / 2, y, height), (width / 2, y, height), 0.12, mat)
    if detail:
        beam(parent, f"{prefix}_BraceL", (-width / 2, y, height * 0.25), (width / 2, y, height * 0.75), 0.055, mat)
        beam(parent, f"{prefix}_BraceR", (width / 2, y, height * 0.25), (-width / 2, y, height * 0.75), 0.055, mat)


def socket(parent, name, location):
    marker = empty(name, parent)
    marker.location = location
    marker["socket"] = True
    return marker


def build_module(root, archetype, lod, size, mats, accent="mint"):
    """Build one readable module.  Detail is explicitly reduced per LOD."""
    w, d, h = size
    detail = 2 if lod == 0 else 1 if lod == 1 else 0
    structural = mats["dark"]
    accent_mat = mats.get(accent, mats["mint"])

    if archetype in {"shed", "warehouse", "office", "restroom", "guardhouse"}:
        wall = mats["brick"] if archetype == "warehouse" else mats["cream"]
        box(root, "Shell", (w, d, h * 0.72), (0, 0, h * 0.36), wall, 0.12)
        box(root, "Foundation", (w + 0.45, d + 0.45, 0.24), (0, 0, 0.12), mats["concrete"], 0.04)
        roof_z = h * 0.75
        box(root, "Roof", (w + 0.4, d + 0.35, 0.22), (0, 0, roof_z), structural, 0.08)
        box(root, "Door", (w * 0.34, 0.12, h * 0.48), (0, -d * 0.505, h * 0.25), accent_mat, 0.04)
        if detail:
            for side in (-1, 1):
                box(root, f"Window_{side}", (w * 0.16, 0.10, h * 0.18), (side * w * 0.31, -d * 0.51, h * 0.48), mats["glass"], 0.025)
            box(root, "Fascia", (w * 0.72, 0.15, h * 0.16), (0, -d * 0.53, h * 0.68), accent_mat, 0.035)
        if detail == 2:
            cylinder(root, "RoofVent", w * 0.07, h * 0.25, (w * 0.28, 0, h * 0.91), mats["steel"], 10)
            paw_badge(root, "KakiBadge", (0, -d * 0.62, h * 0.68), min(w, h) * 0.26, mats["white"])
        socket(root, f"{root.name}_SOCKET_LAMP", (0, -d * 0.62, h * 0.68))
        return

    if archetype in {"grandstand", "stand"}:
        levels = 5 if detail == 2 else 3 if detail == 1 else 2
        for index in range(levels):
            depth = d / levels
            box(root, f"Riser_{index}", (w, depth, h * (index + 1) / levels), (0, -d / 2 + depth * (index + 0.5), h * (index + 1) / levels * 0.5), mats["concrete"], 0.035)
            if detail:
                seat_count = 9 if detail == 2 else 5
                for seat in range(seat_count):
                    x = -w * 0.44 + w * 0.88 * seat / max(1, seat_count - 1)
                    box(root, f"Seat_{index}_{seat}", (w * 0.065, depth * 0.35, h * 0.06), (x, -d / 2 + depth * (index + 0.55), h * (index + 1) / levels + 0.08), accent_mat if (seat + index) % 3 == 0 else mats["warm"], 0.025)
        for side in (-1, 1):
            truss(root, f"StandFrame_{side}", d * 0.75, h * 1.08, side * w * 0.46, structural, detail)
        if detail == 2:
            box(root, "Canopy", (w + 0.4, d * 0.82, 0.22), (0, d * 0.04, h * 1.12), mats["cream"], 0.08, (0.08, 0, 0))
        railing(root, "FrontRail", w, -d * 0.53, h * 0.72, mats["safety"], 7 if detail else 3)
        return

    if archetype in {"scoreboard", "sign", "timing"}:
        for side in (-1, 1):
            beam(root, f"Leg_{side}", (side * w * 0.33, 0, 0), (side * w * 0.33, 0, h * 0.62), 0.16, structural)
        box(root, "DisplayHousing", (w, d, h * 0.42), (0, 0, h * 0.76), structural, 0.12)
        box(root, "Display", (w * 0.86, d * 0.2, h * 0.27), (0, -d * 0.58, h * 0.77), mats["emissive"], 0.04)
        if detail:
            paw_badge(root, "DisplayBadge", (0, -d * 0.7, h * 0.77), h * 0.22, accent_mat)
        socket(root, f"{root.name}_SOCKET_DISPLAY", (0, -d * 0.7, h * 0.77))
        return

    if archetype in {"light", "radio", "tower"}:
        segments = 4 if detail == 2 else 3 if detail == 1 else 1
        for level in range(segments):
            z0 = h * level / segments
            z1 = h * (level + 1) / segments
            span0 = w * (0.38 - level * 0.035)
            span1 = w * (0.38 - (level + 1) * 0.035)
            for side in (-1, 1):
                beam(root, f"Mast_{level}_{side}", (side * span0, 0, z0), (side * span1, 0, z1), 0.11, structural)
            if detail:
                beam(root, f"Cross_{level}", (-span1, 0, z1), (span1, 0, z1), 0.065, structural)
        box(root, "Base", (w, d, 0.25), (0, 0, 0.125), mats["concrete"], 0.035)
        if archetype == "light":
            lamps = 5 if detail == 2 else 3 if detail == 1 else 1
            for index in range(lamps):
                x = -w * 0.42 + w * 0.84 * index / max(1, lamps - 1)
                box(root, f"Lamp_{index}", (w * 0.13, d * 0.55, h * 0.055), (x, -d * 0.08, h), mats["lamp"], 0.035, (0.22, 0, 0))
            socket(root, f"{root.name}_SOCKET_LAMP", (0, 0, h))
        else:
            cylinder(root, "Antenna", w * 0.055, h * 0.28, (0, 0, h * 1.1), mats["mint"], 8)
        return

    if archetype in {"fence", "guardrail", "barrier", "pitwall"}:
        if archetype in {"barrier", "pitwall"}:
            box(root, "BarrierBody", (w, d, h * 0.72), (0, 0, h * 0.36), mats["concrete"], 0.12)
            stripe_count = 5 if detail else 3
            for index in range(stripe_count):
                x = -w * 0.4 + w * 0.8 * index / max(1, stripe_count - 1)
                box(root, f"HazardStripe_{index}", (w * 0.08, d * 1.05, h * 0.12), (x, 0, h * 0.62), accent_mat if index % 2 else mats["white"], 0.025)
        elif archetype == "guardrail":
            for side in (-1, 1):
                beam(root, f"Rail_{side}", (-w / 2, 0, h * (0.48 + side * 0.16)), (w / 2, 0, h * (0.48 + side * 0.16)), h * 0.12, mats["steel"])
            for index in range(5 if detail else 3):
                x = -w * 0.46 + w * 0.92 * index / (4 if detail else 2)
                beam(root, f"Post_{index}", (x, 0, 0), (x, 0, h * 0.82), h * 0.1, structural)
        else:
            railing(root, "Fence", w, 0, h, mats["steel"], 7 if detail == 2 else 4)
            if detail:
                rows = 3 if detail == 2 else 2
                for row in range(rows):
                    z = h * (0.2 + row * 0.26)
                    beam(root, f"MeshBand_{row}", (-w / 2, 0, z), (w / 2, 0, z), 0.028, mats["steel"])
        return

    if archetype in {"canopy", "tent", "solar"}:
        roof_mat = mats["glass"] if archetype == "solar" else accent_mat
        for x in (-w * 0.44, w * 0.44):
            for y in (-d * 0.42, d * 0.42):
                beam(root, f"Leg_{x}_{y}", (x, y, 0), (x, y, h * 0.84), 0.10, structural)
        box(root, "Roof", (w, d, h * 0.11), (0, 0, h * 0.9), roof_mat, 0.08, (0.04 if archetype == "solar" else 0, 0, 0))
        if archetype == "tent" and detail:
            box(root, "RearFabric", (w, 0.08, h * 0.58), (0, d * 0.44, h * 0.42), mats["cream"], 0.02)
        if archetype == "solar" and detail:
            panels = 4 if detail == 2 else 2
            for index in range(panels):
                x = -w * 0.38 + w * 0.76 * index / max(1, panels - 1)
                box(root, f"PanelLine_{index}", (0.035, d * 0.94, h * 0.12), (x, 0, h * 0.92), mats["mint"], 0.012)
        socket(root, f"{root.name}_SOCKET_FLAG", (0, 0, h))
        return

    if archetype in {"tank", "silo"}:
        radius = min(w, d) * 0.42
        cylinder(root, "TankBody", radius, h * 0.72, (0, 0, h * 0.42), mats["sand"] if archetype == "tank" else mats["steel"], 18 if detail == 2 else 10)
        cone(root, "TankCap", radius * 1.02, radius * 0.18, h * 0.22, (0, 0, h * 0.88), accent_mat, 18 if detail == 2 else 10)
        if detail:
            for index in range(5):
                z = h * (0.15 + index * 0.14)
                beam(root, f"Ladder_{index}", (radius * 1.02, -0.2, z), (radius * 1.02, 0.2, z), 0.035, structural)
            beam(root, "LadderL", (radius * 1.02, -0.22, h * 0.1), (radius * 1.02, -0.22, h * 0.83), 0.035, structural)
            beam(root, "LadderR", (radius * 1.02, 0.22, h * 0.1), (radius * 1.02, 0.22, h * 0.83), 0.035, structural)
        return

    if archetype in {"pipe", "culvert"}:
        count = 3 if detail == 2 else 2 if detail == 1 else 1
        radius = min(h, d) * 0.28
        for index in range(count):
            y = (index - (count - 1) / 2) * radius * 2.3
            cylinder(root, f"Pipe_{index}", radius, w, (0, y, radius), mats["concrete"] if archetype == "culvert" else mats["steel"], 20 if detail == 2 else 10, (0, math.pi / 2, 0))
            if archetype == "pipe" and detail:
                cylinder(root, f"PipeBand_{index}", radius * 1.08, w * 0.05, (0, y, radius), accent_mat, 16, (0, math.pi / 2, 0))
        return

    if archetype in {"stairs", "platform", "catwalk", "bridge", "ramp", "scaffold"}:
        deck_z = h * (0.62 if archetype != "ramp" else 0.44)
        box(root, "Deck", (w, d, h * 0.12), (0, 0, deck_z), mats["steel"], 0.055)
        supports = 4 if detail else 2
        for index in range(supports):
            x = -w * 0.42 + w * 0.84 * index / max(1, supports - 1)
            beam(root, f"Support_{index}", (x, 0, 0), (x, 0, deck_z), 0.12, structural)
        if archetype in {"stairs", "ramp"}:
            steps = 7 if detail == 2 else 4 if detail == 1 else 2
            for index in range(steps):
                box(root, f"Step_{index}", (w / steps * 1.06, d, h * 0.08), (-w / 2 + w * (index + 0.5) / steps, 0, deck_z * (index + 1) / steps), mats["steel"], 0.025)
        if archetype != "ramp":
            railing(root, "RailFront", w, -d * 0.48, deck_z + h * 0.35, mats["safety"], 6 if detail else 3)
            railing(root, "RailBack", w, d * 0.48, deck_z + h * 0.35, mats["safety"], 6 if detail else 3)
        return

    if archetype in {"gate", "arch", "tunnel"}:
        for side in (-1, 1):
            box(root, f"Pier_{side}", (w * 0.16, d, h), (side * w * 0.42, 0, h * 0.5), mats["concrete"] if archetype == "tunnel" else structural, 0.10)
        box(root, "Header", (w, d, h * 0.20), (0, 0, h * 0.9), accent_mat, 0.10)
        if detail:
            paw_badge(root, "HeaderBadge", (0, -d * 0.56, h * 0.9), h * 0.22, mats["white"])
        socket(root, f"{root.name}_SOCKET_LIGHT", (0, -d * 0.56, h * 0.9))
        return

    if archetype in {"props", "utility", "dumpster", "tool", "marshal"}:
        box(root, "Body", (w, d, h * 0.72), (0, 0, h * 0.36), accent_mat if archetype in {"utility", "tool"} else mats["warm"], 0.10)
        box(root, "Top", (w * 1.04, d * 1.04, h * 0.12), (0, 0, h * 0.77), structural, 0.04)
        if detail:
            box(root, "Panel", (w * 0.55, d * 0.08, h * 0.30), (0, -d * 0.53, h * 0.42), mats["cream"], 0.025)
            for index in range(3):
                cylinder(root, f"Control_{index}", w * 0.035, d * 0.10, (-w * 0.16 + index * w * 0.16, -d * 0.59, h * 0.47), mats["lamp"] if index == 1 else mats["safety"], 8, (math.pi / 2, 0, 0))
        return

    if archetype in {"cone", "flag", "windsock"}:
        box(root, "Base", (w, d, h * 0.08), (0, 0, h * 0.04), mats["rubber"], 0.035)
        if archetype == "cone":
            cone(root, "Cone", w * 0.28, w * 0.07, h * 0.82, (0, 0, h * 0.47), mats["safety"], 12 if detail else 8)
            box(root, "ReflectiveBand", (w * 0.42, d * 0.42, h * 0.08), (0, 0, h * 0.48), mats["white"], 0.025)
        else:
            beam(root, "Pole", (0, 0, h * 0.05), (0, 0, h), w * 0.07, structural)
            if archetype == "flag":
                box(root, "Fabric", (w * 0.8, d * 0.10, h * 0.30), (w * 0.4, 0, h * 0.81), accent_mat, 0.025)
            else:
                cone(root, "Sock", w * 0.38, w * 0.10, w * 1.25, (w * 0.55, 0, h * 0.86), mats["amber"], 10)
                bpy.context.object.rotation_euler[1] = math.pi / 2
            socket(root, f"{root.name}_SOCKET_WIND", (0, 0, h))
        return

    # Safe generic fallback is deliberately dressed, beveled utility furniture,
    # never an untextured developer primitive.
    box(root, "Body", (w, d, h * 0.66), (0, 0, h * 0.33), mats["cream"], 0.10)
    box(root, "Accent", (w * 0.82, d * 1.04, h * 0.16), (0, 0, h * 0.57), accent_mat, 0.04)
    if detail:
        paw_badge(root, "KakiBadge", (0, -d * 0.56, h * 0.57), min(w, h) * 0.28, mats["white"])


def consolidate_by_material(root):
    meshes = [child for child in root.children if child.type == "MESH"]
    grouped = {}
    for obj in meshes:
        key = obj.data.materials[0].name if obj.data.materials else "none"
        grouped.setdefault(key, []).append(obj)
    for material_name, objects in grouped.items():
        if len(objects) < 2:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        joined = bpy.context.object
        joined.name = f"{root.name}_{material_name}"
        joined.parent = root
        joined.select_set(False)


def make_family(kit_code, item, mats, scene_root):
    asset_code = item["name"].upper()
    family = empty(f"KR_{kit_code}_{asset_code}", scene_root)
    family["kaki_asset_family"] = True
    family["source"] = "Original clean-room Blender construction; no third-party geometry or texture"
    family["functional_category"] = item.get("category", item["archetype"])
    family["unit_scale_meters"] = 1.0
    family["runtime_presentation_only"] = True
    family["animated"] = bool(item.get("animated"))
    size = tuple(item.get("size", (4.0, 2.0, 3.0)))
    accent = item.get("accent", "mint")
    for lod in range(3):
        lod_root = empty(f"KR_{kit_code}_{asset_code}_LOD{lod}", family)
        lod_root["lod"] = lod
        lod_root["recommended_distance"] = (0, 95, 220)[lod]
        build_module(lod_root, item["archetype"], lod, size, mats, accent)
        consolidate_by_material(lod_root)
    collider = empty(f"KR_{kit_code}_{asset_code}_COL", family)
    collider["collision_proxy"] = True
    collider["presentation_only"] = True
    proxy_size = tuple(item.get("collision", (size[0] * 0.9, size[1] * 0.9, size[2] * 0.65)))
    proxy = box(collider, f"KR_{kit_code}_{asset_code}_COL_PROXY", proxy_size, (0, 0, proxy_size[2] * 0.5), mats["collision"], 0)
    proxy["collision_proxy"] = True
    socket(family, f"KR_{kit_code}_{asset_code}_SOCKET_ORIGIN", (0, 0, 0))


def triangle_count(root):
    count = 0
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        mesh.calc_loop_triangles()
        count += len(mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return count


def build_kit(*, kit_code, output_relative, blend_relative, items, builder_name):
    reset_scene()
    mats = palette()
    scene_root = empty(f"KR_{kit_code}_KIT")
    scene_root["builder"] = builder_name
    scene_root["rights"] = "GREEN_ORIGINAL_CLEAN_ROOM"
    scene_root["license"] = "Project-owned original asset"
    scene_root["source_imports"] = 0
    for item in items:
        make_family(kit_code, item, mats, scene_root)
    assert not bpy.data.cameras and not bpy.data.lights
    expected = {
        f"KR_{kit_code}_{item['name'].upper()}_LOD{lod}"
        for item in items
        for lod in range(3)
    }
    expected.update(f"KR_{kit_code}_{item['name'].upper()}_COL" for item in items)
    missing = sorted(expected.difference(bpy.data.objects.keys()))
    if missing:
        raise RuntimeError(f"missing required runtime nodes: {missing}")

    output = REPO / output_relative
    blend = REPO / blend_relative
    output.parent.mkdir(parents=True, exist_ok=True)
    blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene["kaki_original_asset"] = True
    bpy.context.scene["source_paths"] = "none"
    bpy.context.scene["staging_paths"] = "none"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_tangents=False,
        export_attributes=False,
        export_skins=False,
        export_animations=False,
        export_morph=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )
    report = {
        "builder": builder_name,
        "kit": kit_code,
        "families": len(items),
        "lodNodes": len(items) * 3,
        "collisionNodes": len(items),
        "trianglesAllExportedLods": triangle_count(scene_root),
        "sourceImports": 0,
        "output": str(output.relative_to(REPO)),
        "blend": str(blend.relative_to(REPO)),
        "bytes": output.stat().st_size,
    }
    print(json.dumps(report, sort_keys=True))
    return report
