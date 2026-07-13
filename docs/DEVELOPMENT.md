# Development agent runbook

## Bootstrap and select work

1. Inspect `git status --short --branch` and existing stacked PRs before editing.
2. Run `pnpm verify:governance` and read `current_focus` in
   `governance/project.json`.
3. Select the matching `ROADMAP.md` work package, requirement, and exit/open-item
   set. Do not invent a parallel status list in a plan, README, PR body, or
   research note.
4. Read the owner documents and only the evidence linked by those exits.
5. Confirm private fixtures exist when a selector declares `private` availability.

Through the first complete remake, select only browser Web/PWA work or a
compatibility, contract, asset, typography, input, or packaging dependency that
directly blocks Web. Android packaging, Linux handheld profiles, collections,
ESP32, and the final Skill remain later work.

## Implementation loop

1. Write or adjust the smallest failing test/checkpoint that represents the exit.
2. Change code behind the owning API or data contract.
3. Preserve the separate compatibility reference path; never introduce mixed
   indexed fragments into accepted HD presentation.
4. Run the narrow selector, then every selector attached to the affected exit.
5. Record exact implementation/evidence paths and remaining work in the manifest.
6. Run governance verification and inspect the diff for ownership or terminology drift.

Production Web, Android/Linux Web hosts, CLI, pipeline, presentation, and
asset-tool changes use TypeScript. Python remains limited to research/migration tools and test harnesses;
do not add a new Python production service. C++ remains confined to the current
compatibility kernel while the proposed Rust spike in ADR 0002 is evaluated.

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
pnpm verify:hd-identity
pnpm verify:hd-presentation
pnpm verify:replay
make -C runtime/core test
make -C runtime/core wasm-test
pnpm verify:web
pnpm verify:private-remake
```

Private-archive selectors strengthen local evidence but never masquerade as
public CI or enter the clean public repository history.
`pnpm verify:qualification-private` requires `AICO8_PRIVATE_WORKSPACE`; it must
reject hooks, cart/state mutation, trace gaps, skipped logical updates, missing
level/ending milestones, and broken replay lineage.
`pnpm verify:private-remake` additionally requires `AICO8_PRIVATE_WORKSPACE` to
point at the authorized ignored workspace. It rebuilds twice, regenerates the
private content and complete keyboard/controller/touch input-projection evidence,
regenerates the current review packet, and checks the retained browser-review
record. The record must measure every layout class in the packaged target profile
through an active browser and bind its no-overflow, clipping, game/control bounds,
font, safe-area, screenshot, and visual-runtime results into release validation.
Any visual-runtime change invalidates and requires recapture of all retained
identity and layout screenshots; hashes may never be relabeled across builds.
Only after the human repeats the packet's exact acceptance statement may
an Agent invoke `scripts/accept-private-hd-review.ts`; that command archives the
exact pending packet/document and writes one immutable decision. Subsequent
qualification must reproduce the reviewed draft and atomically regenerate the
accepted identity map/audit. Set
`AICO8_WRITE_ATTESTATION=1` only when intentionally refreshing the reviewed
sanitized public attestation.
Official-runtime selectors remain pending until licensed captures are available.

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
For the qualification program the order is Replay v1 contract, Dust Bunny's 30
canonical level paths, build hardening, corpus risk inventory, then games 2–10
one at a time through unchanged-cart replay, HD invariance, Web/PWA packaging,
static plus exact-update temporal manual review, and the independent rights gate. Secondary platform work cannot
enter this path unless it removes a shared blocker.
