---
name: aico8-remake
description: Guide an authorized PICO-8 cart through the Aico 8 human-reviewed HD remake workflow and package a private Web/PWA build, Android APK, or both. Use when a coding Agent must inspect a cart workspace, preserve unchanged-cart gameplay, create source-relative HD presentation, collect representative evidence, pause for human semantic and art decisions, or produce and verify Web or Android research artifacts.
---

# Aico 8 remake

Operate the repository's versioned Jobs. Keep compatibility, policy, validation,
and packaging logic in ordinary software; keep this Skill as a thin coordinator.

## Serve the non-technical user

The ordinary entry is one attached cart plus a plain-language request for Web,
Android APK, or both. Never ask the user to run a command, discover a repository
path, install a compiler, or locate a generated artifact. Run the product entry
commands from [references/job-catalog.md](references/job-catalog.md) yourself and
translate blockers into one short, actionable explanation.

1. Resolve this Skill's own directory and run its bundled
   `scripts/bootstrap.mjs`; do not assume a host-specific plugin root.
2. Ask only when the output target or private-research authorization is missing.
3. Bootstrap the isolated engine and retain the returned `engineRoot`.
4. Run the target-aware doctor. Repair safe local prerequisites yourself; if an
   external license or system authorization is required, ask only for that action.
5. Import the explicitly attached cart through the private intake command. Use
   the returned session manifest and copied cart path from then on; never expose
   internal paths to the user.
6. After all authorized validation passes, run the handoff command and attach or
   link the returned Web directory and APK directly in the final response.

## Start safely

1. Use the bootstrapped Aico 8 engine containing `governance/project.json`.
2. Read `AGENTS.md`, then read the current focus, exits, open items, and selector
   catalog in `governance/project.json`.
3. Read only the linked portions of `docs/PRODUCT.md`,
   `docs/ARCHITECTURE.md`, `docs/CONTRACTS.md`, and `docs/DEVELOPMENT.md`.
4. Accept one attached or explicitly selected `.p8` or `.p8.png` cart through
   the private intake command; never require a non-technical user to invent a
   repository-relative path. Do not choose among multiple carts by name,
   metadata, or apparent suitability. Ask the user to select one only when the
   attachment or selection is genuinely ambiguous. Stop before any Job if the
   file is inaccessible, escapes the allowed workspace after resolution, or is
   a directory. Confirm authorization for private research and the requested
   packaging scope; publication always requires a separate explicit decision.
5. Run `node scripts/agent/pnpm.mjs verify:governance` before changing code.
6. Ask in plain language whether the user wants Web, Android APK, or both.
   Default to Web when they do not request Android. Android always derives from
   the already-validated Web package; never build a separate game implementation.

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

## Build the selected candidate

1. Reuse shared presentation primitives only where source lineage supports them.
2. Bind identity contours, protected counters, material layers, composition, and
   visibility before adding surface detail.
3. Route identity lettering through contour-locked art and ordinary text through
   bundled deterministic fonts.
4. Verify the active 1024×1024 square layout, visible touch controls, relative
   deployment URLs, and service-worker cache isolation.
5. Build and verify the private Web/PWA package with `JOB-PACKAGE-001` for every
   target. For `android` or `both`, stage those exact Web bytes through the
   Capacitor host, verify lineage, and build a debug APK. Do not silently require
   physical hardware: the named emulator and shared-Web simulator are the
   acceptance path; a physical-device run is optional.
6. Materialize only the selected, verified artifacts through the Agent handoff
   command. Return them to the user instead of reporting internal build paths.
7. Do not build a release-signed APK/AAB or publish any artifact unless the user
   supplies the external signing inputs and the independent rights exit passes.

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
