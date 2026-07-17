import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const TYPOGRAPHY_READABILITY_REVIEW_PACKET_SCHEMA_VERSION
  = "aico8.typography-accessibility-review.v1";

export const REQUIRED_TYPOGRAPHY_REVIEW_SCREENSHOT_IDS = Object.freeze([
  "phone-title",
  "phone-gameplay",
  "square-gameplay",
  "landscape-gameplay",
]);

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function resolveWorkspaceFile(workspace, relativePath) {
  assert.equal(typeof relativePath, "string", "Evidence path must be a string");
  const workspaceReal = fs.realpathSync(workspace);
  const resolved = path.resolve(workspaceReal, relativePath);
  assert.ok(resolved.startsWith(`${workspaceReal}${path.sep}`), `${relativePath}: path escapes the private workspace`);
  const metadata = fs.lstatSync(resolved);
  assert.ok(!metadata.isSymbolicLink(), `${relativePath}: symbolic-link evidence is not allowed`);
  assert.ok(metadata.isFile(), `${relativePath}: evidence file is missing`);
  const real = fs.realpathSync(resolved);
  assert.ok(real.startsWith(`${workspaceReal}${path.sep}`), `${relativePath}: real path escapes the private workspace`);
  return real;
}

export function verifyTypographyReadabilityReviewPacket(options) {
  const { workspace, packetBytes, pendingAuditBytes, pendingAudit, expectedCheckCount } = options;
  const packet = JSON.parse(Buffer.from(packetBytes).toString("utf8"));
  assert.equal(packet.schemaVersion, TYPOGRAPHY_READABILITY_REVIEW_PACKET_SCHEMA_VERSION);
  assert.equal(packet.status, "pending-human-readability-decision");
  assert.equal(packet.gameId, pendingAudit.gameId, "Review packet game must match the pending audit");
  assert.equal(packet.sourceSha256, pendingAudit.sourceSha256, "Review packet source must match the pending audit");
  assert.equal(packet.audit?.path, "validation/typography-accessibility-audit.json");
  assert.equal(packet.audit?.sha256, sha256Bytes(pendingAuditBytes), "Review packet must bind exact pending audit bytes");
  assert.equal(packet.build?.target, "web-pwa");
  for (const key of ["releaseManifestSha256", "visualRuntimeSha256", "validationReplaySemanticsSha256"]) {
    assert.match(packet.build?.[key] ?? "", /^[a-f0-9]{64}$/u, `Review packet build.${key}`);
  }
  assert.equal(packet.build?.outputProfile, "hd-1024-square");
  assert.equal(packet.humanCriteria?.length, expectedCheckCount, "Review packet must expose every readability criterion");

  assert.deepEqual(
    packet.screenshots?.map(({ id }) => id),
    REQUIRED_TYPOGRAPHY_REVIEW_SCREENSHOT_IDS,
    "Review packet must contain every screenshot in contract order",
  );
  for (const screenshot of packet.screenshots) {
    assert.match(screenshot.sha256 ?? "", /^[a-f0-9]{64}$/u, `${screenshot.id}: screenshot hash`);
    assert.ok(Number.isSafeInteger(screenshot.viewport?.width) && screenshot.viewport.width > 0,
      `${screenshot.id}: viewport width`);
    assert.ok(Number.isSafeInteger(screenshot.viewport?.height) && screenshot.viewport.height > 0,
      `${screenshot.id}: viewport height`);
    assert.match(screenshot.sceneId ?? "", /^scene\.[a-z0-9-]+$/u, `${screenshot.id}: scene ID`);
    const screenshotPath = resolveWorkspaceFile(workspace, screenshot.path);
    assert.equal(sha256Bytes(fs.readFileSync(screenshotPath)), screenshot.sha256,
      `${screenshot.id}: screenshot bytes changed after review packet generation`);
  }
  return { packet, packetSha256: sha256Bytes(packetBytes) };
}
