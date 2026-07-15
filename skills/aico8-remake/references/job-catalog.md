# Aico 8 Job catalog

Use this reference only after reading the checkout's contract and selector
catalog. Commands are repository-relative and may require private workspace
environment variables.

For supervised-transfer commands, `<job.json>` is a repository-prepared
candidate whose identity a trusted host pins before portable approval.
`<artifact-dir>` and `<ledger.json>` stay in the selected authorized ignored
workspace; only the runner mutates ledger contents. `<trust.json>` and detached
`<decision>` files are host-owned, read-only Agent inputs and must never be
generated or repaired by the Agent.

| Purpose | Contract or selector | Command | Boundary |
| --- | --- | --- | --- |
| Governance preflight | `TEST-GOV-001` | `pnpm verify:governance` | Run before edits and handoff. |
| Initialize or resume a supervised trial | `JOB-SUPERVISED-TRANSFER-001` | `pnpm exec tsx scripts/run-supervised-transfer.ts init --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json>` | The runner validates state; it cannot approve. |
| Submit a stop proposal | `JOB-SUPERVISED-TRANSFER-001` | `pnpm exec tsx scripts/run-supervised-transfer.ts submit --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json> --stop <stop-id> --proposal <relative-path>` | Submit only the next ordered stop. |
| Export an unsigned review request | `DATA-HUMAN-STOP-REQUEST-001` | `pnpm export:human-stop-request --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json> --out <relative-request.json>` | A trusted host signs outside the Agent. |
| Verify a trusted-host transition | `DATA-HOST-AUTHORITY-PROFILE-001`, `DATA-HOST-AUTHORITY-RECEIPT-001` | Use the repository contract verifier from the host adapter; compare against the independently fetched current head. | Contract verification is available; deployment, keys, reviewer UI, database CAS, and rollback anchor remain external authority facts. |
| Apply a detached decision | `JOB-SUPERVISED-TRANSFER-001` | `pnpm exec tsx scripts/run-supervised-transfer.ts apply --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json> --decision <relative-path>` | Reject forged, stale, or drifted decisions. |
| Verify pause contracts | `TEST-SUPERVISED-TRANSFER-PUBLIC` | `pnpm verify:supervised-transfer` | Public, deterministic, and safe during iteration. |
| Build the private Web/PWA candidate | `JOB-PACKAGE-001` | `pnpm build:private-web --workspace <workspace> --out <package-dir> --id <id> --title <title> --author <author> --source-license <license> --source-url <url> [other declared options]` | Research package only unless rights pass. |
| Verify a Web/PWA package | `TEST-WEB-PUBLIC` plus package check | `pnpm verify:web-package -- <package-dir>` | Verify relative assets, checksums, target profile, and scoped PWA metadata. |
| Build the identity review packet | `JOB-CAPTURE-001` | `node scripts/build-private-hd-review-packet.mjs --workspace <workspace> --write true` | Packet generation is not approval. |
| Verify complete-artifact gameplay | `TEST-QUALIFICATION-GAMEPLAY-PRIVATE` | `AICO8_PRIVATE_WORKSPACE=<workspace> pnpm verify:qualification-gameplay-private` | Run only after `final-scope` approves `authorize-full-validation`; permission to run is not proof that it passed. |
| Verify the Skill | `TEST-SKILL-PUBLIC` | `pnpm verify:skill` | Proves the package stays thin and preserves ordered human pauses. |

Use selectors from `governance/project.json` as the authority when this table and
the current checkout differ. Never paste private cart paths, decisions, captures,
or generated packages into the public Skill.
