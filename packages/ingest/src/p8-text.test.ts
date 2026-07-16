import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { applyP8TextEdits, decodeP8TextResources, parseP8Text, rebuildP8Text } from "./p8-text.js";

const source = fs.readFileSync(new URL("../../../tests/fixtures/ingest/synthetic-alias/source/source.p8", import.meta.url));

describe("P8 text ingest", () => {
  it("preserves the source bytes, version, section order, and absent-section distinctions", () => {
    const cart = parseP8Text(source);
    expect(cart.version).toBe(42);
    expect(cart.sections.map((section) => section.name)).toEqual(["lua", "gfx", "gff", "map", "sfx", "music", "label"]);
    expect(Buffer.from(rebuildP8Text(cart))).toEqual(source);
    expect(decodeP8TextResources(cart).presentSections.has("label")).toBe(true);
  });

  it("preserves CRLF, unknown sections, whitespace, and a final unterminated line", () => {
    const text = "pico-8 cartridge // http://www.pico-8.com\r\nversion 42\r\n__lua__\r\nprint(1)\r\n__meta__\r\n exact ";
    const cart = parseP8Text(text);
    expect(cart.newline).toBe("\r\n");
    expect(cart.sections.map((section) => section.name)).toEqual(["lua", "meta"]);
    expect(rebuildP8Text(cart)).toBe(text);
  });

  it("edits primary map bytes without changing Lua, gfx, or section order", () => {
    const cart = parseP8Text(source);
    const before = decodeP8TextResources(cart);
    const map = before.map.map((row) => [...row]);
    (map[0] as number[])[0] = 0x2a;
    const edited = applyP8TextEdits(cart, { map });
    const after = decodeP8TextResources(parseP8Text(rebuildP8Text(edited)));
    expect(after.map[0]?.[0]).toBe(0x2a);
    expect(after.lua).toBe(before.lua);
    expect(after.gfx).toEqual(before.gfx);
    expect(after.sectionOrder).toEqual(before.sectionOrder);
  });

  it("round-trips logical Lua with a source-significant trailing blank line", () => {
    const text = "pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint(1)\n\n";
    const cart = parseP8Text(text);
    const logicalLua = decodeP8TextResources(cart).lua;
    expect(logicalLua).toBe("print(1)\n");
    expect(rebuildP8Text(applyP8TextEdits(cart, { lua: logicalLua }))).toBe(text);
  });

  it("updates the aliased lower sprite memory from one side and rejects divergent dual edits", () => {
    const cart = parseP8Text(source);
    const resources = decodeP8TextResources(cart);
    const shared = resources.sharedMapAlias.map((row) => [...row]);
    (shared[0] as number[])[0] = 0xab;
    const oneSided = decodeP8TextResources(applyP8TextEdits(cart, { sharedMapAlias: shared }));
    expect(oneSided.sharedMapAlias[0]?.[0]).toBe(0xab);
    expect(oneSided.gfx[64]?.[0]).toBe(0x0b);
    expect(oneSided.gfx[64]?.[1]).toBe(0x0a);

    const gfx = resources.gfx.map((row) => [...row]);
    (gfx[64] as number[])[0] = 1;
    expect(() => applyP8TextEdits(cart, { gfx, sharedMapAlias: shared })).toThrow(/shared-memory conflict/);
  });

  it("rejects malformed identity, duplicate sections, invalid UTF-8, and edits to absent resources", () => {
    expect(() => parseP8Text("version 42\n__lua__\n")).toThrow(/signature/);
    expect(() => parseP8Text(`${rebuildP8Text(parseP8Text(source))}__lua__\n`)).toThrow(/repeats/);
    expect(() => parseP8Text(Uint8Array.from([0xff]))).toThrow();
    const minimal = parseP8Text("pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint(1)\n");
    expect(() => applyP8TextEdits(minimal, { map: Array.from({ length: 32 }, () => Array(128).fill(0)) })).toThrow(/absent __map__/);
    expect(() => applyP8TextEdits(minimal, { lua: "print(1)\0" })).toThrow(/NUL/);
    const complete = parseP8Text(source);
    expect(() => applyP8TextEdits(complete, { sfxLines: ["bad"] })).toThrow(/sfxLines\[0\] is malformed/);
    expect(() => applyP8TextEdits(complete, { musicLines: ["00 0000000z"] })).toThrow(/musicLines\[0\] is malformed/);
  });
});
