import { describe, expect, it } from "vitest";

import { gamepadMask, keyboardButton, LogicalInputLatch } from "./input.js";

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
    expect(keyboardButton("Enter")).toBe(5);
    expect(keyboardButton("Escape")).toBeUndefined();
  });

  it("maps standard gamepad d-pad and face buttons", () => {
    expect(gamepadMask({ axes: [0, 0], buttons: buttons(14, 0) })).toBe((1 << 0) | (1 << 4));
    expect(gamepadMask({ axes: [0, 0], buttons: buttons(15, 1) })).toBe((1 << 1) | (1 << 5));
    expect(gamepadMask({ axes: [0, 0], buttons: buttons(12, 13) })).toBe((1 << 2) | (1 << 3));
  });

  it("maps analog directions outside the dead zone", () => {
    expect(gamepadMask({ axes: [-0.8, 0.7], buttons: buttons() })).toBe((1 << 0) | (1 << 3));
    expect(gamepadMask({ axes: [0.3, -0.3], buttons: buttons() })).toBe(0);
    expect(gamepadMask(null)).toBe(0);
  });
});
