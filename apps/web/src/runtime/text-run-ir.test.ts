import { describe, expect, it } from "vitest";

import {
  TEXT_RUN_IR_SCHEMA_VERSION,
  TextRunEffect,
  decodeTextRunIr,
} from "./text-run-ir.js";

const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff];
const u32 = (value: number) => [value & 0xff, (value >>> 8) & 0xff,
  (value >>> 16) & 0xff, (value >>> 24) & 0xff];

function fixture(): Uint8Array {
  const raw = [0x64, 0x75, 0x73, 0x74];
  const run = [
    ...u32(112 + 20 + raw.length), ...u16(112), ...u16(1),
    ...u32(7), ...u32(9), ...u32(2), ...u32(1), ...u32(0), ...u32(TextRunEffect.cursor), ...u32(0),
    ...u32(4), ...u32(5), ...u32(4), ...u32(5), ...u32(20), ...u32(5), ...u32(20),
    ...u32(4), ...u32(5), ...u32(16), ...u32(5),
    ...u32(8), ...u32(8), ...u32(0), ...u32(0), ...u32(0x5600), ...u32(256), ...u32(0), ...u32(raw.length),
    ...u32(0), ...u32(raw.length), ...u32(1), ...u32(0), ...u32(TextRunEffect.cursor),
    ...raw,
  ];
  return Uint8Array.from([0x41, 0x38, 0x54, 0x52, ...u16(1), ...u16(12), ...u32(1), ...run]);
}

describe("DATA-TEXT-RUN-001 decoder", () => {
  it("decodes the canonical little-endian contract without changing raw P8SCII", () => {
    const [run] = decodeTextRunIr(fixture());
    expect(run).toBeDefined();
    if (!run) throw new Error("fixture did not decode a run");
    expect(run.schemaVersion).toBe(TEXT_RUN_IR_SCHEMA_VERSION);
    expect(run.sequence).toBe(7);
    expect(run.update).toEqual({ low: 9, high: 2 });
    expect(run.classification).toBe("safe-modern");
    expect(run.anchor).toEqual([4, 5]);
    expect(run.cursorOut).toEqual([20, 5]);
    expect(run.diagnosticBounds).toEqual({ x: 4, y: 5, width: 16, height: 5 });
    expect(run.spans).toEqual([{
      byteOffset: 0,
      byteLength: 4,
      kind: "visual",
      reasonMask: 0,
      sideEffectMask: TextRunEffect.cursor,
    }]);
    expect(Array.from(run.rawP8scii)).toEqual([0x64, 0x75, 0x73, 0x74]);
  });

  it("fails closed on version, record-size, and span-range drift", () => {
    const wrongVersion = fixture();
    wrongVersion[4] = 2;
    expect(() => decodeTextRunIr(wrongVersion)).toThrow(/schema version/);

    const wrongRecord = fixture();
    wrongRecord[12] = 1;
    expect(() => decodeTextRunIr(wrongRecord)).toThrow(/record size/);

    const wrongSpan = fixture();
    wrongSpan[12 + 112 + 4] = 9;
    expect(() => decodeTextRunIr(wrongSpan)).toThrow(/byte range/);
  });
});
