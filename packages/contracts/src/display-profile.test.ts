import { describe, expect, it } from "vitest";

import {
  REFERENCE_PROFILE,
  fitReferenceSquare,
  logicalToReference,
  referenceToLogical,
} from "./display-profile.js";

describe("1024 reference display contract", () => {
  it("maps the complete PICO-8 surface at an exact integer scale", () => {
    expect(REFERENCE_PROFILE.logicalWidth * REFERENCE_PROFILE.logicalScale).toBe(1024);
    expect(REFERENCE_PROFILE.logicalHeight * REFERENCE_PROFILE.logicalScale).toBe(1024);
    expect(REFERENCE_PROFILE.logicalTileSize * REFERENCE_PROFILE.logicalScale).toBe(64);
  });

  it("round-trips every integer logical coordinate exactly", () => {
    for (let coordinate = 0; coordinate <= REFERENCE_PROFILE.logicalWidth; coordinate += 1) {
      expect(referenceToLogical(logicalToReference(coordinate))).toBe(coordinate);
    }
  });

  it("centers the square without changing its aspect", () => {
    expect(fitReferenceSquare(1600, 900)).toEqual({
      x: 350,
      y: 0,
      size: 900,
      scale: 900 / 1024,
    });
    expect(fitReferenceSquare(600, 1000)).toEqual({
      x: 0,
      y: 200,
      size: 600,
      scale: 600 / 1024,
    });
  });

  it("rejects invalid viewport dimensions", () => {
    expect(() => fitReferenceSquare(-1, 100)).toThrow(RangeError);
    expect(() => fitReferenceSquare(Number.NaN, 100)).toThrow(RangeError);
  });
});
