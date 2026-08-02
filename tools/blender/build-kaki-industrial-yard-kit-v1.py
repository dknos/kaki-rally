#!/usr/bin/env python3
"""Build the clean-room Whisker Yard freight/fabrication kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "warehouse_facade", "archetype": "warehouse", "size": (19, 7.5, 9), "accent": "coral"},
    {"name": "loading_dock", "archetype": "ramp", "size": (9, 4.5, 2.8), "accent": "amber"},
    {"name": "yard_office", "archetype": "office", "size": (9, 5, 5.5)},
    {"name": "guard_booth", "archetype": "guardhouse", "size": (3.2, 2.4, 3.4), "accent": "amber"},
    {"name": "pipe_rack", "archetype": "pipe", "size": (11, 3.5, 3.6), "accent": "coral"},
    {"name": "steel_stairs", "archetype": "stairs", "size": (7, 2.3, 4.5), "accent": "safety"},
    {"name": "catwalk", "archetype": "catwalk", "size": (10, 2.2, 5.0), "accent": "safety"},
    {"name": "tank_pair", "archetype": "silo", "size": (4.2, 4.2, 8.0), "accent": "mint"},
    {"name": "sliding_gate", "archetype": "gate", "size": (9, .6, 3.2), "accent": "safety"},
    {"name": "floodlight", "archetype": "light", "size": (4.2, 1.5, 12), "animated": True},
    {"name": "service_canopy", "archetype": "canopy", "size": (9, 6, 4.5), "accent": "mint"},
    {"name": "dumpster", "archetype": "dumpster", "size": (2.8, 1.6, 1.7), "accent": "coral"},
    {"name": "utility_cabinet", "archetype": "utility", "size": (1.5, .85, 2.0), "accent": "mint"},
    {"name": "yard_fence", "archetype": "fence", "size": (8, .25, 2.6)},
]

build_kit(kit_code="INDUSTRIAL", output_relative="assets/racing/world-v3/industrial/kaki-industrial-yard-kit-v1.glb", blend_relative="tools/blender/sources/world-v3/kaki-industrial-yard-kit-v1.blend", items=ITEMS, builder_name=__file__)
