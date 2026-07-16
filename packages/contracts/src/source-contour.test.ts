import { describe, expect, it } from "vitest";

import {
  hdSurfaceQualityErrors,
  roundedSourceContour,
  sourceContourTopology,
  topologyConstrainedSourceContour,
  traceSourceMaskContours,
} from "./source-contour.js";

const mask = (rows: readonly string[]) => rows.map((row) => [...row].map((cell) => cell === "#"));

describe("source-locked contour vectorization", () => {
  it("retains disconnected glyphs, counters, source bounds, and filled-cell area", () => {
    const topology = sourceContourTopology(mask([
      "##..###",
      "#...#.#",
      "##..###",
    ]));
    expect(topology).toEqual({
      filledCells: 13,
      componentCount: 2,
      holeCount: 1,
      bounds: { x: 0, y: 0, width: 7, height: 3 },
    });
  });

  it("emits deterministic rounded SVG paths while limiting outline movement below half a source pixel", () => {
    const result = roundedSourceContour(mask([
      "###",
      "#.#",
      "###",
    ]), { scale: 8, radius: 2.5, offsetX: 16, offsetY: 24 });
    expect(result.maximumContourDisplacementSourcePixels).toBe(0.3125);
    expect(result.topology.componentCount).toBe(1);
    expect(result.topology.holeCount).toBe(1);
    expect(result.path).toContain("Q 16 24 18.5 24");
    expect(result.path).toContain("Q");
    expect(result.path).toMatch(/Z M .* Z$/);
  });

  it("keeps corner-touching source components separate", () => {
    expect(traceSourceMaskContours(mask([
      "#.",
      ".#",
    ]))).toHaveLength(2);
  });

  it("rejects redraw radii capable of crossing source-cell centers", () => {
    expect(() => roundedSourceContour(mask(["#"]), { scale: 8, radius: 4 })).toThrow(/smaller than half/);
  });

  it("turns pixel stair-steps into continuous curves without changing source cell centres", () => {
    const result = topologyConstrainedSourceContour(mask([
      "##...",
      ".##..",
      "..##.",
      "...##",
    ]), { scale: 8, smoothingCut: 0.25 });
    expect(result.algorithm).toBe("topology-constrained-spline-v1");
    expect(result.sourceCellCentersPreserved).toBe(true);
    expect(result.maximumContourDisplacementSourcePixels).toBe(0.375);
    expect(result.curveCommandCount).toBeGreaterThan(8);
    expect(result.path).toContain("Q");
    expect(result.path).not.toContain(" L ");
  });

  it("separates protected counters from edge treatments so small internal details stay open", () => {
    const result = topologyConstrainedSourceContour(mask([
      "#####",
      "#.#.#",
      "#####",
    ]), { scale: 8, smoothingCut: 0.25 });
    expect(result.protectedNegativeSpaceCount).toBe(2);
    expect(result.path.match(/\bM\b/g)).toHaveLength(3);
    expect(result.outerPath.match(/\bM\b/g)).toHaveLength(1);
    expect(result.negativeSpacePath.match(/\bM\b/g)).toHaveLength(2);
  });

  it("requires both identity preservation and a measurable HD surface treatment", () => {
    expect(hdSurfaceQualityErrors({
      contourAlgorithm: "topology-constrained-spline-v1",
      sourceCellCentersPreserved: true,
      maximumContourDisplacementSourcePixels: 0.375,
      curveCommandCount: 24,
      targetPixelsPerSourcePixel: 8,
      edgeSupersampleFactor: 2,
      detailPrimitiveIds: ["shade", "base", "highlight"],
      protectedNegativeSpaceCount: 2,
      occludedNegativeSpaceCount: 0,
    })).toEqual([]);
    expect(hdSurfaceQualityErrors({
      contourAlgorithm: "topology-constrained-spline-v1",
      sourceCellCentersPreserved: true,
      maximumContourDisplacementSourcePixels: 0.05,
      curveCommandCount: 2,
      targetPixelsPerSourcePixel: 2,
      edgeSupersampleFactor: 1,
      detailPrimitiveIds: ["base"],
      protectedNegativeSpaceCount: 2,
      occludedNegativeSpaceCount: 1,
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/smoothing/),
      expect.stringMatching(/continuous curve/),
      expect.stringMatching(/four target pixels/),
      expect.stringMatching(/supersampling/),
      expect.stringMatching(/shade, base, and highlight/),
      expect.stringMatching(/may not occlude protected negative space/),
    ]));
  });
});
