import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  HD_REVIEW_CHECK_NAMES,
  HD_REVIEW_PRINCIPLE_GATES,
  PENDING_HD_REVIEWER,
  validateHdReviewPacket,
} from "../packages/contracts/src/hd-review-packet.ts";
import {
  HD_REVIEW_DECISION_SCHEMA_VERSION,
  validateHdReviewDecision,
} from "../packages/contracts/src/hd-review-decision.ts";

const arguments_ = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  arguments_.set(key.slice(2), value);
}
const workspaceValue = arguments_.get("workspace");
const reviewer = arguments_.get("reviewer");
const acceptanceStatement = arguments_.get("statement");
assert.ok(workspaceValue, "--workspace is required");
assert.ok(reviewer, "--reviewer is required");
assert.ok(acceptanceStatement, "--statement is required");
assert.equal(arguments_.get("write"), "true", "--write true is required for an explicit acceptance mutation");
assert.notEqual(reviewer, PENDING_HD_REVIEWER, "--reviewer must identify the human reviewer");

const workspace = path.resolve(workspaceValue);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packetPath = path.join(workspace, "evidence/identity-review-packet.json");
const decisionPath = path.join(workspace, "evidence/identity-review-decision.json");
const identityMapPath = path.join(workspace, "validation/hd-identity-map.json");
const browserEvidencePath = path.join(workspace, "evidence/browser-validation.json");

execFileSync(process.execPath, [
  path.join(repository, "scripts/build-private-hd-review-packet.mjs"),
  "--workspace", workspace,
  "--write", "false",
], { cwd: repository, stdio: "pipe" });

function sha256Bytes(bytes: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256(file: string): string {
  return sha256Bytes(fs.readFileSync(file));
}

function workspacePath(relativePath: string): string {
  const resolved = path.resolve(workspace, relativePath);
  assert.ok(resolved.startsWith(`${workspace}${path.sep}`), `${relativePath}: path escapes the private workspace`);
  return resolved;
}

const packetBytes = fs.readFileSync(packetPath);
const packet = JSON.parse(packetBytes.toString("utf8"));
const packetValidation = validateHdReviewPacket(packet);
assert.equal(packetValidation.valid, true, packetValidation.errors.join("\n"));
assert.equal(packet.status, "pending-human-side-by-side-review", "Only a pending packet can receive a new decision");
assert.equal(packet.reviewer, PENDING_HD_REVIEWER);
assert.equal(packet.reviewDecision, null);
assert.equal(acceptanceStatement, packet.acceptanceStatement,
  "The supplied acceptance statement must exactly match the reviewed packet");
assert.equal(sha256(identityMapPath), packet.identityMapSha256, "Identity map changed after review packet generation");
assert.equal(sha256(browserEvidencePath), packet.browserEvidenceSha256,
  "Browser evidence changed after review packet generation");
const documentPath = workspacePath(packet.document.path);
const documentBytes = fs.readFileSync(documentPath);
assert.equal(sha256Bytes(documentBytes), packet.document.sha256, "Review document changed after packet generation");
for (const screenshot of packet.screenshots) {
  assert.equal(sha256(workspacePath(screenshot.path)), screenshot.sha256,
    `${screenshot.id}: screenshot changed after packet generation`);
}

const packetSha256 = sha256Bytes(packetBytes);
const archiveDirectory = `evidence/reviews/${packetSha256}`;
const archivedPacketRelativePath = `${archiveDirectory}/identity-review-packet.json`;
const archivedDocumentRelativePath = `${archiveDirectory}/identity-review-packet.html`;
const archivedIdentityMapRelativePath = `${archiveDirectory}/hd-identity-map.json`;
const decision = {
  schemaVersion: HD_REVIEW_DECISION_SCHEMA_VERSION,
  gameId: packet.gameId,
  decision: "accepted",
  reviewer,
  acceptanceStatement,
  reviewedPacket: {
    path: archivedPacketRelativePath,
    sha256: packetSha256,
    documentPath: archivedDocumentRelativePath,
    documentSha256: packet.document.sha256,
    visualRuntimeSha256: packet.visualRuntimeSha256,
    replaySemanticsSha256: packet.replaySemanticsSha256,
    identityMapSha256: packet.identityMapSha256,
    browserEvidenceSha256: packet.browserEvidenceSha256,
  },
  elementIds: packet.elements.map(({ id }: { id: string }) => id),
  checkNames: [...HD_REVIEW_CHECK_NAMES],
  principleGates: HD_REVIEW_PRINCIPLE_GATES.map(({ id }) => ({ id, verdict: "passed" })),
};
const decisionValidation = validateHdReviewDecision(decision, packet);
assert.equal(decisionValidation.valid, true, decisionValidation.errors.join("\n"));
const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);

function writeImmutable(file: string, bytes: Buffer, label: string): void {
  if (fs.existsSync(file)) {
    assert.deepEqual(fs.readFileSync(file), bytes, `A different immutable ${label} already exists`);
    return;
  }
  fs.writeFileSync(file, bytes);
}
fs.mkdirSync(workspacePath(archiveDirectory), { recursive: true });
writeImmutable(workspacePath(archivedPacketRelativePath), packetBytes, "review packet archive");
writeImmutable(workspacePath(archivedDocumentRelativePath), documentBytes, "review document archive");
writeImmutable(workspacePath(archivedIdentityMapRelativePath), fs.readFileSync(identityMapPath),
  "reviewed identity map archive");
writeImmutable(decisionPath, decisionBytes, "identity-review decision");
assert.equal(sha256(workspacePath(archivedPacketRelativePath)), decision.reviewedPacket.sha256);
assert.equal(sha256(workspacePath(archivedDocumentRelativePath)), decision.reviewedPacket.documentSha256);
assert.equal(sha256(workspacePath(archivedIdentityMapRelativePath)), decision.reviewedPacket.identityMapSha256);
assert.equal(sha256(decisionPath), sha256Bytes(decisionBytes));
process.stdout.write(
  `HD review decision recorded for ${packet.gameId}: ${reviewer}; packet ${packetSha256}\n`,
);
