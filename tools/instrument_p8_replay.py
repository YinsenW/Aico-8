#!/usr/bin/env python3
"""Inject a deterministic logical-btnp replay and snapshot hook into a .p8 cart."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


SECTION_RE = re.compile(r"(?m)^__[a-z0-9_]+__\s*$")


def expand_masks(trace: dict) -> list[int]:
    if trace.get("input_semantics") != "logical_btnp_events":
        raise ValueError("trace input_semantics must be logical_btnp_events")
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
    return masks


def inject(source: str, lua_patch: str) -> str:
    lua_marker = re.search(r"(?m)^__lua__\s*$", source)
    if not lua_marker:
        raise ValueError("source cart has no __lua__ section")
    next_section = SECTION_RE.search(source, lua_marker.end())
    insertion = len(source) if next_section is None else next_section.start()
    prefix = source[:insertion].rstrip()
    suffix = source[insertion:].lstrip("\r\n")
    return f"{prefix}\n\n{lua_patch.rstrip()}\n{suffix}"


def replay_lua(masks: list[int], callback: str) -> str:
    encoded = ",".join(str(mask) for mask in masks)
    return f"""-- injected deterministic replay harness
local __replay_masks={{{encoded}}}
local __replay_index=0
local __replay_mask=0
local __replay_active=false
local __replay_native_btn=btn
local __replay_native_btnp=btnp
local __replay_game_init=_init
local __replay_game_update={callback}

function btn(b,p)
 if __replay_active then
  if b==nil then return __replay_mask end
  if p!=nil and p!=0 then return false end
  return (__replay_mask & (1<<b))!=0
 end
 return __replay_native_btn(b,p)
end

function btnp(b,p)
 if __replay_active then
  if b==nil then return __replay_mask end
  if p!=nil and p!=0 then return false end
  return (__replay_mask & (1<<b))!=0
 end
 return __replay_native_btnp(b,p)
end

function _init()
 __replay_index=0
 __replay_mask=0
 if __replay_game_init then __replay_game_init() end
 if __replay_setup then __replay_setup() end
end

function {callback}()
 if __replay_index>=#__replay_masks then return end
 __replay_index+=1
 __replay_mask=__replay_masks[__replay_index] or 0
 __replay_active=true
 __replay_game_update()
 __replay_active=false
 if __replay_snapshot then
  __replay_snapshot(__replay_index,__replay_mask)
 end
 if __replay_index>=#__replay_masks then
  stop("replay complete")
 end
end
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("trace", type=Path)
    parser.add_argument("snapshot_lua", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--callback", choices=("_update", "_update60"), default="_update")
    args = parser.parse_args()

    source = args.source.read_text(encoding="utf-8")
    trace = json.loads(args.trace.read_text(encoding="utf-8"))
    masks = expand_masks(trace)
    snapshot = args.snapshot_lua.read_text(encoding="utf-8")
    patch = f"{snapshot.rstrip()}\n\n{replay_lua(masks, args.callback)}"
    instrumented = inject(source, patch)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(instrumented, encoding="utf-8")
    print(
        json.dumps(
            {
                "source": str(args.source.resolve()),
                "trace": str(args.trace.resolve()),
                "output": str(args.output.resolve()),
                "callback": args.callback,
                "updates": len(masks),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
