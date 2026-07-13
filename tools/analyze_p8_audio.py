#!/usr/bin/env python3
"""Inventory PICO-8 SFX/music features in decoded .p8 cartridges."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from analyze_p8_corpus import parse_sections
from extract_p8_resources import EFFECTS, WAVEFORMS, parse_music, parse_sfx


def inspect(path: Path) -> dict[str, Any]:
    sections, version = parse_sections(path.read_text(encoding="utf-8", errors="replace"))
    sfx = parse_sfx(sections.get("sfx", ""))
    music = parse_music(sections.get("music", ""))
    active_notes = [
        note
        for item in sfx
        for note in item["notes"]
        if note["volume"] > 0
    ]
    waveforms = sorted({note["waveform"] for note in active_notes})
    effects = sorted({note["effect"] for note in active_notes})
    filtered_sfx = [item["index"] for item in sfx if item["filter_editor_byte_raw"] & 0xFE]
    custom_refs = sorted({note["waveform"] - 8 for note in active_notes if note["waveform"] >= 8})
    flow_flags = sorted(
        {
            flag
            for pattern in music
            for flag, enabled in (
                ("loop_start", pattern["loop_start"]),
                ("loop_back", pattern["loop_end"]),
                ("stop", pattern["stop"]),
                ("mode_bit", bool(pattern["flags_raw"] & 0x08)),
            )
            if enabled
        }
    )
    return {
        "path": str(path.resolve()),
        "filename": path.name,
        "version": version,
        "active_note_count": len(active_notes),
        "waveforms": waveforms,
        "waveform_names": [WAVEFORMS[index] for index in waveforms],
        "effects": effects,
        "effect_names": [EFFECTS[index] for index in effects],
        "filtered_sfx": filtered_sfx,
        "custom_instrument_refs": custom_refs,
        "music_pattern_count": len(music),
        "music_flow_flags": flow_flags,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--candidates", type=int, default=15)
    args = parser.parse_args()

    paths = [args.path] if args.path.is_file() else sorted(args.path.rglob("*.p8"))
    carts = [inspect(path) for path in paths]
    carts_with_notes = [cart for cart in carts if cart["active_note_count"]]
    waveform_carts = Counter(index for cart in carts for index in cart["waveforms"])
    effect_carts = Counter(index for cart in carts for index in cart["effects"])
    summary = {
        "cart_count": len(carts),
        "carts_with_active_notes": len(carts_with_notes),
        "carts_with_music_patterns": sum(bool(cart["music_pattern_count"]) for cart in carts),
        "carts_with_filters": sum(bool(cart["filtered_sfx"]) for cart in carts),
        "carts_with_custom_instrument_refs": sum(bool(cart["custom_instrument_refs"]) for cart in carts),
        "waveform_cart_counts": {
            WAVEFORMS[index]: waveform_carts[index] for index in range(len(WAVEFORMS))
        },
        "effect_cart_counts": {
            EFFECTS[index]: effect_carts[index] for index in range(len(EFFECTS))
        },
    }
    candidates = sorted(
        carts_with_notes,
        key=lambda cart: (
            len(cart["waveforms"])
            + len(cart["effects"])
            + 2 * bool(cart["filtered_sfx"])
            + 2 * bool(cart["custom_instrument_refs"])
            + len(cart["music_flow_flags"]),
            cart["active_note_count"],
        ),
        reverse=True,
    )[: args.candidates]

    if args.json:
        print(json.dumps({"summary": summary, "candidates": candidates, "carts": carts}, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        print("Candidates:")
        for cart in candidates:
            print(
                f"  {cart['filename']}: waveforms={cart['waveform_names']} "
                f"effects={cart['effect_names']} filters={len(cart['filtered_sfx'])} "
                f"custom={cart['custom_instrument_refs']} flow={cart['music_flow_flags']}"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
