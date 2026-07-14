import { describe, expect, it } from "vitest";

import { roundedSourceContour, sourceContourTopology, traceSourceMaskContours } from "./source-contour.js";

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
});
