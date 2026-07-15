export const HUMAN_STOP_DECISION_SCHEMA_VERSION = "aico8.human-stop-decision.v1" as const;

export const SUPERVISED_TRANSFER_STOP_IDS = [
  "semantic-intent",
  "art-direction",
  "representative-gameplay",
  "final-scope",
] as const;

export type SupervisedTransferStopId = typeof SUPERVISED_TRANSFER_STOP_IDS[number];
export type HumanStopOutcome = "approved" | "revision-requested";
export type FinalScopeDisposition = "retain-supervised-trial" | "authorize-full-validation";

export interface HumanStopDecisionV1 {
  readonly schemaVersion: typeof HUMAN_STOP_DECISION_SCHEMA_VERSION;
  readonly decisionId: string;
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly authorityProfileSha256: string;
  readonly stopId: SupervisedTransferStopId;
  readonly attempt: number;
  readonly proposalSha256: string;
  readonly priorDecisionSha256: string | null;
  readonly nonce: string;
  readonly outcome: HumanStopOutcome;
  readonly scopeDisposition: FinalScopeDisposition | null;
  readonly reviewerKeyId: string;
  readonly signatureAlgorithm: "ed25519";
  readonly signature: string;
}

export interface HumanDecisionTrustKey {
  readonly keyId: string;
  readonly publicKeySpkiBase64: string;
  readonly publicKeySha256: string;
}

export interface HumanStopDecisionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface HumanStopDecisionVerificationResult extends HumanStopDecisionValidationResult {
  readonly authenticated: boolean;
  readonly publicKeySha256: string | null;
}

type JsonRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

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

export function validateHumanStopDecision(value: unknown): HumanStopDecisionValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "decisionId", "jobId", "gameId", "transferInstanceId", "sourceIdentitySha256",
    "targetProfileSha256", "authorityProfileSha256", "stopId", "attempt", "proposalSha256",
    "priorDecisionSha256", "nonce", "outcome", "scopeDisposition", "reviewerKeyId",
    "signatureAlgorithm", "signature",
  ], "$", errors);
  if (root.schemaVersion !== HUMAN_STOP_DECISION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${HUMAN_STOP_DECISION_SCHEMA_VERSION}`);
  }
  for (const key of ["decisionId", "jobId", "gameId", "reviewerKeyId"] as const) {
    idValue(root[key], `$.${key}`, errors);
  }
  if (typeof root.transferInstanceId !== "string" || !NONCE.test(root.transferInstanceId)) {
    errors.push("$.transferInstanceId must be base64url entropy");
  }
  for (const key of ["sourceIdentitySha256", "targetProfileSha256", "authorityProfileSha256"] as const) {
    hashValue(root[key], `$.${key}`, errors);
  }
  if (!SUPERVISED_TRANSFER_STOP_IDS.includes(root.stopId as SupervisedTransferStopId)) {
    errors.push("$.stopId is unsupported");
  }
  if (!Number.isSafeInteger(root.attempt) || (root.attempt as number) < 1) {
    errors.push("$.attempt must be a positive integer");
  }
  hashValue(root.proposalSha256, "$.proposalSha256", errors);
  if (root.priorDecisionSha256 !== null) hashValue(root.priorDecisionSha256, "$.priorDecisionSha256", errors);
  if (typeof root.nonce !== "string" || !NONCE.test(root.nonce)) errors.push("$.nonce must be base64url entropy");
  if (root.outcome !== "approved" && root.outcome !== "revision-requested") errors.push("$.outcome is unsupported");
  if (root.stopId === "final-scope" && root.outcome === "approved") {
    if (root.scopeDisposition !== "retain-supervised-trial" && root.scopeDisposition !== "authorize-full-validation") {
      errors.push("$.scopeDisposition is required for an approved final-scope decision");
    }
  } else if (root.scopeDisposition !== null) {
    errors.push("$.scopeDisposition must be null outside an approved final-scope decision");
  }
  if (root.signatureAlgorithm !== "ed25519") errors.push("$.signatureAlgorithm must equal ed25519");
  if (typeof root.signature !== "string" || !SIGNATURE.test(root.signature)) {
    errors.push("$.signature must be a 64-byte base64url Ed25519 signature");
  }
  return { valid: errors.length === 0, errors };
}

export function humanStopDecisionSigningPayload(decision: HumanStopDecisionV1): Uint8Array {
  const payload = {
    schemaVersion: decision.schemaVersion,
    decisionId: decision.decisionId,
    jobId: decision.jobId,
    gameId: decision.gameId,
    transferInstanceId: decision.transferInstanceId,
    sourceIdentitySha256: decision.sourceIdentitySha256,
    targetProfileSha256: decision.targetProfileSha256,
    authorityProfileSha256: decision.authorityProfileSha256,
    stopId: decision.stopId,
    attempt: decision.attempt,
    proposalSha256: decision.proposalSha256,
    priorDecisionSha256: decision.priorDecisionSha256,
    nonce: decision.nonce,
    outcome: decision.outcome,
    scopeDisposition: decision.scopeDisposition,
    reviewerKeyId: decision.reviewerKeyId,
    signatureAlgorithm: decision.signatureAlgorithm,
  };
  return new TextEncoder().encode(JSON.stringify(payload));
}

function base64Bytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonicalBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function verifyHumanStopDecision(
  value: unknown,
  trustKeys: readonly HumanDecisionTrustKey[],
): Promise<HumanStopDecisionVerificationResult> {
  const structural = validateHumanStopDecision(value);
  if (!structural.valid) return { ...structural, authenticated: false, publicKeySha256: null };
  const decision = value as HumanStopDecisionV1;
  const trustKey = trustKeys.find(({ keyId }) => keyId === decision.reviewerKeyId);
  if (!trustKey) {
    return { valid: false, authenticated: false, publicKeySha256: null, errors: ["reviewer key is not trusted"] };
  }
  if (!ID.test(trustKey.keyId) || !HASH.test(trustKey.publicKeySha256)) {
    return { valid: false, authenticated: false, publicKeySha256: null, errors: ["trusted reviewer key metadata is invalid"] };
  }
  try {
    const spki = base64Bytes(trustKey.publicKeySpkiBase64);
    const observedKeyHash = hex(await crypto.subtle.digest("SHA-256", bufferSource(spki)));
    if (observedKeyHash !== trustKey.publicKeySha256) {
      return { valid: false, authenticated: false, publicKeySha256: observedKeyHash, errors: ["reviewer public-key hash mismatch"] };
    }
    const key = await crypto.subtle.importKey("spki", bufferSource(spki), { name: "Ed25519" }, false, ["verify"]);
    const signature = base64Bytes(decision.signature);
    if (canonicalBase64url(signature) !== decision.signature) {
      return { valid: false, authenticated: false, publicKeySha256: observedKeyHash, errors: ["human stop decision signature is not canonical base64url"] };
    }
    const authenticated = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      bufferSource(signature),
      bufferSource(humanStopDecisionSigningPayload(decision)),
    );
    return {
      valid: authenticated,
      authenticated,
      publicKeySha256: observedKeyHash,
      errors: authenticated ? [] : ["human stop decision signature is invalid"],
    };
  } catch {
    return { valid: false, authenticated: false, publicKeySha256: null, errors: ["human stop decision signature could not be verified"] };
  }
}
