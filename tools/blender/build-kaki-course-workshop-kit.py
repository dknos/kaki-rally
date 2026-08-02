#!/usr/bin/env python3
"""Build the original Kaki Course Workshop modular production kit.

The file is intentionally generated from repeatable authored construction
rules. Every exported palette root is beveled, shaded, detailed, and uses the
same compact material/decal family. No external model source is consumed.
"""

import math
import os
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "assets/racing/workshop/kaki-course-workshop-kit-v1.glb"
THUMBNAIL = ROOT / "assets/racing/workshop/kaki-course-feature-thumbnails-v1.png"
TEMP = ROOT / "assets/racing/workshop/.thumb-temp"
DECAL = ROOT / "assets/racing/kaki-rally-decal-atlas-imagegen-v1.webp"
FEATURE_NAMES = [
    "feature_small_kicker", "feature_large_launch", "feature_tabletop", "feature_double_jump",
    "feature_rollers", "feature_step_up", "feature_step_down", "feature_boost_pad",
    "feature_repair_bay", "feature_checkpoint_gate", "feature_speed_trap", "feature_drift_zone",
    "feature_jump_gate", "feature_crown_ring", "feature_landing_zone", "feature_turbo_gate",
    "feature_mud_patch", "feature_gravel", "feature_ice", "feature_oil", "feature_water",
    "feature_rumble", "feature_cone_chicane", "feature_barrier_chicane", "feature_tire_wall",
    "feature_crates", "feature_hay_bales", "feature_barrels", "feature_rocks", "feature_toy_cars",
    "feature_delivery_cart", "feature_crown_targets", "feature_smash_chain",
    "feature_direction_signs", "feature_billboard", "feature_floodlights", "feature_crowd",
    "feature_grandstand", "feature_foliage", "feature_flags", "feature_construction",
    "feature_landmark",
]
BRIDGE_MODULE_NAMES = [
    "bridge_deck_module",
    "bridge_guardrail_module",
    "bridge_support_standard",
    "bridge_support_tall",
    "bridge_support_huge",
    "bridge_portal_standard",
    "bridge_portal_tall",
    "bridge_portal_huge",
]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Materials are constructed at module import so helpers can share them.
    # Keep those live while clearing any objects/datablocks from the startup
    # scene or a prior interactive run of this script.
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, roughness=.55, metallic=.08, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = .16
        bsdf.inputs["Coat Roughness"].default_value = .38
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 2.1
    return mat


def decal_material(name, frame):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    image = nodes.new("ShaderNodeTexImage")
    image.image = bpy.data.images.get(DECAL.name) or bpy.data.images.load(str(DECAL), check_existing=True)
    image.interpolation = "Linear"
    links.new(image.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(image.outputs["Alpha"], bsdf.inputs["Alpha"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = .58
    mat.surface_render_method = "DITHERED"
    mat["atlas_frame"] = int(frame)
    return mat


PAINT = material("variant_paint", (.88, .31, .16), .45, .28)
TRIM = material("variant_trim", (1.0, .67, .18), .42, .18)
STRUCTURE = material("variant_structure", (.20, .25, .25), .62, .42)
EMISSIVE = material("variant_emissive", (.2, .9, .75), .3, .18, (.2, .9, .75))
ROAD = material("workshop_rubberized_road", (.105, .115, .11), .88, .02)
WOOD = material("workshop_laminated_wood", (.47, .25, .105), .78, .01)
WOOD_LIGHT = material("workshop_wood_edge", (.74, .45, .19), .7, .01)
HAY = material("workshop_hay", (.83, .56, .13), .95, 0)
ROPE = material("workshop_rope", (.37, .22, .09), .92, 0)
RUBBER = material("workshop_rubber", (.035, .04, .045), .93, 0)
STONE = material("workshop_stone", (.32, .37, .34), .94, 0)
MUD = material("workshop_mud", (.21, .105, .045), .9, 0)
GRAVEL = material("workshop_gravel", (.44, .4, .31), .96, 0)
ICE = material("workshop_ice", (.45, .8, .9), .22, .04)
OIL = material("workshop_oil", (.035, .025, .055), .12, .15)
WATER = material("workshop_water", (.1, .55, .72), .18, .04)
FOLIAGE = material("workshop_foliage", (.18, .48, .24), .82, 0)
FOLIAGE_LIGHT = material("workshop_foliage_light", (.38, .67, .27), .78, 0)
WHITE = material("workshop_chalk", (.91, .87, .68), .68, .02)
PINK = material("workshop_kaki_pink", (.94, .25, .52), .48, .04)
DECALS = [decal_material(f"workshop_decal_{index:02d}", index) for index in range(16)]
ROOTS = []
MODULE_ROOTS = []


def parent_to(obj, root):
    obj.parent = root
    return obj


def empty(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    ROOTS.append(root)
    return root


def module_empty(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    MODULE_ROOTS.append(root)
    return root


def apply_bevel(obj, width=.08, segments=2):
    if not obj.data or not isinstance(obj.data, bpy.types.Mesh):
        return obj
    modifier = obj.modifiers.new("hand-softened edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(28)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.select_set(False)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    return obj


def box(root, name, size, location=(0, 0, 0), mat=STRUCTURE, bevel=.08, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] * .5, size[1] * .5, size[2] * .5)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    apply_bevel(obj, min(bevel, min(size) * .22), 2)
    obj.data.materials.append(mat)
    return parent_to(obj, root)


def cylinder(root, name, radius, depth, location=(0, 0, 0), mat=STRUCTURE, vertices=16, rotation=(0, 0, 0), bevel=.04):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    apply_bevel(obj, min(bevel, radius * .25), 2)
    obj.data.materials.append(mat)
    return parent_to(obj, root)


def sphere(root, name, radius, location=(0, 0, 0), mat=STRUCTURE, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return parent_to(obj, root)


def torus(root, name, major, minor, location=(0, 0, 0), mat=RUBBER, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=16, minor_segments=8,
        location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return parent_to(obj, root)


def beam_between(root, name, a, b, radius=.055, mat=TRIM):
    a = Vector(a)
    b = Vector(b)
    delta = b - a
    length = delta.length
    obj = cylinder(root, name, radius, length, (a + b) * .5, mat, 10, bevel=.018)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(delta.normalized())
    return obj


def custom_mesh(root, name, vertices, faces, mat=PAINT, bevel=0):
    mesh = bpy.data.meshes.new(f"{name}_mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    parent_to(obj, root)
    if bevel:
        apply_bevel(obj, bevel, 2)
    return obj


def badge(root, name, frame, location=(0, 0, 0), size=(1.2, 1.2), rotation=(math.pi / 2, 0, 0)):
    # UVs select one 4x4 cell from the shared decal atlas.
    bpy.ops.mesh.primitive_plane_add(size=2, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0] * .5, size[1] * .5, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(DECALS[frame % 16])
    column = frame % 4
    row = 3 - (frame // 4)
    u0, v0 = column / 4 + .012, row / 4 + .012
    u1, v1 = (column + 1) / 4 - .012, (row + 1) / 4 - .012
    uv = obj.data.uv_layers.active.data
    coords = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    for loop in obj.data.loops:
        uv[loop.index].uv = coords[loop.vertex_index]
    return parent_to(obj, root)


def surface_profile(kind, t, height):
    t = max(0, min(1, t))
    smooth = lambda v: v * v * (3 - 2 * v)
    if kind in ("kicker", "launch"):
        return height * (t ** 1.65), True
    if kind == "tabletop":
        if t < .3:
            return height * smooth(t / .3), True
        if t <= .67:
            return height, True
        return height * (1 - smooth((t - .67) / .33)), True
    if kind == "double":
        if t < .31:
            return height * ((t / .31) ** 1.65), True
        if t < .66:
            return 0, False
        return height * (1 - smooth((t - .66) / .34)), True
    if kind == "rollers":
        return height * (math.sin(t * math.pi * 4) ** 2), True
    if kind == "step-up":
        if t < .42:
            return height * ((t / .42) ** 1.65), True
        if t < .62:
            return height, True
        return height * (1 - smooth((t - .62) / .38)), True
    if kind == "step-down":
        if t < .24:
            return height * smooth(t / .24), True
        if t < .48:
            return height, True
        return height * (1 - smooth((t - .48) / .52)), True
    return 0, True


def ramp(root, kind, width, length, height, badge_frame):
    steps = max(24, int(length * 3))
    runs = []
    current = []
    for index in range(steps + 1):
        t = index / steps
        value, visible = surface_profile(kind, t, height)
        point = (-length * .5 + t * length, value)
        if visible:
            current.append(point)
        elif current:
            runs.append(current)
            current = []
    if current:
        runs.append(current)
    for run_index, run in enumerate(runs):
        verts = []
        faces = []
        for y, z in run:
            verts.extend([(-width * .5, y, z + .055), (width * .5, y, z + .055)])
        for index in range(len(run) - 1):
            start = index * 2
            faces.append((start, start + 1, start + 3, start + 2))
        custom_mesh(root, f"{kind}_grippy_deck_{run_index}", verts, faces, ROAD)
        for side in (-1, 1):
            side_verts = []
            for y, z in run:
                side_verts.extend([(side * width * .5, y, .02), (side * width * .5, y, z)])
            side_faces = []
            for index in range(len(run) - 1):
                start = index * 2
                side_faces.append((start, start + 2, start + 3, start + 1))
            custom_mesh(root, f"{kind}_laminated_side_{run_index}_{side}", side_verts, side_faces, WOOD)
        for index in range(0, len(run) - 1, max(2, len(run) // 7)):
            y, z = run[index]
            box(root, f"{kind}_crossbrace_{run_index}_{index}", (width + .32, .13, .15), (0, y, max(.08, z * .48)), STRUCTURE, .035)
        for side in (-1, 1):
            rail_points = run[::max(1, len(run) // 8)]
            if rail_points[-1] != run[-1]:
                rail_points.append(run[-1])
            for index in range(len(rail_points) - 1):
                a = (side * (width * .5 + .1), rail_points[index][0], rail_points[index][1] + .22)
                b = (side * (width * .5 + .1), rail_points[index + 1][0], rail_points[index + 1][1] + .22)
                beam_between(root, f"{kind}_edge_rail_{side}_{run_index}_{index}", a, b, .065, TRIM)
    badge(root, f"{kind}_kaki_badge", badge_frame, (0, -length * .16, height * .48 + .09), (1.15, 1.15), (math.pi / 2, 0, 0))
    for y in (-length * .32, length * .05):
        for x in (-width * .36, width * .36):
            cylinder(root, f"{kind}_bolt_{x}_{y}", .075, .08, (x, y, .09), WHITE, 12)


def make_ramps():
    specs = [
        ("feature_small_kicker", "kicker", 7.4, 7.2, 1.35, 2),
        ("feature_large_launch", "launch", 8.4, 11.8, 2.85, 8),
        ("feature_tabletop", "tabletop", 8.4, 18, 2.15, 1),
        ("feature_double_jump", "double", 8.2, 20, 2.35, 9),
        ("feature_rollers", "rollers", 8, 16, .72, 7),
        ("feature_step_up", "step-up", 8.2, 15, 2.15, 10),
        ("feature_step_down", "step-down", 8.2, 15, 2.1, 11),
    ]
    for name, kind, width, length, height, frame in specs:
        root = empty(name)
        ramp(root, kind, width, length, height, frame)


def chevron(root, name, y, mat=EMISSIVE, scale=1):
    vertices = [(-.72 * scale, y - .42 * scale, .15), (0, y + .3 * scale, .15),
                (.72 * scale, y - .42 * scale, .15), (.45 * scale, y - .66 * scale, .15),
                (0, y - .18 * scale, .15), (-.45 * scale, y - .66 * scale, .15)]
    return custom_mesh(root, name, vertices, [(0, 1, 2, 3, 4, 5)], mat, .035)


def gate(root, name, width=11, height=5.3, accent=TRIM, frame=5):
    for side in (-1, 1):
        x = side * width * .5
        box(root, f"{name}_post_{side}", (.46, .62, height), (x, 0, height * .5), STRUCTURE, .09)
        box(root, f"{name}_painted_sleeve_{side}", (.68, .82, .8), (x, 0, .55), PAINT, .11)
        cylinder(root, f"{name}_lamp_{side}", .22, .32, (x, -.34, height - .36), EMISSIVE, 12, (math.pi / 2, 0, 0))
    box(root, f"{name}_header", (width + .75, .62, .64), (0, 0, height), accent, .13)
    for x in (-width * .28, width * .28):
        beam_between(root, f"{name}_brace_{x}", (x, 0, height - .32), (x * 1.35, 0, height - 1.45), .075, WHITE)
    badge(root, f"{name}_badge", frame, (0, -.34, height), (1.35, 1.35), (math.pi / 2, 0, 0))


def make_utilities():
    root = empty("feature_boost_pad")
    box(root, "boost_pad_shell", (7.4, 4.4, .18), (0, 0, .09), STRUCTURE, .16)
    for index, x in enumerate((-2.45, -1.22, 0, 1.22, 2.45)):
        box(root, f"boost_energy_strip_{index}", (.48, 3.55, .12), (x, 0, .23), EMISSIVE, .12)
    for y in (-.9, .55):
        chevron(root, f"boost_chevron_{y}", y, TRIM, .72)

    root = empty("feature_repair_bay")
    box(root, "repair_bay_deck", (6.8, 9.5, .16), (0, 0, .08), STRUCTURE, .18)
    for side in (-1, 1):
        box(root, f"repair_bay_rail_{side}", (.28, 8.4, .42), (side * 3.15, 0, .32), PAINT, .08)
    for y in (-3.1, 0, 3.1):
        box(root, f"repair_bay_light_{y}", (5.3, .42, .08), (0, y, .19), EMISSIVE, .08)
    badge(root, "repair_wrench_badge", 4, (0, -.1, .24), (2.1, 2.1), (0, 0, 0))

    for feature, frame in [
        ("feature_checkpoint_gate", 5), ("feature_speed_trap", 7), ("feature_jump_gate", 2),
        ("feature_turbo_gate", 8),
    ]:
        root = empty(feature)
        gate(root, feature, 11.8, 5.3 if feature != "feature_jump_gate" else 5.9, TRIM, frame)

    root = empty("feature_drift_zone")
    for side in (-1, 1):
        box(root, f"drift_zone_edge_{side}", (.24, 18, .12), (side * 4.0, 0, .07), EMISSIVE, .06)
    for y in (-6, 0, 6):
        chevron(root, f"drift_zone_arrow_{y}", y, PINK, .85)

    root = empty("feature_crown_ring")
    torus(root, "crown_jump_ring", 3.2, .23, (0, 0, 4.2), TRIM, (math.pi / 2, 0, 0))
    for angle in (-.55, 0, .55):
        x = math.sin(angle) * 2.2
        z = 6.9 - abs(angle) * .7
        custom_mesh(root, f"crown_point_{angle}", [(x-.42, 0, 6.55), (x, 0, z), (x+.42, 0, 6.55)], [(0, 1, 2)], TRIM, .06)
    for side in (-1, 1):
        box(root, f"ring_support_{side}", (.32, .5, 4.1), (side * 3.3, 0, 2.05), STRUCTURE, .07)
    badge(root, "ring_crown_badge", 1, (0, -.3, 4.2), (1.6, 1.6), (math.pi / 2, 0, 0))

    root = empty("feature_landing_zone")
    box(root, "landing_zone_plate", (8, 10, .12), (0, 0, .06), STRUCTURE, .17)
    for index, radius in enumerate((2.8, 2.05, 1.3)):
        torus(root, f"landing_target_{index}", radius, .11, (0, 0, .15 + index * .01), [PAINT, WHITE, EMISSIVE][index], (0, 0, 0))
    badge(root, "landing_target_badge", 10, (0, 0, .18), (1.2, 1.2), (0, 0, 0))


def blob(root, name, width, length, mat, seed, stones=False):
    rng = random.Random(seed)
    rings = 18
    vertices = [(0, 0, .04)]
    for index in range(rings):
        angle = index / rings * math.tau
        wobble = .86 + rng.random() * .2
        vertices.append((math.cos(angle) * width * .5 * wobble, math.sin(angle) * length * .5 * wobble, .035 + rng.random() * .018))
    faces = []
    for index in range(rings):
        faces.append((0, index + 1, (index + 1) % rings + 1))
    custom_mesh(root, name, vertices, faces, mat, .025)
    if stones:
        for index in range(12):
            angle = rng.random() * math.tau
            radius = math.sqrt(rng.random()) * .4
            sphere(root, f"{name}_detail_{index}", .12 + rng.random() * .12,
                   (math.cos(angle) * width * radius, math.sin(angle) * length * radius, .12), STONE,
                   (1.2, .8, .55))


def cone(root, name, location):
    box(root, f"{name}_foot", (.9, .9, .12), (location[0], location[1], .06), RUBBER, .09)
    bpy.ops.mesh.primitive_cone_add(vertices=16, radius1=.32, radius2=.09, depth=1.05,
                                    location=(location[0], location[1], .62))
    body = bpy.context.object
    body.name = f"{name}_soft_body"
    body.data.materials.append(PAINT)
    parent_to(body, root)
    torus(root, f"{name}_reflective_band", .22, .055, (location[0], location[1], .72), WHITE)


def barrier(root, name, location, rotation=0):
    box(root, f"{name}_body", (3.7, .62, .76), (location[0], location[1], .48), PAINT, .16, (0, 0, rotation))
    for offset in (-1.12, 0, 1.12):
        x = location[0] + math.cos(rotation) * offset
        y = location[1] + math.sin(rotation) * offset
        box(root, f"{name}_stripe_{offset}", (.48, .66, .79), (x, y, .5), WHITE, .07, (0, 0, rotation + .22))
    for side in (-1, 1):
        x = location[0] + math.cos(rotation) * side * 1.62
        y = location[1] + math.sin(rotation) * side * 1.62
        box(root, f"{name}_foot_{side}", (.56, 1.08, .15), (x, y, .075), STRUCTURE, .06, (0, 0, rotation))


def make_hazards():
    for name, mat, seed, detail in [
        ("feature_mud_patch", MUD, 21, False), ("feature_gravel", GRAVEL, 22, True),
        ("feature_ice", ICE, 23, False), ("feature_oil", OIL, 24, False),
        ("feature_water", WATER, 25, False),
    ]:
        root = empty(name)
        blob(root, f"{name}_authored_surface", 7.2 if name != "feature_oil" else 5.5,
             8.5 if name != "feature_oil" else 6.2, mat, seed, detail)
        if name in ("feature_ice", "feature_water"):
            for index in range(6):
                angle = index / 6 * math.tau
                custom_mesh(root, f"{name}_glint_{index}",
                            [(math.cos(angle)*2.2, math.sin(angle)*2.7, .08),
                             (math.cos(angle+.16)*2.7, math.sin(angle+.16)*3.1, .09),
                             (math.cos(angle-.12)*1.7, math.sin(angle-.12)*2.1, .09)],
                            [(0, 1, 2)], WHITE)

    root = empty("feature_rumble")
    for index in range(16):
        box(root, f"rumble_tooth_{index}", (2.2, .52, .15), (0, -4.75 + index * .63, .08),
            PAINT if index % 2 else WHITE, .06)

    root = empty("feature_cone_chicane")
    for index, (x, y) in enumerate([(-2.2, -4.8), (1.8, -3.2), (-1.8, -1.6), (1.8, 0), (-1.8, 1.6), (1.8, 3.2), (-2.2, 4.8)]):
        cone(root, f"chicane_cone_{index}", (x, y))

    root = empty("feature_barrier_chicane")
    barrier(root, "barrier_left", (-1.9, -4.2), .18)
    barrier(root, "barrier_right", (1.9, 0), -.18)
    barrier(root, "barrier_exit", (-1.9, 4.2), .18)

    root = empty("feature_tire_wall")
    for row in range(2):
        for column in range(5):
            torus(root, f"tire_wall_{row}_{column}", .48, .16,
                  ((column - 2) * .94, 0, .52 + row * .82), RUBBER, (math.pi / 2, 0, 0))
    for side in (-1, 1):
        box(root, f"tire_wall_endcap_{side}", (.22, .44, 1.9), (side * 2.55, 0, .95), PAINT, .07)


def crate(root, name, location, scale=1):
    box(root, f"{name}_shell", (1.55*scale, 1.55*scale, 1.55*scale), location, WOOD, .08)
    for z in (-.58, .58):
        box(root, f"{name}_slat_z_{z}", (1.72*scale, .12*scale, .16*scale),
            (location[0], location[1]-.79*scale, location[2]+z*scale), WOOD_LIGHT, .035)
    for diagonal in (-1, 1):
        box(root, f"{name}_cross_{diagonal}", (.16*scale, .1*scale, 1.9*scale),
            (location[0], location[1]-.8*scale, location[2]), WOOD_LIGHT, .025,
            (0, diagonal * .72, 0))


def barrel(root, name, location):
    cylinder(root, f"{name}_drum", .58, 1.55, location, PAINT, 20, bevel=.08)
    for z in (-.58, 0, .58):
        torus(root, f"{name}_band_{z}", .52, .055, (location[0], location[1], location[2]+z), STRUCTURE)
    cylinder(root, f"{name}_cap", .42, .04, (location[0], location[1], location[2]+.795), STRUCTURE, 20)


def wheel(root, name, location, radius=.45):
    torus(root, f"{name}_tire", radius, radius*.22, location, RUBBER, (math.pi/2, 0, 0))
    cylinder(root, f"{name}_hub", radius*.36, .18, location, TRIM, 12, (math.pi/2, 0, 0))


def toy_car(root, name, location, color=PAINT, scale=1):
    x, y, z = location
    box(root, f"{name}_body", (2.1*scale, 3.5*scale, .72*scale), (x, y, z+.72*scale), color, .22)
    box(root, f"{name}_cabin", (1.65*scale, 1.55*scale, .68*scale), (x, y-.15*scale, z+1.3*scale), WHITE, .24)
    box(root, f"{name}_bumper", (2.18*scale, .28*scale, .28*scale), (x, y+1.7*scale, z+.46*scale), STRUCTURE, .07)
    for side in (-1, 1):
        for longitudinal in (-1.05, 1.05):
            wheel(root, f"{name}_wheel_{side}_{longitudinal}",
                  (x+side*1.03*scale, y+longitudinal*scale, z+.45*scale), .42*scale)


def crown(root, name, location, scale=1):
    x, y, z = location
    vertices = [(-1, 0, 0), (-.75, 0, 1.25), (-.22, 0, .62), (0, 0, 1.55),
                (.22, 0, .62), (.75, 0, 1.25), (1, 0, 0)]
    vertices = [(x+a*scale, y+b, z+c*scale) for a,b,c in vertices]
    custom_mesh(root, name, vertices, [(0,1,2,3,4,5,6)], TRIM, .08)


def make_destructibles():
    root = empty("feature_crates")
    crate(root, "crate_a", (-.9, 0, .78), 1)
    crate(root, "crate_b", (.85, .25, .72), .9)
    crate(root, "crate_top", (0, 0, 2.05), .78)
    badge(root, "crate_kaki_stamp", 15, (0, -1.0, 1.05), (.8, .8), (math.pi/2,0,0))

    root = empty("feature_hay_bales")
    for index, (x, z) in enumerate([(-1.55,.62), (0,.62), (1.55,.62), (-.75,1.72), (.8,1.72)]):
        cylinder(root, f"hay_bale_{index}", .72, 1.38, (x, 0, z), HAY, 16, (0, math.pi/2, 0), .07)
        for offset in (-.32, .32):
            torus(root, f"hay_rope_{index}_{offset}", .66, .028, (x+offset, 0, z), ROPE, (0, math.pi/2, 0))

    root = empty("feature_barrels")
    for index, (x,y,z) in enumerate([(-.7,0,.78),(.7,0,.78),(0,.18,2.05)]):
        barrel(root, f"barrel_{index}", (x,y,z))

    root = empty("feature_rocks")
    rng = random.Random(48)
    for index in range(11):
        angle = rng.random()*math.tau
        radius = math.sqrt(rng.random())*2
        sphere(root, f"rock_{index}", .45+rng.random()*.55,
               (math.cos(angle)*radius, math.sin(angle)*radius, .34+rng.random()*.35),
               STONE, (1+rng.random()*.6, .8+rng.random()*.4, .65+rng.random()*.55))

    root = empty("feature_toy_cars")
    toy_car(root, "toy_car_a", (-1.1, -.45, 0), PAINT, .62)
    toy_car(root, "toy_car_b", (1.05, .55, 0), TRIM, .58)

    root = empty("feature_delivery_cart")
    box(root, "cart_bed", (3.4, 4.7, .5), (0, 0, .85), WOOD, .16)
    box(root, "cart_canopy", (3.2, 2.2, .22), (0, -.75, 3.15), PAINT, .18)
    for side in (-1,1):
        for y in (-1.65, 1.65):
            wheel(root, f"cart_wheel_{side}_{y}", (side*1.78, y, .72), .65)
        beam_between(root, f"cart_canopy_post_{side}", (side*1.35,-1.55,1.08), (side*1.35,-1.55,3.08), .09, STRUCTURE)
    crate(root, "cart_crate", (0, .6, 1.5), .7)
    badge(root, "cart_kaki_badge", 15, (0, -2.41, 1.48), (1.25,1.25), (math.pi/2,0,0))

    root = empty("feature_crown_targets")
    for index, x in enumerate((-1.8,0,1.8)):
        box(root, f"crown_target_post_{index}", (.28,.42,2.4), (x,0,1.2), STRUCTURE, .06)
        crown(root, f"crown_target_{index}", (x,-.22,2.05), .82)
        cylinder(root, f"crown_target_base_{index}", .58, .24, (x,0,.12), PAINT, 16)

    root = empty("feature_smash_chain")
    for index in range(5):
        y = -5.6 + index*2.8
        cylinder(root, f"smash_chain_base_{index}", .58, .22, (0,y,.11), PAINT, 16)
        box(root, f"smash_chain_post_{index}", (.24,.36,2.5), (0,y,1.25), STRUCTURE, .06)
        badge(root, f"smash_chain_badge_{index}", (index+1)%16, (0,y-.2,2.5), (1.05,1.05), (math.pi/2,0,0))


def cat_spectator(root, name, location, color):
    x,y,z = location
    sphere(root, f"{name}_head", .31, (x,y,z), color, (1,.9,.92))
    custom_mesh(root, f"{name}_ears",
                [(x-.28,y,z+.18),(x-.17,y,z+.55),(x-.03,y,z+.23),
                 (x+.03,y,z+.23),(x+.17,y,z+.55),(x+.28,y,z+.18)],
                [(0,1,2),(3,4,5)], color, .025)
    sphere(root, f"{name}_body", .4, (x,y,z-.52), color, (.72,.68,1.2))


def tree(root, name, location, scale=1):
    x,y,z=location
    cylinder(root, f"{name}_trunk", .25*scale, 2.8*scale, (x,y,z+1.4*scale), WOOD, 12, bevel=.05)
    for index, (ox,oy,oz,sz) in enumerate([(0,0,3.4,1.35),(-.7,.1,3.0,.9),(.65,-.1,3.05,.95),(0,.15,4.15,.8)]):
        sphere(root, f"{name}_crown_{index}", sz*scale, (x+ox*scale,y+oy*scale,z+oz*scale),
               FOLIAGE if index%2 else FOLIAGE_LIGHT, (1.1,.9,.85))


def make_scenery():
    root = empty("feature_direction_signs")
    for index, (x,y,direction) in enumerate([(-1.4,0,-1),(1.4,.4,1)]):
        box(root, f"sign_post_{index}", (.22,.32,2.8), (x,y,1.4), STRUCTURE, .05)
        vertices = [(x-direction*1.35,y-.12,2.4),(x+direction*.55,y-.12,2.4),
                    (x+direction*1.25,y-.12,3.05),(x+direction*.55,y-.12,3.7),
                    (x-direction*1.35,y-.12,3.7)]
        custom_mesh(root, f"direction_arrow_{index}", vertices, [(0,1,2,3,4)], PAINT, .08)
        badge(root, f"direction_badge_{index}", 5, (x,y-.2,3.05), (.7,.7), (math.pi/2,0,0))

    root = empty("feature_billboard")
    for side in (-1,1):
        box(root, f"billboard_post_{side}", (.34,.48,4.2), (side*3.25,0,2.1), STRUCTURE, .07)
        beam_between(root, f"billboard_brace_{side}", (side*3.25,0,.4), (side*2.2,0,2.2), .09, STRUCTURE)
    box(root, "billboard_frame", (8.4,.44,4.4), (0,0,5.15), PAINT, .18)
    badge(root, "billboard_art", 15, (0,-.24,5.15), (3.75,3.75), (math.pi/2,0,0))
    for x in (-2.7,0,2.7):
        cylinder(root, f"billboard_lamp_{x}", .17,.38,(x,-.4,7.05),EMISSIVE,12,(math.pi/2,0,0))

    root = empty("feature_floodlights")
    for side in (-1,1):
        box(root, f"floodlight_mast_{side}", (.3,.38,7.5),(side*1.65,0,3.75),STRUCTURE,.07)
        box(root, f"floodlight_bar_{side}", (2.5,.36,.28),(side*1.65,0,7.45),PAINT,.07)
        for lamp in (-.75,0,.75):
            box(root, f"floodlight_lamp_{side}_{lamp}", (.58,.24,.42),
                (side*1.65+lamp,-.28,7.3),EMISSIVE,.08,(math.radians(-12),0,0))

    root = empty("feature_crowd")
    box(root, "crowd_safety_barrier", (11.5,.55,1.1),(0,-1.9,.55),PAINT,.15)
    colors=[PAINT,TRIM,PINK,WHITE,FOLIAGE_LIGHT]
    for row in range(2):
        for column in range(9):
            cat_spectator(root,f"crowd_cat_{row}_{column}",
                          ((column-4)*1.1,row*.95,1.7+row*.42),colors[(row*3+column)%len(colors)])
    for x in (-5.25,5.25):
        box(root,f"crowd_flag_post_{x}",(.12,.2,3.6),(x,0,1.8),STRUCTURE,.03)

    root = empty("feature_grandstand")
    for row in range(4):
        box(root,f"grandstand_step_{row}",(14,1.55,.38),(0,row*1.35-2.1,.3+row*.72),STRUCTURE,.08)
        box(root,f"grandstand_seat_{row}",(13.3,.48,.6),(0,row*1.35-2.4,.82+row*.72),PAINT if row%2 else TRIM,.11)
    for x in (-6.4,0,6.4):
        beam_between(root,f"grandstand_leg_{x}",(x,-2.8,.1),(x,2.5,3.2),.13,STRUCTURE)
    for row in range(3):
        for column in range(8):
            cat_spectator(root,f"stand_cat_{row}_{column}",
                          ((column-3.5)*1.45,row*1.34-2.25,1.5+row*.72),
                          [PAINT,TRIM,PINK,WHITE][(row+column)%4])

    root = empty("feature_foliage")
    for index,(x,y,s) in enumerate([(-2.6,-1.8,1.05),(1.8,-1.2,.85),(-.4,1.5,1.2),(3,1.9,.72)]):
        tree(root,f"foliage_tree_{index}",(x,y,0),s)
    for index in range(9):
        angle=index/9*math.tau
        sphere(root,f"foliage_shrub_{index}",.42,(math.cos(angle)*3.6,math.sin(angle)*2.8,.38),
               FOLIAGE_LIGHT if index%2 else FOLIAGE,(1.3,.9,.75))

    root = empty("feature_flags")
    for side in (-1,1):
        x=side*1.7
        cylinder(root,f"flag_pole_{side}",.07,5,(x,0,2.5),STRUCTURE,10)
        vertices=[(x,0,4.8),(x+side*2.0,0,4.62),(x+side*1.75,0,3.45),(x,0,3.65),
                  (x+side*.7,-.12,4.18)]
        custom_mesh(root,f"curved_flag_{side}",vertices,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],
                    PAINT if side<0 else TRIM,.03)
        badge(root,f"flag_badge_{side}",15,(x+side*.85,-.08,4.15),(.75,.75),(math.pi/2,0,0))

    root = empty("feature_construction")
    toy_car(root,"construction_chassis",(0,0,0),TRIM,.85)
    box(root,"excavator_counterweight",(3.0,1.15,2.05),(0,-.4,1.65),PAINT,.25)
    beam_between(root,"excavator_boom",(0,-.4,2.2),(0,-3.8,4.5),.24,TRIM)
    beam_between(root,"excavator_stick",(0,-3.8,4.5),(0,-5.3,1.4),.2,PAINT)
    custom_mesh(root,"excavator_bucket",[(-.75,-5.6,.55),(.75,-5.6,.55),(.62,-4.8,1.4),(-.62,-4.8,1.4)],
                [(0,1,2,3)],STRUCTURE,.12)

    root = empty("feature_landmark")
    for side in (-1,1):
        box(root,f"landmark_tower_{side}",(1.25,1.4,7.4),(side*4.4,0,3.7),STRUCTURE,.22)
        box(root,f"landmark_painted_wrap_{side}",(1.48,1.62,1.6),(side*4.4,0,3.4),PAINT,.2)
    beam_between(root,"landmark_arch_left",(-4.4,0,7.1),(0,0,9.2),.34,TRIM)
    beam_between(root,"landmark_arch_right",(0,0,9.2),(4.4,0,7.1),.34,TRIM)
    crown(root,"landmark_crown",(0,-.2,7.65),1.2)
    badge(root,"landmark_badge",15,(0,-.28,6.1),(2.1,2.1),(math.pi/2,0,0))


def make_bridge_modules():
    """Author the reusable Kaki Skyway structure at a 10.5 m reference width.

    Runtime scales these modules only along their declared structural axes.
    Origins stay on the road centerline (deck/rail/portal) or at terrain level
    (supports), so visible construction and the elevated spline remain aligned.
    """
    reference_width = 10.5

    root = module_empty("bridge_deck_module")
    # A layered laminated deck reads clearly from both the upper and lower
    # routes. Recessed timber slats, steel edge channels, splice plates, and
    # warm marker lamps keep it from becoming a featureless extruded slab.
    box(root, "deck_rubber_bed", (reference_width, 2.45, .16), (0, 0, -.12), ROAD, .055)
    box(root, "deck_laminated_core", (reference_width + .38, 2.45, .28), (0, 0, -.31), WOOD, .07)
    for x in (-4.7, -3.15, -1.58, 0, 1.58, 3.15, 4.7):
        box(root, f"deck_timber_rib_{x}", (1.18, 2.28, .16), (x, 0, -.5), WOOD_LIGHT, .045)
    for side in (-1, 1):
        box(root, f"deck_edge_channel_{side}", (.28, 2.5, .56),
            (side * (reference_width * .5 + .18), 0, -.29), STRUCTURE, .065)
        for y in (-.72, .72):
            box(root, f"deck_splice_{side}_{y}", (.38, .42, .34),
                (side * (reference_width * .5 + .34), y, -.28), PAINT, .055)
            for z in (-.12, -.42):
                cylinder(root, f"deck_bolt_{side}_{y}_{z}", .055, .09,
                         (side * (reference_width * .5 + .54), y, z), WHITE, 10,
                         (0, math.pi / 2, 0), .018)
        cylinder(root, f"deck_underlamp_{side}", .14, .28,
                 (side * reference_width * .31, 0, -.56), EMISSIVE, 12,
                 (math.pi / 2, 0, 0), .025)

    root = module_empty("bridge_guardrail_module")
    for side in (-1, 1):
        x = side * (reference_width * .5 + .18)
        box(root, f"guardrail_kickboard_{side}", (.22, 3.7, .38), (x, 0, .2), PAINT, .055)
        for y in (-1.55, 0, 1.55):
            box(root, f"guardrail_post_{side}_{y}", (.24, .28, 1.28), (x, y, .66), STRUCTURE, .055)
            box(root, f"guardrail_post_cap_{side}_{y}", (.4, .42, .18), (x, y, 1.28), TRIM, .065)
        box(root, f"guardrail_top_{side}", (.22, 3.95, .22), (x, 0, 1.22), TRIM, .07)
        beam_between(root, f"guardrail_brace_a_{side}", (x, -1.52, .3), (x, 0, 1.08), .055, WHITE)
        beam_between(root, f"guardrail_brace_b_{side}", (x, 0, 1.08), (x, 1.52, .3), .055, WHITE)

    support_specs = [
        ("standard", 5.2, .5),
        ("tall", 7.0, .62),
        ("huge", 9.2, .76),
    ]
    for variant, height, heft in support_specs:
        root = module_empty(f"bridge_support_{variant}")
        for side in (-1, 1):
            x = side * 3.72
            box(root, f"{variant}_foot_{side}", (2.0, 1.55, .42), (x, 0, .21), STONE, .17)
            box(root, f"{variant}_shoe_{side}", (1.36, 1.12, .3), (x, 0, .56), PAINT, .1)
            box(root, f"{variant}_column_{side}", (heft, .78, height - .7),
                (x, 0, (height + .42) * .5), STRUCTURE, .12)
            for band in (.29, .67):
                z = height * band
                box(root, f"{variant}_collar_{side}_{band}", (heft + .3, 1.0, .24),
                    (x, 0, z), TRIM, .07)
            cylinder(root, f"{variant}_lamp_{side}", .14, .3,
                     (x, -.52, height - .54), EMISSIVE, 12, (math.pi / 2, 0, 0), .025)
        box(root, f"{variant}_crosshead", (9.1, 1.05, .52), (0, 0, height - .24), WOOD_LIGHT, .13)
        box(root, f"{variant}_steel_cap", (9.55, .88, .24), (0, 0, height + .12), STRUCTURE, .075)
        beam_between(root, f"{variant}_brace_left", (-3.72, 0, 1.05), (0, 0, height - .62), .13, PAINT)
        beam_between(root, f"{variant}_brace_right", (3.72, 0, 1.05), (0, 0, height - .62), .13, PAINT)
        if variant != "standard":
            beam_between(root, f"{variant}_brace_left_high", (-3.72, 0, height - .8), (0, 0, height * .42), .1, WHITE)
            beam_between(root, f"{variant}_brace_right_high", (3.72, 0, height - .8), (0, 0, height * .42), .1, WHITE)
        badge(root, f"{variant}_support_badge", 15, (0, -.58, height - .22), (1.25, 1.25),
              (math.pi / 2, 0, 0))
        root["referenceHeight"] = height
        root["referenceWidth"] = reference_width

    portal_specs = [
        ("standard", 3.65, 0),
        ("tall", 4.05, 5),
        ("huge", 4.45, 15),
    ]
    for variant, height, frame in portal_specs:
        root = module_empty(f"bridge_portal_{variant}")
        for side in (-1, 1):
            x = side * (reference_width * .5 + .72)
            box(root, f"{variant}_portal_foot_{side}", (1.08, 1.18, .25), (x, 0, .125), STONE, .12)
            box(root, f"{variant}_portal_post_{side}", (.52, .66, height),
                (x, 0, height * .5), STRUCTURE, .11)
            box(root, f"{variant}_portal_sleeve_{side}", (.77, .86, .72),
                (x, 0, .62), PAINT, .13)
            box(root, f"{variant}_portal_cap_{side}", (.78, .9, .28),
                (x, 0, height - .08), TRIM, .09)
            cylinder(root, f"{variant}_portal_lamp_{side}", .18, .34,
                     (x, -.48, height - .46), EMISSIVE, 12, (math.pi / 2, 0, 0), .025)
        crown_z = height + (.7 if variant == "huge" else .48)
        beam_between(root, f"{variant}_portal_arch_left",
                     (-reference_width * .5 - .72, 0, height - .02), (0, 0, crown_z), .18, TRIM)
        beam_between(root, f"{variant}_portal_arch_right",
                     (0, 0, crown_z), (reference_width * .5 + .72, 0, height - .02), .18, TRIM)
        box(root, f"{variant}_portal_sign", (3.15, .34, .92), (0, -.06, height + .05), PAINT, .15)
        badge(root, f"{variant}_portal_badge", frame, (0, -.25, height + .05), (1.25, 1.25),
              (math.pi / 2, 0, 0))
        root["referenceWidth"] = reference_width


def set_metadata():
    scene = bpy.context.scene
    scene["title"] = "Kaki Course Workshop production kit"
    scene["author"] = "Kaki Rally project, authored with Blender Python"
    scene["license"] = "Project-owned original asset"
    scene["sourceConcept"] = "docs/concepts/kaki-course-workshop-kit.png"
    scene["catalogRoots"] = len(FEATURE_NAMES)
    scene["bridgeModules"] = len(BRIDGE_MODULE_NAMES)
    for index, root in enumerate(ROOTS):
        root["catalogIndex"] = index
        root["productionReady"] = True
        root["collisionSource"] = "shared catalog footprint and surface profile"
    for root in MODULE_ROOTS:
        root["productionReady"] = True
        root["collisionSource"] = "elevated spline and bridge volume"
        root["moduleFamily"] = "Kaki Skyway"


def export_glb():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
    )


def look_at(camera, target):
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def bounds_for(root):
    points = []
    for child in [root, *list(root.children_recursive)]:
        if not getattr(child, "bound_box", None):
            continue
        for corner in child.bound_box:
            points.append(child.matrix_world @ Vector(corner))
    if not points:
        return Vector((-1,-1,0)), Vector((1,1,2))
    return Vector((min(p.x for p in points),min(p.y for p in points),min(p.z for p in points))), \
        Vector((max(p.x for p in points),max(p.y for p in points),max(p.z for p in points)))


def render_thumbnails():
    TEMP.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 256
    scene.render.resolution_y = 192
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (.025, .045, .052)
    camera_data = bpy.data.cameras.new("workshop_thumbnail_camera")
    camera = bpy.data.objects.new("workshop_thumbnail_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    key_data = bpy.data.lights.new("workshop_thumbnail_key", "AREA")
    key_data.energy = 1150
    key_data.shape = "DISK"
    key_data.size = 8
    key = bpy.data.objects.new("workshop_thumbnail_key", key_data)
    scene.collection.objects.link(key)
    key.location = (7, -9, 13)
    fill_data = bpy.data.lights.new("workshop_thumbnail_fill", "AREA")
    fill_data.energy = 650
    fill_data.size = 10
    fill = bpy.data.objects.new("workshop_thumbnail_fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-8, 5, 8)
    ground_mat = material("thumbnail_ground", (.055, .085, .085), .9, 0)
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0,0,-.06))
    ground = bpy.context.object
    ground.name = "thumbnail_ground"
    ground.data.materials.append(ground_mat)
    def set_root_hidden(root, hidden):
        root.hide_render = hidden
        for child in root.children_recursive:
            child.hide_render = hidden

    for root in ROOTS:
        set_root_hidden(root, True)
    rendered = []
    for index, name in enumerate(FEATURE_NAMES):
        root = bpy.data.objects.get(name)
        set_root_hidden(root, False)
        low, high = bounds_for(root)
        center = (low + high) * .5
        size = high - low
        maximum = max(size.x, size.y, size.z * 1.18, 1)
        camera.data.ortho_scale = maximum * 1.48
        camera.location = center + Vector((maximum*.95, -maximum*1.28, maximum*.9))
        look_at(camera, center + Vector((0,0,size.z*.04)))
        scene.render.filepath = str(TEMP / f"{index:02d}.png")
        bpy.ops.render.render(write_still=True)
        rendered.append(Path(scene.render.filepath))
        set_root_hidden(root, True)
    columns, rows = 7, 6
    atlas = bpy.data.images.new("kaki-course-feature-thumbnails-v1", width=columns*256, height=rows*192, alpha=True)
    atlas_pixels = [0.0] * (columns*256*rows*192*4)
    atlas_width = columns*256
    for index, path in enumerate(rendered):
        image = bpy.data.images.load(str(path), check_existing=False)
        pixels = list(image.pixels)
        column = index % columns
        row = rows - 1 - index // columns
        for y in range(192):
            source = y * 256 * 4
            target = ((row*192+y)*atlas_width + column*256) * 4
            atlas_pixels[target:target+256*4] = pixels[source:source+256*4]
        bpy.data.images.remove(image)
    atlas.pixels = atlas_pixels
    atlas.filepath_raw = str(THUMBNAIL)
    atlas.file_format = "PNG"
    atlas.save()
    for path in rendered:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    try:
        TEMP.rmdir()
    except OSError:
        pass


def main():
    clear_scene()
    make_ramps()
    make_utilities()
    make_hazards()
    make_destructibles()
    make_scenery()
    make_bridge_modules()
    roots_by_name = {root.name: root for root in ROOTS}
    assert set(roots_by_name) == set(FEATURE_NAMES), "Catalog roots are missing or duplicated"
    assert {root.name for root in MODULE_ROOTS} == set(BRIDGE_MODULE_NAMES), "Bridge modules are missing or duplicated"
    ROOTS[:] = [roots_by_name[name] for name in FEATURE_NAMES]
    set_metadata()
    export_glb()
    if "--no-thumbnails" not in sys.argv:
        render_thumbnails()
    print(f"Built {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
    if THUMBNAIL.exists():
        print(f"Built {THUMBNAIL} ({THUMBNAIL.stat().st_size} bytes)")
    print("Preserving hierarchy requires: node tools/optimize-course-workshop-kit.mjs")


if __name__ == "__main__":
    main()
