import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";

import type { Aico8Kernel, DrawCommand } from "./kernel.js";
import { VectorCommandPresenter } from "./vector-command-presenter.js";

const palette = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751,
  0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436,
  0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
];

function command(opcode: number, args: readonly number[]): DrawCommand {
  return { opcode, flags: 0, args, payload: new Uint8Array() };
}

const kernel = {
  paletteState: () => ({
    draw: Uint8Array.from({ length: 16 }, (_, color) => color | (color === 0 ? 0x10 : 0)),
    display: Uint8Array.from({ length: 16 }, (_, color) => color),
  }),
  spriteFlags: () => new Uint8Array(256),
} as unknown as Aico8Kernel;

describe("vector command presenter", () => {
  it("turns a PICO-8 circle command into one continuous primitive", () => {
    const presenter = new VectorCommandPresenter({ scale: 8, palette });
    const graphics = new Graphics();
    presenter.render(graphics, kernel, [command(7, [64, 64, 20, 7])], () => {});

    expect(graphics.bounds.width).toBeGreaterThan(320);
    expect(graphics.bounds.height).toBeGreaterThan(320);
    expect(presenter.measurements()).toMatchObject({
      sourcePrimitiveCount: 1,
      continuousPrimitiveCount: 1,
      spriteSurfaceCount: 0,
      indexedCellQuadCount: 0,
    });
  });
});
