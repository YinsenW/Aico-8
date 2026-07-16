import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateSourceVisualStructureLineage } from "./source-visual-structure-lineage.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const edge = { top: "1111", right: "1111", bottom: "1111", left: "1111" };

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-structure-"));
  fs.writeFileSync(path.join(workspace, "source.png"), "source");
  fs.writeFileSync(path.join(workspace, "target.svg"), "target");
  const mask = sha256("mask-a");
  const layer = {
    sourceValue: 7, sourceMaskSha256: mask, targetDownsampledMaskSha256: mask,
    sourceComponentCount: 1, targetComponentCount: 1, sourceHoleCount: 0, targetHoleCount: 0,
    edges: { source: edge, target: edge },
  };
  const structureSha256 = sha256(JSON.stringify([{ sourceValue: 7, sourceMaskSha256: mask, edges: edge }]));
  return { workspace, value: {
    schemaVersion: "aico8.source-visual-structure-lineage.v1",
    source: { path: "source.png", sha256: sha256("source") },
    target: { path: "target.svg", sha256: sha256("target") },
    variants: [{ id: "tile-02", recipeId: "map-tiles.tile-02", structureSha256, layers: [layer] }],
  } };
}

test("accepts exact contour, material-layer, topology, and edge lineage", () => {
  const { workspace, value } = fixture();
  assert.equal(validateSourceVisualStructureLineage(workspace, value), value);
});

test("rejects shape drift and material-edge drift", () => {
  const first = fixture();
  first.value.variants[0].layers[0].targetDownsampledMaskSha256 = sha256("circle");
  assert.throws(() => validateSourceVisualStructureLineage(first.workspace, first.value), /changed contour/);
  const second = fixture();
  second.value.variants[0].layers[0].edges.target = { ...edge, right: "0000" };
  assert.throws(() => validateSourceVisualStructureLineage(second.workspace, second.value), /changed adjacency edges/);
});

test("rejects one recipe that collapses structurally distinct variants", () => {
  const { workspace, value } = fixture();
  const variant = structuredClone(value.variants[0]);
  variant.id = "tile-33";
  variant.layers[0].sourceMaskSha256 = sha256("mask-b");
  variant.layers[0].targetDownsampledMaskSha256 = variant.layers[0].sourceMaskSha256;
  variant.structureSha256 = sha256(JSON.stringify([{
    sourceValue: 7, sourceMaskSha256: variant.layers[0].sourceMaskSha256, edges: edge,
  }]));
  value.variants.push(variant);
  assert.throws(() => validateSourceVisualStructureLineage(workspace, value), /collapses distinct variants/);
});
