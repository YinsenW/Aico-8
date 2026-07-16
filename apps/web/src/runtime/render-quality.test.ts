import { describe, expect, it } from "vitest";

import { HD_RENDER_QUALITY, renderQualityErrors } from "./render-quality.js";

describe("HD render quality", () => {
  it("uses deterministic 2x edge supersampling without overriding container sizing", () => {
    expect(renderQualityErrors()).toEqual([]);
    expect(HD_RENDER_QUALITY.edgeSupersampleFactor).toBe(2);
    expect(HD_RENDER_QUALITY.autoDensity).toBe(false);
  });

  it("rejects the old single-resolution enlarged-vector path", () => {
    expect(renderQualityErrors({
      edgeSupersampleFactor: 1, antialias: true, autoDensity: true, containerScaled: false,
    }))
      .toEqual(expect.arrayContaining([
        expect.stringMatching(/supersampling/),
        expect.stringMatching(/container-controlled/),
      ]));
  });
});
