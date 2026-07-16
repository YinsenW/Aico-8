import { validateTextInventory, type TextInventoryV1 } from "./typography.js";

export const TEXT_COMPLETENESS_AUDIT_SCHEMA_VERSION = "aico8.text-completeness-audit.v1" as const;

export interface HdTextFrameObservationV1 {
  readonly update: number;
  readonly sceneId: string;
  readonly sourceTextRunCount: number;
  readonly approvedTextRunCount: number;
  readonly blockedTextRunCount: number;
  readonly mismatchedTextRunCount: number;
  readonly unapprovedTextRunCount: number;
}

export interface TextCompletenessAuditV1 {
  readonly schemaVersion: typeof TEXT_COMPLETENESS_AUDIT_SCHEMA_VERSION;
  readonly status: "draft" | "accepted";
  readonly gameId: string;
  readonly sourceSha256: string;
  readonly inventorySha256: string;
  readonly inventoryStatus: "draft" | "complete-for-hd";
  readonly totalLogicalUpdates: number;
  readonly observationRuns: readonly Readonly<{
    id: string;
    kind: "canonical-replay" | "reachable-state-probe";
    startUpdate: number;
    endUpdateExclusive: number;
  }>[];
  readonly totals: Readonly<{
    sourceTextRuns: number;
    approvedTextRuns: number;
    blockedTextRuns: number;
    mismatchedTextRuns: number;
    unapprovedTextRuns: number;
  }>;
  readonly failingUpdateIds: readonly number[];
  readonly regressions: readonly Readonly<{
    id: string;
    category: "deleted-inventory-mapping" | "stale-source-inventory" | "text-ir-mismatch";
    rejected: true;
  }>[];
}

export interface TextCompletenessAuditValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

const idPattern = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const countKeys = [
  "sourceTextRunCount",
  "approvedTextRunCount",
  "blockedTextRunCount",
  "mismatchedTextRunCount",
  "unapprovedTextRunCount",
] as const;

function frameErrors(frames: readonly HdTextFrameObservationV1[]): string[] {
  const errors: string[] = [];
  for (const [index, frame] of frames.entries()) {
    if (frame.update !== index) errors.push(`frames[${index}].update must equal ${index}`);
    if (!idPattern.test(frame.sceneId)) errors.push(`frames[${index}].sceneId is invalid`);
    for (const key of countKeys) {
      if (!Number.isSafeInteger(frame[key]) || frame[key] < 0) errors.push(`frames[${index}].${key} must be a non-negative integer`);
    }
    if (frame.approvedTextRunCount > frame.sourceTextRunCount) {
      errors.push(`frames[${index}].approvedTextRunCount cannot exceed sourceTextRunCount`);
    }
  }
  return errors;
}

export function buildTextCompletenessAudit(options: Readonly<{
  inventory: TextInventoryV1;
  inventorySha256: string;
  frames: readonly HdTextFrameObservationV1[];
  observationRuns: TextCompletenessAuditV1["observationRuns"];
  status?: "draft" | "accepted";
  regressions?: TextCompletenessAuditV1["regressions"];
}>): TextCompletenessAuditV1 {
  const errors = frameErrors(options.frames);
  if (errors.length > 0) throw new TypeError(`Invalid HD text frame observations:\n- ${errors.join("\n- ")}`);
  const totals = {
    sourceTextRuns: 0,
    approvedTextRuns: 0,
    blockedTextRuns: 0,
    mismatchedTextRuns: 0,
    unapprovedTextRuns: 0,
  };
  const failingUpdateIds: number[] = [];
  for (const frame of options.frames) {
    totals.sourceTextRuns += frame.sourceTextRunCount;
    totals.approvedTextRuns += frame.approvedTextRunCount;
    totals.blockedTextRuns += frame.blockedTextRunCount;
    totals.mismatchedTextRuns += frame.mismatchedTextRunCount;
    totals.unapprovedTextRuns += frame.unapprovedTextRunCount;
    if (frame.approvedTextRunCount !== frame.sourceTextRunCount
      || frame.blockedTextRunCount !== 0
      || frame.mismatchedTextRunCount !== 0
      || frame.unapprovedTextRunCount !== 0) failingUpdateIds.push(frame.update);
  }
  return {
    schemaVersion: TEXT_COMPLETENESS_AUDIT_SCHEMA_VERSION,
    status: options.status ?? "draft",
    gameId: options.inventory.gameId,
    sourceSha256: options.inventory.sourceSha256,
    inventorySha256: options.inventorySha256,
    inventoryStatus: options.inventory.status,
    totalLogicalUpdates: options.frames.length,
    observationRuns: options.observationRuns,
    totals,
    failingUpdateIds,
    regressions: options.regressions ?? [],
  };
}

export function validateTextCompletenessAudit(
  value: unknown,
  inventory?: TextInventoryV1,
): TextCompletenessAuditValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { valid: false, errors: ["$ must be an object"] };
  const audit = value as Partial<TextCompletenessAuditV1>;
  const accepted = audit.status === "accepted";
  if (audit.schemaVersion !== TEXT_COMPLETENESS_AUDIT_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${TEXT_COMPLETENESS_AUDIT_SCHEMA_VERSION}`);
  if (!accepted && audit.status !== "draft") errors.push("$.status must be draft or accepted");
  if (typeof audit.gameId !== "string" || !idPattern.test(audit.gameId)) errors.push("$.gameId is invalid");
  for (const key of ["sourceSha256", "inventorySha256"] as const) {
    if (typeof audit[key] !== "string" || !hashPattern.test(audit[key]!)) errors.push(`$.${key} is invalid`);
  }
  if (audit.inventoryStatus !== "draft" && audit.inventoryStatus !== "complete-for-hd") errors.push("$.inventoryStatus is invalid");
  if (accepted && audit.inventoryStatus !== "complete-for-hd") errors.push("$.inventoryStatus must be complete-for-hd before acceptance");
  if (!Number.isSafeInteger(audit.totalLogicalUpdates) || (audit.totalLogicalUpdates ?? 0) <= 0) errors.push("$.totalLogicalUpdates must be positive");

  if (!Array.isArray(audit.observationRuns) || audit.observationRuns.length === 0) errors.push("$.observationRuns is required");
  else {
    let nextStart = 0;
    const ids = new Set<string>();
    for (const [index, run] of audit.observationRuns.entries()) {
      if (!idPattern.test(run.id) || ids.has(run.id)) errors.push(`$.observationRuns[${index}].id is invalid or duplicate`);
      ids.add(run.id);
      if (run.kind !== "canonical-replay" && run.kind !== "reachable-state-probe") errors.push(`$.observationRuns[${index}].kind is invalid`);
      if (run.startUpdate !== nextStart || !Number.isSafeInteger(run.endUpdateExclusive) || run.endUpdateExclusive <= run.startUpdate) {
        errors.push(`$.observationRuns[${index}] must form a non-empty contiguous range`);
      }
      nextStart = run.endUpdateExclusive;
    }
    if (audit.observationRuns[0]?.kind !== "canonical-replay") errors.push("$.observationRuns[0] must be canonical-replay");
    if (nextStart !== audit.totalLogicalUpdates) errors.push("$.observationRuns must cover totalLogicalUpdates exactly");
  }

  const totals = audit.totals;
  if (!totals || typeof totals !== "object") errors.push("$.totals is required");
  else {
    for (const key of ["sourceTextRuns", "approvedTextRuns", "blockedTextRuns", "mismatchedTextRuns", "unapprovedTextRuns"] as const) {
      if (!Number.isSafeInteger(totals[key]) || totals[key] < 0) errors.push(`$.totals.${key} must be a non-negative integer`);
    }
    if (totals.approvedTextRuns > totals.sourceTextRuns) errors.push("$.totals.approvedTextRuns cannot exceed sourceTextRuns");
    if (accepted && totals.approvedTextRuns !== totals.sourceTextRuns) errors.push("$.totals must approve every source text run before acceptance");
    for (const key of ["blockedTextRuns", "mismatchedTextRuns", "unapprovedTextRuns"] as const) {
      if (accepted && totals[key] !== 0) errors.push(`$.totals.${key} must be zero before acceptance`);
    }
  }
  if (!Array.isArray(audit.failingUpdateIds)
    || new Set(audit.failingUpdateIds).size !== audit.failingUpdateIds.length
    || audit.failingUpdateIds.some((update) => !Number.isSafeInteger(update) || update < 0 || update >= (audit.totalLogicalUpdates ?? 0))) {
    errors.push("$.failingUpdateIds is invalid");
  } else if (accepted && audit.failingUpdateIds.length !== 0) errors.push("$.failingUpdateIds must be empty before acceptance");

  const requiredRegressions = new Set(["deleted-inventory-mapping", "stale-source-inventory", "text-ir-mismatch"]);
  if (!Array.isArray(audit.regressions)) errors.push("$.regressions is required");
  else if (accepted) for (const category of requiredRegressions) {
    if (!audit.regressions.some((regression) => regression.category === category && regression.rejected === true)) {
      errors.push(`$.regressions must prove rejection of ${category}`);
    }
  }

  if (inventory) {
    const inventoryValidation = validateTextInventory(inventory);
    if (!inventoryValidation.valid) errors.push("provided text inventory is invalid");
    if (audit.gameId !== inventory.gameId) errors.push("$.gameId does not match the text inventory");
    if (audit.sourceSha256 !== inventory.sourceSha256) errors.push("$.sourceSha256 does not match the text inventory");
    if (audit.inventoryStatus !== inventory.status) errors.push("$.inventoryStatus does not match the text inventory");
    if (accepted && inventory.status !== "complete-for-hd") errors.push("provided text inventory is not complete-for-hd");
  }
  return { valid: errors.length === 0, errors };
}

export function assertTextCompletenessAudit(value: unknown, inventory?: TextInventoryV1): asserts value is TextCompletenessAuditV1 {
  const result = validateTextCompletenessAudit(value, inventory);
  if (!result.valid) throw new TypeError(`Invalid HD text completeness audit:\n- ${result.errors.join("\n- ")}`);
}
