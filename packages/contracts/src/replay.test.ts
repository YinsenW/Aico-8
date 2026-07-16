import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INPUT_TRACE_SCHEMA_VERSION,
  REPLAY_SCHEMA_VERSION,
  assertReplay,
  validateReplay,
  type ReplayV1,
} from "./replay.js";

function fixture(name: string): unknown {
  const url = new URL(`../../../tests/contracts/replay/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

function validReplay(): ReplayV1 {
  const value = fixture("valid-canonical-replay.json");
  assertReplay(value);
  return value;
}

describe("Replay v1", () => {
  it("accepts the public canonical replay fixture", () => {
    const replay = validReplay();
    expect(replay.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(replay.trace.schemaVersion).toBe(INPUT_TRACE_SCHEMA_VERSION);
    expect(validateReplay(replay)).toEqual({ valid: true, errors: [] });
  });

  it("rejects a logical-update gap", () => {
    const result = validateReplay(fixture("invalid-gap-replay.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("trace spans must be contiguous");
  });

  it("rejects hooks and compatibility-state mutation", () => {
    const result = validateReplay(fixture("invalid-state-mutation-replay.json"));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("$.canonicality.compatibilityStateMutation must equal none");
    expect(result.errors).toContain("$.canonicality.testHooks must equal false");
  });

  it("rejects out-of-range PICO-8 button masks", () => {
    const replay = structuredClone(validReplay()) as unknown as Record<string, any>;
    replay.trace.spans[0].players[0] = 64;
    const result = validateReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("players[0]");
  });

  it("rejects completed evidence with an unresolved required milestone", () => {
    const replay = structuredClone(validReplay()) as ReplayV1;
    replay.requiredMilestoneIds.push("ending-missing");
    const result = validateReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("does not resolve to a milestone");
  });

  it("requires prior-replay lineage when persisted progress seeds a trace", () => {
    const replay = structuredClone(validReplay()) as unknown as Record<string, any>;
    replay.trace.initialState.kind = "prior-replay";
    const result = validateReplay(replay);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("priorReplayId is required");
  });

  it("accepts ordered source menu actions only with an explicit canonical input source", () => {
    const replay = structuredClone(validReplay()) as unknown as Record<string, any>;
    replay.canonicality.inputSource = "pico8-buttons-plus-source-menuitems";
    replay.hostActions = [{
      kind: "source-authored-pause-menu-item",
      atUpdate: 1,
      index: 2,
      label: "main menu",
      filter: 0,
      buttons: 0,
      keepOpen: false,
    }];
    expect(validateReplay(replay)).toEqual({ valid: true, errors: [] });
    delete replay.hostActions;
    expect(validateReplay(replay).errors.join("\n")).toMatch(/hostActions is required/);
  });

  it("rejects undeclared, unordered, or malformed host actions", () => {
    const replay = structuredClone(validReplay()) as unknown as Record<string, any>;
    replay.hostActions = [
      { kind: "source-authored-pause-menu-item", atUpdate: 2, index: 2, label: "main menu", filter: 0, buttons: 0, keepOpen: false },
      { kind: "source-authored-pause-menu-item", atUpdate: 1, index: 6, label: "", filter: 64, buttons: 64, keepOpen: "no" },
    ];
    const errors = validateReplay(replay).errors.join("\n");
    expect(errors).toMatch(/must declare source menuitems/);
    expect(errors).toMatch(/atUpdate must be ordered/);
    expect(errors).toMatch(/index/);
    expect(errors).toMatch(/label/);
    expect(errors).toMatch(/filter/);
    expect(errors).toMatch(/buttons/);
    expect(errors).toMatch(/keepOpen/);
  });

  it("throws an actionable error from the assertion helper", () => {
    expect(() => assertReplay({})).toThrowError(/Invalid Replay v1/);
  });
});
