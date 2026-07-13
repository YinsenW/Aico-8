#!/usr/bin/env python3
"""Inventory decoded PICO-8 .p8 carts without modifying them."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path


SECTION_RE = re.compile(r"^__([a-z0-9_]+)__$")

FEATURE_PATTERNS = {
    "update_30": r"\b(?:function\s+_update\s*\(|_update\s*=)",
    "update_60": r"\b(?:function\s+_update60\s*\(|_update60\s*=)",
    "draw_callback": r"\b(?:function\s+_draw\s*\(|_draw\s*=)",
    "init_callback": r"\b(?:function\s+_init\s*\(|_init\s*=)",
    "controller_input": r"\bbtnp?\s*\(",
    "mouse_or_keyboard": r"\bstat\s*\(\s*(?:3[0-9])\b",
    "memory_read": r"\bpeek(?:2|4)?\s*\(",
    "memory_write": r"\bpoke(?:2|4)?\s*\(",
    "memory_copy": r"\bmem(?:cpy|set)\s*\(",
    "dynamic_map": r"\bm(?:get|set)\s*\(",
    "map_draw": r"\bmap\s*\(",
    "sprite_draw": r"\b(?:s?spr)\s*\(",
    "primitive_draw": r"\b(?:pset|pget|line|rectf?|circfill|circ|oval|ovalfill)\s*\(",
    "palette_fx": r"\b(?:pal|palt|fillp)\s*\(",
    "texture_line": r"\btline\s*\(",
    "sfx_playback": r"\bsfx\s*\(",
    "music_playback": r"\bmusic\s*\(",
    "persistent_data": r"\b(?:cartdata|dget|dset)\s*\(",
    "multi_cart": r"\b(?:load|reload)\s*\(",
    "custom_menu": r"\bmenuitem\s*\(",
    "camera": r"\bcamera\s*\(",
    "serial_io": r"\bserial\s*\(",
    "host_command": r"\bextcmd\s*\(",
    "fixed_point_bitops": r"(?:\bshl\s*\(|\bshr\s*\(|\blshr\s*\(|\brotl\s*\(|\brotr\s*\(|>>|<<|\^|\&|\|)",
}

COMPILED_FEATURES = {
    name: re.compile(pattern, re.IGNORECASE)
    for name, pattern in FEATURE_PATTERNS.items()
}


@dataclass(frozen=True)
class CartRecord:
    path: str
    filename: str
    version: int | None
    sha256: str
    title: str | None
    byline: str | None
    lua_chars: int
    lua_lines: int
    sections: list[str]
    section_payload_chars: dict[str, int]
    features: list[str]


def parse_sections(text: str) -> tuple[dict[str, str], int | None]:
    sections: dict[str, list[str]] = defaultdict(list)
    current: str | None = None
    version: int | None = None

    for line in text.splitlines():
        if line.startswith("version "):
            try:
                version = int(line.split(None, 1)[1])
            except ValueError:
                pass
        match = SECTION_RE.fullmatch(line.strip())
        if match:
            current = match.group(1)
            continue
        if current is not None:
            sections[current].append(line)

    return {name: "\n".join(lines) for name, lines in sections.items()}, version


def title_and_byline(lua: str) -> tuple[str | None, str | None]:
    comments: list[str] = []
    for line in lua.splitlines():
        stripped = line.strip()
        if not stripped:
            if comments:
                break
            continue
        if not stripped.startswith("--"):
            break
        value = stripped[2:].strip()
        if value:
            comments.append(value)
        if len(comments) == 2:
            break
    return (
        comments[0] if comments else None,
        comments[1] if len(comments) > 1 else None,
    )


def inspect_cart(path: Path) -> CartRecord:
    raw = path.read_bytes()
    text = raw.decode("utf-8", errors="replace")
    sections, version = parse_sections(text)
    lua = sections.get("lua", "")
    title, byline = title_and_byline(lua)
    features = sorted(
        name for name, pattern in COMPILED_FEATURES.items() if pattern.search(lua)
    )
    return CartRecord(
        path=str(path.resolve()),
        filename=path.name,
        version=version,
        sha256=hashlib.sha256(raw).hexdigest(),
        title=title,
        byline=byline,
        lua_chars=len(lua),
        lua_lines=len(lua.splitlines()),
        sections=sorted(sections),
        section_payload_chars={name: len(value) for name, value in sections.items()},
        features=features,
    )


def percentile(values: list[int], fraction: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def build_summary(records: list[CartRecord]) -> dict[str, object]:
    feature_counts = Counter(feature for record in records for feature in record.features)
    section_counts = Counter(section for record in records for section in record.sections)
    version_counts = Counter(record.version for record in records)
    hashes: dict[str, list[str]] = defaultdict(list)
    for record in records:
        hashes[record.sha256].append(record.filename)
    duplicate_groups = [names for names in hashes.values() if len(names) > 1]
    lua_chars = [record.lua_chars for record in records]

    return {
        "cart_count": len(records),
        "versions": {str(key): value for key, value in sorted(version_counts.items(), key=lambda x: str(x[0]))},
        "sections": dict(sorted(section_counts.items())),
        "features": dict(sorted(feature_counts.items())),
        "lua_chars": {
            "min": min(lua_chars, default=0),
            "median": statistics.median(lua_chars) if lua_chars else 0,
            "mean": round(statistics.mean(lua_chars), 2) if lua_chars else 0,
            "p90": percentile(lua_chars, 0.9),
            "max": max(lua_chars, default=0),
        },
        "duplicate_groups": sorted(duplicate_groups),
    }


def print_text(summary: dict[str, object], records: list[CartRecord]) -> None:
    print(f"Carts: {summary['cart_count']}")
    print(f"Versions: {summary['versions']}")
    print(f"Lua chars: {summary['lua_chars']}")
    print("Sections:")
    for name, count in summary["sections"].items():
        print(f"  {name:10} {count}")
    print("Features:")
    for name, count in summary["features"].items():
        print(f"  {name:20} {count}")
    print("Duplicate groups:")
    for group in summary["duplicate_groups"]:
        print("  " + " | ".join(group))
    print("Largest Lua sources:")
    for record in sorted(records, key=lambda item: item.lua_chars, reverse=True)[:15]:
        print(f"  {record.lua_chars:6}  {record.filename}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path, help="A .p8 file or directory of decoded carts")
    parser.add_argument("--json", action="store_true", help="Emit detailed JSON")
    args = parser.parse_args()

    paths = [args.path] if args.path.is_file() else sorted(args.path.rglob("*.p8"))
    records = [inspect_cart(path) for path in paths]
    summary = build_summary(records)

    if args.json:
        print(json.dumps({"summary": summary, "carts": [asdict(r) for r in records]}, ensure_ascii=False, indent=2))
    else:
        print_text(summary, records)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
