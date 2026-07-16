import { describe, expect, it } from "vitest";

import {
  normalizePico8DisplayIndex,
  pico8ColorForDisplayIndex,
  pico8FramebufferColor,
  PICO8_BASE_COLORS,
  PICO8_EXTENDED_COLORS,
} from "./pico8-palette.js";

describe("PICO-8 display palette", () => {
  it("preserves base and extended display indices while masking unrelated bits", () => {
    expect(normalizePico8DisplayIndex(7)).toBe(7);
    expect(normalizePico8DisplayIndex(143)).toBe(143);
    expect(normalizePico8DisplayIndex(0xff)).toBe(143);
    expect(normalizePico8DisplayIndex(0x10)).toBe(0);
  });

  it("resolves framebuffer colours through all sixteen display mappings", () => {
    const display = Uint8Array.from({ length: 16 }, (_, color) => color);
    display[2] = 7;
    display[7] = 143;
    expect(pico8FramebufferColor(2, display)).toBe(PICO8_BASE_COLORS[7]);
    expect(pico8FramebufferColor(7, display)).toBe(PICO8_EXTENDED_COLORS[15]);
    expect(pico8ColorForDisplayIndex(128)).toBe(PICO8_EXTENDED_COLORS[0]);
  });
});
