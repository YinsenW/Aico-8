export const FIXED_COLLECTION_LAUNCHER_SCHEMA_VERSION = "aico8.fixed-collection-launcher.v1" as const;

export interface FixedCollectionLauncherPackageV1 {
  readonly releaseManifestSha256: string;
  readonly treeSha256: string;
}

export interface FixedCollectionLauncherModuleV1 {
  readonly moduleId: string;
  readonly title: string;
  readonly author: string;
  readonly launchPath: string;
  readonly saveNamespace: string;
  readonly rightsProfile: string;
  readonly package: FixedCollectionLauncherPackageV1;
}

export interface FixedCollectionLauncherV1 {
  readonly schemaVersion: typeof FIXED_COLLECTION_LAUNCHER_SCHEMA_VERSION;
  readonly collectionId: string;
  readonly title: string;
  readonly targetProfile: { readonly id: string; readonly sha256: string };
  readonly initialModuleId: string;
  readonly resetMode: "document-replacement";
  readonly modules: readonly FixedCollectionLauncherModuleV1[];
}

export interface FixedCollectionLauncherValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

type UnknownRecord = Record<string, unknown>;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9][a-z0-9-]*$/;

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

function safeLaunchPath(value: unknown): value is string {
  if (!validString(value) || !value.endsWith("/") || value.startsWith("/") || value.includes("\\")) return false;
  return value.slice(0, -1).split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."
    && /^[A-Za-z0-9._-]+$/.test(segment));
}

export function validateFixedCollectionLauncher(value: unknown): FixedCollectionLauncherValidationResult {
  const errors: string[] = [];
  if (!object(value)) return { ok: false, errors: ["$ must be an object"] };
  exactKeys(value, [
    "schemaVersion", "collectionId", "title", "targetProfile", "initialModuleId", "resetMode", "modules",
  ], "$", errors);
  if (value.schemaVersion !== FIXED_COLLECTION_LAUNCHER_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${FIXED_COLLECTION_LAUNCHER_SCHEMA_VERSION}`);
  }
  if (!validString(value.collectionId, ID)) errors.push("$.collectionId must be a valid id");
  if (!validString(value.title) || value.title.length > 120) {
    errors.push("$.title must be a non-empty string no longer than 120 characters");
  }
  if (!object(value.targetProfile)) errors.push("$.targetProfile must be an object");
  else {
    exactKeys(value.targetProfile, ["id", "sha256"], "$.targetProfile", errors);
    if (!validString(value.targetProfile.id, ID)) errors.push("$.targetProfile.id must be a valid id");
    if (!validString(value.targetProfile.sha256, HASH)) errors.push("$.targetProfile.sha256 must be a sha256");
  }
  if (!validString(value.initialModuleId, ID)) errors.push("$.initialModuleId must be a valid id");
  if (value.resetMode !== "document-replacement") errors.push("$.resetMode must equal document-replacement");

  const moduleIds = new Set<string>();
  const launchPaths = new Set<string>();
  const saveNamespaces = new Set<string>();
  const releaseHashes = new Set<string>();
  const treeHashes = new Set<string>();
  if (!Array.isArray(value.modules) || value.modules.length < 3) {
    errors.push("$.modules must contain at least three modules");
  } else value.modules.forEach((module, index) => {
    const path = `$.modules[${index}]`;
    if (!object(module)) { errors.push(`${path} must be an object`); return; }
    exactKeys(module, [
      "moduleId", "title", "author", "launchPath", "saveNamespace", "rightsProfile", "package",
    ], path, errors);
    if (!validString(module.moduleId, ID)) errors.push(`${path}.moduleId must be a valid id`);
    else if (moduleIds.has(module.moduleId)) errors.push(`${path}.moduleId must be unique`); else moduleIds.add(module.moduleId);
    if (!validString(module.title)) errors.push(`${path}.title must be a non-empty string`);
    if (!validString(module.author)) errors.push(`${path}.author must be a non-empty string`);
    if (!safeLaunchPath(module.launchPath)) errors.push(`${path}.launchPath must be a safe relative directory path`);
    else if (launchPaths.has(module.launchPath)) errors.push(`${path}.launchPath must be unique`); else launchPaths.add(module.launchPath);
    if (!validString(module.saveNamespace)) errors.push(`${path}.saveNamespace must be a non-empty string`);
    else if (saveNamespaces.has(module.saveNamespace)) errors.push(`${path}.saveNamespace must be unique`); else saveNamespaces.add(module.saveNamespace);
    if (!validString(module.rightsProfile, ID)) errors.push(`${path}.rightsProfile must be a valid id`);
    if (!object(module.package)) errors.push(`${path}.package must be an object`);
    else {
      exactKeys(module.package, ["releaseManifestSha256", "treeSha256"], `${path}.package`, errors);
      if (!validString(module.package.releaseManifestSha256, HASH)) {
        errors.push(`${path}.package.releaseManifestSha256 must be a sha256`);
      } else if (releaseHashes.has(module.package.releaseManifestSha256)) {
        errors.push(`${path}.package.releaseManifestSha256 must be unique`);
      } else releaseHashes.add(module.package.releaseManifestSha256);
      if (!validString(module.package.treeSha256, HASH)) errors.push(`${path}.package.treeSha256 must be a sha256`);
      else if (treeHashes.has(module.package.treeSha256)) errors.push(`${path}.package.treeSha256 must be unique`);
      else treeHashes.add(module.package.treeSha256);
    }
  });
  if (validString(value.initialModuleId, ID) && !moduleIds.has(value.initialModuleId)) {
    errors.push("$.initialModuleId must identify one declared module");
  }
  return { ok: errors.length === 0, errors };
}

export function assertFixedCollectionLauncher(value: unknown): asserts value is FixedCollectionLauncherV1 {
  const result = validateFixedCollectionLauncher(value);
  if (!result.ok) throw new TypeError(`Invalid fixed collection launcher:\n${result.errors.join("\n")}`);
}
