# Development agent runbook

## Bootstrap and select work

1. Inspect `git status --short --branch` and existing stacked PRs before editing.
2. Run `pnpm verify:governance` and read `current_focus` in `governance/project.json`.
3. Select the matching `ROADMAP.md` work package, requirement, and exit/open-item set. Do not invent a parallel status list in a plan, README, PR body, or research note.
4. Read the owner documents and only the evidence linked by those exits.
5. Confirm private fixtures exist when a selector declares `private` availability.

Through the first complete remake, select only browser Web/PWA work or its direct dependencies. Android, Linux, collection, ESP32, and final Skill work remain later.

## Implementation loop

1. Write or adjust the smallest failing test/checkpoint that represents the exit.
2. Change code behind the owning API or data contract.
3. Preserve the separate compatibility reference path; never introduce mixed
   indexed fragments into accepted HD presentation.
4. During editing, run only the narrow selector and one or two high-risk checkpoints.
5. Promote a visual candidate only after title/menu, representative gameplay, and
   ending checkpoints pass; then batch its complete static/temporal evidence.
6. At a frozen game handoff, run every selector attached to the affected exit,
   complete replay, package, viewport/input, governance, and release checks.
7. Record exact implementation/evidence paths and remaining work in the manifest.
8. Run governance verification and inspect the diff for ownership or terminology drift.

Never repeat full evidence generation for an edit that has not passed its narrow
checkpoint. Shared-runtime and governance checks may be batched across candidates;
acceptance state, final evidence, and failure records remain per game.

Production Web, Android/Linux Web hosts, CLI, pipeline, presentation, and asset-tool changes use TypeScript. Python remains limited to research/migration tools and test harnesses; do not add a new Python production service.
C++ remains confined to the current compatibility kernel while the proposed Rust spike in ADR 0002 is evaluated.

Implementation never changes a requirement's wording. If product intent must
change, update the PRD first and update its contract references in the same PR.
Architecture changes require an ADR.

## Selector catalog

The exact catalog and availability are machine-owned by
`governance/project.json`. Current top-level checks are:

```sh
node scripts/verify-governance.mjs
pnpm verify:governance
pnpm verify:public
node --test scripts/lib/official-probe-capture.test.mjs
node --test scripts/smoke-private-cart-native.test.mjs scripts/smoke-private-cart.test.mjs
pnpm verify:rust
pnpm verify:hd-identity
pnpm verify:hd-presentation
pnpm verify:typography
pnpm verify:replay
pnpm verify:game-module
pnpm verify:batch
pnpm verify:supervised-transfer
pnpm verify:skill
make -C runtime/core test
make -C runtime/core wasm-test
pnpm verify:web
pnpm verify:private-remake
pnpm verify:native-cart-private
```

Private selectors strengthen local evidence but never masquerade as public CI.
`pnpm verify:batch` rejects shared identities, concurrent writers, invalid lanes,
evidence-free acceptance, and hidden partial failure before assembly.
`pnpm verify:supervised-transfer` validates four ordered human pauses, stop-specific proposal criteria/evidence/revision lineage, immutable unsigned signing-request export, recoverable filesystem state, and transfer-finding classification. It rejects forged/stale decisions, identity or byte drift, widened Agent authority, repeated challenges, concurrent/ambiguous writers, symlink aliases, handwritten terminal ledgers, universalized source-relative art, and reusable claims without shared regression evidence.
The host keeps the reviewer private key outside the Agent workspace; the runner consumes only the pinned public trust profile and detached signed decision.
`pnpm verify:typography` validates reachable text routing, fixed bundled-font
evidence, reviewed identity contours, complete coverage, and zero OS fallback.
`pnpm verify:qualification-private` requires `AICO8_PRIVATE_WORKSPACE`; it must
reject hooks, cart/state mutation, trace gaps, skipped logical updates, missing
level/ending milestones, and broken replay lineage.
`pnpm verify:qualification-gameplay-private` is the complete-artifact gameplay
gate, run only after promotion. The workspace supplies `validation/verify-canonical-gameplay.ts`;
the public runner rebuilds Wasm, executes it twice from clean persistence, validates
the emitted Replay v1 and differential record, rejects uncovered semantic mutations,
projects the complete trace through keyboard, controller, and touch with zero
logical-mask mismatch, and verifies a sanitized public attestation. Passing it
does not count a game until that game's accepted HD, Web/PWA, and rights-isolation
gates also pass. A non-level progression structure must declare its exact ordered
Replay milestone IDs in `differential.boundary.milestoneIds`; do not invent
`level-complete` milestones for checkpoints, chapters, waves, or other source
boundaries.
`pnpm verify:qualification-plan-private` requires
`AICO8_PRIVATE_QUALIFICATION_ROOT` and `AICO8_PRIVATE_CARTS`. It recomputes the
private 12-candidate plan from durable corpus, audio, compiler, rights, and finite-
boundary inputs and verifies the sanitized public attestation byte-for-byte. It
does not qualify a selected game or authorize publication.
`pnpm verify:private-remake` additionally requires `AICO8_PRIVATE_WORKSPACE` to
point at the authorized ignored workspace. It rebuilds twice, regenerates the
private content and complete keyboard/controller/touch input-projection evidence,
regenerates the current review packet, and checks the retained browser-review
record. The record must measure every layout class in the packaged target profile
through an active browser and bind its no-overflow, clipping, game/control bounds,
font, safe-area, screenshot, and visual-runtime results into release validation.
Any visual-runtime change invalidates and requires recapture of all retained
identity and layout screenshots; hashes may never be relabeled across builds.
Review HTML must address both inline and zoom images with the verified screenshot
SHA-256 query key. A fixed `file://` path can display stale browser cache and is
not review evidence, even when the adjacent JSON record names the current hash.
Capture automation must wait for `data-capture-status="ready"` and record the
matching DOM readiness fields for every screenshot. A timeout alone, a hidden
class alone, or a screenshot hash without the readiness record is insufficient;
the private selector rejects visible/transitioning overlays and records copied
from another mode, scene, state boundary, or viewport.
Readiness requires two consecutive presented frames with the overlay fully
excluded; a transition event or one valid sample cannot close the gate. Treat
distinctive wordmarks/source-drawn glyphs as contour-locked artwork: derive a
hashed source mask, preserve counters/topology and spacing, enforce less than
half-source-pixel displacement, then compile the constrained vector recipe.
Do not replace identity lettering with a generic font.
For indexed tile/sprite art, extract every palette/material layer and boundary
edge before authoring. Preserve each layer mask and give structurally distinct
variants distinct recipe IDs; shared labels such as wall, dirt, or collectible
are classification aids, not permission to substitute one generic primitive.
After scaffold validation, run the HD surface gate: use topology-constrained
splines, bind shade/base/highlight primitives to the compiled target, and render
at fixed 2x edge density. Represent every protected counter/hole as an explicit
unpainted cut; verify that compound shapes attach it to the containing component
and that edge treatments never traverse it. First recapture only the highest-risk title, character,
and material frames for visual preflight. Do not regenerate the complete packet
until those frames visibly improve line smoothness and internal/material detail;
this prevents a technically valid but aesthetically failed build from producing
false-looking completion evidence.
Review in the same fixed order every time: first Spirit fidelity (identity, atmosphere, motion, cues, and play feel), then Quality leap (resolution, surfaces, animation, detail, and sampling), then Aesthetic evolution (coherent modern color, light, composition, and finish). The packet and immutable decision must carry all three gates in that order; stop at the first failure and never trade it for later polish.
Only after the human repeats the packet's exact acceptance statement may
an Agent invoke `scripts/accept-private-hd-review.ts`; that command archives the
exact pending packet/document and writes one immutable decision. Subsequent
qualification must reproduce the reviewed draft and atomically regenerate the
accepted identity map/audit. Set
`AICO8_WRITE_ATTESTATION=1` only when intentionally refreshing the reviewed
sanitized public attestation.
Official-runtime selectors remain pending until licensed captures are available.
Accelerated replay must finish any `flip()`-driven initialization with neutral
host input, drain its pre-replay PCM, and only then number canonical update zero.
When startup motion itself needs review, capture its exact host-initialization
tick; never relabel that tick as a canonical update. A bounded neutral-input probe
may establish a normally reachable scene absent from the completion replay, but
it must use ordinary zero input and declare its own boundary lineage.
## Human-supervised conversion loop
The workflow is not autonomous or universal. Pause for human review of semantics,
first high-risk art, representative gameplay/motion, and final scope/rights.
Agents batch deterministic work between pauses. Use representative checkpoints;
do not solve the full game or regenerate full evidence per edit. A promoted
artifact needs an ordinary-input route replayed twice before full selectors.
Record reference-versus-trial learning in DATA-TRANSFER-FINDINGS-001: reusable findings require shared code/tests; source-relative findings remain private-adapter work attached to a human stop. An explicit project-owner message may decide a frozen packet when its proposal identity, scope, decision, and outcome are recorded in durable evidence. It cannot authorize publication or prove complete coverage. Detached signing remains optional for remote review. Stop sampling while either decision is pending.
## Recovery after interruption or failure

1. Re-read terminal output and `git status`; do not assume an interrupted command
   completed or failed atomically.
2. Inspect staged and unstaged diffs separately. Preserve unrelated user changes.
3. Re-run the narrowest failed selector with full output.
4. If generated output may be partial, regenerate it from the declared Job input;
   do not hand-edit generated evidence.
5. Compare `current_focus` and open items with the actual worktree. Add a bounded
   open item when work must stop; do not mark the requirement verified.
6. Resume from the first unmet exit condition, not from conversation memory.

After an uncatchable batch crash, disprove a lock's live owner before manual
removal; never delete an ambiguous lock. The supervised runner uses the same rule,
idempotently resumes identical bytes, and holds no lock while awaiting a human.
Local supervised research uses the project owner's explicit recorded decision; do not add external identity, signing, or cloud infrastructure unless a later remote multi-maintainer requirement explicitly needs it.
## Diagnosis

- Compatibility mismatch: isolate update number, input trace, RAM/state snapshot,
  raster/audio checkpoint, then compare against licensed official evidence.
- Completion mismatch: first replay the unchanged cart using only recorded
  button masks. Keep hook-driven reachability separately labeled and never use it
  to close a level, ending, game, or qualification exit.
- Solver-model mismatch: stop treating generated paths as evidence; isolate the
  first divergent input and transition phase, then record one root-cause class,
  one source-derived invariant, a minimal regression fixture, and a deliberately
  faulty mutation that the selector must reject. Apply the correction to shared
  transition semantics, never to a level number, coordinate, or saved path.
- Before accepting a solver change, differentially compare wall rejection,
  type-gated pre-move deposition, movement, recursive collection, all-segment
  post-move cleanup, type-4 conversion, remaining count, and win transition
  against the unchanged cart. Replay complete candidate prefixes again after any
  semantic correction; previously generated candidates are stale until rechecked.
- Native/Wasm mismatch: confirm identical source, toolchain identity, exported ABI,
  and byte buffers before changing gameplay code.
- Host-input mismatch: project the complete canonical trace through the shared
  keyboard/touch latch and controller sampler. Fix mapping or latch semantics,
  then require zero per-update mask mismatches; do not patch a recorded path.
- Host-menu mismatch: verify Enter/P, controller menu, and touch menu requests are
  absent from the gameplay mask; inspect registered labels, callback filters,
  invocation, keep-open behavior, and post-close suppression before changing a
  game. Fix the shared host/kernel boundary, not a cart-specific shortcut.
- HD copy mismatch: preserve the exact source-authored template, including case,
  punctuation, spacing, and number format; modernize only typography and layout
  through `sourceAuthoredCopy`. Do not normalize, paraphrase, or zero-pad copy.
- HD mismatch: run HD off/on against the same replay; any state divergence is a
  product defect even if the visual result looks correct.
- Browser-evidence lineage mismatch: compare the recomputed visual-runtime and
  replay-semantics identities before recapturing. Provenance-only replay revision
  churn may preserve both; visual artifacts, cart, input, milestones, checkpoints,
  or result changes must invalidate the affected evidence.
- Browser-layout mismatch: reproduce the target-profile viewport in the active
  packaged build, inspect document scroll dimensions, game/control bounds, text,
  fonts, and safe-area behavior, then fix the shared shell or contract and rerun
  every layout class. Do not exempt one device or reuse a screenshot from a prior
  visual-runtime identity.
- Public-attestation drift after its own commit indicates a self-referential full
  replay/package hash. Keep full artifact hashes in the private release manifest;
  attest publicly with the recomputed visual-runtime and replay-semantics identities.
- HD omission: capture the raw scene-contextual token before render dispatch,
  fix the shared classification/render rule, then add a deleted-mapping mutation
  that must fail. Do not patch one level, coordinate, or tile occurrence, and do
  not let renderer fallthrough masquerade as intentional empty space.
- Documentation mismatch: locate the concept owner, remove duplicate claims, and
  update references/manifest edges rather than patching every copy.
- Rights uncertainty: keep build/test private and leave release/publication exit open.

## Handoff and PR closure

Before publishing or handing off:

1. Run `git diff --check`, governance verification, and affected selectors.
2. Confirm every changed concept has one owner and every new document has a
   lifecycle role and line budget.
3. Update exits only to the level supported by durable evidence.
4. Leave explicit open items with the next action and required authority/fixture.
5. In the PR, state requirement/exit IDs, selectors run, private evidence limits,
   stack/base relationship, and what remains unverified.
6. After CI, update a pending governance/CI exit only when the recorded run covers
   the selector and exact revision.

For a batch, repeat this closure per game. Record partial success without
promoting failed or unverified modules into assembly.

## Safe continuation order

When governance is healthy, continue the active requirement in the manifest.
For qualification, keep Replay v1 and Dust Bunny as the accepted reference, then
run one materially different supervised transfer trial. Iterate representative
checkpoints through four human pauses and classify compatibility/runtime, reusable
presentation, and source-relative work. Run full replay, package, temporal, and
rights gates only if the human promotes it to a complete artifact.
Secondary platform work cannot enter this path unless it removes a shared blocker.

Before replaying a solver- or Agent-proposed trace, create
`validation/input-trace-provenance-v1.json` and bind it to the exact canonical
trace hash. First-party search carries no external sources. If any external
action sequence contributes, record its pinned revision, artifact and action
hashes, explicit reusable license and license evidence, plus the reviewed
private-research reuse decision. Unknown, `NOASSERTION`, or unlicensed sources
must be quarantined and the affected completion claim independently re-proved.
