#!/usr/bin/env python3
"""Build the clean-room side-readable Trials infrastructure kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "scaffold_bay", "archetype": "scaffold", "size": (8, 3.5, 6.8), "accent": "safety"},
    {"name": "steel_platform", "archetype": "platform", "size": (8, 3.5, 5.5), "accent": "coral"},
    {"name": "stairs", "archetype": "stairs", "size": (7, 2.3, 4.8), "accent": "safety"},
    {"name": "catwalk", "archetype": "catwalk", "size": (10, 2.2, 5.5), "accent": "safety"},
    {"name": "culvert_pipe", "archetype": "culvert", "size": (6, 4.8, 3.4)},
    {"name": "concrete_block", "archetype": "barrier", "size": (5, 2.2, 2.4), "accent": "amber"},
    {"name": "retaining_wall", "archetype": "barrier", "size": (9, 1.4, 3.2), "accent": "safety"},
    {"name": "quarry_shed", "archetype": "warehouse", "size": (10, 5.5, 6), "accent": "amber"},
    {"name": "loading_ramp", "archetype": "ramp", "size": (8, 3.5, 3.8), "accent": "safety"},
    {"name": "bridge", "archetype": "bridge", "size": (12, 3.2, 5.5), "accent": "coral"},
    {"name": "industrial_gate", "archetype": "gate", "size": (8, .7, 4), "accent": "safety"},
    {"name": "light_tower", "archetype": "light", "size": (4, 1.3, 11), "animated": True},
    {"name": "championship_arch", "archetype": "arch", "size": (11, 1.4, 7), "accent": "coral", "animated": True},
    {"name": "viewing_stand", "archetype": "stand", "size": (9, 4.5, 4.5), "accent": "mint"},
]

build_kit(kit_code="TRIALS", output_relative="assets/racing/world-v3/trials/kaki-trials-infrastructure-kit-v1.glb", blend_relative="tools/blender/sources/world-v3/kaki-trials-infrastructure-kit-v1.blend", items=ITEMS, builder_name=__file__)
