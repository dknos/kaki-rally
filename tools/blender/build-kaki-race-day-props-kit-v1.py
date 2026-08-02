#!/usr/bin/env python3
"""Build the clean-room shared Kaki race-day props kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "flag", "archetype": "flag", "size": (2.2, .7, 5.2), "accent": "coral", "animated": True},
    {"name": "windsock", "archetype": "windsock", "size": (2.6, .7, 6), "accent": "amber", "animated": True},
    {"name": "marshal_post", "archetype": "marshal", "size": (2.4, 1.5, 2.6), "accent": "safety"},
    {"name": "cone", "archetype": "cone", "size": (.7, .7, 1.1), "accent": "safety"},
    {"name": "crowd_fence", "archetype": "fence", "size": (4.5, .18, 1.25)},
    {"name": "portable_sign", "archetype": "sign", "size": (2.6, .45, 3.2), "accent": "amber"},
    {"name": "event_tent", "archetype": "tent", "size": (6, 4.5, 4), "accent": "coral"},
    {"name": "bin", "archetype": "utility", "size": (.8, .8, 1.25), "accent": "mint"},
    {"name": "bench", "archetype": "platform", "size": (2.6, .7, 1.15), "accent": "timber"},
    {"name": "restroom", "archetype": "restroom", "size": (1.4, 1.4, 2.5), "accent": "mint"},
    {"name": "service_table", "archetype": "platform", "size": (2.2, 1.1, 1.1), "accent": "mint"},
    {"name": "tool_cabinet", "archetype": "tool", "size": (1.3, .7, 1.8), "accent": "coral"},
    {"name": "wheel_stack", "archetype": "props", "size": (1.2, 1.2, 1.6), "accent": "rubber"},
    {"name": "fire_extinguisher", "archetype": "utility", "size": (.45, .45, 1.3), "accent": "safety"},
    {"name": "start_light", "archetype": "timing", "size": (4.5, .7, 5), "accent": "coral", "animated": True},
]

build_kit(kit_code="RACEDAY", output_relative="assets/racing/world-v3/shared/kaki-race-day-props-kit-v1.glb", blend_relative="tools/blender/sources/world-v3/kaki-race-day-props-kit-v1.blend", items=ITEMS, builder_name=__file__)
