import { describe, expect, it } from "vitest";

import { sourceTimedElementVisibility, sourceTimedVisibility } from "./presentation.js";

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

describe("source-timed HD element visibility", () => {
  it("does not reveal an actor or effect from scene membership alone", () => {
    expect(sourceTimedElementVisibility(["scene.ending"], ["character.dust-bunny"]))
      .toBe(false);
    expect(sourceTimedElementVisibility(["scene.win"], ["effect.sparkle"]))
      .toBe(false);
  });

  it("reveals elements mapped by the current logical update", () => {
    expect(sourceTimedElementVisibility(
      ["scene.ending", "character.dust-bunny", "text.ending"],
      ["character.dust-bunny", "text.ending"],
    )).toBe(true);
  });

  it("requires an explicit, non-duplicated mapped-element contract", () => {
    expect(() => sourceTimedElementVisibility([], [])).toThrow(/at least one mapped element/);
    expect(() => sourceTimedElementVisibility(["effect.sparkle"], ["effect.sparkle", "effect.sparkle"]))
      .toThrow(/duplicate mapped elements/);
  });
});
