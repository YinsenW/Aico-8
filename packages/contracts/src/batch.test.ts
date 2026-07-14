import { describe, expect, it } from "vitest";
import { BATCH_SCHEMA_VERSION, acceptedBatchGameIds, validateBatch } from "./batch.js";

const hash = (digit: string) => digit.repeat(64);
const game = (index: number, state: "running" | "blocked" | "accepted") => ({
  gameId: `game-${index}`,
  cartSha256: hash(String(index)),
  workspaceId: `workspace-${index}`,
  priority: index,
  state,
  stage: state === "accepted" ? "accepted" : state === "running" ? "gameplay" : "compatibility",
  attempt: 1,
  ...(state === "blocked" ? { failureClass: "runtime-compatibility" } : {}),
  evidence: state === "accepted" ? {
    canonicalReplaySha256: hash("a"),
    hdReviewDecisionSha256: hash("b"),
    webPackageSha256: hash("c"),
  } : {},
});

function mixedBatch() {
  return {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchId: "ten-game-qualification",
    status: "running",
    policy: { maxParallel: 3, failureIsolation: true, acceptanceRequiresEvidence: true },
    games: [game(1, "accepted"), game(2, "blocked"), game(3, "running")],
  };
}

describe("batch contract", () => {
  it("keeps accepted, blocked, and running games isolated", () => {
    const batch = mixedBatch();
    expect(validateBatch(batch)).toEqual({ ok: true, errors: [] });
    expect(acceptedBatchGameIds(batch as never)).toEqual(["game-1"]);
  });

  it("rejects excess parallel lanes and shared mutable identity", () => {
    const batch = mixedBatch();
    batch.policy.maxParallel = 1;
    batch.games.push({ ...game(4, "running"), workspaceId: "workspace-3" });
    const errors = validateBatch(batch).errors.join("\n");
    expect(errors).toMatch(/workspaceId must be unique/);
    expect(errors).toMatch(/more running games/);
  });

  it("rejects acceptance without independent evidence", () => {
    const batch = mixedBatch();
    batch.games[0]!.evidence = {};
    expect(validateBatch(batch).errors.join("\n")).toMatch(/requires replay, HD review, and Web package evidence/);
  });

  it("derives partial instead of hiding a failed sibling", () => {
    const batch = mixedBatch();
    batch.games[2] = game(3, "blocked");
    const wrong = validateBatch(batch).errors.join("\n");
    expect(wrong).toMatch(/derived status partial/);
    batch.status = "partial";
    expect(validateBatch(batch)).toEqual({ ok: true, errors: [] });
  });
});
