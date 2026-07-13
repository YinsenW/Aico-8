# Development agent runbook

## Bootstrap and select work

1. Inspect `git status --short --branch` and existing stacked PRs before editing.
2. Run `pnpm verify:governance` and read `current_focus` in
   `governance/project.json`.
3. Select one requirement and its exit/open-item set. Do not invent a parallel
   status list in a plan, README, PR body, or research note.
4. Read the owner documents and only the evidence linked by those exits.
5. Confirm private fixtures exist when a selector declares `private` availability.

## Implementation loop

1. Write or adjust the smallest failing test/checkpoint that represents the exit.
2. Change code behind the owning API or data contract.
3. Preserve compatibility fallbacks and avoid unrelated cleanup.
4. Run the narrow selector, then every selector attached to the affected exit.
5. Record exact implementation/evidence paths and remaining work in the manifest.
6. Run governance verification and inspect the diff for ownership or terminology drift.

Production Web, mobile, CLI, pipeline, presentation, and asset-tool changes use
TypeScript. Python remains limited to research/migration tools and test harnesses;
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
make -C runtime/core test
pnpm verify:web
```

Private-archive selectors strengthen local evidence but never masquerade as
public CI or enter the clean public repository history.
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
- Native/Wasm mismatch: confirm identical source, toolchain identity, exported ABI,
  and byte buffers before changing gameplay code.
- HD mismatch: run HD off/on against the same replay; any state divergence is a
  product defect even if the visual result looks correct.
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

## Safe continuation order

When governance is healthy, continue the active requirement in the manifest.
For the first remake the intended dependency order is compatibility graphics and
VM bindings, native/Wasm identity, browser input/playability, semantic HD mapping,
assets/animation/effects, touch/accessibility/performance, then release packaging
and the independent rights gate.
