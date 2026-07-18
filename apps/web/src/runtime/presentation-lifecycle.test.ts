import { describe, expect, it, vi } from "vitest";

import {
  activateInitialPresentationFrame,
  attemptInitialPresentationFrame,
} from "./presentation-lifecycle.js";

function target() {
  return { setVisible: vi.fn() };
}

describe("initial presentation frame lifecycle", () => {
  it("renders the current game state before returning an HD surface to the browser", () => {
    const reference = target();
    const hd = target();
    const events: string[] = [];
    reference.setVisible.mockImplementation((visible) => events.push(`reference:${visible}`));
    hd.setVisible.mockImplementation((visible) => events.push(`hd:${visible}`));

    activateInitialPresentationFrame(reference, hd as never, true, () => events.push("render"));

    expect(events).toEqual([
      "reference:false",
      "hd:false",
      "reference:false",
      "hd:true",
      "render",
    ]);
  });

  it("renders a reference-only package before exposing it", () => {
    const reference = target();
    const events: string[] = [];
    reference.setVisible.mockImplementation((visible) => events.push(`reference:${visible}`));

    activateInitialPresentationFrame(reference, undefined, false, () => events.push("render"));

    expect(events).toEqual(["reference:false", "reference:true", "render"]);
  });

  it("fails closed when the first current-state render throws", () => {
    const reference = target();
    const hd = target();

    expect(() => activateInitialPresentationFrame(reference, hd as never, true, () => {
      throw new Error("unmapped current-state element");
    })).toThrow(/unmapped current-state element/);

    expect(reference.setVisible).toHaveBeenLastCalledWith(false);
    expect(hd.setVisible).toHaveBeenLastCalledWith(false);
  });

  it("keeps an incomplete yielding initialization frame behind the loading surface", () => {
    expect(attemptInitialPresentationFrame(false, () => {
      throw new Error("incomplete source-authored initialization frame");
    })).toBe(false);
  });

  it("commits the first complete source-authored initialization frame", () => {
    expect(attemptInitialPresentationFrame(false, () => undefined)).toBe(true);
  });

  it("does not suppress a renderer error after cartridge initialization", () => {
    expect(() => attemptInitialPresentationFrame(true, () => {
      throw new Error("persistent visual contract failure");
    })).toThrow(/persistent visual contract failure/);
  });
});
