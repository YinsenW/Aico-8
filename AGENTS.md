# Aico 8 agent entry

This repository is designed to be advanced and maintained by AI development
agents. Treat documents and executable evidence as part of the product.

## Start every development session

1. Read `governance/project.json` for `current_focus`, requirement status, exits,
   open items, test selectors, and document ownership.
2. Read only the relevant sections of `docs/PRODUCT.md`,
   `docs/ARCHITECTURE.md`, and `docs/CONTRACTS.md`.
3. Follow `docs/DEVELOPMENT.md` for implementation, recovery, testing, and handoff.
4. Read research or captured evidence only when an owner document or exit links
   to it. Do not bulk-load `research/` or generated result files.
5. Run `pnpm verify:governance` before changing code. If it fails, repair
   governance first or record a bounded open item.

## Truth and completion rules

- `docs/PRODUCT.md` owns product intent and requirement wording.
- `docs/ARCHITECTURE.md` and accepted ADRs own technical boundaries.
- `docs/CONTRACTS.md` owns API, Job, and data-contract relationships; code and
  schemas own field-level details.
- `governance/project.json` is the only owner of current status, exits, evidence
  links, test selectors, open items, and current focus.
- Implementation is not completion. Never mark an exit or requirement verified
  merely because code exists.
- An exit is verified only when its implementation, durable evidence, and test
  selectors are all recorded and passing, with no open blocker.
- Third-party runtimes are diagnostic. Licensed official PICO-8 captures are the
  compatibility oracle.
- Extracted carts and generated remakes are private unless the rights gate is
  explicitly satisfied.

## Scope boundaries

- TypeScript owns Web/PWA, mobile, product tooling, HD presentation, and the
  future orchestration layer.
- The narrow C++ compatibility kernel owns deterministic PICO-8 semantics and
  is compiled natively and to WebAssembly.
- Do not add production Python or expand C++ outside `runtime/core/`. ADR 0002
  defines the required Rust+C native/Wasm/ESP32 spike before any kernel migration.
- HD presentation may not mutate compatibility state, collision, RNG, timing,
  persistence, or original draw/update cadence.
- The final Skill is created only after repeated end-to-end release exercises.

## Required checks

```sh
pnpm verify:governance
pnpm verify:public
make -C runtime/core test
pnpm verify:web
```

Use the exact selector catalog in `governance/project.json` to choose narrower
checks. Run every selector attached to a changed exit before handoff.

## Before claiming or handing off work

1. Re-read the affected requirement, exit, contract IDs, and open items.
2. Update the single owning document; link rather than duplicate definitions.
3. Record implementation paths, evidence, selectors, and remaining work in the
   governance manifest.
4. Run governance plus affected tests and inspect the worktree diff.
5. Follow the handoff and recovery record in `docs/DEVELOPMENT.md`.

Governance policy and the five scored quality dimensions are defined in
`docs/GOVERNANCE.md`. Every dimension must score at least 9.5/10.
