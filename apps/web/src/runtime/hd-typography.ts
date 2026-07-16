import { Text } from "pixi.js";

import {
  validateGlyphMetrics,
  validateTypographyManifest,
  type GlyphMetricsV1,
  type TypographyFontAssetV1,
  type TypographyManifestV1,
  type TypographyRole,
  type TypographyRoleV1,
} from "@aico8/contracts";

import { TextRunEffect, type TextRunV1 } from "./text-run-ir.js";

export const BUNDLED_TYPOGRAPHY_MANIFEST_PATH = "typography/latin-ui-v1.json";

export interface HdTextBox {
  readonly width: number;
  readonly height: number;
}

export interface HdTextLayoutRequest {
  readonly role: TypographyRole;
  readonly box: HdTextBox;
  readonly profileScale: number;
  readonly align?: "left" | "center" | "right";
}

export interface HdTextLayout {
  readonly text: string;
  readonly lines: readonly string[];
  readonly family: string;
  readonly role: TypographyRole;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly width: number;
  readonly height: number;
  readonly align: "left" | "center" | "right";
}

export interface FontFaceLike {
  load(): Promise<FontFaceLike>;
}

export interface BundledTypographyLoadOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly createFontFace?: (family: string, bytes: ArrayBuffer, descriptors: FontFaceDescriptors) => FontFaceLike;
  readonly addFontFace?: (face: FontFaceLike) => void;
}

function fail(message: string): never {
  throw new Error(`HD typography: ${message}`);
}

function exactBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactBytes(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchBytes(fetcher: typeof globalThis.fetch, url: URL, label: string): Promise<Uint8Array> {
  const response = await fetcher(url);
  if (!response.ok) fail(`unable to load ${label} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseMetrics(value: unknown, asset: TypographyFontAssetV1): GlyphMetricsV1 {
  const validation = validateGlyphMetrics(value, asset);
  if (!validation.valid) fail(`${asset.id} metrics are invalid: ${validation.errors.join("; ")}`);
  return value as GlyphMetricsV1;
}

export function decodeSafeModernTextRun(run: TextRunV1): string {
  if (run.classification !== "safe-modern" || run.reasonMask !== 0
    || (run.sideEffectMask & ~TextRunEffect.cursor) !== 0
    || run.unsupportedMask !== 0 || run.customFont.revision !== 0) {
    return fail(`text run ${run.sequence} is not eligible for bundled-font rendering`);
  }
  if (run.rawP8scii.length === 0 || run.rawP8scii.some((byte) => byte < 0x20 || byte > 0x7e)) {
    return fail(`text run ${run.sequence} is not strict printable ASCII`);
  }
  return String.fromCodePoint(...run.rawP8scii);
}

export function textRunMatchesPrintPayload(run: TextRunV1, payload: Uint8Array): boolean {
  return run.rawP8scii.length === payload.length
    && run.rawP8scii.every((byte, index) => byte === payload[index]);
}

function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function pixiFontWeight(value: number): "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900" {
  const weight = String(value);
  if (["100", "200", "300", "400", "500", "600", "700", "800", "900"].includes(weight)) {
    return weight as "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";
  }
  return fail(`unsupported canvas font weight ${value}`);
}

function splitLongToken(token: string, fits: (copy: string) => boolean): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const character of token) {
    if (current && !fits(current + character)) {
      chunks.push(current);
      current = character;
    } else current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrapText(text: string, fits: (copy: string) => boolean): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    if (fits(word)) current = word;
    else {
      const chunks = splitLongToken(word, fits);
      lines.push(...chunks.slice(0, -1));
      current = chunks.at(-1) ?? "";
    }
  }
  if (current) lines.push(current);
  return lines;
}

export class BundledTypography {
  readonly #manifest: TypographyManifestV1;
  readonly #metrics = new Map<string, GlyphMetricsV1>();

  constructor(manifest: TypographyManifestV1, metrics: ReadonlyMap<string, GlyphMetricsV1>) {
    this.#manifest = manifest;
    for (const [id, value] of metrics) this.#metrics.set(id, value);
  }

  familyFor(role: TypographyRole): string {
    const roleEntry = this.#role(role);
    return this.#asset(roleEntry.fontAssetIds[0]!).family;
  }

  layout(run: TextRunV1, request: HdTextLayoutRequest): HdTextLayout {
    return this.layoutCopy(decodeSafeModernTextRun(run), request);
  }

  layoutCopy(text: string, request: HdTextLayoutRequest): HdTextLayout {
    if (!(request.profileScale > 0) || !(request.box.width > 0) || !(request.box.height > 0)) {
      return fail("layout scale and box dimensions must be positive");
    }
    if ([...text].some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint < 0x20 || codePoint > 0x7e;
    })) return fail("bundled Latin layout accepts printable ASCII only");
    const role = this.#role(request.role);
    const asset = this.#asset(role.fontAssetIds[0]!);
    const metrics = this.#metrics.get(asset.id) ?? fail(`missing metrics for ${asset.id}`);
    const advances = new Map(metrics.glyphs.map((glyph) => [glyph.codePoint, glyph.advanceWidth]));
    const minimumSize = Math.max(
      role.fit.minSizePx * request.profileScale,
      role.fit.accessibilityMinCssPx,
    );
    const preferredSize = Math.max(role.metrics.sizePx * request.profileScale, minimumSize);
    const lineHeightRatio = role.metrics.lineHeightPx / role.metrics.sizePx;
    const trackingRatio = role.metrics.trackingPx / role.metrics.sizePx;
    const widthAt = (copy: string, size: number): number => {
      let units = 0;
      for (const character of copy) {
        const codePoint = character.codePointAt(0)!;
        if (!role.requiredCodePoints.includes(codePoint)) fail(`role ${role.role} does not declare U+${codePoint.toString(16).toUpperCase()}`);
        units += advances.get(codePoint) ?? fail(`${asset.id} lacks metrics for U+${codePoint.toString(16).toUpperCase()}`);
      }
      return units / metrics.unitsPerEm * size + Math.max(0, copy.length - 1) * trackingRatio * size;
    };
    for (let size = preferredSize; size >= minimumSize - 0.0001; size = quantize(size - 0.25)) {
      const fits = (copy: string): boolean => widthAt(copy, size) <= request.box.width + 0.0001;
      let lines: string[];
      if (role.fit.overflow === "wrap") lines = wrapText(text, fits);
      else if (fits(text)) lines = [text];
      else if (role.fit.overflow === "ellipsis") {
        let copy = text;
        while (copy && !fits(`${copy}...`)) copy = copy.slice(0, -1);
        lines = copy ? [`${copy}...`] : [];
      } else lines = [];
      const lineHeight = lineHeightRatio * size;
      if (lines.length > 0 && lines.length <= role.fit.maxLines
        && lines.length * lineHeight <= request.box.height + 0.0001) {
        return {
          text: lines.join("\n"),
          lines,
          family: asset.family,
          role: role.role,
          fontSize: quantize(size),
          fontWeight: role.metrics.weight,
          lineHeight: quantize(lineHeight),
          letterSpacing: quantize(trackingRatio * size),
          width: quantize(Math.max(...lines.map((line) => widthAt(line, size)))),
          height: quantize(lines.length * lineHeight),
          align: request.align ?? "left",
        };
      }
    }
    return fail(`text does not fit role ${role.role} without violating its minimum size or line limit`);
  }

  createText(layout: HdTextLayout, fill: number): Text {
    return new Text({
      text: layout.text,
      style: {
        fill,
        fontFamily: layout.family,
        fontSize: layout.fontSize,
        fontWeight: pixiFontWeight(layout.fontWeight),
        lineHeight: layout.lineHeight,
        letterSpacing: layout.letterSpacing,
        align: layout.align,
      },
    });
  }

  #role(role: TypographyRole): TypographyRoleV1 {
    return this.#manifest.roles.find((entry) => entry.role === role) ?? fail(`manifest has no ${role} role`);
  }

  #asset(id: string): TypographyFontAssetV1 {
    return this.#manifest.assets.find((asset) => asset.id === id) ?? fail(`manifest has no ${id} asset`);
  }
}

export async function loadBundledTypography(
  baseUrl: URL,
  options: BundledTypographyLoadOptions = {},
): Promise<BundledTypography> {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const manifestBytes = await fetchBytes(fetcher, new URL(BUNDLED_TYPOGRAPHY_MANIFEST_PATH, baseUrl), "typography manifest");
  const manifest: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
  const validation = validateTypographyManifest(manifest);
  if (!validation.valid) fail(`manifest is invalid: ${validation.errors.join("; ")}`);
  const typedManifest = manifest as TypographyManifestV1;
  const metrics = new Map<string, GlyphMetricsV1>();
  const createFace = options.createFontFace ?? ((family, bytes, descriptors) => new FontFace(family, bytes, descriptors));
  const addFace = options.addFontFace ?? ((face) => document.fonts.add(face as FontFace));
  for (const asset of typedManifest.assets) {
    const [fontBytes, metricsBytes, provenanceBytes, licenseBytes] = await Promise.all([
      fetchBytes(fetcher, new URL(asset.file.path, baseUrl), `${asset.id} font`),
      fetchBytes(fetcher, new URL(asset.metrics.path, baseUrl), `${asset.id} metrics`),
      fetchBytes(fetcher, new URL(asset.source.provenancePath, baseUrl), `${asset.id} provenance`),
      fetchBytes(fetcher, new URL(asset.license.evidencePath, baseUrl), `${asset.id} license`),
    ]);
    const hashes = await Promise.all([fontBytes, metricsBytes, provenanceBytes, licenseBytes].map(sha256Hex));
    if (hashes[0] !== asset.file.sha256 || hashes[1] !== asset.metrics.sha256
      || hashes[2] !== asset.source.provenanceSha256 || hashes[3] !== asset.license.evidenceSha256) {
      fail(`${asset.id} resource hash differs from the manifest`);
    }
    metrics.set(asset.id, parseMetrics(JSON.parse(new TextDecoder().decode(metricsBytes)), asset));
    if (asset.file.format !== "woff2") fail(`${asset.id} renderer is not implemented by the WOFF2 runtime`);
    const face = createFace(asset.family, exactBytes(fontBytes), {
      style: asset.face.style,
      weight: String(asset.face.weight),
      display: "block",
    });
    await face.load();
    addFace(face);
  }
  return new BundledTypography(typedManifest, metrics);
}
