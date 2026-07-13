#!/usr/bin/env python3
"""Rebuild a text PICO-8 cart from an extracted resource workspace."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from PIL import Image

from analyze_p8_corpus import parse_sections
from extract_p8_resources import PICO8_PALETTE, semantic_hash, shared_map_rows


PALETTE_INDEX = {color: index for index, color in enumerate(PICO8_PALETTE)}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def require_int(value: Any, low: int, high: int, context: str) -> int:
    if not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{context} must be an integer from {low} to {high}, got {value!r}")
    return value


def read_pico8_image(path: Path) -> list[list[int]]:
    image = Image.open(path).convert("RGBA")
    if image.size != (128, 128):
        raise ValueError(f"{path} must be exactly 128x128 pixels")
    rows: list[list[int]] = []
    pixels = image.load()
    for y in range(128):
        row = []
        for x in range(128):
            red, green, blue, alpha = pixels[x, y]
            color = (red, green, blue)
            if alpha == 0:
                row.append(0)
            elif color in PALETTE_INDEX:
                row.append(PALETTE_INDEX[color])
            else:
                raise ValueError(
                    f"{path} pixel ({x},{y}) uses {color}, which is not in the PICO-8 palette"
                )
        rows.append(row)
    return rows


def encode_shared_map(gfx_rows: list[list[int]], shared_rows: list[list[int]]) -> None:
    flat = [require_int(value, 0, 255, "shared map cell") for row in shared_rows for value in row]
    if len(flat) != 4096:
        raise ValueError("map.json shared_alias_rows must contain 32 rows of 128 bytes")
    for index, value in enumerate(flat):
        pixel_y = 64 + index // 64
        pixel_x = (index % 64) * 2
        gfx_rows[pixel_y][pixel_x] = value & 0x0F
        gfx_rows[pixel_y][pixel_x + 1] = (value >> 4) & 0x0F


def pixel_lines(rows: list[list[int]]) -> list[str]:
    if len(rows) != 128 or any(len(row) != 128 for row in rows):
        raise ValueError("pixel resource must be 128x128")
    return ["".join(format(require_int(value, 0, 15, "pixel"), "x") for value in row) for row in rows]


def map_lines(rows: list[list[int]]) -> list[str]:
    if len(rows) != 32 or any(len(row) != 128 for row in rows):
        raise ValueError("map.json primary_rows must contain 32 rows of 128 bytes")
    return ["".join(format(require_int(value, 0, 255, "map cell"), "02x") for value in row) for row in rows]


def flag_lines(flags: list[int]) -> list[str]:
    if len(flags) != 256:
        raise ValueError("sprite_flags.json must contain exactly 256 flag bytes")
    encoded = [format(require_int(value, 0, 255, "sprite flag"), "02x") for value in flags]
    return ["".join(encoded[:128]), "".join(encoded[128:])]


def sfx_lines(sfx_items: list[dict[str, Any]]) -> list[str]:
    by_index = {require_int(item.get("index"), 0, 63, "sfx index"): item for item in sfx_items}
    lines: list[str] = []
    count = max(by_index, default=-1) + 1
    for index in range(count):
        item = by_index.get(index, {})
        properties_raw = item.get("properties_raw")
        if properties_raw is not None:
            if len(properties_raw) != 4:
                raise ValueError("SFX properties_raw must contain exactly four bytes")
            header_bytes = [
                require_int(value, 0, 255, f"properties_raw[{offset}]")
                for offset, value in enumerate(properties_raw)
            ]
        else:
            # Backward compatibility with workspaces extracted before the raw
            # SFX property header was made explicit.
            raw_filter = item.get("filter_editor_byte_raw")
            if raw_filter is None:
                raw_filter = item.get("editor_mode", 0)
            header_bytes = [
                require_int(raw_filter, 0, 255, "filter_editor_byte_raw"),
                require_int(item.get("speed", 16), 0, 255, "speed"),
                require_int(item.get("loop_start", 0), 0, 255, "loop_start"),
                require_int(item.get("loop_end", 0), 0, 255, "loop_end"),
            ]
        header = "".join(format(value, "02x") for value in header_bytes)
        notes = item.get("notes", [])
        by_note = {require_int(note.get("index"), 0, 31, "note index"): note for note in notes}
        encoded_notes = []
        for note_index in range(32):
            note = by_note.get(note_index, {})
            pitch = require_int(note.get("pitch", 0), 0, 63, "pitch")
            waveform = require_int(note.get("waveform", 0), 0, 15, "waveform")
            volume = require_int(note.get("volume", 0), 0, 7, "volume")
            effect = require_int(note.get("effect", 0), 0, 7, "effect")
            encoded_notes.append(f"{pitch:02x}{waveform:x}{volume:x}{effect:x}")
        lines.append(header + "".join(encoded_notes))
    return lines


def music_lines(patterns: list[dict[str, Any]]) -> list[str]:
    by_index = {require_int(item.get("index"), 0, 63, "music pattern index"): item for item in patterns}
    lines: list[str] = []
    count = max(by_index, default=-1) + 1
    for index in range(count):
        item = by_index.get(index, {})
        flags = require_int(item["flags_raw"], 0, 255, "raw music flags") if "flags_raw" in item else (
            int(bool(item.get("loop_start")))
            | (int(bool(item.get("loop_end"))) << 1)
            | (int(bool(item.get("stop"))) << 2)
        )
        channels_raw = item.get("channels_raw")
        if channels_raw is not None:
            if len(channels_raw) != 4:
                raise ValueError(f"music pattern {index} channels_raw must contain four bytes")
            encoded_channels = [require_int(value, 0, 127, "raw sfx channel") for value in channels_raw]
            lines.append(f"{flags:02x} " + "".join(f"{value:02x}" for value in encoded_channels))
            continue
        channels = item.get("channels", [None, None, None, None])
        if len(channels) != 4:
            raise ValueError(f"music pattern {index} must contain four channels")
        encoded_channels = []
        for channel_index, value in enumerate(channels):
            encoded_channels.append(0x41 + channel_index if value is None else require_int(value, 0, 63, "sfx channel"))
        lines.append(f"{flags:02x} " + "".join(f"{value:02x}" for value in encoded_channels))
    return lines


def append_section(parts: list[str], name: str, lines: list[str]) -> None:
    parts.append(f"__{name}__")
    parts.extend(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path, help="Directory made by extract_p8_resources.py")
    parser.add_argument("output", type=Path, help="Rebuilt .p8 file")
    args = parser.parse_args()

    manifest = read_json(args.workspace / "manifest.json")
    source_text = (args.workspace / "source.p8").read_text(encoding="utf-8")
    source_sections, source_version = parse_sections(source_text)
    version = manifest.get("version", source_version)

    lua = (args.workspace / "code.p8.lua").read_text(encoding="utf-8")
    gfx_rows = read_pico8_image(args.workspace / "spritesheet.png")
    label_rows = read_pico8_image(args.workspace / "label.png")
    map_data = read_json(args.workspace / "map.json")
    primary_rows = map_data["primary_rows"]
    map_shared_rows = map_data["shared_alias_rows"]

    baseline_shared_hash = manifest["resource_hashes"]["shared_alias"]
    gfx_shared_rows = shared_map_rows(gfx_rows)
    gfx_changed = semantic_hash(gfx_shared_rows) != baseline_shared_hash
    map_changed = semantic_hash(map_shared_rows) != baseline_shared_hash
    if gfx_changed and map_changed and gfx_shared_rows != map_shared_rows:
        raise ValueError(
            "shared-memory conflict: spritesheet lower half and map.json shared_alias_rows "
            "were both changed differently"
        )
    if map_changed and gfx_shared_rows != map_shared_rows:
        encode_shared_map(gfx_rows, map_shared_rows)

    flags = read_json(args.workspace / "sprite_flags.json")["flags"]
    sfx = read_json(args.workspace / "sfx.json")["sfx"]
    music = read_json(args.workspace / "music.json")["patterns"]

    section_lines = {
        "lua": lua.split("\n"),
        "gfx": pixel_lines(gfx_rows),
        "label": pixel_lines(label_rows),
        "gff": flag_lines(flags),
        "map": map_lines(primary_rows),
        "sfx": sfx_lines(sfx),
        "music": music_lines(music),
    }
    current_hashes = {
        "lua": semantic_hash(lua),
        "gfx": semantic_hash(gfx_rows),
        "label": semantic_hash(label_rows),
        "gff": semantic_hash(flags),
        "map": semantic_hash(primary_rows),
        "sfx": semantic_hash(sfx),
        "music": semantic_hash(music),
    }
    baseline_hashes = manifest["resource_hashes"]
    baseline_keys = {
        "lua": "lua",
        "gfx": "gfx_pixels",
        "label": "label_pixels",
        "gff": "sprite_flags",
        "map": "primary_map",
        "sfx": "sfx",
        "music": "music",
    }
    original_sections = set(manifest.get("sections", source_sections))
    included = {
        name
        for name in section_lines
        if name in original_sections
        or current_hashes[name] != baseline_hashes[baseline_keys[name]]
    }
    included.add("lua")

    canonical_order = ["lua", "gfx", "gff", "map", "sfx", "music", "label"]
    original_order = manifest.get("section_order", list(source_sections))
    output_order = [name for name in original_order if name in included]
    output_order.extend(name for name in canonical_order if name in included and name not in output_order)

    parts = ["pico-8 cartridge // http://www.pico-8.com", f"version {version}"]
    for name in output_order:
        append_section(parts, name, section_lines[name])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(parts) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
