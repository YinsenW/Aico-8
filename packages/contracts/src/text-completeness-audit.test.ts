import { describe, expect, it } from "vitest";

import {
  buildTextCompletenessAudit,
  validateTextCompletenessAudit,
  type HdTextFrameObservationV1,
} from "./text-completeness-audit.js";
import { TEXT_INVENTORY_SCHEMA_VERSION, type TextInventoryV1 } from "./typography.js";

const hash = (character: string): string => character.repeat(64);
const inventory = {
  schemaVersion: TEXT_INVENTORY_SCHEMA_VERSION,
  status: "complete-for-hd",
  gameId: "synthetic-game",
  sourceSha256: hash("a"),
  runs: [{
    id: "menu-begin",
    reachable: true,
    contentKind: "semantic-text",
    role: "menu",
    classification: "safe-modern",
    source: {
      commandId: "print-1",
      sequence: 0,
      updateLow: 0,
      updateHigh: 0,
      byteStart: 0,
      bytesHex: "626567696e",
      p8sciiEvidenceSha256: hash("b"),
    },
    unicode: {
      text: "begin",
      codePoints: [98, 101, 103, 105, 110],
      mappingKind: "lossless-declared",
      mappingEvidenceSha256: hash("c"),
    },
    provenance: { kind: "source-authored", evidenceSha256: hash("d") },
    flags: { effectful: false, customFont: false, inlineGlyph: false, buttonGlyph: false, ambiguousMapping: false },
    mapping: { kind: "bundled-font", role: "menu" },
  }],
} as const satisfies TextInventoryV1;

const frames = (overrides: Partial<HdTextFrameObservationV1> = {}): HdTextFrameObservationV1[] => [{
  update: 0,
  sceneId: "scene.menu",
  sourceTextRunCount: 1,
  approvedTextRunCount: 1,
  blockedTextRunCount: 0,
  mismatchedTextRunCount: 0,
  unapprovedTextRunCount: 0,
  ...overrides,
}];

const regressions = [
  { id: "deleted-mapping", category: "deleted-inventory-mapping", rejected: true },
  { id: "stale-source", category: "stale-source-inventory", rejected: true },
  { id: "ir-mismatch", category: "text-ir-mismatch", rejected: true },
] as const;

describe("HD text completeness audit", () => {
  it("keeps the JSON Schema version synchronized with the executable contract", () => {
    const schema = JSON.parse(readFileSync(new URL("../../../specs/schemas/text-completeness-audit-v1.schema.json", import.meta.url), "utf8"));
    expect(schema.properties.schemaVersion.const).toBe("aico8.text-completeness-audit.v1");
  });

  it("accepts complete per-frame consumption with all fail-closed mutations proved", () => {
    const audit = buildTextCompletenessAudit({
      inventory,
      inventorySha256: hash("e"),
      frames: frames(),
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      status: "accepted",
      regressions,
    });
    expect(validateTextCompletenessAudit(audit, inventory)).toEqual({ valid: true, errors: [] });
  });

  it("retains the exact failing updates and rejects an unapproved reachable run", () => {
    const audit = buildTextCompletenessAudit({
      inventory,
      inventorySha256: hash("e"),
      frames: frames({ approvedTextRunCount: 0, blockedTextRunCount: 1, unapprovedTextRunCount: 1 }),
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      status: "accepted",
      regressions,
    });
    expect(audit.failingUpdateIds).toEqual([0]);
    expect(validateTextCompletenessAudit(audit, inventory).valid).toBe(false);
  });

  it("requires deleted-mapping, stale-source, and IR-mismatch rejection evidence", () => {
    const audit = buildTextCompletenessAudit({
      inventory,
      inventorySha256: hash("e"),
      frames: frames(),
      observationRuns: [{ id: "canonical", kind: "canonical-replay", startUpdate: 0, endUpdateExclusive: 1 }],
      status: "accepted",
      regressions: regressions.slice(0, 1),
    });
    const result = validateTextCompletenessAudit(audit, inventory);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/stale-source-inventory|text-ir-mismatch/);
  });
});
import { readFileSync } from "node:fs";
