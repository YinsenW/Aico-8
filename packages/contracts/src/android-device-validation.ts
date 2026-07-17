import type { ContractValidationResult } from "./release.js";

export const ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION = "aico8.android-device-validation.v2" as const;
export const ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION = "aico8.android-device-manual-decision.v1" as const;
export const ANDROID_MIN_PERFORMANCE_CAPTURE_SECONDS = 60 as const;
export const ANDROID_DEVICE_MANUAL_CHECKS = [
  "audioFocusInterruptionRecovery",
  "controllerGameplay",
  "vendorWebViewGameplay",
  "sustainedGameplayPerformance",
] as const;

export type AndroidDeviceManualCheck = (typeof ANDROID_DEVICE_MANUAL_CHECKS)[number];
export type AndroidDeviceManualStatus = "pending" | "passed" | "failed";
export type AndroidDeviceDecidedStatus = Exclude<AndroidDeviceManualStatus, "pending">;
export type AndroidDeviceValidationStatus = "pending-human" | "passed" | "failed";

export interface AndroidDeviceManualDecisionV1 {
  readonly schemaVersion: typeof ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION;
  readonly subjectReportSha256: string;
  readonly reviewerId: string;
  readonly reviewedAt: string;
  readonly checks: Record<AndroidDeviceManualCheck, AndroidDeviceDecidedStatus>;
}

export interface AndroidPhysicalDeviceValidationV2 {
  readonly schemaVersion: typeof ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION;
  readonly capturedAt: string;
  readonly subject: {
    readonly applicationId: string;
    readonly apkSha256: string;
    readonly androidWebLineageSha256: string;
    readonly targetProfileId: string;
    readonly targetProfileSha256: string;
  };
  readonly device: {
    readonly profileId: string;
    readonly serialSha256: string;
    readonly manufacturer: string;
    readonly model: string;
    readonly product: string;
    readonly buildFingerprint: string;
    readonly apiLevel: number;
    readonly abi: string;
    readonly emulator: boolean;
    readonly physicalPixels: { readonly width: number; readonly height: number };
    readonly densityDpi: number;
    readonly webView: {
      readonly packageName: string;
      readonly versionName: string;
      readonly versionCode: string;
    };
    readonly controllerName: string;
  };
  readonly automatedChecks: {
    readonly singleAuthorizedDevice: boolean;
    readonly physicalDevice: boolean;
    readonly apkInstalled: boolean;
    readonly offlineMode: boolean;
    readonly instrumentationPassed: boolean;
    readonly orientationChangePassed: boolean;
    readonly readyScreenshotCaptured: boolean;
    readonly controllerEnumerated: boolean;
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
  readonly artifacts: {
    readonly screenshotSha256: string;
    readonly instrumentationSha256: string;
    readonly orientationSha256: string;
    readonly logcatSha256: string;
    readonly inputDevicesSha256: string;
    readonly gfxInfoSha256: string;
  };
  readonly manualReview: {
    readonly decisionSha256: string | null;
    readonly reviewerId: string | null;
    readonly reviewedAt: string | null;
    readonly checks: Record<AndroidDeviceManualCheck, AndroidDeviceManualStatus>;
  };
  readonly status: AndroidDeviceValidationStatus;
}

type UnknownRecord = Record<string, unknown>;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9-]*$/;
const applicationIdPattern = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

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

function stringMatching(value: unknown, pattern: RegExp, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${path} is invalid`);
    return false;
  }
  return true;
}

function nonEmptyString(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function positiveInteger(value: unknown, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    errors.push(`${path} must be a positive integer`);
    return false;
  }
  return true;
}

function nonNegativeInteger(value: unknown, path: string, errors: string[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    errors.push(`${path} must be a non-negative integer`);
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

export function expectedAndroidDeviceValidationStatus(
  value: Pick<AndroidPhysicalDeviceValidationV2, "device" | "automatedChecks" | "manualReview">,
): AndroidDeviceValidationStatus {
  const automated = value.automatedChecks;
  if (
    value.device.emulator
    || !automated.singleAuthorizedDevice
    || !automated.physicalDevice
    || !automated.apkInstalled
    || !automated.offlineMode
    || !automated.instrumentationPassed
    || !automated.orientationChangePassed
    || !automated.readyScreenshotCaptured
    || !automated.controllerEnumerated
    || automated.coldLaunchMilliseconds > automated.performance.startupMillisecondsMax
    || !automated.performance.budgetPassed
  ) return "failed";
  const manual = Object.values(value.manualReview.checks);
  if (manual.includes("failed")) return "failed";
  if (manual.includes("pending")) return "pending-human";
  return "passed";
}

export function validateAndroidPhysicalDeviceValidation(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "capturedAt", "subject", "device", "automatedChecks", "artifacts", "manualReview", "status"], "$", errors);
  if (root.schemaVersion !== ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION}`);
  }
  if (typeof root.capturedAt !== "string" || Number.isNaN(Date.parse(root.capturedAt))) {
    errors.push("$.capturedAt must be an ISO date-time");
  }

  const subject = record(root.subject, "$.subject", errors);
  if (subject) {
    exactKeys(subject, ["applicationId", "apkSha256", "androidWebLineageSha256", "targetProfileId", "targetProfileSha256"], "$.subject", errors);
    stringMatching(subject.applicationId, applicationIdPattern, "$.subject.applicationId", errors);
    stringMatching(subject.apkSha256, hashPattern, "$.subject.apkSha256", errors);
    stringMatching(subject.androidWebLineageSha256, hashPattern, "$.subject.androidWebLineageSha256", errors);
    stringMatching(subject.targetProfileId, idPattern, "$.subject.targetProfileId", errors);
    stringMatching(subject.targetProfileSha256, hashPattern, "$.subject.targetProfileSha256", errors);
  }

  const device = record(root.device, "$.device", errors);
  if (device) {
    exactKeys(device, ["profileId", "serialSha256", "manufacturer", "model", "product", "buildFingerprint", "apiLevel", "abi", "emulator", "physicalPixels", "densityDpi", "webView", "controllerName"], "$.device", errors);
    stringMatching(device.profileId, idPattern, "$.device.profileId", errors);
    stringMatching(device.serialSha256, hashPattern, "$.device.serialSha256", errors);
    for (const key of ["manufacturer", "model", "product", "buildFingerprint", "abi", "controllerName"] as const) {
      nonEmptyString(device[key], `$.device.${key}`, errors);
    }
    positiveInteger(device.apiLevel, "$.device.apiLevel", errors);
    booleanValue(device.emulator, "$.device.emulator", errors);
    positiveInteger(device.densityDpi, "$.device.densityDpi", errors);
    const pixels = record(device.physicalPixels, "$.device.physicalPixels", errors);
    if (pixels) {
      exactKeys(pixels, ["width", "height"], "$.device.physicalPixels", errors);
      positiveInteger(pixels.width, "$.device.physicalPixels.width", errors);
      positiveInteger(pixels.height, "$.device.physicalPixels.height", errors);
    }
    const webView = record(device.webView, "$.device.webView", errors);
    if (webView) {
      exactKeys(webView, ["packageName", "versionName", "versionCode"], "$.device.webView", errors);
      stringMatching(webView.packageName, applicationIdPattern, "$.device.webView.packageName", errors);
      nonEmptyString(webView.versionName, "$.device.webView.versionName", errors);
      nonEmptyString(webView.versionCode, "$.device.webView.versionCode", errors);
    }
  }

  const automated = record(root.automatedChecks, "$.automatedChecks", errors);
  if (automated) {
    const keys = ["singleAuthorizedDevice", "physicalDevice", "apkInstalled", "offlineMode", "instrumentationPassed", "orientationChangePassed", "readyScreenshotCaptured", "controllerEnumerated", "coldLaunchMilliseconds", "performance"] as const;
    exactKeys(automated, keys, "$.automatedChecks", errors);
    for (const key of ["singleAuthorizedDevice", "physicalDevice", "apkInstalled", "offlineMode", "instrumentationPassed", "orientationChangePassed", "readyScreenshotCaptured", "controllerEnumerated"] as const) {
      booleanValue(automated[key], `$.automatedChecks.${key}`, errors);
    }
    if (typeof automated.coldLaunchMilliseconds !== "number" || automated.coldLaunchMilliseconds < 0) {
      errors.push("$.automatedChecks.coldLaunchMilliseconds must be a non-negative number");
    }
    const performance = record(automated.performance, "$.automatedChecks.performance", errors);
    if (performance) {
      const performanceKeys = ["captureSeconds", "warmupFrames", "requiredSampleFrames", "observedSampleFrames", "droppedFrameThresholdMilliseconds", "startupMillisecondsMax", "p95FrameMillisecondsMax", "droppedFrameRatioMax", "p95FrameMilliseconds", "droppedFrameRatio", "budgetPassed"] as const;
      exactKeys(performance, performanceKeys, "$.automatedChecks.performance", errors);
      if (typeof performance.captureSeconds !== "number" || performance.captureSeconds < ANDROID_MIN_PERFORMANCE_CAPTURE_SECONDS) {
        errors.push(`$.automatedChecks.performance.captureSeconds must be >= ${ANDROID_MIN_PERFORMANCE_CAPTURE_SECONDS}`);
      }
      nonNegativeInteger(performance.warmupFrames, "$.automatedChecks.performance.warmupFrames", errors);
      positiveInteger(performance.requiredSampleFrames, "$.automatedChecks.performance.requiredSampleFrames", errors);
      nonNegativeInteger(performance.observedSampleFrames, "$.automatedChecks.performance.observedSampleFrames", errors);
      for (const key of ["droppedFrameThresholdMilliseconds", "startupMillisecondsMax", "p95FrameMillisecondsMax"] as const) {
        if (typeof performance[key] !== "number" || !Number.isFinite(performance[key]) || (performance[key] as number) <= 0) {
          errors.push(`$.automatedChecks.performance.${key} must be a positive finite number`);
        }
      }
      if (
        typeof performance.droppedFrameRatioMax !== "number"
        || !Number.isFinite(performance.droppedFrameRatioMax)
        || performance.droppedFrameRatioMax < 0
        || performance.droppedFrameRatioMax > 1
      ) errors.push("$.automatedChecks.performance.droppedFrameRatioMax must be between 0 and 1");
      if (
        typeof performance.p95FrameMilliseconds !== "number"
        || !Number.isFinite(performance.p95FrameMilliseconds)
        || performance.p95FrameMilliseconds < 0
      ) errors.push("$.automatedChecks.performance.p95FrameMilliseconds must be a non-negative finite number");
      if (
        typeof performance.droppedFrameRatio !== "number"
        || !Number.isFinite(performance.droppedFrameRatio)
        || performance.droppedFrameRatio < 0
        || performance.droppedFrameRatio > 1
      ) errors.push("$.automatedChecks.performance.droppedFrameRatio must be between 0 and 1");
      booleanValue(performance.budgetPassed, "$.automatedChecks.performance.budgetPassed", errors);
      if (
        Number.isSafeInteger(performance.requiredSampleFrames)
        && Number.isSafeInteger(performance.observedSampleFrames)
        && typeof performance.p95FrameMilliseconds === "number"
        && typeof performance.p95FrameMillisecondsMax === "number"
        && typeof performance.droppedFrameRatio === "number"
        && typeof performance.droppedFrameRatioMax === "number"
        && typeof performance.budgetPassed === "boolean"
      ) {
        const expectedBudgetPassed = (performance.observedSampleFrames as number) >= (performance.requiredSampleFrames as number)
          && performance.p95FrameMilliseconds <= performance.p95FrameMillisecondsMax
          && performance.droppedFrameRatio <= performance.droppedFrameRatioMax;
        if (performance.budgetPassed !== expectedBudgetPassed) {
          errors.push(`$.automatedChecks.performance.budgetPassed must equal derived value ${expectedBudgetPassed}`);
        }
      }
    }
  }

  const artifacts = record(root.artifacts, "$.artifacts", errors);
  if (artifacts) {
    const keys = ["screenshotSha256", "instrumentationSha256", "orientationSha256", "logcatSha256", "inputDevicesSha256", "gfxInfoSha256"] as const;
    exactKeys(artifacts, keys, "$.artifacts", errors);
    for (const key of keys) stringMatching(artifacts[key], hashPattern, `$.artifacts.${key}`, errors);
  }

  const manual = record(root.manualReview, "$.manualReview", errors);
  if (manual) {
    exactKeys(manual, ["decisionSha256", "reviewerId", "reviewedAt", "checks"], "$.manualReview", errors);
    const pending = manual.decisionSha256 === null;
    if (!pending) stringMatching(manual.decisionSha256, hashPattern, "$.manualReview.decisionSha256", errors);
    if (pending) {
      if (manual.reviewerId !== null) errors.push("$.manualReview.reviewerId must be null before a decision");
      if (manual.reviewedAt !== null) errors.push("$.manualReview.reviewedAt must be null before a decision");
    } else {
      stringMatching(manual.reviewerId, idPattern, "$.manualReview.reviewerId", errors);
      if (typeof manual.reviewedAt !== "string" || Number.isNaN(Date.parse(manual.reviewedAt))) {
        errors.push("$.manualReview.reviewedAt must be an ISO date-time after a decision");
      }
    }
    const checks = record(manual.checks, "$.manualReview.checks", errors);
    if (checks) {
      exactKeys(checks, ANDROID_DEVICE_MANUAL_CHECKS, "$.manualReview.checks", errors);
      for (const key of ANDROID_DEVICE_MANUAL_CHECKS) {
        if (!(["pending", "passed", "failed"] as const).includes(checks[key] as AndroidDeviceManualStatus)) {
          errors.push(`$.manualReview.checks.${key} is invalid`);
        } else if (pending && checks[key] !== "pending") {
          errors.push(`$.manualReview.checks.${key} must remain pending before a decision`);
        } else if (!pending && checks[key] === "pending") {
          errors.push(`$.manualReview.checks.${key} cannot remain pending after a decision`);
        }
      }
    }
  }
  if (!(["pending-human", "passed", "failed"] as const).includes(root.status as AndroidDeviceValidationStatus)) {
    errors.push("$.status is invalid");
  }

  if (errors.length === 0) {
    const report = value as AndroidPhysicalDeviceValidationV2;
    const expected = expectedAndroidDeviceValidationStatus(report);
    if (report.status !== expected) errors.push(`$.status must equal derived status ${expected}`);
  }
  return { ok: errors.length === 0, errors };
}

export function validateAndroidDeviceManualDecision(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = record(value, "$", errors);
  if (!root) return { ok: false, errors };
  exactKeys(root, ["schemaVersion", "subjectReportSha256", "reviewerId", "reviewedAt", "checks"], "$", errors);
  if (root.schemaVersion !== ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION) {
    errors.push(`$.schemaVersion must equal ${ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION}`);
  }
  stringMatching(root.subjectReportSha256, hashPattern, "$.subjectReportSha256", errors);
  stringMatching(root.reviewerId, idPattern, "$.reviewerId", errors);
  if (typeof root.reviewedAt !== "string" || Number.isNaN(Date.parse(root.reviewedAt))) {
    errors.push("$.reviewedAt must be an ISO date-time");
  }
  const checks = record(root.checks, "$.checks", errors);
  if (checks) {
    exactKeys(checks, ANDROID_DEVICE_MANUAL_CHECKS, "$.checks", errors);
    for (const key of ANDROID_DEVICE_MANUAL_CHECKS) {
      if (!(["passed", "failed"] as const).includes(checks[key] as AndroidDeviceDecidedStatus)) {
        errors.push(`$.checks.${key} must be passed or failed`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
