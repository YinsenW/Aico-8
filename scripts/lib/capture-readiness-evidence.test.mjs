import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCaptureReadinessEvidence,
  captureReadinessErrors,
} from "./capture-readiness-evidence.mjs";

const valid = {
  id: "hd-gameplay-level-01",
  status: "ready",
  loadingHiddenClass: true,
  loadingOpacity: 0,
  loadingVisibility: "hidden",
  presentedFrames: 2,
  presentationMode: "hd",
  sceneId: "scene.gameplay",
  stateBoundary: "canonical-replay:update:3:presentation-ms:0",
};

test("accepts DOM-bound evidence captured only after the loading overlay is excluded", () => {
  assert.equal(assertCaptureReadinessEvidence(valid, {
    id: valid.id,
    presentationMode: valid.presentationMode,
    sceneId: valid.sceneId,
    stateBoundary: valid.stateBoundary,
  }), valid);
});

test("rejects a nominally settled screenshot whose overlay remains visible", () => {
  const errors = captureReadinessErrors({
    ...valid,
    loadingHiddenClass: false,
    loadingOpacity: 0.42,
    loadingVisibility: "visible",
  });
  assert.match(errors.join("\n"), /loadingHiddenClass/);
  assert.match(errors.join("\n"), /loadingOpacity/);
  assert.match(errors.join("\n"), /loadingVisibility/);
});

test("rejects readiness copied from a different mode, scene, or state boundary", () => {
  assert.throws(() => assertCaptureReadinessEvidence(valid, {
    id: valid.id,
    presentationMode: "reference",
    sceneId: "scene.win",
    stateBoundary: "canonical-replay:update:34:presentation-ms:0",
  }), /presentationMode.*sceneId.*stateBoundary/);
});
