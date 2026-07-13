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
| API-TEXT-001 | Planned versioned core/TypeScript boundary | Raw P8SCII execution result plus ordered semantic text runs and diagnostic correspondence regions | HD text adapter, diagnostics, validation |
| API-WASM-001 | `runtime/core/include/p8/wasm.h` | Flat lifecycle, frame, semantic, map, global-inspection, persistence, and restart exports | Browser Web/PWA, Android WebView, and Linux Web hosts |
| API-PRESENTATION-001 | `apps/web/src/runtime/presentation.ts` | Read-only HD adapter lifecycle over display profiles, frame/command state, source-timed visibility, completeness, and diagnostic reference mode | PixiJS host and validation UI |
| API-HOST-001 | Planned host contract | Logical input, persistence, lifecycle, clock, audio, services | Browser Web/PWA, Android WebView, Linux Web shell, future ESP-IDF |
| API-CLI-001 | Planned TypeScript CLI | Non-interactive execution of every pipeline Job | Agents, CI, maintainers |
| API-GAME-MODULE-001 | Planned versioned TypeScript boundary | Bind one compatible game, HD presentation, saves, evidence, and provenance without exposing a public cart format | Assembly, Web host, validation, later platform hosts |

Rules: APIs cross layers using versioned C ABI or serializable data. TypeScript
does not reproduce compatibility semantics; C++ does not choose HD artwork.

## Durable data contracts

| ID | Canonical content | Field owner |
| --- | --- | --- |
| DATA-CART-001 | Supplied cart bytes, format, source hash | Ingest schema |
| DATA-WORKSPACE-001 | Lossless decoded resources, aliases, hashes, provenance | Workspace schema |
| DATA-INPUT-TRACE-001 | Contiguous logical-update button-mask spans, initial persistence lineage, and no-skip policy | `specs/schemas/input-trace-v1.schema.json` |
| DATA-REPLAY-001 | Cart/runtime identity, canonicality declaration, input trace, milestones, and ordered checkpoints | `specs/schemas/replay-v1.schema.json` and TypeScript validator |
| DATA-CHECKPOINT-001 | RAM/raster/audio/semantic hashes at named updates | Validation schema |
| DATA-HD-MAP-001 | Source identity anchors, required-part traceability, measurable source/target proportions, copy provenance/authorization, allowed modernization dimensions, deterministic frozen render recipe, review, and complete canonical coverage | `specs/schemas/hd-identity-map-v1.schema.json` and TypeScript validator |
| DATA-HD-AUDIT-001 | Contextual raw visual tokens, observation runs, identity-map lineage, zero-unmapped/mixed/reference coverage, per-update HD-off/on state comparison, and rejected mutations | `specs/schemas/hd-presentation-audit-v1.schema.json` and TypeScript validator |
| DATA-ASSET-PACK-001 | Frozen hashed atlases, fonts, effects, audio, visual grammar, metadata, and licenses | Asset-pack schema |
| DATA-TEXT-RUN-001 | Raw bytes, resolved spans, original anchors/metrics/state, side-effect boundaries, and modernization eligibility | Text-run schema |
| DATA-TYPOGRAPHY-001 | Semantic roles, Unicode mappings, font assets/hashes/licenses, complete coverage, layout, fit, and diagnostic policy | Typography-manifest schema |
| DATA-BATCH-001 | Authorized cart inputs, desired products/targets, policy, immutable IDs, and per-game Job states | Batch schema |
| DATA-GAME-MODULE-001 | One remake's compatible payload, mappings, assets, saves, provenance, validation references, and runtime constraints | Internal game-module schema |
| DATA-COLLECTION-001 | Ordered validated module IDs, launcher metadata, save isolation, licenses, and target constraints | Fixed-collection schema |
| DATA-TARGET-PROFILE-001 | Browser Web/PWA, Android WebView, Linux handheld Web, and future embedded capabilities, budgets, packaging mode, and signing policy | Target-profile schema |
| DATA-VALIDATION-001 | Exit results, platform/build identities, diffs, evidence links | Validation schema |
| DATA-RELEASE-001 | Build profiles, complete artifact checksums, separate visual-runtime and replay-semantics identities, notices, provenance, rights decision | Release schema |
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
| JOB-CAPTURE-001 | DATA-WORKSPACE-001, DATA-INPUT-TRACE-001 | DATA-REPLAY-001, DATA-CHECKPOINT-001 | Replay an unchanged cart on a named runtime; official captures additionally require a licensed oracle |
| JOB-MODEL-001 | Workspace, replay, checkpoints | DATA-HD-MAP-001 draft | Assign semantic roles, identity cues, and complete deterministic mappings |
| JOB-ASSET-001 | HD map and accepted art direction | DATA-ASSET-PACK-001 | Generate/import and review modern assets |
| JOB-TYPOGRAPHY-001 | Workspace, text inventory, accepted type direction | DATA-TEXT-RUN-001, DATA-TYPOGRAPHY-001, font assets | Classify P8SCII, subset/build fonts, and prove coherent complete coverage |
| JOB-INTEGRATE-001 | Workspace, HD map, asset pack | DATA-GAME-MODULE-001 draft | Bind HD presentation without state mutation |
| JOB-VALIDATE-001 | Game module/builds, replay, checkpoints | DATA-HD-AUDIT-001, DATA-VALIDATION-001 | Prove state/frame/audio/platform invariants |
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
- The semantic/HD path is presentation-only. Accepted HD frames have complete,
  coherent modern coverage; indexed output is a separate diagnostic mode and
  cannot be composited element-by-element into an accepted frame.
- HD completeness is fail-closed over scene-contextual raw tile, sprite, text,
  command, effect, and modern-UI tokens. Canonical replay plus named reachable-
  state probes must expose every accepted token; renderer fallthrough cannot
  silently turn an unknown token into empty output.
- AI-generated media is an authoring candidate only. Accepted builds use reviewed,
  frozen assets and deterministic mappings; no model call or model-specific
  behavior exists in runtime execution or sole-source acceptance.
- Cart-specific presentation adapters are injected from ignored private workspaces;
  the Apache source tree owns only the interface, loader, diagnostic reference
  renderer, and validators.
- Original P8SCII execution and `print()` metrics stay in the kernel; modern
  typography consumes results and cannot alter compatibility state.
- Game modules are internal versioned build inputs. A single or fixed collection
  is statically bound; no stable `.aico8` or dynamic Player contract exists yet.
- Batch execution isolates workspaces, failures, evidence, and retries. Assembly
  cannot include a module whose required validation exits are incomplete.
- A canonical replay has contiguous real button input for every logical update,
  unchanged cart/state semantics, no test hooks or synthetic completion, and
  milestone/checkpoint lineage. Faster wall time is allowed only when every
  original logical update still executes.
- Keyboard, standard controller, and touch qualification consumes the same
  DATA-INPUT-TRACE-001 through production mapping/latch functions. Each surface
  must emit the canonical six-bit player-one mask at the declared update rate for
  every logical update; a length, timing, mask, visible-control, or quick-tap
  mismatch fails JOB-VALIDATE-001.
- Research Web packages may opt into explicit replay-backed scene capture. The
  host must validate Replay v1, cart hash, initial persistence hash, and named
  milestone, execute every ordinary input update, expose playback lineage in the
  UI, and never treat the capture as a second completion claim.
- Screenshot evidence binds the package's visual-runtime identity, which hashes
  every artifact except the declared validation replay. Ending lineage also binds
  the replay-semantics identity, which excludes only runtime/producer source-
  revision metadata. Both identities are recomputed by package verification;
  metadata churn may not mask visual or input/state drift.
- The private release manifest retains complete per-artifact hashes, including
  replay provenance. Public attestations record the stable visual-runtime and
  replay-semantics identities instead of a self-referential full replay/package
  hash whose embedded source revision would change when the attestation is committed.
- Source-authored modern visuals are gated by source tokens from the same logical
  update. Scene membership or a token retained from an earlier frame cannot
  reveal copy, characters, effects, or cues before the source does.
- A solver or AI planner may propose DATA-INPUT-TRACE-001 only. JOB-VALIDATE-001
  must replay each proposed transition on the unchanged cart and compare the
  declared observable state before JOB-CAPTURE-001 can promote it to
  DATA-REPLAY-001; model-only success is never evidence.
- Qualification counts at least ten materially different finite games only after
  each independently proves every required level, ending, and progression
  boundary; diagnostic reachability or a collection launch never counts.
- Save keys are namespaced by game-module ID and schema version; collection
  switching resets compatibility state before another module starts.
- A rights decision is data in DATA-RELEASE-001, never inferred from technical success.
- Each requirement references contract IDs; the governance verifier rejects
  missing or orphaned IDs.
