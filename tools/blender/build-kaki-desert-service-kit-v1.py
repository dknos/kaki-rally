#!/usr/bin/env python3
"""Build the clean-room Dune Run and Rally Raid service kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "bivouac_canopy", "archetype": "canopy", "size": (9, 6, 4.6), "accent": "coral"},
    {"name": "service_tent", "archetype": "tent", "size": (7, 5, 4.2), "accent": "mint"},
    {"name": "water_tank", "archetype": "tank", "size": (4.5, 4.5, 6.8), "accent": "mint"},
    {"name": "fuel_service", "archetype": "utility", "size": (3, 1.8, 2.8), "accent": "coral"},
    {"name": "solar_array", "archetype": "solar", "size": (9, 5.5, 4.5), "accent": "mint"},
    {"name": "radio_mast", "archetype": "radio", "size": (4.2, 1.4, 15), "accent": "mint"},
    {"name": "waypoint_post", "archetype": "sign", "size": (2.5, .5, 3.5), "accent": "amber"},
    {"name": "timing_shelter", "archetype": "guardhouse", "size": (4, 2.8, 3.6), "accent": "mint"},
    {"name": "utility_cabinet", "archetype": "utility", "size": (1.5, .9, 2), "accent": "mint"},
    {"name": "generator", "archetype": "utility", "size": (2.7, 1.5, 2.1), "accent": "amber", "animated": True},
    {"name": "portable_light", "archetype": "light", "size": (3, 1.1, 8.5), "animated": True},
    {"name": "field_office", "archetype": "office", "size": (7, 4, 4.2), "accent": "mint"},
    {"name": "observation_platform", "archetype": "platform", "size": (7, 3.5, 5.2), "accent": "coral"},
    {"name": "recovery_rack", "archetype": "tool", "size": (3.2, 1.8, 2.4), "accent": "safety"},
    {"name": "windsock", "archetype": "windsock", "size": (2.8, .7, 6.5), "accent": "amber", "animated": True},
]

build_kit(kit_code="DESERT", output_relative="assets/racing/world-v3/desert/kaki-desert-service-kit-v1.glb", blend_relative="tools/blender/sources/world-v3/kaki-desert-service-kit-v1.blend", items=ITEMS, builder_name=__file__)
