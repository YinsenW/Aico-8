import { describe, expect, it } from "vitest";

import {
  sourceAuthoredCopy,
  sourceTimedElementVisibility,
  sourceTimedVisibility,
} from "./presentation.js";
import { sourceDerivedAccessibleDescription } from "@aico8/contracts";

describe("source-authored HD copy", () => {
  const contract = {
    id: "hud.hole",
    template: "hole {ordinal}",
    sourceEvidence: "cart.lua:_draw:hole-label",
  } as const;

  it("preserves source case, punctuation, spacing, and number formatting", () => {
    expect(sourceAuthoredCopy(contract, { ordinal: 12 })).toBe("hole 12");
    expect(sourceAuthoredCopy({
      id: "hud.total",
      template: "total: {strokes}/{par}",
      sourceEvidence: "cart.lua:_draw:total",
    }, { strokes: 216, par: 233 })).toBe("total: 216/233");
  });

  it("fails closed when bindings can silently rewrite the declared template", () => {
    expect(() => sourceAuthoredCopy(contract, {})).toThrow(/missing ordinal/);
    expect(() => sourceAuthoredCopy(contract, { ordinal: 1, padding: 2 }))
      .toThrow(/unexpected padding/);
    expect(() => sourceAuthoredCopy({ ...contract, sourceEvidence: "" }, { ordinal: 1 }))
      .toThrow(/source evidence/);
  });
});

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

describe("assistive text provenance", () => {
  it("keeps the DOM mirror source-derived and non-authoritative", () => {
    expect(sourceDerivedAccessibleDescription({
      sceneId: "scene.gameplay",
      text: "Level 3. 12 dust remaining.",
      sourceEvidenceIds: ["state.level", "state.dust"],
    })).toEqual({
      sceneId: "scene.gameplay",
      text: "Level 3. 12 dust remaining.",
      provenance: "state-derived-accessibility",
      sourceEvidenceIds: ["state.level", "state.dust"],
    });
  });
});
