import {
  TEXT_INVENTORY_SCHEMA_VERSION,
  validateTextInventory,
  type TextContentKind,
  type TextInventoryRunV1,
  type TextInventoryV1,
  type TextProvenanceKind,
  type TypographyRole,
} from "@aico8/contracts";

import { decodeSafeModernTextRun } from "./hd-typography.js";
import { TextRunEffect, TextRunReason, type TextRunV1 } from "./text-run-ir.js";

export type TextInventoryMappingDecision = TextInventoryRunV1["mapping"];

export interface ReachableTextObservation {
  readonly id: string;
  readonly commandId: string;
  readonly run: TextRunV1;
  readonly byteStart: number;
  readonly contentKind: TextContentKind;
  readonly role: TypographyRole;
  readonly p8sciiEvidenceSha256: string;
  readonly mappingEvidenceSha256: string;
  readonly provenance: Readonly<{ kind: TextProvenanceKind; evidenceSha256: string }>;
  readonly unicode?: Readonly<{
    text: string;
    mappingKind: "lossless-declared" | "unmapped" | "ambiguous";
  }>;
  readonly mapping?: TextInventoryMappingDecision;
  readonly blockerEvidenceSha256: string;
}

export interface CompleteHdTextApproval {
  readonly inventoryRunId: string;
  readonly role: TypographyRole;
}

export interface CompleteHdTextApprovalResolver {
  resolve(run: TextRunV1): CompleteHdTextApproval | undefined;
}

function bytesHex(bytes: readonly number[]): string {
  return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function codePoints(text: string): number[] {
  return [...text].map((character) => character.codePointAt(0)!);
}

function runKey(run: Pick<TextRunV1, "update" | "sequence" | "rawP8scii">): string {
  return `${run.update.high >>> 0}/${run.update.low >>> 0}/${run.sequence >>> 0}/${bytesHex(run.rawP8scii)}`;
}

function inventoryRunKey(run: TextInventoryRunV1): string {
  return `${run.source.updateHigh >>> 0}/${run.source.updateLow >>> 0}/${run.source.sequence >>> 0}/${run.source.bytesHex}`;
}

/**
 * Produces the authoring inventory from captured kernel runs. The job never
 * guesses an approval: an observation without a decision becomes an explicit
 * review blocker, so promoting the result to complete-for-hd fails closed.
 */
export function buildReachableTextInventory(options: Readonly<{
  gameId: string;
  sourceSha256: string;
  status?: "draft" | "complete-for-hd";
  observations: readonly ReachableTextObservation[];
}>): TextInventoryV1 {
  const runs = options.observations.map((observation): TextInventoryRunV1 => {
    const inferredText = observation.run.classification === "safe-modern"
      ? decodeSafeModernTextRun(observation.run)
      : undefined;
    const unicode = observation.unicode ?? (inferredText === undefined
      ? { text: "unmapped", mappingKind: "unmapped" as const }
      : { text: inferredText, mappingKind: "lossless-declared" as const });
    const mapping = observation.mapping ?? {
      kind: "review-blocker" as const,
      reasonCode: "missing-approved-mapping",
      evidenceSha256: observation.blockerEvidenceSha256,
    };
    return {
      id: observation.id,
      reachable: true,
      contentKind: observation.contentKind,
      role: observation.role,
      classification: observation.run.classification,
      source: {
        commandId: observation.commandId,
        sequence: observation.run.sequence >>> 0,
        updateLow: observation.run.update.low >>> 0,
        updateHigh: observation.run.update.high >>> 0,
        byteStart: observation.byteStart >>> 0,
        bytesHex: bytesHex(observation.run.rawP8scii),
        p8sciiEvidenceSha256: observation.p8sciiEvidenceSha256,
      },
      unicode: {
        text: unicode.text,
        codePoints: codePoints(unicode.text),
        mappingKind: unicode.mappingKind,
        mappingEvidenceSha256: observation.mappingEvidenceSha256,
      },
      provenance: observation.provenance,
      flags: {
        effectful: (observation.run.sideEffectMask & ~TextRunEffect.cursor) !== 0,
        customFont: (observation.run.reasonMask & TextRunReason.customFont) !== 0,
        inlineGlyph: (observation.run.reasonMask & TextRunReason.inlineGlyph) !== 0,
        buttonGlyph: observation.contentKind === "button-glyph",
        ambiguousMapping: (observation.run.reasonMask & TextRunReason.ambiguousMapping) !== 0,
      },
      mapping,
    };
  }).sort((left, right) => inventoryRunKey(left).localeCompare(inventoryRunKey(right)) || left.id.localeCompare(right.id));
  const inventory: TextInventoryV1 = {
    schemaVersion: TEXT_INVENTORY_SCHEMA_VERSION,
    status: options.status ?? "draft",
    gameId: options.gameId,
    sourceSha256: options.sourceSha256,
    runs,
  };
  const result = validateTextInventory(inventory);
  if (!result.valid) throw new TypeError(`Invalid reachable text inventory:\n- ${result.errors.join("\n- ")}`);
  return inventory;
}

/**
 * Runtime allow-list for accepted HD text. It binds the inventory to the exact
 * game bytes and resolves by update, semantic sequence, and raw P8SCII bytes.
 */
export function createCompleteHdTextApprovalResolver(
  value: unknown,
  expected: Readonly<{ gameId: string; sourceSha256: string }>,
): CompleteHdTextApprovalResolver {
  const validation = validateTextInventory(value);
  if (!validation.valid) throw new TypeError(`Invalid HD text inventory:\n- ${validation.errors.join("\n- ")}`);
  const inventory = value as TextInventoryV1;
  if (inventory.status !== "complete-for-hd") throw new TypeError("HD text inventory must be complete-for-hd");
  if (inventory.gameId !== expected.gameId || inventory.sourceSha256 !== expected.sourceSha256) {
    throw new TypeError("HD text inventory does not match the active game bytes");
  }
  const approvals = new Map<string, CompleteHdTextApproval>();
  for (const run of inventory.runs) {
    if (run.mapping.kind !== "bundled-font") continue;
    const key = inventoryRunKey(run);
    if (approvals.has(key)) throw new TypeError(`HD text inventory has ambiguous runtime locator ${key}`);
    approvals.set(key, { inventoryRunId: run.id, role: run.mapping.role });
  }
  return { resolve: (run) => approvals.get(runKey(run)) };
}

export interface HdTextFrameCompleteness {
  readonly accepted: boolean;
  readonly violations: readonly string[];
}

export function assessHdTextFrame(measurements: Readonly<{
  textCount: number;
  safeTextCount: number;
  blockedTextCount: number;
  mismatchedTextCount: number;
  unapprovedTextCount: number;
}>): HdTextFrameCompleteness {
  const violations: string[] = [];
  if (measurements.safeTextCount !== measurements.textCount) violations.push("not every source text run was consumed by an approved HD mapping");
  if (measurements.blockedTextCount !== 0) violations.push("blocked text runs are present");
  if (measurements.mismatchedTextCount !== 0) violations.push("text-run IR and draw commands do not correspond exactly");
  if (measurements.unapprovedTextCount !== 0) violations.push("text runs outside the complete inventory are present");
  return { accepted: violations.length === 0, violations };
}
