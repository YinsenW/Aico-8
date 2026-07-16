const SIGNATURE = "pico-8 cartridge // http://www.pico-8.com";
const SECTION_MARKER = /^__([a-z0-9_]+)__$/;
const KNOWN_SECTIONS = ["lua", "gfx", "gff", "map", "sfx", "music", "label"] as const;

export type P8KnownSection = typeof KNOWN_SECTIONS[number];
export type PixelRows = readonly (readonly number[])[];
export type ByteRows = readonly (readonly number[])[];

interface SourceLine {
  readonly content: string;
  readonly ending: string;
  readonly raw: string;
}

export interface P8SectionRecord {
  readonly name: string;
  readonly marker: string;
  readonly payload: string;
}

export interface P8TextCart {
  readonly version: number;
  readonly newline: "\n" | "\r\n" | "\r";
  readonly preamble: string;
  readonly sections: readonly P8SectionRecord[];
}

export interface P8TextResources {
  readonly lua: string;
  readonly gfx: PixelRows;
  readonly sharedMapAlias: ByteRows;
  readonly map: ByteRows;
  readonly gff: readonly number[];
  readonly sfxLines: readonly string[];
  readonly musicLines: readonly string[];
  readonly label: PixelRows;
  readonly sectionOrder: readonly string[];
  readonly presentSections: ReadonlySet<string>;
}

export interface P8TextEdits {
  readonly lua?: string;
  readonly gfx?: PixelRows;
  readonly sharedMapAlias?: ByteRows;
  readonly map?: ByteRows;
  readonly gff?: readonly number[];
  readonly sfxLines?: readonly string[];
  readonly musicLines?: readonly string[];
  readonly label?: PixelRows;
}

function splitSourceLines(text: string): SourceLine[] {
  const result: SourceLine[] = [];
  const endings = /\r\n|\n|\r/g;
  let start = 0;
  for (let match = endings.exec(text); match; match = endings.exec(text)) {
    const end = match.index + match[0].length;
    result.push({ content: text.slice(start, match.index), ending: match[0], raw: text.slice(start, end) });
    start = end;
  }
  if (start < text.length) result.push({ content: text.slice(start), ending: "", raw: text.slice(start) });
  return result;
}

function detectNewline(lines: readonly SourceLine[]): "\n" | "\r\n" | "\r" {
  const ending = lines.find((line) => line.ending !== "")?.ending;
  if (ending === "\r\n" || ending === "\r") return ending;
  return "\n";
}

export function parseP8Text(source: string | Uint8Array): P8TextCart {
  const text = typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true }).decode(source);
  if (text.includes("\0")) throw new TypeError("P8 text cart must not contain NUL bytes");
  const lines = splitSourceLines(text);
  if (lines.length === 0 || lines[0]?.content !== SIGNATURE) throw new TypeError("P8 text cart signature is missing");

  const sections: P8SectionRecord[] = [];
  const seen = new Set<string>();
  let preamble = "";
  let marker = "";
  let name: string | null = null;
  let payload = "";
  let version: number | null = null;

  const finishSection = (): void => {
    if (name === null) return;
    sections.push({ name, marker, payload });
    name = null;
    marker = "";
    payload = "";
  };

  for (const line of lines) {
    const match = SECTION_MARKER.exec(line.content.trim());
    if (match) {
      finishSection();
      const nextName = match[1] as string;
      if (seen.has(nextName)) throw new TypeError(`P8 text cart repeats __${nextName}__`);
      seen.add(nextName);
      name = nextName;
      marker = line.raw;
      continue;
    }
    if (name === null) {
      preamble += line.raw;
      const versionMatch = /^version\s+([0-9]+)\s*$/.exec(line.content);
      if (versionMatch) {
        const parsed = Number(versionMatch[1]);
        if (version !== null) throw new TypeError("P8 text cart declares version more than once");
        if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) throw new TypeError("P8 version must be 0 through 255");
        version = parsed;
      }
    } else payload += line.raw;
  }
  finishSection();
  if (version === null) throw new TypeError("P8 text cart version is missing");
  if (!seen.has("lua")) throw new TypeError("P8 text cart __lua__ section is missing");
  return { version, newline: detectNewline(lines), preamble, sections };
}

export function rebuildP8Text(cart: P8TextCart): string {
  return cart.preamble + cart.sections.map((section) => section.marker + section.payload).join("");
}

function normalizedPayload(payload: string): string {
  const normalized = payload.replace(/\r\n|\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
}

function logicalTextPayload(payload: string, newline: string): string {
  const logical = payload.replace(/\r\n|\r/g, "\n");
  return logical === "" ? "" : `${logical.split("\n").join(newline)}${newline}`;
}

function validLines(payload: string, width: number, alphabet: RegExp): string[] {
  return normalizedPayload(payload).split("\n")
    .map((line) => line.trim().toLowerCase())
    .filter((line) => line.length === width && alphabet.test(line));
}

function pixelRows(payload: string): number[][] {
  const rows = validLines(payload, 128, /^[0-9a-f]+$/).map((line) => [...line].map((value) => Number.parseInt(value, 16)));
  while (rows.length < 128) rows.push(Array<number>(128).fill(0));
  return rows.slice(0, 128);
}

function byteRows(payload: string, rowBytes: number, rowCount: number): number[][] {
  const rows = validLines(payload, rowBytes * 2, /^[0-9a-f]+$/).map((line) => {
    const row: number[] = [];
    for (let offset = 0; offset < line.length; offset += 2) row.push(Number.parseInt(line.slice(offset, offset + 2), 16));
    return row;
  });
  while (rows.length < rowCount) rows.push(Array<number>(rowBytes).fill(0));
  return rows.slice(0, rowCount);
}

function sharedMapRows(gfx: PixelRows): number[][] {
  const flat: number[] = [];
  for (const row of gfx.slice(64, 128)) {
    for (let x = 0; x < 128; x += 2) flat.push((row[x] as number) | ((row[x + 1] as number) << 4));
  }
  return Array.from({ length: 32 }, (_, index) => flat.slice(index * 128, (index + 1) * 128));
}

function flags(payload: string): number[] {
  return byteRows(payload, 128, 2).flat().slice(0, 256);
}

function sectionPayload(cart: P8TextCart, name: string): string {
  return cart.sections.find((section) => section.name === name)?.payload ?? "";
}

export function decodeP8TextResources(cart: P8TextCart): P8TextResources {
  const gfx = pixelRows(sectionPayload(cart, "gfx"));
  return {
    lua: normalizedPayload(sectionPayload(cart, "lua")),
    gfx,
    sharedMapAlias: sharedMapRows(gfx),
    map: byteRows(sectionPayload(cart, "map"), 128, 32),
    gff: flags(sectionPayload(cart, "gff")),
    sfxLines: validLines(sectionPayload(cart, "sfx"), 168, /^[0-9a-f]+$/).slice(0, 64),
    musicLines: normalizedPayload(sectionPayload(cart, "music")).split("\n").map((line) => line.trim().toLowerCase())
      .filter((line) => /^[0-9a-f]{2}\s+[0-9a-f]{8}$/.test(line)).slice(0, 64),
    label: pixelRows(sectionPayload(cart, "label")),
    sectionOrder: cart.sections.map((section) => section.name),
    presentSections: new Set(cart.sections.map((section) => section.name)),
  };
}

function checkedRows(rows: PixelRows, height: number, width: number, maximum: number, context: string): number[][] {
  if (rows.length !== height) throw new TypeError(`${context} must have ${height} rows`);
  return rows.map((row, y) => {
    if (row.length !== width) throw new TypeError(`${context}[${y}] must have ${width} values`);
    return row.map((value, x) => {
      if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError(`${context}[${y}][${x}] is out of range`);
      return value;
    });
  });
}

function sameRows(left: PixelRows, right: PixelRows): boolean {
  return left.length === right.length && left.every((row, y) => row.length === right[y]?.length
    && row.every((value, x) => value === right[y]?.[x]));
}

function encodeSharedMap(gfx: number[][], shared: PixelRows): void {
  const checked = checkedRows(shared, 32, 128, 255, "sharedMapAlias").flat();
  checked.forEach((value, index) => {
    const y = 64 + Math.floor(index / 64);
    const x = (index % 64) * 2;
    const row = gfx[y] as number[];
    row[x] = value & 0x0f;
    row[x + 1] = (value >>> 4) & 0x0f;
  });
}

function linesPayload(lines: readonly string[], newline: string): string {
  return lines.length === 0 ? "" : `${lines.join(newline)}${newline}`;
}

function checkedRecordLines(lines: readonly string[], maximum: number, pattern: RegExp, context: string): string[] {
  if (lines.length > maximum) throw new TypeError(`${context} must contain at most ${maximum} records`);
  return lines.map((line, index) => {
    const normalized = line.toLowerCase();
    if (!pattern.test(normalized)) throw new TypeError(`${context}[${index}] is malformed`);
    return normalized;
  });
}

function pixelPayload(rows: PixelRows, newline: string): string {
  return linesPayload(checkedRows(rows, 128, 128, 15, "pixels").map((row) => row.map((value) => value.toString(16)).join("")), newline);
}

function bytePayload(rows: ByteRows, height: number, newline: string, context: string): string {
  return linesPayload(checkedRows(rows, height, 128, 255, context).map((row) => row.map((value) => value.toString(16).padStart(2, "0")).join("")), newline);
}

function replacePayload(cart: P8TextCart, replacements: ReadonlyMap<string, string>): P8TextCart {
  for (const name of replacements.keys()) if (!cart.sections.some((section) => section.name === name)) {
    throw new TypeError(`Cannot edit absent __${name}__ section without an explicit section-add operation`);
  }
  return { ...cart, sections: cart.sections.map((section) => ({ ...section, payload: replacements.get(section.name) ?? section.payload })) };
}

export function applyP8TextEdits(cart: P8TextCart, edits: P8TextEdits): P8TextCart {
  const baseline = decodeP8TextResources(cart);
  let gfx = checkedRows(edits.gfx ?? baseline.gfx, 128, 128, 15, "gfx");
  const gfxChanged = edits.gfx !== undefined && !sameRows(gfx, baseline.gfx);
  const shared = edits.sharedMapAlias === undefined
    ? sharedMapRows(gfx)
    : checkedRows(edits.sharedMapAlias, 32, 128, 255, "sharedMapAlias");
  const sharedChanged = edits.sharedMapAlias !== undefined && !sameRows(shared, baseline.sharedMapAlias);
  if (gfxChanged && sharedChanged && !sameRows(sharedMapRows(gfx), shared)) {
    throw new TypeError("shared-memory conflict: gfx lower half and sharedMapAlias changed differently");
  }
  if (sharedChanged && !sameRows(sharedMapRows(gfx), shared)) {
    gfx = gfx.map((row) => [...row]);
    encodeSharedMap(gfx, shared);
  }

  const replacements = new Map<string, string>();
  if (edits.lua !== undefined) {
    if (edits.lua.includes("\0")) throw new TypeError("lua must not contain NUL bytes");
    replacements.set("lua", logicalTextPayload(edits.lua, cart.newline));
  }
  if (edits.gfx !== undefined || edits.sharedMapAlias !== undefined) replacements.set("gfx", pixelPayload(gfx, cart.newline));
  if (edits.map !== undefined) replacements.set("map", bytePayload(edits.map, 32, cart.newline, "map"));
  if (edits.gff !== undefined) {
    if (edits.gff.length !== 256) throw new TypeError("gff must contain 256 bytes");
    const checked = [...edits.gff].map((value, index) => {
      if (!Number.isSafeInteger(value) || value < 0 || value > 255) throw new TypeError(`gff[${index}] is out of range`);
      return value;
    });
    replacements.set("gff", linesPayload([
      checked.slice(0, 128).map((value) => value.toString(16).padStart(2, "0")).join(""),
      checked.slice(128).map((value) => value.toString(16).padStart(2, "0")).join(""),
    ], cart.newline));
  }
  if (edits.sfxLines !== undefined) replacements.set("sfx", linesPayload(
    checkedRecordLines(edits.sfxLines, 64, /^[0-9a-f]{168}$/, "sfxLines"), cart.newline,
  ));
  if (edits.musicLines !== undefined) replacements.set("music", linesPayload(
    checkedRecordLines(edits.musicLines, 64, /^[0-9a-f]{2} [0-9a-f]{8}$/, "musicLines"), cart.newline,
  ));
  if (edits.label !== undefined) replacements.set("label", pixelPayload(edits.label, cart.newline));
  return replacePayload(cart, replacements);
}
