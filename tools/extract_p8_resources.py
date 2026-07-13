#!/usr/bin/env python3
"""Extract lossless, inspectable resources from a decoded PICO-8 .p8 cart."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from PIL import Image

from analyze_p8_corpus import parse_sections


PICO8_PALETTE = [
    (0, 0, 0),
    (29, 43, 83),
    (126, 37, 83),
    (0, 135, 81),
    (171, 82, 54),
    (95, 87, 79),
    (194, 195, 199),
    (255, 241, 232),
    (255, 0, 77),
    (255, 163, 0),
    (255, 236, 39),
    (0, 228, 54),
    (41, 173, 255),
    (131, 118, 156),
    (255, 119, 168),
    (255, 204, 170),
]

WAVEFORMS = [
    "sine",
    "triangle",
    "sawtooth",
    "long_square",
    "short_square",
    "ringing",
    "noise",
    "ringing_sine",
    "custom_0",
    "custom_1",
    "custom_2",
    "custom_3",
    "custom_4",
    "custom_5",
    "custom_6",
    "custom_7",
]

EFFECTS = [
    "none",
    "slide",
    "vibrato",
    "drop",
    "fade_in",
    "fade_out",
    "arpeggio_fast",
    "arpeggio_slow",
]


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def semantic_hash(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def parse_pixel_section(value: str) -> list[list[int]]:
    rows: list[list[int]] = []
    for line in value.splitlines():
        line = line.strip().lower()
        if len(line) == 128 and all(char in "0123456789abcdef" for char in line):
            rows.append([int(char, 16) for char in line])
    while len(rows) < 128:
        rows.append([0] * 128)
    return rows[:128]


def indexed_image(rows: list[list[int]]) -> Image.Image:
    height = len(rows)
    width = len(rows[0]) if rows else 0
    image = Image.new("P", (width, height))
    image.putdata([value for row in rows for value in row])
    palette = [channel for color in PICO8_PALETTE for channel in color]
    image.putpalette(palette + [0] * (768 - len(palette)))
    return image


def parse_hex_rows(value: str, row_bytes: int, row_count: int) -> list[list[int]]:
    rows: list[list[int]] = []
    for line in value.splitlines():
        compact = line.strip().replace(" ", "")
        if len(compact) != row_bytes * 2:
            continue
        try:
            rows.append(list(bytes.fromhex(compact)))
        except ValueError:
            continue
    while len(rows) < row_count:
        rows.append([0] * row_bytes)
    return rows[:row_count]


def shared_map_rows(gfx_rows: list[list[int]]) -> list[list[int]]:
    """Decode gfx rows 64..127 as their aliased 4096 bytes of map memory."""
    result: list[list[int]] = []
    for row in gfx_rows[64:128]:
        # Text gfx pixels are left-to-right. In RAM, the left pixel is the low
        # nibble and the right pixel is the high nibble.
        result.append([row[x] | (row[x + 1] << 4) for x in range(0, 128, 2)])
    flat = [value for row in result for value in row]
    return [flat[offset : offset + 128] for offset in range(0, 4096, 128)]


def parse_flags(value: str) -> list[int]:
    rows = parse_hex_rows(value, row_bytes=128, row_count=2)
    return (rows[0] + rows[1])[:256]


def parse_sfx(value: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    valid_lines = []
    for line in value.splitlines():
        compact = line.strip().lower()
        if len(compact) == 168 and all(char in "0123456789abcdef" for char in compact):
            valid_lines.append(compact)
    for index in range(64):
        default_speed = "01" if index == 0 else "10"
        line = valid_lines[index] if index < len(valid_lines) else "00" + default_speed + "00" + "00" + "00000" * 32
        properties_raw = [int(line[offset : offset + 2], 16) for offset in range(0, 8, 2)]
        filter_editor_byte = properties_raw[0]
        notes = []
        for note_index in range(32):
            start = 8 + note_index * 5
            pitch = int(line[start : start + 2], 16)
            waveform = int(line[start + 2], 16)
            volume = int(line[start + 3], 16)
            effect = int(line[start + 4], 16)
            notes.append(
                {
                    "index": note_index,
                    "pitch": pitch,
                    "waveform": waveform,
                    "waveform_name": WAVEFORMS[waveform],
                    "volume": volume,
                    "effect": effect,
                    "effect_name": EFFECTS[effect],
                }
            )
        result.append(
            {
                "index": index,
                # Keep the complete header because old carts and newer audio
                # modes can use bits outside the editor's visible ranges.
                "properties_raw": properties_raw,
                "editor_mode": filter_editor_byte & 0x01,
                "filter_editor_byte_raw": filter_editor_byte,
                "filters": {
                    "noiz": bool(filter_editor_byte & 0x02),
                    "buzz": bool(filter_editor_byte & 0x04),
                    "detune": (filter_editor_byte // 8) % 3,
                    "reverb": (filter_editor_byte // 24) % 3,
                    "dampen": (filter_editor_byte // 72) % 3,
                },
                "speed": properties_raw[1],
                "loop_start": properties_raw[2],
                "loop_end": properties_raw[3],
                "notes": notes,
            }
        )
    return result


def parse_music(value: str) -> list[dict[str, Any]]:
    patterns: list[dict[str, Any]] = []
    for index, line in enumerate(value.splitlines()[:64]):
        parts = line.strip().split()
        if len(parts) != 2 or len(parts[1]) != 8:
            continue
        try:
            flags = int(parts[0], 16)
            channels = list(bytes.fromhex(parts[1]))
        except ValueError:
            continue
        patterns.append(
            {
                "index": index,
                "flags_raw": flags,
                "loop_start": bool(flags & 1),
                "loop_end": bool(flags & 2),
                "stop": bool(flags & 4),
                "channels_raw": channels,
                "channels": [value if value <= 63 else None for value in channels],
            }
        )
    return patterns


def render_map(tile_rows: list[list[int]], gfx: Image.Image) -> Image.Image:
    image = Image.new("P", (128 * 8, len(tile_rows) * 8))
    image.putpalette(gfx.getpalette())
    for tile_y, row in enumerate(tile_rows):
        for tile_x, tile_id in enumerate(row):
            if tile_id == 0:
                continue
            source_x = (tile_id % 16) * 8
            source_y = (tile_id // 16) * 8
            tile = gfx.crop((source_x, source_y, source_x + 8, source_y + 8))
            image.paste(tile, (tile_x * 8, tile_y * 8))
    return image


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path, help="Decoded .p8 cartridge")
    parser.add_argument("output", type=Path, help="Output directory")
    args = parser.parse_args()

    raw = args.input.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    sections, version = parse_sections(text)
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "source.p8").write_bytes(raw)

    lua = sections.get("lua", "")
    # Preserve whether the final Lua line has a terminator. It affects the
    # compressed cart bytes and therefore matters for a truly reversible codec.
    (args.output / "code.p8.lua").write_text(lua, encoding="utf-8")

    gfx_rows = parse_pixel_section(sections.get("gfx", ""))
    label_rows = parse_pixel_section(sections.get("label", ""))
    gfx_image = indexed_image(gfx_rows)
    gfx_image.save(args.output / "spritesheet.png")
    indexed_image(label_rows).save(args.output / "label.png")

    top_map = parse_hex_rows(sections.get("map", ""), row_bytes=128, row_count=32)
    aliased_map = shared_map_rows(gfx_rows)
    flags = parse_flags(sections.get("gff", ""))
    write_json(
        args.output / "map.json",
        {
            "width": 128,
            "primary_height": 32,
            "maximum_height_with_shared_memory": 64,
            "primary_rows": top_map,
            "shared_alias_rows": aliased_map,
            "shared_memory_warning": (
                "Rows 32..63 alias the lower half of sprite memory. Determine from code "
                "whether each cart treats this region as map data, graphics, or raw bytes."
            ),
        },
    )
    write_json(
        args.output / "sprite_flags.json",
        {
            "flags": flags,
            "bits": {str(bit): [index for index, value in enumerate(flags) if value & (1 << bit)] for bit in range(8)},
        },
    )
    render_map(top_map, gfx_image).save(args.output / "map_primary.png")
    render_map(top_map + aliased_map, gfx_image).save(args.output / "map_with_shared_alias.png")

    write_json(args.output / "sfx.json", {"sfx": parse_sfx(sections.get("sfx", ""))})
    write_json(args.output / "music.json", {"patterns": parse_music(sections.get("music", ""))})
    write_json(
        args.output / "manifest.json",
        {
            "source": str(args.input.resolve()),
            "source_sha256": hashlib.sha256(raw).hexdigest(),
            "version": version,
            "sections": sorted(sections),
            "section_order": list(sections),
            "lua_chars": len(lua),
            "lua_lines": len(lua.splitlines()),
            "nonzero_primary_map_cells": sum(value != 0 for row in top_map for value in row),
            "nonzero_shared_alias_bytes": sum(value != 0 for row in aliased_map for value in row),
            "nonzero_sprite_flags": sum(value != 0 for value in flags),
            "resource_hashes": {
                "lua": semantic_hash(lua),
                "gfx_pixels": semantic_hash(gfx_rows),
                "shared_alias": semantic_hash(aliased_map),
                "primary_map": semantic_hash(top_map),
                "sprite_flags": semantic_hash(flags),
                "sfx": semantic_hash(parse_sfx(sections.get("sfx", ""))),
                "music": semantic_hash(parse_music(sections.get("music", ""))),
                "label_pixels": semantic_hash(label_rows),
            },
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
