export const BATCH_SCHEMA_VERSION = "aico8.batch.v1" as const;

export type BatchStatus = "queued" | "running" | "partial" | "complete" | "failed";
export type BatchGameState = "queued" | "running" | "blocked" | "failed" | "accepted";
export type BatchTerminalState = Extract<BatchGameState, "blocked" | "failed" | "accepted">;
export type BatchStage = "ingest" | "compatibility" | "gameplay" | "hd-review" | "web-package" | "accepted";

export interface BatchEvidenceV1 {
  readonly canonicalReplaySha256?: string;
  readonly hdReviewDecisionSha256?: string;
  readonly webPackageSha256?: string;
}

export interface BatchAuthorizedInputV1 {
  readonly cartPath: string;
  readonly rightsProfile: string;
}

export interface BatchRequestedTargetV1 {
  readonly product: "standalone-web";
  readonly targetProfileId: string;
  readonly targetProfileSha256: string;
}

interface BatchAttemptResultBaseV1 {
  readonly attempt: number;
  readonly stage: BatchStage;
  readonly evidence: BatchEvidenceV1;
}

export interface BatchAcceptedAttemptResultV1 extends BatchAttemptResultBaseV1 {
  readonly outcome: "accepted";
  readonly stage: "accepted";
  readonly moduleId: string;
}

export interface BatchUnacceptedAttemptResultV1 extends BatchAttemptResultBaseV1 {
  readonly outcome: "blocked" | "failed";
  readonly failureClass: string;
}

export type BatchAttemptResultV1 = BatchAcceptedAttemptResultV1 | BatchUnacceptedAttemptResultV1;

export interface BatchGameV1 {
  readonly gameId: string;
  readonly cartSha256: string;
  readonly input: BatchAuthorizedInputV1;
  readonly request: BatchRequestedTargetV1;
  readonly workspaceId: string;
  readonly priority: number;
  readonly state: BatchGameState;
  readonly stage: BatchStage;
  readonly attempt: number;
  readonly attempts: readonly BatchAttemptResultV1[];
  readonly failureClass?: string;
  readonly evidence: BatchEvidenceV1;
}

export interface BatchV1 {
  readonly schemaVersion: typeof BATCH_SCHEMA_VERSION;
  readonly batchId: string;
  readonly status: BatchStatus;
  readonly policy: {
    readonly maxParallel: number;
    readonly maxAttempts: number;
    readonly attemptTimeoutMs: number;
    readonly failureIsolation: true;
    readonly acceptanceRequiresEvidence: true;
  };
  readonly games: readonly BatchGameV1[];
}

export interface BatchValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface BatchExecutorContext {
  readonly batchId: string;
  readonly gameId: string;
  readonly cartSha256: string;
  readonly input: BatchAuthorizedInputV1;
  readonly request: BatchRequestedTargetV1;
  readonly workspaceId: string;
  readonly attempt: number;
  readonly previousAttempts: readonly BatchAttemptResultV1[];
}

export type BatchExecutor = (context: BatchExecutorContext) => Promise<
  Omit<BatchAcceptedAttemptResultV1, "attempt"> | Omit<BatchUnacceptedAttemptResultV1, "attempt">
>;

export type BatchPersist = (batch: BatchV1) => Promise<void> | void;

export interface RunBatchOptions {
  readonly executor: BatchExecutor;
  readonly persist: BatchPersist;
}

export interface BatchAssemblyInput<T> {
  readonly gameId: string;
  readonly moduleId: string;
  readonly module: T;
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

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."
    && /^[A-Za-z0-9._-]+$/.test(segment));
}

function validateEvidence(value: unknown, path: string, errors: string[], requireComplete: boolean): void {
  if (!object(value)) { errors.push(`${path} must be an object`); return; }
  exactKeys(value, [], ["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256"], path, errors);
  const keys = ["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256"] as const;
  for (const key of keys) if (key in value && !validString(value[key], HASH)) errors.push(`${path}.${key} must be a sha256`);
  if (requireComplete && keys.some((key) => !validString(value[key], HASH))) {
    errors.push(`${path} requires replay, HD review, and Web package evidence`);
  }
}

function sameEvidence(left: BatchEvidenceV1, right: BatchEvidenceV1): boolean {
  return left.canonicalReplaySha256 === right.canonicalReplaySha256
    && left.hdReviewDecisionSha256 === right.hdReviewDecisionSha256
    && left.webPackageSha256 === right.webPackageSha256;
}

function derivedStatus(games: readonly BatchGameV1[]): BatchStatus {
  if (games.every(({ state }) => state === "queued")) return "queued";
  if (games.some(({ state }) => state === "queued" || state === "running")) return "running";
  const accepted = games.filter(({ state }) => state === "accepted").length;
  if (accepted === games.length) return "complete";
  return accepted > 0 ? "partial" : "failed";
}

export function batchWorkspaceId(batchId: string, gameId: string, cartSha256: string): string {
  if (!ID.test(batchId)) throw new Error("batchId must be a valid id");
  if (!ID.test(gameId)) throw new Error("gameId must be a valid id");
  if (!HASH.test(cartSha256)) throw new Error("cartSha256 must be a sha256");
  return `workspace-${batchId}-${gameId}-${cartSha256}`;
}

export function acceptedBatchGameIds(batch: BatchV1): readonly string[] {
  return batch.games.filter(({ state }) => state === "accepted").map(({ gameId }) => gameId);
}

export function selectAcceptedBatchAssemblyInputs<T>(
  batch: BatchV1,
  modulesById: ReadonlyMap<string, T>,
): readonly BatchAssemblyInput<T>[] {
  const validation = validateBatch(batch);
  if (!validation.ok) throw new Error(`Invalid batch assembly selection:\n${validation.errors.join("\n")}`);
  return batch.games.filter(({ state }) => state === "accepted").map((game) => {
    const latest = game.attempts.at(-1);
    if (!latest || latest.outcome !== "accepted") throw new Error(`${game.gameId} has no accepted attempt result`);
    const module = modulesById.get(latest.moduleId);
    if (module === undefined) throw new Error(`Missing accepted module ${latest.moduleId} for ${game.gameId}`);
    return { gameId: game.gameId, moduleId: latest.moduleId, module };
  });
}

export function validateBatch(value: unknown): BatchValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, ["schemaVersion", "batchId", "status", "policy", "games"], [], "$", errors);
  if (value.schemaVersion !== BATCH_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${BATCH_SCHEMA_VERSION}`);
  const batchIdValid = validString(value.batchId, ID);
  if (!batchIdValid) errors.push("$.batchId must be a valid id");

  let maxParallel = 0;
  let maxAttempts = 0;
  if (!object(value.policy)) errors.push("$.policy must be an object");
  else {
    exactKeys(value.policy, ["maxParallel", "maxAttempts", "attemptTimeoutMs", "failureIsolation", "acceptanceRequiresEvidence"], [], "$.policy", errors);
    if (!Number.isSafeInteger(value.policy.maxParallel) || (value.policy.maxParallel as number) < 1 || (value.policy.maxParallel as number) > 8) {
      errors.push("$.policy.maxParallel must be an integer from 1 through 8");
    } else maxParallel = value.policy.maxParallel as number;
    if (!Number.isSafeInteger(value.policy.maxAttempts) || (value.policy.maxAttempts as number) < 1 || (value.policy.maxAttempts as number) > 8) {
      errors.push("$.policy.maxAttempts must be an integer from 1 through 8");
    } else maxAttempts = value.policy.maxAttempts as number;
    if (!Number.isSafeInteger(value.policy.attemptTimeoutMs) || (value.policy.attemptTimeoutMs as number) < 100
      || (value.policy.attemptTimeoutMs as number) > 86_400_000) {
      errors.push("$.policy.attemptTimeoutMs must be an integer from 100 through 86400000");
    }
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
    exactKeys(unknownGame, ["gameId", "cartSha256", "input", "request", "workspaceId", "priority", "state", "stage", "attempt", "attempts", "evidence"], ["failureClass"], path, errors);
    const gameId = unknownGame.gameId;
    const gameIdValid = validString(gameId, ID);
    if (!gameIdValid) errors.push(`${path}.gameId must be a valid id`);
    else if (gameIds.has(gameId)) errors.push(`${path}.gameId must be unique`); else gameIds.add(gameId);
    const cartSha256 = unknownGame.cartSha256;
    const cartHashValid = validString(cartSha256, HASH);
    if (!cartHashValid) errors.push(`${path}.cartSha256 must be a sha256`);
    else if (cartHashes.has(cartSha256)) errors.push(`${path}.cartSha256 must be unique`); else cartHashes.add(cartSha256);
    if (!object(unknownGame.input)) errors.push(`${path}.input must be an object`);
    else {
      exactKeys(unknownGame.input, ["cartPath", "rightsProfile"], [], `${path}.input`, errors);
      if (!safeRelativePath(unknownGame.input.cartPath)) errors.push(`${path}.input.cartPath must be a safe relative path`);
      if (!validString(unknownGame.input.rightsProfile, ID)) errors.push(`${path}.input.rightsProfile must be a valid id`);
    }
    if (!object(unknownGame.request)) errors.push(`${path}.request must be an object`);
    else {
      exactKeys(unknownGame.request, ["product", "targetProfileId", "targetProfileSha256"], [], `${path}.request`, errors);
      if (unknownGame.request.product !== "standalone-web") errors.push(`${path}.request.product must equal standalone-web`);
      if (!validString(unknownGame.request.targetProfileId, ID)) errors.push(`${path}.request.targetProfileId must be a valid id`);
      if (!validString(unknownGame.request.targetProfileSha256, HASH)) errors.push(`${path}.request.targetProfileSha256 must be a sha256`);
    }
    const workspaceId = unknownGame.workspaceId;
    if (!validString(workspaceId, ID)) errors.push(`${path}.workspaceId must be a valid id`);
    else {
      if (workspaceIds.has(workspaceId)) errors.push(`${path}.workspaceId must be unique`); else workspaceIds.add(workspaceId);
      if (batchIdValid && gameIdValid && cartHashValid
        && workspaceId !== batchWorkspaceId(value.batchId as string, gameId, cartSha256)) {
        errors.push(`${path}.workspaceId must equal its deterministic batch/cart identity`);
      }
    }
    if (!Number.isSafeInteger(unknownGame.priority) || (unknownGame.priority as number) < 1) errors.push(`${path}.priority must be a positive integer`);
    else if (priorities.has(unknownGame.priority as number)) errors.push(`${path}.priority must be unique`); else priorities.add(unknownGame.priority as number);
    const stateValid = STATES.has(unknownGame.state as BatchGameState);
    if (!stateValid) errors.push(`${path}.state is unsupported`);
    const stageValid = STAGES.has(unknownGame.stage as BatchStage);
    if (!stageValid) errors.push(`${path}.stage is unsupported`);
    if (!Number.isSafeInteger(unknownGame.attempt) || (unknownGame.attempt as number) < 0) errors.push(`${path}.attempt must be a non-negative integer`);
    if ((unknownGame.state === "blocked" || unknownGame.state === "failed") && !validString(unknownGame.failureClass, ID)) {
      errors.push(`${path}.failureClass is required for blocked or failed games`);
    }
    if (unknownGame.state !== "blocked" && unknownGame.state !== "failed" && "failureClass" in unknownGame) {
      errors.push(`${path}.failureClass is allowed only for blocked or failed games`);
    }
    if (unknownGame.state === "accepted" && unknownGame.stage !== "accepted") errors.push(`${path} accepted state requires accepted stage`);
    if (unknownGame.state !== "accepted" && unknownGame.stage === "accepted") errors.push(`${path} accepted stage requires accepted state`);
    validateEvidence(unknownGame.evidence, `${path}.evidence`, errors, unknownGame.state === "accepted");

    const attempts: BatchAttemptResultV1[] = [];
    if (!Array.isArray(unknownGame.attempts)) errors.push(`${path}.attempts must be an array`);
    else unknownGame.attempts.forEach((unknownAttempt, attemptIndex) => {
      const attemptPath = `${path}.attempts[${attemptIndex}]`;
      if (!object(unknownAttempt)) { errors.push(`${attemptPath} must be an object`); return; }
      exactKeys(unknownAttempt, ["attempt", "outcome", "stage", "evidence"], ["moduleId", "failureClass"], attemptPath, errors);
      if (unknownAttempt.attempt !== attemptIndex + 1) errors.push(`${attemptPath}.attempt must be contiguous and equal ${attemptIndex + 1}`);
      const accepted = unknownAttempt.outcome === "accepted";
      const unaccepted = unknownAttempt.outcome === "blocked" || unknownAttempt.outcome === "failed";
      if (!accepted && !unaccepted) errors.push(`${attemptPath}.outcome is unsupported`);
      if (!STAGES.has(unknownAttempt.stage as BatchStage)) errors.push(`${attemptPath}.stage is unsupported`);
      if (accepted && unknownAttempt.stage !== "accepted") errors.push(`${attemptPath} accepted outcome requires accepted stage`);
      if (!accepted && unknownAttempt.stage === "accepted") errors.push(`${attemptPath} accepted stage requires accepted outcome`);
      if (accepted && !validString(unknownAttempt.moduleId, ID)) errors.push(`${attemptPath}.moduleId is required for accepted outcomes`);
      if (!accepted && "moduleId" in unknownAttempt) errors.push(`${attemptPath}.moduleId is allowed only for accepted outcomes`);
      if (unaccepted && !validString(unknownAttempt.failureClass, ID)) errors.push(`${attemptPath}.failureClass is required for blocked or failed outcomes`);
      if (accepted && "failureClass" in unknownAttempt) errors.push(`${attemptPath}.failureClass is allowed only for blocked or failed outcomes`);
      validateEvidence(unknownAttempt.evidence, `${attemptPath}.evidence`, errors, accepted);
      attempts.push(unknownAttempt as unknown as BatchAttemptResultV1);
    });

    if (stateValid && Number.isSafeInteger(unknownGame.attempt)) {
      if (maxAttempts > 0 && (attempts.length > maxAttempts || (unknownGame.attempt as number) > maxAttempts)) {
        errors.push(`${path} exceeds policy.maxAttempts`);
      }
      if (maxAttempts > 0 && (unknownGame.state === "queued" || unknownGame.state === "running")
        && attempts.length >= maxAttempts) {
        errors.push(`${path} has no remaining attempt within policy.maxAttempts`);
      }
      if (unknownGame.state === "running" && unknownGame.attempt !== attempts.length + 1) {
        errors.push(`${path}.attempt must name the active attempt after completed history`);
      } else if (unknownGame.state !== "running" && unknownGame.attempt !== attempts.length) {
        errors.push(`${path}.attempt must equal completed attempt history length`);
      }
      if (unknownGame.state === "blocked" || unknownGame.state === "failed" || unknownGame.state === "accepted") {
        const latest = attempts.at(-1);
        if (!latest || latest.outcome !== unknownGame.state) errors.push(`${path}.state must match its latest attempt outcome`);
        else {
          if (stageValid && latest.stage !== unknownGame.stage) errors.push(`${path}.stage must match its latest attempt result`);
          if (object(unknownGame.evidence) && !sameEvidence(latest.evidence, unknownGame.evidence as BatchEvidenceV1)) {
            errors.push(`${path}.evidence must match its latest attempt result`);
          }
          if (latest.outcome !== "accepted" && latest.failureClass !== unknownGame.failureClass) {
            errors.push(`${path}.failureClass must match its latest attempt result`);
          }
        }
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

function executorFailure(attempt: number, stage: BatchStage): BatchAttemptResultV1 {
  return { attempt, outcome: "failed", stage, failureClass: "executor-error", evidence: {} };
}

function validExecutorEvidence(value: unknown, requireComplete: boolean): value is BatchEvidenceV1 {
  if (!object(value)) return false;
  const allowed = new Set(["canonicalReplaySha256", "hdReviewDecisionSha256", "webPackageSha256"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const key of allowed) if (key in value && !validString(value[key], HASH)) return false;
  return !requireComplete || [...allowed].every((key) => validString(value[key], HASH));
}

function completedAttempt(
  attempt: number,
  value: unknown,
  failureStage: BatchStage,
): BatchAttemptResultV1 {
  if (!object(value)) return executorFailure(attempt, failureStage);
  if (value.outcome === "accepted") {
    const keys = new Set(["outcome", "stage", "moduleId", "evidence"]);
    if (Object.keys(value).some((key) => !keys.has(key)) || value.stage !== "accepted"
      || !validString(value.moduleId, ID) || !validExecutorEvidence(value.evidence, true)) {
      return executorFailure(attempt, failureStage);
    }
    return { attempt, outcome: "accepted", stage: "accepted", moduleId: value.moduleId, evidence: { ...value.evidence } };
  }
  if (value.outcome === "blocked" || value.outcome === "failed") {
    const keys = new Set(["outcome", "stage", "failureClass", "evidence"]);
    if (Object.keys(value).some((key) => !keys.has(key)) || !STAGES.has(value.stage as BatchStage)
      || value.stage === "accepted" || !validString(value.failureClass, ID)
      || !validExecutorEvidence(value.evidence, false)) {
      return executorFailure(attempt, failureStage);
    }
    return {
      attempt,
      outcome: value.outcome,
      stage: value.stage as BatchStage,
      failureClass: value.failureClass,
      evidence: { ...value.evidence },
    };
  }
  return executorFailure(attempt, failureStage);
}

export async function runBatch(batch: BatchV1, options: RunBatchOptions): Promise<BatchV1> {
  const initialValidation = validateBatch(batch);
  if (!initialValidation.ok) throw new Error(`Invalid initial batch:\n${initialValidation.errors.join("\n")}`);
  let current = structuredClone(batch);
  let persistChain = Promise.resolve();

  const replaceGame = (replacement: BatchGameV1): void => {
    const games = current.games.map((game) => game.gameId === replacement.gameId ? replacement : game);
    current = { ...current, games, status: derivedStatus(games) };
  };
  const persist = async (): Promise<void> => {
    const snapshot = structuredClone(current);
    persistChain = persistChain.then(async () => options.persist(snapshot));
    await persistChain;
  };

  const pending = current.games.filter(({ state }) => state === "queued" || state === "running")
    .sort((left, right) => left.priority - right.priority || left.gameId.localeCompare(right.gameId));
  let cursor = 0;
  const runLane = async (): Promise<void> => {
    while (cursor < pending.length) {
      const gameId = pending[cursor++]!.gameId;
      for (;;) {
        const game = current.games.find((candidate) => candidate.gameId === gameId)!;
        const attempt = game.attempts.length + 1;
        if (attempt > current.policy.maxAttempts) break;
        const { failureClass: _failureClass, ...withoutFailure } = game;
        replaceGame({ ...withoutFailure, state: "running", attempt });
        await persist();

        let result: BatchAttemptResultV1;
        try {
          const value = await options.executor({
            batchId: current.batchId,
            gameId: game.gameId,
            cartSha256: game.cartSha256,
            input: structuredClone(game.input),
            request: structuredClone(game.request),
            workspaceId: game.workspaceId,
            attempt,
            previousAttempts: structuredClone(game.attempts),
          });
          result = completedAttempt(attempt, value, game.stage);
        } catch {
          result = executorFailure(attempt, game.stage);
        }
        const attempts = [...game.attempts, result];
        const terminalBase = {
          ...withoutFailure,
          state: result.outcome,
          stage: result.stage,
          attempt,
          attempts,
          evidence: result.evidence,
        } satisfies Omit<BatchGameV1, "failureClass">;
        replaceGame(result.outcome === "accepted"
          ? terminalBase
          : { ...terminalBase, failureClass: result.failureClass });
        await persist();
        if (result.outcome !== "failed" || attempt >= current.policy.maxAttempts) break;
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(current.policy.maxParallel, pending.length) },
    () => runLane(),
  ));
  await persistChain;
  const finalValidation = validateBatch(current);
  if (!finalValidation.ok) throw new Error(`Batch runner produced an invalid ledger:\n${finalValidation.errors.join("\n")}`);
  return current;
}
