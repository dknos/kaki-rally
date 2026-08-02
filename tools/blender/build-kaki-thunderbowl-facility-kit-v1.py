#!/usr/bin/env python3
"""Build the clean-room Thunderbowl short-track facility kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "grandstand_bay", "archetype": "grandstand", "size": (16, 8, 7.5), "accent": "coral"},
    {"name": "press_box", "archetype": "office", "size": (10, 4.5, 4.2), "accent": "mint"},
    {"name": "scoreboard", "archetype": "scoreboard", "size": (8.5, 1.1, 8.5), "accent": "amber", "animated": True},
    {"name": "timing_tower", "archetype": "tower", "size": (4.5, 2.3, 11), "accent": "mint"},
    {"name": "catch_fence", "archetype": "fence", "size": (9, .22, 4.2)},
    {"name": "pit_garage", "archetype": "warehouse", "size": (15, 6.5, 6.5), "accent": "coral"},
    {"name": "pit_wall", "archetype": "pitwall", "size": (8, .85, 1.25), "accent": "coral"},
    {"name": "entry_tunnel", "archetype": "tunnel", "size": (9, 5.5, 5.5), "accent": "amber"},
    {"name": "concession", "archetype": "shed", "size": (6.5, 4, 4.2), "accent": "amber"},
    {"name": "restroom", "archetype": "restroom", "size": (5.5, 3.5, 3.8), "accent": "mint"},
    {"name": "light_mast", "archetype": "light", "size": (5.5, 1.5, 16), "animated": True},
    {"name": "maintenance_shed", "archetype": "shed", "size": (8, 5, 5), "accent": "mint"},
    {"name": "turnstile_gate", "archetype": "gate", "size": (5, 1.2, 3.4), "accent": "coral"},
]

build_kit(kit_code="STADIUM", output_relative="assets/racing/world-v3/stadium/kaki-thunderbowl-facility-kit-v1.glb", blend_relative="tools/blender/sources/world-v3/kaki-thunderbowl-facility-kit-v1.blend", items=ITEMS, builder_name=__file__)
