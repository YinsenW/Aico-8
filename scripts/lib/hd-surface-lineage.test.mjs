import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateHdSurfaceLineage } from "./hd-surface-lineage.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-hd-surface-"));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"
    data-aico8-schema="aico8.semantic-vector-source.v1" data-aico8-asset-id="surface"
    data-aico8-origin="0 0" data-aico8-required-layers="shape">
    <g id="shape">
      <path id="shape-shade" d="M 8 32 Q 8 8 32 8 Q 56 8 56 32 Q 56 56 32 56 Q 8 56 8 32 Z"
        fill="none" stroke="#401020" stroke-opacity="0.7" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <path id="shape-base" d="M 8 32 Q 8 8 32 8 Q 56 8 56 32 Q 56 56 32 56 Q 8 56 8 32 Z" fill="#ff77a8"/>
      <path id="shape-highlight" d="M 8 32 Q 8 8 32 8 Q 56 8 56 32 Q 56 56 32 56 Q 8 56 8 32 Z"
        fill="none" stroke="#ffc0d7" stroke-opacity="0.45" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;
  fs.writeFileSync(path.join(workspace, "surface.svg"), svg);
  return { workspace, value: {
    schemaVersion: "aico8.hd-surface-lineage.v1",
    target: { path: "surface.svg", sha256: sha256(svg) },
    rendering: { targetPixelsPerSourcePixel: 8, edgeSupersampleFactor: 2 },
    surfaces: [{
      id: "shape-surface", contourAlgorithm: "topology-constrained-spline-v1",
      sourceCellCentersPreserved: true, maximumContourDisplacementSourcePixels: 0.375,
      protectedNegativeSpaceCount: 0,
      negativeSpacePrimitiveId: null,
      shadePrimitiveId: "shape-shade", basePrimitiveId: "shape-base", highlightPrimitiveId: "shape-highlight",
    }],
  } };
}

test("accepts a source-preserving continuous contour with shade, base, highlight, and supersampling", () => {
  const { workspace, value } = fixture();
  assert.equal(validateHdSurfaceLineage(workspace, value), value);
});

test("rejects smooth-looking evidence that lacks real target primitives", () => {
  const { workspace, value } = fixture();
  value.surfaces[0].highlightPrimitiveId = "invented-highlight";
  assert.throws(() => validateHdSurfaceLineage(workspace, value), /missing primitive/);
});

test("rejects pixel staircases, weak smoothing, and single-resolution edges", () => {
  const first = fixture();
  first.value.surfaces[0].maximumContourDisplacementSourcePixels = 0.05;
  assert.throws(() => validateHdSurfaceLineage(first.workspace, first.value), /smoothing must be visible/);
  const second = fixture();
  second.value.rendering.edgeSupersampleFactor = 1;
  assert.throws(() => validateHdSurfaceLineage(second.workspace, second.value), /edge supersampling/);
});

test("rejects edge treatments that paint over protected counters or facial negative space", () => {
  const { workspace, value } = fixture();
  value.surfaces[0].protectedNegativeSpaceCount = 1;
  assert.throws(() => validateHdSurfaceLineage(workspace, value), /requires a negative-space primitive/);
});
