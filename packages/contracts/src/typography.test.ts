import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  TEXT_CLASSIFICATIONS,
  GLYPH_METRICS_SCHEMA_VERSION,
  TEXT_INVENTORY_SCHEMA_VERSION,
  TEXT_PROVENANCE_KINDS,
  TYPOGRAPHY_MANIFEST_SCHEMA_VERSION,
  validateGlyphMetrics,
  validateTextInventory,
  validateTypographyContract,
  validateTypographyManifest,
} from "./typography.js";

const hash = "a".repeat(64);
const regularHash = "2df4ba17804bc7a36f123127966075d8427bff2df58d0d76820c1130bb1a4150";
const licenseHash = "64b9cae8727cb41ea9e8843103e69647c82383f3a902e2bb39b2c5d92083b6e1";
const codePoints = (text: string) => [...text].map((character) => character.codePointAt(0) as number);

const source = (bytesHex: string) => ({
  commandId: "print-1",
  sequence: 0,
  updateLow: 1,
  updateHigh: 0,
  byteStart: 0,
  bytesHex,
  p8sciiEvidenceSha256: hash,
});
const flags = () => ({ effectful: false, customFont: false, inlineGlyph: false, buttonGlyph: false, ambiguousMapping: false });
const run = (overrides: Record<string, unknown> = {}): any => ({
  id: "menu-begin",
  reachable: true,
  contentKind: "semantic-text",
  role: "menu",
  classification: "safe-modern",
  source: source("626567696e"),
  unicode: { text: "begin", codePoints: codePoints("begin"), mappingKind: "lossless-declared", mappingEvidenceSha256: hash },
  provenance: { kind: "source-authored", evidenceSha256: hash },
  flags: flags(),
  mapping: { kind: "bundled-font", role: "menu" },
  ...overrides,
});
const wordmark = (): any => run({
  id: "title-wordmark",
  contentKind: "identity-wordmark",
  role: "display",
  source: source("64757374"),
  unicode: { text: "dust", codePoints: codePoints("dust"), mappingKind: "lossless-declared", mappingEvidenceSha256: hash },
  mapping: {
    kind: "identity-contour",
    identityElementId: "title-dust",
    contourEvidenceSha256: hash,
    reviewDecisionSha256: hash,
  },
});
const blockedInline = (): any => run({
  id: "inline-symbol",
  contentKind: "inline-glyph",
  role: "symbol",
  classification: "review-required",
  source: source("8e"),
  unicode: { text: "?", codePoints: [63], mappingKind: "ambiguous", mappingEvidenceSha256: hash },
  flags: { ...flags(), inlineGlyph: true, ambiguousMapping: true },
  mapping: { kind: "review-blocker", reasonCode: "inline-ambiguous", evidenceSha256: hash },
});
const inventory = (): any => ({
  schemaVersion: TEXT_INVENTORY_SCHEMA_VERSION,
  status: "draft",
  gameId: "synthetic-typography",
  sourceSha256: hash,
  runs: [run(), wordmark(), blockedInline()],
});
const completeInventory = (): any => {
  const value = inventory();
  value.status = "complete-for-hd";
  value.runs = [run(), wordmark()];
  return value;
};

const atkinsonAsset = (): any => ({
  id: "atkinson-regular",
  family: "Atkinson Hyperlegible",
  version: "1cb311624b2ddf88e9e37873999d165a8cd28b46",
  face: { weight: 400, style: "normal" },
  file: {
    path: "apps/web/public/fonts/AtkinsonHyperlegible-Regular.woff2",
    sha256: regularHash,
    format: "woff2",
  },
  metrics: {
    path: "apps/web/public/fonts/AtkinsonHyperlegible-Regular.metrics.json",
    sha256: hash,
    schemaVersion: "aico8.glyph-metrics.v1",
  },
  source: {
    upstreamRevision: "1cb311624b2ddf88e9e37873999d165a8cd28b46",
    provenancePath: "apps/web/public/fonts/AtkinsonHyperlegible-PROVENANCE.txt",
    provenanceSha256: hash,
  },
  license: {
    spdx: "OFL-1.1",
    evidencePath: "apps/web/public/fonts/OFL-Atkinson-Hyperlegible.txt",
    evidenceSha256: licenseHash,
  },
  coverageCodePoints: codePoints("begin").sort((left, right) => left - right),
});
const manifest = (): any => ({
  schemaVersion: TYPOGRAPHY_MANIFEST_SCHEMA_VERSION,
  manifestId: "synthetic-latin-v1",
  osFallback: false,
  assets: [atkinsonAsset()],
  roles: [{
    role: "menu",
    renderer: "woff2-canvas",
    fontAssetIds: ["atkinson-regular"],
    requiredCodePoints: codePoints("begin").sort((left, right) => left - right),
    metrics: { sizePx: 32, weight: 400, trackingPx: 0, lineHeightPx: 40 },
    fit: { minSizePx: 24, overflow: "fail", maxLines: 1 },
    osFallback: false,
  }],
});

describe("typography routing contracts", () => {
  it("accepts bundled semantic text, reviewed identity contours, and explicit blockers", () => {
    expect(validateTextInventory(inventory())).toEqual({ valid: true, errors: [] });
    expect(validateTypographyManifest(manifest(), inventory())).toEqual({ valid: true, errors: [] });
    expect(validateTypographyContract(inventory(), manifest()).valid).toBe(true);
    expect(validateTypographyContract(completeInventory(), manifest())).toEqual({ valid: true, errors: [] });
  });

  it("preserves repeated characters in the ordered decoded text", () => {
    const value = inventory();
    value.runs[1].source = source("62756e6e79");
    value.runs[1].unicode = {
      text: "bunny",
      codePoints: codePoints("bunny"),
      mappingKind: "lossless-declared",
      mappingEvidenceSha256: hash,
    };
    expect(validateTextInventory(value)).toEqual({ valid: true, errors: [] });
  });

  it("binds the existing Atkinson Regular bytes and OFL evidence without inventing an asset", () => {
    const asset = atkinsonAsset();
    expect(asset.file.sha256).toBe(regularHash);
    expect(asset.license).toEqual({
      spdx: "OFL-1.1",
      evidencePath: "apps/web/public/fonts/OFL-Atkinson-Hyperlegible.txt",
      evidenceSha256: licenseHash,
    });
  });

  it("validates generated glyph metrics against the pinned public manifest", () => {
    const publicRoot = new URL("../../../apps/web/public/", import.meta.url);
    const publicManifest = JSON.parse(readFileSync(new URL("typography/latin-ui-v1.json", publicRoot), "utf8"));
    expect(validateTypographyManifest(publicManifest)).toEqual({ valid: true, errors: [] });
    for (const asset of publicManifest.assets) {
      const metrics = JSON.parse(readFileSync(new URL(asset.metrics.path, publicRoot), "utf8"));
      expect(validateGlyphMetrics(metrics, asset), asset.id).toEqual({ valid: true, errors: [] });
    }
  });

  it("rejects a missing safe-modern character", () => {
    const value = manifest();
    value.roles[0].requiredCodePoints = codePoints("begi");
    expect(validateTypographyManifest(value, inventory()).errors.join("\n")).toMatch(/safe-modern character U\+6E/);

    const missingAssetGlyph = manifest();
    missingAssetGlyph.assets[0].coverageCodePoints = codePoints("begi");
    expect(validateTypographyManifest(missingAssetGlyph, inventory()).errors.join("\n")).toMatch(/required character U\+6E/);
  });

  it("rejects an effectful run classified safe-modern", () => {
    const value = inventory();
    value.runs[0].flags.effectful = true;
    expect(validateTextInventory(value).errors.join("\n")).toMatch(/must remain review-required/);
  });

  it("rejects generic-font substitution for identity wordmarks and source-drawn glyphs", () => {
    const value = inventory();
    value.runs[1].mapping = { kind: "bundled-font", role: "display" };
    expect(validateTextInventory(value).errors.join("\n")).toMatch(/identity-contour, never a generic font/);
  });

  it("treats complete identity artwork as a reviewed asset, not ordinary font-safe text", () => {
    const value = completeInventory();
    value.runs[1].mapping.reviewDecisionSha256 = "pending";
    expect(validateTextInventory(value).errors.join("\n")).toMatch(/reviewDecisionSha256 must be a lowercase SHA-256 digest/);
  });

  it("rejects absent font hashes or explicit reusable licensing", () => {
    const value = manifest();
    value.assets[0].file.sha256 = null;
    value.assets[0].license.spdx = "NOASSERTION";
    value.assets[0].license.evidenceSha256 = "unknown";
    expect(validateTypographyManifest(value).errors.join("\n")).toMatch(/SHA-256|explicit reusable license/);
  });

  it("rejects OS font fallback globally or per role", () => {
    const value = manifest();
    value.osFallback = true;
    value.roles[0].osFallback = true;
    expect(validateTypographyManifest(value).errors.join("\n")).toMatch(/osFallback must equal false/);
  });

  it("rejects a role whose declared weight has no bundled face", () => {
    const value = manifest();
    value.roles[0].metrics.weight = 700;
    expect(validateTypographyManifest(value).errors.join("\n")).toMatch(/no bundled face at declared weight 700/);
  });

  it("rejects unknown text provenance", () => {
    const value = inventory();
    value.runs[0].provenance.kind = "model-guessed";
    expect(validateTextInventory(value).errors.join("\n")).toMatch(/provenance.kind is unknown/);
    expect(validateTypographyContract(value, manifest()).errors.filter((error) => error.includes("provenance.kind is unknown"))).toHaveLength(1);
  });

  it("rejects an unmapped reachable run", () => {
    const value = inventory();
    value.runs[0].mapping = null;
    expect(validateTextInventory(value).errors.join("\n")).toMatch(/reachable run and must have an explicit mapping or blocker/);
  });

  it("keeps custom, inline, button, and ambiguous glyphs review-required", () => {
    for (const mutation of ["customFont", "inlineGlyph", "buttonGlyph", "ambiguousMapping"]) {
      const value = inventory();
      value.runs[0].flags[mutation] = true;
      expect(validateTextInventory(value).errors.join("\n"), mutation).toMatch(/must remain review-required/);
    }
  });

  it("rejects blockers and diagnostic-only mappings from complete-for-hd inventories", () => {
    const blocked = inventory();
    blocked.status = "complete-for-hd";
    expect(validateTextInventory(blocked).errors.join("\n")).toMatch(/complete-for-hd cannot contain/);

    const diagnostic = completeInventory();
    diagnostic.runs[0].classification = "reference-only";
    diagnostic.runs[0].mapping = { kind: "diagnostic-reference", correspondenceRegionSha256: hash };
    expect(validateTextInventory(diagnostic).errors.join("\n")).toMatch(/complete-for-hd cannot contain/);

    const unmapped = completeInventory();
    unmapped.runs[0].mapping = null;
    expect(validateTextInventory(unmapped).errors.join("\n")).toMatch(/must have an explicit mapping|complete-for-hd semantic text requires/);
  });

  it("rejects Unicode surrogate code points", () => {
    const value = inventory();
    value.runs[0].unicode.text = "x";
    value.runs[0].unicode.codePoints = [0xd800];
    expect(validateTextInventory(value).errors.join("\n")).toMatch(/Unicode scalar value/);
  });

  it("keeps typography JSON Schemas synchronized with executable versions and enums", () => {
    const inventorySchema = JSON.parse(readFileSync(
      new URL("../../../specs/schemas/text-inventory-v1.schema.json", import.meta.url), "utf8",
    ));
    const manifestSchema = JSON.parse(readFileSync(
      new URL("../../../specs/schemas/typography-manifest-v1.schema.json", import.meta.url), "utf8",
    ));
    const textRunSchema = JSON.parse(readFileSync(
      new URL("../../../specs/schemas/text-run-v1.schema.json", import.meta.url), "utf8",
    ));
    const glyphMetricsSchema = JSON.parse(readFileSync(
      new URL("../../../specs/schemas/glyph-metrics-v1.schema.json", import.meta.url), "utf8",
    ));
    expect(inventorySchema.properties.schemaVersion.const).toBe(TEXT_INVENTORY_SCHEMA_VERSION);
    expect(inventorySchema.$defs.run.properties.classification.enum).toEqual(TEXT_CLASSIFICATIONS);
    expect(inventorySchema.$defs.run.properties.provenance.properties.kind.enum).toEqual(TEXT_PROVENANCE_KINDS);
    expect(manifestSchema.properties.schemaVersion.const).toBe(TYPOGRAPHY_MANIFEST_SCHEMA_VERSION);
    expect(manifestSchema.properties.osFallback.const).toBe(false);
    expect(glyphMetricsSchema.properties.schemaVersion.const).toBe(GLYPH_METRICS_SCHEMA_VERSION);
    expect(textRunSchema.properties.schemaVersion.const).toBe(1);
    expect(textRunSchema.properties.classification.enum).toEqual(TEXT_CLASSIFICATIONS);
    expect(textRunSchema.properties.customFont.properties).toMatchObject({
      memoryBase: { const: 0x5600 },
      memorySize: { const: 256 },
    });
  });
});
