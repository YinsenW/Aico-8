import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateSourceContourLineage } from "./source-contour-lineage.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-contour-"));
  const source = Buffer.from("source");
  const target = Buffer.from("target");
  fs.writeFileSync(path.join(workspace, "source.png"), source);
  fs.writeFileSync(path.join(workspace, "target.svg"), target);
  const maskHash = hash("mask");
  return { workspace, value: {
    schemaVersion: "aico8.source-contour-lineage.v1",
    source: { path: "source.png", sha256: hash(source), crop: { x: 0, y: 0, width: 128, height: 128 } },
    target: { path: "target.svg", sha256: hash(target) },
    transform: { scale: 8, cornerRadiusTargetPixels: 2.5, maximumContourDisplacementSourcePixels: 0.3125 },
    masks: [{
      id: "wordmark", sourceMaskSha256: maskHash, targetDownsampledMaskSha256: maskHash,
      sourceComponentCount: 2, targetComponentCount: 2, sourceHoleCount: 1, targetHoleCount: 1,
      filledCells: 20, bounds: { x: 10, y: 10, width: 20, height: 12 },
    }],
  } };
}

test("accepts source-bound contour lineage below half a source pixel", () => {
  const { workspace, value } = fixture();
  assert.equal(validateSourceContourLineage(workspace, value), value);
});

test("rejects a generic redraw whose downsampled mask or topology differs", () => {
  const { workspace, value } = fixture();
  value.masks[0].targetDownsampledMaskSha256 = hash("redrawn");
  value.masks[0].targetHoleCount = 0;
  assert.throws(() => validateSourceContourLineage(workspace, value), /changed its source-cell projection/);
});

test("rejects stale vector hashes and smoothing that can cross source-cell centers", () => {
  const { workspace, value } = fixture();
  value.target.sha256 = hash("stale");
  assert.throws(() => validateSourceContourLineage(workspace, value), /target hash mismatch/);
  value.target.sha256 = hash(Buffer.from("target"));
  value.transform.cornerRadiusTargetPixels = 4;
  value.transform.maximumContourDisplacementSourcePixels = 0.5;
  assert.throws(() => validateSourceContourLineage(workspace, value), /preserve source-cell centers/);
});
