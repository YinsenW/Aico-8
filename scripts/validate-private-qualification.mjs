import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validationReplaySemanticsSha256 } from "./lib/release-identities.mjs";
import {
  assertInputTraceProvenance,
  inputTraceSha256,
} from "./lib/input-trace-provenance.mjs";
import { runPrivateTypeScript } from "./lib/private-typescript-runner.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceValue = process.env.AICO8_PRIVATE_WORKSPACE;
assert.ok(workspaceValue, "AICO8_PRIVATE_WORKSPACE must name an authorized ignored workspace");
const workspace = path.resolve(workspaceValue);
const identityBuilder = path.join(workspace, "validation", "build-hd-identity-map.ts");
const differential = path.join(workspace, "validation", "verify-solver-differential.ts");
const invariants = path.join(workspace, "validation", "verify-solver-invariants.ts");
const traceProvenancePath = path.join(workspace, "validation", "input-trace-provenance-v1.json");
assert.ok(fs.existsSync(identityBuilder), `missing private HD identity builder: ${identityBuilder}`);
assert.ok(fs.existsSync(differential), `missing private solver differential: ${differential}`);
assert.ok(fs.existsSync(invariants), `missing private solver invariants: ${invariants}`);
assert.ok(fs.existsSync(path.join(workspace, "source.rom")), "private workspace is missing source.rom");
assert.ok(fs.existsSync(path.join(workspace, "code.p8.lua")), "private workspace is missing code.p8.lua");
assert.ok(fs.existsSync(traceProvenancePath), "private workspace is missing input-trace-provenance-v1.json");
const replay = JSON.parse(fs.readFileSync(path.join(workspace, "validation", "canonical-replay-v1.json"), "utf8"));
const traceProvenance = JSON.parse(fs.readFileSync(traceProvenancePath, "utf8"));
assertInputTraceProvenance(traceProvenance);
assert.equal(traceProvenance.traceSha256, inputTraceSha256(replay.trace),
  "input-trace provenance does not bind the exact canonical trace");

function runPrivateCheck(script) {
  const result = runPrivateTypeScript({
    script,
    cwd: workspace,
    env: { ...process.env, AICO8_REPO: repository },
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  assert.equal(result.status, 0, `private qualification check ${path.basename(script)} failed with status ${result.status}`);
}

runPrivateCheck(identityBuilder);
runPrivateCheck(invariants);
runPrivateCheck(differential);

const invariantAuditPath = path.join(workspace, "validation", "solver-invariants.json");
const invariantAudit = JSON.parse(fs.readFileSync(invariantAuditPath, "utf8"));
assert.equal(invariantAudit.schemaVersion, 1);
assert.ok(Array.isArray(invariantAudit.cases) && invariantAudit.cases.length >= 4);
assert.ok(invariantAudit.cases.every((testCase) => testCase.value === testCase.expected));
assert.equal(
  invariantAudit.optimisticClosureLookahead?.rectangularRoomCornerDirt,
  invariantAudit.optimisticClosureLookahead?.expected,
);
assert.equal(invariantAudit.sourceSemanticGuidance?.cleanStart, false);
assert.equal(invariantAudit.sourceSemanticGuidance?.producingStart, true);
assert.equal(invariantAudit.sourceSemanticGuidance?.cleanPhase, false);
assert.equal(invariantAudit.sourceSemanticGuidance?.activatedPhase, true);
assert.notEqual(invariantAudit.beamDiversity?.clean, invariantAudit.beamDiversity?.remaining);
assert.notEqual(invariantAudit.beamDiversity?.clean, invariantAudit.beamDiversity?.producer);

const auditPath = path.join(workspace, "validation", "solver-differential.json");
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
assert.equal(audit.schemaVersion, 1);
assert.ok(Array.isArray(audit.candidates) && audit.candidates.length > 0);
assert.ok(audit.candidates.every((candidate) => candidate.result === "match"));
assert.ok(Number.isInteger(audit.totalTransitions) && audit.totalTransitions > 0);
assert.ok(Array.isArray(audit.mutations) && audit.mutations.every((mutation) => mutation.detected === true));

const canonicalAudit = JSON.parse(fs.readFileSync(path.join(workspace, "validation", "canonical-run-audit.json"), "utf8"));
const identityMap = JSON.parse(fs.readFileSync(path.join(workspace, "validation", "hd-identity-map.json"), "utf8"));
const hdAudit = JSON.parse(fs.readFileSync(path.join(workspace, "validation", "hd-presentation-audit.json"), "utf8"));
const identityAccepted = identityMap.status === "accepted";
const decisionPath = path.join(workspace, "evidence", "identity-review-decision.json");
assert.equal(replay.schemaVersion, "aico8.replay.v1");
assert.equal(replay.canonicality?.cartMutation, "none");
assert.equal(replay.canonicality?.compatibilityStateMutation, "none");
assert.equal(replay.canonicality?.testHooks, false);
assert.equal(replay.result?.completed, true);
assert.equal(replay.result?.finalMilestoneId, "restart-complete");
assert.equal(replay.trace?.totalUpdates, canonicalAudit.logicalUpdates);
assert.equal(canonicalAudit.levelsCompleted, 30);
assert.equal(canonicalAudit.candidateInputMoves, audit.totalTransitions);
assert.equal(canonicalAudit.midpointProbe?.resumedLevel, 16);
assert.equal(canonicalAudit.midpointProbe?.result, "match");
assert.equal(canonicalAudit.ending?.reached, true);
assert.equal(canonicalAudit.ending?.completedThroughEndtimer, 140);
assert.equal(canonicalAudit.ending?.restartCompleted, true);
assert.equal(canonicalAudit.persistenceBoundaries?.length, 30);
assert.equal(canonicalAudit.persistenceBoundaries?.at(-1)?.storedLevel, 0);
assert.ok(replay.requiredMilestoneIds.includes("ending-reached"));
assert.ok(replay.requiredMilestoneIds.includes("game-complete"));
assert.ok(replay.requiredMilestoneIds.includes("restart-complete"));
assert.equal(identityMap.schemaVersion, "aico8.hd-identity-map.v1");
assert.ok(["draft", "accepted"].includes(identityMap.status), "identity map status");
assert.equal(identityMap.gameId, replay.gameId);
assert.equal(identityMap.canonicalReplayId, replay.replayId);
assert.equal(identityMap.elements.length, 20);
assert.deepEqual(identityMap.coverage.reachableElementIds, identityMap.coverage.mappedElementIds);
assert.ok(identityMap.elements.every((element) => element.copy && typeof element.copy.origin === "string"));
assert.ok(identityMap.elements.every((element) => Array.isArray(element.anchors?.compositionChecks)
  && element.anchors.compositionChecks.length > 0), "every identity element must bind source/target composition bounds");
assert.ok(identityMap.elements.every((element) => element.anchors.requiredParts.every((part) =>
  Array.isArray(part.recognitionCues) && part.recognitionCues.length > 0
  && Array.isArray(part.forbiddenSubstitutions) && part.forbiddenSubstitutions.length > 0)),
"every required part must bind positive recognition cues and forbidden substitutions");
assert.equal(identityMap.elements.filter((element) => element.copy.origin !== "none").length, 5);
assert.equal(identityMap.elements.filter((element) => element.copy.origin === "supplemental-authorized").length, 0);
const identityReviewFields = [
  "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "expressionPassed",
  "colorHierarchyPassed", "motionPassed", "gameplayCuesPassed", "visualGrammarPassed",
];
if (identityAccepted) {
  assert.ok(fs.existsSync(decisionPath), "accepted identity map requires an immutable private review decision");
  const reviewers = new Set(identityMap.elements.map((element) => element.review.reviewer));
  assert.equal(reviewers.size, 1, "accepted identity elements must share one reviewer");
  assert.notEqual([...reviewers][0], "pending-human-side-by-side-review");
  assert.ok(identityMap.elements.every((element) => identityReviewFields.every((field) => element.review[field] === true)));
} else {
  assert.ok(identityMap.elements.every((element) => element.review.reviewer === "pending-human-side-by-side-review"));
  assert.ok(identityMap.elements.every((element) => identityReviewFields.every((field) => element.review[field] === false)));
}
assert.equal(hdAudit.schemaVersion, "aico8.hd-presentation-audit.v1");
assert.equal(hdAudit.status, identityMap.status);
assert.equal(hdAudit.gameId, replay.gameId);
assert.equal(hdAudit.canonicalReplayId, replay.replayId);
assert.equal(hdAudit.totalLogicalUpdates, 9224);
assert.equal(hdAudit.observationRuns.length, 3);
assert.equal(hdAudit.observationRuns[0].id, "canonical-complete");
assert.equal(hdAudit.observationRuns[0].endUpdateExclusive, canonicalAudit.logicalUpdates);
assert.deepEqual(hdAudit.observedSceneIds, ["scene.ending", "scene.gameplay", "scene.intro", "scene.title", "scene.win"]);
assert.equal(hdAudit.sourceTokens.length, 178);
assert.deepEqual(hdAudit.coverage.reachableElementIds, hdAudit.coverage.mappedElementIds);
assert.deepEqual(hdAudit.coverage.unmappedSourceTokenIds, []);
assert.equal(hdAudit.coverage.mixedIndexedFragments, 0);
assert.equal(hdAudit.coverage.diagnosticReferenceSwitches, 0);
assert.equal(hdAudit.invariance.updatesCompared, hdAudit.totalLogicalUpdates);
assert.deepEqual(hdAudit.invariance.mismatchUpdateIds, []);
assert.ok(hdAudit.regressions.some((regression) =>
  regression.id === "remove-observed-win-wall-variant" && regression.rejected === true));
const privateArtifactPaths = {
  canonical_run_audit: path.join(workspace, "validation", "canonical-run-audit.json"),
  solver_differential: path.join(workspace, "validation", "solver-differential.json"),
  solver_invariants: path.join(workspace, "validation", "solver-invariants.json"),
  input_trace_provenance: traceProvenancePath,
};
const privateArtifactSha256 = {
  canonical_replay_semantics_v1: validationReplaySemanticsSha256(replay),
};
for (const [id, artifactPath] of Object.entries(privateArtifactPaths)) {
  const digest = createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
  privateArtifactSha256[id] = digest;
}
const canonicalAttestation = {
  schema_version: 1,
  subject: "Dust Bunny research-only canonical qualification",
  rights_scope: "Research and test evidence only; no formal game release is authorized by this record.",
  source_execution: "Authorized private workspace; unchanged cart; ordinary PICO-8 button masks only.",
  runtime: "Shared C++ z8lua compatibility kernel compiled to WebAssembly",
  observations: {
    levels_completed: canonicalAudit.levelsCompleted,
    candidate_transitions: audit.totalTransitions,
    continuous_logical_updates: canonicalAudit.logicalUpdates,
    input_spans: replay.trace.spans.length,
    solver_cart_differential: "match",
    semantic_mutation_detected: audit.mutations.every((mutation) => mutation.detected === true),
    midpoint_resume_level: canonicalAudit.midpointProbe.resumedLevel,
    persistence_boundaries: canonicalAudit.persistenceBoundaries.length,
    ending_completed_through_endtimer: canonicalAudit.ending.completedThroughEndtimer,
    post_completion_stored_level: canonicalAudit.persistenceBoundaries.at(-1).storedLevel,
    restart_completed: canonicalAudit.ending.restartCompleted,
    observed_visual_scenes: Object.keys(canonicalAudit.rawVisualInventory.scenes).length,
    observed_source_tokens: Object.keys(canonicalAudit.rawVisualInventory.sourceTokens).length,
  },
  canonicality: {
    cart_mutation: replay.canonicality.cartMutation,
    compatibility_state_mutation: replay.canonicality.compatibilityStateMutation,
    input_source: replay.canonicality.inputSource,
    logical_update_policy: replay.canonicality.logicalUpdatePolicy,
    test_hooks: replay.canonicality.testHooks,
  },
  private_artifact_sha256: privateArtifactSha256,
  selector: "TEST-QUALIFICATION-PRIVATE",
};
const hdPrivateArtifactPaths = {
  hd_identity_map: path.join(workspace, "validation", "hd-identity-map.json"),
  hd_presentation_audit: path.join(workspace, "validation", "hd-presentation-audit.json"),
};
const hdAttestation = {
  schema_version: 1,
  subject: "Dust Bunny HD presentation qualification",
  status: identityAccepted ? "accepted-human-side-by-side-review" : "draft-pending-human-side-by-side-review",
  rights_scope: "Research and test evidence only; no formal game release is authorized by this record.",
  observations: {
    identity_elements: identityMap.elements.length,
    composition_checks: identityMap.elements.reduce(
      (total, element) => total + element.anchors.compositionChecks.length,
      0,
    ),
    required_part_recognition_contracts: identityMap.elements.reduce(
      (total, element) => total + element.anchors.requiredParts.length,
      0,
    ),
    copy_provenance_elements: identityMap.elements.filter((element) => element.copy.origin !== "none").length,
    supplemental_copy_elements: identityMap.elements.filter((element) => element.copy.origin === "supplemental-authorized").length,
    source_tokens: hdAudit.sourceTokens.length,
    scenes: hdAudit.observedSceneIds.length,
    canonical_logical_updates: canonicalAudit.logicalUpdates,
    total_logical_updates_with_named_probes: hdAudit.totalLogicalUpdates,
    named_reachable_state_probes: hdAudit.observationRuns.filter(({ kind }) => kind === "reachable-state-probe").length,
    unmapped_source_tokens: hdAudit.coverage.unmappedSourceTokenIds.length,
    mixed_indexed_fragments: hdAudit.coverage.mixedIndexedFragments,
    diagnostic_reference_switches: hdAudit.coverage.diagnosticReferenceSwitches,
    state_mismatches: hdAudit.invariance.mismatchUpdateIds.length,
    coverage_mutation_rejected: hdAudit.regressions.every(({ rejected }) => rejected === true),
  },
  review: {
    identity_map_accepted: identityAccepted,
    reviewer: identityAccepted ? "private-review-record" : "pending-human-side-by-side-review",
    review_decision_sha256: identityAccepted ? createHash("sha256").update(fs.readFileSync(decisionPath)).digest("hex") : null,
    acceptance_may_not_be_inferred_from_code_or_automated_audit: true,
  },
  private_artifact_sha256: Object.fromEntries(Object.entries(hdPrivateArtifactPaths).map(([id, artifactPath]) => [
    id,
    createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex"),
  ])),
  selector: "TEST-QUALIFICATION-PRIVATE",
};
function verifyOrWritePublicAttestation(relativePath, value) {
  const target = path.join(repository, relativePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.AICO8_WRITE_ATTESTATION === "1") fs.writeFileSync(target, serialized);
  else assert.equal(fs.readFileSync(target, "utf8"), serialized,
    `${relativePath} is stale; rerun once with AICO8_WRITE_ATTESTATION=1 and review the diff`);
}
verifyOrWritePublicAttestation("governance/evidence/dust-bunny-canonical-qualification.json", canonicalAttestation);
verifyOrWritePublicAttestation("governance/evidence/dust-bunny-hd-presentation.json", hdAttestation);
process.stdout.write(
  `private qualification: ${invariantAudit.cases.length} generic invariants, ${audit.candidates.length} levels, `
  + `${audit.totalTransitions} candidate transitions, ${canonicalAudit.logicalUpdates} continuous updates, `
  + `${hdAudit.totalLogicalUpdates} HD observations, ending/persistence/restart passed\n`,
);
