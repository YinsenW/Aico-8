# Aico 8 Job catalog

Use this reference only after reading the checkout's contract and selector
catalog. Commands are repository-relative and may require private workspace
environment variables.

For supervised-transfer commands, `<job.json>` is the frozen proposal identity.
`<artifact-dir>` and `<ledger.json>` stay in the selected authorized ignored
workspace; only the runner mutates ledger contents. When optional detached review
is used, `<trust.json>` and `<decision>` are reviewer-owned, read-only Agent inputs
and must never be generated or repaired by the Agent.

| Purpose | Contract or selector | Command | Boundary |
| --- | --- | --- | --- |
| Install the isolated engine | Agent product entry | `node <skill-root>/scripts/bootstrap.mjs` | Run the script bundled with the portable Skill; consume its JSON `engineRoot` and do not show the command to the user. |
| Check the selected target | Agent product entry | `node scripts/agent/aico8-agent.mjs doctor --target <web|android|both> --engine-root <engine-root>` | Repair safe prerequisites automatically; physical hardware is never required. |
| Import the attached cart | Agent product entry | `node scripts/agent/aico8-agent.mjs intake --cart <resolved-attachment> --target <web|android|both> --authorized-private-research` | Requires explicit private-research authority and copies only one `.p8`/`.p8.png` into isolated private state. |
| Return finished artifacts | Agent product entry | `node scripts/agent/aico8-agent.mjs handoff --session <session.json> [--web <verified-package>] [--apk <verified-apk>]` | Copies only target-selected verified artifacts into the session deliverables and returns machine-readable paths for Agent attachment. |
| Governance preflight | `TEST-GOV-001` | `pnpm verify:governance` | Run before edits and handoff. |
| Ingest one authorized cart | `JOB-INGEST-001` | `pnpm ingest:cart -- --manifest <cart-input.json> --output <workspace> --codec-command <pinned-shrinko8> --codec-revision <revision-path> --codec-sha256 <sha256> --codec-version <semver>` | Materialize only an absent/empty private workspace; decoding proves exact ROM equality but grants no publication authority. |
| Initialize or resume a supervised trial | `JOB-SUPERVISED-TRANSFER-001` | `pnpm exec tsx scripts/run-supervised-transfer.ts init --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json>` | The runner validates state; it cannot approve. |
| Submit a stop proposal | `JOB-SUPERVISED-TRANSFER-001` | `pnpm exec tsx scripts/run-supervised-transfer.ts submit --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json> --stop <stop-id> --proposal <relative-path>` | Submit only the next ordered stop. |
| Export an unsigned review request | `DATA-HUMAN-STOP-REQUEST-001` | `pnpm export:human-stop-request --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json> --out <relative-request.json>` | For optional remote review, the reviewer signs outside the Agent. |
| Apply a detached decision | `JOB-SUPERVISED-TRANSFER-001` | `pnpm exec tsx scripts/run-supervised-transfer.ts apply --manifest <job.json> --root <artifact-dir> --ledger <ledger.json> --trust <trust.json> --decision <relative-path>` | Reject forged, stale, or drifted decisions. |
| Verify pause contracts | `TEST-SUPERVISED-TRANSFER-PUBLIC` | `pnpm verify:supervised-transfer` | Public, deterministic, and safe during iteration. |
| Build the private Web/PWA candidate | `JOB-PACKAGE-001` | `pnpm build:private-web --workspace <workspace> --out <package-dir> --id <id> --title <title> --author <author> --source-license <license> --source-url <url> [other declared options]` | Research package only unless rights pass. |
| Verify a Web/PWA package | `TEST-WEB-PUBLIC` plus package check | `pnpm verify:web-package -- <package-dir>` | Verify relative assets, checksums, target profile, and scoped PWA metadata. |
| Stage Web bytes for Android | `DATA-ANDROID-WEB-LINEAGE-001` | `pnpm --filter @aico8/mobile assemble:web -- <validated-web-package>` then `pnpm --filter @aico8/mobile cap:copy` | Android must package the exact validated Web tree; it is not another remake. |
| Verify Android lineage | `TEST-PLATFORM-ANDROID-PUBLIC` | `pnpm --filter @aico8/mobile verify:lineage -- <validated-web-package>` | Reject any source, staging, or native-asset drift before Gradle runs. |
| Build a private debug APK | `JOB-PACKAGE-001` | `(cd apps/mobile/android && ./gradlew assembleDebug)` | Requires Java 21 and Android SDK/API 36; output is `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Emulator evidence may close technical acceptance; physical hardware is optional. |
| Build the identity review packet | `JOB-CAPTURE-001` | `node scripts/build-private-hd-review-packet.mjs --workspace <workspace> --write true` | Packet generation is not approval. |
| Verify complete-artifact gameplay | `TEST-QUALIFICATION-GAMEPLAY-PRIVATE` | `AICO8_PRIVATE_WORKSPACE=<workspace> pnpm verify:qualification-gameplay-private` | Run only after `final-scope` approves `authorize-full-validation`; permission to run is not proof that it passed. |
| Verify the Skill | `TEST-SKILL-PUBLIC` | `pnpm verify:skill` | Proves the package stays thin and preserves ordered human pauses. |

Use selectors from `governance/project.json` as the authority when this table and
the current checkout differ. Never paste private cart paths, decisions, captures,
or generated packages into the public Skill.
