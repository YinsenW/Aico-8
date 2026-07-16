import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertReplay, type ReplayV1 } from "../packages/contracts/src/replay.ts";
import {
  assertInputTraceProvenance,
  inputTraceSha256,
} from "./lib/input-trace-provenance.mjs";
import {
  assertCanonicalExecutionFacts,
  assertQualificationBoundaryMilestones,
} from "./lib/qualification-boundary.mjs";

type DifferentialReport = {
  schemaVersion: string;
  gameId: string;
  publicAttestationId: string;
  cart: { combinedSha256: string };
  canonicalInput: {
    logicalUpdates: number;
    playerZeroMaskSha256: string;
    authority: string;
  };
  execution: { audioDiagnosticFlags: number };
  differential: {
    boundary: { kind: string; required: number; completed: number; milestoneIds?: string[] };
    strokes: number;
    checkpoints: { update: number; snapshotSha256: string }[];
    mutationRejections: Record<string, { course: number; stroke: number }>;
  };
  final: {
    endingReached: boolean;
    progressionComplete: boolean;
    stateSha256: string;
    persistenceSha256: string;
  };
  replay: { replayId: string; sha256: string };
  limitations: string[];
  status: string;
};

type InputProjectionReport = {
  schemaVersion: string;
  replayId: string;
  replaySemanticsSha256: string;
  cartSha256: string;
  canonicalTraceSha256: string;
  totalUpdates: number;
  updateHz: number;
  surfaces: Record<string, {
    updates: number;
    updateHz: number;
    maskSha256: string;
    mismatches: number;
  }>;
};

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceValue = process.env.AICO8_PRIVATE_WORKSPACE;
assert.ok(workspaceValue, "AICO8_PRIVATE_WORKSPACE must name an authorized ignored workspace");
const workspace = path.resolve(workspaceValue);
const runner = path.join(workspace, "validation", "verify-canonical-gameplay.ts");
const reportPath = path.join(workspace, "validation", "qualification-differential-v1.json");
const replayPath = path.join(workspace, "validation", "canonical-replay-v1.json");
const traceProvenancePath = path.join(workspace, "validation", "input-trace-provenance-v1.json");
const inputProjectionPath = path.join(workspace, "validation", "input-surface-projection-v1.json");
assert.ok(fs.existsSync(runner), `missing private canonical-gameplay runner: ${runner}`);
assert.ok(fs.existsSync(path.join(workspace, "source.rom")), "private workspace is missing source.rom");
assert.ok(fs.existsSync(path.join(workspace, "code.p8.lua")), "private workspace is missing code.p8.lua");
assert.ok(fs.existsSync(traceProvenancePath), "private workspace is missing input-trace-provenance-v1.json");

const result = spawnSync(process.execPath, [
  "--experimental-strip-types",
  runner,
  "--repository",
  repository,
  "--out",
  reportPath,
  "--replay-out",
  replayPath,
], {
  cwd: workspace,
  encoding: "utf8",
  stdio: "pipe",
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
assert.equal(result.status, 0, `private canonical-gameplay runner failed with status ${result.status}`);

const inputProjectionResult = spawnSync(process.execPath, [
  "--experimental-strip-types",
  path.join(repository, "scripts", "verify-input-projection.ts"),
  "--replay",
  replayPath,
  "--out",
  inputProjectionPath,
], {
  cwd: repository,
  encoding: "utf8",
  stdio: "pipe",
});
process.stdout.write(inputProjectionResult.stdout ?? "");
process.stderr.write(inputProjectionResult.stderr ?? "");
assert.equal(inputProjectionResult.status, 0,
  `private host-input projection failed with status ${inputProjectionResult.status}`);

const replayText = fs.readFileSync(replayPath, "utf8");
const replay = JSON.parse(replayText) as ReplayV1;
assertReplay(replay);
const traceProvenance = JSON.parse(fs.readFileSync(traceProvenancePath, "utf8"));
assertInputTraceProvenance(traceProvenance);
assert.equal(traceProvenance.traceSha256, inputTraceSha256(replay.trace),
  "input-trace provenance does not bind the exact canonical trace");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as DifferentialReport;
const inputProjection = JSON.parse(fs.readFileSync(inputProjectionPath, "utf8")) as InputProjectionReport;
assert.equal(report.schemaVersion, "aico8.qualification-differential.v1");
assert.equal(report.status, "passed");
assert.match(report.publicAttestationId, /^[a-z0-9][a-z0-9-]{1,79}$/);
assert.equal(report.gameId, replay.gameId);
assert.equal(report.cart.combinedSha256, replay.cartSha256);
assert.equal(report.replay.replayId, replay.replayId);
assert.equal(report.replay.sha256, sha256(replayText));
assert.equal(report.canonicalInput.logicalUpdates, replay.trace.totalUpdates);
assert.equal(report.canonicalInput.authority,
  "fixed-ordinary-button-masks-replayed-from-clean-state-without-control-hooks");
assertCanonicalExecutionFacts(report.execution);
assert.ok(replay.trace.totalUpdates <= 10_000_000, "private canonical trace exceeds the validation memory budget");
const masks: number[] = [];
for (const span of replay.trace.spans) {
  for (let update = span.startUpdate; update < span.endUpdateExclusive; update += 1) masks.push(span.players[0]);
}
assert.equal(masks.length, replay.trace.totalUpdates);
assert.equal(report.canonicalInput.playerZeroMaskSha256, sha256(Uint8Array.from(masks)));
assert.equal(inputProjection.schemaVersion, "aico8.input-surface-projection.v1");
assert.equal(inputProjection.replayId, replay.replayId);
assert.equal(inputProjection.cartSha256, replay.cartSha256);
assert.equal(inputProjection.totalUpdates, replay.trace.totalUpdates);
assert.equal(inputProjection.updateHz, replay.trace.updateHz);
assert.deepEqual(Object.keys(inputProjection.surfaces).sort(), ["controller", "keyboard", "touch"]);
for (const [surface, projection] of Object.entries(inputProjection.surfaces)) {
  assert.equal(projection.updates, replay.trace.totalUpdates, `${surface} omitted logical updates`);
  assert.equal(projection.updateHz, replay.trace.updateHz, `${surface} changed the update rate`);
  assert.equal(projection.maskSha256, inputProjection.canonicalTraceSha256,
    `${surface} changed the canonical input masks`);
  assert.equal(projection.mismatches, 0, `${surface} changed canonical input`);
}

const boundary = report.differential.boundary;
assertQualificationBoundaryMilestones(boundary, replay);
assert.ok(Number.isInteger(report.differential.strokes) && report.differential.strokes > 0);
assert.equal(report.differential.checkpoints.length, replay.checkpoints.length);
for (const [index, checkpoint] of report.differential.checkpoints.entries()) {
  assert.equal(checkpoint.update, replay.checkpoints[index]?.atUpdate);
  assert.equal(checkpoint.snapshotSha256, replay.checkpoints[index]?.hashes.stateSha256);
}
const mutationRejections = Object.entries(report.differential.mutationRejections);
assert.ok(mutationRejections.length >= 1, "at least one deliberate semantic mutation must be rejected");
for (const [id, rejection] of mutationRejections) {
  assert.match(id, /^[a-z][a-z0-9-]{1,79}$/);
  assert.ok(Number.isInteger(rejection.course) && rejection.course >= 1 && rejection.course <= boundary.required);
  assert.ok(Number.isInteger(rejection.stroke) && rejection.stroke >= 1);
}
assert.equal(report.final.endingReached, true);
assert.equal(report.final.progressionComplete, true);
assert.equal(report.final.stateSha256, replay.result.finalStateSha256);
assert.equal(replay.result.completed, true);
assert.ok(replay.requiredMilestoneIds.includes("ending-reached"));
assert.ok(replay.requiredMilestoneIds.includes("game-complete"));
assert.ok(Array.isArray(report.limitations) && report.limitations.length >= 1);
assert.ok(report.limitations.every((limitation) => !/host-input projection/i.test(limitation)),
  "host-input projection is now proved by this selector and cannot remain listed as a limitation");

const attestation = {
  schema_version: 1,
  subject: `${report.gameId} unchanged-cart canonical gameplay`,
  status: "canonical-gameplay-passed-game-qualification-still-open",
  rights_scope: "Research and test evidence only; no formal game release is authorized by this record.",
  runtime: replay.runtime,
  observations: {
    boundary_kind: boundary.kind,
    required_boundaries: boundary.required,
    completed_boundaries: boundary.completed,
    ordinary_input_logical_updates: replay.trace.totalUpdates,
    input_spans: replay.trace.spans.length,
    strokes: report.differential.strokes,
    state_checkpoints: replay.checkpoints.length,
    mutation_regressions_rejected: mutationRejections.length,
    ending_reached: report.final.endingReached,
    progression_complete: report.final.progressionComplete,
    host_input_surfaces: Object.keys(inputProjection.surfaces).length,
    host_input_mask_mismatches: Object.values(inputProjection.surfaces)
      .reduce((total, surface) => total + surface.mismatches, 0),
    audio_diagnostic_flags: report.execution.audioDiagnosticFlags,
  },
  canonicality: replay.canonicality,
  private_artifact_sha256: {
    replay_v1: sha256(replayText),
    differential: sha256(fs.readFileSync(reportPath)),
    input_projection: sha256(fs.readFileSync(inputProjectionPath)),
    input_trace_provenance: sha256(fs.readFileSync(traceProvenancePath)),
  },
  limitations: report.limitations,
  selector: "TEST-QUALIFICATION-GAMEPLAY-PRIVATE",
};
const attestationPath = path.join(repository, "governance", "evidence", `${report.publicAttestationId}.json`);
const attestationText = `${JSON.stringify(attestation, null, 2)}\n`;
if (process.env.AICO8_WRITE_ATTESTATION === "1") fs.writeFileSync(attestationPath, attestationText);
else assert.equal(fs.readFileSync(attestationPath, "utf8"), attestationText,
  `${path.relative(repository, attestationPath)} is stale; refresh once with AICO8_WRITE_ATTESTATION=1 and review the diff`);

process.stdout.write(
  `private canonical gameplay: ${boundary.completed}/${boundary.required} ${boundary.kind} boundaries, `
  + `${replay.trace.totalUpdates} updates, ${replay.checkpoints.length} checkpoints, ${mutationRejections.length} mutations rejected\n`,
);
