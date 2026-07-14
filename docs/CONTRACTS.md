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
| DATA-SEMANTIC-VECTOR-001 | Build-only constrained SVG provenance plus renderer-independent semantic layers, origins, palette tokens, compiled-recipe hashes, and packaged input lineage | `specs/schemas/semantic-vector-set-v1.schema.json`, `scripts/lib/semantic-svg.mjs`, and `apps/web/src/runtime/semantic-vector.ts` |
| DATA-TEXT-RUN-001 | Raw bytes, resolved spans, original anchors/metrics/state, side-effect boundaries, and modernization eligibility | Text-run schema |
| DATA-TYPOGRAPHY-001 | Semantic roles, Unicode mappings, font assets/hashes/licenses, complete coverage, layout, fit, and diagnostic policy | Typography-manifest schema |
| DATA-BATCH-001 | Authorized cart inputs, desired products/targets, policy, immutable IDs, and per-game Job states | Batch schema |
| DATA-GAME-MODULE-001 | One remake's compatible payload, mappings, assets, saves, provenance, validation references, and runtime constraints | Internal game-module schema |
| DATA-COLLECTION-001 | Ordered validated module IDs, launcher metadata, save isolation, licenses, and target constraints | Fixed-collection schema |
| DATA-TARGET-PROFILE-001 | Browser Web/PWA phone, priority 1024-square-handheld, landscape-handheld, and wide-Web layout classes and minimum game/control dimensions, plus Android WebView, Linux handheld Web, future embedded capabilities, budgets, packaging mode, and signing policy | `specs/schemas/target-profile-v1.schema.json` and TypeScript validator |
| DATA-VALIDATION-001 | Exit results, platform/build identities, diffs, evidence links, same-build static/temporal source-HD review boundaries, immutable human decision lineage, measured release budgets, and active-browser layout measurements/screenshots for every target profile | `specs/schemas/hd-review-packet-v1.schema.json`, `specs/schemas/hd-review-decision-v1.schema.json`, `specs/schemas/release-validation-v1.schema.json`, and domain validators |
| DATA-RELEASE-001 | Build profiles, complete artifact checksums, separate visual-runtime and replay-semantics identities, notices, provenance, and rights decision | `specs/schemas/release-manifest-v1.schema.json` and TypeScript validator |
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
| JOB-VALIDATE-001 | Game module/builds, replay, checkpoints | DATA-HD-AUDIT-001, DATA-VALIDATION-001 | Prove state/frame/audio/platform invariants plus static and temporal presentation evidence |
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
- SVG is an optional authoring input, not a portable runtime. Only the constrained
  DATA-SEMANTIC-VECTOR-001 subset may enter a build; it is compiled to a hashed
  semantic recipe before Vite, and release inputs bind source bytes while the
  visual-runtime identity binds the compiled recipe and packaged manifest.
- Web layout acceptance is fail-closed over every DATA-TARGET-PROFILE-001 layout
  class. Each matching DATA-VALIDATION-001 record binds the exact visual runtime,
  viewport/document dimensions, a full-frame screenshot whose pixel dimensions
  exactly equal that viewport, game and minimum-control bounds, overflow,
  clipping, font and safe-area checks, plus a screenshot hash.
- A human HD decision binds the exact pending packet, document, identity draft,
  browser record, replay semantics, visual runtime, elements, checks, and required
  statement. Acceptance promotes every review field together; a later selector
  must reproduce the reviewed draft before it can regenerate accepted evidence.
- Every element's source/HD review anchors are ordered one-to-one and every pair
  must bind the same scene and state; the review document renders every declared
  anchor, including variant parts and reachable persisted UI states.
- Naming a target region is not proof that an identity-bearing part survived.
  Every required-part mapping also declares positive source-relative recognition
  cues and forbidden substitutions; the human review packet exposes both so an
  ear, face, limb, glyph, or prop cannot pass merely because a same-named region
  exists while its visible silhouette reads as something else.
- Source-relative identity anchors bind normalized source and target composition
  rectangles to declared source evidence and target regions. Moving or resizing
  an element beyond its per-check edge tolerance fails even when its internal
  aspect ratio still passes; this prevents a faithful part from being accepted
  inside an unfaithful re-layout.
- Identity-bearing wordmarks and source-drawn glyphs are artwork. Their contour
  checks bind the source crop and target vector hashes, exact downsampled masks,
  component/hole topology, and measured displacement strictly below half a
  source pixel; ordinary semantic text remains owned by the typography path.
- Source tile/sprite structure lineage binds every retained palette/material
  layer's exact mask, topology, and four boundary-edge signatures. Different
  source structures may share renderer code but not one frozen recipe; a broad
  semantic category never proves shape or material-layer equivalence.
- HD surface lineage is independent of the identity scaffold. It compiles the
  hashed target SVG, binds real shade/base/highlight primitives, requires a
  topology-constrained curved base with no line-segment staircase, preserves
  every source cell centre, and requires at least 2x density-aware edge
  supersampling. Declared counters/holes bind unpainted cut primitives after the
  owning base and before highlights; compound fills assign each cut to the
  containing component. Correct masks with visibly enlarged pixel steps fail.
- Human rejection invalidates the pending review packet as an acceptance
  candidate. Replacing its visual runtime invalidates every runtime-bound capture,
  technical report, packet, and document; all must be regenerated from the same
  replacement build, and review remains draft until a new explicit decision.
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
- A declared settle duration is not capture evidence. Static, temporal, and
  layout screenshots require one DOM-bound readiness record proving the exact
  mode/scene/boundary, hidden loading class, computed opacity zero, computed
  visibility hidden, and at least two newly presented frames; missing, stale, or
  duplicate records fail private remake validation.
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
