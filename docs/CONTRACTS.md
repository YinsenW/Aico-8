# Cross-layer contracts

This document owns API, Job, and durable-data relationships; headers, types, and schemas own fields. Status, evidence, selectors, and open work live only in `governance/project.json`.

## API boundaries

| ID | Owner | Responsibility | Consumers |
| --- | --- | --- | --- |
| API-CORE-001 | `runtime/core/include/p8/core.h` | Core lifecycle, RAM/ROM including protected-range current-cart reload, input, scheduler, semantic stream | VM, native/Wasm hosts, tests |
| API-RASTER-001 | `runtime/core/include/p8/raster.h` | Authoritative indexed pixels and PICO draw semantics | VM, compatibility renderer, checkpoints |
| API-VM-001 | `runtime/core/include/p8/vm.h` | P8 Lua load, boot, update, draw, pause-menu callbacks, error, and inspection | Hosts and replay harnesses |
| API-AUDIO-001 | `runtime/core/include/p8/audio.h` | Four-channel scheduling, cart-memory synthesis, status, and deterministic mono PCM | VM, native/Wasm hosts, audio checkpoints |
| API-SEMANTIC-001 | `p8_draw_command` in `core.h` | Ordered original draw intent plus payloads/state revision | HD adapter and diagnostics |
| API-TEXT-001 | `runtime/core/include/p8/text.h`, `runtime/core/include/p8/wasm.h`, `apps/web/src/runtime/text-run-ir.ts`, and `apps/web/src/runtime/hd-typography.ts` | Raw P8SCII execution result plus canonical little-endian ordered semantic text runs, byte-matched safe-modern routing, fixed-font loading, deterministic layout, and diagnostic correspondence regions | VM, HD text adapter, diagnostics, validation |
| API-WASM-001 | `runtime/core/include/p8/wasm.h` | Flat lifecycle, frame, PCM audio, semantic, map, read-only global/table inspection, pause-menu, persistence, and restart exports | Browser Web/PWA, Android WebView, and Linux Web hosts |
| API-PRESENTATION-001 | `apps/web/src/runtime/presentation.ts` | Read-only HD adapter lifecycle over display profiles, frame/command state, source-timed visibility, completeness, and diagnostic reference mode | PixiJS host and validation UI |
| API-HOST-001 | Planned host contract | Logical input, persistence, lifecycle, clock, audio, services | Browser Web/PWA, Android WebView, Linux Web shell, future ESP-IDF |
| API-CLI-001 | Planned TypeScript CLI | Non-interactive execution of every pipeline Job | Agents, CI, maintainers |
| API-GAME-MODULE-001 | Planned versioned TypeScript boundary | Bind one compatible game, HD presentation, saves, evidence, and provenance without exposing a public cart format | Assembly, Web host, validation, later platform hosts |

Rules: APIs cross layers using versioned C ABI or serializable data. TypeScript does not reproduce compatibility semantics; C++ does not choose HD artwork.
## Durable data contracts

| ID | Canonical content | Field owner |
| --- | --- | --- |
| DATA-CART-001 | Supplied cart bytes, format, source hash | Ingest schema |
| DATA-WORKSPACE-001 | Lossless decoded resources, aliases, hashes, provenance | Workspace schema |
| DATA-INPUT-TRACE-001 | Contiguous logical-update button-mask spans, initial persistence lineage, and no-skip policy | `specs/schemas/input-trace-v1.schema.json` |
| DATA-TRACE-PROVENANCE-001 | Exact trace hash, derivation kind, generator identity, and explicit licensed provenance for every contributing external action seed | `specs/schemas/input-trace-provenance-v1.schema.json` and `scripts/lib/input-trace-provenance.mjs` |
| DATA-REPLAY-001 | Cart/runtime identity, canonicality declaration, input trace, milestones, and ordered checkpoints | `specs/schemas/replay-v1.schema.json` and TypeScript validator |
| DATA-CHECKPOINT-001 | RAM/raster/audio/semantic hashes at named updates | Validation schema |
| DATA-QUALIFICATION-PLAN-001 | Legacy twelve-candidate private-research inventory retained for optional diagnostics and comparative risk sampling; it is not the active release or Skill gate | `specs/schemas/qualification-plan-v1.schema.json` and TypeScript validator |
| DATA-HD-MAP-001 | Source identity anchors, required-part traceability, measurable source/target proportions, copy provenance/authorization, allowed modernization dimensions, deterministic frozen render recipe, review, and complete canonical coverage | `specs/schemas/hd-identity-map-v1.schema.json` and TypeScript validator |
| DATA-HD-AUDIT-001 | Contextual raw visual tokens, observation runs, identity-map lineage, zero-unmapped/mixed/reference coverage, per-update HD-off/on state comparison, and rejected mutations | `specs/schemas/hd-presentation-audit-v1.schema.json` and TypeScript validator |
| DATA-HD-QUALITY-001 | Per-scene content render-route coverage separated from host shell, authoritative geometry/sampling provenance, source-derived visibility effects composited into the finished content route, measurable contour plus surface/detail/motion gain, and rejected shell-only/framebuffer-topology/cosmetic-smoothing/visibility-bypass mutations | `specs/schemas/quality-leap-audit-v1.schema.json` and `packages/contracts/src/quality-leap-audit.ts` |
| DATA-HD-EVIDENCE-LIFECYCLE-001 | Fail-closed progression from offline draft through packaged capture to a pending human packet, with immutable hashes, browser readiness, fixed gate order, zero acceptance claims, and cross-artifact game/runtime/replay/identity/browser lineage equality | `specs/schemas/hd-evidence-lifecycle-v1.schema.json` and TypeScript validator |
| DATA-ASSET-PACK-001 | Frozen hashed atlases, fonts, effects, audio, visual grammar, metadata, and licenses | Asset-pack schema |
| DATA-SEMANTIC-VECTOR-001 | Build-only constrained SVG provenance plus renderer-independent semantic layers, origins, palette tokens, compiled-recipe hashes, and packaged input lineage | `specs/schemas/semantic-vector-set-v1.schema.json`, `scripts/lib/semantic-svg.mjs`, and `apps/web/src/runtime/semantic-vector.ts` |
| DATA-TEXT-INVENTORY-001 | Reachable-run modernization inventory with raw P8SCII and Unicode evidence, provenance, role, effect/custom/inline flags, readiness, and explicit font/identity/reference/blocker mapping | `specs/schemas/text-inventory-v1.schema.json` and TypeScript validator |
| DATA-TEXT-COMPLETENESS-001 | Source-bound complete inventory consumption across canonical replay and named probes, exact failing updates, aggregate blockers/mismatches/out-of-inventory runs, and three fail-closed mutation proofs | `specs/schemas/text-completeness-audit-v1.schema.json` and `packages/contracts/src/text-completeness-audit.ts` |
| DATA-TEXT-RUN-001 | Raw bytes, resolved spans, command/update identity, original anchors/metrics/state, side-effect boundaries, custom-font revision, diagnostic bounds, and conservative modernization eligibility | `specs/schemas/text-run-v1.schema.json`, C ABI wire constants, and the fail-closed TypeScript decoder |
| DATA-TYPOGRAPHY-001 | Semantic roles, fixed bundled font files/hashes/licenses/provenance, generated glyph advances/bounds, complete required-character coverage, deterministic metrics/fit, and zero OS fallback | `specs/schemas/typography-manifest-v1.schema.json`, `specs/schemas/glyph-metrics-v1.schema.json`, and TypeScript validators |
| DATA-TYPOGRAPHY-A11Y-001 | Source-bound language/script coverage, CSS-pixel floors, WCAG contrast, delivery-profile fit, source-derived assistive descriptions, compatibility-state neutrality, regression rejection, and independent human readability decision | `specs/schemas/typography-accessibility-audit-v1.schema.json` and `packages/contracts/src/typography-accessibility.ts` |
| DATA-BATCH-001 | Authorized inputs/targets, timeout, immutable isolated attempts, pre-assembly replay/HD evidence, post-package Web evidence, failures, and derived aggregate state | `specs/schemas/batch-v1.schema.json` and TypeScript validator |
| DATA-HUMAN-STOP-DECISION-001 | Externally signed human outcome bound to the exact transfer instance, source/profile/authority identities, ordered stop, proposal, upstream decision, and persisted challenge nonce | `specs/schemas/human-stop-decision-v1.schema.json` and `packages/contracts/src/human-stop-decision.ts` |
| DATA-HUMAN-STOP-REQUEST-001 | Immutable unsigned signing request derived from the exact awaiting-human ledger state, proposal, challenge, allowed outcome/scope choices, and trusted reviewer IDs; Agent signing authority is always false | `specs/schemas/human-stop-request-v1.schema.json` and `packages/contracts/src/human-stop-request.ts` |
| DATA-SUPERVISED-REVIEW-PROPOSAL-001 | Human-visible stop-specific review object binding immutable transfer identity, immediate revision lineage, content-addressed evidence, required criteria, limitations, forbidden claims, and authority limits | `specs/schemas/supervised-review-proposal-v1.schema.json` and `packages/contracts/src/supervised-review-proposal.ts` |
| DATA-SUPERVISED-TRANSFER-001 | Fixed four-stop supervised-transfer ledger with immutable job identity, transition-preserved revision attempts, content-addressed proposals/decisions, derived status, and an explicit distinction between retained trial and authorization to run full validation | `specs/schemas/supervised-transfer-v1.schema.json` and `packages/contracts/src/supervised-transfer.ts` |
| DATA-TRANSFER-FINDINGS-001 | Reference-versus-trial findings classified as compatibility/runtime, reusable presentation, or source-relative semantic/art judgment; reusable claims require shared implementation plus regression evidence, while source-relative decisions remain attached to a named human stop | `specs/schemas/transfer-findings-v1.schema.json` and `packages/contracts/src/transfer-findings.ts` |
| DATA-GAME-MODULE-001 | One remake's payload, mappings, assets, saves, provenance, runtime constraints, and pre-assembly canonical-replay plus accepted-HD evidence | `specs/schemas/game-module-v1.schema.json` and TypeScript validator |
| DATA-COLLECTION-001 | Ordered validated module IDs, launcher metadata, save isolation, licenses, and target constraints | Fixed-collection schema |
| DATA-TARGET-PROFILE-001 | Browser Web/PWA phone, priority 1024-square-handheld, landscape-handheld, and wide-Web layout classes and minimum game/control dimensions, plus Android WebView, Linux handheld Web, future embedded capabilities, budgets, packaging mode, and signing policy | `specs/schemas/target-profile-v1.schema.json` and TypeScript validator |
| DATA-VALIDATION-001 | Exit results, platform/build identities, diffs, evidence links, same-build static/temporal source-HD review boundaries, immutable human decision lineage, measured release budgets, and active-browser layout measurements/screenshots for every target profile | `specs/schemas/hd-review-packet-v1.schema.json`, `specs/schemas/hd-review-decision-v1.schema.json`, `specs/schemas/release-validation-v1.schema.json`, and domain validators |
| DATA-RELEASE-001 | Build profiles, complete artifact checksums, separate visual-runtime and replay-semantics identities, notices, provenance, and rights decision | `specs/schemas/release-manifest-v1.schema.json` and TypeScript validator |
| DATA-GOVERNANCE-001 | Requirements, exits, owners, selectors, open items, current focus | `governance/schema.json` |
JSON Schemas are required before a payload becomes a stable public contract. Research manifests without a schema are prototypes and cannot close a stable-contract exit.
## Pipeline Job graph

| Job ID | Inputs | Outputs | Purpose |
| --- | --- | --- | --- |
| JOB-INGEST-001 | DATA-CART-001 | DATA-WORKSPACE-001 | Decode losslessly and record provenance |
| JOB-BATCH-001 | DATA-BATCH-001 | Isolated per-cart Job invocations and status ledger | `scripts/run-batch.ts` verifies authorized bytes, materializes isolated workspaces, enforces one ledger writer plus declared attempt timeouts, resumes durable attempts, and contains partial failure |
| JOB-SUPERVISED-TRANSFER-001 | DATA-SUPERVISED-TRANSFER-001, DATA-SUPERVISED-REVIEW-PROPOSAL-001, DATA-HUMAN-STOP-DECISION-001, host-owned reviewer trust profile | Recoverable ledger plus DATA-HUMAN-STOP-REQUEST-001 at each pause | `scripts/run-supervised-transfer.ts` validates proposal identity, evidence bytes and revision lineage before freezing state; `scripts/export-human-stop-request.ts` exports the exact unsigned challenge. Neither can sign, accept, release, prevent host rollback, or turn authorization into completion |
| JOB-ANALYZE-001 | DATA-WORKSPACE-001 | Risk/API/semantic analysis | Identify compatibility and remake risks |
| JOB-CAPTURE-001 | DATA-WORKSPACE-001, DATA-INPUT-TRACE-001 | DATA-REPLAY-001, DATA-CHECKPOINT-001 | Replay an unchanged cart on a named runtime; official captures additionally require an authorized official channel, immutable runtime/cart/artifact hashes, and channel-specific declarations. The Education Web channel records one bounded local-file-selection step; the licensed desktop channel remains required for unsupported exporters or version-sensitive behavior |
| JOB-MODEL-001 | Workspace, replay, checkpoints | DATA-HD-MAP-001 draft | Assign semantic roles, identity cues, and complete deterministic mappings |
| JOB-ASSET-001 | HD map and accepted art direction | DATA-ASSET-PACK-001 | Generate/import and review modern assets |
| JOB-TYPOGRAPHY-001 | Workspace, DATA-TEXT-RUN-001, accepted type direction | DATA-TEXT-INVENTORY-001, DATA-TYPOGRAPHY-001, font assets | Classify P8SCII, route identity artwork, regenerate hashed glyph metrics from pinned fonts, and prove coherent complete coverage |
| JOB-INTEGRATE-001 | Workspace, HD map, asset pack | DATA-GAME-MODULE-001 draft | Bind HD presentation without state mutation |
| JOB-VALIDATE-001 | Game module/builds, replay, checkpoints | DATA-HD-AUDIT-001, DATA-HD-QUALITY-001, DATA-VALIDATION-001 | Prove state/frame/audio/platform invariants plus static and temporal presentation evidence |
| JOB-ASSEMBLE-001 | Validated module(s), optional DATA-COLLECTION-001, DATA-TARGET-PROFILE-001 | Statically bound target build | `scripts/assemble-game-module.ts` implements the fail-closed single-game Web boundary; fixed collection remains gated |
| JOB-PACKAGE-001 | Validated target build and release profile | DATA-RELEASE-001 plus artifacts | Produce reproducible platform packages |
| JOB-RELEASE-001 | Artifacts, validation, rights evidence | Publication record | Enforce permission and publish approved builds |

Jobs are idempotent for identical declared inputs, non-interactive in CI, and must not obtain undeclared authority. A Job may produce an incomplete report; only its linked exits determine acceptance.

## Cross-document invariants

- `specs/display-profiles.json` owns `128 → 1024`, scale `8`, and tile `64` values.
- The kernel is the only owner of fixed-point, memory, scheduler, raster, input
  repeat, persistence, and reference audio semantics.
- The kernel exposes the manual-defined current music-pattern value through
  `stat(54)` and legacy alias `stat(24)`. This narrow capability does not imply
  licensed-official qualification of the remaining audio tick-history selectors.
- Custom-instrument and custom-waveform diagnostic playback is disabled unless
  the host opts in before execution. Opt-in never sets a conformance capability;
  use sets sticky queryable flags and an event-ledger record. Canonical gameplay
  evidence must include `execution.audioDiagnosticFlags`, and JOB-VALIDATE-001
  rejects missing or non-zero values until licensed official captures qualify
  those semantics.
- Current-cart `reload(dest,source,len)` copies immutable cart data only from
  `0x0000..0x42ff` into base RAM. The protected code range is rejected, and an
  optional external-cart filename fails closed until a declared host resource
  contract supplies that cartridge; neither case may silently become a no-op.
- Host pause-menu requests remain outside the six-button gameplay mask. The Web
  host presents built-in actions plus the kernel's source-registered `menuitem`
  labels, invokes their filtered callbacks through the same VM, honors keep-open
  results, and suppresses held selection input before gameplay resumes.
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
- Every image rendered by a pending or accepted review document uses the retained
  screenshot SHA-256 as the URL cache key for both its inline and full-size link.
  A fixed path, a missing key, or a key that differs from the verified file bytes
  fails the packet even when its JSON metadata is otherwise current.
- DATA-HD-EVIDENCE-LIFECYCLE-001 separates offline drafts, packaged captures,
  and pending review packets. Offline artifacts cannot claim runtime, capture,
  browser, or human proof; the lifecycle never embeds acceptance, which remains
  an independent immutable `aico8.hd-review-decision.v1` artifact.
- HD acceptance is ordered and non-compensatory: DATA-HD-MAP-001 plus replay evidence gate Spirit fidelity; HD surface/asset evidence gates Quality leap; DATA-ASSET-PACK-001 visual grammar plus the whole-frame human decision gate Aesthetic evolution. The pending packet stores all three gates in contract order, and the immutable decision must record `passed` for each; aesthetic polish cannot offset identity, atmosphere, play-feel, or material-quality failure.
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
- Source-authored copy keeps the cart template's exact case, punctuation,
  spacing, and number format. The HD path may bind only declared state values to
  named placeholders and modernize typography/layout; every template requires a
  stable ID and source evidence, and cannot paraphrase or normalize the text.
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
- Supervised transfer always pauses in this order: semantic intent, art direction,
  representative gameplay, then final scope. The runner may freeze proposals and
  apply a detached Ed25519 decision from the reviewer-owned trust profile; it may
  not create, infer, edit, or replace that decision. Every signed resume re-hashes the exact proposal and decision bytes. An explicit project-owner decision bound to the frozen proposal may instead close the declared local research stop when recorded in durable evidence; never synthesize its signature or claim complete-game proof.
- Final scope `retain-supervised-trial` ends only the bounded trial;
  `authorize-full-validation` unlocks the ordinary-input replay, complete HD,
  package, performance, and rights selectors but satisfies none of them. Neither
  outcome is a DATA-RELEASE-001 rights decision or publication authority.
- DATA-TRANSFER-FINDINGS-001 is the only reusable-learning record: shared findings require public implementation and regression evidence; source-relative findings require a human stop and forbid shared-rule claims. Classification never substitutes for the recorded human decision.
- Cart-specific presentation adapters are injected from ignored private workspaces;
  the Apache source tree owns only the interface, loader, diagnostic reference
  renderer, and validators.
- A Web package resolves every resource from its deployment base; its service-worker cache and navigation fallback are isolated by registration scope.
- Original P8SCII execution and `print()` metrics stay in the kernel; modern
  typography consumes results and cannot alter compatibility state.
- Game modules are internal versioned build inputs. A single or fixed collection
  is statically bound; no stable `.aico8` or dynamic Player contract exists yet.
- Batch execution isolates workspaces, failures, evidence, and retries. Assembly
  cannot include a module whose required validation exits are incomplete.
- A canonical replay has contiguous real button input for every logical update,
  optionally interleaves only exact-update source-authored pause-menu callbacks,
  retains unchanged cart/state semantics, has no test hooks, direct Lua calls,
  or synthetic completion, and binds milestone/checkpoint lineage. Menu actions
  are outside the six-bit DATA-INPUT-TRACE-001 stream and must match the live
  registered index, label, button filter, and keep-open result. Faster wall time
  is allowed only when every original logical update and declared host action
  still executes in order.
- Keyboard, standard controller, and touch qualification consumes the same
  DATA-INPUT-TRACE-001 through production mapping/latch functions. Each surface
  must emit the canonical six-bit player-one mask at the declared update rate for
  every logical update; a length, timing, mask, visible-control, or quick-tap
  mismatch fails JOB-VALIDATE-001.
- Research Web packages may opt into explicit replay-backed scene capture. The
  host must validate Replay v1, cart hash, initial persistence hash, and named
  milestone, execute every ordinary input update and declared source menu action,
  expose playback lineage in the UI, and never treat the capture as a second
  completion claim.
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
- Temporal review frames bind exactly one source clock: either a canonical
  logical-update boundary or an `_init()/flip()` host-initialization tick. The
  clocks may not be conflated; a startup frame represented as update zero is
  invalid evidence.
- Source-authored modern visuals are gated by source tokens from the same logical update. Scene membership or a token retained from an earlier frame cannot reveal copy, characters, effects, or cues before the source does.
- A solver or AI planner may propose DATA-INPUT-TRACE-001 only. Every promoted trace also requires DATA-TRACE-PROVENANCE-001 bound to its exact canonical trace hash. An external action seed is ineligible when its artifact, revision, action hash, explicit reusable license, license evidence, or reviewed reuse decision is absent; `NOASSERTION`, unknown, and unlicensed sources fail closed.
  JOB-VALIDATE-001 must replay each proposed transition on the unchanged cart and compare the declared observable state before JOB-CAPTURE-001 can promote it to DATA-REPLAY-001; model-only success is never evidence.
- The reusable private gameplay selector runs a workspace-owned verifier, then
  independently validates Replay v1 continuity, clean initial persistence,
  ordinary six-bit masks, ordered boundary/checkpoint coverage, final state, and
  deliberate semantic-mutation rejection. Its sanitized attestation proves
  canonical gameplay only; HD, host-input, package, rights, and official-runtime
  gates remain independent.
- A finite game's qualification boundary retains its source meaning. Real
  sequential courses/levels may use ordered `level-complete` ordinals; every
  other boundary kind binds the exact ordered Replay v1 milestone IDs and may
  not be relabeled as synthetic levels merely to satisfy a shared validator.
- Qualification uses an accepted reference remake and one materially different
  human-supervised transfer trial. The trial records which rules are reusable and
  which decisions remain source-relative; it must not claim universal coverage.
  Representative checkpoints may support iterative review, but do not prove game
  completion. A candidate promoted to a complete artifact must independently prove
  every declared level, ending, and progression boundary through ordinary input,
  accepted HD review, and reproducible Web-package hashes. The ordinary-input
  route may be recorded by a human and replayed deterministically.
- DATA-QUALIFICATION-PLAN-001 keeps the former fixed-corpus inventory for optional
  diagnostics; selection, boot, solver progress, or collection grants no claim.
- Save keys are namespaced by game-module ID and schema version; collection
  switching resets compatibility state before another module starts.
- A rights decision is data in DATA-RELEASE-001, never inferred from technical success.
- Each requirement references contract IDs; the governance verifier rejects missing or orphaned IDs.
