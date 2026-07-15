import assert from "node:assert/strict";
import test from "node:test";

import {
  HD_REVIEW_SCREENSHOT_FIELDS,
  normalizeHdReviewScreenshot,
} from "./review-screenshot.mjs";

test("normalizes enriched browser evidence to the exact public review screenshot contract", () => {
  const browserScreenshot = {
    id: "reference-u0001",
    path: "evidence/reference-u0001.png",
    sha256: "a".repeat(64),
    width: 1024,
    height: 1024,
    presentationMode: "reference",
    sceneId: "scene.title",
    stateBoundary: "canonical-replay:update:1:presentation-ms:0",
    visualRuntimeSha256: "b".repeat(64),
    rawBrowserPath: "evidence/reference-u0001-browser.jpg",
    rawBrowserSha256: "c".repeat(64),
    captureReadiness: "ready",
    update: 1,
  };

  const normalized = normalizeHdReviewScreenshot(browserScreenshot);
  assert.deepEqual(Object.keys(normalized), HD_REVIEW_SCREENSHOT_FIELDS);
  assert.equal(normalized.id, browserScreenshot.id);
  assert.equal(normalized.sha256, browserScreenshot.sha256);
  assert.equal("rawBrowserPath" in normalized, false);
  assert.equal("captureReadiness" in normalized, false);
  assert.equal("update" in normalized, false);
});
