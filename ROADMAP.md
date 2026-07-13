# Aico 8 execution plan

This file owns dependency order and stable work-package decomposition. It does
not own status: `governance/project.json` records current focus, Exit state,
evidence, selectors, and open work. Execute packages in order unless the manifest
names a narrower prerequisite; never infer completion from this plan.

| Stage | Product requirements | User-visible outcome |
| --- | --- | --- |
| M0 Governance/public source | REQ-GOV-001, REQ-REPO-001 | Recoverable AI-agent project and safe public toolchain |
| M1 Lossless internal module | REQ-INGEST-001, REQ-DELIVERY-001 | Rebuildable cart workspace and internal game-module contract |
| M2 Web compatibility dependency | REQ-COMPAT-001, REQ-INPUT-001 | Native/Wasm compatibility truth needed by the first game |
| M3 Original Web playability | REQ-WEB-001, REQ-REMAKE-001 | Private Dust Bunny playable in its original-compatible presentation |
| M4 Complete HD private trial | REQ-HD-001, REQ-TYPOGRAPHY-001, REQ-INPUT-001, REQ-REMAKE-001 | Complete modern graphics, text, audio, input, and saves |
| M5 Standalone Web/PWA | REQ-WEB-001, REQ-DELIVERY-001, REQ-RELEASE-001 | Reproducible private single-game Web package |
| M6 Multi-game/collection | REQ-BATCH-001, REQ-DELIVERY-001 | Isolated batch conversion and fixed collection after three games |
| M7 Installed hosts | REQ-PLATFORM-001 | Android first, then desktop and iOS |
| M8 Embedded host | REQ-EMBEDDED-001 | Constrained ESP32-P4 game firmware |
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

- `WP-M4-1`: model every entity, tile, wall, dirt state, UI role, animation, particle, lighting/effect, camera, and safe indexed fallback.
- `WP-M4-2`: produce and integrate the complete 1024 asset set while proving HD-on/off compatibility-state invariance for the full replay.
- `WP-M4-3`: execute original P8SCII truth, map safe text to licensed bundled modern fonts, validate layout/coverage/accessibility, and retain exact unknown/custom fallbacks.
- `WP-M4-4`: preserve dynamic synth behavior, validate any pre-rendered audio substitutions, then add controller and touch traces without feel drift.
- Acceptance: the first trial closes `EXIT-HD-DISPLAY`, `EXIT-INPUT-HOSTS`, `EXIT-REMAKE-PRESENTATION`, and `EXIT-REMAKE-INPUT`; broader HD-invariance and P8SCII exits stay independently open rather than being inferred from one game.

## M5 — First complete standalone Web game

- `WP-M5-1`: add offline/installable PWA behavior, portable single-HTML convenience output, save lifecycle, touch-safe areas, diagnostics, accessibility, and measured performance budgets.
- `WP-M5-2`: assemble/package one validated game module reproducibly from a clean public checkout plus authorized private input; generate hashes, notices, provenance, validation, and technical release metadata.
- `WP-M5-3`: run full-game browser automation and manual visual/audio/input review on desktop and representative mobile browsers; keep publication permission as an independent gate.
- Acceptance: `EXIT-WEB-PWA`, `EXIT-DELIVERY-SINGLE`, and `EXIT-REMAKE-PACKAGE` pass for the private artifact; formal `EXIT-RELEASE-TECHNICAL` and `EXIT-RELEASE-RIGHTS` remain independent.

## M6 — Batch conversion and fixed collection

- `WP-M6-1`: select at least two additional authorized carts covering different risks; run each through an immutable batch manifest, isolated workspace, retries, evidence, and partial-failure report.
- `WP-M6-2`: prove the internal module API has no game-private runtime hooks, then migrate schemas/saves without invalidating the first game.
- `WP-M6-3`: assemble at least three validated modules into a launcher with runtime reset, save/license isolation, asset deduplication, failure containment, and size/startup budgets.
- Acceptance: `EXIT-BATCH-ISOLATION`, `EXIT-BATCH-PARTIAL`, and `EXIT-DELIVERY-COLLECTION` pass; `.aico8` remains unfrozen unless ADR 0003's reversal gate is separately met.

## M7 — Secondary installed hosts

- `WP-M7-1`: produce signed Android test APK and release AAB with lifecycle, audio focus, storage, controller, touch, orientation, and resume tests.
- `WP-M7-2`: package the validated Web product for Windows, macOS, and Linux with platform WebView, signing/notarization, filesystem, controller, and update tests.
- `WP-M7-3`: package and review iOS only after Android/desktop evidence, including lifecycle, privacy, age/content metadata, store policy, signing, and TestFlight/App Store paths.
- Acceptance: `EXIT-PLATFORM-ANDROID`, `EXIT-PLATFORM-DESKTOP`, and `EXIT-PLATFORM-IOS` pass independently; none can retroactively weaken the Web exits.

## M8 — ESP32-P4 constrained profile

- `WP-M8-1`: select a board/display/audio/input/storage baseline and publish hard flash, internal RAM, PSRAM, frame-time, boot-time, and power budgets.
- `WP-M8-2`: build the same native compatibility truth and module contract under ESP-IDF with tiled/strip rendering, derived assets, saves, and firmware/OTA packaging.
- `WP-M8-3`: replay a representative game on hardware, record state identity and measured budgets, then attempt a selected fixed collection only if storage permits.
- Acceptance: `EXIT-EMBEDDED-RUNTIME` and `EXIT-EMBEDDED-FIRMWARE` pass on named hardware; no JavaScript VM or alternate gameplay implementation is introduced.

## M9 — Thin Skill and possible Player

- `WP-M9-1`: package a thin Skill that accepts one/list/directory inputs, invokes versioned Jobs, reads machine evidence, retries bounded failures, and pauses for art/legal/release judgment.
- `WP-M9-2`: validate the Skill across repeated permission-aware end-to-end exercises without moving runtime, codec, validation, or policy logic into prompts.
- `WP-M9-3`: consider a public `.aico8`/Player ADR only if the three-game compatibility, migration, signing/security, installed-host, and product-demand reversal gate passes.
- Acceptance: `EXIT-SKILL-RELEASES` and `EXIT-SKILL-PACKAGE` pass; absence of Player evidence keeps the Player deferred rather than blocking the Skill.
