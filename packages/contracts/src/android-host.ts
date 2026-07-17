import type { ContractValidationResult } from "./release.js";

export const ANDROID_WEB_LINEAGE_SCHEMA_VERSION = "aico8.android-web-lineage.v1" as const;
export const ANDROID_WEB_ASSET_POLICY = "byte-identical-recursive-copy" as const;

export interface AndroidWebLineageFileV1 {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface AndroidWebLineageV1 {
  readonly schemaVersion: typeof ANDROID_WEB_LINEAGE_SCHEMA_VERSION;
  readonly generatedBy: "aico8-mobile-assembler-v1";
  readonly targetProfile: { readonly id: string; readonly sha256: string };
  readonly webRelease: {
    readonly releaseManifestSha256: string;
    readonly visualRuntimeSha256: string;
    readonly sourceTargetProfileId: string;
    readonly sourceTargetProfileSha256: string;
  };
  readonly webAssets: {
    readonly policy: typeof ANDROID_WEB_ASSET_POLICY;
    readonly treeSha256: string;
    readonly artifactCount: number;
    readonly unpackedBytes: number;
    readonly files: readonly AndroidWebLineageFileV1[];
  };
  readonly host: {
    readonly applicationId: string;
    readonly capacitorVersion: string;
    readonly minSdk: number;
    readonly targetSdk: number;
    readonly compileSdk: number;
    readonly signingPolicy: "external-release-key";
    readonly allowedGeneratedAssetPaths: readonly ["cordova.js", "cordova_plugins.js"];
  };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string, errors: string[]): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, required: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set(required);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const applicationIdPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const versionPattern = /^\d+\.\d+\.\d+$/;

function validString(value: unknown, path: string, errors: string[], pattern: RegExp): value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function safePath(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\")) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${path} must be a safe relative path`);
    return false;
  }
  return true;
}

function safeInteger(value: unknown, path: string, errors: string[], minimum: number): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    errors.push(`${path} must be an integer >= ${minimum}`);
    return false;
  }
  return true;
}

export function validateAndroidWebLineage(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "generatedBy", "targetProfile", "webRelease", "webAssets", "host"], "$", errors);
  if (root.schemaVersion !== ANDROID_WEB_LINEAGE_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${ANDROID_WEB_LINEAGE_SCHEMA_VERSION}`);
  }
  if (root.generatedBy !== "aico8-mobile-assembler-v1") {
    errors.push("$.generatedBy must equal aico8-mobile-assembler-v1");
  }
  const targetProfile = record(root.targetProfile, "$.targetProfile", errors);
  if (targetProfile) {
    exactKeys(targetProfile, ["id", "sha256"], "$.targetProfile", errors);
    validString(targetProfile.id, "$.targetProfile.id", errors, idPattern);
    validString(targetProfile.sha256, "$.targetProfile.sha256", errors, hashPattern);
  }
  const webRelease = record(root.webRelease, "$.webRelease", errors);
  if (webRelease) {
    exactKeys(webRelease, ["releaseManifestSha256", "visualRuntimeSha256", "sourceTargetProfileId", "sourceTargetProfileSha256"], "$.webRelease", errors);
    validString(webRelease.releaseManifestSha256, "$.webRelease.releaseManifestSha256", errors, hashPattern);
    validString(webRelease.visualRuntimeSha256, "$.webRelease.visualRuntimeSha256", errors, hashPattern);
    validString(webRelease.sourceTargetProfileId, "$.webRelease.sourceTargetProfileId", errors, idPattern);
    validString(webRelease.sourceTargetProfileSha256, "$.webRelease.sourceTargetProfileSha256", errors, hashPattern);
  }
  const webAssets = record(root.webAssets, "$.webAssets", errors);
  if (webAssets) {
    exactKeys(webAssets, ["policy", "treeSha256", "artifactCount", "unpackedBytes", "files"], "$.webAssets", errors);
    if (webAssets.policy !== ANDROID_WEB_ASSET_POLICY) {
      errors.push(`$.webAssets.policy must equal ${ANDROID_WEB_ASSET_POLICY}`);
    }
    validString(webAssets.treeSha256, "$.webAssets.treeSha256", errors, hashPattern);
    const hasCount = safeInteger(webAssets.artifactCount, "$.webAssets.artifactCount", errors, 1);
    const hasBytes = safeInteger(webAssets.unpackedBytes, "$.webAssets.unpackedBytes", errors, 1);
    if (!Array.isArray(webAssets.files) || webAssets.files.length === 0) {
      errors.push("$.webAssets.files must be a non-empty array");
    } else {
      const paths = new Set<string>();
      let byteTotal = 0;
      let previous = "";
      webAssets.files.forEach((candidate, index) => {
        const itemPath = `$.webAssets.files[${index}]`;
        const item = record(candidate, itemPath, errors);
        if (!item) return;
        exactKeys(item, ["path", "sha256", "bytes"], itemPath, errors);
        if (safePath(item.path, `${itemPath}.path`, errors)) {
          if (paths.has(item.path)) errors.push(`${itemPath}.path duplicates ${item.path}`);
          if (previous && previous.localeCompare(item.path) >= 0) errors.push("$.webAssets.files must be sorted by path");
          paths.add(item.path);
          previous = item.path;
        }
        validString(item.sha256, `${itemPath}.sha256`, errors, hashPattern);
        if (safeInteger(item.bytes, `${itemPath}.bytes`, errors, 0)) byteTotal += item.bytes;
      });
      if (hasCount && webAssets.artifactCount !== webAssets.files.length) {
        errors.push("$.webAssets.artifactCount must match files.length");
      }
      if (hasBytes && webAssets.unpackedBytes !== byteTotal) {
        errors.push("$.webAssets.unpackedBytes must match file byte total");
      }
      for (const required of ["index.html", "release-manifest.json", "target-profile.json"]) {
        if (!paths.has(required)) errors.push(`$.webAssets.files must include ${required}`);
      }
    }
  }
  const host = record(root.host, "$.host", errors);
  if (host) {
    exactKeys(host, ["applicationId", "capacitorVersion", "minSdk", "targetSdk", "compileSdk", "signingPolicy", "allowedGeneratedAssetPaths"], "$.host", errors);
    validString(host.applicationId, "$.host.applicationId", errors, applicationIdPattern);
    validString(host.capacitorVersion, "$.host.capacitorVersion", errors, versionPattern);
    const min = safeInteger(host.minSdk, "$.host.minSdk", errors, 24);
    const target = safeInteger(host.targetSdk, "$.host.targetSdk", errors, 24);
    const compile = safeInteger(host.compileSdk, "$.host.compileSdk", errors, 24);
    if (min && target && (host.minSdk as number) > (host.targetSdk as number)) errors.push("$.host.minSdk must not exceed targetSdk");
    if (target && compile && (host.targetSdk as number) > (host.compileSdk as number)) errors.push("$.host.targetSdk must not exceed compileSdk");
    if (host.signingPolicy !== "external-release-key") errors.push("$.host.signingPolicy must equal external-release-key");
    if (!Array.isArray(host.allowedGeneratedAssetPaths)
      || host.allowedGeneratedAssetPaths.length !== 2
      || host.allowedGeneratedAssetPaths[0] !== "cordova.js"
      || host.allowedGeneratedAssetPaths[1] !== "cordova_plugins.js") {
      errors.push("$.host.allowedGeneratedAssetPaths must equal the two pinned Capacitor WebView shims");
    }
  }
  return { ok: errors.length === 0, errors };
}
