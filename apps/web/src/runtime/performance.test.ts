import { describe, expect, it } from "vitest";

import { sampleFrameIntervals, summarizeFrameIntervals } from "./performance.js";

describe("Web release performance sampling", () => {
  it("computes deterministic percentile and dropped-frame measurements", () => {
    expect(summarizeFrameIntervals([16, 17, 15, 25, 40], 25)).toEqual({
      sampleFrames: 5,
      p95FrameMilliseconds: 40,
      maxFrameMilliseconds: 40,
      droppedFrameRatio: 0.2,
    });
  });

  it("drops warm-up frames and samples the requested settled interval count", async () => {
    const timestamps = [0, 8, 16, 32, 48, 64, 80];
    let index = 0;
    const intervals = await sampleFrameIntervals(4, 2, (callback) => {
      callback(timestamps[index++]!);
      return index;
    });
    expect(intervals).toEqual([16, 16, 16, 16]);
  });

  it("rejects empty, non-finite, or non-positive samples", () => {
    expect(() => summarizeFrameIntervals([], 25)).toThrow(/at least one frame/);
    expect(() => summarizeFrameIntervals([16, Number.NaN], 25)).toThrow(/finite positive/);
    expect(() => summarizeFrameIntervals([16], 0)).toThrow(/drop threshold/);
  });
});
