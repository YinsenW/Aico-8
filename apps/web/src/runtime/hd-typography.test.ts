import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { loadBundledTypography, type BundledTypography } from "./hd-typography.js";
import { TextRunEffect, type TextRunV1 } from "./text-run-ir.js";

const publicRoot = path.resolve(import.meta.dirname, "../../public");

function run(text: string, classification: TextRunV1["classification"] = "safe-modern"): TextRunV1 {
  const bytes = Array.from(new TextEncoder().encode(text));
  return {
    schemaVersion: 1,
    sequence: 7,
    update: { low: 42, high: 0 },
    classification,
    reasonMask: classification === "safe-modern" ? 0 : 1,
    sideEffectMask: 0,
    unsupportedMask: 0,
    anchor: [16, 20],
    cursorIn: [16, 20],
    cursorOut: [40, 20],
    rightmostX: 39,
    diagnosticBounds: { x: 16, y: 20, width: 24, height: 6 },
    foregroundIn: 7,
    foregroundOut: 7,
    printAttributes: 0,
    customFont: { revision: 0, memoryBase: 0x5600, memorySize: 0x100 },
    appendNewline: false,
    spans: [{ byteOffset: 0, byteLength: bytes.length, kind: "visual", reasonMask: 0, sideEffectMask: 0 }],
    rawP8scii: bytes,
  };
}

describe("bundled HD typography", () => {
  let typography: BundledTypography;
  const loadedFaces: Array<{ family: string; weight: string }> = [];
  const installedFaces: unknown[] = [];

  beforeAll(async () => {
    typography = await loadBundledTypography(new URL("https://aico8.test/"), {
      fetch: async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        const bytes = await readFile(path.join(publicRoot, url.pathname));
        return new Response(Uint8Array.from(bytes));
      },
      createFontFace: (family, _bytes, descriptors) => {
        const face = { load: async () => face };
        loadedFaces.push({ family, weight: descriptors.weight ?? "normal" });
        return face;
      },
      addFontFace: (face) => installedFaces.push(face),
    });
  });

  it("verifies and installs exactly the two pinned font faces", () => {
    expect(loadedFaces).toEqual([
      { family: "Aico Sans", weight: "400" },
      { family: "Aico Sans", weight: "700" },
    ]);
    expect(installedFaces).toHaveLength(2);
    expect(typography.familyFor("menu")).toBe("Aico Sans");
  });

  it("keeps responsive Latin layout deterministic at square and mobile profiles", () => {
    const cases = [
      { target: 1024, scale: 1, box: { width: 220, height: 50 } },
      { target: 720, scale: 720 / 1024, box: { width: 154.688, height: 35.156 } },
      { target: 360, scale: 360 / 1024, box: { width: 77.344, height: 24 } },
    ];
    expect(cases.map(({ target, scale, box }) => {
      const layout = typography.layout(run("begin"), { role: "menu", profileScale: scale, box, align: "center" });
      return { target, fontSize: layout.fontSize, lineHeight: layout.lineHeight, width: layout.width, height: layout.height };
    })).toEqual([
      { target: 1024, fontSize: 32, lineHeight: 40, width: 81.648, height: 40 },
      { target: 720, fontSize: 22.5, lineHeight: 28.125, width: 57.409, height: 28.125 },
      { target: 360, fontSize: 16, lineHeight: 20, width: 40.824, height: 20 },
    ]);
  });

  it("wraps dialogue without squeezing glyph proportions", () => {
    const layout = typography.layout(run("move gently and listen"), {
      role: "dialogue",
      profileScale: 360 / 1024,
      box: { width: 145, height: 54 },
    });
    expect(layout.lines).toEqual(["move gently and", "listen"]);
    expect(layout.fontSize).toBe(16);
    expect(layout.height).toBe(43.429);
  });

  it("fails closed for review-required text, undeclared glyphs, and undersized boxes", () => {
    expect(() => typography.layout(run("begin", "review-required"), {
      role: "menu", profileScale: 1, box: { width: 200, height: 50 },
    })).toThrow(/not eligible/);
    expect(() => typography.layoutCopy("café", {
      role: "menu", profileScale: 1, box: { width: 200, height: 50 },
    })).toThrow(/printable ASCII/);
    expect(() => typography.layout(run("begin"), {
      role: "menu", profileScale: 1, box: { width: 8, height: 8 },
    })).toThrow(/does not fit/);
    expect(() => typography.layoutCopy("move gently and listen", {
      role: "dialogue", profileScale: 360 / 1024, box: { width: 48, height: 30 },
    })).toThrow(/does not fit/);
    expect(() => typography.layout({ ...run("begin"), sideEffectMask: TextRunEffect.cursor }, {
      role: "menu", profileScale: 1, box: { width: 200, height: 50 },
    })).not.toThrow();
    expect(() => typography.layout({ ...run("begin"), sideEffectMask: TextRunEffect.drawColor }, {
      role: "menu", profileScale: 1, box: { width: 200, height: 50 },
    })).toThrow(/not eligible/);
  });
});
