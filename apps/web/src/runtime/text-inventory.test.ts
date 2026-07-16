import { describe, expect, it } from "vitest";

import {
  assessHdTextFrame,
  buildReachableTextInventory,
  createCompleteHdTextApprovalResolver,
  type ReachableTextObservation,
} from "./text-inventory.js";
import type { TextRunV1 } from "./text-run-ir.js";

const hash = (character: string): string => character.repeat(64);

function textRun(text = "begin", overrides: Partial<TextRunV1> = {}): TextRunV1 {
  return {
    schemaVersion: 1,
    sequence: 4,
    update: { low: 12, high: 0 },
    classification: "safe-modern",
    reasonMask: 0,
    sideEffectMask: 0,
    unsupportedMask: 0,
    anchor: [2, 3],
    cursorIn: [2, 3],
    cursorOut: [7, 3],
    rightmostX: 6,
    diagnosticBounds: { x: 2, y: 3, width: 5, height: 6 },
    foregroundIn: 7,
    foregroundOut: 7,
    printAttributes: 0,
    customFont: { revision: 0, memoryBase: 0x5600, memorySize: 0x100 },
    appendNewline: false,
    spans: [{ byteOffset: 0, byteLength: text.length, kind: "visual", reasonMask: 0, sideEffectMask: 0 }],
    rawP8scii: Array.from(new TextEncoder().encode(text)),
    ...overrides,
  };
}

function observation(mapping?: ReachableTextObservation["mapping"]): ReachableTextObservation {
  return {
    id: "menu-begin",
    commandId: "print-4",
    run: textRun(),
    byteStart: 0,
    contentKind: "semantic-text",
    role: "menu",
    p8sciiEvidenceSha256: hash("a"),
    mappingEvidenceSha256: hash("b"),
    blockerEvidenceSha256: hash("c"),
    provenance: { kind: "source-authored", evidenceSha256: hash("d") },
    ...(mapping ? { mapping } : {}),
  };
}

describe("reachable HD text inventory", () => {
  it("records a missing decision as a blocker instead of guessing a font mapping", () => {
    const inventory = buildReachableTextInventory({
      gameId: "synthetic-game",
      sourceSha256: hash("e"),
      observations: [observation()],
    });
    expect(inventory.status).toBe("draft");
    expect(inventory.runs[0]?.mapping).toMatchObject({
      kind: "review-blocker",
      reasonCode: "missing-approved-mapping",
    });
  });

  it("binds approved text to exact source bytes, update, and semantic sequence", () => {
    const inventory = buildReachableTextInventory({
      gameId: "synthetic-game",
      sourceSha256: hash("e"),
      status: "complete-for-hd",
      observations: [observation({ kind: "bundled-font", role: "menu" })],
    });
    const resolver = createCompleteHdTextApprovalResolver(inventory, {
      gameId: "synthetic-game",
      sourceSha256: hash("e"),
    });
    expect(resolver.resolve(textRun())).toEqual({ inventoryRunId: "menu-begin", role: "menu" });
    expect(resolver.resolve(textRun("resume"))).toBeUndefined();
    expect(resolver.resolve(textRun("begin", { sequence: 5 }))).toBeUndefined();
    expect(() => createCompleteHdTextApprovalResolver(inventory, {
      gameId: "synthetic-game",
      sourceSha256: hash("f"),
    })).toThrow(/active game bytes/);
  });

  it("cannot promote an inventory while an observed run lacks approval", () => {
    expect(() => buildReachableTextInventory({
      gameId: "synthetic-game",
      sourceSha256: hash("e"),
      status: "complete-for-hd",
      observations: [observation()],
    })).toThrow(/complete-for-hd|review blocker/);
  });

  it("accepts only frames whose source text is fully approved and consumed", () => {
    expect(assessHdTextFrame({
      textCount: 2,
      safeTextCount: 2,
      blockedTextCount: 0,
      mismatchedTextCount: 0,
      unapprovedTextCount: 0,
    })).toEqual({ accepted: true, violations: [] });
    const rejected = assessHdTextFrame({
      textCount: 2,
      safeTextCount: 1,
      blockedTextCount: 1,
      mismatchedTextCount: 0,
      unapprovedTextCount: 1,
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.violations).toHaveLength(3);
  });
});
