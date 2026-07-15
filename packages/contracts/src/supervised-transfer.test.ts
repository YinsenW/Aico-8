import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";

import {
  HUMAN_STOP_DECISION_SCHEMA_VERSION,
  humanStopDecisionSigningPayload,
  validateHumanStopDecision,
  verifyHumanStopDecision,
  type HumanDecisionTrustKey,
  type HumanStopDecisionV1,
  type SupervisedTransferStopId,
} from "./human-stop-decision.js";
import {
  applySupervisedHumanDecision,
  createSupervisedTransfer,
  submitSupervisedProposal,
  validateSupervisedTransfer,
  type SupervisedTransferV1,
} from "./supervised-transfer.js";

const decisionSchema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/human-stop-decision-v1.schema.json", import.meta.url), "utf8",
));
const transferSchema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/supervised-transfer-v1.schema.json", import.meta.url), "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateDecisionSchema = ajv.compile(decisionSchema);
const validateTransferSchema = ajv.compile(transferSchema);
const hash = (digit: string) => digit.repeat(64);

let privateKey: CryptoKey;
let trustKey: HumanDecisionTrustKey;

function base64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  privateKey = pair.privateKey;
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  trustKey = {
    keyId: "reviewer.primary",
    publicKeySpkiBase64: btoa(String.fromCharCode(...new Uint8Array(spki))),
    publicKeySha256: hex(await crypto.subtle.digest("SHA-256", spki)),
  };
});

function unsignedDecision(input: {
  readonly job: SupervisedTransferV1;
  readonly stopId: SupervisedTransferStopId;
  readonly outcome?: "approved" | "revision-requested";
  readonly disposition?: "retain-supervised-trial" | "authorize-full-validation" | null;
}): HumanStopDecisionV1 {
  const stop = input.job.stops.find(({ id }) => id === input.stopId)!;
  const attempt = stop.attempts.at(-1)!;
  return {
    schemaVersion: HUMAN_STOP_DECISION_SCHEMA_VERSION,
    decisionId: `decision.${input.stopId}.${attempt.attempt}`,
    jobId: input.job.jobId,
    gameId: input.job.gameId,
    transferInstanceId: input.job.transferInstanceId,
    sourceIdentitySha256: input.job.sourceIdentitySha256,
    targetProfileSha256: input.job.targetProfileSha256,
    authorityProfileSha256: input.job.authority.profileSha256,
    stopId: input.stopId,
    attempt: attempt.attempt,
    proposalSha256: attempt.proposal.sha256,
    priorDecisionSha256: attempt.proposal.upstreamDecisionSha256,
    nonce: attempt.proposal.decisionNonce,
    outcome: input.outcome ?? "approved",
    scopeDisposition: input.stopId === "final-scope" && (input.outcome ?? "approved") === "approved"
      ? input.disposition ?? "retain-supervised-trial" : null,
    reviewerKeyId: trustKey.keyId,
    signatureAlgorithm: "ed25519",
    signature: "A".repeat(86),
  };
}

async function signedDecision(input: Parameters<typeof unsignedDecision>[0]): Promise<HumanStopDecisionV1> {
  const decision = unsignedDecision(input);
  return await signDecision(decision);
}

async function signDecision(decision: HumanStopDecisionV1): Promise<HumanStopDecisionV1> {
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" }, privateKey, bufferSource(humanStopDecisionSigningPayload(decision)),
  );
  return { ...decision, signature: base64url(signature) };
}

function freshJob(): SupervisedTransferV1 {
  return createSupervisedTransfer({
    jobId: "steps.supervised-transfer",
    gameId: "steps-private-research",
    transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
    sourceIdentitySha256: hash("a"),
    targetProfileSha256: hash("b"),
    authorityProfileId: "human-review.primary",
    authorityProfileSha256: hash("c"),
    trustedReviewerKeys: [{ keyId: trustKey.keyId, publicKeySha256: trustKey.publicKeySha256 }],
  });
}

async function approve(
  job: SupervisedTransferV1,
  stopId: SupervisedTransferStopId,
  proposalDigit: string,
  disposition: "retain-supervised-trial" | "authorize-full-validation" | null = null,
): Promise<SupervisedTransferV1> {
  const proposed = submitSupervisedProposal(job, {
    stopId,
    path: `proposals/${stopId}-${proposalDigit}.json`,
    sha256: hash(proposalDigit),
    decisionNonce: proposalDigit.repeat(22),
  });
  const decision = await signedDecision({ job: proposed, stopId, disposition });
  return await applySupervisedHumanDecision(
    proposed,
    new TextEncoder().encode(JSON.stringify(decision)),
    `decisions/${decision.decisionId}.json`,
    [trustKey],
  );
}

describe("externally authenticated supervised transfer", () => {
  it("validates a signed human decision structurally and cryptographically", async () => {
    const pending = submitSupervisedProposal(freshJob(), {
      stopId: "semantic-intent", path: "proposals/semantics.json", sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    });
    const decision = await signedDecision({ job: pending, stopId: "semantic-intent" });
    expect(validateDecisionSchema(decision), JSON.stringify(validateDecisionSchema.errors)).toBe(true);
    expect(validateHumanStopDecision(decision)).toEqual({ valid: true, errors: [] });
    expect(await verifyHumanStopDecision(decision, [trustKey])).toMatchObject({ valid: true, authenticated: true });
  });

  it("rejects forged human fields, unknown keys, and changed signed payloads", async () => {
    const pending = submitSupervisedProposal(freshJob(), {
      stopId: "semantic-intent", path: "proposals/semantics.json", sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    });
    const decision = await signedDecision({ job: pending, stopId: "semantic-intent" });
    expect((await verifyHumanStopDecision({ ...decision, proposalSha256: hash("2") }, [trustKey])).authenticated).toBe(false);
    expect((await verifyHumanStopDecision(decision, [{ ...trustKey, keyId: "different.reviewer" }])).errors)
      .toContain("reviewer key is not trusted");
    await expect(applySupervisedHumanDecision(
      pending,
      new TextEncoder().encode(JSON.stringify({ ...decision, signature: "A".repeat(86) })),
      "decisions/forged.json",
      [trustKey],
    )).rejects.toThrow(/authentication failed/);
  });

  it("enforces the four stops in order and never lets proposal work self-accept", () => {
    const job = freshJob();
    expect(validateTransferSchema(job), JSON.stringify(validateTransferSchema.errors)).toBe(true);
    expect(validateSupervisedTransfer(job)).toEqual({ valid: true, errors: [] });
    expect(() => submitSupervisedProposal(job, {
      stopId: "representative-gameplay", path: "proposals/gameplay.json", sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    })).toThrow(/current stop semantic-intent/);
    const pending = submitSupervisedProposal(job, {
      stopId: "semantic-intent", path: "proposals/semantics.json", sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    });
    expect(pending.status).toBe("awaiting-human");
    expect(pending.authority).toMatchObject({
      agentMayCreateDecision: false, agentMayAccept: false, agentMayRelease: false,
    });
    expect(() => submitSupervisedProposal(pending, {
      stopId: "semantic-intent", path: "proposals/retry.json", sha256: hash("2"),
      decisionNonce: "2222222222222222222222",
    })).toThrow(/cannot accept a proposal while awaiting-human/);
  });

  it("preserves revision history and rejects an unchanged replacement proposal", async () => {
    const pending = submitSupervisedProposal(freshJob(), {
      stopId: "semantic-intent", path: "proposals/semantics-1.json", sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    });
    const revision = await signedDecision({ job: pending, stopId: "semantic-intent", outcome: "revision-requested" });
    const requested = await applySupervisedHumanDecision(
      pending, new TextEncoder().encode(JSON.stringify(revision)), "decisions/revision.json", [trustKey],
    );
    expect(requested.status).toBe("revision-requested");
    expect(() => submitSupervisedProposal(requested, {
      stopId: "semantic-intent", path: "proposals/semantics-2.json", sha256: hash("1"),
      decisionNonce: "2222222222222222222222",
    })).toThrow(/must not reuse any prior proposal/);
    const retry = submitSupervisedProposal(requested, {
      stopId: "semantic-intent", path: "proposals/semantics-2.json", sha256: hash("2"),
      decisionNonce: "2222222222222222222222",
    });
    expect(retry.stops[0]!.attempts).toHaveLength(2);
    expect(retry.stops[0]!.attempts[0]!.decision?.outcome).toBe("revision-requested");
  });

  it("binds every downstream proposal to the latest approved decision", async () => {
    const semantics = await approve(freshJob(), "semantic-intent", "1");
    expect(semantics.status).toBe("working");
    const art = submitSupervisedProposal(semantics, {
      stopId: "art-direction", path: "proposals/art.json", sha256: hash("2"),
      decisionNonce: "2222222222222222222222",
    });
    expect(art.stops[1]!.attempts[0]!.proposal.upstreamDecisionSha256)
      .toBe(semantics.stops[0]!.attempts[0]!.decision!.sha256);
    const decision = await signedDecision({ job: art, stopId: "art-direction" });
    await expect(applySupervisedHumanDecision(
      art,
      new TextEncoder().encode(JSON.stringify({ ...decision, priorDecisionSha256: hash("f") })),
      "decisions/stale.json",
      [trustKey],
    )).rejects.toThrow(/authentication failed|priorDecisionSha256/);
  });

  it("distinguishes a completed supervised trial from authorization to run full validation", async () => {
    let retained = freshJob();
    retained = await approve(retained, "semantic-intent", "1");
    retained = await approve(retained, "art-direction", "2");
    retained = await approve(retained, "representative-gameplay", "3");
    retained = await approve(retained, "final-scope", "4", "retain-supervised-trial");
    expect(retained.status).toBe("trial-complete");

    let promoted = freshJob();
    promoted = await approve(promoted, "semantic-intent", "5");
    promoted = await approve(promoted, "art-direction", "6");
    promoted = await approve(promoted, "representative-gameplay", "7");
    promoted = await approve(promoted, "final-scope", "8", "authorize-full-validation");
    expect(promoted.status).toBe("full-validation-authorized");
    expect(promoted.status).not.toBe("trial-complete");
  });

  it("binds the signature to transfer identity and the persisted proposal challenge", async () => {
    const pending = submitSupervisedProposal(freshJob(), {
      stopId: "semantic-intent",
      path: "proposals/semantics.json",
      sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    });
    const wrongNonce = await signDecision({
      ...unsignedDecision({ job: pending, stopId: "semantic-intent" }),
      nonce: "2222222222222222222222",
    });
    await expect(applySupervisedHumanDecision(
      pending,
      new TextEncoder().encode(JSON.stringify(wrongNonce)),
      "decisions/wrong-nonce.json",
      [trustKey],
    )).rejects.toThrow(/nonce does not match/);

    const wrongSource = await signDecision({
      ...unsignedDecision({ job: pending, stopId: "semantic-intent" }),
      sourceIdentitySha256: hash("f"),
    });
    await expect(applySupervisedHumanDecision(
      pending,
      new TextEncoder().encode(JSON.stringify(wrongSource)),
      "decisions/wrong-source.json",
      [trustKey],
    )).rejects.toThrow(/sourceIdentitySha256 does not match/);
  });

  it("rejects A-B-A proposal reuse and returns validation errors instead of throwing on malformed JSON", async () => {
    let job = submitSupervisedProposal(freshJob(), {
      stopId: "semantic-intent", path: "proposals/a.json", sha256: hash("1"),
      decisionNonce: "1111111111111111111111",
    });
    let decision = await signedDecision({ job, stopId: "semantic-intent", outcome: "revision-requested" });
    job = await applySupervisedHumanDecision(
      job, new TextEncoder().encode(JSON.stringify(decision)), "decisions/revision-a.json", [trustKey],
    );
    job = submitSupervisedProposal(job, {
      stopId: "semantic-intent", path: "proposals/b.json", sha256: hash("2"),
      decisionNonce: "2222222222222222222222",
    });
    decision = await signedDecision({ job, stopId: "semantic-intent", outcome: "revision-requested" });
    job = await applySupervisedHumanDecision(
      job, new TextEncoder().encode(JSON.stringify(decision)), "decisions/revision-b.json", [trustKey],
    );
    expect(() => submitSupervisedProposal(job, {
      stopId: "semantic-intent", path: "proposals/a-again.json", sha256: hash("1"),
      decisionNonce: "3333333333333333333333",
    })).toThrow(/must not reuse any prior proposal/);

    const malformed = structuredClone(freshJob()) as unknown as { stops: Array<{ attempts: unknown }> };
    malformed.stops[0]!.attempts = "not-an-array";
    expect(() => validateSupervisedTransfer(malformed)).not.toThrow();
    expect(validateSupervisedTransfer(malformed).valid).toBe(false);
  });
});
