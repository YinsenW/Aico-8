# Aico 8 product requirements (PRD)

## Product outcome

Aico 8 turns legally supplied PICO-8 cartridges into modern, high-fidelity
1024x1024 remakes while preserving original logic, timing, input feel, memory,
persistence, music, and sound effects. The first complete trial target is a
private, standalone browser-playable Dust Bunny remake used only for research
and testing; no formal release occurs without permission. Later builds may bind
several independently validated remakes into one fixed collection.

Current status, exits, evidence, selectors, and unfinished work are owned by
`governance/project.json`, not this PRD.

## Product principles

1. Compatibility state is authoritative; HD presentation is replaceable.
2. The original cart runs unchanged unless an explicit, reviewed product option
   documents a deliberate behavior change.
3. Unknown or unsafe replacements force whole-scene indexed diagnostic mode and block HD acceptance; reference pixels never mix into a modern frame.
4. Browser Web/PWA is first; Android and Linux handhelds reuse the same Web host;
   future ESP32 reuses contracts. A 1024x1024 square handheld is a first-class native-1:1, 8x-scale Web layout.
5. Audio preserves original composition and synthesis intent by default.
6. Publication is separate from technical readiness and always passes rights review.
7. Agents advance the project through tested tools and durable evidence, not
   undocumented prompt memory.
8. Readable modern typography is a presentation enhancement; original P8SCII
   metrics, control effects, and custom glyph behavior remain compatibility truth.
9. Runtime and games are internally modular, while public delivery starts with
   statically bound standalone artifacts rather than a general cartridge player.
10. A multi-cart request fans out into isolated workspaces and acceptance records;
    one game's success may never hide another game's failure.

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

Render every reachable entity, tile, UI, animation, lighting, and effect at the
canonical 1024 design resolution. Preserve each source element's recognizable
role, silhouette, anatomy/key parts, proportions, face/expression, color hierarchy,
screen footprint, motion, and gameplay cue while applying one coherent modern
visual grammar. Modernization may add material, light, detail, and animation
quality but cannot redesign those identity anchors. Runtime output must use frozen, hashed assets and deterministic render
rules rather than model generation. Accepted HD play may not mix indexed source
fragments with modern elements; the exact reference renderer is a separate
diagnostic mode. Enabling HD must not change compatibility snapshots. Rendered
copy must be source-authored, state-derived for accessibility, or backed by a
durable product authorization; unapproved slogans and celebration text fail HD.

“Preserve” is identity preservation, not literal pixel enlargement. Traits are
declared per source element, never as universal aesthetic rules: for example, a
round, cute rabbit with two ears and whiskers must remain round-faced, cute,
two-eared, and whiskered, while an originally long-faced character must remain
long-faced. An unsupported face-shape change, missing declared part, changed
expression, or materially different proportion is a failed remake even if the
new drawing is technically polished. Required parts map source evidence to target
asset regions, and declared source/target ratios must remain within explicit
tolerances.

Contracts: `API-SEMANTIC-001`, `API-PRESENTATION-001`, `DATA-HD-MAP-001`,
`DATA-HD-AUDIT-001`, `DATA-ASSET-PACK-001`, `JOB-MODEL-001`, `JOB-ASSET-001`,
`JOB-INTEGRATE-001`, `JOB-VALIDATE-001`.

### REQ-TYPOGRAPHY-001 — Readable standardized text without compatibility drift

Render recognized labels, dialogue, HUD values, and localized copy with bundled,
versioned modern fonts at accessible sizes. The compatibility core must still
execute the original P8SCII byte stream, custom-font memory, cursor behavior,
side effects, and `print()` metrics. A semantic text run may be modernized only
when its typography manifest mapping is explicit and safe; inline/custom/unknown
glyphs require an explicit meaning-preserving modern mapping before HD acceptance.
Reference text is available only in whole-scene diagnostic mode, never mixed into
the accepted modern frame. Modern font layout never writes back into Lua-visible state.

Contracts: `API-TEXT-001`, `DATA-TEXT-RUN-001`, `DATA-TYPOGRAPHY-001`,
`DATA-ASSET-PACK-001`, `JOB-TYPOGRAPHY-001`, `JOB-VALIDATE-001`.

### REQ-WEB-001 — Browser-playable first release

Provide a responsive TypeScript/PixiJS Web/PWA host that loads the same kernel as
WebAssembly, runs a fixed-step loop, restores saves, exposes compatibility
diagnostics, and produces a reproducible standalone single-game build. A portable
single HTML is a convenience artifact; the installable/offline release is a PWA.

Contracts: `API-WASM-001`, `API-PRESENTATION-001`, `DATA-RELEASE-001`,
`DATA-TARGET-PROFILE-001`, `JOB-ASSEMBLE-001`, `JOB-PACKAGE-001`.

### REQ-DELIVERY-001 — Internal modules and statically bound products

Represent each validated remake as a versioned internal game module. Build one
module as a standalone product by default, or bind several validated modules into
a fixed collection with isolated saves and licenses. Do not publish a general
external-cart Player or freeze `.aico8` before repeated multi-game evidence.

Contracts: `API-GAME-MODULE-001`, `DATA-GAME-MODULE-001`,
`DATA-COLLECTION-001`, `DATA-TARGET-PROFILE-001`, `JOB-ASSEMBLE-001`,
`JOB-PACKAGE-001`.

### REQ-BATCH-001 — Isolated multi-cart conversion

Accept one cart, a list, or a directory through a versioned batch manifest. Each
cart receives its own workspace, provenance, Job state, validation, retry, and
failure result before any accepted modules are assembled into a collection.

Contracts: `DATA-BATCH-001`, `DATA-GAME-MODULE-001`, `DATA-COLLECTION-001`,
`JOB-BATCH-001`, `JOB-ASSEMBLE-001`.

### REQ-PLATFORM-001 — Shared Web host on Android and Linux handhelds

After the standalone browser Web/PWA game passes, package that exact Web host,
Wasm kernel, presentation, and validated module for Android APK/AAB. Then support
Linux handhelds through a compatible browser/PWA, adding a thin Web shell only
when a named device cannot meet lifecycle, controller, storage, or offline needs
directly. Platform adapters may not fork gameplay. Windows, macOS, and iOS are
outside the current delivery roadmap.

Contracts: `API-HOST-001`, `API-GAME-MODULE-001`,
`DATA-TARGET-PROFILE-001`, `DATA-VALIDATION-001`, `JOB-ASSEMBLE-001`,
`JOB-VALIDATE-001`, `JOB-PACKAGE-001`.

### REQ-EMBEDDED-001 — Constrained ESP32-P4 profile after Web

Run the same compatibility truth and internal module contract in an ESP32-P4
host with explicit firmware, RAM, flash, frame, audio, input, storage, and board
budgets. Embedded presentation may use derived assets and physical resolution;
it may not require a browser or block the first Web game.

Contracts: `API-CORE-001`, `API-HOST-001`, `API-GAME-MODULE-001`,
`DATA-GAME-MODULE-001`, `DATA-TARGET-PROFILE-001`, `DATA-VALIDATION-001`,
`JOB-ASSEMBLE-001`, `JOB-VALIDATE-001`, `JOB-PACKAGE-001`.

### REQ-INPUT-001 — Modern input without feel drift

Support keyboard and controller first, then touch controls mapped to logical
PICO-8 input sampling. Responsive layout, safe areas, and presentation refresh
must not change update order or button-repeat behavior.

Contracts: `API-HOST-001`, `DATA-INPUT-TRACE-001`, `JOB-VALIDATE-001`.

### REQ-REMAKE-001 — Complete private Dust Bunny trial

Cover title, all levels, ending, resume/restart persistence, player/body states,
dirt, walls, particles, text, palette transitions, animation, effects, touch,
and test packaging while preserving documented original quirks. Every required
level and ending must be reached on the unchanged cart through ordinary PICO-8
button input; test hooks, state edits, level skips, and omitted logical updates
cannot prove completion. This is a private research/test artifact, not a formal
release authorization.

Contracts: `DATA-HD-MAP-001`, `DATA-HD-AUDIT-001`, `DATA-ASSET-PACK-001`, `DATA-REPLAY-001`,
`DATA-GAME-MODULE-001`, `DATA-TARGET-PROFILE-001`, `JOB-INTEGRATE-001`,
`JOB-VALIDATE-001`, `JOB-ASSEMBLE-001`, `JOB-PACKAGE-001`.

### REQ-QUALIFICATION-001 — Ten-game canonical qualification

Qualify the shared Web-first conversion path on at least ten authorized,
materially different, finite games. Each game must replay every required level,
ending, and progression boundary on an unchanged cart using only real logical
button input, retain per-game evidence and rights isolation, and cover a declared
compatibility/presentation risk matrix. Instrumented reachability is diagnostic
only and cannot count a game toward ten.

Any faster shadow model used to search for inputs is non-authoritative. Before a
candidate can enter canonical replay, every modeled transition it exercises must
match the unchanged cart after the same input for declared state fields. A found
semantic mismatch requires a root-cause category, a general invariant, a
regression fixture, and a mutation check that proves the test detects the faulty
rule; level-specific solver exceptions cannot satisfy qualification.

Contracts: `DATA-INPUT-TRACE-001`, `DATA-REPLAY-001`, `DATA-CHECKPOINT-001`,
`DATA-VALIDATION-001`, `JOB-CAPTURE-001`, `JOB-VALIDATE-001`.

### REQ-RELEASE-001 — Permission-aware, reproducible packaging

Generate Web/PWA artifacts, notices, provenance, checksums, and release metadata.
Each target profile declares measurable package, startup, and frame budgets; a
same-build report must pass them in its named environment. Collections include
only independently passing modules; technical readiness never grants publication or bypasses the independent permission and attribution rights gate.

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

Create the final Skill only after at least ten games pass canonical end-to-end
qualification and the reusable Jobs are stable. It invokes versioned Jobs and
contracts; runtime, codecs, validation, packaging, and publication policy remain
maintained software in this repository.

Contracts: all `JOB-*` pipeline contracts and `DATA-GOVERNANCE-001`.

## Private Dust Bunny acceptance boundary

The detailed behavioral reference, input replay, captures, and cart-specific
tests live only in the private research archive. Trial completion requires
one continuous or provenance-linked canonical replay that completes all 30
levels, ending, and restart without cart/state mutation; native/Wasm identity for
exercised semantics; complete content flows; coherent read-only HD presentation
with zero mixed indexed fragments or reference switches; same-build static and exact-update temporal
source/HD review; modern bundled text; keyboard/controller/touch operation; and a reproducible private
Web/PWA test package. The broader matrix remains owned by `EXIT-COMPAT-OFFICIAL`;
neither result is a formal remake release authorization.

## Non-goals for the first release

- Mechanical Lua-to-TypeScript translation as the compatibility path.
- Changing puzzles, collision, timing, RNG, or persistence to fit new art.
- Requiring Android packaging, Linux-device work, or ESP32 hardware before the
  first browser Web/PWA build.
- Building Windows, macOS, or iOS packages under the current roadmap.
- Publishing a dynamic Player or stable `.aico8` format before at least ten
  canonically qualified, materially different games prove the module boundary.
- Creating the final Skill before the workflow is stable and repeatedly verified.
