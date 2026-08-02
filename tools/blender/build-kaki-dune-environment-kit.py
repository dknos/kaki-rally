"""Build the authored Kaki Dune Run environment kit and a visual QA contact sheet.

Blender 5.x:
  blender -b --python tools/blender/build-kaki-dune-environment-kit.py
"""

from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "assets" / "racing" / "dunes" / "kaki-dune-environment-kit-v1.glb"
PREVIEW = REPO / "docs" / "qa" / "assets" / "kaki-dune-environment-kit-v1.png"


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.materials,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def material(name, color, metallic=0.0, roughness=0.72, emission=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.4
    return mat


def parent_asset(name, location):
    parent = bpy.data.objects.new(name, None)
    parent.location = location
    parent["kaki_asset"] = True
    parent["source"] = "Kaki Dune Run custom Blender geometry"
    bpy.context.scene.collection.objects.link(parent)
    return parent


def finish_mesh(obj, bevel=0.08, smooth=True, uv=True):
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        modifier = obj.modifiers.new("Production bevel", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
    if uv:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        try:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.025)
            bpy.ops.object.mode_set(mode="OBJECT")
        except RuntimeError:
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except RuntimeError:
                pass
        obj.select_set(False)
    obj["uv_ready"] = True
    obj["optimized"] = True
    return obj


def cube(name, parent, location, scale, mat, bevel=0.08, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel)
    return obj


def cylinder(name, parent, location, radius, depth, mat, vertices=12, rotation=(0, 0, 0), bevel=0.05):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel)
    return obj


def ico(name, parent, location, scale, mat, subdivisions=2, rotation=(0, 0, 0), bevel=0.05):
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=subdivisions,
        radius=1,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=bevel)
    return obj


def cone(name, parent, location, radius1, radius2, depth, mat, vertices=10, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=0.035)
    return obj


def tube(name, parent, points, radius, mat, resolution=1):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = resolution
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points):
        point.co = (*value, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = parent
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    obj.name = name
    finish_mesh(obj, bevel=0.025)
    obj.select_set(False)
    return obj


def triangular_flag(name, parent, location, scale, mat, flip=False):
    sx, sy = scale
    sign = -1 if flip else 1
    vertices = [
        (0, 0, 0),
        (sign * sx, 0.025, -sy * 0.38),
        (0, 0, -sy),
        (0, -0.025, 0),
        (sign * sx, -0.025, -sy * 0.38),
        (0, -0.025, -sy),
    ]
    faces = [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=0.02)
    return obj


def faceted_hull(name, parent, location, sections, mat, rotation=(0, 0, 0)):
    """Create a tapered six-sided vehicle/structure hull without box primitives."""
    vertices = []
    for y, half_width, bottom, shoulder, roof_width, roof in sections:
        vertices.extend([
            (-half_width, y, bottom),
            (half_width, y, bottom),
            (half_width, y, shoulder),
            (roof_width, y, roof),
            (-roof_width, y, roof),
            (-half_width, y, shoulder),
        ])
    faces = []
    ring_size = 6
    for section in range(len(sections) - 1):
        first = section * ring_size
        following = (section + 1) * ring_size
        for edge in range(ring_size):
            next_edge = (edge + 1) % ring_size
            faces.append((first + edge, following + edge, following + next_edge, first + next_edge))
    faces.append(tuple(reversed(range(ring_size))))
    last = (len(sections) - 1) * ring_size
    faces.append(tuple(last + edge for edge in range(ring_size)))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    obj.parent = parent
    finish_mesh(obj, bevel=0.12)
    return obj


def build_rock_spire(name, location, rock_light, rock_dark, lod=0):
    parent = parent_asset(name, location)
    count = 5 if lod == 0 else 3
    for index in range(count):
        angle = index * 1.7 + lod * 0.3
        height = 2.4 + (index % 3) * 0.95
        radius = 1.2 - index * 0.08
        ico(
            f"{name}_Stone_{index}",
            parent,
            (math.sin(angle) * 0.65, math.cos(angle) * 0.52, height * 0.48 - 0.12),
            (radius, radius * 0.78, height),
            rock_light if index % 2 == 0 else rock_dark,
            subdivisions=2 if lod == 0 else 1,
            rotation=(0.08 * index, -0.12 + index * 0.05, angle * 0.16),
            bevel=0.08 if lod == 0 else 0.03,
        )
    parent["lod"] = lod
    return parent


def build_arch(location, rock_light, rock_dark):
    parent = parent_asset("DuneRockArch_A_LOD0", location)
    for side in (-1, 1):
        ico(
            f"RockArch_Pier_{'L' if side < 0 else 'R'}",
            parent,
            (side * 1.75, 0, 1.65),
            (1.25, 1.05, 2.7),
            rock_dark,
            subdivisions=2,
            rotation=(0, side * 0.1, side * 0.08),
            bevel=0.08,
        )
    for index in range(5):
        angle = math.pi * (0.16 + index * 0.17)
        x = math.cos(angle) * 2.25
        z = 2.8 + math.sin(angle) * 1.65
        ico(
            f"RockArch_Crown_{index}",
            parent,
            (x, 0, z),
            (1.05, 0.95, 0.9),
            rock_light if index % 2 else rock_dark,
            subdivisions=2,
            rotation=(0, angle * 0.3, angle - math.pi / 2),
            bevel=0.07,
        )
    collider = cube("DuneRockArch_A_COLLIDER", parent, (0, 0, 1.8), (2.9, 0.7, 1.8), rock_dark, bevel=0)
    collider.display_type = "WIRE"
    collider.hide_render = True
    collider["collision_proxy"] = True
    return parent


def build_scrub(name, location, trunk_mat, leaf_mat, variant=0):
    parent = parent_asset(name, location)
    cylinder(f"{name}_Stem", parent, (0, 0, 0.34), 0.07, 0.68, trunk_mat, vertices=7, rotation=(0.08, 0.1, 0))
    branches = 5 + variant
    for index in range(branches):
        angle = index / branches * math.tau + variant * 0.42
        radius = 0.42 + (index % 2) * 0.18
        z = 0.28 + (index % 3) * 0.18
        tube(
            f"{name}_Branch_{index}",
            parent,
            [(0, 0, z), (math.cos(angle) * radius * 0.62, math.sin(angle) * radius * 0.62, z + 0.16),
             (math.cos(angle) * radius, math.sin(angle) * radius, z + 0.1)],
            0.035,
            trunk_mat,
        )
        ico(
            f"{name}_Leaf_{index}",
            parent,
            (math.cos(angle) * radius, math.sin(angle) * radius, z + 0.1),
            (0.25, 0.13, 0.16),
            leaf_mat,
            subdivisions=1,
            rotation=(0, angle, angle),
            bevel=0.02,
        )
    return parent


def build_deadwood(location, wood_mat):
    parent = parent_asset("DuneDeadwood_A", location)
    tube("Deadwood_Trunk", parent, [(-1.5, 0, 0.2), (-0.5, 0.08, 0.48), (0.65, -0.03, 0.32), (1.65, 0.12, 0.22)], 0.18, wood_mat)
    tube("Deadwood_Branch_A", parent, [(-0.45, 0.05, 0.43), (-0.65, 0.12, 1.1), (-0.9, 0.22, 1.55)], 0.11, wood_mat)
    tube("Deadwood_Branch_B", parent, [(0.55, -0.02, 0.32), (0.92, -0.22, 0.92), (1.25, -0.32, 1.22)], 0.09, wood_mat)
    return parent


def build_gate(location, metal_mat, accent_mat, dark_mat):
    parent = parent_asset("DuneRallyGate_Master", location)
    for side in (-1, 1):
        cylinder(
            f"Gate_Post_{'L' if side < 0 else 'R'}",
            parent,
            (side * 2.75, 0, 2.7),
            0.18,
            5.4,
            dark_mat,
            vertices=12,
        )
        for ring in range(3):
            cylinder(
                f"Gate_Band_{side}_{ring}",
                parent,
                (side * 2.75, 0, 1.05 + ring * 1.5),
                0.25,
                0.18,
                accent_mat,
                vertices=12,
            )
    cube("Gate_Crossbar", parent, (0, 0, 5.18), (3.0, 0.19, 0.2), metal_mat, bevel=0.15)
    # Intentional cat-ear crown silhouette.
    cone("Gate_CatEar_L", parent, (-0.62, 0, 5.83), 0.5, 0.04, 1.05, accent_mat, vertices=5, rotation=(0, 0.22, 0))
    cone("Gate_CatEar_R", parent, (0.62, 0, 5.83), 0.5, 0.04, 1.05, accent_mat, vertices=5, rotation=(0, -0.22, 0))
    ico("Gate_PawPad", parent, (0, -0.04, 5.55), (0.48, 0.18, 0.34), accent_mat, subdivisions=2, bevel=0.03)
    parent["route_clearance_width"] = 5.1
    return parent


def build_route_flag(location, pole_mat, accent_mat, alt_mat):
    parent = parent_asset("DuneRouteFlag_Master", location)
    cylinder("Flag_Pole", parent, (0, 0, 1.75), 0.055, 3.5, pole_mat, vertices=10)
    cylinder("Flag_Foot", parent, (0, 0, 0.12), 0.25, 0.24, pole_mat, vertices=10)
    triangular_flag("Flag_Cloth_A", parent, (0, 0, 3.25), (1.2, 1.0), accent_mat)
    triangular_flag("Flag_Cloth_B", parent, (0, 0.04, 2.24), (0.8, 0.68), alt_mat, flip=True)
    return parent


def build_service_camp(location, fabric, fabric_alt, frame, crate_mat):
    parent = parent_asset("DuneServiceCamp_A", location)
    # Open-sided, tensioned service canopy.
    for x in (-2.8, 2.8):
        for y in (-2.1, 2.1):
            cylinder(f"Camp_Pole_{x}_{y}", parent, (x, y, 1.7), 0.075, 3.4, frame, vertices=10)
    vertices = [
        (-3.2, -2.5, 3.35), (3.2, -2.5, 3.35), (2.8, 2.5, 3.35), (-2.8, 2.5, 3.35),
        (0, -2.5, 4.15), (0, 2.5, 4.15),
    ]
    faces = [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)]
    mesh = bpy.data.meshes.new("Camp_Canopy_Mesh")
    mesh.from_pydata(vertices, [], faces)
    canopy = bpy.data.objects.new("Camp_Tensioned_Canopy", mesh)
    bpy.context.scene.collection.objects.link(canopy)
    canopy.data.materials.append(fabric)
    canopy.parent = parent
    finish_mesh(canopy, bevel=0.025)
    cube("Camp_ToolChest", parent, (-1.65, 0.3, 0.65), (0.85, 0.55, 0.65), crate_mat, bevel=0.12)
    for index in range(3):
        cube(
            f"Camp_SupplyCase_{index}",
            parent,
            (0.2 + index * 0.9, 0.85 + (index % 2) * 0.42, 0.34),
            (0.38, 0.52, 0.34),
            fabric_alt if index == 1 else crate_mat,
            bevel=0.08,
        )
    return parent


def build_oasis(location, water_mat, trunk_mat, leaf_mat, rock_mat):
    parent = parent_asset("DuneOasis_A", location)
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=3.9, fill_type="NGON", location=(0, 0, 0.06))
    water = bpy.context.object
    water.name = "Oasis_Water"
    water.scale.y = 0.68
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    water.data.materials.append(water_mat)
    water.parent = parent
    finish_mesh(water, bevel=0.05)
    for palm_index, (x, y, height, lean) in enumerate([(-2.6, 0.3, 4.4, -0.12), (2.4, -0.6, 3.7, 0.16)]):
        cylinder(
            f"Oasis_PalmTrunk_{palm_index}",
            parent,
            (x, y, height * 0.5),
            0.2,
            height,
            trunk_mat,
            vertices=10,
            rotation=(0, lean, 0),
        )
        for leaf_index in range(8):
            angle = leaf_index / 8 * math.tau
            tube(
                f"Oasis_PalmLeaf_{palm_index}_{leaf_index}",
                parent,
                [(x, y, height), (x + math.cos(angle) * 0.9, y + math.sin(angle) * 0.9, height + 0.25),
                 (x + math.cos(angle) * 1.9, y + math.sin(angle) * 1.9, height - 0.22)],
                0.085,
                leaf_mat,
            )
    for index in range(7):
        angle = index / 7 * math.tau
        ico(
            f"Oasis_RimRock_{index}",
            parent,
            (math.cos(angle) * 4.1, math.sin(angle) * 2.9, 0.32),
            (0.65, 0.48, 0.42),
            rock_mat,
            subdivisions=1,
            rotation=(0, 0, angle),
            bevel=0.04,
        )
    return parent


def build_wreck(location, body_mat, dark_mat, metal_mat):
    parent = parent_asset("DuneWreckedRallyProp_A", location)
    faceted_hull(
        "Wreck_TaperedCrushedShell",
        parent,
        (0, 0, 0.18),
        [
            (-2.08, 0.72, 0.08, 0.54, 0.42, 0.68),
            (-1.35, 1.18, 0.04, 0.72, 0.72, 1.12),
            (0.72, 1.24, 0.02, 0.68, 0.76, 0.96),
            (1.78, 0.82, 0.10, 0.52, 0.46, 0.66),
        ],
        body_mat,
        rotation=(0.06, 0.08, -0.08),
    )
    # The buckled roof is an asymmetric low-poly shell rather than a second
    # rounded box, preserving the battered silhouette at racing distance.
    faceted_hull(
        "Wreck_BuckledRoofShell",
        parent,
        (0.16, -0.34, 0.82),
        [(-0.92, 0.66, 0, 0.16, 0.48, 0.28), (0.78, 0.74, 0, 0.12, 0.42, 0.22)],
        dark_mat,
        rotation=(0.14, -0.08, 0.06),
    )
    for side in (-1, 1):
        for axle in (-1, 1):
            cylinder(
                f"Wreck_Wheel_{side}_{axle}",
                parent,
                (side * 1.32, axle * 1.38, 0.52 + (0.15 if axle > 0 else 0)),
                0.48,
                0.34,
                dark_mat,
                vertices=14,
                rotation=(0, math.pi / 2, 0),
            )
    cube("Wreck_BentBumper", parent, (0, 2.12, 0.45), (1.45, 0.12, 0.12), metal_mat, bevel=0.08, rotation=(0, 0.14, 0.1))
    return parent


def build_sign(location, frame_mat, accent_mat, dark_mat):
    parent = parent_asset("DuneSign_PawRoute", location)
    cylinder("Sign_Post", parent, (0, 0, 1.45), 0.11, 2.9, frame_mat, vertices=10)
    cube("Sign_Plate", parent, (0, 0, 3.05), (1.25, 0.12, 0.72), dark_mat, bevel=0.18)
    ico("Sign_PawPad", parent, (0, -0.14, 3.0), (0.42, 0.08, 0.32), accent_mat, subdivisions=2, bevel=0.025)
    for index, x in enumerate((-0.48, -0.17, 0.17, 0.48)):
        ico(f"Sign_PawToe_{index}", parent, (x, -0.15, 3.44 + 0.08 * (1 - abs(x))), (0.14, 0.06, 0.16), accent_mat, subdivisions=1, bevel=0.02)
    return parent


def build_destructible(location, crate_mat, accent_mat):
    parent = parent_asset("DuneDestructibleSupplyStack_A", location)
    for index, (x, y, z, s) in enumerate([
        (-0.65, 0, 0.48, 0.48), (0.55, 0.1, 0.52, 0.52), (-0.08, 0.05, 1.37, 0.45),
    ]):
        box = cube(f"SupplyCrate_{index}", parent, (x, y, z), (s, s, s), crate_mat, bevel=0.08)
        for axis in (-1, 1):
            cube(
                f"SupplyCrateBand_{index}_{axis}",
                parent,
                (x + axis * s * 0.62, y - s * 1.01, z),
                (0.055, 0.03, s * 0.82),
                accent_mat,
                bevel=0.015,
                rotation=(math.pi / 4 * axis, 0, 0),
            )
        box["destructible"] = True
    return parent


def build_mesa(name, location, rock_light, rock_dark, lod=0):
    parent = parent_asset(name, location)
    layers = 4 if lod == 0 else 2
    for index in range(layers):
        width = 5.6 - index * 0.72
        depth = 2.8 - index * 0.32
        height = 0.78 + index * 0.1
        ico(
            f"{name}_Strata_{index}",
            parent,
            (0.24 * index, -0.12 * index, 0.5 + index * 0.74),
            (width, depth, height),
            rock_light if index % 2 else rock_dark,
            subdivisions=2 if lod == 0 else 1,
            rotation=(0.02 * index, 0.03 * index, 0.035 * index),
            bevel=0.11 if lod == 0 else 0.04,
        )
        if lod == 0 and index < 3:
            ico(
                f"{name}_ErodedButtress_{index}",
                parent,
                (-width * 0.68 + index * 0.45, depth * 0.54, 0.34 + index * 0.42),
                (width * 0.34, depth * 0.42, height * 1.45),
                rock_light,
                subdivisions=1,
                rotation=(0.08, -0.14, -0.1 * index),
                bevel=0.05,
            )
    parent["lod"] = lod
    return parent


def aim_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def main():
    reset_scene()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)

    sand_light = material("Dune Sandstone Sun", (0.58, 0.29, 0.12), roughness=0.88)
    sand_dark = material("Dune Sandstone Shade", (0.25, 0.105, 0.055), roughness=0.92)
    metal = material("Dune Brushed Alloy", (0.22, 0.30, 0.34), metallic=0.72, roughness=0.34)
    dark = material("Dune Carbon Black", (0.025, 0.035, 0.045), metallic=0.26, roughness=0.62)
    accent = material("Kaki Oasis Cyan", (0.08, 0.78, 0.82), metallic=0.08, roughness=0.4, emission=(0.01, 0.22, 0.25))
    magenta = material("Kaki Rally Magenta", (0.92, 0.08, 0.38), metallic=0.12, roughness=0.42)
    fabric = material("Service Tent Turquoise", (0.04, 0.42, 0.49), roughness=0.78)
    fabric_alt = material("Service Tent Gold", (0.92, 0.56, 0.12), roughness=0.73)
    scrub = material("Desert Scrub", (0.22, 0.31, 0.10), roughness=0.96)
    scrub_dry = material("Dry Scrub Tips", (0.52, 0.42, 0.16), roughness=0.96)
    wood = material("Sunbleached Deadwood", (0.28, 0.17, 0.085), roughness=0.94)
    water = material("Oasis Water", (0.025, 0.38, 0.46), metallic=0.12, roughness=0.14, emission=(0.01, 0.08, 0.09))
    wreck_body = material("Wrecked Rally Coral", (0.52, 0.065, 0.045), metallic=0.34, roughness=0.58)
    crate = material("Service Crate", (0.35, 0.23, 0.11), roughness=0.78)

    build_rock_spire("DuneRockSpire_A_LOD0", (-10, 7, 0), sand_light, sand_dark, 0)
    build_rock_spire("DuneRockSpire_A_LOD1", (-10, 14, 0), sand_light, sand_dark, 1)
    build_arch((-2, 8, 0), sand_light, sand_dark)
    build_mesa("DuneMesa_A_LOD0", (8, 10, 0), sand_light, sand_dark, 0)
    build_mesa("DuneMesa_A_LOD1", (9, 17, 0), sand_light, sand_dark, 1)
    build_scrub("DuneScrub_A", (-11, 0, 0), wood, scrub, 0)
    build_scrub("DuneScrub_B", (-8, 0, 0), wood, scrub_dry, 2)
    build_deadwood((-4, 0, 0), wood)
    build_gate((2, 1, 0), metal, accent, dark)
    build_route_flag((7, 0, 0), metal, magenta, accent)
    build_service_camp((12, 1, 0), fabric, fabric_alt, metal, crate)
    build_oasis((-10, -9, 0), water, wood, scrub, sand_dark)
    build_wreck((-2, -8, 0), wreck_body, dark, metal)
    build_sign((4, -8, 0), metal, accent, dark)
    build_destructible((9, -8, 0), crate, magenta)

    for obj in bpy.context.scene.objects:
        if obj.type == "MESH" and not obj.hide_render:
            obj["casts_shadow"] = True
            obj["receives_shadow"] = True

    bpy.context.scene.world.color = (0.025, 0.035, 0.05)
    world = bpy.context.scene.world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.055, 0.09, 0.13, 1)
    background.inputs["Strength"].default_value = 0.45

    bpy.ops.object.light_add(type="AREA", location=(4, -9, 19))
    key = bpy.context.object
    key.name = "Preview Warm Sun"
    key.data.energy = 1450
    key.data.shape = "DISK"
    key.data.size = 8
    key.data.color = (1.0, 0.58, 0.31)
    aim_at(key, (0, 2, 1.8))
    bpy.ops.object.light_add(type="AREA", location=(-15, -4, 9))
    fill = bpy.context.object
    fill.name = "Preview Cool Fill"
    fill.data.energy = 820
    fill.data.size = 12
    fill.data.color = (0.24, 0.52, 0.75)
    aim_at(fill, (0, 0, 1.5))

    bpy.ops.object.camera_add(location=(27, -34, 24))
    camera = bpy.context.object
    camera.name = "Dune Kit Preview Camera"
    camera.data.lens = 52
    aim_at(camera, (0, 2, 1.9))
    bpy.context.scene.camera = camera
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(PREVIEW)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)

    # Preview-only objects are excluded from the runtime GLB.
    camera.hide_viewport = True
    camera.hide_render = True
    key.hide_viewport = True
    key.hide_render = True
    fill.hide_viewport = True
    fill.hide_render = True
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
