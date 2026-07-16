import {
  SUPERVISED_TRANSFER_STOP_IDS,
  type FinalScopeDisposition,
  type SupervisedTransferStopId,
} from "./human-stop-decision.js";

export const SUPERVISED_REVIEW_PROPOSAL_SCHEMA_VERSION = "aico8.supervised-review-proposal.v1" as const;

export const REQUIRED_REVIEW_CRITERIA = {
  "semantic-intent": ["source-roles", "state-meanings", "identity-elements", "motion-cues", "known-unknowns"],
  "art-direction": ["spirit-fidelity", "quality-leap", "aesthetic-evolution", "complete-visual-grammar"],
  "representative-gameplay": ["same-state-coverage", "temporal-coverage", "interaction-coverage", "hd-state-invariance"],
  "final-scope": ["declared-coverage", "remaining-limitations", "rights-boundary", "scope-disposition"],
} as const satisfies Record<SupervisedTransferStopId, readonly string[]>;

export const REQUIRED_FORBIDDEN_CLAIMS = [
  "complete-game-reviewed",
  "portable-ledger-accepted",
  "release-ready",
  "publication-authorized",
] as const;

export interface SupervisedReviewEvidenceV1 {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly description: string;
}

export interface SupervisedReviewItemV1 {
  readonly criterionId: string;
  readonly question: string;
  readonly evidenceIds: readonly string[];
}

export interface SupervisedReviewProposalV1 {
  readonly schemaVersion: typeof SUPERVISED_REVIEW_PROPOSAL_SCHEMA_VERSION;
  readonly proposalId: string;
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly authorityProfileSha256: string;
  readonly stopId: SupervisedTransferStopId;
  readonly attempt: number;
  readonly upstreamDecisionSha256: string | null;
  readonly previousProposalSha256: string | null;
  readonly previousRevisionDecisionSha256: string | null;
  readonly title: string;
  readonly summary: string;
  readonly evidence: readonly SupervisedReviewEvidenceV1[];
  readonly reviewItems: readonly SupervisedReviewItemV1[];
  readonly limitations: readonly string[];
  readonly authorityLimits: {
    readonly agentMayApprove: false;
    readonly agentMaySign: false;
    readonly agentMayAuthorizeFullValidation: false;
    readonly agentMayRelease: false;
  };
  readonly forbiddenClaims: readonly typeof REQUIRED_FORBIDDEN_CLAIMS[number][];
  readonly scopeDispositionOptions: readonly FinalScopeDisposition[];
}

export interface SupervisedReviewProposalValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const SAFE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;

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

function idValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !ID.test(value)) errors.push(`${path} must be a valid id`);
  return typeof value === "string" && ID.test(value);
}

function hashOrNull(value: unknown, path: string, errors: string[]): void {
  if (value !== null && (typeof value !== "string" || !HASH.test(value))) {
    errors.push(`${path} must be null or a lowercase SHA-256 digest`);
  }
}

function substantive(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.trim().length < 8) errors.push(`${path} must contain a substantive explanation`);
}

function uniqueStrings(value: unknown, path: string, errors: string[], minimum: number): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  if (value.length < minimum) errors.push(`${path} must contain at least ${minimum} item(s)`);
  const result: string[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (typeof item !== "string" || item.trim().length < 8) errors.push(`${path}[${index}] must be substantive text`);
    else if (seen.has(item)) errors.push(`${path}[${index}] must be unique`);
    else { seen.add(item); result.push(item); }
  });
  return result;
}

export function validateSupervisedReviewProposal(value: unknown): SupervisedReviewProposalValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "proposalId", "jobId", "gameId", "transferInstanceId", "sourceIdentitySha256",
    "targetProfileSha256", "authorityProfileSha256", "stopId", "attempt", "upstreamDecisionSha256",
    "previousProposalSha256", "previousRevisionDecisionSha256", "title", "summary", "evidence",
    "reviewItems", "limitations", "authorityLimits", "forbiddenClaims", "scopeDispositionOptions",
  ], "$", errors);
  if (root.schemaVersion !== SUPERVISED_REVIEW_PROPOSAL_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${SUPERVISED_REVIEW_PROPOSAL_SCHEMA_VERSION}`);
  }
  for (const key of ["proposalId", "jobId", "gameId"] as const) idValue(root[key], `$.${key}`, errors);
  if (typeof root.transferInstanceId !== "string" || !NONCE.test(root.transferInstanceId)) {
    errors.push("$.transferInstanceId must be base64url entropy");
  }
  for (const key of ["sourceIdentitySha256", "targetProfileSha256", "authorityProfileSha256"] as const) {
    if (typeof root[key] !== "string" || !HASH.test(root[key] as string)) errors.push(`$.${key} must be a lowercase SHA-256 digest`);
  }
  const stopId = root.stopId as SupervisedTransferStopId;
  if (!SUPERVISED_TRANSFER_STOP_IDS.includes(stopId)) errors.push("$.stopId is unsupported");
  if (!Number.isSafeInteger(root.attempt) || (root.attempt as number) < 1) errors.push("$.attempt must be a positive integer");
  hashOrNull(root.upstreamDecisionSha256, "$.upstreamDecisionSha256", errors);
  hashOrNull(root.previousProposalSha256, "$.previousProposalSha256", errors);
  hashOrNull(root.previousRevisionDecisionSha256, "$.previousRevisionDecisionSha256", errors);
  if (root.attempt === 1 && (root.previousProposalSha256 !== null || root.previousRevisionDecisionSha256 !== null)) {
    errors.push("$.previous proposal and revision decision must be null on attempt 1");
  }
  if (typeof root.attempt === "number" && root.attempt > 1
    && (root.previousProposalSha256 === null || root.previousRevisionDecisionSha256 === null)) {
    errors.push("$.previous proposal and revision decision are required after attempt 1");
  }
  substantive(root.title, "$.title", errors);
  substantive(root.summary, "$.summary", errors);

  const evidenceIds = new Set<string>();
  if (!Array.isArray(root.evidence) || root.evidence.length === 0) errors.push("$.evidence must be a non-empty array");
  else root.evidence.forEach((value, index) => {
    const path = `$.evidence[${index}]`;
    const item = record(value, path, errors);
    if (!item) return;
    exactKeys(item, ["id", "path", "sha256", "description"], path, errors);
    if (idValue(item.id, `${path}.id`, errors)) {
      if (evidenceIds.has(item.id as string)) errors.push(`${path}.id must be unique`);
      evidenceIds.add(item.id as string);
    }
    if (typeof item.path !== "string" || !SAFE_PATH.test(item.path)) errors.push(`${path}.path must be a safe relative path`);
    if (typeof item.sha256 !== "string" || !HASH.test(item.sha256)) errors.push(`${path}.sha256 must be a lowercase SHA-256 digest`);
    substantive(item.description, `${path}.description`, errors);
  });

  const criterionIds = new Set<string>();
  if (!Array.isArray(root.reviewItems) || root.reviewItems.length === 0) errors.push("$.reviewItems must be a non-empty array");
  else root.reviewItems.forEach((value, index) => {
    const path = `$.reviewItems[${index}]`;
    const item = record(value, path, errors);
    if (!item) return;
    exactKeys(item, ["criterionId", "question", "evidenceIds"], path, errors);
    if (idValue(item.criterionId, `${path}.criterionId`, errors)) {
      if (criterionIds.has(item.criterionId as string)) errors.push(`${path}.criterionId must be unique`);
      criterionIds.add(item.criterionId as string);
    }
    substantive(item.question, `${path}.question`, errors);
    if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0) errors.push(`${path}.evidenceIds must be non-empty`);
    else {
      const seen = new Set<string>();
      item.evidenceIds.forEach((id, evidenceIndex) => {
        if (typeof id !== "string" || !evidenceIds.has(id)) errors.push(`${path}.evidenceIds[${evidenceIndex}] must reference declared evidence`);
        else if (seen.has(id)) errors.push(`${path}.evidenceIds[${evidenceIndex}] must be unique`);
        else seen.add(id);
      });
    }
  });
  if (SUPERVISED_TRANSFER_STOP_IDS.includes(stopId)) {
    for (const criterion of REQUIRED_REVIEW_CRITERIA[stopId]) {
      if (!criterionIds.has(criterion)) errors.push(`$.reviewItems must include ${criterion} for ${stopId}`);
    }
  }
  uniqueStrings(root.limitations, "$.limitations", errors, 1);
  const authorityLimits = record(root.authorityLimits, "$.authorityLimits", errors);
  if (authorityLimits) {
    exactKeys(authorityLimits, [
      "agentMayApprove", "agentMaySign", "agentMayAuthorizeFullValidation", "agentMayRelease",
    ], "$.authorityLimits", errors);
    for (const key of ["agentMayApprove", "agentMaySign", "agentMayAuthorizeFullValidation", "agentMayRelease"] as const) {
      if (authorityLimits[key] !== false) errors.push(`$.authorityLimits.${key} must equal false`);
    }
  }
  if (!Array.isArray(root.forbiddenClaims)
    || !isSameSet(root.forbiddenClaims, REQUIRED_FORBIDDEN_CLAIMS)) {
    errors.push("$.forbiddenClaims must contain exactly the four required claim limits");
  }
  const expectedScope = stopId === "final-scope" ? ["retain-supervised-trial", "authorize-full-validation"] : [];
  if (!Array.isArray(root.scopeDispositionOptions) || !isSameSet(root.scopeDispositionOptions, expectedScope)) {
    errors.push(`$.scopeDispositionOptions must ${stopId === "final-scope" ? "contain both final dispositions" : "be empty outside final-scope"}`);
  }
  return { valid: errors.length === 0, errors };
}

function isSameSet(actual: readonly unknown[], expected: readonly string[]): boolean {
  const values = actual.filter((item): item is string => typeof item === "string");
  return values.length === expected.length
    && new Set(values).size === expected.length
    && expected.every((item) => values.includes(item));
}

export function assertSupervisedReviewProposal(value: unknown): asserts value is SupervisedReviewProposalV1 {
  const result = validateSupervisedReviewProposal(value);
  if (!result.valid) throw new TypeError(`Invalid supervised review proposal:\n${result.errors.join("\n")}`);
}
