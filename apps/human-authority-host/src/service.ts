import {
  HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION,
  hostAuthorityProfileSha256,
  hostAuthorityReceiptSha256,
  hostAuthorityReceiptSigningBytes,
  validateHostAuthorityProfile,
  validateHostAuthorityReceipt,
  type FinalScopeDisposition,
  type HostAuthorityProfileV1,
  type HostAuthorityReceiptV1,
  type HumanStopOutcome,
  type SupervisedTransferStopId,
} from "@aico8/contracts";

import type {
  AuthorityCheckpoint,
  AuthorityIdentity,
  AuthorityRecord,
  AuthorityStore,
  ReceiptSigner,
  RollbackAnchor,
} from "./ports.js";

export type AuthorityActor =
  | { readonly role: "agent"; readonly subjectId: string }
  | { readonly role: "reviewer"; readonly subjectId: string; readonly reviewerKeyId: string }
  | { readonly role: "administrator"; readonly subjectId: string };

interface OperationBase {
  readonly operationId: string;
  readonly expectedPreviousHead: string | null;
  readonly actor: AuthorityActor;
}

export interface RegisterAuthorityInput extends OperationBase, AuthorityIdentity {}

export interface CreateChallengeInput extends OperationBase {
  readonly transferInstanceId: string;
  readonly stopId: SupervisedTransferStopId;
  readonly attempt: number;
  readonly proposalSha256: string;
  readonly requestSha256: string;
  readonly nonce: string;
}

export interface CommitDecisionInput extends OperationBase {
  readonly transferInstanceId: string;
  readonly stopId: SupervisedTransferStopId;
  readonly attempt: number;
  readonly requestSha256: string;
  readonly decisionSha256: string;
  readonly resultLedgerSha256: string;
  readonly outcome: HumanStopOutcome;
  readonly scopeDisposition: FinalScopeDisposition | null;
}

export class AuthorityPolicyError extends Error {}
export class AuthorityConflictError extends Error {}
export class AuthorityRollbackError extends Error {}
export class AuthorityAnchorPendingError extends Error {}

const OPERATION_ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function receiptId(operationId: string): string {
  if (!OPERATION_ID.test(operationId)) throw new AuthorityPolicyError("operationId must be a stable lowercase identifier");
  return `receipt.${operationId}`;
}

function checkpoint(profile: HostAuthorityProfileV1, record: AuthorityRecord): AuthorityCheckpoint {
  return {
    hostId: profile.hostId,
    transferInstanceId: record.identity.transferInstanceId,
    sequence: record.receipt.sequence,
    receiptSha256: record.receiptSha256,
    previousReceiptSha256: record.receipt.previousReceiptSha256,
  };
}

export class HumanAuthorityService {
  readonly #profile: HostAuthorityProfileV1;
  readonly #store: AuthorityStore;
  readonly #signer: ReceiptSigner;
  readonly #anchor: RollbackAnchor;

  constructor(input: {
    readonly profile: HostAuthorityProfileV1;
    readonly store: AuthorityStore;
    readonly signer: ReceiptSigner;
    readonly anchor: RollbackAnchor;
  }) {
    const validation = validateHostAuthorityProfile(input.profile);
    if (!validation.valid) throw new AuthorityPolicyError(validation.errors.join("; "));
    if (input.signer.keyId !== input.profile.signingKey.keyId) throw new AuthorityPolicyError("signer does not match the pinned host profile");
    this.#profile = input.profile;
    this.#store = input.store;
    this.#signer = input.signer;
    this.#anchor = input.anchor;
  }

  async register(input: RegisterAuthorityInput): Promise<AuthorityRecord> {
    if (input.actor.role !== "administrator") throw new AuthorityPolicyError("only an administrator may register a transfer");
    const identity: AuthorityIdentity = {
      jobId: input.jobId,
      gameId: input.gameId,
      transferInstanceId: input.transferInstanceId,
      sourceIdentitySha256: input.sourceIdentitySha256,
      targetProfileSha256: input.targetProfileSha256,
      manifestSha256: input.manifestSha256,
      authorityProfileSha256: input.authorityProfileSha256,
    };
    await this.#assertExternalHead(input.transferInstanceId, await this.#store.readHead(input.transferInstanceId));
    return this.#transition({
      operationId: input.operationId,
      operation: { kind: "registration", identity },
      expectedPreviousHead: input.expectedPreviousHead,
      identity,
      fields: {
        kind: "registration",
        stopId: null,
        attempt: null,
        proposalSha256: null,
        requestSha256: null,
        decisionSha256: null,
        resultLedgerSha256: null,
        reviewerKeyId: null,
        outcome: null,
        scopeDisposition: null,
        nonce: null,
      },
    });
  }

  async createChallenge(input: CreateChallengeInput): Promise<AuthorityRecord> {
    const current = await this.#requiredHead(input.transferInstanceId);
    await this.#assertExternalHead(input.transferInstanceId, current);
    return this.#transition({
      operationId: input.operationId,
      operation: { ...input, actor: { role: input.actor.role, subjectId: input.actor.subjectId } },
      expectedPreviousHead: input.expectedPreviousHead,
      identity: current.identity,
      fields: {
        kind: "challenge",
        stopId: input.stopId,
        attempt: input.attempt,
        proposalSha256: input.proposalSha256,
        requestSha256: input.requestSha256,
        decisionSha256: null,
        resultLedgerSha256: null,
        reviewerKeyId: null,
        outcome: null,
        scopeDisposition: null,
        nonce: input.nonce,
      },
    });
  }

  async commitDecision(input: CommitDecisionInput): Promise<AuthorityRecord> {
    if (input.actor.role !== "reviewer") throw new AuthorityPolicyError("only an authenticated reviewer may commit a decision");
    if (!this.#profile.reviewerKeyIds.includes(input.actor.reviewerKeyId)) throw new AuthorityPolicyError("reviewer is not allowed by the host profile");
    const current = await this.#requiredHead(input.transferInstanceId);
    await this.#assertExternalHead(input.transferInstanceId, current);
    const operation = { ...input, actor: { role: input.actor.role, subjectId: input.actor.subjectId, reviewerKeyId: input.actor.reviewerKeyId } };
    const recovered = await this.#recoverOperation(input.transferInstanceId, input.operationId, operation);
    if (recovered) return recovered;
    if (current.receipt.kind !== "challenge"
      || current.receipt.stopId !== input.stopId
      || current.receipt.attempt !== input.attempt
      || current.receipt.requestSha256 !== input.requestSha256) {
      throw new AuthorityPolicyError("decision does not answer the current signed challenge");
    }
    return this.#transition({
      operationId: input.operationId,
      operation,
      expectedPreviousHead: input.expectedPreviousHead,
      identity: current.identity,
      fields: {
        kind: "commit-head",
        stopId: input.stopId,
        attempt: input.attempt,
        proposalSha256: null,
        requestSha256: input.requestSha256,
        decisionSha256: input.decisionSha256,
        resultLedgerSha256: input.resultLedgerSha256,
        reviewerKeyId: input.actor.reviewerKeyId,
        outcome: input.outcome,
        scopeDisposition: input.scopeDisposition,
        nonce: null,
      },
    });
  }

  async verifiedHead(transferInstanceId: string): Promise<AuthorityRecord | null> {
    const current = await this.#store.readHead(transferInstanceId);
    await this.#assertExternalHead(transferInstanceId, current);
    if (current?.anchorStatus === "pending") throw new AuthorityAnchorPendingError("current head is not externally anchored");
    return current;
  }

  async reconcilePendingAnchors(): Promise<number> {
    const pending = await this.#store.listPendingAnchors();
    for (const record of pending) await this.#anchorRecord(record);
    return pending.length;
  }

  async #requiredHead(transferInstanceId: string): Promise<AuthorityRecord> {
    const current = await this.#store.readHead(transferInstanceId);
    if (!current) throw new AuthorityConflictError("transfer is not registered");
    return current;
  }

  async #recoverOperation(transferInstanceId: string, operationId: string, operation: unknown): Promise<AuthorityRecord | null> {
    receiptId(operationId);
    const operationSha256 = await sha256(operation);
    const prior = await this.#store.readOperation(transferInstanceId, operationId);
    if (!prior) return null;
    if (prior.operationSha256 !== operationSha256) throw new AuthorityConflictError("operationId was already used for different input");
    await this.#anchorRecord(prior);
    return { ...prior, anchorStatus: "anchored" };
  }

  async #assertExternalHead(transferInstanceId: string, local: AuthorityRecord | null): Promise<void> {
    const external = await this.#anchor.latest(transferInstanceId);
    if (!local) {
      if (external) throw new AuthorityRollbackError("external anchor proves a missing or rolled-back local transfer");
      return;
    }
    if (!external) {
      if (local.anchorStatus === "anchored") throw new AuthorityRollbackError("anchored local head is missing from the external anchor");
      return;
    }
    if (external.sequence > local.receipt.sequence
      || (external.sequence === local.receipt.sequence && external.receiptSha256 !== local.receiptSha256)) {
      throw new AuthorityRollbackError("external anchor proves the local head was rolled back or replaced");
    }
    if (external.sequence < local.receipt.sequence && local.anchorStatus !== "pending") {
      throw new AuthorityRollbackError("local head advanced without a recoverable pending anchor");
    }
  }

  async #transition(input: {
    readonly operationId: string;
    readonly operation: unknown;
    readonly expectedPreviousHead: string | null;
    readonly identity: AuthorityIdentity;
    readonly fields: Pick<HostAuthorityReceiptV1, "kind" | "stopId" | "attempt" | "proposalSha256" | "requestSha256" | "decisionSha256" | "resultLedgerSha256" | "reviewerKeyId" | "outcome" | "scopeDisposition" | "nonce">;
  }): Promise<AuthorityRecord> {
    const recovered = await this.#recoverOperation(input.identity.transferInstanceId, input.operationId, input.operation);
    if (recovered) return recovered;
    const operationSha256 = await sha256(input.operation);
    const current = await this.#store.readHead(input.identity.transferInstanceId);
    if (current?.anchorStatus === "pending") {
      throw new AuthorityAnchorPendingError("a new transition cannot pass an unanchored head; retry the original operation");
    }
    if ((current?.receiptSha256 ?? null) !== input.expectedPreviousHead) {
      throw new AuthorityConflictError(`head conflict: expected ${input.expectedPreviousHead ?? "empty"}, found ${current?.receiptSha256 ?? "empty"}`);
    }
    const sequence = (current?.receipt.sequence ?? 0) + 1;
    const unsigned: HostAuthorityReceiptV1 = {
      schemaVersion: HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION,
      receiptId: receiptId(input.operationId),
      ...input.fields,
      hostProfileSha256: await hostAuthorityProfileSha256(this.#profile),
      hostId: this.#profile.hostId,
      ...input.identity,
      sequence,
      previousReceiptSha256: input.expectedPreviousHead,
      signingKeyId: this.#signer.keyId,
      signatureAlgorithm: "ed25519",
      signature: "A".repeat(86),
    };
    const signature = await this.#signer.sign(hostAuthorityReceiptSigningBytes(unsigned));
    const receipt = { ...unsigned, signature };
    const validation = validateHostAuthorityReceipt(receipt);
    if (!validation.valid) throw new AuthorityPolicyError(validation.errors.join("; "));
    const receiptSha256 = await hostAuthorityReceiptSha256(receipt);
    const record: AuthorityRecord = {
      operationId: input.operationId,
      operationSha256,
      identity: input.identity,
      receipt,
      receiptSha256,
      anchorStatus: "pending",
    };
    const committed = await this.#store.commit({
      operationId: input.operationId,
      operationSha256,
      expectedPreviousHead: input.expectedPreviousHead,
      record,
    });
    if (committed.kind === "conflict") throw new AuthorityConflictError(`head conflict: expected ${input.expectedPreviousHead ?? "empty"}, found ${committed.currentHead ?? "empty"}`);
    await this.#anchorRecord(committed.record);
    return { ...committed.record, anchorStatus: "anchored" };
  }

  async #anchorRecord(record: AuthorityRecord): Promise<void> {
    try {
      await this.#anchor.append(checkpoint(this.#profile, record));
      await this.#store.markAnchored(record.identity.transferInstanceId, record.receiptSha256);
    } catch (error) {
      throw new AuthorityAnchorPendingError(`head committed but external anchoring remains pending: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
