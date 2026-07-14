export const BATCH_SCHEMA_VERSION = "aico8.batch.v1" as const;

export type BatchStatus = "queued" | "running" | "partial" | "complete" | "failed";
export type BatchGameState = "queued" | "running" | "blocked" | "failed" | "accepted";
export type BatchStage = "ingest" | "compatibility" | "gameplay" | "hd-review" | "web-package" | "accepted";

export interface BatchGameV1 {
  readonly gameId: string;
  readonly cartSha256: string;
  readonly workspaceId: string;
  readonly priority: number;
  readonly state: BatchGameState;
  readonly stage: BatchStage;
  readonly attempt: number;
  readonly failureClass?: string;
  readonly evidence: {
    readonly canonicalReplaySha256?: string;
    readonly hdReviewDecisionSha256?: string;
    readonly webPackageSha256?: string;
  };
}

export interface BatchV1 {
  readonly schemaVersion: typeof BATCH_SCHEMA_VERSION;
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly policy: {
    readonly maxParallel: number;
    readonly failureIsolation: true;
    readonly acceptanceRequiresEvidence: true;
  };
  readonly games: readonly BatchGameV1[];
}

export interface BatchValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const STATES = new Set<BatchGameState>(["queued", "running", "blocked", "failed", "accepted"]);
const STAGES = new Set<BatchStage>(["ingest", "compatibility", "gameplay", "hd-review", "web-package", "accepted"]);
type UnknownRecord = Record<string, unknown>;

function object(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function validString(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function derivedStatus(games: readonly BatchGameV1[]): BatchStatus {
  if (games.every(({ state }) => state === "queued")) return "queued";
  if (games.some(({ state }) => state === "queued" || state === "running")) return "running";
  const accepted = games.filter(({ state }) => state === "accepted").length;
  if (accepted === games.length) return "complete";
  return accepted > 0 ? "partial" : "failed";
}

export function acceptedBatchGameIds(batch: BatchV1): readonly string[] {
  return batch.games.filter(({ state }) => state === "accepted").map(({ gameId }) => gameId);
}

export function validateBatch(value: unknown): BatchValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, ["schemaVersion", "batchId", "status", "policy", "games"], [], "$", errors);
  if (value.schemaVersion !== BATCH_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${BATCH_SCHEMA_VERSION}`);
  if (!validString(value.batchId, ID)) errors.push("$.batchId must be a valid id");

  let maxParallel = 0;
  if (!object(value.policy)) errors.push("$.policy must be an object");
  else {
    exactKeys(value.policy, ["maxParallel", "failureIsolation", "acceptanceRequiresEvidence"], [], "$.policy", errors);
    if (!Number.isSafeInteger(value.policy.maxParallel) || (value.policy.maxParallel as number) < 1 || (value.policy.maxParallel as number) > 8) {
      errors.push("$.policy.maxParallel must be an integer from 1 through 8");
    } else maxParallel = value.policy.maxParallel as number;
    if (value.policy.failureIsolation !== true) errors.push("$.policy.failureIsolation must equal true");
    if (value.policy.acceptanceRequiresEvidence !== true) errors.push("$.policy.acceptanceRequiresEvidence must equal true");
  }

  const games: BatchGameV1[] = [];
  const gameIds = new Set<string>();
  const cartHashes = new Set<string>();
  const workspaceIds = new Set<string>();
  const priorities = new Set<number>();
  if (!Array.isArray(value.games) || value.games.length === 0) errors.push("$.games must be a non-empty array");
  else value.games.forEach((unknownGame, index) => {
    const path = `$.games[${index}]`;
    if (!object(unknownGame)) { errors.push(`${path} must be an object`); return; }
    exactKeys(unknownGame, ["gameId", "cartSha256", "workspaceId", "priority", "state", "stage", "attempt", "evidence"], ["failureClass"], path, errors);
    if (!validString(unknownGame.gameId, ID)) errors.push(`${path}.gameId must be a valid id`);
    else if (gameIds.has(unknownGame.gameId)) errors.push(`${path}.gameId must be unique`); else gameIds.add(unknownGame.gameId);
    if (!validString(unknownGame.cartSha256, HASH)) errors.push(`${path}.cartSha256 must be a sha256`);
    else if (cartHashes.has(unknownGame.cartSha256)) errors.push(`${path}.cartSha256 must be unique`); else cartHashes.add(unknownGame.cartSha256);
    if (!validString(unknownGame.workspaceId, ID)) errors.push(`${path}.workspaceId must be a valid id`);
    else if (workspaceIds.has(unknownGame.workspaceId)) errors.push(`${path}.workspaceId must be unique`); else workspaceIds.add(unknownGame.workspaceId);
    if (!Number.isSafeInteger(unknownGame.priority) || (unknownGame.priority as number) < 1) errors.push(`${path}.priority must be a positive integer`);
    else if (priorities.has(unknownGame.priority as number)) errors.push(`${path}.priority must be unique`); else priorities.add(unknownGame.priority as number);
    if (!STATES.has(unknownGame.state as BatchGameState)) errors.push(`${path}.state is unsupported`);
    if (!STAGES.has(unknownGame.stage as BatchStage)) errors.push(`${path}.stage is unsupported`);
    if (!Number.isSafeInteger(unknownGame.attempt) || (unknownGame.attempt as number) < 1) errors.push(`${path}.attempt must be a positive integer`);
    if ((unknownGame.state === "blocked" || unknownGame.state === "failed") && !validString(unknownGame.failureClass, ID)) {
      errors.push(`${path}.failureClass is required for blocked or failed games`);
    }
    if (unknownGame.state === "accepted" && unknownGame.stage !== "accepted") errors.push(`${path} accepted state requires accepted stage`);
    if (unknownGame.state !== "accepted" && unknownGame.stage === "accepted") errors.push(`${path} accepted stage requires accepted state`);
    if (!object(unknownGame.evidence)) errors.push(`${path}.evidence must be an object`);
    else {
      const evidence = unknownGame.evidence;
      exactKeys(evidence, [], ["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256"], `${path}.evidence`, errors);
      const keys = ["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256"] as const;
      for (const key of keys) if (key in evidence && !validString(evidence[key], HASH)) errors.push(`${path}.evidence.${key} must be a sha256`);
      if (unknownGame.state === "accepted" && keys.some((key) => !validString(evidence[key], HASH))) {
        errors.push(`${path} accepted state requires replay, HD review, and Web package evidence`);
      }
    }
    games.push(unknownGame as unknown as BatchGameV1);
  });

  if (maxParallel > 0 && games.filter(({ state }) => state === "running").length > maxParallel) {
    errors.push("$.games has more running games than policy.maxParallel");
  }
  if (games.length > 0) {
    const expected = derivedStatus(games);
    if (value.status !== expected) errors.push(`$.status must equal derived status ${expected}`);
  }
  return { ok: errors.length === 0, errors };
}
