#!/usr/bin/env python3
"""Build the clean-room Monster Smash event-perimeter kit."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaki_world_kit_common import build_kit

ITEMS = [
    {"name": "entry_tunnel", "archetype": "tunnel", "size": (11, 6, 6.5), "accent": "coral"},
    {"name": "event_grandstand", "archetype": "grandstand", "size": (17, 8, 8), "accent": "amber"},
    {"name": "scoreboard", "archetype": "scoreboard", "size": (9, 1.2, 9), "accent": "coral", "animated": True},
    {"name": "safety_barrier", "archetype": "barrier", "size": (5.5, .8, 1.25), "accent": "safety"},
    {"name": "backstage_fence", "archetype": "fence", "size": (8, .25, 2.7)},
    {"name": "service_gate", "archetype": "gate", "size": (8, .6, 3.5), "accent": "amber"},
    {"name": "staging_platform", "archetype": "platform", "size": (9, 4, 4.8), "accent": "safety"},
    {"name": "event_tent", "archetype": "tent", "size": (7, 5, 4.2), "accent": "coral"},
    {"name": "concession", "archetype": "shed", "size": (6.5, 4, 4.2), "accent": "amber"},
    {"name": "restroom", "archetype": "restroom", "size": (4.5, 3, 3.6), "accent": "mint"},
    {"name": "maintenance_prop", "archetype": "tool", "size": (2.2, 1.3, 2.2), "accent": "mint"},
    {"name": "light_mast", "archetype": "light", "size": (5, 1.5, 14), "animated": True},
    {"name": "crush_zone_shell", "archetype": "barrier", "size": (4.5, 1.8, 1.35), "accent": "coral"},
]

build_kit(kit_code="MONSTER", output_relative="assets/racing/world-v3/monster/kaki-monster-event-kit-v2.glb", blend_relative="tools/blender/sources/world-v3/kaki-monster-event-kit-v2.blend", items=ITEMS, builder_name=__file__)
