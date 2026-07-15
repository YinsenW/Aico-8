import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  HOST_AUTHORITY_PROFILE_SCHEMA_VERSION,
  verifyHostAuthorityReceipt,
  type HostAuthorityProfileV1,
} from "@aico8/contracts";

import { InMemoryAuthorityStore, InMemoryRollbackAnchor } from "./in-memory.js";
import { HumanAuthorityApi } from "./api.js";
import {
  AuthorityAnchorPendingError,
  AuthorityConflictError,
  AuthorityPolicyError,
  AuthorityRollbackError,
  HumanAuthorityService,
  type CreateChallengeInput,
  type RegisterAuthorityInput,
} from "./service.js";

const keys = generateKeyPairSync("ed25519");
const spki = keys.publicKey.export({ type: "spki", format: "der" });
const profile: HostAuthorityProfileV1 = {
  schemaVersion: HOST_AUTHORITY_PROFILE_SCHEMA_VERSION,
  profileId: "host.production.v1",
  hostId: "human-authority.primary",
  signingKey: {
    keyId: "host.receipts.v1",
    publicKeySpkiBase64: spki.toString("base64"),
    publicKeySha256: createHash("sha256").update(spki).digest("hex"),
  },
  reviewerKeyIds: ["reviewer.primary"],
  agentCapabilities: { mayRegister: false, mayDecide: false, maySign: false, mayWriteHead: false },
  persistence: { mode: "transactional-monotonic-head", externalRollbackAnchor: "required" },
};

const signer = {
  keyId: profile.signingKey.keyId,
  async sign(payload: Uint8Array): Promise<string> {
    return sign(null, payload, keys.privateKey).toString("base64url");
  },
};

const administrator = { role: "administrator", subjectId: "owner.primary" } as const;
const agent = { role: "agent", subjectId: "agent.worker" } as const;
const reviewer = { role: "reviewer", subjectId: "owner.primary", reviewerKeyId: "reviewer.primary" } as const;
const transferInstanceId = "TTTTTTTTTTTTTTTTTTTTTT";

function registration(overrides: Partial<RegisterAuthorityInput> = {}): RegisterAuthorityInput {
  return {
    operationId: "register.steps.1",
    expectedPreviousHead: null,
    actor: administrator,
    jobId: "steps.transfer",
    gameId: "steps-private-research",
    transferInstanceId,
    sourceIdentitySha256: "a".repeat(64),
    targetProfileSha256: "b".repeat(64),
    manifestSha256: "c".repeat(64),
    authorityProfileSha256: "d".repeat(64),
    ...overrides,
  };
}

function challenge(previousHead: string, overrides: Partial<CreateChallengeInput> = {}): CreateChallengeInput {
  return {
    operationId: "challenge.semantic.1",
    expectedPreviousHead: previousHead,
    actor: agent,
    transferInstanceId,
    stopId: "semantic-intent",
    attempt: 1,
    proposalSha256: "e".repeat(64),
    requestSha256: "f".repeat(64),
    nonce: "NNNNNNNNNNNNNNNNNNNNNN",
    ...overrides,
  };
}

describe("human authority host transaction core", () => {
  let store: InMemoryAuthorityStore;
  let anchor: InMemoryRollbackAnchor;
  let service: HumanAuthorityService;

  beforeEach(() => {
    store = new InMemoryAuthorityStore();
    anchor = new InMemoryRollbackAnchor();
    service = new HumanAuthorityService({ profile, store, signer, anchor });
  });

  it("keeps registration and decisions outside Agent authority", async () => {
    await expect(service.register(registration({ actor: agent }))).rejects.toBeInstanceOf(AuthorityPolicyError);
    const registered = await service.register(registration());
    const pending = await service.createChallenge(challenge(registered.receiptSha256));
    await expect(service.commitDecision({
      operationId: "commit.semantic.1",
      expectedPreviousHead: pending.receiptSha256,
      actor: agent,
      transferInstanceId,
      stopId: "semantic-intent",
      attempt: 1,
      requestSha256: "f".repeat(64),
      decisionSha256: "1".repeat(64),
      resultLedgerSha256: "2".repeat(64),
      outcome: "approved",
      scopeDisposition: null,
    })).rejects.toBeInstanceOf(AuthorityPolicyError);
    await expect(service.commitDecision({
      operationId: "commit.semantic.unauthorized",
      expectedPreviousHead: pending.receiptSha256,
      actor: { role: "reviewer", subjectId: "intruder", reviewerKeyId: "reviewer.unknown" },
      transferInstanceId,
      stopId: "semantic-intent",
      attempt: 1,
      requestSha256: "f".repeat(64),
      decisionSha256: "1".repeat(64),
      resultLedgerSha256: "2".repeat(64),
      outcome: "approved",
      scopeDisposition: null,
    })).rejects.toBeInstanceOf(AuthorityPolicyError);
    const committed = await service.commitDecision({
      operationId: "commit.semantic.1",
      expectedPreviousHead: pending.receiptSha256,
      actor: reviewer,
      transferInstanceId,
      stopId: "semantic-intent",
      attempt: 1,
      requestSha256: "f".repeat(64),
      decisionSha256: "1".repeat(64),
      resultLedgerSha256: "2".repeat(64),
      outcome: "approved",
      scopeDisposition: null,
    });
    expect(committed.receipt.reviewerKeyId).toBe("reviewer.primary");
    expect(await verifyHostAuthorityReceipt(committed.receipt, profile, pending.receiptSha256)).toEqual({ valid: true, authenticated: true, errors: [] });
    expect((await service.verifiedHead(transferInstanceId))?.receiptSha256).toBe(committed.receiptSha256);
  });

  it("allows only one concurrent compare-and-swap transition", async () => {
    const registered = await service.register(registration());
    const first = service.createChallenge(challenge(registered.receiptSha256, { operationId: "challenge.semantic.a" }));
    const second = service.createChallenge(challenge(registered.receiptSha256, { operationId: "challenge.semantic.b", proposalSha256: "3".repeat(64) }));
    const results = await Promise.allSettled([first, second]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AuthorityConflictError);
    expect((await service.verifiedHead(transferInstanceId))?.receipt.sequence).toBe(2);
  });

  it("replays an identical operation idempotently and rejects changed reuse", async () => {
    const registered = await service.register(registration());
    const input = challenge(registered.receiptSha256);
    const first = await service.createChallenge(input);
    const repeated = await service.createChallenge(input);
    expect(repeated.receiptSha256).toBe(first.receiptSha256);
    expect(repeated.receipt.sequence).toBe(2);
    await expect(service.createChallenge({ ...input, proposalSha256: "4".repeat(64) })).rejects.toBeInstanceOf(AuthorityConflictError);
  });

  it("recovers the same committed head when anchoring fails before or after append", async () => {
    const registered = await service.register(registration());
    const firstInput = challenge(registered.receiptSha256);
    anchor.failNextAppend = true;
    await expect(service.createChallenge(firstInput)).rejects.toBeInstanceOf(AuthorityAnchorPendingError);
    await expect(service.verifiedHead(transferInstanceId)).rejects.toBeInstanceOf(AuthorityAnchorPendingError);
    const pendingHead = await store.readHead(transferInstanceId);
    await expect(service.createChallenge(challenge(pendingHead!.receiptSha256, {
      operationId: "challenge.must-not-skip-pending",
      proposalSha256: "7".repeat(64),
    }))).rejects.toBeInstanceOf(AuthorityAnchorPendingError);
    const recovered = await service.createChallenge(firstInput);
    expect(recovered.receipt.sequence).toBe(2);

    const decisionInput = {
      operationId: "commit.semantic.1",
      expectedPreviousHead: recovered.receiptSha256,
      actor: reviewer,
      transferInstanceId,
      stopId: "semantic-intent" as const,
      attempt: 1,
      requestSha256: "f".repeat(64),
      decisionSha256: "5".repeat(64),
      resultLedgerSha256: "6".repeat(64),
      outcome: "approved" as const,
      scopeDisposition: null,
    };
    store.failNextMarkAnchored = true;
    await expect(service.commitDecision(decisionInput)).rejects.toBeInstanceOf(AuthorityAnchorPendingError);
    const recoveredAfterAppend = await service.commitDecision(decisionInput);
    expect(recoveredAfterAppend.receipt.sequence).toBe(3);
    expect(await service.reconcilePendingAnchors()).toBe(0);
  });

  it("detects local rollback against an independently retained checkpoint", async () => {
    await service.register(registration());
    const rolledBack = new HumanAuthorityService({
      profile,
      store: new InMemoryAuthorityStore(),
      signer,
      anchor,
    });
    await expect(rolledBack.register(registration())).rejects.toBeInstanceOf(AuthorityRollbackError);
  });

  it("injects authenticated actors outside request JSON and enforces ETag CAS", async () => {
    const api = new HumanAuthorityApi(service);
    const registrationBody = {
      operationId: "register.api.1",
      jobId: "steps.transfer",
      gameId: "steps-private-research",
      transferInstanceId,
      sourceIdentitySha256: "a".repeat(64),
      targetProfileSha256: "b".repeat(64),
      manifestSha256: "c".repeat(64),
      authorityProfileSha256: "d".repeat(64),
    };
    const spoofed = await api.handle(new Request("https://authority.invalid/v1/transfers/register", {
      method: "POST",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify({ ...registrationBody, actor: administrator }),
    }), agent);
    expect(spoofed.status).toBe(403);

    const registered = await api.handle(new Request("https://authority.invalid/v1/transfers/register", {
      method: "POST",
      headers: { "content-type": "application/json", "if-none-match": "*" },
      body: JSON.stringify(registrationBody),
    }), administrator);
    expect(registered.status).toBe(200);
    const registrationEtag = registered.headers.get("etag")!;

    const challengeBody = {
      operationId: "challenge.api.1",
      stopId: "semantic-intent",
      attempt: 1,
      proposalSha256: "e".repeat(64),
      requestSha256: "f".repeat(64),
      nonce: "NNNNNNNNNNNNNNNNNNNNNN",
    };
    const challenged = await api.handle(new Request(`https://authority.invalid/v1/transfers/${transferInstanceId}/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": registrationEtag },
      body: JSON.stringify(challengeBody),
    }), agent);
    expect(challenged.status).toBe(200);
    expect(challenged.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);

    const stale = await api.handle(new Request(`https://authority.invalid/v1/transfers/${transferInstanceId}/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json", "if-match": registrationEtag },
      body: JSON.stringify({ ...challengeBody, operationId: "challenge.api.stale" }),
    }), agent);
    expect(stale.status).toBe(409);

    const head = await api.handle(new Request(`https://authority.invalid/v1/transfers/${transferInstanceId}/head`), agent);
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(challenged.headers.get("etag"));
  });
});
