import {
  SUPERVISED_TRANSFER_STOP_IDS,
  type FinalScopeDisposition,
  type HumanStopOutcome,
  type SupervisedTransferStopId,
} from "./human-stop-decision.js";
import type { SupervisedTransferV1 } from "./supervised-transfer.js";

export const HUMAN_STOP_REQUEST_SCHEMA_VERSION = "aico8.human-stop-request.v1" as const;

export interface HumanStopRequestV1 {
  readonly schemaVersion: typeof HUMAN_STOP_REQUEST_SCHEMA_VERSION;
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly authorityProfileSha256: string;
  readonly stopId: SupervisedTransferStopId;
  readonly attempt: number;
  readonly proposalPath: string;
  readonly proposalSha256: string;
  readonly priorDecisionSha256: string | null;
  readonly nonce: string;
  readonly trustedReviewerKeyIds: readonly string[];
  readonly allowedOutcomes: readonly HumanStopOutcome[];
  readonly allowedScopeDispositions: readonly FinalScopeDisposition[];
  readonly agentMaySign: false;
}

export interface HumanStopRequestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const SAFE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const OUTCOMES = ["approved", "revision-requested"] as const;
const SCOPE_DISPOSITIONS = ["retain-supervised-trial", "authorize-full-validation"] as const;

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

function exactStringArray(value: unknown, expected: readonly string[], path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])) {
    errors.push(`${path} must equal ${JSON.stringify(expected)}`);
  }
}

export function validateHumanStopRequest(value: unknown): HumanStopRequestValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "jobId", "gameId", "transferInstanceId", "sourceIdentitySha256",
    "targetProfileSha256", "authorityProfileSha256", "stopId", "attempt", "proposalPath",
    "proposalSha256", "priorDecisionSha256", "nonce", "trustedReviewerKeyIds",
    "allowedOutcomes", "allowedScopeDispositions", "agentMaySign",
  ], "$", errors);
  if (root.schemaVersion !== HUMAN_STOP_REQUEST_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${HUMAN_STOP_REQUEST_SCHEMA_VERSION}`);
  }
  for (const key of ["jobId", "gameId"] as const) {
    if (typeof root[key] !== "string" || !ID.test(root[key])) errors.push(`$.${key} must be a valid id`);
  }
  if (typeof root.transferInstanceId !== "string" || !NONCE.test(root.transferInstanceId)) {
    errors.push("$.transferInstanceId must be base64url entropy");
  }
  for (const key of ["sourceIdentitySha256", "targetProfileSha256", "authorityProfileSha256", "proposalSha256"] as const) {
    if (typeof root[key] !== "string" || !HASH.test(root[key])) errors.push(`$.${key} must be a lowercase SHA-256 digest`);
  }
  if (!SUPERVISED_TRANSFER_STOP_IDS.includes(root.stopId as SupervisedTransferStopId)) {
    errors.push("$.stopId is unsupported");
  }
  if (!Number.isSafeInteger(root.attempt) || (root.attempt as number) < 1) errors.push("$.attempt must be a positive integer");
  if (typeof root.proposalPath !== "string" || !SAFE_PATH.test(root.proposalPath)) {
    errors.push("$.proposalPath must be a safe relative path");
  }
  if (root.priorDecisionSha256 !== null
    && (typeof root.priorDecisionSha256 !== "string" || !HASH.test(root.priorDecisionSha256))) {
    errors.push("$.priorDecisionSha256 must be null or a lowercase SHA-256 digest");
  }
  if (typeof root.nonce !== "string" || !NONCE.test(root.nonce)) errors.push("$.nonce must be base64url entropy");
  if (!Array.isArray(root.trustedReviewerKeyIds) || root.trustedReviewerKeyIds.length === 0) {
    errors.push("$.trustedReviewerKeyIds must be a non-empty array");
  } else {
    const seen = new Set<string>();
    root.trustedReviewerKeyIds.forEach((value, index) => {
      if (typeof value !== "string" || !ID.test(value)) errors.push(`$.trustedReviewerKeyIds[${index}] must be a valid id`);
      if (seen.has(value as string)) errors.push(`$.trustedReviewerKeyIds[${index}] must be unique`);
      seen.add(value as string);
    });
  }
  exactStringArray(root.allowedOutcomes, OUTCOMES, "$.allowedOutcomes", errors);
  exactStringArray(
    root.allowedScopeDispositions,
    root.stopId === "final-scope" ? SCOPE_DISPOSITIONS : [],
    "$.allowedScopeDispositions",
    errors,
  );
  if (root.agentMaySign !== false) errors.push("$.agentMaySign must equal false");
  return { valid: errors.length === 0, errors };
}

export function createHumanStopRequest(job: SupervisedTransferV1): HumanStopRequestV1 {
  if (job.status !== "awaiting-human") throw new TypeError("Supervised transfer is not awaiting a human decision");
  const stop = job.stops.find(({ attempts }) => attempts.at(-1)?.decision === null);
  if (!stop) throw new TypeError("Supervised transfer has no pending human stop");
  const attempt = stop.attempts.at(-1)!;
  const request: HumanStopRequestV1 = {
    schemaVersion: HUMAN_STOP_REQUEST_SCHEMA_VERSION,
    jobId: job.jobId,
    gameId: job.gameId,
    transferInstanceId: job.transferInstanceId,
    sourceIdentitySha256: job.sourceIdentitySha256,
    targetProfileSha256: job.targetProfileSha256,
    authorityProfileSha256: job.authority.profileSha256,
    stopId: stop.id,
    attempt: attempt.attempt,
    proposalPath: attempt.proposal.path,
    proposalSha256: attempt.proposal.sha256,
    priorDecisionSha256: attempt.proposal.upstreamDecisionSha256,
    nonce: attempt.proposal.decisionNonce,
    trustedReviewerKeyIds: job.authority.trustedReviewerKeys.map(({ keyId }) => keyId),
    allowedOutcomes: [...OUTCOMES],
    allowedScopeDispositions: stop.id === "final-scope" ? [...SCOPE_DISPOSITIONS] : [],
    agentMaySign: false,
  };
  const validation = validateHumanStopRequest(request);
  if (!validation.valid) throw new TypeError(`Generated human stop request is invalid: ${validation.errors.join("; ")}`);
  return request;
}
