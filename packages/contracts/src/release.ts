export const TARGET_PROFILE_SCHEMA_VERSION = "aico8.target-profile.v1" as const;
export const RELEASE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const RELEASE_VALIDATION_SCHEMA_VERSION = "aico8.release-validation.v1" as const;

export interface ContractValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface WebTargetProfileV1 {
  readonly schemaVersion: typeof TARGET_PROFILE_SCHEMA_VERSION;
  readonly id: string;
  readonly target: "web-pwa";
  readonly outputProfile: string;
  readonly measurementEnvironment: {
    readonly class: "local-http-active-browser";
    readonly viewport: { readonly width: number; readonly height: number };
    readonly warmupFrames: number;
    readonly sampleFrames: number;
    readonly droppedFrameThresholdMilliseconds: number;
  };
  readonly budgets: {
    readonly artifactCountMax: number;
    readonly unpackedBytesMax: number;
    readonly largestArtifactBytesMax: number;
    readonly startupMillisecondsMax: number;
    readonly p95FrameMillisecondsMax: number;
    readonly droppedFrameRatioMax: number;
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

function exactKeys(value: UnknownRecord, required: readonly string[], optional: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function stringValue(value: unknown, path: string, errors: string[], pattern?: RegExp): value is string {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    errors.push(`${path} must be a valid non-empty string`);
    return false;
  }
  return true;
}

function finite(value: unknown, path: string, errors: string[], minimum = 0): value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    errors.push(`${path} must be a finite number >= ${minimum}`);
    return false;
  }
  return true;
}

function integer(value: unknown, path: string, errors: string[], minimum = 0): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    errors.push(`${path} must be an integer >= ${minimum}`);
    return false;
  }
  return true;
}

function booleanValue(value: unknown, path: string, errors: string[]): value is boolean {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be boolean`);
    return false;
  }
  return true;
}

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9-]*$/;

function safeRelativePath(value: unknown, path: string, errors: string[]): value is string {
  if (!stringValue(value, path, errors)) return false;
  const segments = value.split("/");
  if (value.startsWith("/") || value.includes("\\")
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    errors.push(`${path} contains an unsafe artifact path`);
    return false;
  }
  return true;
}

export function validateTargetProfile(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "id", "target", "outputProfile", "measurementEnvironment", "budgets"], [], "$", errors);
  if (root.schemaVersion !== TARGET_PROFILE_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${TARGET_PROFILE_SCHEMA_VERSION}`);
  stringValue(root.id, "$.id", errors, idPattern);
  if (root.target !== "web-pwa") errors.push("$.target must equal web-pwa");
  stringValue(root.outputProfile, "$.outputProfile", errors, idPattern);
  const environment = record(root.measurementEnvironment, "$.measurementEnvironment", errors);
  if (environment) {
    exactKeys(environment, ["class", "viewport", "warmupFrames", "sampleFrames", "droppedFrameThresholdMilliseconds"], [], "$.measurementEnvironment", errors);
    if (environment.class !== "local-http-active-browser") errors.push("$.measurementEnvironment.class must equal local-http-active-browser");
    const viewport = record(environment.viewport, "$.measurementEnvironment.viewport", errors);
    if (viewport) {
      exactKeys(viewport, ["width", "height"], [], "$.measurementEnvironment.viewport", errors);
      integer(viewport.width, "$.measurementEnvironment.viewport.width", errors, 1);
      integer(viewport.height, "$.measurementEnvironment.viewport.height", errors, 1);
    }
    integer(environment.warmupFrames, "$.measurementEnvironment.warmupFrames", errors, 0);
    integer(environment.sampleFrames, "$.measurementEnvironment.sampleFrames", errors, 1);
    finite(environment.droppedFrameThresholdMilliseconds, "$.measurementEnvironment.droppedFrameThresholdMilliseconds", errors, Number.EPSILON);
  }
  const budgets = record(root.budgets, "$.budgets", errors);
  if (budgets) {
    exactKeys(budgets, ["artifactCountMax", "unpackedBytesMax", "largestArtifactBytesMax", "startupMillisecondsMax", "p95FrameMillisecondsMax", "droppedFrameRatioMax"], [], "$.budgets", errors);
    for (const key of ["artifactCountMax", "unpackedBytesMax", "largestArtifactBytesMax", "startupMillisecondsMax"] as const) {
      integer(budgets[key], `$.budgets.${key}`, errors, 1);
    }
    finite(budgets.p95FrameMillisecondsMax, "$.budgets.p95FrameMillisecondsMax", errors, Number.EPSILON);
    if (finite(budgets.droppedFrameRatioMax, "$.budgets.droppedFrameRatioMax", errors, 0)
      && (budgets.droppedFrameRatioMax as number) > 1) errors.push("$.budgets.droppedFrameRatioMax must not exceed 1");
  }
  return { ok: errors.length === 0, errors };
}

function validateSizedEntries(value: unknown, path: string, errors: string[]): Array<{ path: string; sha256: string; bytes: number }> {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return [];
  }
  const entries: Array<{ path: string; sha256: string; bytes: number }> = [];
  const paths = new Set<string>();
  value.forEach((item, index) => {
    const entryPath = `${path}[${index}]`;
    const candidate = record(item, entryPath, errors);
    if (!candidate) return;
    exactKeys(candidate, ["path", "sha256", "bytes"], [], entryPath, errors);
    const hasPath = safeRelativePath(candidate.path, `${entryPath}.path`, errors);
    const hasHash = stringValue(candidate.sha256, `${entryPath}.sha256`, errors, hashPattern);
    const hasBytes = integer(candidate.bytes, `${entryPath}.bytes`, errors, 0);
    if (hasPath && paths.has(candidate.path as string)) errors.push(`${entryPath}.path duplicates ${candidate.path}`);
    if (hasPath) paths.add(candidate.path as string);
    if (hasPath && hasHash && hasBytes) entries.push(candidate as { path: string; sha256: string; bytes: number });
  });
  return entries;
}

export function validateReleaseManifest(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schema_version", "game", "target", "presentation", "output_profile", "target_profile", "rights", "audio", "identities", "measurements", "inputs", "artifacts"], [], "$", errors);
  if (root.schema_version !== RELEASE_MANIFEST_SCHEMA_VERSION) errors.push(`$.schema_version must equal ${RELEASE_MANIFEST_SCHEMA_VERSION}`);
  const game = record(root.game, "$.game", errors);
  if (game) {
    exactKeys(game, ["id", "title", "author"], [], "$.game", errors);
    stringValue(game.id, "$.game.id", errors, idPattern);
    stringValue(game.title, "$.game.title", errors);
    stringValue(game.author, "$.game.author", errors);
  }
  if (root.target !== "web-pwa") errors.push("$.target must equal web-pwa");
  stringValue(root.presentation, "$.presentation", errors, idPattern);
  stringValue(root.output_profile, "$.output_profile", errors, idPattern);
  const profile = record(root.target_profile, "$.target_profile", errors);
  if (profile) {
    exactKeys(profile, ["id", "sha256"], [], "$.target_profile", errors);
    stringValue(profile.id, "$.target_profile.id", errors, idPattern);
    stringValue(profile.sha256, "$.target_profile.sha256", errors, hashPattern);
  }
  const rights = record(root.rights, "$.rights", errors);
  if (rights) {
    exactKeys(rights, ["profile", "sourceLicense", "sourceUrl"], [], "$.rights", errors);
    stringValue(rights.profile, "$.rights.profile", errors, idPattern);
    stringValue(rights.sourceLicense, "$.rights.sourceLicense", errors);
    stringValue(rights.sourceUrl, "$.rights.sourceUrl", errors);
  }
  stringValue(root.audio, "$.audio", errors, idPattern);
  const identities = record(root.identities, "$.identities", errors);
  if (identities) {
    exactKeys(identities, ["visual_runtime_schema", "visual_runtime_sha256"], ["validation_replay_sha256", "validation_replay_semantics_schema", "validation_replay_semantics_sha256"], "$.identities", errors);
    if (identities.visual_runtime_schema !== "aico8.visual-runtime-identity.v1") errors.push("$.identities.visual_runtime_schema is unsupported");
    stringValue(identities.visual_runtime_sha256, "$.identities.visual_runtime_sha256", errors, hashPattern);
    const replayKeys = ["validation_replay_sha256", "validation_replay_semantics_schema", "validation_replay_semantics_sha256"];
    const replayCount = replayKeys.filter((key) => key in identities).length;
    if (replayCount !== 0 && replayCount !== replayKeys.length) errors.push("$.identities validation replay identity must be complete or absent");
    if (replayCount === replayKeys.length) {
      stringValue(identities.validation_replay_sha256, "$.identities.validation_replay_sha256", errors, hashPattern);
      if (identities.validation_replay_semantics_schema !== "aico8.validation-replay-semantics.v1") errors.push("$.identities.validation_replay_semantics_schema is unsupported");
      stringValue(identities.validation_replay_semantics_sha256, "$.identities.validation_replay_semantics_sha256", errors, hashPattern);
    }
  }
  const inputs = validateSizedEntries(root.inputs, "$.inputs", errors);
  const artifacts = validateSizedEntries(root.artifacts, "$.artifacts", errors);
  const measurements = record(root.measurements, "$.measurements", errors);
  if (measurements) {
    exactKeys(measurements, ["artifact_count", "unpacked_bytes", "largest_artifact_bytes", "release_manifest_bytes"], [], "$.measurements", errors);
    integer(measurements.artifact_count, "$.measurements.artifact_count", errors, 1);
    integer(measurements.unpacked_bytes, "$.measurements.unpacked_bytes", errors, 0);
    integer(measurements.largest_artifact_bytes, "$.measurements.largest_artifact_bytes", errors, 0);
    const hasManifestBytes = integer(measurements.release_manifest_bytes, "$.measurements.release_manifest_bytes", errors, 1);
    if (artifacts.length > 0) {
      const manifestBytes = hasManifestBytes ? measurements.release_manifest_bytes as number : 0;
      const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes, manifestBytes);
      const largest = Math.max(manifestBytes, ...artifacts.map(({ bytes }) => bytes));
      if (measurements.artifact_count !== artifacts.length + 1) errors.push("$.measurements.artifact_count must include artifacts plus the release manifest");
      if (measurements.unpacked_bytes !== total) errors.push("$.measurements.unpacked_bytes must include artifacts plus the release manifest");
      if (measurements.largest_artifact_bytes !== largest) errors.push("$.measurements.largest_artifact_bytes does not match the complete package");
    }
  }
  if (inputs.some((input) => artifacts.some((artifact) => artifact.path === input.path))) {
    errors.push("$.inputs use logical build-input names and may not duplicate packaged artifact paths");
  }
  return { ok: errors.length === 0, errors };
}

export function validateReleaseValidation(value: unknown, profileValue: unknown): ContractValidationResult {
  const profileValidation = validateTargetProfile(profileValue);
  if (!profileValidation.ok) return profileValidation;
  const errors: string[] = [];
  const profile = profileValue as WebTargetProfileV1;
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "subject", "targetProfile", "environment", "package", "runtime", "checks", "status"], [], "$", errors);
  if (root.schemaVersion !== RELEASE_VALIDATION_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${RELEASE_VALIDATION_SCHEMA_VERSION}`);
  const subject = record(root.subject, "$.subject", errors);
  if (subject) {
    exactKeys(subject, ["gameId", "target", "visualRuntimeSha256"], [], "$.subject", errors);
    stringValue(subject.gameId, "$.subject.gameId", errors, idPattern);
    if (subject.target !== profile.target) errors.push("$.subject.target does not match target profile");
    stringValue(subject.visualRuntimeSha256, "$.subject.visualRuntimeSha256", errors, hashPattern);
  }
  const target = record(root.targetProfile, "$.targetProfile", errors);
  if (target) {
    exactKeys(target, ["id", "sha256"], [], "$.targetProfile", errors);
    if (target.id !== profile.id) errors.push("$.targetProfile.id does not match target profile");
    stringValue(target.sha256, "$.targetProfile.sha256", errors, hashPattern);
  }
  const environment = record(root.environment, "$.environment", errors);
  if (environment) {
    exactKeys(environment, ["class", "userAgentFamily", "viewport"], [], "$.environment", errors);
    if (environment.class !== profile.measurementEnvironment.class) errors.push("$.environment.class does not match target profile");
    stringValue(environment.userAgentFamily, "$.environment.userAgentFamily", errors);
    const viewport = record(environment.viewport, "$.environment.viewport", errors);
    if (viewport) {
      exactKeys(viewport, ["width", "height"], [], "$.environment.viewport", errors);
      if (viewport.width !== profile.measurementEnvironment.viewport.width || viewport.height !== profile.measurementEnvironment.viewport.height) {
        errors.push("$.environment.viewport does not match target profile");
      }
    }
  }
  const packageMetrics = record(root.package, "$.package", errors);
  if (packageMetrics) {
    exactKeys(packageMetrics, ["artifactCount", "unpackedBytes", "largestArtifactBytes"], [], "$.package", errors);
    for (const [key, budget] of [
      ["artifactCount", profile.budgets.artifactCountMax],
      ["unpackedBytes", profile.budgets.unpackedBytesMax],
      ["largestArtifactBytes", profile.budgets.largestArtifactBytesMax],
    ] as const) {
      if (integer(packageMetrics[key], `$.package.${key}`, errors, 0) && (packageMetrics[key] as number) > budget) {
        errors.push(`$.package.${key} exceeds target budget ${budget}`);
      }
    }
  }
  const runtime = record(root.runtime, "$.runtime", errors);
  if (runtime) {
    exactKeys(runtime, ["startupMilliseconds", "sampleFrames", "p95FrameMilliseconds", "maxFrameMilliseconds", "droppedFrameRatio"], [], "$.runtime", errors);
    if (finite(runtime.startupMilliseconds, "$.runtime.startupMilliseconds", errors, 0)
      && (runtime.startupMilliseconds as number) > profile.budgets.startupMillisecondsMax) errors.push("$.runtime.startupMilliseconds exceeds target budget");
    if (integer(runtime.sampleFrames, "$.runtime.sampleFrames", errors, 1)
      && (runtime.sampleFrames as number) < profile.measurementEnvironment.sampleFrames) errors.push("$.runtime.sampleFrames is below target sample count");
    if (finite(runtime.p95FrameMilliseconds, "$.runtime.p95FrameMilliseconds", errors, 0)
      && (runtime.p95FrameMilliseconds as number) > profile.budgets.p95FrameMillisecondsMax) errors.push("$.runtime.p95FrameMilliseconds exceeds target budget");
    finite(runtime.maxFrameMilliseconds, "$.runtime.maxFrameMilliseconds", errors, 0);
    if (finite(runtime.droppedFrameRatio, "$.runtime.droppedFrameRatio", errors, 0)) {
      if ((runtime.droppedFrameRatio as number) > 1) errors.push("$.runtime.droppedFrameRatio must not exceed 1");
      if ((runtime.droppedFrameRatio as number) > profile.budgets.droppedFrameRatioMax) errors.push("$.runtime.droppedFrameRatio exceeds target budget");
    }
  }
  const checks = record(root.checks, "$.checks", errors);
  const checkNames = ["manifest", "checksums", "notices", "accessibility", "packageBudgets", "runtimeBudgets"];
  if (checks) {
    exactKeys(checks, checkNames, [], "$.checks", errors);
    for (const name of checkNames) booleanValue(checks[name], `$.checks.${name}`, errors);
  }
  if (root.status !== "passed" && root.status !== "failed") errors.push("$.status must be passed or failed");
  if (root.status === "passed" && (errors.length > 0 || !checks || checkNames.some((name) => checks[name] !== true))) {
    errors.push("$.status cannot be passed while a technical check or budget fails");
  }
  return { ok: errors.length === 0, errors };
}
