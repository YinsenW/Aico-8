import {
  hostAuthorityReceiptSha256,
  validateHostAuthorityProfile,
  verifyHostAuthorityReceipt,
  type HostAuthorityProfileV1,
  type HostAuthorityReceiptV1,
} from "@aico8/contracts";

export type AuthorityProbeRole = "administrator" | "agent" | "reviewer";

export interface AuthorityProbeTransport {
  request(role: AuthorityProbeRole, path: string, init?: RequestInit): Promise<Response>;
}

export interface AuthorityDeploymentProbeResult {
  readonly schemaVersion: "aico8.authority-deployment-probe.v1";
  readonly completedAt: string;
  readonly hostId: string;
  readonly transferInstanceId: string;
  readonly finalReceiptSha256: string;
  readonly checks: readonly [
    "agent-registration-denied",
    "administrator-registration-signed",
    "agent-challenge-signed",
    "stale-head-denied",
    "agent-decision-denied",
    "reviewer-decision-signed",
    "decision-retry-idempotent",
    "latest-head-fresh-and-anchored",
  ];
  readonly limitations: readonly [
    "provider identity and key policies require independent configuration evidence",
    "crash injection and WORM retention require provider adapter conformance evidence",
  ];
}

export class AuthorityDeploymentProbeError extends Error {}

interface ReceiptEnvelope {
  readonly receipt: HostAuthorityReceiptV1;
  readonly receiptSha256: string;
  readonly anchorStatus: "anchored";
  readonly etag: string;
}

function randomSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function transferId(seed: string): string {
  return `probe_${seed}`;
}

async function hash(label: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(label));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function request(body: unknown, head: string | null): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(head === null ? { "if-none-match": "*" } : { "if-match": `"${head}"` }),
    },
    body: JSON.stringify(body),
  };
}

async function requireStatus(response: Response, expected: number, label: string): Promise<void> {
  if (response.status === expected) return;
  const text = (await response.text()).slice(0, 300);
  throw new AuthorityDeploymentProbeError(`${label} returned ${response.status}, expected ${expected}: ${text}`);
}

async function requireReceipt(
  response: Response,
  profile: HostAuthorityProfileV1,
  previousHead: string | null,
  label: string,
): Promise<ReceiptEnvelope> {
  await requireStatus(response, 200, label);
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AuthorityDeploymentProbeError(`${label} response is not an object`);
  const item = value as Record<string, unknown>;
  const receipt = item.receipt as HostAuthorityReceiptV1;
  const verification = await verifyHostAuthorityReceipt(receipt, profile, previousHead);
  if (!verification.valid || !verification.authenticated) throw new AuthorityDeploymentProbeError(`${label} receipt is not authenticated: ${verification.errors.join("; ")}`);
  const receiptSha256 = await hostAuthorityReceiptSha256(receipt);
  if (item.receiptSha256 !== receiptSha256) throw new AuthorityDeploymentProbeError(`${label} receipt hash does not match its bytes`);
  if (item.anchorStatus !== "anchored") throw new AuthorityDeploymentProbeError(`${label} head is not externally anchored`);
  const etag = response.headers.get("etag");
  if (etag !== `"${receiptSha256}"`) throw new AuthorityDeploymentProbeError(`${label} ETag does not match the signed head`);
  return { receipt, receiptSha256, anchorStatus: "anchored", etag };
}

export async function probeHumanAuthorityDeployment(input: {
  readonly profile: HostAuthorityProfileV1;
  readonly transport: AuthorityProbeTransport;
  readonly seed?: string;
  readonly now?: () => string;
}): Promise<AuthorityDeploymentProbeResult> {
  const profileValidation = validateHostAuthorityProfile(input.profile);
  if (!profileValidation.valid) throw new AuthorityDeploymentProbeError(`invalid pinned host profile: ${profileValidation.errors.join("; ")}`);
  const seed = input.seed ?? randomSeed();
  if (!/^[a-f0-9]{24}$/.test(seed)) throw new AuthorityDeploymentProbeError("probe seed must be 24 lowercase hexadecimal characters");
  const instance = transferId(seed);
  const identity = {
    operationId: `probe.${seed}.register`,
    jobId: `probe.${seed}`,
    gameId: "authority-conformance",
    transferInstanceId: instance,
    sourceIdentitySha256: await hash(`${seed}:source`),
    targetProfileSha256: await hash(`${seed}:target`),
    manifestSha256: await hash(`${seed}:manifest`),
    authorityProfileSha256: await hash(`${seed}:authority`),
  };

  await requireStatus(await input.transport.request("agent", "/v1/transfers/register", request(identity, null)), 403, "agent registration");
  const registered = await requireReceipt(
    await input.transport.request("administrator", "/v1/transfers/register", request(identity, null)),
    input.profile,
    null,
    "administrator registration",
  );
  const challengeBody = {
    operationId: `probe.${seed}.challenge`,
    stopId: "semantic-intent",
    attempt: 1,
    proposalSha256: await hash(`${seed}:proposal`),
    requestSha256: await hash(`${seed}:request`),
    nonce: `nonce_${seed}`,
  };
  const challenged = await requireReceipt(
    await input.transport.request("agent", `/v1/transfers/${instance}/challenges`, request(challengeBody, registered.receiptSha256)),
    input.profile,
    registered.receiptSha256,
    "agent challenge",
  );
  await requireStatus(await input.transport.request("agent", `/v1/transfers/${instance}/challenges`, request({
    ...challengeBody,
    operationId: `probe.${seed}.stale`,
  }, registered.receiptSha256)), 409, "stale challenge");

  const decisionBody = {
    operationId: `probe.${seed}.decision`,
    stopId: "semantic-intent",
    attempt: 1,
    requestSha256: challengeBody.requestSha256,
    decisionSha256: await hash(`${seed}:decision`),
    resultLedgerSha256: await hash(`${seed}:ledger`),
    outcome: "approved",
    scopeDisposition: null,
  };
  await requireStatus(await input.transport.request("agent", `/v1/transfers/${instance}/decisions`, request(decisionBody, challenged.receiptSha256)), 403, "agent decision");
  const committed = await requireReceipt(
    await input.transport.request("reviewer", `/v1/transfers/${instance}/decisions`, request(decisionBody, challenged.receiptSha256)),
    input.profile,
    challenged.receiptSha256,
    "reviewer decision",
  );
  const repeated = await requireReceipt(
    await input.transport.request("reviewer", `/v1/transfers/${instance}/decisions`, request(decisionBody, challenged.receiptSha256)),
    input.profile,
    challenged.receiptSha256,
    "idempotent decision retry",
  );
  if (repeated.receiptSha256 !== committed.receiptSha256) throw new AuthorityDeploymentProbeError("decision retry minted a different receipt");
  const latest = await requireReceipt(
    await input.transport.request("agent", `/v1/transfers/${instance}/head`),
    input.profile,
    challenged.receiptSha256,
    "latest head",
  );
  if (latest.receiptSha256 !== committed.receiptSha256) throw new AuthorityDeploymentProbeError("latest head is stale or replaced");

  return {
    schemaVersion: "aico8.authority-deployment-probe.v1",
    completedAt: input.now?.() ?? new Date().toISOString(),
    hostId: input.profile.hostId,
    transferInstanceId: instance,
    finalReceiptSha256: committed.receiptSha256,
    checks: [
      "agent-registration-denied",
      "administrator-registration-signed",
      "agent-challenge-signed",
      "stale-head-denied",
      "agent-decision-denied",
      "reviewer-decision-signed",
      "decision-retry-idempotent",
      "latest-head-fresh-and-anchored",
    ],
    limitations: [
      "provider identity and key policies require independent configuration evidence",
      "crash injection and WORM retention require provider adapter conformance evidence",
    ],
  };
}
