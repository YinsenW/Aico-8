#!/usr/bin/env python3
"""Compare reproducible z8lua-only probes with the official expectation files."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CASES = {
    "numeric": (
        ROOT / "tests/vm/z8lua_numeric.lua",
        ROOT / "tests/conformance/expected/numeric_memory.json",
        8,
    ),
    "language": (
        ROOT / "tests/vm/z8lua_language.lua",
        ROOT / "tests/conformance/expected/language.json",
        None,
    ),
}
KNOWN_GAPS = {("language", "tonum_hex")}


def git_commit(runtime: Path) -> str | None:
    result = subprocess.run(
        ["git", "-C", str(runtime.parent), "rev-parse", "HEAD"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def read_expected(path: Path, limit: int | None) -> dict[str, str]:
    events = json.loads(path.read_text(encoding="utf-8"))["events"]
    if limit is not None:
        events = events[:limit]
    return dict(events)


def run_case(
    runtime: Path,
    runtime_label: str,
    name: str,
    script: Path,
    expected_path: Path,
    limit: int | None,
) -> dict:
    result = subprocess.run(
        [str(runtime), str(script)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    actual: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if line.startswith("p8vm|"):
            _, event, value = line.split("|", 2)
            actual[event] = value

    expected = read_expected(expected_path, limit)
    comparisons = []
    for event, expected_value in expected.items():
        actual_value = actual.get(event)
        comparisons.append(
            {
                "event": event,
                "expected": expected_value,
                "actual": actual_value,
                "pass": actual_value == expected_value,
                "known_gap": (name, event) in KNOWN_GAPS,
            }
        )
    return {
        "name": name,
        "script": str(script.relative_to(ROOT)),
        "returncode": result.returncode,
        "test_count": len(comparisons),
        "pass_count": sum(item["pass"] for item in comparisons),
        "comparisons": comparisons,
        "unparsed_output": [
            line.replace(str(runtime), runtime_label)
            for line in result.stdout.splitlines()
            if not line.startswith("p8vm|")
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("runtime", type=Path)
    parser.add_argument(
        "--runtime-label",
        help="Stable report label used instead of the executable's absolute path",
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    runtime_label = args.runtime_label or str(runtime)

    cases = [run_case(runtime, runtime_label, name, *case) for name, case in CASES.items()]
    unexpected = [
        comparison
        for case in cases
        for comparison in case["comparisons"]
        if not comparison["pass"] and not comparison["known_gap"]
    ]
    report = {
        "schema_version": 1,
        "runtime": runtime_label,
        "runtime_commit": git_commit(runtime),
        "test_count": sum(case["test_count"] for case in cases),
        "pass_count": sum(case["pass_count"] for case in cases),
        "known_gap_count": sum(
            not comparison["pass"] and comparison["known_gap"]
            for case in cases
            for comparison in case["comparisons"]
        ),
        "unexpected_failure_count": len(unexpected),
        "cases": cases,
    }
    rendered = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 1 if unexpected else 0


if __name__ == "__main__":
    raise SystemExit(main())
