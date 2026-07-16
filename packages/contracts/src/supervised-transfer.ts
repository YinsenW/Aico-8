import {
  SUPERVISED_TRANSFER_STOP_IDS,
  verifyHumanStopDecision,
  type FinalScopeDisposition,
  type HumanDecisionTrustKey,
  type HumanStopDecisionV1,
  type HumanStopOutcome,
  type SupervisedTransferStopId,
} from "./human-stop-decision.ts";

export const SUPERVISED_TRANSFER_SCHEMA_VERSION = "aico8.supervised-transfer.v1" as const;

export type SupervisedTransferStatus =
  | "working"
  | "awaiting-human"
  | "revision-requested"
  | "trial-complete"
  | "full-validation-authorized";

export interface SupervisedProposalV1 {
  readonly path: string;
  readonly sha256: string;
  readonly upstreamDecisionSha256: string | null;
  readonly decisionNonce: string;
}

export interface SupervisedDecisionReferenceV1 {
  readonly path: string;
  readonly sha256: string;
  readonly outcome: HumanStopOutcome;
  readonly scopeDisposition: FinalScopeDisposition | null;
  readonly reviewerKeyId: string;
}

export interface SupervisedStopAttemptV1 {
  readonly attempt: number;
  readonly proposal: SupervisedProposalV1;
  readonly decision: SupervisedDecisionReferenceV1 | null;
}

export interface SupervisedTransferV1 {
  readonly schemaVersion: typeof SUPERVISED_TRANSFER_SCHEMA_VERSION;
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly status: SupervisedTransferStatus;
  readonly authority: {
    readonly profileId: string;
    readonly profileSha256: string;
    readonly decisionMode: "external-ed25519";
    readonly agentMayCreateDecision: false;
    readonly agentMayAccept: false;
    readonly agentMayRelease: false;
    readonly trustedReviewerKeys: readonly {
      readonly keyId: string;
      readonly publicKeySha256: string;
    }[];
  };
  readonly stops: readonly {
    readonly id: SupervisedTransferStopId;
    readonly order: 1 | 2 | 3 | 4;
    readonly attempts: readonly SupervisedStopAttemptV1[];
  }[];
}

export interface SupervisedTransferValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

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
  if (typeof value !== "string" || !ID.test(value)) {
    errors.push(`${path} must be a valid id`);
    return false;
  }
  return true;
}

function hashValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !HASH.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 digest`);
    return false;
  }
  return true;
}

function safePath(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/.test(value)) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  return true;
}

function derivedStatus(stops: readonly JsonRecord[]): SupervisedTransferStatus | undefined {
  for (const stop of stops) {
    const attempts = stop.attempts as JsonRecord[];
    if (attempts.length === 0) return "working";
    const last = attempts.at(-1)!;
    if (last.decision === null) return "awaiting-human";
    const decision = last.decision as JsonRecord;
    if (decision.outcome === "revision-requested") return "revision-requested";
  }
  const finalAttempt = (stops.at(-1)!.attempts as JsonRecord[]).at(-1)!;
  const finalDecision = finalAttempt.decision as JsonRecord;
  return finalDecision.scopeDisposition === "authorize-full-validation" ? "full-validation-authorized" : "trial-complete";
}

export function validateSupervisedTransfer(value: unknown): SupervisedTransferValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "jobId", "gameId", "transferInstanceId", "sourceIdentitySha256", "targetProfileSha256",
    "status", "authority", "stops",
  ], "$", errors);
  if (root.schemaVersion !== SUPERVISED_TRANSFER_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${SUPERVISED_TRANSFER_SCHEMA_VERSION}`);
  }
  idValue(root.jobId, "$.jobId", errors);
  idValue(root.gameId, "$.gameId", errors);
  if (typeof root.transferInstanceId !== "string" || !NONCE.test(root.transferInstanceId)) {
    errors.push("$.transferInstanceId must be base64url entropy");
  }
  hashValue(root.sourceIdentitySha256, "$.sourceIdentitySha256", errors);
  hashValue(root.targetProfileSha256, "$.targetProfileSha256", errors);

  const authority = record(root.authority, "$.authority", errors);
  const trustedKeyIds = new Set<string>();
  if (authority) {
    exactKeys(authority, [
      "profileId", "profileSha256", "decisionMode", "agentMayCreateDecision", "agentMayAccept", "agentMayRelease", "trustedReviewerKeys",
    ], "$.authority", errors);
    if (authority.decisionMode !== "external-ed25519") errors.push("$.authority.decisionMode must equal external-ed25519");
    idValue(authority.profileId, "$.authority.profileId", errors);
    hashValue(authority.profileSha256, "$.authority.profileSha256", errors);
    for (const key of ["agentMayCreateDecision", "agentMayAccept", "agentMayRelease"] as const) {
      if (authority[key] !== false) errors.push(`$.authority.${key} must equal false`);
    }
    if (!Array.isArray(authority.trustedReviewerKeys) || authority.trustedReviewerKeys.length === 0) {
      errors.push("$.authority.trustedReviewerKeys must be a non-empty array");
    } else authority.trustedReviewerKeys.forEach((value, index) => {
      const path = `$.authority.trustedReviewerKeys[${index}]`;
      const item = record(value, path, errors);
      if (!item) return;
      exactKeys(item, ["keyId", "publicKeySha256"], path, errors);
      if (idValue(item.keyId, `${path}.keyId`, errors)) {
        if (trustedKeyIds.has(item.keyId)) errors.push(`${path}.keyId must be unique`);
        trustedKeyIds.add(item.keyId);
      }
      hashValue(item.publicKeySha256, `${path}.publicKeySha256`, errors);
    });
  }

  if (!Array.isArray(root.stops) || root.stops.length !== SUPERVISED_TRANSFER_STOP_IDS.length) {
    errors.push("$.stops must contain exactly four supervised stops in contract order");
    return { valid: false, errors };
  }
  const stops = root.stops as unknown[];
  let previousApprovedDecisionSha: string | null = null;
  let priorStopApproved = true;
  const validatedStops: JsonRecord[] = [];
  SUPERVISED_TRANSFER_STOP_IDS.forEach((expectedId, stopIndex) => {
    const stopPath = `$.stops[${stopIndex}]`;
    const stop = record(stops[stopIndex], stopPath, errors);
    if (!stop) return;
    validatedStops.push(stop);
    exactKeys(stop, ["id", "order", "attempts"], stopPath, errors);
    if (stop.id !== expectedId) errors.push(`${stopPath}.id must equal ${expectedId}`);
    if (stop.order !== stopIndex + 1) errors.push(`${stopPath}.order must equal ${stopIndex + 1}`);
    if (!Array.isArray(stop.attempts)) {
      errors.push(`${stopPath}.attempts must be an array`);
      priorStopApproved = false;
      return;
    }
    const attempts = stop.attempts as unknown[];
    if (!priorStopApproved && attempts.length > 0) errors.push(`${stopPath} must remain empty until the prior stop is approved`);
    const proposalHashes = new Set<string>();
    let lastOutcome: HumanStopOutcome | undefined;
    attempts.forEach((attemptValue, attemptIndex) => {
      const path = `${stopPath}.attempts[${attemptIndex}]`;
      const attempt = record(attemptValue, path, errors);
      if (!attempt) return;
      exactKeys(attempt, ["attempt", "proposal", "decision"], path, errors);
      if (attempt.attempt !== attemptIndex + 1) errors.push(`${path}.attempt must equal ${attemptIndex + 1}`);
      if (attemptIndex > 0 && lastOutcome !== "revision-requested") {
        errors.push(`${path} requires a revision-requested prior attempt`);
      }
      const proposal = record(attempt.proposal, `${path}.proposal`, errors);
      if (proposal) {
        exactKeys(proposal, ["path", "sha256", "upstreamDecisionSha256", "decisionNonce"], `${path}.proposal`, errors);
        safePath(proposal.path, `${path}.proposal.path`, errors);
        if (hashValue(proposal.sha256, `${path}.proposal.sha256`, errors)) {
          if (proposalHashes.has(proposal.sha256)) errors.push(`${path}.proposal.sha256 must not reuse any prior proposal at this stop`);
          proposalHashes.add(proposal.sha256 as string);
        }
        if (proposal.upstreamDecisionSha256 !== previousApprovedDecisionSha) {
          errors.push(`${path}.proposal.upstreamDecisionSha256 must bind the latest approved upstream decision`);
        }
        if (typeof proposal.decisionNonce !== "string" || !NONCE.test(proposal.decisionNonce)) {
          errors.push(`${path}.proposal.decisionNonce must be base64url entropy`);
        }
      }
      if (attempt.decision === null) {
        if (attemptIndex !== attempts.length - 1) errors.push(`${path}.decision may be pending only on the latest attempt`);
        lastOutcome = undefined;
        return;
      }
      const decision = record(attempt.decision, `${path}.decision`, errors);
      if (!decision) return;
      exactKeys(decision, [
        "path", "sha256", "outcome", "scopeDisposition", "reviewerKeyId",
      ], `${path}.decision`, errors);
      safePath(decision.path, `${path}.decision.path`, errors);
      hashValue(decision.sha256, `${path}.decision.sha256`, errors);
      if (decision.outcome !== "approved" && decision.outcome !== "revision-requested") {
        errors.push(`${path}.decision.outcome is unsupported`);
      }
      if (!trustedKeyIds.has(decision.reviewerKeyId as string)) errors.push(`${path}.decision.reviewerKeyId is not trusted by the job`);
      if (expectedId === "final-scope" && decision.outcome === "approved") {
        if (decision.scopeDisposition !== "retain-supervised-trial" && decision.scopeDisposition !== "authorize-full-validation") {
          errors.push(`${path}.decision.scopeDisposition is required for approved final scope`);
        }
      } else if (decision.scopeDisposition !== null) {
        errors.push(`${path}.decision.scopeDisposition must be null outside approved final scope`);
      }
      lastOutcome = decision.outcome as HumanStopOutcome;
    });
    const latest = attempts.at(-1) as JsonRecord | undefined;
    const latestDecision = latest?.decision as JsonRecord | null | undefined;
    priorStopApproved = latestDecision?.outcome === "approved";
    if (priorStopApproved) previousApprovedDecisionSha = latestDecision!.sha256 as string;
  });

  if (errors.length === 0 && validatedStops.length === SUPERVISED_TRANSFER_STOP_IDS.length) {
    const expectedStatus = derivedStatus(validatedStops);
    if (root.status !== expectedStatus) errors.push(`$.status must equal derived status ${expectedStatus}`);
  }
  return { valid: errors.length === 0, errors };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertValid(job: SupervisedTransferV1): void {
  const result = validateSupervisedTransfer(job);
  if (!result.valid) throw new TypeError(`Invalid supervised transfer:\n${result.errors.join("\n")}`);
}

export function createSupervisedTransfer(input: {
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly authorityProfileId: string;
  readonly authorityProfileSha256: string;
  readonly trustedReviewerKeys: readonly { readonly keyId: string; readonly publicKeySha256: string }[];
}): SupervisedTransferV1 {
  const job: SupervisedTransferV1 = {
    schemaVersion: SUPERVISED_TRANSFER_SCHEMA_VERSION,
    jobId: input.jobId,
    gameId: input.gameId,
    transferInstanceId: input.transferInstanceId,
    sourceIdentitySha256: input.sourceIdentitySha256,
    targetProfileSha256: input.targetProfileSha256,
    status: "working",
    authority: {
      profileId: input.authorityProfileId,
      profileSha256: input.authorityProfileSha256,
      decisionMode: "external-ed25519",
      agentMayCreateDecision: false,
      agentMayAccept: false,
      agentMayRelease: false,
      trustedReviewerKeys: [...input.trustedReviewerKeys],
    },
    stops: SUPERVISED_TRANSFER_STOP_IDS.map((id, index) => ({
      id,
      order: (index + 1) as 1 | 2 | 3 | 4,
      attempts: [],
    })),
  };
  assertValid(job);
  return job;
}

function currentStop(job: SupervisedTransferV1): typeof job.stops[number] | undefined {
  return job.stops.find((stop) => {
    const latest = stop.attempts.at(-1);
    return !latest || latest.decision === null || latest.decision.outcome === "revision-requested";
  });
}

export function submitSupervisedProposal(
  value: SupervisedTransferV1,
  proposal: {
    readonly stopId: SupervisedTransferStopId;
    readonly path: string;
    readonly sha256: string;
    readonly decisionNonce: string;
  },
): SupervisedTransferV1 {
  assertValid(value);
  if (value.status !== "working" && value.status !== "revision-requested") {
    throw new TypeError(`Supervised transfer cannot accept a proposal while ${value.status}`);
  }
  const active = currentStop(value);
  if (!active || active.id !== proposal.stopId) throw new TypeError(`Proposal must target current stop ${active?.id ?? "none"}`);
  const upstreamDecisionSha256 = active.order === 1
    ? null
    : value.stops[active.order - 2]!.attempts.at(-1)!.decision!.sha256;
  const job = clone(value) as unknown as {
    status: SupervisedTransferStatus;
    stops: Array<{ attempts: SupervisedStopAttemptV1[] }>;
  };
  job.stops[active.order - 1]!.attempts.push({
    attempt: active.attempts.length + 1,
    proposal: {
      path: proposal.path,
      sha256: proposal.sha256,
      upstreamDecisionSha256,
      decisionNonce: proposal.decisionNonce,
    },
    decision: null,
  });
  job.status = "awaiting-human";
  assertValid(job as unknown as SupervisedTransferV1);
  return job as unknown as SupervisedTransferV1;
}

export async function applySupervisedHumanDecision(
  value: SupervisedTransferV1,
  decisionBytes: Uint8Array,
  decisionPath: string,
  trustKeys: readonly HumanDecisionTrustKey[],
): Promise<SupervisedTransferV1> {
  assertValid(value);
  if (value.status !== "awaiting-human") throw new TypeError(`Supervised transfer is not awaiting a human decision`);
  let decision: HumanStopDecisionV1;
  try {
    decision = JSON.parse(new TextDecoder().decode(decisionBytes)) as HumanStopDecisionV1;
  } catch {
    throw new TypeError("Human decision bytes must contain valid JSON");
  }
  const verification = await verifyHumanStopDecision(decision, trustKeys);
  if (!verification.valid || !verification.authenticated) {
    throw new TypeError(`Human decision authentication failed: ${verification.errors.join("; ")}`);
  }
  const active = currentStop(value)!;
  const attempt = active.attempts.at(-1)!;
  const expected = {
    jobId: value.jobId,
    gameId: value.gameId,
    transferInstanceId: value.transferInstanceId,
    sourceIdentitySha256: value.sourceIdentitySha256,
    targetProfileSha256: value.targetProfileSha256,
    authorityProfileSha256: value.authority.profileSha256,
    stopId: active.id,
    attempt: attempt.attempt,
    proposalSha256: attempt.proposal.sha256,
    priorDecisionSha256: attempt.proposal.upstreamDecisionSha256,
    nonce: attempt.proposal.decisionNonce,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (decision[key as keyof HumanStopDecisionV1] !== expectedValue) {
      throw new TypeError(`Human decision ${key} does not match the pending proposal`);
    }
  }
  const trusted = value.authority.trustedReviewerKeys.find(({ keyId }) => keyId === decision.reviewerKeyId);
  if (!trusted || trusted.publicKeySha256 !== verification.publicKeySha256) {
    throw new TypeError("Human decision key is not trusted by this job");
  }
  const job = clone(value) as unknown as {
    status: SupervisedTransferStatus;
    stops: Array<{ attempts: Array<{ decision: SupervisedDecisionReferenceV1 | null }> }>;
  };
  const decisionSha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(decisionBytes)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  job.stops[active.order - 1]!.attempts.at(-1)!.decision = {
    path: decisionPath,
    sha256: decisionSha256,
    outcome: decision.outcome,
    scopeDisposition: decision.scopeDisposition,
    reviewerKeyId: decision.reviewerKeyId,
  };
  if (decision.outcome === "revision-requested") job.status = "revision-requested";
  else if (active.id !== "final-scope") job.status = "working";
  else job.status = decision.scopeDisposition === "authorize-full-validation" ? "full-validation-authorized" : "trial-complete";
  assertValid(job as unknown as SupervisedTransferV1);
  return job as unknown as SupervisedTransferV1;
}
