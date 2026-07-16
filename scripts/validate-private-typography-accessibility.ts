import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  validateTypographyAccessibilityAudit,
  type TypographyAccessibilityAuditV1,
} from "../packages/contracts/src/index.js";

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

process.stdout.write(
  `Private typography accessibility: ${audit.status === "accepted" ? "PASS" : "AUTOMATED PASS; HUMAN REVIEW PENDING"} `
  + `(${audit.assistiveText.descriptionsObserved} descriptions; ${audit.deliveryProfiles.length} profiles; `
  + `${audit.languageCoverage.map(({ locale }) => locale).join(", ")} supported)\n`,
);
