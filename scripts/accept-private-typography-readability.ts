import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  TYPOGRAPHY_READABILITY_CHECKS,
  TYPOGRAPHY_READABILITY_DECISION_SCHEMA_VERSION,
  applyTypographyReadabilityDecision,
  validateTypographyAccessibilityAudit,
  validateTypographyReadabilityDecision,
  type TypographyAccessibilityAuditV1,
  type TypographyReadabilityCheck,
  type TypographyReadabilityDecisionV1,
  type TypographyReadabilityVerdict,
} from "../packages/contracts/src/typography-accessibility.ts";
import {
  sha256Bytes,
  verifyTypographyReadabilityReviewPacket,
} from "./lib/typography-readability-review.mjs";

const arguments_ = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  arguments_.set(key.slice(2), value);
}

const workspaceValue = arguments_.get("workspace");
const reviewer = arguments_.get("reviewer");
const notes = arguments_.get("notes");
assert.ok(workspaceValue, "--workspace is required");
assert.ok(reviewer, "--reviewer is required");
assert.ok(notes, "--notes is required");
assert.equal(arguments_.get("write"), "true", "--write true is required for an explicit human-review mutation");

const checkArguments: Readonly<Record<TypographyReadabilityCheck, string>> = {
  phoneTitleReadable: "phone-title",
  hudLabelsCrispAcrossProfiles: "hud-labels",
  glyphsCompleteWithoutFallback: "glyphs",
  visualHierarchyPreserved: "hierarchy",
};
const checks = Object.fromEntries(TYPOGRAPHY_READABILITY_CHECKS.map((check) => {
  const value = arguments_.get(checkArguments[check]);
  assert.ok(value === "passed" || value === "failed", `--${checkArguments[check]} must be passed or failed`);
  return [check, value];
})) as Record<TypographyReadabilityCheck, TypographyReadabilityVerdict>;

const workspace = fs.realpathSync(path.resolve(workspaceValue));
const auditPath = path.join(workspace, "validation/typography-accessibility-audit.json");
const packetPath = path.join(workspace, "evidence/typography-accessibility-review.json");
const decisionPath = path.join(workspace, "evidence/typography-readability-decision.json");
const pendingAuditBytes = fs.readFileSync(auditPath);
const pendingAuditUnknown: unknown = JSON.parse(pendingAuditBytes.toString("utf8"));
const auditValidation = validateTypographyAccessibilityAudit(pendingAuditUnknown);
assert.equal(auditValidation.valid, true, auditValidation.errors.join("\n"));
const pendingAudit = pendingAuditUnknown as TypographyAccessibilityAuditV1;
assert.equal(pendingAudit.status, "draft", "Only a draft typography audit can receive a readability decision");
assert.deepEqual(pendingAudit.manualReadability, { status: "pending" });

const packetBytes = fs.readFileSync(packetPath);
const { packetSha256 } = verifyTypographyReadabilityReviewPacket({
  workspace,
  packetBytes,
  pendingAuditBytes,
  pendingAudit,
  expectedCheckCount: TYPOGRAPHY_READABILITY_CHECKS.length,
});
const pendingAuditSha256 = sha256Bytes(pendingAuditBytes);
const decision: TypographyReadabilityDecisionV1 = {
  schemaVersion: TYPOGRAPHY_READABILITY_DECISION_SCHEMA_VERSION,
  gameId: pendingAudit.gameId,
  decision: TYPOGRAPHY_READABILITY_CHECKS.every((check) => checks[check] === "passed") ? "approved" : "rejected",
  reviewer,
  reviewedAt: new Date().toISOString(),
  subject: {
    pendingAuditSha256,
    reviewPacketSha256: packetSha256,
    sourceSha256: pendingAudit.sourceSha256,
    typographyManifestSha256: pendingAudit.typographyManifestSha256,
    textInventorySha256: pendingAudit.textInventorySha256,
  },
  checks,
  notes,
};
const decisionValidation = validateTypographyReadabilityDecision(decision, pendingAudit);
assert.equal(decisionValidation.valid, true, decisionValidation.errors.join("\n"));
const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
const decisionSha256 = sha256Bytes(decisionBytes);
const finalAudit = applyTypographyReadabilityDecision({
  pendingAudit,
  pendingAuditSha256,
  reviewPacketSha256: packetSha256,
  decision,
  decisionSha256,
});
const finalAuditBytes = Buffer.from(`${JSON.stringify(finalAudit, null, 2)}\n`);

const archiveDirectory = path.join(workspace, `evidence/readability-reviews/${packetSha256}`);
const archivedAuditPath = path.join(archiveDirectory, "pending-typography-accessibility-audit.json");
const archivedPacketPath = path.join(archiveDirectory, "typography-accessibility-review.json");
function writeImmutable(file: string, bytes: Buffer, label: string): void {
  if (fs.existsSync(file)) {
    assert.deepEqual(fs.readFileSync(file), bytes, `A different immutable ${label} already exists`);
    return;
  }
  fs.writeFileSync(file, bytes);
}
fs.mkdirSync(archiveDirectory, { recursive: true });
writeImmutable(archivedAuditPath, pendingAuditBytes, "pending typography audit");
writeImmutable(archivedPacketPath, packetBytes, "typography review packet");
writeImmutable(decisionPath, decisionBytes, "typography readability decision");
fs.writeFileSync(auditPath, finalAuditBytes);
process.stdout.write(
  `Typography readability ${decision.decision} for ${decision.gameId}: ${reviewer}; packet ${packetSha256}\n`,
);
