import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_TYPOGRAPHY_REVIEW_SCREENSHOT_IDS,
  sha256Bytes,
  verifyTypographyReadabilityReviewPacket,
} from "./typography-readability-review.mjs";

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-type-review-"));
  fs.mkdirSync(path.join(workspace, "evidence/accessibility-review"), { recursive: true });
  const pendingAudit = { gameId: "dust-bunny", sourceSha256: "a".repeat(64) };
  const pendingAuditBytes = Buffer.from(`${JSON.stringify(pendingAudit)}\n`);
  const screenshots = REQUIRED_TYPOGRAPHY_REVIEW_SCREENSHOT_IDS.map((id, index) => {
    const relativePath = `evidence/accessibility-review/${id}.png`;
    const bytes = Buffer.from(`screenshot-${id}`);
    fs.writeFileSync(path.join(workspace, relativePath), bytes);
    return {
      id,
      path: relativePath,
      sha256: sha256Bytes(bytes),
      viewport: { width: index === 0 ? 390 : 1024, height: index === 0 ? 844 : 1024 },
      sceneId: index === 0 ? "scene.title" : "scene.gameplay",
    };
  });
  const packet = {
    schemaVersion: "aico8.typography-accessibility-review.v1",
    status: "pending-human-readability-decision",
    gameId: pendingAudit.gameId,
    sourceSha256: pendingAudit.sourceSha256,
    build: {
      target: "web-pwa",
      outputProfile: "hd-1024-square",
      releaseManifestSha256: "b".repeat(64),
      visualRuntimeSha256: "c".repeat(64),
      validationReplaySemanticsSha256: "d".repeat(64),
    },
    audit: { path: "validation/typography-accessibility-audit.json", sha256: sha256Bytes(pendingAuditBytes) },
    screenshots,
    humanCriteria: ["one", "two", "three", "four"],
  };
  return { workspace, pendingAudit, pendingAuditBytes, packet, packetBytes: Buffer.from(`${JSON.stringify(packet)}\n`) };
}

test("accepts an exact source/audit/screenshot-bound readability review packet", () => {
  const value = fixture();
  try {
    assert.doesNotThrow(() => verifyTypographyReadabilityReviewPacket({ ...value, expectedCheckCount: 4 }));
  } finally {
    fs.rmSync(value.workspace, { recursive: true, force: true });
  }
});

test("rejects incomplete, drifted, escaping, and symbolic-link review evidence", () => {
  const value = fixture();
  const drift = fixture();
  const escaping = fixture();
  const linked = fixture();
  const outside = path.join(os.tmpdir(), `aico8-type-review-outside-${process.pid}.png`);
  try {
    value.packet.screenshots.pop();
    assert.throws(() => verifyTypographyReadabilityReviewPacket({
      ...value,
      packetBytes: Buffer.from(`${JSON.stringify(value.packet)}\n`),
      expectedCheckCount: 4,
    }), /every screenshot/);

    fs.writeFileSync(path.join(drift.workspace, drift.packet.screenshots[0].path), "drifted");
    assert.throws(() => verifyTypographyReadabilityReviewPacket({ ...drift, expectedCheckCount: 4 }), /bytes changed/);

    escaping.packet.screenshots[0].path = "../outside.png";
    assert.throws(() => verifyTypographyReadabilityReviewPacket({
      ...escaping,
      packetBytes: Buffer.from(`${JSON.stringify(escaping.packet)}\n`),
      expectedCheckCount: 4,
    }), /escapes/);

    const linkedScreenshot = linked.packet.screenshots[0];
    fs.writeFileSync(outside, "outside screenshot");
    fs.rmSync(path.join(linked.workspace, linkedScreenshot.path));
    fs.symlinkSync(outside, path.join(linked.workspace, linkedScreenshot.path));
    linkedScreenshot.sha256 = sha256Bytes(fs.readFileSync(outside));
    assert.throws(() => verifyTypographyReadabilityReviewPacket({
      ...linked,
      packetBytes: Buffer.from(`${JSON.stringify(linked.packet)}\n`),
      expectedCheckCount: 4,
    }), /symbolic-link evidence/);
  } finally {
    fs.rmSync(outside, { force: true });
    for (const fixtureValue of [value, drift, escaping, linked]) {
      fs.rmSync(fixtureValue.workspace, { recursive: true, force: true });
    }
  }
});
