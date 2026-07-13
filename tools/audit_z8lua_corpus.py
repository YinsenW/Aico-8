#!/usr/bin/env python3
"""Compile every cart's Lua chunk with z8lua without executing game code."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

from analyze_p8_corpus import parse_sections


FEATURE_PATTERNS = {
    "if_do_block": re.compile(r"\bif\s+(?:\([^\n]*?\)|[^\n]*?)\s+do(?:\s|$)"),
    "print_expression": re.compile(r"(?:=|\breturn\s+)\s*\?"),
    "binary_tilde": re.compile(r"(?:[\w\])}]|0x[0-9a-f.]+)\s*~(?!=)\s*(?:[\w\[({]|0x)", re.IGNORECASE),
}


def runtime_commit(runtime: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(runtime.parent), "rev-parse", "HEAD"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def detect_features(lua: str) -> dict[str, int]:
    return {name: len(pattern.findall(lua)) for name, pattern in FEATURE_PATTERNS.items()}


def compile_cart(runtime: Path, runtime_label: str, cart: Path) -> dict:
    text = cart.read_text(encoding="utf-8", errors="replace")
    sections, version = parse_sections(text)
    lua = sections.get("lua", "")
    # Returning a function forces the complete game chunk through the parser and
    # bytecode compiler while preventing top-level game/API calls from running.
    wrapped = f"return function()\n{lua}\nend\n"
    result = subprocess.run(
        [str(runtime), "-"],
        input=wrapped,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    item = {
        "cart": cart.name,
        "cart_sha256": hashlib.sha256(cart.read_bytes()).hexdigest(),
        "version": version,
        "lua_chars": len(lua),
        "returncode": result.returncode,
        "output": result.stdout.strip().replace(str(runtime), runtime_label),
    }
    if result.returncode != 0:
        item["detected_extensions"] = {
            name: count for name, count in detect_features(lua).items() if count
        }
        line_match = re.search(r"stdin:(\d+):", result.stdout)
        if line_match:
            # The compile-only wrapper adds exactly one line before cart code.
            item["lua_line"] = max(1, int(line_match.group(1)) - 1)
    return item


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("runtime", type=Path, help="Built z8lua executable")
    parser.add_argument("path", type=Path, help="Decoded .p8 cart or directory")
    parser.add_argument(
        "--runtime-label",
        help="Stable report label used instead of the executable's absolute path",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    runtime = args.runtime.resolve()
    runtime_label = args.runtime_label or str(runtime)
    carts = [args.path] if args.path.is_file() else sorted(args.path.rglob("*.p8"))
    results = [compile_cart(runtime, runtime_label, cart) for cart in carts]
    failures = [item for item in results if item["returncode"] != 0]
    report = {
        "schema_version": 2,
        "runtime": runtime_label,
        "runtime_commit": runtime_commit(runtime),
        "cart_count": len(results),
        "pass_count": len(results) - len(failures),
        "failure_count": len(failures),
        "failures": failures,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
