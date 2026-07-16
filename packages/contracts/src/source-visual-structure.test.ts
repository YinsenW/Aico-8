import { describe, expect, it } from "vitest";

import {
  indexedVisualLayers,
  sourceEdgeSignature,
  visualStructureProjectionErrors,
  visualStructureSignature,
  visualVariantCollapseErrors,
} from "./source-visual-structure.js";

describe("source visual structure", () => {
  it("extracts ordered material layers and adjacency edges", () => {
    const layers = indexedVisualLayers([
      [1, 1, 2, 2],
      [1, 0, 0, 2],
      [1, 1, 2, 2],
    ]);
    expect(layers.map((layer) => layer.sourceValue)).toEqual([1, 2]);
    expect(layers[0]?.edges).toEqual({ top: "1100", right: "000", bottom: "1100", left: "111" });
    expect(visualStructureSignature(layers)).toContain("1:4x3:1100/1000/1100");
  });

  it("rejects changing a source rounded rectangle into a circle", () => {
    const roundedRectangle = indexedVisualLayers([
      [0, 1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [0, 1, 1, 1, 1, 0],
    ]);
    const circle = indexedVisualLayers([
      [0, 0, 1, 1, 0, 0],
      [0, 1, 1, 1, 1, 0],
      [0, 1, 1, 1, 1, 0],
      [0, 0, 1, 1, 0, 0],
    ]);
    expect(visualStructureProjectionErrors(roundedRectangle, circle).join("\n"))
      .toMatch(/occupied-cell contour/);
  });

  it("rejects flattening multiple source material layers", () => {
    const source = indexedVisualLayers([
      [2, 2, 2, 2],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]);
    const flattened = indexedVisualLayers([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]);
    expect(visualStructureProjectionErrors(source, flattened).join("\n"))
      .toMatch(/material layers changed/);
  });

  it("rejects one recipe for structurally distinct tile variants", () => {
    const horizontal = indexedVisualLayers([[1, 1, 1], [0, 0, 0]]);
    const vertical = indexedVisualLayers([[1, 0], [1, 0], [1, 0]]);
    expect(visualVariantCollapseErrors([
      { id: "tile-32", recipeId: "wall", layers: horizontal },
      { id: "tile-33", recipeId: "wall", layers: vertical },
    ])).toEqual(["recipe wall collapses structurally distinct variants: tile-32, tile-33"]);
    expect(visualVariantCollapseErrors([
      { id: "tile-32", recipeId: "wall#tile-32", layers: horizontal },
      { id: "tile-33", recipeId: "wall#tile-33", layers: vertical },
    ])).toEqual([]);
  });

  it("reports source boundary occupancy independently of palette", () => {
    expect(sourceEdgeSignature([[true, false], [true, true]])).toEqual({
      top: "10", right: "01", bottom: "11", left: "11",
    });
  });
});
