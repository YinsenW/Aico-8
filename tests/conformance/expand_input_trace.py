#!/usr/bin/env python3
"""Expand a logical-update input trace to a deterministic mask stream."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("trace", type=Path)
    parser.add_argument("--format", choices=("csv", "json"), default="csv")
    parser.add_argument(
        "--repeat-each",
        type=int,
        default=1,
        help="Repeat each logical-update mask for a runtime adapter that samples more than once per update",
    )
    args = parser.parse_args()

    trace = json.loads(args.trace.read_text(encoding="utf-8"))
    update_count = int(trace["update_count"])
    masks = [0] * update_count
    assigned = [False] * update_count
    for span in trace["spans"]:
        first = int(span["from_update"])
        last = int(span["through_update"])
        mask = int(span["player_0_mask"])
        if first < 1 or last > update_count or first > last or not 0 <= mask <= 0x3F:
            raise ValueError(f"invalid input span: {span}")
        for update in range(first, last + 1):
            if assigned[update - 1]:
                raise ValueError(f"overlapping input span at update {update}")
            masks[update - 1] = mask
            assigned[update - 1] = True

    if args.repeat_each < 1:
        raise ValueError("--repeat-each must be positive")
    expanded = [mask for mask in masks for _ in range(args.repeat_each)]

    if args.format == "json":
        print(json.dumps(expanded))
    else:
        print(",".join(str(mask) for mask in expanded))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
