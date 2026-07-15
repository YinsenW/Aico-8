import type { AuthorityActor, CommitDecisionInput, CreateChallengeInput, RegisterAuthorityInput } from "./service.js";
import type { AuthorityRecord } from "./ports.js";
import {
  AuthorityAnchorPendingError,
  AuthorityConflictError,
  AuthorityPolicyError,
  AuthorityRollbackError,
  HumanAuthorityService,
} from "./service.js";

type JsonRecord = Record<string, unknown>;
const HASH_ETAG = /^"([a-f0-9]{64})"$/;
const TRANSFER_PATH = /^\/v1\/transfers\/([A-Za-z0-9_-]{22,128})\/(challenges|decisions|head)$/;

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

async function body(request: Request): Promise<JsonRecord> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AuthorityPolicyError("content-type must be application/json");
  }
  const value: unknown = await request.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AuthorityPolicyError("request body must be an object");
  return value as JsonRecord;
}

function only(value: JsonRecord, keys: readonly string[]): void {
  const allowed = new Set(keys);
  for (const key of keys) if (!(key in value)) throw new AuthorityPolicyError(`${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new AuthorityPolicyError(`${key} is not allowed`);
}

function expectedHead(request: Request, registration = false): string | null {
  const value = request.headers.get(registration ? "if-none-match" : "if-match");
  if (registration) {
    if (value !== "*") throw new AuthorityPolicyError("registration requires If-None-Match: *");
    return null;
  }
  const match = value?.match(HASH_ETAG);
  if (!match?.[1]) throw new AuthorityPolicyError("transition requires a quoted SHA-256 If-Match head");
  return match[1];
}

function requiredString(value: JsonRecord, key: string): string {
  if (typeof value[key] !== "string") throw new AuthorityPolicyError(`${key} must be a string`);
  return value[key];
}

function requiredNumber(value: JsonRecord, key: string): number {
  if (!Number.isSafeInteger(value[key])) throw new AuthorityPolicyError(`${key} must be an integer`);
  return value[key] as number;
}

export class HumanAuthorityApi {
  readonly #service: HumanAuthorityService;

  constructor(service: HumanAuthorityService) {
    this.#service = service;
  }

  async handle(request: Request, authenticatedActor: AuthorityActor): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/v1/transfers/register") {
        const value = await body(request);
        only(value, ["operationId", "jobId", "gameId", "transferInstanceId", "sourceIdentitySha256", "targetProfileSha256", "manifestSha256", "authorityProfileSha256"]);
        const input: RegisterAuthorityInput = {
          operationId: requiredString(value, "operationId"),
          expectedPreviousHead: expectedHead(request, true),
          actor: authenticatedActor,
          jobId: requiredString(value, "jobId"),
          gameId: requiredString(value, "gameId"),
          transferInstanceId: requiredString(value, "transferInstanceId"),
          sourceIdentitySha256: requiredString(value, "sourceIdentitySha256"),
          targetProfileSha256: requiredString(value, "targetProfileSha256"),
          manifestSha256: requiredString(value, "manifestSha256"),
          authorityProfileSha256: requiredString(value, "authorityProfileSha256"),
        };
        return this.#receipt(await this.#service.register(input));
      }

      const match = url.pathname.match(TRANSFER_PATH);
      if (!match?.[1] || !match[2]) return json(404, { error: "not-found" });
      const transferInstanceId = match[1];
      if (request.method === "GET" && match[2] === "head") {
        const record = await this.#service.verifiedHead(transferInstanceId);
        return record ? this.#receipt(record) : json(404, { error: "not-found" });
      }
      if (request.method !== "POST") return json(405, { error: "method-not-allowed" }, { allow: match[2] === "head" ? "GET" : "POST" });
      const value = await body(request);
      const previous = expectedHead(request);
      if (match[2] === "challenges") {
        only(value, ["operationId", "stopId", "attempt", "proposalSha256", "requestSha256", "nonce"]);
        const input: CreateChallengeInput = {
          operationId: requiredString(value, "operationId"),
          expectedPreviousHead: previous,
          actor: authenticatedActor,
          transferInstanceId,
          stopId: requiredString(value, "stopId") as CreateChallengeInput["stopId"],
          attempt: requiredNumber(value, "attempt"),
          proposalSha256: requiredString(value, "proposalSha256"),
          requestSha256: requiredString(value, "requestSha256"),
          nonce: requiredString(value, "nonce"),
        };
        return this.#receipt(await this.#service.createChallenge(input));
      }
      only(value, ["operationId", "stopId", "attempt", "requestSha256", "decisionSha256", "resultLedgerSha256", "outcome", "scopeDisposition"]);
      const input: CommitDecisionInput = {
        operationId: requiredString(value, "operationId"),
        expectedPreviousHead: previous,
        actor: authenticatedActor,
        transferInstanceId,
        stopId: requiredString(value, "stopId") as CommitDecisionInput["stopId"],
        attempt: requiredNumber(value, "attempt"),
        requestSha256: requiredString(value, "requestSha256"),
        decisionSha256: requiredString(value, "decisionSha256"),
        resultLedgerSha256: requiredString(value, "resultLedgerSha256"),
        outcome: requiredString(value, "outcome") as CommitDecisionInput["outcome"],
        scopeDisposition: value.scopeDisposition === null ? null : requiredString(value, "scopeDisposition") as CommitDecisionInput["scopeDisposition"],
      };
      return this.#receipt(await this.#service.commitDecision(input));
    } catch (error) {
      if (error instanceof AuthorityPolicyError) return json(403, { error: "forbidden", message: error.message });
      if (error instanceof AuthorityConflictError) return json(409, { error: "head-conflict", message: error.message });
      if (error instanceof AuthorityRollbackError) return json(503, { error: "rollback-detected", message: error.message });
      if (error instanceof AuthorityAnchorPendingError) return json(503, { error: "anchor-pending", message: error.message }, { "retry-after": "1" });
      return json(500, { error: "internal-error" });
    }
  }

  #receipt(record: AuthorityRecord): Response {
    return json(200, {
      receipt: record.receipt,
      receiptSha256: record.receiptSha256,
      anchorStatus: record.anchorStatus,
    }, { etag: `"${record.receiptSha256}"` });
  }
}
