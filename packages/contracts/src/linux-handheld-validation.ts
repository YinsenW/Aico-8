import {
  LINUX_HANDHELD_WEB_CAPABILITIES,
  type ContractValidationResult,
} from "./release.js";

export const LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION = "aico8.linux-handheld-validation.v1" as const;
export const LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION = "aico8.linux-handheld-manual-decision.v1" as const;
export const LINUX_HANDHELD_MIN_PERFORMANCE_CAPTURE_SECONDS = 60 as const;
export const LINUX_HANDHELD_MANUAL_CHECKS = [
  "audioOutput",
  "controllerGameplay",
  "suspendResume",
  "sustainedGameplayQuality",
] as const;
export const LINUX_HANDHELD_CAPABILITIES = LINUX_HANDHELD_WEB_CAPABILITIES;

export type LinuxHandheldCapability = (typeof LINUX_HANDHELD_CAPABILITIES)[number];
export type LinuxHandheldManualCheck = (typeof LINUX_HANDHELD_MANUAL_CHECKS)[number];
export type LinuxHandheldManualStatus = "pending" | "passed" | "failed";
export type LinuxHandheldValidationStatus = "pending-human" | "browser-gap" | "passed" | "failed";

export interface LinuxHandheldManualDecisionV1 {
  readonly schemaVersion: typeof LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION;
  readonly subjectReportSha256: string;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly checks: Record<LinuxHandheldManualCheck, Exclude<LinuxHandheldManualStatus, "pending">>;
}

export interface LinuxHandheldValidationV1 {
  readonly schemaVersion: typeof LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION;
  readonly capturedAt: string;
  readonly subject: {
    readonly webReleaseTreeSha256: string;
    readonly releaseManifestSha256: string;
    readonly targetProfileId: string;
    readonly targetProfileSha256: string;
    readonly visualRuntimeSha256: string;
  };
  readonly device: {
    readonly profileId: string;
    readonly manufacturer: string;
    readonly model: string;
    readonly osName: string;
    readonly osVersion: string;
    readonly kernelVersion: string;
    readonly architecture: string;
    readonly sessionType: "wayland" | "x11" | "direct-drm";
    readonly physicalPixels: { readonly width: number; readonly height: number };
    readonly browser: { readonly name: string; readonly version: string; readonly engine: string };
    readonly controllerName: string;
  };
  readonly automatedChecks: {
    readonly singleAuthorizedDevice: boolean;
    readonly exactWebArtifact: boolean;
    readonly cleanInstall: boolean;
    readonly offlineLaunch: boolean;
    readonly serviceWorkerControlled: boolean;
    readonly persistentStorageRoundTrip: boolean;
    readonly controllerEnumerated: boolean;
    readonly fullscreenAvailable: boolean;
    readonly audioOutputAvailable: boolean;
    readonly lifecycleResumePassed: boolean;
    readonly wasmAvailable: boolean;
    readonly webgl2Available: boolean;
    readonly readyScreenshotCaptured: boolean;
    readonly coldLaunchMilliseconds: number;
    readonly performance: {
      readonly captureSeconds: number;
      readonly warmupFrames: number;
      readonly requiredSampleFrames: number;
      readonly observedSampleFrames: number;
      readonly droppedFrameThresholdMilliseconds: number;
      readonly startupMillisecondsMax: number;
      readonly p95FrameMillisecondsMax: number;
      readonly droppedFrameRatioMax: number;
      readonly p95FrameMilliseconds: number;
      readonly droppedFrameRatio: number;
      readonly budgetPassed: boolean;
    };
  };
  readonly capabilityGaps: readonly {
    readonly capability: LinuxHandheldCapability;
    readonly symptom: string;
    readonly evidenceSha256: string;
    readonly remediation: "browser-configuration" | "thin-web-shell";
  }[];
  readonly artifacts: {
    readonly screenshotSha256: string;
    readonly capabilityReportSha256: string;
    readonly offlineReportSha256: string;
    readonly storageReportSha256: string;
    readonly controllerReportSha256: string;
    readonly lifecycleReportSha256: string;
    readonly performanceReportSha256: string;
  };
  readonly manualReview: {
    readonly decisionSha256: string | null;
    readonly reviewerId: string | null;
    readonly reviewedAt: string | null;
    readonly checks: Record<LinuxHandheldManualCheck, LinuxHandheldManualStatus>;
  };
  readonly status: LinuxHandheldValidationStatus;
}

export const LINUX_HANDHELD_CAPABILITY_EVIDENCE_FIELDS = {
  "audio-output": "capabilityReportSha256",
  controller: "controllerReportSha256",
  fullscreen: "capabilityReportSha256",
  "offline-assets": "offlineReportSha256",
  "persistent-storage": "storageReportSha256",
  wasm: "capabilityReportSha256",
  webgl2: "capabilityReportSha256",
} as const satisfies Record<LinuxHandheldCapability, keyof LinuxHandheldValidationV1["artifacts"]>;

type UnknownRecord = Record<string, unknown>;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9-]*$/;

function record(value: unknown, path: string, errors: string[]): UnknownRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, keys: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function stringValue(value: unknown, path: string, errors: string[], pattern?: RegExp): value is string {
  if (typeof value !== "string" || value.trim().length === 0 || (pattern && !pattern.test(value))) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function booleanValue(value: unknown, path: string, errors: string[]): value is boolean {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean`);
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

export function failedLinuxHandheldCapabilities(
  checks: LinuxHandheldValidationV1["automatedChecks"],
): readonly LinuxHandheldCapability[] {
  const failed: LinuxHandheldCapability[] = [];
  if (!checks.audioOutputAvailable) failed.push("audio-output");
  if (!checks.controllerEnumerated) failed.push("controller");
  if (!checks.fullscreenAvailable) failed.push("fullscreen");
  if (!checks.offlineLaunch || !checks.serviceWorkerControlled) failed.push("offline-assets");
  if (!checks.persistentStorageRoundTrip) failed.push("persistent-storage");
  if (!checks.wasmAvailable) failed.push("wasm");
  if (!checks.webgl2Available) failed.push("webgl2");
  return failed;
}

export function expectedLinuxHandheldValidationStatus(
  value: Pick<LinuxHandheldValidationV1, "automatedChecks" | "capabilityGaps" | "manualReview">,
): LinuxHandheldValidationStatus {
  const checks = value.automatedChecks;
  if (
    !checks.singleAuthorizedDevice
    || !checks.exactWebArtifact
    || !checks.cleanInstall
    || !checks.lifecycleResumePassed
    || !checks.readyScreenshotCaptured
    || checks.coldLaunchMilliseconds > checks.performance.startupMillisecondsMax
    || !checks.performance.budgetPassed
  ) return "failed";
  const failedCapabilities = failedLinuxHandheldCapabilities(checks);
  if (failedCapabilities.length > 0) return "browser-gap";
  const manual = Object.values(value.manualReview.checks);
  if (manual.includes("failed")) return "failed";
  if (manual.includes("pending")) return "pending-human";
  return "passed";
}

export function validateLinuxHandheldValidation(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "capturedAt", "subject", "device", "automatedChecks", "capabilityGaps", "artifacts", "manualReview", "status"], "$", errors);
  if (root.schemaVersion !== LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION}`);
  }
  if (typeof root.capturedAt !== "string" || Number.isNaN(Date.parse(root.capturedAt))) {
    errors.push("$.capturedAt must be an ISO date-time");
  }

  const subject = record(root.subject, "$.subject", errors);
  if (subject) {
    const keys = ["webReleaseTreeSha256", "releaseManifestSha256", "targetProfileId", "targetProfileSha256", "visualRuntimeSha256"] as const;
    exactKeys(subject, keys, "$.subject", errors);
    for (const key of keys.filter((key) => key !== "targetProfileId")) {
      stringValue(subject[key], `$.subject.${key}`, errors, hashPattern);
    }
    stringValue(subject.targetProfileId, "$.subject.targetProfileId", errors, idPattern);
  }

  const device = record(root.device, "$.device", errors);
  if (device) {
    const keys = ["profileId", "manufacturer", "model", "osName", "osVersion", "kernelVersion", "architecture", "sessionType", "physicalPixels", "browser", "controllerName"] as const;
    exactKeys(device, keys, "$.device", errors);
    stringValue(device.profileId, "$.device.profileId", errors, idPattern);
    for (const key of ["manufacturer", "model", "osName", "osVersion", "kernelVersion", "architecture", "controllerName"] as const) {
      stringValue(device[key], `$.device.${key}`, errors);
    }
    if (!(device.sessionType === "wayland" || device.sessionType === "x11" || device.sessionType === "direct-drm")) {
      errors.push("$.device.sessionType is invalid");
    }
    const pixels = record(device.physicalPixels, "$.device.physicalPixels", errors);
    if (pixels) {
      exactKeys(pixels, ["width", "height"], "$.device.physicalPixels", errors);
      integer(pixels.width, "$.device.physicalPixels.width", errors, 1);
      integer(pixels.height, "$.device.physicalPixels.height", errors, 1);
    }
    const browser = record(device.browser, "$.device.browser", errors);
    if (browser) {
      exactKeys(browser, ["name", "version", "engine"], "$.device.browser", errors);
      for (const key of ["name", "version", "engine"] as const) stringValue(browser[key], `$.device.browser.${key}`, errors);
    }
  }

  const automated = record(root.automatedChecks, "$.automatedChecks", errors);
  if (automated) {
    const booleanKeys = ["singleAuthorizedDevice", "exactWebArtifact", "cleanInstall", "offlineLaunch", "serviceWorkerControlled", "persistentStorageRoundTrip", "controllerEnumerated", "fullscreenAvailable", "audioOutputAvailable", "lifecycleResumePassed", "wasmAvailable", "webgl2Available", "readyScreenshotCaptured"] as const;
    exactKeys(automated, [...booleanKeys, "coldLaunchMilliseconds", "performance"], "$.automatedChecks", errors);
    for (const key of booleanKeys) booleanValue(automated[key], `$.automatedChecks.${key}`, errors);
    finite(automated.coldLaunchMilliseconds, "$.automatedChecks.coldLaunchMilliseconds", errors);
    const performance = record(automated.performance, "$.automatedChecks.performance", errors);
    if (performance) {
      const keys = ["captureSeconds", "warmupFrames", "requiredSampleFrames", "observedSampleFrames", "droppedFrameThresholdMilliseconds", "startupMillisecondsMax", "p95FrameMillisecondsMax", "droppedFrameRatioMax", "p95FrameMilliseconds", "droppedFrameRatio", "budgetPassed"] as const;
      exactKeys(performance, keys, "$.automatedChecks.performance", errors);
      finite(performance.captureSeconds, "$.automatedChecks.performance.captureSeconds", errors, LINUX_HANDHELD_MIN_PERFORMANCE_CAPTURE_SECONDS);
      integer(performance.warmupFrames, "$.automatedChecks.performance.warmupFrames", errors);
      integer(performance.requiredSampleFrames, "$.automatedChecks.performance.requiredSampleFrames", errors, 1);
      integer(performance.observedSampleFrames, "$.automatedChecks.performance.observedSampleFrames", errors);
      for (const key of ["droppedFrameThresholdMilliseconds", "startupMillisecondsMax", "p95FrameMillisecondsMax"] as const) {
        if (!finite(performance[key], `$.automatedChecks.performance.${key}`, errors) || performance[key] === 0) {
          errors.push(`$.automatedChecks.performance.${key} must be positive`);
        }
      }
      for (const key of ["droppedFrameRatioMax", "droppedFrameRatio"] as const) {
        if (finite(performance[key], `$.automatedChecks.performance.${key}`, errors) && (performance[key] as number) > 1) {
          errors.push(`$.automatedChecks.performance.${key} must not exceed 1`);
        }
      }
      finite(performance.p95FrameMilliseconds, "$.automatedChecks.performance.p95FrameMilliseconds", errors);
      booleanValue(performance.budgetPassed, "$.automatedChecks.performance.budgetPassed", errors);
      if (
        typeof performance.budgetPassed === "boolean"
        && typeof performance.observedSampleFrames === "number"
        && typeof performance.requiredSampleFrames === "number"
        && typeof performance.p95FrameMilliseconds === "number"
        && typeof performance.p95FrameMillisecondsMax === "number"
        && typeof performance.droppedFrameRatio === "number"
        && typeof performance.droppedFrameRatioMax === "number"
      ) {
        const expected = performance.observedSampleFrames >= performance.requiredSampleFrames
          && performance.p95FrameMilliseconds <= performance.p95FrameMillisecondsMax
          && performance.droppedFrameRatio <= performance.droppedFrameRatioMax;
        if (performance.budgetPassed !== expected) errors.push(`$.automatedChecks.performance.budgetPassed must equal derived value ${expected}`);
      }
    }
  }

  const gaps = root.capabilityGaps;
  if (!Array.isArray(gaps)) {
    errors.push("$.capabilityGaps must be an array");
  } else {
    const observed = new Set<string>();
    gaps.forEach((value, index) => {
      const gap = record(value, `$.capabilityGaps[${index}]`, errors);
      if (!gap) return;
      exactKeys(gap, ["capability", "symptom", "evidenceSha256", "remediation"], `$.capabilityGaps[${index}]`, errors);
      if (!(LINUX_HANDHELD_CAPABILITIES as readonly unknown[]).includes(gap.capability)) errors.push(`$.capabilityGaps[${index}].capability is invalid`);
      if (typeof gap.capability === "string" && observed.has(gap.capability)) errors.push(`$.capabilityGaps duplicates ${gap.capability}`);
      if (typeof gap.capability === "string") observed.add(gap.capability);
      stringValue(gap.symptom, `$.capabilityGaps[${index}].symptom`, errors);
      stringValue(gap.evidenceSha256, `$.capabilityGaps[${index}].evidenceSha256`, errors, hashPattern);
      if (!(gap.remediation === "browser-configuration" || gap.remediation === "thin-web-shell")) errors.push(`$.capabilityGaps[${index}].remediation is invalid`);
    });
    if (automated) {
      const failed = failedLinuxHandheldCapabilities(automated as unknown as LinuxHandheldValidationV1["automatedChecks"]);
      if (failed.length !== observed.size || failed.some((capability) => !observed.has(capability))) {
        errors.push("$.capabilityGaps must exactly cover failed required browser capabilities");
      }
    }
  }

  const artifacts = record(root.artifacts, "$.artifacts", errors);
  if (artifacts) {
    const keys = ["screenshotSha256", "capabilityReportSha256", "offlineReportSha256", "storageReportSha256", "controllerReportSha256", "lifecycleReportSha256", "performanceReportSha256"] as const;
    exactKeys(artifacts, keys, "$.artifacts", errors);
    for (const key of keys) stringValue(artifacts[key], `$.artifacts.${key}`, errors, hashPattern);
  }
  if (Array.isArray(gaps) && artifacts) {
    gaps.forEach((value, index) => {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return;
      const gap = value as UnknownRecord;
      if (!(LINUX_HANDHELD_CAPABILITIES as readonly unknown[]).includes(gap.capability)) return;
      const capability = gap.capability as LinuxHandheldCapability;
      const evidenceField = LINUX_HANDHELD_CAPABILITY_EVIDENCE_FIELDS[capability];
      if (typeof artifacts[evidenceField] === "string" && gap.evidenceSha256 !== artifacts[evidenceField]) {
        errors.push(`$.capabilityGaps[${index}].evidenceSha256 must equal $.artifacts.${evidenceField} for ${capability}`);
      }
    });
  }

  const manual = record(root.manualReview, "$.manualReview", errors);
  if (manual) {
    exactKeys(manual, ["decisionSha256", "reviewerId", "reviewedAt", "checks"], "$.manualReview", errors);
    const pending = manual.decisionSha256 === null;
    if (pending) {
      if (manual.reviewerId !== null || manual.reviewedAt !== null) errors.push("$.manualReview reviewer and date must be null before a decision");
    } else {
      stringValue(manual.decisionSha256, "$.manualReview.decisionSha256", errors, hashPattern);
      stringValue(manual.reviewerId, "$.manualReview.reviewerId", errors, idPattern);
      if (typeof manual.reviewedAt !== "string" || Number.isNaN(Date.parse(manual.reviewedAt))) errors.push("$.manualReview.reviewedAt must be an ISO date-time");
    }
    const checks = record(manual.checks, "$.manualReview.checks", errors);
    if (checks) {
      exactKeys(checks, LINUX_HANDHELD_MANUAL_CHECKS, "$.manualReview.checks", errors);
      for (const key of LINUX_HANDHELD_MANUAL_CHECKS) {
        if (!(checks[key] === "pending" || checks[key] === "passed" || checks[key] === "failed")) errors.push(`$.manualReview.checks.${key} is invalid`);
        else if (pending && checks[key] !== "pending") errors.push(`$.manualReview.checks.${key} must remain pending before a decision`);
        else if (!pending && checks[key] === "pending") errors.push(`$.manualReview.checks.${key} cannot remain pending after a decision`);
      }
    }
  }
  if (!(root.status === "pending-human" || root.status === "browser-gap" || root.status === "passed" || root.status === "failed")) errors.push("$.status is invalid");
  if (errors.length === 0) {
    const report = value as LinuxHandheldValidationV1;
    const expected = expectedLinuxHandheldValidationStatus(report);
    if (report.status !== expected) errors.push(`$.status must equal derived status ${expected}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateLinuxHandheldManualDecision(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "subjectReportSha256", "reviewerId", "reviewedAt", "checks"], "$", errors);
  if (root.schemaVersion !== LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION) errors.push(`$.schemaVersion must equal ${LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION}`);
  stringValue(root.subjectReportSha256, "$.subjectReportSha256", errors, hashPattern);
  stringValue(root.reviewerId, "$.reviewerId", errors, idPattern);
  if (typeof root.reviewedAt !== "string" || Number.isNaN(Date.parse(root.reviewedAt))) errors.push("$.reviewedAt must be an ISO date-time");
  const checks = record(root.checks, "$.checks", errors);
  if (checks) {
    exactKeys(checks, LINUX_HANDHELD_MANUAL_CHECKS, "$.checks", errors);
    for (const key of LINUX_HANDHELD_MANUAL_CHECKS) {
      if (!(checks[key] === "passed" || checks[key] === "failed")) errors.push(`$.checks.${key} must be passed or failed`);
    }
  }
  return { ok: errors.length === 0, errors };
}
