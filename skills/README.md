# Aico 8 Skill boundary

The installable Aico 8 plugin exposes the maintained human-guided
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

It will not contain the runtime, cart decoder, renderer, platform packagers, or
test oracle. Those remain ordinary versioned software in this repository so
they can be built, reviewed, tested, and reused without an agent.
