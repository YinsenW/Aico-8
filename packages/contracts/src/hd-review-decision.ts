import {
  assertHdIdentityMap,
  type HdIdentityMapV1,
} from "./hd-identity-map.ts";
import {
  HD_REVIEW_CHECK_NAMES,
  HD_REVIEW_PRINCIPLE_GATES,
  PENDING_HD_REVIEWER,
  validateHdReviewPacket,
} from "./hd-review-packet.ts";

export const HD_REVIEW_DECISION_SCHEMA_VERSION = "aico8.hd-review-decision.v1" as const;

export interface HdReviewDecisionV1 {
  schemaVersion: typeof HD_REVIEW_DECISION_SCHEMA_VERSION;
  gameId: string;
  decision: "accepted";
  reviewer: string;
  acceptanceStatement: string;
  reviewedPacket: {
    path: string;
    sha256: string;
    documentPath: string;
    documentSha256: string;
    visualRuntimeSha256: string;
    replaySemanticsSha256: string;
    identityMapSha256: string;
    browserEvidenceSha256: string;
  };
  elementIds: string[];
  checkNames: (typeof HD_REVIEW_CHECK_NAMES)[number][];
  principleGates: Array<{
    id: (typeof HD_REVIEW_PRINCIPLE_GATES)[number]["id"];
    verdict: "passed";
  }>;
}

export interface HdReviewDecisionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;

function record(value: unknown, path: string, errors: string[]): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], path: string, errors: string[]): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function stringValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function idValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    errors.push(`${path} must be a valid ID`);
    return false;
  }
  return true;
}

function hashValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 digest`);
    return false;
  }
  return true;
}

function safeRelativePath(value: unknown, path: string, errors: string[]): value is string {
  if (!stringValue(value, path, errors)) return false;
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  return true;
}

function idList(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return [];
  }
  const ids: string[] = [];
  value.forEach((item, index) => {
    if (idValue(item, `${path}[${index}]`, errors)) ids.push(item);
  });
  if (new Set(ids).size !== ids.length) errors.push(`${path} must not contain duplicates`);
  return ids;
}

function checkNameList(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const names: string[] = [];
  value.forEach((item, index) => {
    if (!stringValue(item, `${path}[${index}]`, errors)) return;
    if (!HD_REVIEW_CHECK_NAMES.includes(item as (typeof HD_REVIEW_CHECK_NAMES)[number])) {
      errors.push(`${path}[${index}] is not a known review check`);
      return;
    }
    names.push(item);
  });
  if (JSON.stringify(names) !== JSON.stringify(HD_REVIEW_CHECK_NAMES)) {
    errors.push(`${path} must contain every review check exactly once in contract order`);
  }
  return names;
}

function principleGateList(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length !== HD_REVIEW_PRINCIPLE_GATES.length) {
    errors.push(`${path} must contain every principle gate exactly once in contract order`);
    return [];
  }
  const ids: string[] = [];
  HD_REVIEW_PRINCIPLE_GATES.forEach((expected, index) => {
    const itemPath = `${path}[${index}]`;
    const gate = record(value[index], itemPath, errors);
    if (!gate) return;
    exactKeys(gate, ["id", "verdict"], itemPath, errors);
    if (gate.id !== expected.id) errors.push(`${itemPath}.id must equal ${expected.id}`);
    if (gate.verdict !== "passed") errors.push(`${itemPath}.verdict must equal passed`);
    if (typeof gate.id === "string") ids.push(gate.id);
  });
  return ids;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateHdReviewDecision(
  value: unknown,
  reviewedPacket?: unknown,
): HdReviewDecisionValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "gameId", "decision", "reviewer", "acceptanceStatement",
    "reviewedPacket", "elementIds", "checkNames", "principleGates",
  ], "$", errors);
  if (root.schemaVersion !== HD_REVIEW_DECISION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${HD_REVIEW_DECISION_SCHEMA_VERSION}`);
  }
  const gameId = idValue(root.gameId, "$.gameId", errors) ? root.gameId as string : undefined;
  if (root.decision !== "accepted") errors.push("$.decision must equal accepted");
  const reviewer = stringValue(root.reviewer, "$.reviewer", errors) ? root.reviewer as string : undefined;
  if (reviewer === PENDING_HD_REVIEWER) errors.push("$.reviewer must identify the human reviewer");
  const acceptanceStatement = stringValue(root.acceptanceStatement, "$.acceptanceStatement", errors)
    ? root.acceptanceStatement as string : undefined;
  const elementIds = idList(root.elementIds, "$.elementIds", errors);
  checkNameList(root.checkNames, "$.checkNames", errors);
  const principleGateIds = principleGateList(root.principleGates, "$.principleGates", errors);

  const lineage = record(root.reviewedPacket, "$.reviewedPacket", errors);
  if (lineage) {
    const lineageKeys = [
      "path", "sha256", "documentPath", "documentSha256", "visualRuntimeSha256",
      "replaySemanticsSha256", "identityMapSha256", "browserEvidenceSha256",
    ];
    exactKeys(lineage, lineageKeys, "$.reviewedPacket", errors);
    safeRelativePath(lineage.path, "$.reviewedPacket.path", errors);
    safeRelativePath(lineage.documentPath, "$.reviewedPacket.documentPath", errors);
    for (const key of lineageKeys.filter((key) => key.endsWith("Sha256") || key === "sha256")) {
      hashValue(lineage[key], `$.reviewedPacket.${key}`, errors);
    }
  }

  if (reviewedPacket !== undefined) {
    const packetValidation = validateHdReviewPacket(reviewedPacket);
    if (!packetValidation.valid) {
      errors.push(...packetValidation.errors.map((error) => `reviewed packet ${error}`));
    } else {
      const packet = reviewedPacket as JsonRecord;
      if (packet.status !== "pending-human-side-by-side-review") {
        errors.push("reviewed packet must still be pending when the human decision is recorded");
      }
      if (packet.reviewer !== PENDING_HD_REVIEWER) {
        errors.push("reviewed packet must retain the pending reviewer before the decision");
      }
      if (packet.reviewDecision !== null) {
        errors.push("reviewed packet must not already reference a review decision");
      }
      if (gameId && packet.gameId !== gameId) errors.push("reviewed packet game must match the decision");
      if (acceptanceStatement && packet.acceptanceStatement !== acceptanceStatement) {
        errors.push("reviewed packet acceptance statement must match the decision");
      }
      const packetPrincipleGateIds = (packet.principleGates as JsonRecord[]).map((gate) => gate.id as string);
      if (!sameStrings(principleGateIds, packetPrincipleGateIds)) {
        errors.push("reviewed packet principle gates must match the decision in contract order");
      }
      const packetElements = packet.elements as JsonRecord[];
      const packetElementIds = packetElements.map((element) => element.id as string);
      if (!sameStrings(elementIds, packetElementIds)) {
        errors.push("reviewed packet element IDs must match the decision in contract order");
      }
      for (const element of packetElements) {
        const review = element.review as JsonRecord;
        if (review.reviewer !== PENDING_HD_REVIEWER) {
          errors.push(`reviewed packet ${String(element.id)} reviewer must remain pending`);
        }
        for (const name of HD_REVIEW_CHECK_NAMES) {
          if (review[name] !== false) {
            errors.push(`reviewed packet ${String(element.id)}.${name} must remain false before the atomic decision`);
          }
        }
      }
      if (lineage) {
        const comparisons: Array<[string, unknown]> = [
          ["visual runtime", packet.visualRuntimeSha256],
          ["replay semantics", packet.replaySemanticsSha256],
          ["identity map", packet.identityMapSha256],
          ["browser evidence", packet.browserEvidenceSha256],
          ["review document", (packet.document as JsonRecord).sha256],
        ];
        const lineageKeys = [
          "visualRuntimeSha256", "replaySemanticsSha256", "identityMapSha256",
          "browserEvidenceSha256", "documentSha256",
        ];
        comparisons.forEach(([label, packetValue], index) => {
          if (lineage[lineageKeys[index]!] !== packetValue) {
            errors.push(`reviewed packet ${label} must match the decision lineage`);
          }
        });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function promoteHdIdentityMapFromReview(options: {
  readonly draftIdentityMap: unknown;
  readonly draftIdentityMapSha256: string;
  readonly decision: unknown;
  readonly reviewedPacket: unknown;
}): HdIdentityMapV1 {
  const decisionValidation = validateHdReviewDecision(options.decision, options.reviewedPacket);
  if (!decisionValidation.valid) {
    throw new TypeError(`Invalid HD review decision:\n- ${decisionValidation.errors.join("\n- ")}`);
  }
  assertHdIdentityMap(options.draftIdentityMap);
  if (options.draftIdentityMap.status !== "draft") {
    throw new TypeError("HD identity map must be a deterministic draft before review promotion");
  }
  const decision = options.decision as HdReviewDecisionV1;
  if (options.draftIdentityMapSha256 !== decision.reviewedPacket.identityMapSha256) {
    throw new TypeError("Rebuilt draft identity map hash differs from the reviewed packet");
  }
  if (options.draftIdentityMap.gameId !== decision.gameId) {
    throw new TypeError("Rebuilt draft identity map game differs from the review decision");
  }
  const draftElementIds = options.draftIdentityMap.elements.map(({ id }) => id);
  if (!sameStrings(draftElementIds, decision.elementIds)) {
    throw new TypeError("Rebuilt draft identity elements differ from the review decision");
  }
  const accepted = structuredClone(options.draftIdentityMap);
  accepted.status = "accepted";
  for (const element of accepted.elements) {
    element.review.reviewer = decision.reviewer;
    for (const name of HD_REVIEW_CHECK_NAMES) element.review[name] = true;
  }
  assertHdIdentityMap(accepted);
  return accepted;
}
