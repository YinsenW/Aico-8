# AI-agent-first governance

This policy makes repository intent, implementation state, evidence, and
remaining work recoverable without relying on conversation history.

## Authority map

| Concern | Single owner | Supporting material |
| --- | --- | --- |
| Product scope and requirements | `docs/PRODUCT.md` | Roadmap milestone view |
| Current status and traceability | `governance/project.json` | CI logs and linked evidence |
| System boundaries | `docs/ARCHITECTURE.md` | Accepted ADRs |
| API, Job, and data relationships | `docs/CONTRACTS.md` | Headers, TypeScript types, schemas |
| Development/recovery procedure | `docs/DEVELOPMENT.md` | Component READMEs |
| Dependency order and work-package decomposition | `ROADMAP.md` | Status and Exit truth remain in the governance manifest |
| Display field values | `specs/display-profiles.json` | `specs/display-1024.md` rationale |
| Compatibility observations | Linked maintained references | Research captures and probes |

Supporting documents may explain or provide evidence, but must link to the
owner instead of redefining the owned claim.

## Resource lifecycle

| Class | Location | Mutability | Agent use |
| --- | --- | --- | --- |
| Authoritative current | Root entry files, `docs/`, `specs/`, `governance/` | Updated with the owning change | Read selectively before implementation |
| Decision history | `docs/decisions/` | Append-only after acceptance; supersede with a new ADR | Read when the affected boundary changes |
| Maintained reference | `docs/reference/` | Updated when primary semantics change | Read only when linked by an exit or contract |
| Research evidence | `research/` | Preserve observations; add supersession notice rather than silently rewrite conclusions | Read on demand, never as current status |
| Executable evidence | `tests/` | Versioned fixtures and selectors | Run or inspect when linked by an exit |
| Generated evidence | Named result/capture directories and CI logs | Regenerate; do not treat as hand-authored policy | Diagnose and substantiate only |
| Private inputs | `private/`, `pico8_carts/`, `workspaces/` | Local and ignored | Keep outside Apache history; package only under an approved rights profile |

## Public repository gate

Changing repository visibility is a release action. Before making the source
repository public, agents must verify the complete reachable Git history, not
only the current tree: no secret, private cart/workspace, official capture, or
unlicensed cart-derived fixture may remain. The owner must also select the
project source license; third-party notices are not a substitute.

The Dust Bunny source page declares CC BY-NC-SA 4.0. Its cart, derived HD adapter,
and detailed evidence therefore remain in the ignored private workspace instead
of the Apache-2.0 source history. The owner has selected private research/testing
only; any future publication must record CC attribution, non-commercial and
share-alike compliance, or separate permission. Source-repository visibility
never satisfies that independent rights gate.

## Stable IDs and cross-document changes

- Product requirements use `REQ-*`; exits use `EXIT-*`; open work uses `OPEN-*`.
- Roadmap work packages use `WP-M<stage>-<number>` and link requirements plus
  acceptance exits; they never own status or completion claims.
- Public boundaries use `API-*`; pipeline stages use `JOB-*`; durable payloads
  use `DATA-*`; executable selectors use `TEST-*`.
- Requirement wording lives only in the PRD. Status and relationship edges live
  only in the governance manifest.
- API/Job/data relationship changes update `docs/CONTRACTS.md` and the manifest
  in the same change. Field changes update the owning header, type, or schema.
- Architectural changes require an ADR and the affected contract references.
- Code changes update traceability only when they materially change an exit's
  evidence, selector, status, or remaining work.

## Status and completion semantics

Allowed states are `planned`, `in_progress`, `verified`, `blocked`, and
`deprecated`.

- `planned`: accepted scope with explicit next work.
- `in_progress`: implementation or evidence exists, but at least one exit is not
  verified; an open item states the next action.
- `verified`: every exit has implementation paths, durable evidence, passing
  selectors, and no open blocker.
- `blocked`: a named external dependency prevents the next action.
- `deprecated`: retained only for history with a replacement link.

An implementation commit is evidence of work, not evidence of acceptance.
Research results and third-party runtime captures cannot close an exit that
requires official-runtime or platform evidence.

Evidence grades are ordered and never silently promoted:

- `inventory`: static discovery; proves only that content or an API exists.
- `instrumented_reachability`: hooks or controlled state reach a scene; useful
  for coverage diagnosis, never for gameplay completion.
- `model_candidate`: a solver, translator, or AI-authored trace that has not yet
  passed transition-by-transition unchanged-cart differential validation; never
  gameplay completion evidence.
- `canonical_replay`: unchanged cart, ordinary button masks, every logical
  update, and provenance-linked persistence complete the declared path.
- `official_differential`: a canonical replay also matches authorized official
  runtime checkpoints for the semantics named by the exit. Provider-authorized
  Education Web and licensed desktop captures remain distinct channels and may
  only prove capabilities their recorded workflow actually observes.
- `manual_review`: a recorded human review of presentation, feel, accessibility,
  or audio; supplements but cannot replace required executable evidence.

An all-level or all-game claim requires canonical replay evidence for every
required level, ending, and progression boundary. A test hook, state edit, level
skip, synthetic win flag, or omitted logical update disqualifies that claim.

Batch work never shares acceptance state: each game keeps independent provenance,
exits, evidence, selectors, failures, and remaining work. A collection build is
not evidence that every included game passed; assembly must link each game's
validation record and refuse incomplete modules.

## Change and review loop

1. Select one requirement and one or more exits from `current_focus`.
2. Confirm contract IDs and the exact owner of every concept being changed.
3. Implement the smallest coherent slice and add/adjust stable test selectors.
4. Run the affected selectors; preserve durable evidence where required.
5. Update exits and open items without overstating status.
6. Run `pnpm verify:governance`, inspect the diff, and publish a bounded PR.
7. After CI, close only the open items actually satisfied by that run.

## Five-dimensional quality gate

`scripts/verify-governance.mjs` evaluates at least ten objective checks in each
dimension. The score is `passed / total × 10`; because one failed check can drop
a dimension below 9.5, the current policy expects every reported check to pass.

| Dimension | What is measured |
| --- | --- |
| Navigation and resource lifecycle | Entry path, ownership, valid links, lifecycle classes, and current focus |
| Cross-document contract consistency | Stable IDs, owner presence, references, terminology, and display invariants |
| Traceability and acceptance closure | Requirement/exit/open-item graph, evidence paths, selectors, and verified-state rules |
| Subsequent development support | Bootstrap, recovery, tests, private-data safety, CI, and handoff instructions |
| Leanness and maintainability | Entry count, line budgets, one owner per concept, no duplicate status view, and research isolation |

The verifier is a floor, not a substitute for review. Any semantic contradiction
found by an agent is a governance defect even if the structural score passes.

## Documentation budget

- Keep the default navigation set at seven documents or fewer.
- Keep `AGENTS.md` under 160 lines, `README.md` under 140, and `ROADMAP.md` under 90.
- Keep each governance core document under 250 lines.
- Prefer IDs and links over copied prose, status tables, or duplicated commands.
- New documents require a distinct owner concept or lifecycle role in the
  manifest. Otherwise extend the existing owner.
