import { describe, expect, it } from "vitest";

import { sourceTimedVisibility } from "./presentation.js";

describe("source-timed HD visibility", () => {
  it("does not reveal source-authored content from scene membership alone", () => {
    expect(sourceTimedVisibility(["scene:intro", "intro:command:opcode-1"], ["text:intro-level"]))
      .toBe(false);
  });

  it("reveals content only when every required token is present in the current frame", () => {
    expect(sourceTimedVisibility(
      ["scene:intro", "text:intro-level", "intro:command:opcode-14"],
      ["text:intro-level", "intro:command:opcode-14"],
    )).toBe(true);
    expect(sourceTimedVisibility(
      ["scene:intro", "text:intro-level"],
      ["text:intro-level", "intro:command:opcode-14"],
    )).toBe(false);
  });

  it("requires an explicit, non-duplicated source-token contract", () => {
    expect(() => sourceTimedVisibility([], [])).toThrow(/at least one source token/);
    expect(() => sourceTimedVisibility(["text:ending"], ["text:ending", "text:ending"]))
      .toThrow(/duplicate source tokens/);
  });
});
