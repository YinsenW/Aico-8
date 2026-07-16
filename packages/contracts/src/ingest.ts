export const CART_INPUT_SCHEMA_VERSION = "aico8.cart-input.v1" as const;
export const CART_WORKSPACE_SCHEMA_VERSION = "aico8.cart-workspace.v1" as const;

export type CartFormat = "p8-text" | "p8-png" | "raw-rom";
export type IngestIntendedUse = "private-research" | "public-synthetic-fixture" | "publication";
export type ReleasePermissionStatus = "granted" | "denied" | "unknown";
export type CartSection = "lua" | "gfx" | "gff" | "map" | "sfx" | "music" | "label";
export type Pico8SectionName = string;
export type WorkspaceResourceId = CartSection | "shared-map-alias";

export interface IngestFileReferenceV1 {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface CartInputV1 {
  readonly schemaVersion: typeof CART_INPUT_SCHEMA_VERSION;
  readonly inputId: string;
  readonly format: CartFormat;
  readonly source: IngestFileReferenceV1;
  readonly provenance: {
    readonly suppliedBy: string;
    readonly intendedUse: IngestIntendedUse;
    readonly sourceUrl: string | null;
    readonly declaredLicense: {
      readonly spdx: string;
      readonly evidence: readonly IngestFileReferenceV1[];
    };
    readonly releasePermission: {
      readonly status: ReleasePermissionStatus;
      readonly evidence: readonly IngestFileReferenceV1[];
    };
  };
}

export interface CartWorkspaceResourceV1 {
  readonly id: WorkspaceResourceId;
  readonly sourceSection: CartSection;
  readonly presentInSource: boolean;
  readonly artifact: IngestFileReferenceV1;
  readonly semanticSha256: string;
}

export interface CartWorkspaceV1 {
  readonly schemaVersion: typeof CART_WORKSPACE_SCHEMA_VERSION;
  readonly workspaceId: string;
  readonly status: "decoded-lossless";
  readonly input: {
    readonly manifest: IngestFileReferenceV1;
    readonly format: CartFormat;
    readonly sourceSha256: string;
  };
  readonly codec: { readonly id: string; readonly version: string; readonly revisionSha256: string };
  readonly pico8: {
    readonly version: number;
    readonly sections: readonly Pico8SectionName[];
    readonly sectionOrder: readonly Pico8SectionName[];
  };
  readonly resources: readonly CartWorkspaceResourceV1[];
  readonly aliases: readonly [{
    readonly id: "gfx-shared-map";
    readonly kind: "shared-memory";
    readonly offset: 4096;
    readonly length: 4096;
    readonly resourceIds: readonly ["gfx", "shared-map-alias"];
    readonly baselineSemanticSha256: string;
    readonly conflictPolicy: "reject-divergent-dual-edit";
  }];
  readonly rebuild: {
    readonly rebuiltCart: IngestFileReferenceV1;
    readonly decodedRomHex: IngestFileReferenceV1;
    readonly comparison: "exact-decoded-rom-and-resources";
    readonly sourceEquivalent: true;
  };
  readonly provenance: {
    readonly cartInputManifestSha256: string;
    readonly sourceSha256: string;
    readonly declaredLicenseSpdx: string;
    readonly releasePermissionStatus: ReleasePermissionStatus;
    readonly rightsEvidenceSha256: readonly string[];
  };
}

export interface IngestValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const SPDX = /^(?:[A-Za-z0-9][A-Za-z0-9.+-]*|NOASSERTION)$/;
const SECTION_NAME = /^[a-z0-9_]+$/;
const FORMATS = new Set<CartFormat>(["p8-text", "p8-png", "raw-rom"]);
const USES = new Set<IngestIntendedUse>(["private-research", "public-synthetic-fixture", "publication"]);
const PERMISSIONS = new Set<ReleasePermissionStatus>(["granted", "denied", "unknown"]);
const RESOURCE_SECTIONS: Readonly<Record<WorkspaceResourceId, CartSection>> = {
  lua: "lua",
  gfx: "gfx",
  "shared-map-alias": "gfx",
  map: "map",
  gff: "gff",
  sfx: "sfx",
  music: "music",
  label: "label",
};
const RESOURCE_IDS = Object.keys(RESOURCE_SECTIONS) as WorkspaceResourceId[];

function object(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, required: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set(required);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function validString(value: unknown, pattern?: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && (!pattern || pattern.test(value));
}

function safeRelativePath(value: unknown): value is string {
  if (!validString(value) || value.startsWith("/") || value.includes("\\")) return false;
  return value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."
    && /^[A-Za-z0-9._-]+$/.test(segment));
}

function validateFile(value: unknown, path: string, errors: string[]): value is UnknownRecord {
  if (!object(value)) { errors.push(`${path} must be an object`); return false; }
  exactKeys(value, ["path", "sha256", "byteLength"], path, errors);
  if (!safeRelativePath(value.path)) errors.push(`${path}.path must be a safe relative path`);
  if (!validString(value.sha256, HASH)) errors.push(`${path}.sha256 must be a sha256`);
  if (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) <= 0) {
    errors.push(`${path}.byteLength must be a positive safe integer`);
  }
  return true;
}

function validateEvidence(value: unknown, path: string, errors: string[], requireNonEmpty: boolean): readonly UnknownRecord[] {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; }
  if (requireNonEmpty && value.length === 0) errors.push(`${path} must not be empty`);
  const records: UnknownRecord[] = [];
  value.forEach((item, index) => { if (validateFile(item, `${path}[${index}]`, errors)) records.push(item); });
  return records;
}

function validateRightsProvenance(value: unknown, errors: string[]): void {
  if (!object(value)) { errors.push("$.provenance must be an object"); return; }
  exactKeys(value, ["suppliedBy", "intendedUse", "sourceUrl", "declaredLicense", "releasePermission"], "$.provenance", errors);
  if (!validString(value.suppliedBy)) errors.push("$.provenance.suppliedBy must be a non-empty string");
  if (!USES.has(value.intendedUse as IngestIntendedUse)) errors.push("$.provenance.intendedUse is unsupported");
  if (value.sourceUrl !== null) {
    if (!validString(value.sourceUrl)) errors.push("$.provenance.sourceUrl must be null or an https URL");
    else {
      try { if (new URL(value.sourceUrl).protocol !== "https:") errors.push("$.provenance.sourceUrl must use https"); }
      catch { errors.push("$.provenance.sourceUrl must be null or an https URL"); }
    }
  }
  if (!object(value.declaredLicense)) errors.push("$.provenance.declaredLicense must be an object");
  else {
    exactKeys(value.declaredLicense, ["spdx", "evidence"], "$.provenance.declaredLicense", errors);
    if (!validString(value.declaredLicense.spdx, SPDX)) errors.push("$.provenance.declaredLicense.spdx must be an SPDX id or NOASSERTION");
    validateEvidence(value.declaredLicense.evidence, "$.provenance.declaredLicense.evidence", errors, true);
  }
  if (!object(value.releasePermission)) errors.push("$.provenance.releasePermission must be an object");
  else {
    exactKeys(value.releasePermission, ["status", "evidence"], "$.provenance.releasePermission", errors);
    const status = value.releasePermission.status as ReleasePermissionStatus;
    if (!PERMISSIONS.has(status)) errors.push("$.provenance.releasePermission.status is unsupported");
    const evidence = validateEvidence(value.releasePermission.evidence, "$.provenance.releasePermission.evidence", errors, status === "granted");
    if ((value.intendedUse === "publication" || value.intendedUse === "public-synthetic-fixture") && status !== "granted") {
      errors.push("$.provenance.releasePermission.status must be granted for public use");
    }
    if (status === "granted" && evidence.length === 0) errors.push("$.provenance.releasePermission.evidence must prove granted permission");
  }
}

export function validateCartInput(value: unknown): IngestValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, ["schemaVersion", "inputId", "format", "source", "provenance"], "$", errors);
  if (value.schemaVersion !== CART_INPUT_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${CART_INPUT_SCHEMA_VERSION}`);
  if (!validString(value.inputId, ID)) errors.push("$.inputId must be a valid id");
  if (!FORMATS.has(value.format as CartFormat)) errors.push("$.format is unsupported");
  validateFile(value.source, "$.source", errors);
  validateRightsProvenance(value.provenance, errors);
  return { ok: errors.length === 0, errors };
}

function validateSectionArray(value: unknown, path: string, errors: string[]): string[] {
  if (!Array.isArray(value)) { errors.push(`${path} must be an array`); return []; }
  const result: string[] = [];
  value.forEach((item, index) => {
    if (!validString(item, SECTION_NAME)) errors.push(`${path}[${index}] must be a valid section name`);
    else if (result.includes(item)) errors.push(`${path}[${index}] must be unique`);
    else result.push(item);
  });
  return result;
}

export function validateCartWorkspace(value: unknown, cartInput?: CartInputV1): IngestValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, ["schemaVersion", "workspaceId", "status", "input", "codec", "pico8", "resources", "aliases", "rebuild", "provenance"], "$", errors);
  if (value.schemaVersion !== CART_WORKSPACE_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${CART_WORKSPACE_SCHEMA_VERSION}`);
  if (!validString(value.workspaceId, ID)) errors.push("$.workspaceId must be a valid id");
  if (value.status !== "decoded-lossless") errors.push("$.status must equal decoded-lossless");

  if (!object(value.input)) errors.push("$.input must be an object");
  else {
    exactKeys(value.input, ["manifest", "format", "sourceSha256"], "$.input", errors);
    validateFile(value.input.manifest, "$.input.manifest", errors);
    if (!FORMATS.has(value.input.format as CartFormat)) errors.push("$.input.format is unsupported");
    if (!validString(value.input.sourceSha256, HASH)) errors.push("$.input.sourceSha256 must be a sha256");
  }
  if (!object(value.codec)) errors.push("$.codec must be an object");
  else {
    exactKeys(value.codec, ["id", "version", "revisionSha256"], "$.codec", errors);
    if (!validString(value.codec.id, ID)) errors.push("$.codec.id must be a valid id");
    if (!validString(value.codec.version, SEMVER)) errors.push("$.codec.version must be semantic version");
    if (!validString(value.codec.revisionSha256, HASH)) errors.push("$.codec.revisionSha256 must be a sha256");
  }

  let sections: string[] = [];
  let sectionOrder: string[] = [];
  if (!object(value.pico8)) errors.push("$.pico8 must be an object");
  else {
    exactKeys(value.pico8, ["version", "sections", "sectionOrder"], "$.pico8", errors);
    if (!Number.isSafeInteger(value.pico8.version) || (value.pico8.version as number) < 0 || (value.pico8.version as number) > 255) {
      errors.push("$.pico8.version must be an integer from 0 through 255");
    }
    sections = validateSectionArray(value.pico8.sections, "$.pico8.sections", errors);
    sectionOrder = validateSectionArray(value.pico8.sectionOrder, "$.pico8.sectionOrder", errors);
    if (sections.length !== sectionOrder.length || sections.some((section) => !sectionOrder.includes(section))) {
      errors.push("$.pico8.sectionOrder must contain exactly the present sections");
    }
  }

  const resources = new Map<WorkspaceResourceId, UnknownRecord>();
  const artifactPaths = new Set<string>();
  if (!Array.isArray(value.resources)) errors.push("$.resources must be an array");
  else value.resources.forEach((resource, index) => {
    const path = `$.resources[${index}]`;
    if (!object(resource)) { errors.push(`${path} must be an object`); return; }
    exactKeys(resource, ["id", "sourceSection", "presentInSource", "artifact", "semanticSha256"], path, errors);
    const id = resource.id as WorkspaceResourceId;
    if (!(id in RESOURCE_SECTIONS)) errors.push(`${path}.id is unsupported`);
    else if (resources.has(id)) errors.push(`${path}.id must be unique`);
    else resources.set(id, resource);
    if (id in RESOURCE_SECTIONS && resource.sourceSection !== RESOURCE_SECTIONS[id]) {
      errors.push(`${path}.sourceSection must equal ${RESOURCE_SECTIONS[id]}`);
    }
    if (typeof resource.presentInSource !== "boolean") errors.push(`${path}.presentInSource must be boolean`);
    if (id in RESOURCE_SECTIONS && typeof resource.presentInSource === "boolean"
      && resource.presentInSource !== sections.includes(RESOURCE_SECTIONS[id])) {
      errors.push(`${path}.presentInSource must match section presence`);
    }
    if (validateFile(resource.artifact, `${path}.artifact`, errors) && safeRelativePath(resource.artifact.path)) {
      if (artifactPaths.has(resource.artifact.path)) errors.push(`${path}.artifact.path must be unique`);
      else artifactPaths.add(resource.artifact.path);
    }
    if (!validString(resource.semanticSha256, HASH)) errors.push(`${path}.semanticSha256 must be a sha256`);
  });
  for (const id of RESOURCE_IDS) if (!resources.has(id)) errors.push(`$.resources must include ${id}`);
  if (resources.size !== RESOURCE_IDS.length) errors.push(`$.resources must contain exactly ${RESOURCE_IDS.length} resource records`);

  if (!Array.isArray(value.aliases) || value.aliases.length !== 1) errors.push("$.aliases must contain exactly the gfx-shared-map alias");
  else {
    const alias = value.aliases[0];
    if (!object(alias)) errors.push("$.aliases[0] must be an object");
    else {
      exactKeys(alias, ["id", "kind", "offset", "length", "resourceIds", "baselineSemanticSha256", "conflictPolicy"], "$.aliases[0]", errors);
      if (alias.id !== "gfx-shared-map" || alias.kind !== "shared-memory" || alias.offset !== 4096 || alias.length !== 4096
        || alias.conflictPolicy !== "reject-divergent-dual-edit") errors.push("$.aliases[0] must preserve the PICO-8 gfx/shared-map alias contract");
      if (!Array.isArray(alias.resourceIds) || alias.resourceIds.length !== 2
        || alias.resourceIds[0] !== "gfx" || alias.resourceIds[1] !== "shared-map-alias") {
        errors.push("$.aliases[0].resourceIds must equal [gfx, shared-map-alias]");
      }
      const shared = resources.get("shared-map-alias");
      if (!validString(alias.baselineSemanticSha256, HASH)) errors.push("$.aliases[0].baselineSemanticSha256 must be a sha256");
      else if (shared && alias.baselineSemanticSha256 !== shared.semanticSha256) {
        errors.push("$.aliases[0].baselineSemanticSha256 must bind the shared-map-alias resource");
      }
    }
  }

  if (!object(value.rebuild)) errors.push("$.rebuild must be an object");
  else {
    exactKeys(value.rebuild, ["rebuiltCart", "decodedRomHex", "comparison", "sourceEquivalent"], "$.rebuild", errors);
    validateFile(value.rebuild.rebuiltCart, "$.rebuild.rebuiltCart", errors);
    validateFile(value.rebuild.decodedRomHex, "$.rebuild.decodedRomHex", errors);
    if (value.rebuild.comparison !== "exact-decoded-rom-and-resources") errors.push("$.rebuild.comparison is unsupported");
    if (value.rebuild.sourceEquivalent !== true) errors.push("$.rebuild.sourceEquivalent must equal true");
  }

  if (!object(value.provenance)) errors.push("$.provenance must be an object");
  else {
    exactKeys(value.provenance, ["cartInputManifestSha256", "sourceSha256", "declaredLicenseSpdx", "releasePermissionStatus", "rightsEvidenceSha256"], "$.provenance", errors);
    for (const key of ["cartInputManifestSha256", "sourceSha256"] as const) {
      if (!validString(value.provenance[key], HASH)) errors.push(`$.provenance.${key} must be a sha256`);
    }
    if (!validString(value.provenance.declaredLicenseSpdx, SPDX)) errors.push("$.provenance.declaredLicenseSpdx must be an SPDX id or NOASSERTION");
    if (!PERMISSIONS.has(value.provenance.releasePermissionStatus as ReleasePermissionStatus)) errors.push("$.provenance.releasePermissionStatus is unsupported");
    if (Array.isArray(value.provenance.rightsEvidenceSha256)) {
      const seen = new Set<string>();
      value.provenance.rightsEvidenceSha256.forEach((hash, index) => {
        if (!validString(hash, HASH)) errors.push(`$.provenance.rightsEvidenceSha256[${index}] must be a sha256`);
        else if (seen.has(hash)) errors.push(`$.provenance.rightsEvidenceSha256[${index}] must be unique`); else seen.add(hash);
      });
      if (value.provenance.releasePermissionStatus === "granted" && value.provenance.rightsEvidenceSha256.length === 0) {
        errors.push("$.provenance.rightsEvidenceSha256 must prove granted permission");
      }
    }
    else errors.push("$.provenance.rightsEvidenceSha256 must be an array");
  }

  if (object(value.input) && object(value.provenance)) {
    if (value.input.sourceSha256 !== value.provenance.sourceSha256) errors.push("$.provenance.sourceSha256 must bind $.input.sourceSha256");
    if (object(value.input.manifest) && value.input.manifest.sha256 !== value.provenance.cartInputManifestSha256) {
      errors.push("$.provenance.cartInputManifestSha256 must bind $.input.manifest.sha256");
    }
  }
  if (cartInput && object(value.input) && object(value.provenance)) {
    if (value.workspaceId !== cartInput.inputId) errors.push("$.workspaceId must equal cart input inputId");
    if (value.input.format !== cartInput.format) errors.push("$.input.format must equal cart input format");
    if (value.input.sourceSha256 !== cartInput.source.sha256) errors.push("$.input.sourceSha256 must equal cart input source hash");
    if (value.provenance.declaredLicenseSpdx !== cartInput.provenance.declaredLicense.spdx) errors.push("$.provenance.declaredLicenseSpdx must equal cart input license");
    if (value.provenance.releasePermissionStatus !== cartInput.provenance.releasePermission.status) errors.push("$.provenance.releasePermissionStatus must equal cart input permission");
    const evidence = new Set([
      ...cartInput.provenance.declaredLicense.evidence,
      ...cartInput.provenance.releasePermission.evidence,
    ].map((item) => item.sha256));
    if (Array.isArray(value.provenance.rightsEvidenceSha256)) {
      const actual = new Set(value.provenance.rightsEvidenceSha256 as string[]);
      if (actual.size !== evidence.size || [...evidence].some((hash) => !actual.has(hash))) {
        errors.push("$.provenance.rightsEvidenceSha256 must exactly bind cart input provenance evidence");
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertCartInput(value: unknown): asserts value is CartInputV1 {
  const result = validateCartInput(value);
  if (!result.ok) throw new TypeError(`Invalid cart input:\n${result.errors.join("\n")}`);
}

export function assertCartWorkspace(value: unknown, cartInput?: CartInputV1): asserts value is CartWorkspaceV1 {
  const result = validateCartWorkspace(value, cartInput);
  if (!result.ok) throw new TypeError(`Invalid cart workspace:\n${result.errors.join("\n")}`);
}
