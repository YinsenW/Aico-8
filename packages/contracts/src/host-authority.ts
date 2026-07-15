import type { FinalScopeDisposition, HumanStopOutcome, SupervisedTransferStopId } from "./human-stop-decision.js";

export const HOST_AUTHORITY_PROFILE_SCHEMA_VERSION = "aico8.host-authority-profile.v1" as const;
export const HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION = "aico8.host-authority-receipt.v1" as const;

export interface HostAuthorityProfileV1 {
  readonly schemaVersion: typeof HOST_AUTHORITY_PROFILE_SCHEMA_VERSION;
  readonly profileId: string;
  readonly hostId: string;
  readonly signingKey: { readonly keyId: string; readonly publicKeySpkiBase64: string; readonly publicKeySha256: string };
  readonly reviewerKeyIds: readonly string[];
  readonly agentCapabilities: { readonly mayRegister: false; readonly mayDecide: false; readonly maySign: false; readonly mayWriteHead: false };
  readonly persistence: { readonly mode: "transactional-monotonic-head"; readonly externalRollbackAnchor: "required" };
}

export interface HostAuthorityReceiptV1 {
  readonly schemaVersion: typeof HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION;
  readonly receiptId: string;
  readonly kind: "registration" | "challenge" | "commit-head";
  readonly hostProfileSha256: string;
  readonly hostId: string;
  readonly jobId: string;
  readonly gameId: string;
  readonly transferInstanceId: string;
  readonly sourceIdentitySha256: string;
  readonly targetProfileSha256: string;
  readonly manifestSha256: string;
  readonly authorityProfileSha256: string;
  readonly sequence: number;
  readonly previousReceiptSha256: string | null;
  readonly stopId: SupervisedTransferStopId | null;
  readonly attempt: number | null;
  readonly proposalSha256: string | null;
  readonly requestSha256: string | null;
  readonly decisionSha256: string | null;
  readonly resultLedgerSha256: string | null;
  readonly reviewerKeyId: string | null;
  readonly outcome: HumanStopOutcome | null;
  readonly scopeDisposition: FinalScopeDisposition | null;
  readonly nonce: string | null;
  readonly signingKeyId: string;
  readonly signatureAlgorithm: "ed25519";
  readonly signature: string;
}

export interface HostAuthorityValidationResult { readonly valid: boolean; readonly errors: readonly string[] }
type JsonRecord = Record<string, unknown>;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{22,128}$/;

function exact(value: JsonRecord, keys: readonly string[], errors: string[]): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`$.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`$.${key} is not allowed`);
}
function isRecord(value: unknown): value is JsonRecord { return typeof value === "object" && value !== null && !Array.isArray(value) }
function validId(value: unknown): boolean { return typeof value === "string" && ID.test(value) }
function validHash(value: unknown): boolean { return typeof value === "string" && HASH.test(value) }

export function validateHostAuthorityProfile(value: unknown): HostAuthorityValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["$ must be an object"] };
  exact(value, ["schemaVersion", "profileId", "hostId", "signingKey", "reviewerKeyIds", "agentCapabilities", "persistence"], errors);
  if (value.schemaVersion !== HOST_AUTHORITY_PROFILE_SCHEMA_VERSION) errors.push("$.schemaVersion is unsupported");
  if (!validId(value.profileId) || !validId(value.hostId)) errors.push("$.profileId and $.hostId must be valid ids");
  if (!isRecord(value.signingKey) || !validId(value.signingKey.keyId) || typeof value.signingKey.publicKeySpkiBase64 !== "string" || !validHash(value.signingKey.publicKeySha256)) errors.push("$.signingKey is invalid");
  if (!Array.isArray(value.reviewerKeyIds) || value.reviewerKeyIds.length === 0 || new Set(value.reviewerKeyIds).size !== value.reviewerKeyIds.length || value.reviewerKeyIds.some((item) => !validId(item))) errors.push("$.reviewerKeyIds must be unique valid ids");
  const capabilities = value.agentCapabilities;
  if (!isRecord(capabilities) || ["mayRegister", "mayDecide", "maySign", "mayWriteHead"].some((key) => capabilities[key] !== false)) errors.push("$.agentCapabilities must deny every Agent authority");
  if (!isRecord(value.persistence) || value.persistence.mode !== "transactional-monotonic-head" || value.persistence.externalRollbackAnchor !== "required") errors.push("$.persistence must require transactional heads and an external rollback anchor");
  return { valid: errors.length === 0, errors };
}

const receiptKeys = ["schemaVersion", "receiptId", "kind", "hostProfileSha256", "hostId", "jobId", "gameId", "transferInstanceId", "sourceIdentitySha256", "targetProfileSha256", "manifestSha256", "authorityProfileSha256", "sequence", "previousReceiptSha256", "stopId", "attempt", "proposalSha256", "requestSha256", "decisionSha256", "resultLedgerSha256", "reviewerKeyId", "outcome", "scopeDisposition", "nonce", "signingKeyId", "signatureAlgorithm", "signature"];

export function validateHostAuthorityReceipt(value: unknown): HostAuthorityValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ["$ must be an object"] };
  exact(value, receiptKeys, errors);
  if (value.schemaVersion !== HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION) errors.push("$.schemaVersion is unsupported");
  for (const key of ["receiptId", "hostId", "jobId", "gameId", "signingKeyId"]) if (!validId(value[key])) errors.push(`$.${key} must be a valid id`);
  for (const key of ["hostProfileSha256", "sourceIdentitySha256", "targetProfileSha256", "manifestSha256", "authorityProfileSha256"]) if (!validHash(value[key])) errors.push(`$.${key} must be a hash`);
  if (typeof value.transferInstanceId !== "string" || !NONCE.test(value.transferInstanceId)) errors.push("$.transferInstanceId must be entropy");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) errors.push("$.sequence must be positive");
  if (value.previousReceiptSha256 !== null && !validHash(value.previousReceiptSha256)) errors.push("$.previousReceiptSha256 must be null or a hash");
  if (value.signatureAlgorithm !== "ed25519" || typeof value.signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(value.signature)) errors.push("$.signature must be canonical Ed25519 base64url");
  const stopIds = ["semantic-intent", "art-direction", "representative-gameplay", "final-scope"];
  if (value.kind === "registration") {
    if (value.sequence !== 1 || value.previousReceiptSha256 !== null) errors.push("registration must establish sequence 1");
    for (const key of ["stopId", "attempt", "proposalSha256", "requestSha256", "decisionSha256", "resultLedgerSha256", "reviewerKeyId", "outcome", "scopeDisposition", "nonce"]) if (value[key] !== null) errors.push(`registration $.${key} must be null`);
  } else if (value.kind === "challenge") {
    if ((value.sequence as number) < 2 || !validHash(value.previousReceiptSha256) || !stopIds.includes(value.stopId as string) || !Number.isSafeInteger(value.attempt) || !validHash(value.proposalSha256) || !validHash(value.requestSha256) || typeof value.nonce !== "string" || !NONCE.test(value.nonce)) errors.push("challenge must bind the prior head, stop, proposal, request, and nonce");
    for (const key of ["decisionSha256", "resultLedgerSha256", "reviewerKeyId", "outcome", "scopeDisposition"]) if (value[key] !== null) errors.push(`challenge $.${key} must be null`);
  } else if (value.kind === "commit-head") {
    if ((value.sequence as number) < 2 || !validHash(value.previousReceiptSha256) || !stopIds.includes(value.stopId as string) || !Number.isSafeInteger(value.attempt) || !validHash(value.requestSha256) || !validHash(value.decisionSha256) || !validHash(value.resultLedgerSha256) || !validId(value.reviewerKeyId) || !["approved", "revision-requested"].includes(value.outcome as string)) errors.push("commit-head must bind the prior head, decision, reviewer, and result ledger");
    const finalApproved = value.stopId === "final-scope" && value.outcome === "approved";
    if (finalApproved ? !["retain-supervised-trial", "authorize-full-validation"].includes(value.scopeDisposition as string) : value.scopeDisposition !== null) errors.push("$.scopeDisposition is inconsistent with the decision");
    if (value.proposalSha256 !== null || value.nonce !== null) errors.push("commit-head proposalSha256 and nonce must be null");
  } else errors.push("$.kind is unsupported");
  return { valid: errors.length === 0, errors };
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as JsonRecord;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
}
function bytes(value: string): Uint8Array { const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)); return Uint8Array.from(binary, (item) => item.charCodeAt(0)) }
function source(value: Uint8Array): ArrayBuffer { return new Uint8Array(value).buffer as ArrayBuffer }
function hex(value: ArrayBuffer): string { return [...new Uint8Array(value)].map((item) => item.toString(16).padStart(2, "0")).join("") }

export function hostAuthorityReceiptSigningBytes(receipt: HostAuthorityReceiptV1): Uint8Array { const { signature: _, ...payload } = receipt; return new TextEncoder().encode(canonical(payload)) }
export async function hostAuthorityProfileSha256(profile: HostAuthorityProfileV1): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", source(new TextEncoder().encode(canonical(profile))))) }
export async function hostAuthorityReceiptSha256(receipt: HostAuthorityReceiptV1): Promise<string> { return hex(await crypto.subtle.digest("SHA-256", source(new TextEncoder().encode(canonical(receipt))))) }

export async function verifyHostAuthorityReceipt(value: unknown, profile: HostAuthorityProfileV1, expectedPreviousHead: string | null): Promise<HostAuthorityValidationResult & { authenticated: boolean }> {
  const errors = [...validateHostAuthorityReceipt(value).errors, ...validateHostAuthorityProfile(profile).errors.map((item) => `profile: ${item}`)];
  if (errors.length) return { valid: false, authenticated: false, errors };
  const receipt = value as HostAuthorityReceiptV1;
  if (receipt.hostId !== profile.hostId || receipt.signingKeyId !== profile.signingKey.keyId || receipt.hostProfileSha256 !== await hostAuthorityProfileSha256(profile)) errors.push("receipt does not match the pinned host profile");
  if (receipt.previousReceiptSha256 !== expectedPreviousHead) errors.push("receipt does not extend the expected current head");
  if (receipt.kind === "commit-head" && !profile.reviewerKeyIds.includes(receipt.reviewerKeyId!)) errors.push("commit reviewer is not authorized");
  if (errors.length) return { valid: false, authenticated: false, errors };
  try {
    const spki = bytes(profile.signingKey.publicKeySpkiBase64);
    if (hex(await crypto.subtle.digest("SHA-256", source(spki))) !== profile.signingKey.publicKeySha256) throw new Error();
    const key = await crypto.subtle.importKey("spki", source(spki), { name: "Ed25519" }, false, ["verify"]);
    const authenticated = await crypto.subtle.verify("Ed25519", key, source(bytes(receipt.signature)), source(hostAuthorityReceiptSigningBytes(receipt)));
    return { valid: authenticated, authenticated, errors: authenticated ? [] : ["host receipt signature is invalid"] };
  } catch { return { valid: false, authenticated: false, errors: ["host receipt signature could not be verified"] } }
}
