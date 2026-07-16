export const TEXT_INVENTORY_SCHEMA_VERSION = "aico8.text-inventory.v1" as const;
export const TYPOGRAPHY_MANIFEST_SCHEMA_VERSION = "aico8.typography-manifest.v1" as const;
export const GLYPH_METRICS_SCHEMA_VERSION = "aico8.glyph-metrics.v1" as const;

export const TEXT_CLASSIFICATIONS = ["safe-modern", "reference-only", "review-required"] as const;
export const TEXT_PROVENANCE_KINDS = [
  "source-authored",
  "state-derived-accessibility",
  "supplemental-authorized",
] as const;
export const TYPOGRAPHY_ROLES = [
  "display", "menu", "dialogue", "hud-number", "symbol", "diagnostic", "localized-body",
] as const;

export type TextClassification = (typeof TEXT_CLASSIFICATIONS)[number];
export type TextProvenanceKind = (typeof TEXT_PROVENANCE_KINDS)[number];
export type TypographyRole = (typeof TYPOGRAPHY_ROLES)[number];

export interface TextInventoryV1 {
  readonly schemaVersion: typeof TEXT_INVENTORY_SCHEMA_VERSION;
  readonly status: "draft" | "complete-for-hd";
  readonly gameId: string;
  readonly sourceSha256: string;
  readonly runs: readonly TextInventoryRunV1[];
}

export type TextContentKind = "semantic-text" | "identity-wordmark" | "source-drawn-glyph" | "button-glyph" | "inline-glyph";

export interface TextInventoryRunV1 {
  readonly id: string;
  readonly reachable: true;
  readonly contentKind: TextContentKind;
  readonly role: TypographyRole;
  readonly classification: TextClassification;
  readonly source: Readonly<{
    commandId: string;
    sequence: number;
    updateLow: number;
    updateHigh: number;
    byteStart: number;
    bytesHex: string;
    p8sciiEvidenceSha256: string;
  }>;
  readonly unicode: Readonly<{
    text: string;
    codePoints: readonly number[];
    mappingKind: "lossless-declared" | "unmapped" | "ambiguous";
    mappingEvidenceSha256: string;
  }>;
  readonly provenance: Readonly<{ kind: TextProvenanceKind; evidenceSha256: string }>;
  readonly flags: Readonly<{
    effectful: boolean;
    customFont: boolean;
    inlineGlyph: boolean;
    buttonGlyph: boolean;
    ambiguousMapping: boolean;
  }>;
  readonly mapping:
    | Readonly<{ kind: "bundled-font"; role: TypographyRole }>
    | Readonly<{ kind: "identity-contour"; identityElementId: string; contourEvidenceSha256: string; reviewDecisionSha256: string }>
    | Readonly<{ kind: "diagnostic-reference"; correspondenceRegionSha256: string }>
    | Readonly<{ kind: "review-blocker"; reasonCode: string; evidenceSha256: string }>;
}

export interface TypographyManifestV1 {
  readonly schemaVersion: typeof TYPOGRAPHY_MANIFEST_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly osFallback: false;
  readonly assets: readonly TypographyFontAssetV1[];
  readonly roles: readonly TypographyRoleV1[];
}

export interface TypographyFontAssetV1 {
  readonly id: string;
  readonly family: string;
  readonly version: string;
  readonly face: Readonly<{ weight: number; style: "normal" | "italic" }>;
  readonly file: Readonly<{ path: string; sha256: string; format: "woff2" | "msdf-atlas" | "sdf-atlas" }>;
  readonly metrics: Readonly<{ path: string; sha256: string; schemaVersion: typeof GLYPH_METRICS_SCHEMA_VERSION }>;
  readonly source: Readonly<{ upstreamRevision: string; provenancePath: string; provenanceSha256: string }>;
  readonly license: Readonly<{ spdx: string; evidencePath: string; evidenceSha256: string }>;
  readonly coverageCodePoints: readonly number[];
}

export interface TypographyRoleV1 {
  readonly role: TypographyRole;
  readonly renderer: "woff2-canvas" | "msdf" | "sdf";
  readonly fontAssetIds: readonly string[];
  readonly requiredCodePoints: readonly number[];
  readonly metrics: Readonly<{ sizePx: number; weight: number; trackingPx: number; lineHeightPx: number }>;
  readonly fit: Readonly<{
    minSizePx: number;
    accessibilityMinCssPx: number;
    overflow: "wrap" | "ellipsis" | "fail";
    maxLines: number;
  }>;
  readonly osFallback: false;
}

export interface GlyphMetricV1 {
  readonly codePoint: number;
  readonly glyphId: number;
  readonly advanceWidth: number;
  readonly bbox: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
}

export interface GlyphMetricsV1 {
  readonly schemaVersion: typeof GLYPH_METRICS_SCHEMA_VERSION;
  readonly fontAssetId: string;
  readonly fontSha256: string;
  readonly unitsPerEm: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineGap: number;
  readonly coverageCodePoints: readonly number[];
  readonly glyphs: readonly GlyphMetricV1[];
}

export interface TypographyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

type JsonRecord = Record<string, unknown>;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const hexPattern = /^(?:[a-f0-9]{2})+$/;
const mappingKinds = new Set(["bundled-font", "identity-contour", "diagnostic-reference", "review-blocker"]);
const contentKinds = new Set(["semantic-text", "identity-wordmark", "source-drawn-glyph", "button-glyph", "inline-glyph"]);

function record(value: unknown, path: string, errors: string[]): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], path: string, errors: string[]): void {
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function idValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    errors.push(`${path} must be a valid ID`);
    return false;
  }
  return true;
}

function hashValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !hashPattern.test(value)) {
    errors.push(`${path} must be a lowercase SHA-256 digest`);
    return false;
  }
  return true;
}

function stringValue(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function safeRelativePath(value: unknown, path: string, errors: string[]): value is string {
  if (!stringValue(value, path, errors)) return false;
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  return true;
}

function integerList(value: unknown, path: string, errors: string[], unique = false): number[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  const result: number[] = [];
  value.forEach((item, index) => {
    if (!Number.isSafeInteger(item) || (item as number) < 0 || (item as number) > 0x10ffff
      || ((item as number) >= 0xd800 && (item as number) <= 0xdfff)) {
      errors.push(`${path}[${index}] must be a Unicode scalar value`);
    } else result.push(item as number);
  });
  if (unique && new Set(result).size !== result.length) errors.push(`${path} must not contain duplicates`);
  return result;
}

function stringList(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return [];
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    if (idValue(item, `${path}[${index}]`, errors)) result.push(item);
  });
  if (new Set(result).size !== result.length) errors.push(`${path} must not contain duplicates`);
  return result;
}

function unicodeCodePoints(text: string): number[] {
  return [...text].map((character) => character.codePointAt(0) as number);
}

type RunSummary = {
  id: string;
  contentKind: string | undefined;
  role: TypographyRole | undefined;
  classification: TextClassification | undefined;
  codePoints: number[];
  mappingKind: string | undefined;
};

function validateRun(value: unknown, index: number, errors: string[]): RunSummary | undefined {
  const path = `$.runs[${index}]`;
  const run = record(value, path, errors);
  if (!run) return undefined;
  exactKeys(run, [
    "id", "reachable", "contentKind", "role", "classification", "source", "unicode",
    "provenance", "flags", "mapping",
  ], path, errors);
  const id = idValue(run.id, `${path}.id`, errors) ? run.id : undefined;
  if (run.reachable !== true) errors.push(`${path}.reachable must equal true; unreachable probes do not belong in this inventory`);
  const contentKind = contentKinds.has(run.contentKind as string) ? run.contentKind as string : undefined;
  if (!contentKind) errors.push(`${path}.contentKind is not supported`);
  const role = TYPOGRAPHY_ROLES.includes(run.role as TypographyRole) ? run.role as TypographyRole : undefined;
  if (!role) errors.push(`${path}.role is not supported`);
  const classification = TEXT_CLASSIFICATIONS.includes(run.classification as TextClassification)
    ? run.classification as TextClassification : undefined;
  if (!classification) errors.push(`${path}.classification is not supported`);

  const source = record(run.source, `${path}.source`, errors);
  if (source) {
    exactKeys(source, ["commandId", "sequence", "updateLow", "updateHigh", "byteStart", "bytesHex", "p8sciiEvidenceSha256"], `${path}.source`, errors);
    idValue(source.commandId, `${path}.source.commandId`, errors);
    for (const key of ["sequence", "updateLow", "updateHigh", "byteStart"] as const) {
      if (!Number.isSafeInteger(source[key]) || (source[key] as number) < 0 || (source[key] as number) > 0xffffffff) {
        errors.push(`${path}.source.${key} must be an unsigned 32-bit integer`);
      }
    }
    if (typeof source.bytesHex !== "string" || !hexPattern.test(source.bytesHex)) errors.push(`${path}.source.bytesHex must contain complete lowercase byte pairs`);
    hashValue(source.p8sciiEvidenceSha256, `${path}.source.p8sciiEvidenceSha256`, errors);
  }

  const unicode = record(run.unicode, `${path}.unicode`, errors);
  let codePoints: number[] = [];
  let mappingKind: string | undefined;
  if (unicode) {
    exactKeys(unicode, ["text", "codePoints", "mappingKind", "mappingEvidenceSha256"], `${path}.unicode`, errors);
    const text = stringValue(unicode.text, `${path}.unicode.text`, errors) ? unicode.text : undefined;
    codePoints = integerList(unicode.codePoints, `${path}.unicode.codePoints`, errors);
    mappingKind = ["lossless-declared", "unmapped", "ambiguous"].includes(unicode.mappingKind as string)
      ? unicode.mappingKind as string : undefined;
    if (!mappingKind) errors.push(`${path}.unicode.mappingKind is not supported`);
    hashValue(unicode.mappingEvidenceSha256, `${path}.unicode.mappingEvidenceSha256`, errors);
    if (text && JSON.stringify(codePoints) !== JSON.stringify(unicodeCodePoints(text))) {
      errors.push(`${path}.unicode.codePoints must exactly match the decoded text`);
    }
  }

  const provenance = record(run.provenance, `${path}.provenance`, errors);
  if (provenance) {
    exactKeys(provenance, ["kind", "evidenceSha256"], `${path}.provenance`, errors);
    if (!TEXT_PROVENANCE_KINDS.includes(provenance.kind as TextProvenanceKind)) {
      errors.push(`${path}.provenance.kind is unknown`);
    }
    hashValue(provenance.evidenceSha256, `${path}.provenance.evidenceSha256`, errors);
  }

  const flags = record(run.flags, `${path}.flags`, errors);
  let guarded = false;
  if (flags) {
    const flagNames = ["effectful", "customFont", "inlineGlyph", "buttonGlyph", "ambiguousMapping"] as const;
    exactKeys(flags, flagNames, `${path}.flags`, errors);
    for (const name of flagNames) {
      if (typeof flags[name] !== "boolean") errors.push(`${path}.flags.${name} must be boolean`);
      guarded ||= flags[name] === true;
    }
    if (contentKind === "button-glyph" && flags.buttonGlyph !== true) errors.push(`${path} button-glyph must set flags.buttonGlyph`);
    if (contentKind === "inline-glyph" && flags.inlineGlyph !== true) errors.push(`${path} inline-glyph must set flags.inlineGlyph`);
    if (mappingKind === "ambiguous" && flags.ambiguousMapping !== true) errors.push(`${path} ambiguous Unicode must set flags.ambiguousMapping`);
  }

  const mapping = record(run.mapping, `${path}.mapping`, errors);
  let mappedKind: string | undefined;
  if (!mapping) {
    errors.push(`${path} is a reachable run and must have an explicit mapping or blocker`);
  } else {
    mappedKind = mapping.kind as string;
    if (!mappingKinds.has(mappedKind)) errors.push(`${path}.mapping.kind is not supported`);
    if (mappedKind === "bundled-font") {
      exactKeys(mapping, ["kind", "role"], `${path}.mapping`, errors);
      if (mapping.role !== role) errors.push(`${path}.mapping.role must match the run role`);
    } else if (mappedKind === "identity-contour") {
      exactKeys(mapping, ["kind", "identityElementId", "contourEvidenceSha256", "reviewDecisionSha256"], `${path}.mapping`, errors);
      idValue(mapping.identityElementId, `${path}.mapping.identityElementId`, errors);
      hashValue(mapping.contourEvidenceSha256, `${path}.mapping.contourEvidenceSha256`, errors);
      hashValue(mapping.reviewDecisionSha256, `${path}.mapping.reviewDecisionSha256`, errors);
    } else if (mappedKind === "diagnostic-reference") {
      exactKeys(mapping, ["kind", "correspondenceRegionSha256"], `${path}.mapping`, errors);
      hashValue(mapping.correspondenceRegionSha256, `${path}.mapping.correspondenceRegionSha256`, errors);
    } else if (mappedKind === "review-blocker") {
      exactKeys(mapping, ["kind", "reasonCode", "evidenceSha256"], `${path}.mapping`, errors);
      idValue(mapping.reasonCode, `${path}.mapping.reasonCode`, errors);
      hashValue(mapping.evidenceSha256, `${path}.mapping.evidenceSha256`, errors);
    }
  }

  const identityArtwork = contentKind === "identity-wordmark" || contentKind === "source-drawn-glyph";
  if (identityArtwork && mappedKind !== "identity-contour") {
    errors.push(`${path} identity wordmark/source-drawn glyph must use identity-contour, never a generic font`);
  }
  if (guarded && classification !== "review-required") {
    errors.push(`${path} effectful/custom/inline/button/ambiguous runs must remain review-required`);
  }
  if (classification === "safe-modern") {
    if (mappingKind !== "lossless-declared") errors.push(`${path} safe-modern requires a lossless declared Unicode mapping`);
    if (!identityArtwork && mappedKind !== "bundled-font" && mappedKind !== "review-blocker") {
      errors.push(`${path} ordinary safe-modern text must use a bundled-font mapping or explicit review blocker`);
    }
  } else if (classification === "reference-only" && mappedKind !== "diagnostic-reference") {
    errors.push(`${path} reference-only requires diagnostic-reference mapping`);
  } else if (classification === "review-required" && mappedKind !== "review-blocker" && mappedKind !== "identity-contour") {
    errors.push(`${path} review-required must bind an identity contour or explicit review blocker`);
  }
  return id ? { id, contentKind, role, classification, codePoints, mappingKind: mappedKind } : undefined;
}

export function validateTextInventory(value: unknown): TypographyValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, ["schemaVersion", "status", "gameId", "sourceSha256", "runs"], "$", errors);
  if (root.schemaVersion !== TEXT_INVENTORY_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${TEXT_INVENTORY_SCHEMA_VERSION}`);
  if (root.status !== "draft" && root.status !== "complete-for-hd") errors.push("$.status must be draft or complete-for-hd");
  idValue(root.gameId, "$.gameId", errors);
  hashValue(root.sourceSha256, "$.sourceSha256", errors);
  if (!Array.isArray(root.runs) || root.runs.length === 0) errors.push("$.runs must be a non-empty reachable inventory");
  const ids: string[] = [];
  const summaries: RunSummary[] = [];
  if (Array.isArray(root.runs)) root.runs.forEach((run, index) => {
    const summary = validateRun(run, index, errors);
    if (summary) {
      ids.push(summary.id);
      summaries.push(summary);
    }
  });
  if (new Set(ids).size !== ids.length) errors.push("$.runs IDs must be unique");
  if (root.status === "complete-for-hd") summaries.forEach((summary) => {
    const path = `$.runs[${summary.id}]`;
    if (summary.classification !== "safe-modern") errors.push(`${path} complete-for-hd cannot contain reference-only or unresolved review-required runs`);
    if (summary.mappingKind === "review-blocker" || summary.mappingKind === "diagnostic-reference") {
      errors.push(`${path} complete-for-hd cannot contain unresolved blockers or diagnostic reference mappings`);
    }
    const identityArtwork = summary.contentKind === "identity-wordmark" || summary.contentKind === "source-drawn-glyph";
    if (identityArtwork && summary.mappingKind !== "identity-contour") errors.push(`${path} complete-for-hd identity artwork requires a reviewed identity contour`);
    if (!identityArtwork && summary.mappingKind !== "bundled-font") errors.push(`${path} complete-for-hd semantic text requires bundled-font mapping`);
  });
  return { valid: errors.length === 0, errors };
}

type AssetSummary = { id: string; coverage: Set<number>; weight?: number };
type RoleSummary = { role: TypographyRole; assets: string[]; required: Set<number>; weight?: number };

function validateAsset(value: unknown, index: number, errors: string[]): AssetSummary | undefined {
  const path = `$.assets[${index}]`;
  const asset = record(value, path, errors);
  if (!asset) return undefined;
  exactKeys(asset, ["id", "family", "version", "face", "file", "metrics", "source", "license", "coverageCodePoints"], path, errors);
  const id = idValue(asset.id, `${path}.id`, errors) ? asset.id : undefined;
  stringValue(asset.family, `${path}.family`, errors);
  stringValue(asset.version, `${path}.version`, errors);
  const face = record(asset.face, `${path}.face`, errors);
  let faceWeight: number | undefined;
  if (face) {
    exactKeys(face, ["weight", "style"], `${path}.face`, errors);
    if (!new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]).has(face.weight as number)) {
      errors.push(`${path}.face.weight must be a supported CSS hundred weight`);
    } else faceWeight = face.weight as number;
    if (!new Set(["normal", "italic"]).has(face.style as string)) errors.push(`${path}.face.style is not supported`);
  }
  const file = record(asset.file, `${path}.file`, errors);
  if (file) {
    exactKeys(file, ["path", "sha256", "format"], `${path}.file`, errors);
    safeRelativePath(file.path, `${path}.file.path`, errors);
    hashValue(file.sha256, `${path}.file.sha256`, errors);
    if (!new Set(["woff2", "msdf-atlas", "sdf-atlas"]).has(file.format as string)) errors.push(`${path}.file.format is not supported`);
  }
  const metrics = record(asset.metrics, `${path}.metrics`, errors);
  if (metrics) {
    exactKeys(metrics, ["path", "sha256", "schemaVersion"], `${path}.metrics`, errors);
    safeRelativePath(metrics.path, `${path}.metrics.path`, errors);
    hashValue(metrics.sha256, `${path}.metrics.sha256`, errors);
    if (metrics.schemaVersion !== GLYPH_METRICS_SCHEMA_VERSION) {
      errors.push(`${path}.metrics.schemaVersion must equal ${GLYPH_METRICS_SCHEMA_VERSION}`);
    }
  }
  const source = record(asset.source, `${path}.source`, errors);
  if (source) {
    exactKeys(source, ["upstreamRevision", "provenancePath", "provenanceSha256"], `${path}.source`, errors);
    stringValue(source.upstreamRevision, `${path}.source.upstreamRevision`, errors);
    safeRelativePath(source.provenancePath, `${path}.source.provenancePath`, errors);
    hashValue(source.provenanceSha256, `${path}.source.provenanceSha256`, errors);
  }
  const license = record(asset.license, `${path}.license`, errors);
  if (license) {
    exactKeys(license, ["spdx", "evidencePath", "evidenceSha256"], `${path}.license`, errors);
    if (!stringValue(license.spdx, `${path}.license.spdx`, errors)
      || ["NOASSERTION", "UNKNOWN", "UNLICENSED"].includes(license.spdx as string)) {
      errors.push(`${path}.license.spdx must name an explicit reusable license`);
    }
    safeRelativePath(license.evidencePath, `${path}.license.evidencePath`, errors);
    hashValue(license.evidenceSha256, `${path}.license.evidenceSha256`, errors);
  }
  const coverage = new Set(integerList(asset.coverageCodePoints, `${path}.coverageCodePoints`, errors, true));
  if (coverage.size === 0) errors.push(`${path}.coverageCodePoints must not be empty`);
  return id ? { id, coverage, ...(faceWeight === undefined ? {} : { weight: faceWeight }) } : undefined;
}

function validateRole(value: unknown, index: number, errors: string[]): RoleSummary | undefined {
  const path = `$.roles[${index}]`;
  const roleValue = record(value, path, errors);
  if (!roleValue) return undefined;
  exactKeys(roleValue, ["role", "renderer", "fontAssetIds", "requiredCodePoints", "metrics", "fit", "osFallback"], path, errors);
  const role = TYPOGRAPHY_ROLES.includes(roleValue.role as TypographyRole) ? roleValue.role as TypographyRole : undefined;
  if (!role) errors.push(`${path}.role is not supported`);
  if (!new Set(["woff2-canvas", "msdf", "sdf"]).has(roleValue.renderer as string)) errors.push(`${path}.renderer is not supported`);
  const assets = stringList(roleValue.fontAssetIds, `${path}.fontAssetIds`, errors);
  const required = new Set(integerList(roleValue.requiredCodePoints, `${path}.requiredCodePoints`, errors, true));
  const metrics = record(roleValue.metrics, `${path}.metrics`, errors);
  let roleWeight: number | undefined;
  if (metrics) {
    exactKeys(metrics, ["sizePx", "weight", "trackingPx", "lineHeightPx"], `${path}.metrics`, errors);
    for (const key of ["sizePx", "weight", "trackingPx", "lineHeightPx"] as const) {
      if (typeof metrics[key] !== "number" || !Number.isFinite(metrics[key])) errors.push(`${path}.metrics.${key} must be finite`);
    }
    if (!new Set([100, 200, 300, 400, 500, 600, 700, 800, 900]).has(metrics.weight as number)) {
      errors.push(`${path}.metrics.weight must be a supported CSS hundred weight`);
    } else roleWeight = metrics.weight as number;
    if ((metrics.sizePx as number) <= 0 || (metrics.lineHeightPx as number) <= 0) errors.push(`${path}.metrics sizes must be positive`);
  }
  const fit = record(roleValue.fit, `${path}.fit`, errors);
  if (fit) {
    exactKeys(fit, ["minSizePx", "accessibilityMinCssPx", "overflow", "maxLines"], `${path}.fit`, errors);
    if (typeof fit.minSizePx !== "number" || (fit.minSizePx as number) <= 0) errors.push(`${path}.fit.minSizePx must be positive`);
    if (typeof fit.accessibilityMinCssPx !== "number" || !Number.isFinite(fit.accessibilityMinCssPx)
      || (fit.accessibilityMinCssPx as number) < 12) {
      errors.push(`${path}.fit.accessibilityMinCssPx must be a finite CSS-pixel floor of at least 12`);
    }
    if (!new Set(["wrap", "ellipsis", "fail"]).has(fit.overflow as string)) errors.push(`${path}.fit.overflow is not supported`);
    if (!Number.isSafeInteger(fit.maxLines) || (fit.maxLines as number) < 1) errors.push(`${path}.fit.maxLines must be a positive integer`);
  }
  if (roleValue.osFallback !== false) errors.push(`${path}.osFallback must equal false`);
  return role ? { role, assets, required, ...(roleWeight === undefined ? {} : { weight: roleWeight }) } : undefined;
}

export function validateTypographyManifest(value: unknown, inventory?: unknown): TypographyValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, ["schemaVersion", "manifestId", "osFallback", "assets", "roles"], "$", errors);
  if (root.schemaVersion !== TYPOGRAPHY_MANIFEST_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${TYPOGRAPHY_MANIFEST_SCHEMA_VERSION}`);
  idValue(root.manifestId, "$.manifestId", errors);
  if (root.osFallback !== false) errors.push("$.osFallback must equal false");
  if (!Array.isArray(root.assets) || root.assets.length === 0) errors.push("$.assets must be non-empty");
  if (!Array.isArray(root.roles) || root.roles.length === 0) errors.push("$.roles must be non-empty");
  const assets = new Map<string, AssetSummary>();
  if (Array.isArray(root.assets)) root.assets.forEach((asset, index) => {
    const summary = validateAsset(asset, index, errors);
    if (summary) {
      if (assets.has(summary.id)) errors.push(`$.assets duplicate ID ${summary.id}`);
      assets.set(summary.id, summary);
    }
  });
  const roles = new Map<TypographyRole, RoleSummary>();
  if (Array.isArray(root.roles)) root.roles.forEach((role, index) => {
    const summary = validateRole(role, index, errors);
    if (summary) {
      if (roles.has(summary.role)) errors.push(`$.roles duplicate role ${summary.role}`);
      roles.set(summary.role, summary);
      const covered = new Set(summary.assets.flatMap((id) => {
        const asset = assets.get(id);
        if (!asset) errors.push(`$.roles[${index}] references unknown font asset ${id}`);
        return asset ? [...asset.coverage] : [];
      }));
      if (summary.weight !== undefined && !summary.assets.some((id) => assets.get(id)?.weight === summary.weight)) {
        errors.push(`$.roles[${index}] has no bundled face at declared weight ${summary.weight}`);
      }
      for (const codePoint of summary.required) if (!covered.has(codePoint)) {
        errors.push(`$.roles[${index}] required character U+${codePoint.toString(16).toUpperCase()} is missing from bundled coverage`);
      }
    }
  });
  if (inventory !== undefined) {
    const inventoryResult = validateTextInventory(inventory);
    if (!inventoryResult.valid) errors.push(...inventoryResult.errors.map((error) => `inventory ${error}`));
    else {
      const requiredByRole = new Map<TypographyRole, Set<number>>();
      ((inventory as JsonRecord).runs as unknown[]).forEach((value) => {
        const run = value as JsonRecord;
        const mapping = run.mapping as JsonRecord;
        if (run.classification !== "safe-modern" || mapping.kind !== "bundled-font") return;
        const role = run.role as TypographyRole;
        const set = requiredByRole.get(role) ?? new Set<number>();
        for (const codePoint of (run.unicode as JsonRecord).codePoints as number[]) set.add(codePoint);
        requiredByRole.set(role, set);
      });
      for (const [role, required] of requiredByRole) {
        const manifestRole = roles.get(role);
        if (!manifestRole) {
          errors.push(`safe-modern role ${role} has no manifest mapping`);
          continue;
        }
        for (const codePoint of required) if (!manifestRole.required.has(codePoint)) {
          errors.push(`safe-modern character U+${codePoint.toString(16).toUpperCase()} is absent from role ${role} requiredCodePoints`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateGlyphMetrics(value: unknown, asset?: TypographyFontAssetV1): TypographyValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { valid: false, errors };
  exactKeys(root, [
    "schemaVersion", "fontAssetId", "fontSha256", "unitsPerEm", "ascent", "descent", "lineGap",
    "coverageCodePoints", "glyphs",
  ], "$", errors);
  if (root.schemaVersion !== GLYPH_METRICS_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${GLYPH_METRICS_SCHEMA_VERSION}`);
  idValue(root.fontAssetId, "$.fontAssetId", errors);
  hashValue(root.fontSha256, "$.fontSha256", errors);
  for (const key of ["unitsPerEm", "ascent", "descent", "lineGap"] as const) {
    if (!Number.isFinite(root[key])) errors.push(`$.${key} must be finite`);
  }
  if ((root.unitsPerEm as number) <= 0) errors.push("$.unitsPerEm must be positive");
  const coverage = integerList(root.coverageCodePoints, "$.coverageCodePoints", errors, true);
  coverage.forEach((codePoint, index) => {
    if (index > 0 && codePoint <= coverage[index - 1]!) errors.push("$.coverageCodePoints must be strictly ascending");
  });
  if (!Array.isArray(root.glyphs)) errors.push("$.glyphs must be an array");
  else {
    if (root.glyphs.length !== coverage.length) errors.push("$.glyphs must contain one entry per covered code point");
    root.glyphs.forEach((value, index) => {
      const path = `$.glyphs[${index}]`;
      const glyph = record(value, path, errors);
      if (!glyph) return;
      exactKeys(glyph, ["codePoint", "glyphId", "advanceWidth", "bbox"], path, errors);
      if (glyph.codePoint !== coverage[index]) errors.push(`${path}.codePoint must match ordered coverage`);
      if (!Number.isSafeInteger(glyph.glyphId) || (glyph.glyphId as number) < 0) errors.push(`${path}.glyphId must be a non-negative integer`);
      if (!Number.isFinite(glyph.advanceWidth) || (glyph.advanceWidth as number) < 0) errors.push(`${path}.advanceWidth must be non-negative and finite`);
      const bbox = record(glyph.bbox, `${path}.bbox`, errors);
      if (bbox) {
        exactKeys(bbox, ["minX", "minY", "maxX", "maxY"], `${path}.bbox`, errors);
        for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
          if (!Number.isFinite(bbox[key])) errors.push(`${path}.bbox.${key} must be finite`);
        }
      }
    });
  }
  if (asset) {
    if (root.fontAssetId !== asset.id) errors.push("$.fontAssetId differs from the manifest asset");
    if (root.fontSha256 !== asset.file.sha256) errors.push("$.fontSha256 differs from the manifest asset");
    if (coverage.length !== asset.coverageCodePoints.length
      || coverage.some((codePoint, index) => codePoint !== asset.coverageCodePoints[index])) {
      errors.push("$.coverageCodePoints differs from the manifest asset");
    }
  }
  return { valid: errors.length === 0, errors };
}

export function validateTypographyContract(inventory: unknown, manifest: unknown): TypographyValidationResult {
  const inventoryResult = validateTextInventory(inventory);
  const manifestResult = validateTypographyManifest(manifest, inventoryResult.valid ? inventory : undefined);
  return { valid: inventoryResult.valid && manifestResult.valid, errors: [...inventoryResult.errors, ...manifestResult.errors] };
}
