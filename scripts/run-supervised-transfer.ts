#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import {
  applySupervisedHumanDecision,
  assertSupervisedReviewProposal,
  submitSupervisedProposal,
  validateSupervisedTransfer,
  verifyHumanStopDecision,
  type HumanDecisionTrustKey,
  type HumanStopDecisionV1,
  type SupervisedTransferStopId,
  type SupervisedTransferV1,
  type SupervisedReviewProposalV1,
} from "../packages/contracts/src/index.ts";

const TRUST_STORE_SCHEMA_VERSION = "aico8.human-decision-trust-store.v1" as const;
const LEDGER_LOCK_SCHEMA_VERSION = "aico8.supervised-transfer-ledger-lock.v1" as const;
const USAGE = [
  "Usage:",
  "  pnpm exec tsx scripts/run-supervised-transfer.ts init --manifest <job.json> --root <dir> --ledger <ledger.json> --trust <trust.json>",
  "  pnpm exec tsx scripts/run-supervised-transfer.ts submit --manifest <job.json> --root <dir> --ledger <ledger.json> --trust <trust.json> --stop <stop-id> --proposal <relative-path>",
  "  pnpm exec tsx scripts/run-supervised-transfer.ts apply --manifest <job.json> --root <dir> --ledger <ledger.json> --trust <trust.json> --decision <relative-path>",
].join("\n");

export type SupervisedTransferAction = "init" | "submit" | "apply";

export interface SupervisedTransferJobOptions {
  readonly action: SupervisedTransferAction;
  readonly manifestPath: string;
  readonly artifactRoot: string;
  readonly ledgerPath: string;
  readonly trustStorePath: string;
  readonly stopId?: SupervisedTransferStopId;
  readonly proposalPath?: string;
  readonly decisionPath?: string;
}

export interface SupervisedTransferLedgerLock {
  readonly path: string;
  readonly token: string;
  release(): Promise<void>;
}

interface HumanDecisionTrustStoreV1 {
  readonly schemaVersion: typeof TRUST_STORE_SCHEMA_VERSION;
  readonly profileId: string;
  readonly keys: readonly HumanDecisionTrustKey[];
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readRegularFile(file: string, label: string): Promise<Buffer> {
  const resolved = path.resolve(file);
  let handle;
  try {
    handle = await fs.open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`${label} is not a regular file: ${resolved}`);
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const named = await fs.lstat(resolved);
    if (named.isSymbolicLink() || named.dev !== before.dev || named.ino !== before.ino
      || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`${label} changed identity while it was being read: ${resolved}`);
    }
    return bytes;
  } catch (error) {
    throw new Error(`Unable to read ${label} ${resolved} safely: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireValidTransfer(value: unknown, label: string): SupervisedTransferV1 {
  const validation = validateSupervisedTransfer(value);
  if (!validation.valid) throw new Error(`Invalid ${label}:\n${validation.errors.join("\n")}`);
  return structuredClone(value) as SupervisedTransferV1;
}

function requirePristineManifest(value: unknown): SupervisedTransferV1 {
  const manifest = requireValidTransfer(value, "supervised transfer manifest");
  if (manifest.status !== "working" || manifest.stops.some(({ attempts }) => attempts.length !== 0)) {
    throw new Error("Supervised transfer manifest must be a pristine immutable job identity with no attempts");
  }
  return manifest;
}

function exactObjectKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!isDeepStrictEqual(actual, wanted)) throw new Error(`${label} has unsupported or missing fields`);
}

function requireTrustStore(value: unknown): HumanDecisionTrustStoreV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Human decision trust store must be an object");
  }
  const root = value as Record<string, unknown>;
  exactObjectKeys(root, ["schemaVersion", "profileId", "keys"], "Human decision trust store");
  if (root.schemaVersion !== TRUST_STORE_SCHEMA_VERSION) {
    throw new Error(`Human decision trust store schemaVersion must equal ${TRUST_STORE_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(root.keys) || root.keys.length === 0) {
    throw new Error("Human decision trust store keys must be a non-empty array");
  }
  if (typeof root.profileId !== "string" || !/^[a-z0-9][a-z0-9._:-]{1,127}$/.test(root.profileId)) {
    throw new Error("Human decision trust store profileId must be a valid id");
  }
  const keys = root.keys.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Human decision trust store key ${index} must be an object`);
    }
    const key = value as Record<string, unknown>;
    exactObjectKeys(key, ["keyId", "publicKeySpkiBase64", "publicKeySha256"], `Human decision trust store key ${index}`);
    if (typeof key.keyId !== "string" || typeof key.publicKeySpkiBase64 !== "string" || typeof key.publicKeySha256 !== "string") {
      throw new Error(`Human decision trust store key ${index} fields must be strings`);
    }
    const spki = Buffer.from(key.publicKeySpkiBase64, "base64");
    const canonical = spki.toString("base64").replace(/=+$/, "");
    if (spki.length === 0 || canonical !== key.publicKeySpkiBase64.replace(/=+$/, "")) {
      throw new Error(`Human decision trust store key ${index} public key is not canonical base64`);
    }
    if (sha256(spki) !== key.publicKeySha256) {
      throw new Error(`Human decision trust store key ${index} public-key hash mismatch`);
    }
    return {
      keyId: key.keyId,
      publicKeySpkiBase64: key.publicKeySpkiBase64,
      publicKeySha256: key.publicKeySha256,
    } satisfies HumanDecisionTrustKey;
  });
  if (new Set(keys.map(({ keyId }) => keyId)).size !== keys.length) {
    throw new Error("Human decision trust store keyId values must be unique");
  }
  return { schemaVersion: TRUST_STORE_SCHEMA_VERSION, profileId: root.profileId, keys };
}

function immutableTransferIdentity(job: SupervisedTransferV1): unknown {
  return {
    schemaVersion: job.schemaVersion,
    jobId: job.jobId,
    gameId: job.gameId,
    transferInstanceId: job.transferInstanceId,
    sourceIdentitySha256: job.sourceIdentitySha256,
    targetProfileSha256: job.targetProfileSha256,
    authority: job.authority,
    stops: job.stops.map(({ id, order }) => ({ id, order })),
  };
}

function assertResumeIdentity(manifest: SupervisedTransferV1, ledger: SupervisedTransferV1): void {
  if (!isDeepStrictEqual(immutableTransferIdentity(manifest), immutableTransferIdentity(ledger))) {
    throw new Error("Ledger immutable source/profile/authority identity does not match the manifest");
  }
}

function assertTrustIdentity(
  manifest: SupervisedTransferV1,
  store: HumanDecisionTrustStoreV1,
  trustStoreSha256: string,
): void {
  if (store.profileId !== manifest.authority.profileId || trustStoreSha256 !== manifest.authority.profileSha256) {
    throw new Error("Trust store profile identity does not match the immutable job manifest");
  }
  const expected = [...manifest.authority.trustedReviewerKeys]
    .sort((left, right) => left.keyId.localeCompare(right.keyId));
  const actual = store.keys.map(({ keyId, publicKeySha256 }) => ({ keyId, publicKeySha256 }))
    .sort((left, right) => left.keyId.localeCompare(right.keyId));
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("Trust store reviewer identities do not match the immutable job manifest");
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes the declared artifact root: ${candidate}`);
  }
}

async function readArtifact(root: string, relative: string, label: string): Promise<Buffer> {
  const candidate = path.resolve(root, relative);
  assertContained(root, candidate, label);
  const bytes = await readRegularFile(candidate, label);
  const real = await fs.realpath(candidate);
  assertContained(root, real, label);
  if (real !== candidate) throw new Error(`${label} must not traverse a symbolic link: ${candidate}`);
  return bytes;
}

async function verifyLedgerArtifacts(
  ledger: SupervisedTransferV1,
  root: string,
  trustKeys: readonly HumanDecisionTrustKey[],
): Promise<void> {
  let upstreamDecisionSha256: string | null = null;
  const decisionIds = new Set<string>();
  const decisionNonces = new Set<string>();
  const decisionDigests = new Set<string>();
  const proposalNonces = new Set<string>();
  for (const stop of ledger.stops) {
    for (const [attemptIndex, attempt] of stop.attempts.entries()) {
      const proposalBytes = await readArtifact(root, attempt.proposal.path, "supervised proposal");
      if (sha256(proposalBytes) !== attempt.proposal.sha256) {
        throw new Error(`Supervised proposal bytes changed after submission: ${attempt.proposal.path}`);
      }
      const proposalValue = parseJson(proposalBytes, `supervised proposal ${attempt.proposal.path}`);
      assertSupervisedReviewProposal(proposalValue);
      const proposal = proposalValue as SupervisedReviewProposalV1;
      const previousAttempt = stop.attempts[attemptIndex - 1];
      const expectedProposal = {
        jobId: ledger.jobId,
        gameId: ledger.gameId,
        transferInstanceId: ledger.transferInstanceId,
        sourceIdentitySha256: ledger.sourceIdentitySha256,
        targetProfileSha256: ledger.targetProfileSha256,
        authorityProfileSha256: ledger.authority.profileSha256,
        stopId: stop.id,
        attempt: attempt.attempt,
        upstreamDecisionSha256: attempt.proposal.upstreamDecisionSha256,
        previousProposalSha256: previousAttempt?.proposal.sha256 ?? null,
        previousRevisionDecisionSha256: previousAttempt?.decision?.outcome === "revision-requested"
          ? previousAttempt.decision.sha256
          : null,
      } as const;
      for (const [key, expectedValue] of Object.entries(expectedProposal)) {
        if (proposal[key as keyof SupervisedReviewProposalV1] !== expectedValue) {
          throw new Error(`Stored supervised proposal ${key} does not match its ledger attempt`);
        }
      }
      await verifyProposalEvidence(proposal, root);
      if (attempt.proposal.upstreamDecisionSha256 !== upstreamDecisionSha256) {
        throw new Error(`Supervised proposal has stale upstream decision lineage: ${attempt.proposal.path}`);
      }
      if (proposalNonces.has(attempt.proposal.decisionNonce)) {
        throw new Error(`Supervised proposal reuses a decision challenge nonce: ${attempt.proposal.path}`);
      }
      proposalNonces.add(attempt.proposal.decisionNonce);
      if (!attempt.decision) continue;
      const decisionBytes = await readArtifact(root, attempt.decision.path, "human stop decision");
      if (sha256(decisionBytes) !== attempt.decision.sha256) {
        throw new Error(`Human stop decision bytes changed after application: ${attempt.decision.path}`);
      }
      const decision = parseJson(decisionBytes, `human stop decision ${attempt.decision.path}`) as HumanStopDecisionV1;
      const verification = await verifyHumanStopDecision(decision, trustKeys);
      if (!verification.valid || !verification.authenticated) {
        throw new Error(`Stored human stop decision is not authenticated: ${verification.errors.join("; ")}`);
      }
      if (decisionIds.has(decision.decisionId)) throw new Error(`Human decisionId is reused: ${decision.decisionId}`);
      if (decisionNonces.has(decision.nonce)) throw new Error(`Human decision nonce is reused: ${decision.nonce}`);
      if (decisionDigests.has(attempt.decision.sha256)) throw new Error(`Human decision digest is reused: ${attempt.decision.sha256}`);
      decisionIds.add(decision.decisionId);
      decisionNonces.add(decision.nonce);
      decisionDigests.add(attempt.decision.sha256);
      const expected = {
        jobId: ledger.jobId,
        gameId: ledger.gameId,
        transferInstanceId: ledger.transferInstanceId,
        sourceIdentitySha256: ledger.sourceIdentitySha256,
        targetProfileSha256: ledger.targetProfileSha256,
        authorityProfileSha256: ledger.authority.profileSha256,
        stopId: stop.id,
        attempt: attempt.attempt,
        proposalSha256: attempt.proposal.sha256,
        priorDecisionSha256: attempt.proposal.upstreamDecisionSha256,
        outcome: attempt.decision.outcome,
        scopeDisposition: attempt.decision.scopeDisposition,
        reviewerKeyId: attempt.decision.reviewerKeyId,
        nonce: attempt.proposal.decisionNonce,
      };
      for (const [key, expectedValue] of Object.entries(expected)) {
        if (decision[key as keyof HumanStopDecisionV1] !== expectedValue) {
          throw new Error(`Stored human stop decision ${key} does not match its ledger reference`);
        }
      }
    }
    const latest = stop.attempts.at(-1)?.decision;
    if (latest?.outcome === "approved") upstreamDecisionSha256 = latest.sha256;
  }
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  const resolved = path.resolve(file);
  const directory = path.dirname(resolved);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(jsonBytes(value));
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, resolved);
    const directoryHandle = await fs.open(directory, "r").catch(() => undefined);
    await directoryHandle?.sync().catch(() => undefined);
    await directoryHandle?.close().catch(() => undefined);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export function supervisedTransferLedgerLockPath(ledgerPath: string): string {
  return `${path.resolve(ledgerPath)}.lock`;
}

async function canonicalLedgerPath(requested: string): Promise<string> {
  const resolved = path.resolve(requested);
  const parent = path.dirname(resolved);
  await fs.mkdir(parent, { recursive: true });
  const parentStatus = await fs.lstat(parent);
  if (parentStatus.isSymbolicLink()) throw new Error(`Ledger parent path must not be a symbolic link: ${parent}`);
  const realParent = await fs.realpath(parent);
  try {
    const status = await fs.lstat(resolved);
    if (status.isSymbolicLink()) throw new Error(`Ledger must not be a symbolic link: ${resolved}`);
    if (!status.isFile()) throw new Error(`Ledger is not a regular file: ${resolved}`);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  return path.join(realParent, path.basename(resolved));
}

export async function acquireSupervisedTransferLedgerLock(ledgerPath: string): Promise<SupervisedTransferLedgerLock> {
  const resolvedLedger = await canonicalLedgerPath(ledgerPath);
  const lockPath = supervisedTransferLedgerLockPath(resolvedLedger);
  const token = randomUUID();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    let owner = "unreadable owner";
    try {
      const value = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: unknown; token?: unknown };
      owner = `pid ${String(value.pid ?? "unknown")}, token ${String(value.token ?? "unknown")}`;
    } catch {
      // Ambiguous locks fail closed and require an explicit operator recovery.
    }
    throw new Error(`Supervised transfer ledger is already locked by another runner (${owner}): ${lockPath}`);
  }
  try {
    await handle.writeFile(jsonBytes({
      schemaVersion: LEDGER_LOCK_SCHEMA_VERSION,
      token,
      pid: process.pid,
      ledgerPath: resolvedLedger,
    }));
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true });
    throw error;
  }
  await handle.close();
  let released = false;
  return {
    path: lockPath,
    token,
    async release(): Promise<void> {
      if (released) return;
      let current: unknown;
      try {
        current = JSON.parse(await fs.readFile(lockPath, "utf8"));
      } catch (error) {
        throw new Error(`Cannot release supervised transfer lock without verifying its owner: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (typeof current !== "object" || current === null
        || !("schemaVersion" in current) || current.schemaVersion !== LEDGER_LOCK_SCHEMA_VERSION
        || !("ledgerPath" in current) || current.ledgerPath !== resolvedLedger
        || !("token" in current) || current.token !== token) {
        throw new Error(`Refusing to remove a supervised transfer lock owned by another runner: ${lockPath}`);
      }
      await fs.unlink(lockPath);
      released = true;
    },
  };
}

async function existingLedger(file: string): Promise<SupervisedTransferV1 | undefined> {
  try {
    await fs.access(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  return requireValidTransfer(parseJson(await readRegularFile(file, "supervised transfer ledger"), "supervised transfer ledger"), "supervised transfer ledger");
}

function decisionAlreadyApplied(
  ledger: SupervisedTransferV1,
  relativePath: string,
  digest: string,
): boolean {
  return ledger.stops.some(({ attempts }) => attempts.some(({ decision }) =>
    decision?.path === relativePath && decision.sha256 === digest));
}

function proposalAlreadySubmitted(
  ledger: SupervisedTransferV1,
  stopId: SupervisedTransferStopId,
  relativePath: string,
  digest: string,
): boolean {
  return ledger.stops.find(({ id }) => id === stopId)?.attempts.some(({ proposal }) =>
    proposal.path === relativePath && proposal.sha256 === digest) ?? false;
}

function assertProposalMatchesLedger(
  proposal: SupervisedReviewProposalV1,
  ledger: SupervisedTransferV1,
  stopId: SupervisedTransferStopId,
): void {
  const stop = ledger.stops.find(({ id }) => id === stopId);
  if (!stop) throw new Error(`Supervised proposal names unknown stop ${stopId}`);
  const previousAttempt = stop.attempts.at(-1);
  const upstreamDecisionSha256 = stop.order === 1
    ? null
    : ledger.stops[stop.order - 2]!.attempts.at(-1)?.decision?.sha256 ?? null;
  const expected = {
    jobId: ledger.jobId,
    gameId: ledger.gameId,
    transferInstanceId: ledger.transferInstanceId,
    sourceIdentitySha256: ledger.sourceIdentitySha256,
    targetProfileSha256: ledger.targetProfileSha256,
    authorityProfileSha256: ledger.authority.profileSha256,
    stopId,
    attempt: stop.attempts.length + 1,
    upstreamDecisionSha256,
    previousProposalSha256: previousAttempt?.proposal.sha256 ?? null,
    previousRevisionDecisionSha256: previousAttempt?.decision?.outcome === "revision-requested"
      ? previousAttempt.decision.sha256
      : null,
  } as const;
  for (const [key, value] of Object.entries(expected)) {
    if (proposal[key as keyof SupervisedReviewProposalV1] !== value) {
      throw new Error(`Supervised proposal ${key} does not match the current ledger`);
    }
  }
}

async function verifyProposalEvidence(proposal: SupervisedReviewProposalV1, root: string): Promise<void> {
  for (const evidence of proposal.evidence) {
    const bytes = await readArtifact(root, evidence.path, `proposal evidence ${evidence.id}`);
    if (sha256(bytes) !== evidence.sha256) {
      throw new Error(`Proposal evidence ${evidence.id} bytes do not match its declared SHA-256`);
    }
  }
}

export async function runSupervisedTransferJob(options: SupervisedTransferJobOptions): Promise<SupervisedTransferV1> {
  const manifestPath = path.resolve(options.manifestPath);
  const ledgerPath = await canonicalLedgerPath(options.ledgerPath);
  if (manifestPath === ledgerPath) throw new Error("Ledger path must differ from the immutable supervised transfer manifest");
  const root = await fs.realpath(path.resolve(options.artifactRoot));
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`Artifact root is not a directory: ${root}`);
  const lock = await acquireSupervisedTransferLedgerLock(ledgerPath);
  try {
    const manifest = requirePristineManifest(parseJson(
      await readRegularFile(manifestPath, "supervised transfer manifest"),
      "supervised transfer manifest",
    ));
    const trustStoreBytes = await readRegularFile(options.trustStorePath, "human decision trust store");
    const trustStore = requireTrustStore(parseJson(trustStoreBytes, "human decision trust store"));
    assertTrustIdentity(manifest, trustStore, sha256(trustStoreBytes));
    const recovered = await existingLedger(ledgerPath);
    if (recovered) assertResumeIdentity(manifest, recovered);
    const ledger = recovered ?? manifest;
    await verifyLedgerArtifacts(ledger, root, trustStore.keys);

    if (options.action === "init") {
      if (options.stopId || options.proposalPath || options.decisionPath) {
        throw new Error("init does not accept stop, proposal, or decision options");
      }
      if (!recovered) await writeAtomic(ledgerPath, ledger);
      return ledger;
    }

    if (options.action === "submit") {
      if (!options.stopId || !options.proposalPath || options.decisionPath) {
        throw new Error("submit requires stop and proposal, and does not accept decision");
      }
      const proposalBytes = await readArtifact(root, options.proposalPath, "supervised proposal");
      const proposalValue = parseJson(proposalBytes, "supervised proposal");
      assertSupervisedReviewProposal(proposalValue);
      const proposal = proposalValue as SupervisedReviewProposalV1;
      await verifyProposalEvidence(proposal, root);
      const digest = sha256(proposalBytes);
      if (proposalAlreadySubmitted(ledger, options.stopId, options.proposalPath, digest)) return ledger;
      assertProposalMatchesLedger(proposal, ledger, options.stopId);
      const updated = submitSupervisedProposal(ledger, {
        stopId: options.stopId,
        path: options.proposalPath,
        sha256: digest,
        decisionNonce: randomUUID().replace(/-/g, ""),
      });
      await writeAtomic(ledgerPath, updated);
      return updated;
    }

    if (options.stopId || options.proposalPath || !options.decisionPath) {
      throw new Error("apply requires decision, and does not accept stop or proposal");
    }
    const decisionBytes = await readArtifact(root, options.decisionPath, "human stop decision");
    const digest = sha256(decisionBytes);
    if (decisionAlreadyApplied(ledger, options.decisionPath, digest)) return ledger;
    const updated = await applySupervisedHumanDecision(
      ledger,
      decisionBytes,
      options.decisionPath,
      trustStore.keys,
    );
    await writeAtomic(ledgerPath, updated);
    return updated;
  } finally {
    await lock.release();
  }
}

export function parseSupervisedTransferCliArguments(argv: readonly string[]): SupervisedTransferJobOptions {
  const action = argv[0];
  if (action !== "init" && action !== "submit" && action !== "apply") throw new Error(USAGE);
  const optionArguments = argv.slice(1);
  if (optionArguments.length % 2 !== 0) throw new Error(`${USAGE}\nOptions must be flag/value pairs`);
  const allowed = new Set(["--manifest", "--root", "--ledger", "--trust", "--stop", "--proposal", "--decision"]);
  const values = new Map<string, string>();
  for (let index = 0; index < optionArguments.length; index += 2) {
    const key = optionArguments[index]!;
    const value = optionArguments[index + 1]!;
    if (!allowed.has(key)) throw new Error(`Unsupported supervised transfer option: ${key}`);
    if (values.has(key)) throw new Error(`Duplicate supervised transfer option: ${key}`);
    if (!value || value.includes("\0")) throw new Error(`Invalid value for supervised transfer option: ${key}`);
    values.set(key, value);
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing required supervised transfer option: ${key}`);
    return value;
  };
  const stopId = values.get("--stop");
  return {
    action,
    manifestPath: required("--manifest"),
    artifactRoot: required("--root"),
    ledgerPath: required("--ledger"),
    trustStorePath: required("--trust"),
    ...(stopId ? { stopId: stopId as SupervisedTransferStopId } : {}),
    ...(values.get("--proposal") ? { proposalPath: values.get("--proposal")! } : {}),
    ...(values.get("--decision") ? { decisionPath: values.get("--decision")! } : {}),
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  const result = await runSupervisedTransferJob(parseSupervisedTransferCliArguments(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
