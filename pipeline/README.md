# Aico 8 remake pipeline

The pipeline owns the repeatable transformation workflow. It does not own the
compatibility semantics themselves.

Planned versioned stages:

1. `ingest` — decode an authorized cart and record provenance.
2. `analyze` — inventory language/API/memory behavior and classify risk.
3. `capture` — produce official-runtime replay, frame, and audio goldens.
4. `model` — propose entities, tiles, UI, effects, and semantic command mappings.
5. `asset` — generate/import 1024-reference assets with explicit human acceptance.
6. `integrate` — create the HD adapter without changing compatibility state.
7. `validate` — run state, command, raster, audio, and platform comparisons.
8. `package` — build web, mobile, desktop, and embedded profiles.
9. `release` — enforce permission, attribution, notices, and signed artifacts.

Each stage will be exposed by a non-interactive CLI and will consume/produce a
versioned manifest. The supported product CLI is implemented in Node.js and
TypeScript. Current Python programs under `tools/` are research prototypes that
remain available while their tested behavior migrates behind those commands.
The future Skill orchestrates the CLI; it does not replace it with undocumented
prompt logic.
