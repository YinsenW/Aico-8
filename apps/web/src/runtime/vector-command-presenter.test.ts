import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";

import type { Aico8Kernel, DrawCommand } from "./kernel.js";
import { PICO8_EXTENDED_COLORS } from "./pico8-palette.js";
import { VectorCommandPresenter } from "./vector-command-presenter.js";
import type { TextRunV1 } from "./text-run-ir.js";

const palette = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751,
  0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436,
  0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
];

function command(opcode: number, args: readonly number[]): DrawCommand {
  return { opcode, flags: 0, args, payload: new Uint8Array() };
}

function flaggedCommand(opcode: number, flags: number, args: readonly number[]): DrawCommand {
  return { opcode, flags, args, payload: new Uint8Array() };
}

function printCommand(text: string): DrawCommand {
  return { opcode: 14, flags: 0, args: [2, 3, 7], payload: new TextEncoder().encode(text) };
}

function textRun(text: string, classification: TextRunV1["classification"] = "safe-modern"): TextRunV1 {
  return {
    schemaVersion: 1,
    sequence: 0,
    update: { low: 1, high: 0 },
    classification,
    reasonMask: classification === "safe-modern" ? 0 : 1,
    sideEffectMask: 0,
    unsupportedMask: 0,
    anchor: [2, 3],
    cursorIn: [2, 3],
    cursorOut: [7, 3],
    rightmostX: 6,
    diagnosticBounds: { x: 2, y: 3, width: 5, height: 6 },
    foregroundIn: 7,
    foregroundOut: 7,
    printAttributes: 0,
    customFont: { revision: 0, memoryBase: 0x5600, memorySize: 0x100 },
    appendNewline: false,
    spans: [{ byteOffset: 0, byteLength: text.length, kind: "visual", reasonMask: 0, sideEffectMask: 0 }],
    rawP8scii: Array.from(new TextEncoder().encode(text)),
  };
}

const kernel = {
  paletteState: () => ({
    draw: Uint8Array.from({ length: 16 }, (_, color) => color | (color === 0 ? 0x10 : 0)),
    display: Uint8Array.from({ length: 16 }, (_, color) => color),
  }),
  spriteFlags: () => new Uint8Array(256),
  framebuffer: () => new Uint8Array(128 * 128),
} as unknown as Aico8Kernel;

describe("vector command presenter", () => {
  it("draws only byte-matched safe-modern text runs and reports blocked runs", () => {
    const presenter = new VectorCommandPresenter({ scale: 8, palette });
    const copies: string[] = [];
    const safeKernel = { ...kernel, textRuns: () => [textRun("begin")] } as unknown as Aico8Kernel;
    presenter.render(new Graphics(), safeKernel, [printCommand("begin")], (copy) => copies.push(copy.text));
    expect(copies).toEqual(["begin"]);
    expect(presenter.measurements()).toMatchObject({ textCount: 1, safeTextCount: 1, blockedTextCount: 0, mismatchedTextCount: 0 });

    const blockedKernel = { ...kernel, textRuns: () => [textRun("begin", "review-required")] } as unknown as Aico8Kernel;
    presenter.render(new Graphics(), blockedKernel, [printCommand("begin")], (copy) => copies.push(copy.text));
    expect(copies).toEqual(["begin"]);
    expect(presenter.measurements()).toMatchObject({ textCount: 1, safeTextCount: 0, blockedTextCount: 1, mismatchedTextCount: 0 });

    const mismatchKernel = { ...kernel, textRuns: () => [textRun("resume")] } as unknown as Aico8Kernel;
    presenter.render(new Graphics(), mismatchKernel, [printCommand("begin")], (copy) => copies.push(copy.text));
    expect(presenter.measurements()).toMatchObject({ blockedTextCount: 1, mismatchedTextCount: 1 });
  });

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

  it("presents ellipse and rounded-rectangle commands as continuous HD geometry", () => {
    const presenter = new VectorCommandPresenter({ scale: 8, palette });
    const graphics = new Graphics();
    presenter.render(graphics, kernel, [
      command(8, [10, 10, 20, 16, 8]),
      command(9, [24, 10, 34, 16, 9]),
      command(21, [10, 24, 12, 8, 3, 10]),
      command(22, [28, 24, 12, 8, 3, 11]),
    ], () => {});

    expect(presenter.measurements()).toMatchObject({
      sourcePrimitiveCount: 4,
      continuousPrimitiveCount: 4,
      spriteSurfaceCount: 0,
      indexedCellQuadCount: 0,
    });
    expect(graphics.bounds.width).toBeGreaterThan(200);
  });

  it("collapses dense pset read-modify-write output into final-frame surfaces", () => {
    const framebuffer = new Uint8Array(128 * 128);
    const commands = Array.from({ length: 64 }, (_, index) => {
      const x = index % 8;
      const y = Math.floor(index / 8);
      framebuffer[y * 128 + x] = x < 4 ? 0 : 7;
      return command(2, [x, y, x < 4 ? 0 : 7]);
    });
    const maskedKernel = {
      ...kernel,
      framebuffer: () => framebuffer,
    } as unknown as Aico8Kernel;
    const presenter = new VectorCommandPresenter({ scale: 8, palette });
    presenter.render(new Graphics(), maskedKernel, commands, () => {});

    expect(presenter.measurements()).toMatchObject({
      sourcePrimitiveCount: 64,
      continuousPrimitiveCount: 2,
      spriteSurfaceCount: 0,
      indexedCellQuadCount: 0,
    });
  });

  it("never reinterprets secondary-palette pairs as display-palette entries", () => {
    const presenter = new VectorCommandPresenter({ scale: 8, palette });
    const graphics = new Graphics();
    presenter.render(graphics, kernel, [
      flaggedCommand(15, 3, [12, 0x87, 2]),
      flaggedCommand(5, 5, [0, 0, 1, 1, 12]),
    ], () => {});

    const fill = graphics.context.instructions.at(-1) as {
      readonly data: { readonly style: { readonly color: number } };
    };
    expect(fill.data.style.color).toBe(palette[12]);
  });

  it("preserves extended display-palette targets from state and PAL commands", () => {
    const extendedKernel = {
      ...kernel,
      paletteState: () => ({
        draw: Uint8Array.from({ length: 16 }, (_, color) => color | (color === 0 ? 0x10 : 0)),
        display: Uint8Array.from({ length: 16 }, (_, color) => color === 7 ? 143 : color),
      }),
    } as unknown as Aico8Kernel;
    const presenter = new VectorCommandPresenter({ scale: 8, palette });
    const graphics = new Graphics();
    presenter.render(graphics, extendedKernel, [command(1, [7])], () => {});
    let fill = graphics.context.instructions.at(-1) as {
      readonly data: { readonly style: { readonly color: number } };
    };
    expect(fill.data.style.color).toBe(PICO8_EXTENDED_COLORS[15]);

    presenter.render(graphics, kernel, [
      flaggedCommand(15, 2, [7, 128, 1]),
      flaggedCommand(5, 5, [0, 0, 1, 1, 7]),
    ], () => {});
    fill = graphics.context.instructions.at(-1) as {
      readonly data: { readonly style: { readonly color: number } };
    };
    expect(fill.data.style.color).toBe(PICO8_EXTENDED_COLORS[0]);
  });
});
