export const TEXT_RUN_IR_SCHEMA_VERSION = 1 as const;

export const TextRunReason = {
  nonAscii: 1 << 0,
  customFont: 1 << 1,
  inlineGlyph: 1 << 2,
  visualControl: 1 << 3,
  sideEffect: 1 << 4,
  unsupported: 1 << 5,
  ambiguousMapping: 1 << 6,
} as const;

export const TextRunEffect = {
  cursor: 1 << 0,
  drawColor: 1 << 1,
  ramWrite: 1 << 2,
  screenClear: 1 << 3,
  audio: 1 << 4,
  timing: 1 << 5,
  renderState: 1 << 6,
  customFontState: 1 << 7,
} as const;

export type TextRunClassification = "safe-modern" | "reference-only" | "review-required";
export type TextRunSpanKind = "visual" | "control" | "inline-glyph" | "terminator";

export interface TextRunSpanV1 {
  readonly byteOffset: number;
  readonly byteLength: number;
  readonly kind: TextRunSpanKind;
  readonly reasonMask: number;
  readonly sideEffectMask: number;
}

export interface TextRunV1 {
  readonly schemaVersion: typeof TEXT_RUN_IR_SCHEMA_VERSION;
  readonly sequence: number;
  readonly update: Readonly<{ low: number; high: number }>;
  readonly classification: TextRunClassification;
  readonly reasonMask: number;
  readonly sideEffectMask: number;
  readonly unsupportedMask: number;
  readonly anchor: readonly [number, number];
  readonly cursorIn: readonly [number, number];
  readonly cursorOut: readonly [number, number];
  readonly rightmostX: number;
  readonly diagnosticBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly foregroundIn: number;
  readonly foregroundOut: number;
  readonly printAttributes: number;
  readonly customFont: Readonly<{ revision: number; memoryBase: number; memorySize: number }>;
  readonly appendNewline: boolean;
  readonly spans: readonly TextRunSpanV1[];
  readonly rawP8scii: readonly number[];
}

const STREAM_HEADER_BYTES = 12;
const RUN_HEADER_BYTES = 112;
const SPAN_BYTES = 20;
const MAGIC = [0x41, 0x38, 0x54, 0x52] as const;

function fail(message: string): never {
  throw new Error(`Invalid DATA-TEXT-RUN-001 stream: ${message}`);
}

function classification(value: number): TextRunClassification {
  if (value === 1) return "safe-modern";
  if (value === 2) return "reference-only";
  if (value === 3) return "review-required";
  return fail(`unknown classification ${value}`);
}

function spanKind(value: number): TextRunSpanKind {
  if (value === 1) return "visual";
  if (value === 2) return "control";
  if (value === 3) return "inline-glyph";
  if (value === 4) return "terminator";
  return fail(`unknown span kind ${value}`);
}

export function decodeTextRunIr(bytes: Uint8Array): readonly TextRunV1[] {
  if (bytes.byteLength < STREAM_HEADER_BYTES) fail("truncated stream header");
  if (!MAGIC.every((value, index) => bytes[index] === value)) fail("wrong magic");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== TEXT_RUN_IR_SCHEMA_VERSION) fail(`unsupported schema version ${version}`);
  if (view.getUint16(6, true) !== STREAM_HEADER_BYTES) fail("wrong stream header size");
  const runCount = view.getUint32(8, true);
  const runs: TextRunV1[] = [];
  let offset = STREAM_HEADER_BYTES;
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    if (offset + RUN_HEADER_BYTES > bytes.byteLength) fail(`run ${runIndex} header is truncated`);
    const recordSize = view.getUint32(offset, true);
    const headerSize = view.getUint16(offset + 4, true);
    const spanCount = view.getUint16(offset + 6, true);
    if (headerSize !== RUN_HEADER_BYTES) fail(`run ${runIndex} has unknown header size ${headerSize}`);
    const rawSize = view.getUint32(offset + 108, true);
    const requiredSize = RUN_HEADER_BYTES + spanCount * SPAN_BYTES + rawSize;
    if (recordSize !== requiredSize || recordSize > bytes.byteLength - offset) {
      fail(`run ${runIndex} record size is inconsistent`);
    }
    const spans: TextRunSpanV1[] = [];
    let spanOffset = offset + RUN_HEADER_BYTES;
    let previousEnd = 0;
    for (let spanIndex = 0; spanIndex < spanCount; spanIndex += 1) {
      const byteOffset = view.getUint32(spanOffset, true);
      const byteLength = view.getUint32(spanOffset + 4, true);
      if (byteLength === 0 || byteOffset < previousEnd || byteOffset + byteLength > rawSize) {
        fail(`run ${runIndex} span ${spanIndex} has an invalid byte range`);
      }
      spans.push({
        byteOffset,
        byteLength,
        kind: spanKind(view.getUint32(spanOffset + 8, true)),
        reasonMask: view.getUint32(spanOffset + 12, true),
        sideEffectMask: view.getUint32(spanOffset + 16, true),
      });
      previousEnd = byteOffset + byteLength;
      spanOffset += SPAN_BYTES;
    }
    runs.push({
      schemaVersion: TEXT_RUN_IR_SCHEMA_VERSION,
      sequence: view.getUint32(offset + 8, true),
      update: {
        low: view.getUint32(offset + 12, true),
        high: view.getUint32(offset + 16, true),
      },
      classification: classification(view.getUint32(offset + 20, true)),
      reasonMask: view.getUint32(offset + 24, true),
      sideEffectMask: view.getUint32(offset + 28, true),
      unsupportedMask: view.getUint32(offset + 32, true),
      anchor: [view.getInt32(offset + 36, true), view.getInt32(offset + 40, true)],
      cursorIn: [view.getInt32(offset + 44, true), view.getInt32(offset + 48, true)],
      cursorOut: [view.getInt32(offset + 52, true), view.getInt32(offset + 56, true)],
      rightmostX: view.getInt32(offset + 60, true),
      diagnosticBounds: {
        x: view.getInt32(offset + 64, true),
        y: view.getInt32(offset + 68, true),
        width: view.getInt32(offset + 72, true),
        height: view.getInt32(offset + 76, true),
      },
      foregroundIn: view.getUint32(offset + 80, true),
      foregroundOut: view.getUint32(offset + 84, true),
      printAttributes: view.getUint32(offset + 88, true),
      customFont: {
        revision: view.getUint32(offset + 92, true),
        memoryBase: view.getUint32(offset + 96, true),
        memorySize: view.getUint32(offset + 100, true),
      },
      appendNewline: view.getUint32(offset + 104, true) !== 0,
      spans,
      rawP8scii: Array.from(bytes.slice(spanOffset, spanOffset + rawSize)),
    });
    offset += recordSize;
  }
  if (offset !== bytes.byteLength) fail("trailing bytes after declared runs");
  return runs;
}
