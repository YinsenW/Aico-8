import assert from "node:assert/strict";
import test from "node:test";

import { assertFullViewportScreenshot } from "./viewport-evidence.mjs";

const phone = { id: "phone-portrait-390x844", viewport: { width: 390, height: 844 } };

test("accepts a screenshot that covers the declared viewport", () => {
  assert.doesNotThrow(() => assertFullViewportScreenshot(phone, { width: 390, height: 844 }));
});

test("rejects a desktop screenshot mislabeled as a phone capture", () => {
  assert.throws(
    () => assertFullViewportScreenshot(phone, { width: 1280, height: 720 }),
    /must cover the declared full viewport 390x844/,
  );
});

test("rejects cropped evidence even when one dimension matches", () => {
  assert.throws(
    () => assertFullViewportScreenshot(phone, { width: 390, height: 720 }),
    /screenshot 390x720/,
  );
});
