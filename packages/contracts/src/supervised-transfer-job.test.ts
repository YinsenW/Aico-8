import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HUMAN_STOP_DECISION_SCHEMA_VERSION,
  humanStopDecisionSigningPayload,
  type HumanDecisionTrustKey,
  type HumanStopDecisionV1,
} from "./human-stop-decision.js";
import {
  createSupervisedTransfer,
  validateSupervisedTransfer,
  type SupervisedTransferV1,
} from "./supervised-transfer.js";
import {
  acquireSupervisedTransferLedgerLock,
  runSupervisedTransferJob,
  type SupervisedTransferJobOptions,
} from "../../../scripts/run-supervised-transfer.ts";

const temporaryRoots: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function base64url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64url");
}

function bufferSource(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer as ArrayBuffer;
}

interface Fixture {
  readonly root: string;
  readonly artifactRoot: string;
  readonly manifestPath: string;
  readonly ledgerPath: string;
  readonly trustStorePath: string;
  readonly proposalPath: string;
  readonly privateKey: CryptoKey;
  readonly trustKey: HumanDecisionTrustKey;
}

async function fixture(): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-supervised-transfer-"));
  temporaryRoots.push(root);
  const artifactRoot = path.join(root, "artifacts");
  const manifestPath = path.join(root, "manifest.json");
  const ledgerPath = path.join(root, "state", "ledger.json");
  const trustStorePath = path.join(root, "host-policy", "trust.json");
  const proposalPath = "proposals/semantic-intent-1.json";
  await fs.mkdir(path.join(artifactRoot, "proposals"), { recursive: true });
  await fs.mkdir(path.dirname(trustStorePath), { recursive: true });
  await fs.writeFile(path.join(artifactRoot, proposalPath), jsonBytes({ intent: "preserve source semantics" }));

  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const trustKey: HumanDecisionTrustKey = {
    keyId: "reviewer.primary",
    publicKeySpkiBase64: Buffer.from(spki).toString("base64"),
    publicKeySha256: hash(new Uint8Array(spki)),
  };
  const trustBytes = jsonBytes({
    schemaVersion: "aico8.human-decision-trust-store.v1",
    profileId: "human-review.primary",
    keys: [trustKey],
  });
  await fs.writeFile(trustStorePath, trustBytes);
  const manifest = createSupervisedTransfer({
    jobId: "steps.supervised-transfer",
    gameId: "steps-private-research",
    transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
    sourceIdentitySha256: "a".repeat(64),
    targetProfileSha256: "b".repeat(64),
    authorityProfileId: "human-review.primary",
    authorityProfileSha256: hash(trustBytes),
    trustedReviewerKeys: [{ keyId: trustKey.keyId, publicKeySha256: trustKey.publicKeySha256 }],
  });
  await fs.writeFile(manifestPath, jsonBytes(manifest));
  return {
    root, artifactRoot, manifestPath, ledgerPath, trustStorePath, proposalPath,
    privateKey: pair.privateKey, trustKey,
  };
}

function options(value: Fixture, action: SupervisedTransferJobOptions["action"]): SupervisedTransferJobOptions {
  return {
    action,
    manifestPath: value.manifestPath,
    artifactRoot: value.artifactRoot,
    ledgerPath: value.ledgerPath,
    trustStorePath: value.trustStorePath,
  };
}

async function signedDecision(
  value: Fixture,
  pending: SupervisedTransferV1,
  overrides: Partial<HumanStopDecisionV1> = {},
): Promise<HumanStopDecisionV1> {
  const attempt = pending.stops[0]!.attempts[0]!;
  const unsigned: HumanStopDecisionV1 = {
    schemaVersion: HUMAN_STOP_DECISION_SCHEMA_VERSION,
    decisionId: "decision.semantic-intent.1",
    jobId: pending.jobId,
    gameId: pending.gameId,
    transferInstanceId: pending.transferInstanceId,
    sourceIdentitySha256: pending.sourceIdentitySha256,
    targetProfileSha256: pending.targetProfileSha256,
    authorityProfileSha256: pending.authority.profileSha256,
    stopId: "semantic-intent",
    attempt: 1,
    proposalSha256: attempt.proposal.sha256,
    priorDecisionSha256: null,
    nonce: attempt.proposal.decisionNonce,
    outcome: "approved",
    scopeDisposition: null,
    reviewerKeyId: value.trustKey.keyId,
    signatureAlgorithm: "ed25519",
    signature: "A".repeat(86),
    ...overrides,
  };
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" }, value.privateKey, bufferSource(humanStopDecisionSigningPayload(unsigned)),
  );
  return { ...unsigned, signature: base64url(signature) };
}

async function submitSemantic(value: Fixture): Promise<SupervisedTransferV1> {
  return await runSupervisedTransferJob({
    ...options(value, "submit"),
    stopId: "semantic-intent",
    proposalPath: value.proposalPath,
  });
}

describe("JOB-SUPERVISED-TRANSFER-001 filesystem runner", () => {
  it("persists, resumes, and exactly replays proposal and signed-decision transitions", async () => {
    const value = await fixture();
    const initialized = await runSupervisedTransferJob(options(value, "init"));
    expect(initialized.status).toBe("working");
    const pending = await submitSemantic(value);
    expect(pending.status).toBe("awaiting-human");
    expect(pending.stops[0]!.attempts).toHaveLength(1);
    expect(await submitSemantic(value)).toEqual(pending);

    const decisionPath = "decisions/semantic-intent-1.json";
    await fs.mkdir(path.join(value.artifactRoot, "decisions"), { recursive: true });
    await fs.writeFile(path.join(value.artifactRoot, decisionPath), jsonBytes(await signedDecision(value, pending)));
    const applied = await runSupervisedTransferJob({
      ...options(value, "apply"), decisionPath,
    });
    expect(applied.status).toBe("working");
    expect(applied.stops[0]!.attempts[0]!.decision).toMatchObject({
      path: decisionPath, outcome: "approved", reviewerKeyId: value.trustKey.keyId,
    });
    expect(await runSupervisedTransferJob({ ...options(value, "apply"), decisionPath })).toEqual(applied);
    expect(JSON.parse(await fs.readFile(value.ledgerPath, "utf8"))).toEqual(applied);
    expect((await fs.readdir(path.dirname(value.ledgerPath))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects forged decisions, manifest drift, and changed artifact bytes without mutating the ledger", async () => {
    const value = await fixture();
    const pending = await submitSemantic(value);
    const before = await fs.readFile(value.ledgerPath);
    const decisionPath = "decisions/forged.json";
    await fs.mkdir(path.join(value.artifactRoot, "decisions"), { recursive: true });
    const forged = await signedDecision(value, pending);
    await fs.writeFile(path.join(value.artifactRoot, decisionPath), jsonBytes({ ...forged, signature: "A".repeat(86) }));
    await expect(runSupervisedTransferJob({ ...options(value, "apply"), decisionPath }))
      .rejects.toThrow(/authentication failed/);
    expect(await fs.readFile(value.ledgerPath)).toEqual(before);

    const manifest = JSON.parse(await fs.readFile(value.manifestPath, "utf8"));
    manifest.sourceIdentitySha256 = "f".repeat(64);
    await fs.writeFile(value.manifestPath, jsonBytes(manifest));
    await expect(runSupervisedTransferJob(options(value, "init"))).rejects.toThrow(/immutable source\/profile\/authority identity/);
    expect(await fs.readFile(value.ledgerPath)).toEqual(before);

    manifest.sourceIdentitySha256 = "a".repeat(64);
    await fs.writeFile(value.manifestPath, jsonBytes(manifest));
    await fs.writeFile(path.join(value.artifactRoot, value.proposalPath), jsonBytes({ intent: "mutated" }));
    await expect(runSupervisedTransferJob(options(value, "init"))).rejects.toThrow(/proposal bytes changed/);
    expect(await fs.readFile(value.ledgerPath)).toEqual(before);
  });

  it("does not trust a structurally valid handwritten terminal ledger", async () => {
    const value = await fixture();
    const pending = await submitSemantic(value);
    const decisionPath = "decisions/semantic-intent-1.json";
    await fs.mkdir(path.join(value.artifactRoot, "decisions"), { recursive: true });
    await fs.writeFile(path.join(value.artifactRoot, decisionPath), jsonBytes(await signedDecision(value, pending)));
    const applied = await runSupervisedTransferJob({ ...options(value, "apply"), decisionPath });
    const forged = structuredClone(applied) as unknown as {
      status: string;
      stops: Array<{ attempts: Array<{ decision: { outcome: string } | null }> }>;
    };
    forged.status = "revision-requested";
    forged.stops[0]!.attempts[0]!.decision!.outcome = "revision-requested";
    expect(validateSupervisedTransfer(forged).valid).toBe(true);
    await fs.writeFile(value.ledgerPath, jsonBytes(forged));
    await expect(runSupervisedTransferJob(options(value, "init"))).rejects.toThrow(/outcome does not match/);
  });

  it("fails closed on lock contention, owner ambiguity, and symlinked ledger parents", async () => {
    const value = await fixture();
    const lock = await acquireSupervisedTransferLedgerLock(value.ledgerPath);
    await expect(runSupervisedTransferJob(options(value, "init"))).rejects.toThrow(/already locked/);
    const other = JSON.parse(await fs.readFile(lock.path, "utf8"));
    other.token = "another-runner";
    await fs.writeFile(lock.path, jsonBytes(other));
    await expect(lock.release()).rejects.toThrow(/owned by another runner/);
    await fs.rm(lock.path);

    const realState = path.join(value.root, "real-state");
    const aliasState = path.join(value.root, "alias-state");
    await fs.mkdir(realState);
    await fs.symlink(realState, aliasState, "dir");
    await expect(runSupervisedTransferJob({
      ...options(value, "init"), ledgerPath: path.join(aliasState, "ledger.json"),
    })).rejects.toThrow(/must not be a symbolic link/);
  });
});
