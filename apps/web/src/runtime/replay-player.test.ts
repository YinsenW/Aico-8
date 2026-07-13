import { describe, expect, it } from "vitest";

import { playReplayToMilestone } from "./replay-player.js";

const hash = "a".repeat(64);
const replay = {
  schemaVersion: "aico8.replay.v1",
  replayId: "synthetic-browser-replay",
  gameId: "synthetic-game",
  cartSha256: hash,
  runtime: { id: "synthetic-runtime", revision: "test" },
  canonicality: {
    mode: "canonical-real-input",
    cartMutation: "none",
    compatibilityStateMutation: "none",
    inputSource: "pico8-buttons-only",
    logicalUpdatePolicy: "execute-all",
    testHooks: false,
    wallClockAcceleration: true,
  },
  trace: {
    schemaVersion: "aico8.input-trace.v1",
    updateHz: 30,
    totalUpdates: 4,
    initialState: { kind: "clean", persistenceSha256: "0".repeat(64) },
    spans: [
      { startUpdate: 0, endUpdateExclusive: 1, players: [16] },
      { startUpdate: 1, endUpdateExclusive: 2, players: [0] },
      { startUpdate: 2, endUpdateExclusive: 3, players: [2] },
      { startUpdate: 3, endUpdateExclusive: 4, players: [0] },
    ],
  },
  requiredMilestoneIds: ["ending-reached", "game-complete"],
  milestones: [
    { id: "ending-reached", kind: "ending-reached", atUpdate: 2 },
    { id: "game-complete", kind: "game-complete", atUpdate: 4 },
  ],
  checkpoints: [{ id: "initial", atUpdate: 0, hashes: { stateSha256: "1".repeat(64) } }],
  result: { completed: true, finalMilestoneId: "game-complete", finalStateSha256: "2".repeat(64) },
  producer: { name: "synthetic producer", version: "1", sourceRevision: "test" },
};

describe("browser validation replay", () => {
  it("executes every ordinary input update through the selected milestone", () => {
    const masks: number[] = [];
    const result = playReplayToMilestone(replay, "game-complete", (mask) => masks.push(mask), {
      expectedCartSha256: hash,
      requireCleanInitialState: true,
    });
    expect(masks).toEqual([16, 0, 2, 0]);
    expect(result).toEqual({
      replayId: "synthetic-browser-replay",
      milestoneId: "game-complete",
      updatesExecuted: 4,
      totalUpdates: 4,
    });
  });

  it("stops at the declared boundary without consuming a later input", () => {
    const masks: number[] = [];
    playReplayToMilestone(replay, "ending-reached", (mask) => masks.push(mask), {
      expectedCartSha256: hash,
    });
    expect(masks).toEqual([16, 0]);
  });

  it("rejects the wrong cart, a non-clean seed, and an unknown milestone", () => {
    expect(() => playReplayToMilestone(replay, "game-complete", () => undefined, {
      expectedCartSha256: "b".repeat(64),
    })).toThrow(/cart hash/);
    expect(() => playReplayToMilestone({
      ...replay,
      trace: {
        ...replay.trace,
        initialState: {
          kind: "prior-replay",
          persistenceSha256: "0".repeat(64),
          priorReplayId: "earlier-replay",
        },
      },
    }, "game-complete", () => undefined, {
      expectedCartSha256: hash,
      requireCleanInitialState: true,
    })).toThrow(/clean initial state/);
    expect(() => playReplayToMilestone(replay, "missing", () => undefined, {
      expectedCartSha256: hash,
    })).toThrow(/no milestone/);
  });
});
