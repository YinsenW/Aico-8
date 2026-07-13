# Aico 8 product requirements (PRD)

## Product outcome

Aico 8 turns legally supplied PICO-8 cartridges into modern, high-fidelity
1024x1024 remakes while preserving original logic, timing, input feel, memory,
persistence, music, and sound effects. The first complete trial target is a
private, browser-playable Dust Bunny remake used only for research and testing;
no formal release occurs without permission.

Current status, exits, evidence, selectors, and unfinished work are owned by
`governance/project.json`, not this PRD.

## Product principles

1. Compatibility state is authoritative; HD presentation is replaceable.
2. The original cart runs unchanged unless an explicit, reviewed product option
   documents a deliberate behavior change.
3. Unknown or unsafe semantic replacements fall back to the indexed reference frame.
4. Web is the first playable target; mobile and embedded reuse versioned contracts.
5. Audio preserves original composition and synthesis intent by default.
6. Publication is separate from technical readiness and always passes rights review.
7. Agents advance the project through tested tools and durable evidence, not
   undocumented prompt memory.
8. Readable modern typography is a presentation enhancement; original P8SCII
   metrics, control effects, and custom glyph behavior remain compatibility truth.

## Requirements

### REQ-INGEST-001 — Lossless authorized-cart workspace

Accept `.p8`, `.p8.png`, and raw ROM inputs; preserve code, GFX/shared-map
aliasing, map, flags, SFX, music, label, version, hashes, and provenance in a
versioned workspace that can be rebuilt without semantic loss.

Contracts: `JOB-INGEST-001`, `DATA-CART-001`, `DATA-WORKSPACE-001`.

### REQ-COMPAT-001 — Deterministic PICO-8 compatibility

Run unchanged cart Lua with compatible fixed-point, RAM/ROM, draw, input, audio,
persistence, and 30/60 Hz behavior. Native and WebAssembly builds must produce
identical versioned checkpoints. Licensed official-runtime captures are the oracle.

Contracts: `API-CORE-001`, `API-RASTER-001`, `DATA-REPLAY-001`,
`DATA-CHECKPOINT-001`, `JOB-CAPTURE-001`, `JOB-VALIDATE-001`.

### REQ-HD-001 — Native 1024 presentation without gameplay drift

Render recognized entities, tiles, UI, animation, lighting, and effects at the
canonical 1024 design resolution while retaining an exact compatibility overlay
and fallback. Enabling HD must not change compatibility snapshots.

Contracts: `API-SEMANTIC-001`, `API-PRESENTATION-001`, `DATA-HD-MAP-001`,
`DATA-ASSET-PACK-001`, `JOB-MODEL-001`, `JOB-ASSET-001`, `JOB-INTEGRATE-001`.

### REQ-TYPOGRAPHY-001 — Readable standardized text without compatibility drift

Render recognized labels, dialogue, HUD values, and localized copy with bundled,
versioned modern fonts at accessible sizes. The compatibility core must still
execute the original P8SCII byte stream, custom-font memory, cursor behavior,
side effects, and `print()` metrics. A semantic text run may be modernized only
when its typography manifest mapping is explicit and safe; inline/custom/unknown
glyphs retain the indexed reference fallback. Modern font layout never writes
back into Lua-visible state.

Contracts: `API-TEXT-001`, `DATA-TEXT-RUN-001`, `DATA-TYPOGRAPHY-001`,
`DATA-ASSET-PACK-001`, `JOB-TYPOGRAPHY-001`, `JOB-VALIDATE-001`.

### REQ-WEB-001 — Browser-playable first release

Provide a responsive TypeScript/PixiJS Web/PWA host that loads the same kernel as
WebAssembly, runs a fixed-step loop, restores saves, exposes compatibility
diagnostics, and produces a reproducible deployable build.

Contracts: `API-WASM-001`, `API-PRESENTATION-001`, `DATA-RELEASE-001`,
`JOB-PACKAGE-001`.

### REQ-INPUT-001 — Modern input without feel drift

Support keyboard and controller first, then touch controls mapped to logical
PICO-8 input sampling. Responsive layout, safe areas, and presentation refresh
must not change update order or button-repeat behavior.

Contracts: `API-HOST-001`, `DATA-INPUT-TRACE-001`, `JOB-VALIDATE-001`.

### REQ-REMAKE-001 — Complete private Dust Bunny trial

Cover title, all levels, ending, resume/restart persistence, player/body states,
dirt, walls, particles, text, palette transitions, animation, effects, touch,
and test packaging while preserving documented original quirks. This is a
private research/test artifact, not a formal release authorization.

Contracts: `DATA-HD-MAP-001`, `DATA-ASSET-PACK-001`, `DATA-REPLAY-001`,
`JOB-INTEGRATE-001`, `JOB-VALIDATE-001`, `JOB-PACKAGE-001`.

### REQ-RELEASE-001 — Permission-aware, reproducible packaging

Generate Web/PWA release artifacts, notices, provenance, validation report,
checksums, and release metadata. A build may be technically ready while public
publication remains blocked by missing permission.

Contracts: `DATA-VALIDATION-001`, `DATA-RELEASE-001`, `JOB-PACKAGE-001`,
`JOB-RELEASE-001`.

### REQ-GOV-001 — AI-agent-first maintainability

Allow a new development agent to find scope, owners, current state, exits,
evidence, tests, open work, recovery steps, and handoff rules without reconstructing
product intent from chat history. All five governance dimensions must score at
least 9.5/10.

Contracts: `DATA-GOVERNANCE-001`, `TEST-GOV-001`.

### REQ-REPO-001 — Safe public source repository

Publish the Aico 8 toolchain and runtime in a public GitHub repository with an
owner-selected project source license, passing CI, dependency notices, and no
secrets, private inputs, official captures, or unlicensed cart-derived evidence
in reachable history. Public source readiness is separate from permission to
publish any generated remake.

Contracts: `DATA-GOVERNANCE-001`, `DATA-RELEASE-001`.

### REQ-SKILL-001 — Thin orchestration after proven releases

Create the final Skill only after multiple end-to-end remake and release exercises.
It invokes versioned Jobs and contracts; runtime, codecs, validation, packaging,
and publication policy remain maintained software in this repository.

Contracts: all `JOB-*` pipeline contracts and `DATA-GOVERNANCE-001`.

## Private Dust Bunny acceptance boundary

The detailed behavioral reference, input replay, captures, and cart-specific
tests live only in the private research archive. Trial completion requires
unchanged-cart boot, official state/raster checkpoints, HD-on/off invariance,
complete content flows, keyboard/controller/touch operation, and a reproducible
private Web/PWA test package. It does not satisfy the separate rights decision
and must not be described as a formally released remake.

## Non-goals for the first release

- Mechanical Lua-to-TypeScript translation as the compatibility path.
- Changing puzzles, collision, timing, RNG, or persistence to fit new art.
- Requiring mobile stores or ESP32 hardware before the first Web/PWA build.
- Creating the final Skill before the workflow is stable and repeatedly verified.
