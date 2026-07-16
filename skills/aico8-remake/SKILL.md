---
name: aico8-remake
description: Guide an authorized PICO-8 cart through the Aico 8 human-reviewed HD Web remake workflow. Use when Codex must inspect a cart workspace, preserve unchanged-cart gameplay, create source-relative HD presentation, collect representative evidence, pause for human semantic and art decisions, or package and verify a private Web/PWA research build.
---

# Aico 8 remake

Operate the repository's versioned Jobs. Keep compatibility, policy, validation,
and packaging logic in ordinary software; keep this Skill as a thin coordinator.

## Start safely

1. Locate the Aico 8 repository containing `governance/project.json`.
2. Read `AGENTS.md`, then read the current focus, exits, open items, and selector
   catalog in `governance/project.json`.
3. Read only the linked portions of `docs/PRODUCT.md`,
   `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, and `docs/DEVELOPMENT.md`.
4. Require one exact repository-relative cart path from the user or an existing
   authorized manifest. Never choose among carts by name, metadata, or apparent
   suitability. Stop before any Job if the path is absent, ambiguous, escapes
   the repository, or names a directory. Confirm separate authorization for the
   requested research, packaging, and publication scope; keep private material
   outside public history.
5. Run `pnpm verify:governance` before changing code.

Read [references/job-catalog.md](references/job-catalog.md) before invoking a
Job. Use the exact commands and inputs owned by the current checkout; do not
reimplement a Job inside this Skill.

## Preserve the two-layer invariant

- Treat the unchanged cart, compatibility kernel, logical update cadence,
  input, RNG, collision, persistence, and source raster as authoritative.
- Treat HD presentation as read-only. Never repair a visual mismatch by changing
  compatibility state or by adding a game-specific simulation fork.
- Classify source elements from cart logic, state transitions, scene context,
  and source evidence before redrawing them.
- Apply the three non-compensatory review principles in order: spirit fidelity,
  quality leap, then aesthetic evolution. A later principle cannot excuse a
  failure of an earlier one.
- Keep source-relative judgments in the private adapter. Promote a finding to a
  reusable rule only when shared implementation and a mutation-catching public
  regression prove it.

## Run the supervised loop

Advance the four human stops only in this order:

1. `semantic-intent`
2. `art-direction`
3. `representative-gameplay`
4. `final-scope`

Between stops, batch deterministic analysis, implementation, capture, and narrow
validation. Use representative same-state pairs and exact-update motion/cue
sequences; do not solve or recapture the full game after every edit.

At every stop:

1. Freeze a valid `DATA-SUPERVISED-REVIEW-PROPOSAL-001`, including exact transfer
   identity, evidence hashes, required stop criteria, revision lineage,
   limitations, forbidden claims, and Agent authority limits.
2. Export `DATA-HUMAN-STOP-REQUEST-001` when a detached signing workflow is configured.
3. Present the bounded evidence and forbidden claims to the human.
4. Stop sampling. Never create, infer, edit, or replace a human decision.
5. Resume only from an explicit project-owner approval or revision request bound
   to the frozen proposal. Record the exact decision, proposal identity, scope,
   and outcome in durable project evidence. The Agent may consume that decision
   but never create, infer, edit, select, or replace it. A local approval closes
   only the declared research/trial stop; it is not complete-game proof,
   publication authority, or a rights decision. A detached signed decision may
   be used when a remote workflow genuinely needs it, but is not a prerequisite
   for the local human-guided remake loop.
6. On revision, preserve the rejected attempt and regenerate only evidence bound
   to changed inputs.

For `final-scope`, accept only one explicit disposition:

- `retain-supervised-trial`: close the bounded learning trial without claiming a
  complete game or releasable remake.
- `authorize-full-validation`: unlock ordinary-input full progression and package
  selectors; do not treat authorization as proof that they passed.

Never self-accept or self-release. Never infer rights from technical readiness.

## Build the HD Web candidate

1. Reuse shared presentation primitives only where source lineage supports them.
2. Bind identity contours, protected counters, material layers, composition, and
   visibility before adding surface detail.
3. Route identity lettering through contour-locked art and ordinary text through
   bundled deterministic fonts.
4. Verify the active 1024×1024 square layout, visible touch controls, relative
   deployment URLs, and service-worker cache isolation.
5. Build a private research package with `JOB-PACKAGE-001`; do not publish it
   unless the independent rights exit is verified.

## Validate proportionately

- During iteration, run governance and the narrow selector attached to the
  changed exit.
- Before a human stop, regenerate only the proposal-bound representative packet.
- At `representative-gameplay`, use only proposal-bound checkpoints, same-state
  pairs, and exact-update motion/cue sequences; do not invoke the complete-route
  `TEST-QUALIFICATION-GAMEPLAY-PRIVATE` selector.
- Before a retained-trial handoff, run the supervised-transfer, Web, and Skill
  selectors recorded in governance.
- Run complete ordinary-input progression, repeat replay, performance, package,
  and rights selectors only after `authorize-full-validation`.
- Treat implementation as incomplete until the governing exit lists durable
  evidence and passing selectors with no blocker.

## Hand off

Update only the owning document. Record implementation, evidence, selectors,
remaining limitations, and the next human stop in `governance/project.json`.
Inspect staged and unstaged diffs, keep private paths and artifacts out of public
history, and follow the recovery/handoff procedure in `docs/DEVELOPMENT.md`.
