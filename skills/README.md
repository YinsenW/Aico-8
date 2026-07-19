# Aico 8 Skill boundary

The host-neutral Agent Skill and optional Codex plugin wrapper expose the maintained human-guided
[aico8-remake](../plugins/aico8/skills/aico8-remake/SKILL.md) entry. A non-technical user attaches one
authorized cart and asks for Web, Android APK, or both; the Agent owns bootstrap,
private intake, Jobs, validation, and artifact handoff.

The Skill is a thin operator for the Aico 8 CLI and manifests. It may:

- accept an authorized cart and a `web`, `android`, or `both` target;
- hide engine paths, environment diagnosis, commands, and artifact locations;
- run ingest, analysis, capture, modeling, asset, validation, and packaging stages;
- choose retries and specialized tools from machine-readable evidence;
- pause for artistic, legal, accessibility, and release approval;
- summarize validation failures and propose bounded remediation.

Android is a packaging target over the exact validated Web/Wasm bytes, not a
second remake implementation. Release signing and publication remain separate.

It does not duplicate runtime, decoder, renderer, platform packager, or oracle
logic. Its bootstrap installs the pinned full repository engine, including the
hash-verified prebuilt Web/Wasm kernel, into private local state. Therefore the
same Skill controls the real toolchain outside Codex instead of degrading into
an instruction-only document.
