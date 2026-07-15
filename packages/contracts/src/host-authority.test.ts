import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  HOST_AUTHORITY_PROFILE_SCHEMA_VERSION,
  HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION,
  hostAuthorityProfileSha256,
  hostAuthorityReceiptSigningBytes,
  validateHostAuthorityProfile,
  validateHostAuthorityReceipt,
  verifyHostAuthorityReceipt,
  type HostAuthorityProfileV1,
  type HostAuthorityReceiptV1,
} from "./host-authority.js";

const keyPair = generateKeyPairSync("ed25519");
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateProfileSchema = ajv.compile(JSON.parse(fs.readFileSync(new URL("../../../specs/schemas/host-authority-profile-v1.schema.json", import.meta.url), "utf8")));
const validateReceiptSchema = ajv.compile(JSON.parse(fs.readFileSync(new URL("../../../specs/schemas/host-authority-receipt-v1.schema.json", import.meta.url), "utf8")));
const spki = keyPair.publicKey.export({ type: "spki", format: "der" });
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

async function registration(): Promise<HostAuthorityReceiptV1> {
  const receipt: HostAuthorityReceiptV1 = {
    schemaVersion: HOST_AUTHORITY_RECEIPT_SCHEMA_VERSION,
    receiptId: "receipt.registration.1",
    kind: "registration",
    hostProfileSha256: await hostAuthorityProfileSha256(profile),
    hostId: profile.hostId,
    jobId: "steps.transfer",
    gameId: "steps-private-research",
    transferInstanceId: "IIIIIIIIIIIIIIIIIIIIII",
    sourceIdentitySha256: "a".repeat(64),
    targetProfileSha256: "b".repeat(64),
    manifestSha256: "c".repeat(64),
    authorityProfileSha256: "d".repeat(64),
    sequence: 1,
    previousReceiptSha256: null,
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
    signingKeyId: profile.signingKey.keyId,
    signatureAlgorithm: "ed25519",
    signature: "A".repeat(86),
  };
  return {
    ...receipt,
    signature: sign(null, hostAuthorityReceiptSigningBytes(receipt), keyPair.privateKey).toString("base64url"),
  };
}

describe("trusted human authority host contracts", () => {
  it("authenticates a pinned registration receipt at the empty head", async () => {
    const receipt = await registration();
    expect(validateHostAuthorityProfile(profile)).toEqual({ valid: true, errors: [] });
    expect(validateHostAuthorityReceipt(receipt)).toEqual({ valid: true, errors: [] });
    expect(validateProfileSchema(profile), JSON.stringify(validateProfileSchema.errors)).toBe(true);
    expect(validateReceiptSchema(receipt), JSON.stringify(validateReceiptSchema.errors)).toBe(true);
    expect(await verifyHostAuthorityReceipt(receipt, profile, null)).toEqual({ valid: true, authenticated: true, errors: [] });
  });

  it("rejects a stale local head and any widened Agent capability", async () => {
    const receipt = await registration();
    expect((await verifyHostAuthorityReceipt(receipt, profile, "9".repeat(64))).errors.join("\n")).toMatch(/expected current head/);
    const widened = structuredClone(profile) as unknown as { agentCapabilities: { mayWriteHead: boolean } };
    widened.agentCapabilities.mayWriteHead = true;
    expect(validateHostAuthorityProfile(widened).errors.join("\n")).toMatch(/deny every Agent authority/);
  });

  it("rejects receipts that do not bind the registered manifest and trust profile", async () => {
    const receipt = await registration() as unknown as Record<string, unknown>;
    receipt.manifestSha256 = null;
    receipt.authorityProfileSha256 = "not-a-hash";
    expect(validateHostAuthorityReceipt(receipt).errors.join("\n")).toMatch(/manifestSha256.*hash/);
    expect(validateHostAuthorityReceipt(receipt).errors.join("\n")).toMatch(/authorityProfileSha256.*hash/);
  });

  it("rejects a challenge that does not bind all frozen review identities", async () => {
    const receipt = await registration() as unknown as Record<string, unknown>;
    receipt.kind = "challenge";
    receipt.sequence = 2;
    receipt.previousReceiptSha256 = "8".repeat(64);
    receipt.stopId = "semantic-intent";
    receipt.attempt = 1;
    receipt.requestSha256 = "f".repeat(64);
    receipt.nonce = "NNNNNNNNNNNNNNNNNNNNNN";
    expect(validateHostAuthorityReceipt(receipt).errors.join("\n")).toMatch(/proposal, request, and nonce/);
  });
});
