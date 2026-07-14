import { describe, expect, it } from "vitest";

import type { InputTraceV1 } from "@aico8/contracts";

import {
  gamepadMask,
  gamepadMenuPressed,
  keyboardButton,
  keyboardMenuKey,
  LogicalInputLatch,
  projectInputTrace,
  touchButton,
} from "./input.js";

describe("logical input latch", () => {
  it("preserves a quick tap until one logical update consumes it", () => {
    const input = new LogicalInputLatch();
    input.press(4);
    input.release(4);
    expect(input.mask()).toBe(1 << 4);
    input.commitLogicalUpdate();
    expect(input.mask()).toBe(0);
  });

  it("keeps a held direction active across logical updates", () => {
    const input = new LogicalInputLatch();
    input.press(1);
    input.commitLogicalUpdate();
    expect(input.mask()).toBe(1 << 1);
    input.release(1);
    input.commitLogicalUpdate();
    expect(input.mask()).toBe(0);
  });

  it("rejects buttons outside the PICO-8 six-button range", () => {
    const input = new LogicalInputLatch();
    input.press(-1);
    input.press(6);
    expect(input.mask()).toBe(0);
  });
});

describe("host input mappings", () => {
  const buttons = (...pressed: number[]) => Array.from({ length: 16 }, (_, index) => ({
    pressed: pressed.includes(index),
  }));

  it("maps arrows, WASD, and both action families", () => {
    expect(keyboardButton("ArrowLeft")).toBe(0);
    expect(keyboardButton("KeyD")).toBe(1);
    expect(keyboardButton("KeyW")).toBe(2);
    expect(keyboardButton("KeyS")).toBe(3);
    expect(keyboardButton("Space")).toBe(4);
    expect(keyboardButton("Enter")).toBeUndefined();
    expect(keyboardMenuKey("Enter")).toBe(true);
    expect(keyboardMenuKey("KeyP")).toBe(true);
    expect(keyboardMenuKey("KeyX")).toBe(false);
    expect(keyboardButton("Escape")).toBeUndefined();
  });

  it("maps standard gamepad d-pad and face buttons", () => {
    expect(gamepadMask({ axes: [0, 0], buttons: buttons(14, 0) })).toBe((1 << 0) | (1 << 4));
    expect(gamepadMask({ axes: [0, 0], buttons: buttons(15, 1) })).toBe((1 << 1) | (1 << 5));
    expect(gamepadMask({ axes: [0, 0], buttons: buttons(12, 13) })).toBe((1 << 2) | (1 << 3));
  });

  it("keeps controller menu buttons outside the six-button gameplay mask", () => {
    const gamepad = { axes: [0, 0], buttons: buttons(8, 9) };
    expect(gamepadMask(gamepad)).toBe(0);
    expect(gamepadMenuPressed(gamepad)).toBe(true);
    expect(gamepadMenuPressed({ axes: [0, 0], buttons: buttons(0) })).toBe(false);
  });

  it("maps analog directions outside the dead zone", () => {
    expect(gamepadMask({ axes: [-0.8, 0.7], buttons: buttons() })).toBe((1 << 0) | (1 << 3));
    expect(gamepadMask({ axes: [0.3, -0.3], buttons: buttons() })).toBe(0);
    expect(gamepadMask(null)).toBe(0);
  });

  it("rejects malformed touch data instead of coercing it to button zero", () => {
    expect(touchButton("0")).toBe(0);
    expect(touchButton(5)).toBe(5);
    expect(touchButton(undefined)).toBeUndefined();
    expect(touchButton("")).toBeUndefined();
    expect(touchButton("not-a-button")).toBeUndefined();
    expect(touchButton(1.5)).toBeUndefined();
    expect(touchButton(6)).toBeUndefined();
  });
});

describe("complete logical-trace projection", () => {
  const trace: InputTraceV1 = {
    schemaVersion: "aico8.input-trace.v1",
    updateHz: 30,
    totalUpdates: 8,
    initialState: { kind: "clean", persistenceSha256: "0".repeat(64) },
    spans: [
      { startUpdate: 0, endUpdateExclusive: 1, players: [0] },
      { startUpdate: 1, endUpdateExclusive: 2, players: [16] },
      { startUpdate: 2, endUpdateExclusive: 4, players: [2] },
      { startUpdate: 4, endUpdateExclusive: 5, players: [34] },
      { startUpdate: 5, endUpdateExclusive: 7, players: [9] },
      { startUpdate: 7, endUpdateExclusive: 8, players: [0] },
    ],
  };

  it("preserves every update, hold, quick action, and chord on all surfaces", () => {
    const expected = [0, 16, 2, 2, 34, 9, 9, 0];
    expect([...projectInputTrace(trace, "keyboard")]).toEqual(expected);
    expect([...projectInputTrace(trace, "controller")]).toEqual(expected);
    expect([...projectInputTrace(trace, "touch")]).toEqual(expected);
  });

  it("maps all 64 possible single-player masks identically", () => {
    for (let mask = 0; mask <= 0x3f; mask += 1) {
      const single: InputTraceV1 = {
        ...trace,
        totalUpdates: 1,
        spans: [{ startUpdate: 0, endUpdateExclusive: 1, players: [mask] }],
      };
      for (const surface of ["keyboard", "controller", "touch"] as const) {
        expect(projectInputTrace(single, surface)[0], `${surface} mask ${mask}`).toBe(mask);
      }
    }
  });

  it("rejects gaps and unsupported second-player traces", () => {
    expect(() => projectInputTrace({
      ...trace,
      spans: [{ startUpdate: 1, endUpdateExclusive: 8, players: [0] }],
    }, "touch")).toThrow(/contiguous coverage/);
    expect(() => projectInputTrace({
      ...trace,
      spans: [{ startUpdate: 0, endUpdateExclusive: 8, players: [0, 0] }],
    }, "controller")).toThrow(/one PICO-8 player/);
  });
});
