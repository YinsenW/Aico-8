import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertTextCompletenessAudit,
  validateTextInventory,
  type TextCompletenessAuditV1,
  type TextInventoryV1,
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

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const inventoryPath = privateFile("validation/text-inventory.json");
const auditPath = privateFile("validation/text-completeness-audit.json");
const sourcePath = privateFile("source.rom");
const inventoryBytes = fs.readFileSync(inventoryPath);
const inventory = JSON.parse(inventoryBytes.toString("utf8")) as TextInventoryV1;
const audit = JSON.parse(fs.readFileSync(auditPath, "utf8")) as TextCompletenessAuditV1;

const inventoryValidation = validateTextInventory(inventory);
assert.equal(inventoryValidation.valid, true, inventoryValidation.errors.join("\n"));
assert.equal(inventory.status, "complete-for-hd");
assert.equal(inventory.sourceSha256, sha256(fs.readFileSync(sourcePath)), "inventory must bind the active private ROM");
assert.equal(audit.inventorySha256, sha256(inventoryBytes), "audit must bind the exact inventory bytes");
assertTextCompletenessAudit(audit, inventory);
assert.equal(audit.status, "accepted");
assert.ok(audit.totalLogicalUpdates > 0);
assert.ok(audit.totals.sourceTextRuns > 0);
assert.equal(audit.totals.sourceTextRuns, audit.totals.approvedTextRuns);
assert.equal(audit.totals.blockedTextRuns, 0);
assert.equal(audit.totals.mismatchedTextRuns, 0);
assert.equal(audit.totals.unapprovedTextRuns, 0);
assert.deepEqual(audit.failingUpdateIds, []);

process.stdout.write(
  `Private text completeness: PASS (${audit.gameId}; ${audit.totalLogicalUpdates} updates; `
  + `${audit.totals.approvedTextRuns}/${audit.totals.sourceTextRuns} runs approved; zero blockers/mismatches/out-of-inventory)\n`,
);
