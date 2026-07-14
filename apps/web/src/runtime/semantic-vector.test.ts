import { describe, expect, it } from "vitest";

import { createSemanticVectorContext, type SemanticVectorAsset } from "./semantic-vector.js";

const hash = "a".repeat(64);
const asset: SemanticVectorAsset = {
  schemaVersion: "aico8.semantic-vector-source.v1",
  id: "test-vector",
  sourceSha256: hash,
  sourceBytes: 1,
  recipeSha256: hash,
  viewBox: [0, 0, 64, 64],
  origin: [32, 32],
  requiredLayerIds: ["body", "detail"],
  elementIds: ["body", "body-shape", "detail", "detail-shape"],
  primitives: [
    { id: "body-shape", layerIds: ["body"], commands: [{ op: "circle", values: [32, 32, 28] }], fill: { token: "segment", alpha: 1 } },
    { id: "detail-shape", layerIds: ["detail"], commands: [{ op: "rect", values: [0, 0, 8, 8] }], fill: { color: 0xff0000, alpha: 1 } },
  ],
};

describe("semantic vector runtime", () => {
  it("compiles selected layers and palette tokens into a reusable context", () => {
    const context = createSemanticVectorContext(asset, {
      includeLayerIds: ["body"],
      palette: { segment: 0xffeee6 },
    });
    expect(context.bounds.width).toBe(56);
    expect(context.bounds.height).toBe(56);
  });

  it("fails closed when a semantic paint token is unresolved", () => {
    expect(() => createSemanticVectorContext(asset, { includeLayerIds: ["body"] })).toThrow(/unresolved/);
  });
});
