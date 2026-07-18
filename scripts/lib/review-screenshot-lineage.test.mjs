import assert from "node:assert/strict";
import test from "node:test";

import {
  crossSceneDuplicateGroups,
  validateRawPixelCrop,
} from "./review-screenshot-lineage.mjs";

test("accepts only bounded integer crops in retained raw-pixel coordinates", () => {
  validateRawPixelCrop({ x: 386, y: 138, width: 508, height: 508 }, { width: 1280, height: 720 });
  assert.throws(
    () => validateRawPixelCrop({ x: 386, y: 138, width: 1024, height: 508 }, { width: 1280, height: 720 }),
    /escapes/,
  );
  assert.throws(
    () => validateRawPixelCrop({ x: 1.5, y: 0, width: 508, height: 508 }, { width: 1280, height: 720 }),
    /integer raw-pixel/,
  );
});

test("rejects an identical derived image reused across declared scenes in one mode", () => {
  const records = [
    { id: "menu", mode: "hd", sceneId: "scene.menu", derivedSha256: "a".repeat(64) },
    { id: "gameplay", mode: "hd", sceneId: "scene.gameplay", derivedSha256: "a".repeat(64) },
    { id: "gameplay-2", mode: "hd", sceneId: "scene.gameplay", derivedSha256: "a".repeat(64) },
    { id: "reference", mode: "reference", sceneId: "scene.gameplay", derivedSha256: "a".repeat(64) },
  ];
  const groups = crossSceneDuplicateGroups(records);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(({ id }) => id), ["menu", "gameplay", "gameplay-2"]);
});

test("allows an explicit source-relative duplicate exception without weakening other records", () => {
  const records = [
    { id: "blank-a", mode: "reference", sceneId: "scene.a", derivedSha256: "b".repeat(64), allowCrossSceneDuplicate: true },
    { id: "blank-b", mode: "reference", sceneId: "scene.b", derivedSha256: "b".repeat(64), allowCrossSceneDuplicate: true },
  ];
  assert.deepEqual(crossSceneDuplicateGroups(records), []);
});
