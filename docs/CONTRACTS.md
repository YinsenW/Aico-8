# Cross-layer contracts

This document owns relationships among APIs, pipeline Jobs, and durable data.
Headers, TypeScript types, and schemas own field-level definitions. Status,
evidence, selectors, and open work live only in `governance/project.json`.

## API boundaries

| ID | Owner | Responsibility | Consumers |
| --- | --- | --- | --- |
| API-CORE-001 | `runtime/core/include/p8/core.h` | Core lifecycle, RAM/ROM, input, scheduler, semantic stream | VM, native/Wasm hosts, tests |
| API-RASTER-001 | `runtime/core/include/p8/raster.h` | Authoritative indexed pixels and PICO draw semantics | VM, compatibility renderer, checkpoints |
| API-VM-001 | `runtime/core/include/p8/vm.h` | P8 Lua load, boot, update, draw, error, and inspection | Hosts and replay harnesses |
| API-SEMANTIC-001 | `p8_draw_command` in `core.h` | Ordered original draw intent plus payloads/state revision | HD adapter and diagnostics |
| API-TEXT-001 | Planned versioned core/TypeScript boundary | Raw P8SCII execution result plus ordered semantic text runs and fallback regions | HD text adapter, diagnostics, validation |
| API-WASM-001 | Planned versioned C exports and flat buffers | Same kernel behavior across the JS/Wasm boundary | Web/PWA and mobile hosts |
| API-PRESENTATION-001 | `packages/contracts/` | Display profiles, frame/command consumption, HD mapping | PixiJS host and validation UI |
| API-HOST-001 | Planned host contract | Logical input, persistence, lifecycle, clock, audio, services | Web, mobile, desktop, ESP-IDF |
| API-CLI-001 | Planned TypeScript CLI | Non-interactive execution of every pipeline Job | Agents, CI, maintainers |
| API-GAME-MODULE-001 | Planned versioned TypeScript boundary | Bind one compatible game, HD presentation, saves, evidence, and provenance without exposing a public cart format | Assembly, Web host, validation, later platform hosts |

Rules: APIs cross layers using versioned C ABI or serializable data. TypeScript
does not reproduce compatibility semantics; C++ does not choose HD artwork.

## Durable data contracts

| ID | Canonical content | Field owner |
| --- | --- | --- |
| DATA-CART-001 | Supplied cart bytes, format, source hash | Ingest schema |
| DATA-WORKSPACE-001 | Lossless decoded resources, aliases, hashes, provenance | Workspace schema |
| DATA-INPUT-TRACE-001 | Logical-update input masks and initial persistence state | Replay schema |
| DATA-REPLAY-001 | Input trace plus ordered state snapshots | Replay schema |
| DATA-CHECKPOINT-001 | RAM/raster/audio/semantic hashes at named updates | Validation schema |
| DATA-HD-MAP-001 | Semantic role to asset/fallback mapping with safety conditions | HD mapping schema |
| DATA-ASSET-PACK-001 | Versioned atlases, fonts, effects, audio, metadata, licenses | Asset-pack schema |
| DATA-TEXT-RUN-001 | Raw bytes, resolved spans, original anchors/metrics/state, side-effect boundaries, and safe/fallback classification | Text-run schema |
| DATA-TYPOGRAPHY-001 | Semantic roles, Unicode mappings, font assets/hashes/licenses, coverage, layout, fit, and fallback policy | Typography-manifest schema |
| DATA-BATCH-001 | Authorized cart inputs, desired products/targets, policy, immutable IDs, and per-game Job states | Batch schema |
| DATA-GAME-MODULE-001 | One remake's compatible payload, mappings, assets, saves, provenance, validation references, and runtime constraints | Internal game-module schema |
| DATA-COLLECTION-001 | Ordered validated module IDs, launcher metadata, save isolation, licenses, and target constraints | Fixed-collection schema |
| DATA-TARGET-PROFILE-001 | Web/PWA first and later platform capabilities, budgets, packaging mode, and signing policy | Target-profile schema |
| DATA-VALIDATION-001 | Exit results, platform/build identities, diffs, evidence links | Validation schema |
| DATA-RELEASE-001 | Build profiles, checksums, notices, provenance, rights decision | Release schema |
| DATA-GOVERNANCE-001 | Requirements, exits, owners, selectors, open items, current focus | `governance/schema.json` |

JSON Schemas are required before a payload becomes a stable public contract.
Research manifests without a schema are prototypes and cannot close a stable-
contract exit.

## Pipeline Job graph

| Job ID | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| JOB-INGEST-001 | DATA-CART-001 | DATA-WORKSPACE-001 | Decode losslessly and record provenance |
| JOB-BATCH-001 | DATA-BATCH-001 | Isolated per-cart Job invocations and status ledger | Fan out without sharing mutable workspaces or acceptance state |
| JOB-ANALYZE-001 | DATA-WORKSPACE-001 | Risk/API/semantic analysis | Identify compatibility and remake risks |
| JOB-CAPTURE-001 | DATA-WORKSPACE-001, DATA-INPUT-TRACE-001 | DATA-REPLAY-001, DATA-CHECKPOINT-001 | Capture licensed official behavior |
| JOB-MODEL-001 | Workspace, replay, checkpoints | DATA-HD-MAP-001 draft | Assign semantic roles and safe fallbacks |
| JOB-ASSET-001 | HD map and accepted art direction | DATA-ASSET-PACK-001 | Generate/import and review modern assets |
| JOB-TYPOGRAPHY-001 | Workspace, text inventory, accepted type direction | DATA-TEXT-RUN-001, DATA-TYPOGRAPHY-001, font assets | Classify P8SCII, subset/build fonts, and prove coverage/fallback |
| JOB-INTEGRATE-001 | Workspace, HD map, asset pack | DATA-GAME-MODULE-001 draft | Bind HD presentation without state mutation |
| JOB-VALIDATE-001 | Game module/builds, replay, checkpoints | DATA-VALIDATION-001 | Prove state/frame/audio/platform invariants |
| JOB-ASSEMBLE-001 | Validated module(s), optional DATA-COLLECTION-001, DATA-TARGET-PROFILE-001 | Statically bound target build | Assemble one standalone game or a fixed collection |
| JOB-PACKAGE-001 | Validated target build and release profile | DATA-RELEASE-001 plus artifacts | Produce reproducible platform packages |
| JOB-RELEASE-001 | Artifacts, validation, rights evidence | Publication record | Enforce permission and publish approved builds |

Jobs are idempotent for identical declared inputs, non-interactive in CI, and
must not obtain undeclared authority. A Job may produce an incomplete report;
only its linked exits determine acceptance.

## Cross-document invariants

- `specs/display-profiles.json` owns `128 → 1024`, scale `8`, and tile `64` values.
- The kernel is the only owner of fixed-point, memory, scheduler, raster, input
  repeat, persistence, and reference audio semantics.
- The semantic/HD path is presentation-only and always retains an indexed fallback.
- Original P8SCII execution and `print()` metrics stay in the kernel; modern
  typography consumes results and cannot alter compatibility state.
- Game modules are internal versioned build inputs. A single or fixed collection
  is statically bound; no stable `.aico8` or dynamic Player contract exists yet.
- Batch execution isolates workspaces, failures, evidence, and retries. Assembly
  cannot include a module whose required validation exits are incomplete.
- Save keys are namespaced by game-module ID and schema version; collection
  switching resets compatibility state before another module starts.
- A rights decision is data in DATA-RELEASE-001, never inferred from technical success.
- Each requirement references contract IDs; the governance verifier rejects
  missing or orphaned IDs.
