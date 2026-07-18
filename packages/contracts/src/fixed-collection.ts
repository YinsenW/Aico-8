import type { GameModuleFileReferenceV1 } from "./game-module.js";

export const FIXED_COLLECTION_SCHEMA_VERSION = "aico8.fixed-collection.v1" as const;

export interface FixedCollectionLicenseV1 {
  readonly spdxExpression: string;
  readonly notice: GameModuleFileReferenceV1;
}

export interface FixedCollectionModuleV1 {
  readonly moduleId: string;
  readonly manifestSha256: string;
  readonly saveNamespace: string;
  readonly rightsProfile: string;
  readonly license: FixedCollectionLicenseV1;
}

export interface FixedCollectionV1 {
  readonly schemaVersion: typeof FIXED_COLLECTION_SCHEMA_VERSION;
  readonly collectionId: string;
  readonly metadata: { readonly title: string };
  readonly targetProfile: { readonly id: string; readonly sha256: string };
  readonly launcher: { readonly initialModuleId: string };
  readonly isolation: {
    readonly resetCompatibilityStateOnSwitch: true;
    readonly isolatedSaveNamespaces: true;
  };
  readonly budgets: {
    readonly maxPackagedBytes: number;
    readonly maxPersistentBytes: number;
  };
  readonly modules: readonly FixedCollectionModuleV1[];
}

export interface FixedCollectionValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;
const SPDX_EXPRESSION = /^[A-Za-z0-9.+()\- ]+$/;

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

function boundedPositiveInteger(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

export function validateFixedCollection(value: unknown): FixedCollectionValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, ["schemaVersion", "collectionId", "metadata", "targetProfile", "launcher", "isolation", "budgets", "modules"], "$", errors);
  if (value.schemaVersion !== FIXED_COLLECTION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${FIXED_COLLECTION_SCHEMA_VERSION}`);
  }
  if (!validString(value.collectionId, ID)) errors.push("$.collectionId must be a valid id");

  if (!object(value.metadata)) errors.push("$.metadata must be an object");
  else {
    exactKeys(value.metadata, ["title"], "$.metadata", errors);
    if (!validString(value.metadata.title) || value.metadata.title.length > 120) {
      errors.push("$.metadata.title must be a non-empty string no longer than 120 characters");
    }
  }

  if (!object(value.targetProfile)) errors.push("$.targetProfile must be an object");
  else {
    exactKeys(value.targetProfile, ["id", "sha256"], "$.targetProfile", errors);
    if (!validString(value.targetProfile.id, ID)) errors.push("$.targetProfile.id must be a valid id");
    if (!validString(value.targetProfile.sha256, HASH)) errors.push("$.targetProfile.sha256 must be a sha256");
  }

  if (!object(value.launcher)) errors.push("$.launcher must be an object");
  else {
    exactKeys(value.launcher, ["initialModuleId"], "$.launcher", errors);
    if (!validString(value.launcher.initialModuleId, ID)) errors.push("$.launcher.initialModuleId must be a valid id");
  }

  if (!object(value.isolation)) errors.push("$.isolation must be an object");
  else {
    exactKeys(value.isolation, ["resetCompatibilityStateOnSwitch", "isolatedSaveNamespaces"], "$.isolation", errors);
    if (value.isolation.resetCompatibilityStateOnSwitch !== true) {
      errors.push("$.isolation.resetCompatibilityStateOnSwitch must equal true");
    }
    if (value.isolation.isolatedSaveNamespaces !== true) {
      errors.push("$.isolation.isolatedSaveNamespaces must equal true");
    }
  }

  if (!object(value.budgets)) errors.push("$.budgets must be an object");
  else {
    exactKeys(value.budgets, ["maxPackagedBytes", "maxPersistentBytes"], "$.budgets", errors);
    if (!boundedPositiveInteger(value.budgets.maxPackagedBytes, 2 ** 31 - 1)) {
      errors.push("$.budgets.maxPackagedBytes must be a positive 32-bit integer");
    }
    if (!boundedPositiveInteger(value.budgets.maxPersistentBytes, 2 ** 24)) {
      errors.push("$.budgets.maxPersistentBytes must be a positive integer no greater than 16777216");
    }
  }

  const moduleIds = new Set<string>();
  const manifestHashes = new Set<string>();
  const saveNamespaces = new Set<string>();
  if (!Array.isArray(value.modules) || value.modules.length < 3) {
    errors.push("$.modules must contain at least three modules");
  } else value.modules.forEach((module, index) => {
    const path = `$.modules[${index}]`;
    if (!object(module)) { errors.push(`${path} must be an object`); return; }
    exactKeys(module, ["moduleId", "manifestSha256", "saveNamespace", "rightsProfile", "license"], path, errors);
    if (!validString(module.moduleId, ID)) errors.push(`${path}.moduleId must be a valid id`);
    else if (moduleIds.has(module.moduleId)) errors.push(`${path}.moduleId must be unique`); else moduleIds.add(module.moduleId);
    if (!validString(module.manifestSha256, HASH)) errors.push(`${path}.manifestSha256 must be a sha256`);
    else if (manifestHashes.has(module.manifestSha256)) errors.push(`${path}.manifestSha256 must be unique`); else manifestHashes.add(module.manifestSha256);
    if (!validString(module.saveNamespace)) errors.push(`${path}.saveNamespace must be a non-empty string`);
    else if (saveNamespaces.has(module.saveNamespace)) errors.push(`${path}.saveNamespace must be unique`); else saveNamespaces.add(module.saveNamespace);
    if (!validString(module.rightsProfile, ID)) errors.push(`${path}.rightsProfile must be a valid id`);
    if (!object(module.license)) errors.push(`${path}.license must be an object`);
    else {
      exactKeys(module.license, ["spdxExpression", "notice"], `${path}.license`, errors);
      if (!validString(module.license.spdxExpression, SPDX_EXPRESSION) || module.license.spdxExpression.length > 160) {
        errors.push(`${path}.license.spdxExpression must be a bounded SPDX expression`);
      }
      if (!object(module.license.notice)) errors.push(`${path}.license.notice must be an object`);
      else {
        exactKeys(module.license.notice, ["path", "sha256"], `${path}.license.notice`, errors);
        if (!safeRelativePath(module.license.notice.path)) errors.push(`${path}.license.notice.path must be a safe relative path`);
        if (!validString(module.license.notice.sha256, HASH)) errors.push(`${path}.license.notice.sha256 must be a sha256`);
      }
    }
  });

  if (object(value.launcher) && validString(value.launcher.initialModuleId, ID)
    && !moduleIds.has(value.launcher.initialModuleId)) {
    errors.push("$.launcher.initialModuleId must identify one declared module");
  }
  return { ok: errors.length === 0, errors };
}

export function assertFixedCollection(value: unknown): asserts value is FixedCollectionV1 {
  const result = validateFixedCollection(value);
  if (!result.ok) throw new TypeError(`Invalid fixed collection:\n${result.errors.join("\n")}`);
}
