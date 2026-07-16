export const TEXT_INVENTORY_SCHEMA_VERSION = "aico8.text-inventory.v1" as const;
export const TYPOGRAPHY_MANIFEST_SCHEMA_VERSION = "aico8.typography-manifest.v1" as const;

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
  readonly runs: readonly unknown[];
}

export interface TypographyManifestV1 {
  readonly schemaVersion: typeof TYPOGRAPHY_MANIFEST_SCHEMA_VERSION;
  readonly manifestId: string;
  readonly osFallback: false;
  readonly assets: readonly unknown[];
  readonly roles: readonly unknown[];
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
    exactKeys(source, ["commandId", "update", "byteStart", "bytesHex", "p8sciiEvidenceSha256"], `${path}.source`, errors);
    idValue(source.commandId, `${path}.source.commandId`, errors);
    for (const key of ["update", "byteStart"] as const) {
      if (!Number.isSafeInteger(source[key]) || (source[key] as number) < 0) errors.push(`${path}.source.${key} must be a non-negative integer`);
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
    if (!identityArtwork && mappedKind !== "bundled-font") errors.push(`${path} ordinary safe-modern text must use a bundled-font mapping`);
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

type AssetSummary = { id: string; coverage: Set<number> };
type RoleSummary = { role: TypographyRole; assets: string[]; required: Set<number> };

function validateAsset(value: unknown, index: number, errors: string[]): AssetSummary | undefined {
  const path = `$.assets[${index}]`;
  const asset = record(value, path, errors);
  if (!asset) return undefined;
  exactKeys(asset, ["id", "family", "version", "file", "source", "license", "coverageCodePoints"], path, errors);
  const id = idValue(asset.id, `${path}.id`, errors) ? asset.id : undefined;
  stringValue(asset.family, `${path}.family`, errors);
  stringValue(asset.version, `${path}.version`, errors);
  const file = record(asset.file, `${path}.file`, errors);
  if (file) {
    exactKeys(file, ["path", "sha256", "format"], `${path}.file`, errors);
    safeRelativePath(file.path, `${path}.file.path`, errors);
    hashValue(file.sha256, `${path}.file.sha256`, errors);
    if (!new Set(["woff2", "msdf-atlas", "sdf-atlas"]).has(file.format as string)) errors.push(`${path}.file.format is not supported`);
  }
  const source = record(asset.source, `${path}.source`, errors);
  if (source) {
    exactKeys(source, ["upstreamRevision", "provenanceSha256"], `${path}.source`, errors);
    stringValue(source.upstreamRevision, `${path}.source.upstreamRevision`, errors);
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
  return id ? { id, coverage } : undefined;
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
  if (metrics) {
    exactKeys(metrics, ["sizePx", "weight", "trackingPx", "lineHeightPx"], `${path}.metrics`, errors);
    for (const key of ["sizePx", "weight", "trackingPx", "lineHeightPx"] as const) {
      if (typeof metrics[key] !== "number" || !Number.isFinite(metrics[key])) errors.push(`${path}.metrics.${key} must be finite`);
    }
    if ((metrics.sizePx as number) <= 0 || (metrics.lineHeightPx as number) <= 0) errors.push(`${path}.metrics sizes must be positive`);
  }
  const fit = record(roleValue.fit, `${path}.fit`, errors);
  if (fit) {
    exactKeys(fit, ["minSizePx", "overflow", "maxLines"], `${path}.fit`, errors);
    if (typeof fit.minSizePx !== "number" || (fit.minSizePx as number) <= 0) errors.push(`${path}.fit.minSizePx must be positive`);
    if (!new Set(["wrap", "ellipsis", "fail"]).has(fit.overflow as string)) errors.push(`${path}.fit.overflow is not supported`);
    if (!Number.isSafeInteger(fit.maxLines) || (fit.maxLines as number) < 1) errors.push(`${path}.fit.maxLines must be a positive integer`);
  }
  if (roleValue.osFallback !== false) errors.push(`${path}.osFallback must equal false`);
  return role ? { role, assets, required } : undefined;
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

export function validateTypographyContract(inventory: unknown, manifest: unknown): TypographyValidationResult {
  const inventoryResult = validateTextInventory(inventory);
  const manifestResult = validateTypographyManifest(manifest, inventoryResult.valid ? inventory : undefined);
  return { valid: inventoryResult.valid && manifestResult.valid, errors: [...inventoryResult.errors, ...manifestResult.errors] };
}
