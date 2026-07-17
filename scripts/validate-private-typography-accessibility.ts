import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  TYPOGRAPHY_READABILITY_CHECKS,
  applyTypographyReadabilityDecision,
  validateTypographyAccessibilityAudit,
  validateTypographyReadabilityDecision,
  type TypographyAccessibilityAuditV1,
  type TypographyReadabilityDecisionV1,
} from "../packages/contracts/src/index.js";
import {
  sha256Bytes,
  verifyTypographyReadabilityReviewPacket,
} from "./lib/typography-readability-review.mjs";

const workspaceInput = process.env.AICO8_PRIVATE_WORKSPACE;
if (!workspaceInput) throw new Error("AICO8_PRIVATE_WORKSPACE is required");
const workspace = fs.realpathSync(path.resolve(workspaceInput));

function privateFile(relativePath: string): string {
  const file = fs.realpathSync(path.join(workspace, relativePath));
  assert.ok(file.startsWith(`${workspace}${path.sep}`), `${relativePath} escapes the private workspace`);
  assert.ok(fs.statSync(file).isFile(), `${relativePath} is not a file`);
  return file;
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const auditPath = privateFile("validation/typography-accessibility-audit.json");
const inventoryPath = privateFile("validation/text-inventory.json");
const sourcePath = privateFile("source.rom");
const manifestPath = path.resolve("apps/web/public/typography/latin-ui-v1.json");
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8")) as TypographyAccessibilityAuditV1;
const result = validateTypographyAccessibilityAudit(audit);
assert.equal(result.valid, true, result.errors.join("\n"));
assert.equal(audit.sourceSha256, sha256(sourcePath), "audit must bind the active private ROM");
assert.equal(audit.textInventorySha256, sha256(inventoryPath), "audit must bind the complete text inventory");
assert.equal(audit.typographyManifestSha256, sha256(manifestPath), "audit must bind the active typography manifest");
assert.equal(audit.languageCoverage.some(({ locale, script, missingCodePoints }) => (
  locale === "en-US" && script === "Latn" && missingCodePoints.length === 0
)), true, "English/Latin coverage must be complete");
assert.deepEqual(
  [...new Set(audit.unsupportedScripts.map(({ script }) => script))].sort(),
  ["Hang", "Hans", "Hant", "Jpan"],
  "unsupported CJK/Hangul scripts must remain explicit rather than silently falling back",
);
assert.equal(audit.deliveryProfiles.length, 3);
assert.equal(audit.deliveryProfiles.every(({ samples }) => samples.every((sample) => (
  sample.fontSizeCssPx >= sample.minimumCssPx
  && sample.contrastRatio >= sample.requiredContrastRatio
  && sample.fits
  && !sample.overflowed
))), true, "all delivery-profile typography samples must meet size, contrast, and fit");
assert.deepEqual(audit.assistiveText.missingSceneIds, []);
assert.deepEqual(audit.assistiveText.unprovenDescriptionIds, []);
assert.equal(audit.assistiveText.compatibilityStateMutations, 0);

if (audit.manualReadability.status !== "pending") {
  const decisionPath = privateFile("evidence/typography-readability-decision.json");
  const decisionBytes = fs.readFileSync(decisionPath);
  assert.equal(sha256Bytes(decisionBytes), audit.manualReadability.decisionSha256,
    "audit must bind the exact readability decision bytes");
  const decisionUnknown: unknown = JSON.parse(decisionBytes.toString("utf8"));
  const standaloneDecision = validateTypographyReadabilityDecision(decisionUnknown);
  assert.equal(standaloneDecision.valid, true, standaloneDecision.errors.join("\n"));
  const decision = decisionUnknown as TypographyReadabilityDecisionV1;
  const archiveDirectory = `evidence/readability-reviews/${decision.subject.reviewPacketSha256}`;
  const pendingAuditPath = privateFile(`${archiveDirectory}/pending-typography-accessibility-audit.json`);
  const reviewPacketPath = privateFile(`${archiveDirectory}/typography-accessibility-review.json`);
  const pendingAuditBytes = fs.readFileSync(pendingAuditPath);
  const reviewPacketBytes = fs.readFileSync(reviewPacketPath);
  assert.equal(sha256Bytes(pendingAuditBytes), decision.subject.pendingAuditSha256,
    "decision must bind archived pending audit bytes");
  assert.equal(sha256Bytes(reviewPacketBytes), decision.subject.reviewPacketSha256,
    "decision must bind archived review packet bytes");
  const pendingAuditUnknown: unknown = JSON.parse(pendingAuditBytes.toString("utf8"));
  const pendingValidation = validateTypographyAccessibilityAudit(pendingAuditUnknown);
  assert.equal(pendingValidation.valid, true, pendingValidation.errors.join("\n"));
  const pendingAudit = pendingAuditUnknown as TypographyAccessibilityAuditV1;
  const decisionValidation = validateTypographyReadabilityDecision(decision, pendingAudit);
  assert.equal(decisionValidation.valid, true, decisionValidation.errors.join("\n"));
  const review = verifyTypographyReadabilityReviewPacket({
    workspace,
    packetBytes: reviewPacketBytes,
    pendingAuditBytes,
    pendingAudit,
    expectedCheckCount: TYPOGRAPHY_READABILITY_CHECKS.length,
  });
  assert.equal(review.packetSha256, decision.subject.reviewPacketSha256);
  const expected = applyTypographyReadabilityDecision({
    pendingAudit,
    pendingAuditSha256: decision.subject.pendingAuditSha256,
    reviewPacketSha256: decision.subject.reviewPacketSha256,
    decision,
    decisionSha256: sha256Bytes(decisionBytes),
  });
  assert.deepEqual(audit, expected, "final audit must be derived exactly from the retained human decision");
}

process.stdout.write(
  `Private typography accessibility: ${audit.status === "accepted"
    ? "PASS"
    : audit.manualReadability.status === "rejected" ? "HUMAN REVIEW REJECTED" : "AUTOMATED PASS; HUMAN REVIEW PENDING"} `
  + `(${audit.assistiveText.descriptionsObserved} descriptions; ${audit.deliveryProfiles.length} profiles; `
  + `${audit.languageCoverage.map(({ locale }) => locale).join(", ")} supported)\n`,
);
