import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  BATCH_SCHEMA_VERSION,
  acceptedBatchGameIds,
  batchWorkspaceId,
  runBatch,
  selectAcceptedBatchAssemblyInputs,
  validateBatch,
  type BatchEvidenceV1,
  type BatchExecutor,
  type BatchGameV1,
  type BatchV1,
} from "./batch.js";

const BATCH_ID = "ten-game-qualification";
const hash = (digit: string) => digit.repeat(64);
const acceptedEvidence = (): BatchEvidenceV1 => ({
  canonicalReplaySha256: hash("a"),
  hdReviewDecisionSha256: hash("b"),
  webPackageSha256: hash("c"),
});

function queuedGame(index: number): BatchGameV1 {
  const cartSha256 = hash(String(index));
  const gameId = `game-${index}`;
  return {
    gameId,
    cartSha256,
    input: { cartPath: `carts/${gameId}.p8.png`, rightsProfile: "private-research" },
    request: {
      product: "standalone-web",
      targetProfileId: "web-hd-1024-square",
      targetProfileSha256: hash("d"),
    },
    workspaceId: batchWorkspaceId(BATCH_ID, gameId, cartSha256),
    priority: index,
    state: "queued",
    stage: "ingest",
    attempt: 0,
    attempts: [],
    evidence: {},
  };
}

function queuedBatch(gameCount = 4): BatchV1 {
  return {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchId: BATCH_ID,
    status: "queued",
    policy: {
      maxParallel: 2,
      maxAttempts: 2,
      attemptTimeoutMs: 1000,
      failureIsolation: true,
      acceptanceRequiresEvidence: true,
    },
    games: Array.from({ length: gameCount }, (_, index) => queuedGame(index + 1)),
  };
}

function acceptedBatch(): BatchV1 {
  const batch = structuredClone(queuedBatch(1)) as BatchV1;
  const game = batch.games[0]!;
  const evidence = acceptedEvidence();
  return {
    ...batch,
    status: "complete",
    games: [{
      ...game,
      state: "accepted",
      stage: "accepted",
      attempt: 1,
      attempts: [{
        attempt: 1,
        outcome: "accepted",
        stage: "accepted",
        moduleId: "module-game-1",
        evidence: { ...evidence },
      }],
      evidence: { ...evidence },
    }],
  };
}

const batchSchema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/batch-v1.schema.json", import.meta.url),
  "utf8",
));
const validateBatchSchema = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(batchSchema);

function schemaAccepts(value: unknown): boolean {
  return validateBatchSchema(value) === true;
}

function mutateBatch(source: BatchV1, mutation: (batch: any) => void): unknown {
  const batch = structuredClone(source) as any;
  mutation(batch);
  return batch;
}

describe("batch contract", () => {
  it("makes JSON Schema and TypeScript agree on every schema-expressible invariant", () => {
    const expressibleCorpus: ReadonlyArray<readonly [string, unknown, boolean]> = [
      ["valid queued batch", queuedBatch(), true],
      ["valid accepted batch", acceptedBatch(), true],
      ["unknown root property", mutateBatch(queuedBatch(), (batch) => { batch.unknown = true; }), false],
      ["missing attempt timeout", mutateBatch(queuedBatch(), (batch) => { delete batch.policy.attemptTimeoutMs; }), false],
      ["unsupported product", mutateBatch(queuedBatch(), (batch) => { batch.games[0].request.product = "collection"; }), false],
      ["incomplete accepted game evidence", mutateBatch(acceptedBatch(), (batch) => {
        delete batch.games[0].evidence.webPackageSha256;
      }), false],
      ["incomplete accepted attempt evidence", mutateBatch(acceptedBatch(), (batch) => {
        delete batch.games[0].attempts[0].evidence.hdReviewDecisionSha256;
      }), false],
      ["accepted attempt without module", mutateBatch(acceptedBatch(), (batch) => {
        delete batch.games[0].attempts[0].moduleId;
      }), false],
      ["failed attempt with accepted stage", mutateBatch(queuedBatch(), (batch) => {
        batch.games[0].attempts = [{
          attempt: 1,
          outcome: "failed",
          stage: "accepted",
          failureClass: "bad-stage",
          evidence: {},
        }];
      }), false],
      ...[".", "..", "carts/..", "../escape.p8", "carts//game.p8", "carts\\game.p8"].map(
        (cartPath) => [`unsafe cart path ${cartPath}`, mutateBatch(queuedBatch(), (batch) => {
          batch.games[0].input.cartPath = cartPath;
        }), false] as const,
      ),
    ];

    for (const [name, value, expected] of expressibleCorpus) {
      const schemaResult = schemaAccepts(value);
      const typeScriptResult = validateBatch(value).ok;
      expect(schemaResult, `${name}: ${JSON.stringify(validateBatchSchema.errors)}`).toBe(expected);
      expect(typeScriptResult, `${name}: ${validateBatch(value).errors.join("; ")}`).toBe(expected);
      expect(schemaResult, name).toBe(typeScriptResult);
    }
  });

  it("keeps cross-field and derived invariants explicitly owned by the TypeScript validator", () => {
    const duplicateGameId = mutateBatch(queuedBatch(2), (batch) => {
      batch.games[1].gameId = batch.games[0].gameId;
      batch.games[1].workspaceId = batchWorkspaceId(batch.batchId, batch.games[1].gameId, batch.games[1].cartSha256);
    });
    const duplicateCartHash = mutateBatch(queuedBatch(2), (batch) => {
      batch.games[1].cartSha256 = batch.games[0].cartSha256;
      batch.games[1].workspaceId = batchWorkspaceId(batch.batchId, batch.games[1].gameId, batch.games[1].cartSha256);
    });
    const tooManyRunning = mutateBatch(queuedBatch(2), (batch) => {
      batch.policy.maxParallel = 1;
      batch.status = "running";
      for (const game of batch.games) {
        game.state = "running";
        game.attempt = 1;
      }
    });
    const latestStateMismatch = mutateBatch(acceptedBatch(), (batch) => {
      batch.games[0].attempts[0] = {
        attempt: 1,
        outcome: "failed",
        stage: "gameplay",
        failureClass: "runtime-failure",
        evidence: {},
      };
    });
    const typeScriptOnlyCorpus: ReadonlyArray<readonly [string, unknown, RegExp]> = [
      ["derived status", mutateBatch(queuedBatch(), (batch) => { batch.status = "running"; }), /derived status/],
      ["deterministic workspace hash", mutateBatch(queuedBatch(), (batch) => {
        batch.games[0].workspaceId = "workspace-arbitrary";
      }), /deterministic batch\/cart identity/],
      ["game id uniqueness", duplicateGameId, /gameId must be unique/],
      ["cart hash uniqueness", duplicateCartHash, /cartSha256 must be unique/],
      ["workspace id uniqueness", mutateBatch(queuedBatch(2), (batch) => {
        batch.games[1].workspaceId = batch.games[0].workspaceId;
      }), /workspaceId must be unique/],
      ["priority uniqueness", mutateBatch(queuedBatch(2), (batch) => {
        batch.games[1].priority = batch.games[0].priority;
      }), /priority must be unique/],
      ["attempt sequencing", mutateBatch(acceptedBatch(), (batch) => {
        batch.games[0].attempts[0].attempt = 2;
      }), /contiguous and equal 1/],
      ["latest state equality", latestStateMismatch, /state must match its latest attempt outcome/],
      ["latest evidence equality", mutateBatch(acceptedBatch(), (batch) => {
        batch.games[0].evidence.webPackageSha256 = hash("e");
      }), /evidence must match its latest attempt result/],
      ["running lane count", tooManyRunning, /more running games than policy.maxParallel/],
      ["attempt budget relationship", mutateBatch(queuedBatch(1), (batch) => {
        batch.policy.maxAttempts = 1;
        batch.games[0].attempt = 1;
        batch.games[0].attempts = [{
          attempt: 1,
          outcome: "failed",
          stage: "gameplay",
          failureClass: "runtime-failure",
          evidence: {},
        }];
      }), /no remaining attempt/],
    ];

    for (const [name, value, expectedError] of typeScriptOnlyCorpus) {
      expect(schemaAccepts(value), `${name}: ${JSON.stringify(validateBatchSchema.errors)}`).toBe(true);
      const validation = validateBatch(value);
      expect(validation.ok, name).toBe(false);
      expect(validation.errors.join("\n"), name).toMatch(expectedError);
    }
  });

  it("requires every batch to declare a bounded executor attempt timeout", () => {
    const missing = structuredClone(queuedBatch()) as any;
    delete missing.policy.attemptTimeoutMs;
    expect(validateBatch(missing).errors.join("\n")).toMatch(/attemptTimeoutMs is required/);
    const unbounded = structuredClone(queuedBatch()) as any;
    unbounded.policy.attemptTimeoutMs = 86_400_001;
    expect(validateBatch(unbounded).errors.join("\n")).toMatch(/attemptTimeoutMs must be an integer/);
  });

  it("derives immutable workspace identity from batch, game, and complete cart hash", () => {
    const game = queuedGame(1);
    expect(game.workspaceId).toBe(`workspace-${BATCH_ID}-game-1-${hash("1")}`);
    expect(validateBatch(queuedBatch())).toEqual({ ok: true, errors: [] });

    const mutated = structuredClone(queuedBatch()) as any;
    mutated.games[0]!.workspaceId = "workspace-arbitrary";
    expect(validateBatch(mutated).errors.join("\n")).toMatch(/deterministic batch\/cart identity/);
    mutated.games[0]!.workspaceId = game.workspaceId;
    mutated.games[0]!.input.cartPath = "../unauthorized.p8";
    expect(validateBatch(mutated).errors.join("\n")).toMatch(/input.cartPath must be a safe relative path/);
  });

  it("rejects non-contiguous history and terminal state that disagrees with its latest result", () => {
    const batch = structuredClone(queuedBatch(1)) as any;
    batch.status = "complete";
    batch.games[0] = {
      ...batch.games[0]!,
      state: "accepted",
      stage: "accepted",
      attempt: 2,
      attempts: [{
        attempt: 2,
        outcome: "accepted",
        stage: "accepted",
        moduleId: "module-game-1",
        evidence: acceptedEvidence(),
      }],
      evidence: acceptedEvidence(),
    };
    const errors = validateBatch(batch).errors.join("\n");
    expect(errors).toMatch(/contiguous and equal 1/);
    expect(errors).toMatch(/attempt must equal completed attempt history length/);

    batch.games[0]!.attempt = 1;
    batch.games[0]!.attempts[0]!.attempt = 1;
    batch.games[0]!.state = "failed";
    batch.games[0]!.stage = "web-package";
    batch.games[0]!.failureClass = "package-failure";
    batch.status = "failed";
    expect(validateBatch(batch).errors.join("\n")).toMatch(/state must match its latest attempt outcome/);
  });

  it("executes bounded lanes, persists retry results, and isolates blocked and failed siblings", async () => {
    let active = 0;
    let peak = 0;
    const executor: BatchExecutor = async ({ gameId, attempt }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (gameId === "game-1" && attempt === 1) {
        return { outcome: "failed", stage: "gameplay", failureClass: "transient-runtime", evidence: {} };
      }
      if (gameId === "game-2") {
        return { outcome: "blocked", stage: "compatibility", failureClass: "unsupported-api", evidence: {} };
      }
      if (gameId === "game-3") throw new Error("lane-local executor crash");
      return { outcome: "accepted", stage: "accepted", moduleId: `module-${gameId}`, evidence: acceptedEvidence() };
    };
    const persisted: BatchV1[] = [];
    const result = await runBatch(queuedBatch(), {
      executor,
      persist: (snapshot) => { persisted.push(structuredClone(snapshot)); },
    });

    expect(peak).toBe(2);
    expect(persisted.some(({ games }) => games.filter(({ state }) => state === "running").length === 2)).toBe(true);
    expect(persisted.every(({ games, policy }) => games.filter(({ state }) => state === "running").length <= policy.maxParallel)).toBe(true);
    expect(persisted.at(-1)).toEqual(result);
    expect(validateBatch(result)).toEqual({ ok: true, errors: [] });
    expect(result.status).toBe("partial");
    expect(result.games[0]!.attempts.map(({ outcome }) => outcome)).toEqual(["failed", "accepted"]);
    expect(result.games[1]!.attempts.map(({ outcome }) => outcome)).toEqual(["blocked"]);
    expect(result.games[2]!.attempts.map(({ outcome }) => outcome)).toEqual(["failed", "failed"]);
    expect(result.games[2]!.attempts.every((attempt) =>
      attempt.outcome === "failed" && attempt.failureClass === "executor-error")).toBe(true);
    expect(result.games[3]!.attempts.map(({ outcome }) => outcome)).toEqual(["accepted"]);
    expect(acceptedBatchGameIds(result)).toEqual(["game-1", "game-4"]);
  });

  it("resumes a persisted running attempt without inventing a duplicate history entry", async () => {
    const batch = structuredClone(queuedBatch(1)) as any;
    batch.status = "running";
    batch.games[0].state = "running";
    batch.games[0].attempt = 1;
    const seenAttempts: number[] = [];
    const result = await runBatch(batch, {
      executor: async ({ attempt }) => {
        seenAttempts.push(attempt);
        return { outcome: "accepted", stage: "accepted", moduleId: "module-game-1", evidence: acceptedEvidence() };
      },
      persist: () => undefined,
    });
    expect(seenAttempts).toEqual([1]);
    expect(result.games[0]!.attempts).toHaveLength(1);
    expect(result.status).toBe("complete");
  });

  it("deep-clones executor inputs so callbacks cannot mutate persisted history or authorization", async () => {
    const batch = structuredClone(queuedBatch(1)) as any;
    const result = await runBatch(batch, {
      executor: async (context) => {
        (context.input as any).cartPath = "../mutated.p8";
        (context.request as any).product = "collection";
        if (context.attempt === 1) {
          return { outcome: "failed", stage: "gameplay", failureClass: "transient-runtime", evidence: {} };
        }
        (context.previousAttempts as any)[0].outcome = "accepted";
        return { outcome: "accepted", stage: "accepted", moduleId: "module-game-1", evidence: acceptedEvidence() };
      },
      persist: () => undefined,
    });
    expect(result.games[0]!.input.cartPath).toBe("carts/game-1.p8.png");
    expect(result.games[0]!.request.product).toBe("standalone-web");
    expect(result.games[0]!.attempts.map(({ outcome }) => outcome)).toEqual(["failed", "accepted"]);
  });

  it("normalizes malformed runtime executor results before any terminal snapshot is persisted", async () => {
    const batch = structuredClone(queuedBatch()) as any;
    batch.policy.maxAttempts = 1;
    const executor = (async ({ gameId }: { gameId: string }) => {
      if (gameId === "game-1") return { outcome: "failed", stage: "accepted", failureClass: "bad-stage", evidence: {} };
      if (gameId === "game-2") return { outcome: "accepted", stage: "accepted", moduleId: "module-game-2", evidence: {} };
      if (gameId === "game-3") return { outcome: "accepted", stage: "accepted", moduleId: "BAD MODULE", evidence: acceptedEvidence() };
      return { outcome: "accepted", stage: "accepted", moduleId: "module-game-4", evidence: acceptedEvidence() };
    }) as any as BatchExecutor;
    const persisted: BatchV1[] = [];
    const result = await runBatch(batch, {
      executor,
      persist: (snapshot) => { persisted.push(structuredClone(snapshot)); },
    });
    expect(persisted.every((snapshot) => validateBatch(snapshot).ok)).toBe(true);
    expect(result.games.slice(0, 3).every((game) =>
      game.state === "failed" && game.failureClass === "executor-error")).toBe(true);
    expect(result.games[3]!.state).toBe("accepted");
    expect(result.status).toBe("partial");
  });

  it("rejects queued or running recovery snapshots whose attempt budget is exhausted", async () => {
    const exhausted = structuredClone(queuedBatch(1)) as any;
    exhausted.policy.maxAttempts = 1;
    exhausted.games[0].attempt = 1;
    exhausted.games[0].attempts = [{
      attempt: 1,
      outcome: "failed",
      stage: "gameplay",
      failureClass: "runtime-failure",
      evidence: {},
    }];
    expect(validateBatch(exhausted).errors.join("\n")).toMatch(/no remaining attempt/);
    await expect(runBatch(exhausted, {
      executor: async () => ({ outcome: "blocked", stage: "ingest", failureClass: "must-not-run", evidence: {} }),
      persist: () => undefined,
    })).rejects.toThrow(/no remaining attempt/);

    exhausted.status = "running";
    exhausted.games[0].state = "running";
    exhausted.games[0].attempt = 2;
    expect(validateBatch(exhausted).errors.join("\n")).toMatch(/exceeds policy.maxAttempts|no remaining attempt/);
  });

  it("selects only accepted module results as assembly inputs", async () => {
    const executor: BatchExecutor = async ({ gameId }) => {
      if (gameId === "game-2") return { outcome: "blocked", stage: "compatibility", failureClass: "unsupported-api", evidence: {} };
      if (gameId === "game-3") return { outcome: "failed", stage: "gameplay", failureClass: "runtime-failure", evidence: {} };
      return { outcome: "accepted", stage: "accepted", moduleId: `module-${gameId}`, evidence: acceptedEvidence() };
    };
    const batch = structuredClone(queuedBatch()) as any;
    batch.policy.maxAttempts = 1;
    const result = await runBatch(batch, { executor, persist: () => undefined });
    const modules = new Map([
      ["module-game-1", { id: "module-game-1" }],
      ["module-game-2", { id: "must-not-assemble-blocked" }],
      ["module-game-3", { id: "must-not-assemble-failed" }],
      ["module-game-4", { id: "module-game-4" }],
    ]);

    expect(selectAcceptedBatchAssemblyInputs(result, modules)).toEqual([
      { gameId: "game-1", moduleId: "module-game-1", module: { id: "module-game-1" } },
      { gameId: "game-4", moduleId: "module-game-4", module: { id: "module-game-4" } },
    ]);
    modules.delete("module-game-4");
    expect(() => selectAcceptedBatchAssemblyInputs(result, modules)).toThrow(/Missing accepted module module-game-4/);
  });

  it("rejects acceptance without independent evidence", () => {
    const batch = structuredClone(queuedBatch(1)) as any;
    batch.status = "complete";
    batch.games[0] = {
      ...batch.games[0]!,
      state: "accepted",
      stage: "accepted",
      attempt: 1,
      attempts: [{ attempt: 1, outcome: "accepted", stage: "accepted", moduleId: "module-game-1", evidence: {} }],
      evidence: {},
    };
    expect(validateBatch(batch).errors.join("\n")).toMatch(/requires replay, HD review, and Web package evidence/);
  });
});
