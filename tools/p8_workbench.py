#!/usr/bin/env python3
"""Create and repack editable, lossless PICO-8 cartridge workspaces."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


TOOLS_DIR = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def shrinko8_command(explicit: str | None) -> str:
    candidate = explicit or os.environ.get("SHRINKO8") or shutil.which("shrinko8")
    if not candidate:
        raise RuntimeError(
            "shrinko8 was not found. Install tools/requirements.txt in a virtual environment "
            "or pass --shrinko8 /path/to/shrinko8."
        )
    return candidate


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def convert(shrinko8: str, source: Path, target: Path, output_format: str | None = None) -> None:
    command = [shrinko8, str(source), str(target)]
    if output_format:
        command.extend(["--format", output_format])
    run(command)


def extracted_manifest(source_p8: Path, output: Path) -> dict:
    run([sys.executable, str(TOOLS_DIR / "extract_p8_resources.py"), str(source_p8), str(output)])
    return json.loads((output / "manifest.json").read_text(encoding="utf-8"))


def require_resource_match(
    expected: dict, actual: dict, context: str, *, check_sections: bool = True
) -> None:
    if expected.get("version") != actual.get("version"):
        raise RuntimeError(
            f"{context}: cart version changed from {expected.get('version')} to {actual.get('version')}"
        )
    expected_hashes = expected.get("resource_hashes", {})
    actual_hashes = actual.get("resource_hashes", {})
    if expected_hashes != actual_hashes:
        differing = sorted(
            key
            for key in set(expected_hashes) | set(actual_hashes)
            if expected_hashes.get(key) != actual_hashes.get(key)
        )
        raise RuntimeError(f"{context}: resource hashes changed: {', '.join(differing)}")
    if check_sections and expected.get("sections") != actual.get("sections"):
        raise RuntimeError(
            f"{context}: section presence changed from {expected.get('sections')} "
            f"to {actual.get('sections')}"
        )
    if (
        check_sections
        and expected.get("section_order")
        and expected.get("section_order") != actual.get("section_order")
    ):
        raise RuntimeError(
            f"{context}: section order changed from {expected.get('section_order')} "
            f"to {actual.get('section_order')}"
        )


def unpack(args: argparse.Namespace) -> int:
    shrinko8 = shrinko8_command(args.shrinko8)
    if args.output.exists() and any(args.output.iterdir()):
        raise RuntimeError(f"output directory is not empty: {args.output}")
    args.output.mkdir(parents=True, exist_ok=True)

    source_p8 = args.output / "source.p8"
    source_rom = args.output / "source.rom"
    convert(shrinko8, args.input, source_p8)
    convert(shrinko8, source_p8, source_rom, "rom")
    manifest = extracted_manifest(source_p8, args.output)
    manifest_path = args.output / "manifest.json"
    manifest["original_cart"] = {
        "path": str(args.input.resolve()),
        "sha256": sha256(args.input),
        "rom_sha256": sha256(source_rom),
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with tempfile.TemporaryDirectory(prefix="p8-workbench-") as temp_name:
        temp = Path(temp_name)
        rebuilt_p8 = temp / "rebuilt.p8"
        rebuilt_rom = temp / "rebuilt.rom"
        rebuilt_workspace = temp / "rebuilt-workspace"
        run([sys.executable, str(TOOLS_DIR / "rebuild_p8_from_resources.py"), str(args.output), str(rebuilt_p8)])
        convert(shrinko8, rebuilt_p8, rebuilt_rom, "rom")
        if source_rom.read_bytes() != rebuilt_rom.read_bytes():
            raise RuntimeError("internal validation failed: extracted workspace did not rebuild to the same ROM")
        rebuilt_manifest = extracted_manifest(rebuilt_p8, rebuilt_workspace)
        require_resource_match(manifest, rebuilt_manifest, "internal validation failed")

    print(f"unpacked and ROM/resource-verified: {args.output}")
    return 0


def pack(args: argparse.Namespace) -> int:
    shrinko8 = shrinko8_command(args.shrinko8)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="p8-workbench-") as temp_name:
        temp = Path(temp_name)
        rebuilt_p8 = temp / "rebuilt.p8"
        expected_rom = temp / "expected.rom"
        decoded_p8 = temp / "decoded.p8"
        decoded_rom = temp / "decoded.rom"
        decoded_workspace = temp / "decoded-workspace"
        run([sys.executable, str(TOOLS_DIR / "rebuild_p8_from_resources.py"), str(args.workspace), str(rebuilt_p8)])
        convert(shrinko8, rebuilt_p8, expected_rom, "rom")
        convert(shrinko8, rebuilt_p8, args.output)
        convert(shrinko8, args.output, decoded_p8)
        convert(shrinko8, decoded_p8, decoded_rom, "rom")
        if expected_rom.read_bytes() != decoded_rom.read_bytes():
            raise RuntimeError("packed .p8.png does not decode to the rebuilt ROM")
        expected_manifest = json.loads((args.workspace / "manifest.json").read_text(encoding="utf-8"))
        decoded_manifest = extracted_manifest(decoded_p8, decoded_workspace)
        # A PNG codec may omit text sections whose decoded resource is entirely
        # empty (most visibly __label__). ROM and resource hashes remain strict;
        # only textual section presence/order is allowed to canonicalize here.
        require_resource_match(
            expected_manifest,
            decoded_manifest,
            "packed .p8.png validation failed",
            check_sections=False,
        )
    print(f"packed and ROM/resource-verified: {args.output}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--shrinko8", help="Path to the pinned shrinko8 executable")
    subparsers = parser.add_subparsers(dest="command", required=True)

    unpack_parser = subparsers.add_parser("unpack")
    unpack_parser.add_argument("input", type=Path)
    unpack_parser.add_argument("output", type=Path)
    unpack_parser.set_defaults(handler=unpack)

    pack_parser = subparsers.add_parser("pack")
    pack_parser.add_argument("workspace", type=Path)
    pack_parser.add_argument("output", type=Path)
    pack_parser.set_defaults(handler=pack)

    args = parser.parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
