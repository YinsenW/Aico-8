export const GAME_MODULE_SCHEMA_VERSION = "aico8.game-module.v1" as const;

export type GameModuleStatus = "draft" | "validated";
export type GameModuleEvidenceKind = "canonical-replay" | "hd-review-decision";

export interface GameModuleFileReferenceV1 {
  readonly path: string;
  readonly sha256: string;
}

export interface GameModuleDependencyV1 {
  readonly id: string;
  readonly version: string;
  readonly manifestSha256: string;
}

export interface GameModuleEvidenceV1 {
  readonly kind: GameModuleEvidenceKind;
  readonly path: string;
  readonly sha256: string;
}

export interface GameModuleV1 {
  readonly schemaVersion: typeof GAME_MODULE_SCHEMA_VERSION;
  readonly moduleId: string;
  readonly status: GameModuleStatus;
  readonly metadata: { readonly title: string; readonly author: string };
  readonly payload: {
    readonly rom: GameModuleFileReferenceV1;
    readonly sourceCode: GameModuleFileReferenceV1;
    readonly presentationModule: GameModuleFileReferenceV1;
  };
  readonly mappings: {
    readonly hdIdentityMap: GameModuleFileReferenceV1;
    readonly assetPack: GameModuleFileReferenceV1;
    readonly typographyManifest: GameModuleFileReferenceV1;
    readonly audioManifest: GameModuleFileReferenceV1;
  };
  readonly save: {
    readonly namespace: string;
    readonly persistentBytes: number;
    readonly resetCompatibilityStateOnActivate: true;
  };
  readonly provenance: {
    readonly sourceCartSha256: string;
    readonly workspaceManifestSha256: string;
    readonly rightsProfile: string;
  };
  readonly runtime: {
    readonly dependencies: readonly GameModuleDependencyV1[];
    readonly targetBindings: readonly [{
      readonly target: "web-pwa";
      readonly targetProfileId: string;
      readonly targetProfileSha256: string;
    }];
  };
  readonly validation: {
    readonly status: "pending" | "passed";
    readonly evidence: readonly GameModuleEvidenceV1[];
  };
}

export interface GameModuleValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/;
const EVIDENCE_KINDS = new Set<GameModuleEvidenceKind>(["canonical-replay", "hd-review-decision"]);

function object(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function validString(value: unknown, pattern?: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && (!pattern || pattern.test(value));
}

function safeRelativePath(value: unknown): value is string {
  if (!validString(value) || value.startsWith("/") || value.includes("\\")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."
    && /^[A-Za-z0-9._-]+$/.test(segment));
}

function validateFile(value: unknown, path: string, errors: string[], paths: Set<string>): void {
  if (!object(value)) { errors.push(`${path} must be an object`); return; }
  exactKeys(value, ["path", "sha256"], [], path, errors);
  if (!safeRelativePath(value.path)) errors.push(`${path}.path must be a safe relative path`);
  else if (paths.has(value.path)) errors.push(`${path}.path must be unique`); else paths.add(value.path);
  if (!validString(value.sha256, HASH)) errors.push(`${path}.sha256 must be a sha256`);
}

export function gameModuleSaveNamespace(moduleId: string): string {
  return `${moduleId}:${GAME_MODULE_SCHEMA_VERSION}`;
}

export function validateGameModule(value: unknown): GameModuleValidationResult {
  const errors: string[] = [];
  const filePaths = new Set<string>();
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, ["schemaVersion", "moduleId", "status", "metadata", "payload", "mappings", "save", "provenance", "runtime", "validation"], [], "$", errors);
  if (value.schemaVersion !== GAME_MODULE_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${GAME_MODULE_SCHEMA_VERSION}`);
  const moduleIdValid = validString(value.moduleId, ID);
  if (!moduleIdValid) errors.push("$.moduleId must be a valid id");
  if (value.status !== "draft" && value.status !== "validated") errors.push("$.status is unsupported");

  if (!object(value.metadata)) errors.push("$.metadata must be an object");
  else {
    exactKeys(value.metadata, ["title", "author"], [], "$.metadata", errors);
    if (!validString(value.metadata.title)) errors.push("$.metadata.title must be a non-empty string");
    if (!validString(value.metadata.author)) errors.push("$.metadata.author must be a non-empty string");
  }

  if (!object(value.payload)) errors.push("$.payload must be an object");
  else {
    exactKeys(value.payload, ["rom", "sourceCode", "presentationModule"], [], "$.payload", errors);
    for (const key of ["rom", "sourceCode", "presentationModule"] as const) validateFile(value.payload[key], `$.payload.${key}`, errors, filePaths);
  }

  if (!object(value.mappings)) errors.push("$.mappings must be an object");
  else {
    exactKeys(value.mappings, ["hdIdentityMap", "assetPack", "typographyManifest", "audioManifest"], [], "$.mappings", errors);
    for (const key of ["hdIdentityMap", "assetPack", "typographyManifest", "audioManifest"] as const) {
      validateFile(value.mappings[key], `$.mappings.${key}`, errors, filePaths);
    }
  }

  if (!object(value.save)) errors.push("$.save must be an object");
  else {
    exactKeys(value.save, ["namespace", "persistentBytes", "resetCompatibilityStateOnActivate"], [], "$.save", errors);
    if (!moduleIdValid || value.save.namespace !== gameModuleSaveNamespace(value.moduleId as string)) {
      errors.push("$.save.namespace must equal moduleId plus schemaVersion");
    }
    if (!Number.isSafeInteger(value.save.persistentBytes) || (value.save.persistentBytes as number) < 0
      || (value.save.persistentBytes as number) > 256) errors.push("$.save.persistentBytes must be an integer from 0 through 256");
    if (value.save.resetCompatibilityStateOnActivate !== true) errors.push("$.save.resetCompatibilityStateOnActivate must equal true");
  }

  if (!object(value.provenance)) errors.push("$.provenance must be an object");
  else {
    exactKeys(value.provenance, ["sourceCartSha256", "workspaceManifestSha256", "rightsProfile"], [], "$.provenance", errors);
    for (const key of ["sourceCartSha256", "workspaceManifestSha256"] as const) {
      if (!validString(value.provenance[key], HASH)) errors.push(`$.provenance.${key} must be a sha256`);
    }
    if (!validString(value.provenance.rightsProfile, ID)) errors.push("$.provenance.rightsProfile must be a valid id");
  }

  if (!object(value.runtime)) errors.push("$.runtime must be an object");
  else {
    exactKeys(value.runtime, ["dependencies", "targetBindings"], [], "$.runtime", errors);
    const dependencyIds = new Set<string>();
    const dependencyHashes = new Set<string>();
    if (!Array.isArray(value.runtime.dependencies) || value.runtime.dependencies.length === 0) errors.push("$.runtime.dependencies must be a non-empty array");
    else value.runtime.dependencies.forEach((dependency, index) => {
      const path = `$.runtime.dependencies[${index}]`;
      if (!object(dependency)) { errors.push(`${path} must be an object`); return; }
      exactKeys(dependency, ["id", "version", "manifestSha256"], [], path, errors);
      if (!validString(dependency.id, ID)) errors.push(`${path}.id must be a valid id`);
      else if (dependencyIds.has(dependency.id)) errors.push(`${path}.id must be unique`); else dependencyIds.add(dependency.id);
      if (!validString(dependency.version, VERSION)) errors.push(`${path}.version must be a semantic version`);
      if (!validString(dependency.manifestSha256, HASH)) errors.push(`${path}.manifestSha256 must be a sha256`);
      else if (dependencyHashes.has(dependency.manifestSha256)) errors.push(`${path}.manifestSha256 must be unique`);
      else dependencyHashes.add(dependency.manifestSha256);
    });
    if (!Array.isArray(value.runtime.targetBindings) || value.runtime.targetBindings.length !== 1) {
      errors.push("$.runtime.targetBindings must contain exactly one web-pwa binding");
    } else {
      const binding = value.runtime.targetBindings[0];
      if (!object(binding)) errors.push("$.runtime.targetBindings[0] must be an object");
      else {
        exactKeys(binding, ["target", "targetProfileId", "targetProfileSha256"], [], "$.runtime.targetBindings[0]", errors);
        if (binding.target !== "web-pwa") errors.push("$.runtime.targetBindings[0].target must equal web-pwa");
        if (!validString(binding.targetProfileId, ID)) errors.push("$.runtime.targetBindings[0].targetProfileId must be a valid id");
        if (!validString(binding.targetProfileSha256, HASH)) errors.push("$.runtime.targetBindings[0].targetProfileSha256 must be a sha256");
      }
    }
  }

  if (!object(value.validation)) errors.push("$.validation must be an object");
  else {
    exactKeys(value.validation, ["status", "evidence"], [], "$.validation", errors);
    if (value.validation.status !== "pending" && value.validation.status !== "passed") errors.push("$.validation.status is unsupported");
    const kinds = new Set<GameModuleEvidenceKind>();
    const evidenceHashes = new Set<string>();
    if (!Array.isArray(value.validation.evidence)) errors.push("$.validation.evidence must be an array");
    else value.validation.evidence.forEach((evidence, index) => {
      const path = `$.validation.evidence[${index}]`;
      if (!object(evidence)) { errors.push(`${path} must be an object`); return; }
      exactKeys(evidence, ["kind", "path", "sha256"], [], path, errors);
      if (!EVIDENCE_KINDS.has(evidence.kind as GameModuleEvidenceKind)) errors.push(`${path}.kind is unsupported`);
      else if (kinds.has(evidence.kind as GameModuleEvidenceKind)) errors.push(`${path}.kind must be unique`); else kinds.add(evidence.kind as GameModuleEvidenceKind);
      if (!safeRelativePath(evidence.path)) errors.push(`${path}.path must be a safe relative path`);
      else if (filePaths.has(evidence.path)) errors.push(`${path}.path must be unique`); else filePaths.add(evidence.path);
      if (!validString(evidence.sha256, HASH)) errors.push(`${path}.sha256 must be a sha256`);
      else if (evidenceHashes.has(evidence.sha256)) errors.push(`${path}.sha256 must be unique`);
      else evidenceHashes.add(evidence.sha256);
    });
    if (value.status === "draft") {
      if (value.validation.status !== "pending") errors.push("$.validation.status must be pending for a draft module");
      if (Array.isArray(value.validation.evidence) && value.validation.evidence.length !== 0) errors.push("$.validation.evidence must be empty for a draft module");
    }
    if (value.status === "validated") {
      if (value.validation.status !== "passed") errors.push("$.validation.status must be passed for a validated module");
      for (const kind of EVIDENCE_KINDS) if (!kinds.has(kind)) errors.push(`$.validation.evidence must include ${kind}`);
      if (Array.isArray(value.validation.evidence) && value.validation.evidence.length !== EVIDENCE_KINDS.size) {
        errors.push(`$.validation.evidence must contain exactly ${EVIDENCE_KINDS.size} required records`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function assertGameModule(value: unknown): asserts value is GameModuleV1 {
  const result = validateGameModule(value);
  if (!result.ok) throw new TypeError(`Invalid game module:\n${result.errors.join("\n")}`);
}
