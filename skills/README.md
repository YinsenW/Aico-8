# Aico 8 Skill boundary

The maintained human-guided Skill is [aico8-remake](aico8-remake/SKILL.md).
It packages the stabilized supervised workflow while keeping all executable
logic in versioned Jobs.

The Skill is a thin operator for the Aico 8 CLI and manifests. It may:

- accept an authorized cart and desired release targets;
- run ingest, analysis, capture, modeling, asset, validation, and packaging stages;
- choose retries and specialized tools from machine-readable evidence;
- pause for artistic, legal, accessibility, and release approval;
- summarize validation failures and propose bounded remediation.

It will not contain the runtime, cart decoder, renderer, platform packagers, or
test oracle. Those remain ordinary versioned software in this repository so
they can be built, reviewed, tested, and reused without an agent.
