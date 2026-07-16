import { describe, expect, it } from "vitest";

import {
  advancePresentationTime,
  parseValidationInteger,
  playInitializationToHostTick,
  playNeutralInputProbe,
  playReplayToMilestone,
  playReplayToUpdate,
} from "./replay-player.js";

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

const replayWithHostActions = {
  ...replay,
  canonicality: { ...replay.canonicality, inputSource: "pico8-buttons-plus-source-menuitems" },
  hostActions: [
    { kind: "source-authored-pause-menu-item", atUpdate: 2, index: 2, label: "main menu", filter: 0, buttons: 0, keepOpen: false },
  ],
};

describe("browser validation replay", () => {
  it("captures an exact startup host tick without entering logical updates", () => {
    let ticks = 0;
    const masks: number[] = [];
    const kernel = {
      initializationComplete: () => ticks >= 4,
      tick60: (mask: number) => { masks.push(mask); ticks += 1; },
      readAudio: () => new Int16Array([1, 2, 3]),
    };
    expect(playInitializationToHostTick(kernel, 3)).toEqual({
      hostTicksExecuted: 3,
      discardedAudioSamples: 9,
    });
    expect(masks).toEqual([0, 0, 0]);
    expect(() => playInitializationToHostTick(kernel, 1)).toThrow(/not inside initialization/);
  });

  it("rejects startup captures beyond the initialization boundary", () => {
    let ticks = 0;
    const kernel = {
      initializationComplete: () => ticks >= 2,
      tick60: () => { ticks += 1; },
      readAudio: () => new Int16Array(),
    };
    expect(() => playInitializationToHostTick(kernel, 2)).toThrow(/not inside initialization/);
    for (const tick of [-1, 1.5, 36_001, Number.NaN]) {
      expect(() => playInitializationToHostTick(kernel, tick)).toThrow(/host tick/);
    }
  });

  it("runs a bounded reachability probe through neutral input only", () => {
    const masks: number[] = [];
    expect(playNeutralInputProbe(3, (mask) => masks.push(mask))).toEqual({ updatesExecuted: 3 });
    expect(masks).toEqual([0, 0, 0]);
    for (const updates of [0, -1, 1.5, 3_601, Number.NaN]) {
      expect(() => playNeutralInputProbe(updates, () => undefined)).toThrow(/Neutral input probe/);
    }
  });

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

  it("interleaves declared source menu actions before the next logical update", () => {
    const events: string[] = [];
    playReplayToMilestone(replayWithHostActions, "game-complete", (mask) => events.push(`input:${mask}`), {
      expectedCartSha256: hash,
      executeHostAction: (action) => events.push(`menu:${action.atUpdate}:${action.index}:${action.label}`),
    });
    expect(events).toEqual(["input:16", "input:0", "menu:2:2:main menu", "input:2", "input:0"]);
  });

  it("captures a boundary before a host action declared at that same update", () => {
    const events: string[] = [];
    playReplayToMilestone(replayWithHostActions, "ending-reached", (mask) => events.push(`input:${mask}`), {
      expectedCartSha256: hash,
      executeHostAction: () => events.push("menu"),
    });
    expect(events).toEqual(["input:16", "input:0"]);
  });

  it("fails closed when a replay host action has no executor", () => {
    expect(() => playReplayToMilestone(replayWithHostActions, "game-complete", () => undefined, {
      expectedCartSha256: hash,
    })).toThrow(/host executor/);
  });

  it("captures an exact logical-update boundary without a synthetic milestone", () => {
    const masks: number[] = [];
    const result = playReplayToUpdate(replay, 3, (mask) => masks.push(mask), {
      expectedCartSha256: hash,
      requireCleanInitialState: true,
    });
    expect(masks).toEqual([16, 0, 2]);
    expect(result).toEqual({
      replayId: "synthetic-browser-replay",
      targetUpdate: 3,
      updatesExecuted: 3,
      totalUpdates: 4,
    });
  });

  it("supports the initial boundary and rejects invalid update targets", () => {
    const masks: number[] = [];
    expect(playReplayToUpdate(replay, 0, (mask) => masks.push(mask), {
      expectedCartSha256: hash,
    }).updatesExecuted).toBe(0);
    expect(masks).toEqual([]);
    for (const update of [-1, 1.5, 5, Number.NaN]) {
      expect(() => playReplayToUpdate(replay, update, () => undefined, {
        expectedCartSha256: hash,
      })).toThrow(/target update/);
    }
  });

  it("parses canonical capture parameters and advances time in bounded slices", () => {
    expect(parseValidationInteger(null, "sample", 100)).toBeUndefined();
    expect(parseValidationInteger("0", "sample", 100)).toBe(0);
    expect(parseValidationInteger("100", "sample", 100)).toBe(100);
    for (const value of ["", "01", "-1", "1.5", "101", "9007199254740992"]) {
      expect(() => parseValidationInteger(value, "sample", 100)).toThrow(/sample/);
    }
    const deltas: number[] = [];
    advancePresentationTime(125, (delta) => deltas.push(delta));
    expect(deltas).toEqual([50, 50, 25]);
    advancePresentationTime(0, () => {
      throw new Error("zero time must not animate");
    });
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
