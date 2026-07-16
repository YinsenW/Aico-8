# Aico 8 execution plan

This file owns dependency order and work packages; `governance/project.json` owns
focus, Exits, evidence, selectors, and open work. Never infer completion here.

| Stage | Product requirements | User-visible outcome |
| --- | --- | --- |
| M0 Governance/public source | REQ-GOV-001, REQ-REPO-001 | Recoverable AI-agent project and safe public toolchain |
| M1 Lossless internal module | REQ-INGEST-001, REQ-DELIVERY-001 | Rebuildable cart workspace and internal game-module contract |
| M2 Web compatibility dependency | REQ-COMPAT-001, REQ-INPUT-001 | Native/Wasm compatibility truth needed by the first game |
| M3 Original Web playability | REQ-WEB-001, REQ-REMAKE-001 | Private Dust Bunny playable in its original-compatible presentation |
| M4 Complete HD private trial | REQ-HD-001, REQ-TYPOGRAPHY-001, REQ-INPUT-001, REQ-REMAKE-001 | Complete modern graphics, text, audio, input, and saves |
| M5 Standalone Web/PWA | REQ-WEB-001, REQ-DELIVERY-001, REQ-RELEASE-001 | Reproducible private single-game Web package |
| M6 Supervised transfer qualification | REQ-QUALIFICATION-001, REQ-BATCH-001 | One accepted reference plus one materially different human-supervised transfer trial; batch remains deferred |
| M7 Handheld Web hosts | REQ-PLATFORM-001 | Android APK/AAB, then Linux handheld Web compatibility |
| M8 Future embedded research | REQ-EMBEDDED-001 | Optional constrained ESP32-P4 game firmware |
| M9 Thin Skill/Player decision | REQ-SKILL-001 | Proven Jobs gain a Skill; Player remains independently gated |

## M0 — Governance and public source

- `WP-M0-1`: reconcile PRD, architecture, contracts, ADRs, work packages, and manifest ownership; run the five-dimensional semantic and executable audit.
- `WP-M0-2`: audit current public Git refs, license/notices, ignored private inputs, CI, and repository visibility without treating private archives as public history.
- Acceptance: `EXIT-GOV-NAV`, `EXIT-GOV-CONSISTENCY`, `EXIT-GOV-TRACE`, `EXIT-GOV-DEVELOPMENT`, `EXIT-GOV-LEAN`, `EXIT-REPO-CONTENT`, and `EXIT-REPO-PUBLIC` remain verified at the exact revision; every dimension is at least 9.5 and the full public selector suite passes.

## M1 — Lossless workspace and internal module

- `WP-M1-1`: define cart, workspace, provenance, internal game-module, and Web target JSON Schemas with version/migration rules.
- `WP-M1-2`: add project-owned synthetic `.p8`, `.p8.png`, and ROM fixtures; prove unpack/rebuild hashes, shared-map aliases, code, graphics, map, flags, SFX, and music.
- `WP-M1-3`: assemble a synthetic internal module into a standalone Web build without a public `.aico8` or external Player dependency.
- Acceptance: `EXIT-INGEST-ROUNDTRIP`, `EXIT-INGEST-SCHEMA`, and `EXIT-DELIVERY-MODULE` pass with schemas, fixtures, evidence, and selectors.

## M2 — Compatibility required by Web

- `WP-M2-1`: finish required fixed-point, VM, RAM/ROM, raster, P8SCII, audio, persistence, 30/60 Hz, and input-repeat semantics against licensed official probes.
- `WP-M2-2`: expose the selected kernel through flat versioned Wasm buffers; boot the same synthetic/private cart natively and in-browser from one source revision.
- `WP-M2-3`: replay identical inputs and compare state, indexed frame, semantic command, text, and audio checkpoints byte-for-byte; freeze C++ or Rust only from recorded proof.
- Acceptance: `EXIT-COMPAT-BOOT`, `EXIT-COMPAT-RASTER`, `EXIT-COMPAT-WASM`, `EXIT-COMPAT-OFFICIAL`, and `EXIT-INPUT-CORE` pass for the semantics exercised by Dust Bunny.

## M3 — Original-compatible Dust Bunny on Web

- `WP-M3-1`: load the private cart and Wasm kernel in the TypeScript/PixiJS host; render the indexed framebuffer at the canonical 1024 design transform.
- `WP-M3-2`: add fixed-step scheduling, keyboard input, audio unlock, save restore, restart, diagnostics, error reporting, and responsive layout.
- `WP-M3-3`: exercise title, every level, ending, restart/resume, persistence, palette transitions, and documented quirks with private full-game replays.
- Acceptance: `EXIT-WEB-BOOT` and `EXIT-REMAKE-CONTENT` pass; the private browser build completes the entire original-compatible game before HD replacement is required.

## M4 — Complete modern presentation

- `WP-M4-1`: lock every reachable element's silhouette, anatomy, proportions, expression, color, footprint, motion, and gameplay cues; map only allowed modernization through one grammar and forbid mixed fallback.
- `WP-M4-2`: review, normalize, hash, and freeze the complete 1024 asset set; bind human acceptance to the exact pending evidence and deterministically rebuilt draft, then fail closed over contextual source tokens and prove scene-golden stability plus per-update HD-on/off state invariance for canonical replay and named reachable-state probes.
- `WP-M4-3`: execute original P8SCII truth, map every reachable run to licensed bundled modern fonts or approved modern icons, and validate layout, completeness, and accessibility.
- `WP-M4-4`: preserve dynamic synth behavior, validate any pre-rendered audio substitutions, then add controller and touch traces without feel drift.
- Acceptance: the first trial closes `EXIT-HD-DISPLAY`, `EXIT-HD-IDENTITY`, `EXIT-HD-COMPLETENESS`, `EXIT-INPUT-HOSTS`, `EXIT-REMAKE-PRESENTATION`, and `EXIT-REMAKE-INPUT`; broader HD-invariance and P8SCII exits stay open.

## M5 — First complete standalone Web game

- `WP-M5-1`: add offline/installable PWA behavior, portable single-HTML convenience output, save lifecycle, touch-safe areas, diagnostics, accessibility, and measured performance budgets.
- `WP-M5-2`: assemble/package one validated game module reproducibly from a clean public checkout plus authorized private input; generate hashes, notices, provenance, validation, and technical release metadata.
- `WP-M5-3`: run full-game browser automation and manual visual/audio/input review on every layout class owned by the Web target profile; bind active-browser overflow, clipping, game/control bounds, fonts, safe areas, screenshots, and the visual-runtime identity while keeping publication permission independent.
- Acceptance: `EXIT-WEB-PWA`, `EXIT-DELIVERY-SINGLE`, and `EXIT-REMAKE-PACKAGE` pass for the private artifact; formal `EXIT-RELEASE-TECHNICAL` and `EXIT-RELEASE-RIGHTS` remain independent.

## M6 — Human-supervised transfer qualification

- `WP-M6-1`: freeze Replay v1 schema/validator and prove contiguous real-input, unchanged-cart, no-hook/no-skip rules with public positive and negative fixtures.
- `WP-M6-2`: solve and replay Dust Bunny levels 1–30, ending, persistence, and restart on the unchanged private cart; first prove every shadow-model transition by unchanged-cart differential plus mutation regression, then compare HD off/on and repackage only after the trace passes.
- `WP-M6-3`: use Steps as a materially different supervised transfer trial. A human reviews source semantics, visual identity and art direction, representative gameplay, and final scope; the Agent records each decision and fixes reusable causes instead of inventing a universal mapping.
- `WP-M6-4`: classify every finding as compatibility/runtime, reusable presentation, or game-specific semantic/art direction. Add shared regression tests only for the first two classes and preserve explicit human pauses for the third.
- `WP-M6-5`: require a complete ordinary-input route only if Steps or a later candidate is promoted to a complete artifact. The route may be human-recorded; automation replays and verifies it deterministically. The former twelve-candidate plan remains optional diagnostic inventory, not a milestone gate.
- Acceptance: `EXIT-QUALIFICATION-REPLAY`, `EXIT-QUALIFICATION-SOLVER-DIFFERENTIAL`, `EXIT-QUALIFICATION-DUST`, `EXIT-QUALIFICATION-SUITE`, and `EXIT-QUALIFICATION-DIVERSITY` pass. Batch, collection, and `.aico8` remain separately deferred.

## M7 — Android and Linux handheld hosts

- `WP-M7-1`: wrap the unchanged Web/PWA artifact in Capacitor/WebView and produce signed Android test APK and release AAB with lifecycle, audio focus, storage, controller, touch, orientation, and resume tests.
- `WP-M7-2`: run that same artifact on named Linux handhelds using browser/PWA first; add a thin Web shell only for a measured gap, then test controller, storage, offline, lifecycle, performance, and clean installation.
- Acceptance: `EXIT-PLATFORM-ANDROID` and `EXIT-PLATFORM-LINUX-HANDHELD` pass independently and prove one Web application/runtime lineage; Windows, macOS, and iOS are outside this roadmap.

## M8 — Optional future ESP32-P4 constrained profile

- `WP-M8-1`: only after a future product decision, select a board/display/audio/input/storage baseline and publish hard flash, internal RAM, PSRAM, frame-time, boot-time, and power budgets.
- `WP-M8-2`: build the same native compatibility truth and module contract under ESP-IDF with tiled/strip rendering, derived assets, saves, and firmware/OTA packaging.
- `WP-M8-3`: replay a representative game on hardware, record state identity and measured budgets, then attempt a selected fixed collection only if storage permits.
- Acceptance: `EXIT-EMBEDDED-RUNTIME` and `EXIT-EMBEDDED-FIRMWARE` pass on named hardware; no JavaScript VM or alternate gameplay implementation is introduced.

## M9 — Thin Skill and possible Player

- `WP-M9-1`: package a thin Skill that accepts one/list/directory inputs, invokes versioned Jobs, reads machine evidence, retries bounded failures, and pauses for art/legal/release judgment.
- `WP-M9-2`: validate the Skill against the Dust Bunny reference record and Steps supervised-transfer record. It must visibly pause for source semantics, first high-risk art direction, representative gameplay, and final completion/release scope without moving runtime, codec, validation, or policy logic into prompts.
- `WP-M9-3`: consider a public `.aico8`/Player ADR only after a separate product-demand, migration, signing/security, and installed-host decision.
- Acceptance: `EXIT-SKILL-RELEASES` and `EXIT-SKILL-PACKAGE` pass; absence of Player evidence keeps the Player deferred rather than blocking the Skill.
