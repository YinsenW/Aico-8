#!/usr/bin/env python3
"""Capture or validate PICO-8 printh probe output."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


PREFIX = "p8probe|"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True, help="Reference runtime executable")
    parser.add_argument("--cart", type=Path, required=True)
    parser.add_argument("--expected", type=Path, help="Expected event JSON; omit to capture a new trace")
    parser.add_argument("--output", type=Path, help="Write the captured result as JSON")
    parser.add_argument("runtime_args", nargs="*")
    args = parser.parse_args()

    command = [args.runtime, *args.runtime_args, str(args.cart.resolve())]
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
    events = []
    for line in result.stdout.splitlines():
        position = line.find(PREFIX)
        if position < 0:
            continue
        parts = line[position + len(PREFIX) :].split("|", 1)
        if len(parts) == 2:
            events.append(parts)

    report = {
        "probe": args.cart.stem,
        "command": command,
        "returncode": result.returncode,
        "events": events,
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.expected is None:
        report["status"] = "captured"
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if result.returncode == 0 else 2

    expected = json.loads(args.expected.read_text(encoding="utf-8"))["events"]
    if events != expected or result.returncode != 0:
        print(json.dumps({"command": command, "returncode": result.returncode, "expected": expected, "actual": events, "output": result.stdout}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"probe": args.cart.stem, "events": events, "status": "pass"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
