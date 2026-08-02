#!/usr/bin/env python3
"""Build the clean-room Off-Road GP and Draw roadside world kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "guardrail_straight", "archetype": "guardrail", "size": (8, .42, 1.05), "category": "road safety rail"},
    {"name": "concrete_barrier", "archetype": "barrier", "size": (4.8, .75, 1.1), "accent": "safety"},
    {"name": "timber_fence", "archetype": "fence", "size": (7, .25, 1.5), "accent": "timber"},
    {"name": "chain_fence", "archetype": "fence", "size": (7, .22, 2.4)},
    {"name": "culvert", "archetype": "culvert", "size": (5, 3.2, 2.4)},
    {"name": "retaining_wall", "archetype": "barrier", "size": (8, 1.1, 2.8), "accent": "amber"},
    {"name": "marshal_shelter", "archetype": "guardhouse", "size": (3.4, 2.3, 3.1), "accent": "coral"},
    {"name": "service_shed", "archetype": "shed", "size": (8.5, 5.5, 5.4)},
    {"name": "post_depot", "archetype": "shed", "size": (13, 7.5, 7.0), "accent": "coral"},
    {"name": "municipal_guardhouse", "archetype": "guardhouse", "size": (5.5, 3.5, 4.2), "accent": "amber"},
    {"name": "kiln_shed", "archetype": "warehouse", "size": (15, 8, 8.5), "accent": "amber"},
    {"name": "toll_plaza", "archetype": "canopy", "size": (16, 5.5, 5.2), "accent": "coral"},
    {"name": "glass_lab", "archetype": "office", "size": (14, 7, 6.2), "accent": "mint"},
    {"name": "quarry_conveyor", "archetype": "bridge", "size": (18, 2.4, 6.2), "accent": "amber"},
    {"name": "service_bridge", "archetype": "bridge", "size": (12, 3.2, 4.2), "accent": "coral"},
    {"name": "utility_box", "archetype": "utility", "size": (1.4, .9, 1.8), "accent": "mint"},
]

build_kit(kit_code="ROADSIDE", output_relative="assets/racing/world-v3/roadside/kaki-rally-roadside-kit-v3.glb", blend_relative="tools/blender/sources/world-v3/kaki-rally-roadside-kit-v3.blend", items=ITEMS, builder_name=__file__)
