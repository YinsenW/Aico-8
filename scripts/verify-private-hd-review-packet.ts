import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { validateHdReviewPacket } from "../packages/contracts/src/hd-review-packet.ts";

const arguments_ = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  arguments_.set(key.slice(2), value);
}
const workspaceValue = arguments_.get("workspace");
assert.ok(workspaceValue, "--workspace is required");
const workspace = path.resolve(workspaceValue);
const identityMapPath = path.join(workspace, "validation/hd-identity-map.json");
const browserEvidencePath = path.join(workspace, "evidence/browser-validation.json");
const packetPath = path.join(workspace, "evidence/identity-review-packet.json");

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function readJson(file: string): any {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const identityMap = readJson(identityMapPath);
const browser = readJson(browserEvidencePath);
const packet = readJson(packetPath);
const validation = validateHdReviewPacket(packet);
assert.equal(validation.valid, true, validation.errors.join("\n"));
assert.equal(packet.gameId, identityMap.gameId);
assert.equal(packet.visualRuntimeSha256, browser.build.visualRuntimeSha256);
assert.equal(packet.replaySemanticsSha256, browser.validationReplay.semanticsSha256);
assert.equal(packet.identityMapSha256, sha256(identityMapPath));
assert.equal(packet.browserEvidenceSha256, sha256(browserEvidencePath));
assert.equal(packet.status, identityMap.status === "accepted" ? "accepted" : "pending-human-side-by-side-review");
assert.deepEqual(packet.sceneComparisons, browser.sceneComparisons);
assert.deepEqual(packet.temporalComparisons, browser.temporalComparisons);

const mapElements = new Map(identityMap.elements.map((element: any) => [element.id, element]));
assert.deepEqual(packet.elements.map(({ id }: any) => id), identityMap.elements.map(({ id }: any) => id));
for (const element of packet.elements) {
  const source = mapElements.get(element.id) as any;
  assert.ok(source, `${element.id}: unknown identity element`);
  assert.deepEqual(element.sourceScreenshotIds, source.review.sourceSceneIds);
  assert.deepEqual(element.targetScreenshotIds, source.review.targetSceneIds);
  assert.equal(element.review.reviewer, source.review.reviewer);
  for (const name of [
    "silhouettePassed", "requiredPartsPassed", "proportionsPassed", "expressionPassed",
    "colorHierarchyPassed", "motionPassed", "gameplayCuesPassed", "visualGrammarPassed",
  ]) assert.equal(element.review[name], source.review[name], `${element.id}: ${name}`);
}

const browserScreenshots = new Map(browser.screenshots.map((screenshot: any) => [screenshot.id, screenshot]));
for (const screenshot of packet.screenshots) {
  assert.deepEqual(screenshot, browserScreenshots.get(screenshot.id), `${screenshot.id}: browser screenshot metadata`);
  const file = path.resolve(workspace, screenshot.path);
  assert.ok(file.startsWith(`${workspace}${path.sep}`), `${screenshot.id}: unsafe screenshot path`);
  assert.equal(sha256(file), screenshot.sha256, `${screenshot.id}: screenshot bytes`);
}
const documentPath = path.resolve(workspace, packet.document.path);
assert.ok(documentPath.startsWith(`${workspace}${path.sep}`), "Unsafe review document path");
assert.equal(sha256(documentPath), packet.document.sha256, "Review document hash");

process.stdout.write(
  `HD review packet verified: ${packet.elements.length} elements, ${packet.sceneComparisons.length} static pairs, `
  + `${packet.temporalComparisons.length} temporal sequences, ${packet.screenshots.length} hash-bound screenshots; ${packet.status}\n`,
);
