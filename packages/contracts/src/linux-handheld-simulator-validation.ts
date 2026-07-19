import type { ContractValidationResult } from "./release.js";

export const LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION =
  "aico8.linux-handheld-simulator-validation.v1" as const;

export interface LinuxHandheldSimulatorValidationV1 {
  readonly schemaVersion: typeof LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION;
  readonly capturedAt: string;
  readonly subject: {
    readonly webReleaseTreeSha256: string;
    readonly assetManifestSha256: string;
    readonly targetProfileId: string;
    readonly targetProfileSha256: string;
    readonly entryModuleSha256: string;
  };
  readonly simulator: {
    readonly profileId: string;
    readonly environmentClass: "linux-chromium-square-simulator";
    readonly osName: string;
    readonly osVersion: string;
    readonly kernelVersion: string;
    readonly architecture: string;
    readonly sessionType: "x11";
    readonly viewport: { readonly width: 1024; readonly height: 1024 };
    readonly browser: { readonly name: string; readonly version: string; readonly engine: "Blink" };
    readonly graphicsRenderer: string;
    readonly controllerFixture: "pre-navigation-standard-gamepad";
  };
  readonly automatedChecks: {
    readonly freshBrowserProfile: boolean;
    readonly exactWebArtifact: boolean;
    readonly squareViewport: boolean;
    readonly offlineReload: boolean;
    readonly serviceWorkerControlled: boolean;
    readonly persistentStorageRoundTrip: boolean;
    readonly simulatedControllerInputPassed: boolean;
    readonly fullscreenApiAvailable: boolean;
    readonly audioGraphAvailable: boolean;
    readonly lifecycleFreezeResumePassed: boolean;
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
  readonly artifacts: {
    readonly screenshotSha256: string;
    readonly capabilityReportSha256: string;
    readonly offlineReportSha256: string;
    readonly storageReportSha256: string;
    readonly controllerReportSha256: string;
    readonly lifecycleReportSha256: string;
    readonly performanceReportSha256: string;
  };
  readonly status: "passed" | "failed";
}

const booleanChecks = [
  "freshBrowserProfile",
  "exactWebArtifact",
  "squareViewport",
  "offlineReload",
  "serviceWorkerControlled",
  "persistentStorageRoundTrip",
  "simulatedControllerInputPassed",
  "fullscreenApiAvailable",
  "audioGraphAvailable",
  "lifecycleFreezeResumePassed",
  "wasmAvailable",
  "webgl2Available",
  "readyScreenshotCaptured",
] as const;
const hash = /^[a-f0-9]{64}$/;
const id = /^[a-z0-9][a-z0-9-]*$/;

export function expectedLinuxHandheldSimulatorStatus(
  value: Pick<LinuxHandheldSimulatorValidationV1, "automatedChecks" | "simulator">,
): LinuxHandheldSimulatorValidationV1["status"] {
  const checks = value.automatedChecks;
  return value.simulator.osName === "Linux"
    && value.simulator.sessionType === "x11"
    && value.simulator.viewport.width === 1024
    && value.simulator.viewport.height === 1024
    && /swiftshader/i.test(value.simulator.graphicsRenderer)
    && booleanChecks.every((key) => checks[key])
    && checks.coldLaunchMilliseconds <= checks.performance.startupMillisecondsMax
    && checks.performance.captureSeconds >= 60
    && checks.performance.observedSampleFrames >= checks.performance.requiredSampleFrames
    && checks.performance.p95FrameMilliseconds <= checks.performance.p95FrameMillisecondsMax
    && checks.performance.droppedFrameRatio <= checks.performance.droppedFrameRatioMax
    && checks.performance.budgetPassed
    ? "passed"
    : "failed";
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string, errors: string[]): void {
  const allowed = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function validateLinuxHandheldSimulatorValidation(value: unknown): ContractValidationResult {
  const errors: string[] = [];
  const root = object(value);
  if (!root) return { ok: false, errors: ["$ must be an object"] };
  exact(root, ["schemaVersion", "capturedAt", "subject", "simulator", "automatedChecks", "artifacts", "status"], "$", errors);
  if (root.schemaVersion !== LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION) errors.push("$.schemaVersion is invalid");
  if (typeof root.capturedAt !== "string" || Number.isNaN(Date.parse(root.capturedAt))) errors.push("$.capturedAt must be an ISO date-time");

  const subject = object(root.subject);
  if (!subject) errors.push("$.subject must be an object");
  else {
    exact(subject, ["webReleaseTreeSha256", "assetManifestSha256", "targetProfileId", "targetProfileSha256", "entryModuleSha256"], "$.subject", errors);
    for (const key of ["webReleaseTreeSha256", "assetManifestSha256", "targetProfileSha256", "entryModuleSha256"] as const) {
      if (typeof subject[key] !== "string" || !hash.test(subject[key] as string)) errors.push(`$.subject.${key} is invalid`);
    }
    if (typeof subject.targetProfileId !== "string" || !id.test(subject.targetProfileId)) errors.push("$.subject.targetProfileId is invalid");
  }

  const simulator = object(root.simulator);
  if (!simulator) errors.push("$.simulator must be an object");
  else {
    exact(simulator, ["profileId", "environmentClass", "osName", "osVersion", "kernelVersion", "architecture", "sessionType", "viewport", "browser", "graphicsRenderer", "controllerFixture"], "$.simulator", errors);
    if (typeof simulator.profileId !== "string" || !id.test(simulator.profileId)) errors.push("$.simulator.profileId is invalid");
    if (simulator.environmentClass !== "linux-chromium-square-simulator") errors.push("$.simulator.environmentClass is invalid");
    for (const key of ["osName", "osVersion", "kernelVersion", "architecture"] as const) {
      if (typeof simulator[key] !== "string" || simulator[key].length === 0) errors.push(`$.simulator.${key} is invalid`);
    }
    if (simulator.sessionType !== "x11") errors.push("$.simulator.sessionType must be x11");
    if (typeof simulator.graphicsRenderer !== "string" || simulator.graphicsRenderer.length === 0) errors.push("$.simulator.graphicsRenderer is invalid");
    if (simulator.controllerFixture !== "pre-navigation-standard-gamepad") errors.push("$.simulator.controllerFixture is invalid");
    const viewport = object(simulator.viewport);
    if (!viewport || viewport.width !== 1024 || viewport.height !== 1024) errors.push("$.simulator.viewport must be 1024x1024");
    const browser = object(simulator.browser);
    if (!browser || typeof browser.name !== "string" || typeof browser.version !== "string" || browser.engine !== "Blink") {
      errors.push("$.simulator.browser is invalid");
    }
  }

  const checks = object(root.automatedChecks);
  if (!checks) errors.push("$.automatedChecks must be an object");
  else {
    exact(checks, [...booleanChecks, "coldLaunchMilliseconds", "performance"], "$.automatedChecks", errors);
    for (const key of booleanChecks) if (typeof checks[key] !== "boolean") errors.push(`$.automatedChecks.${key} must be boolean`);
    if (!finite(checks.coldLaunchMilliseconds)) errors.push("$.automatedChecks.coldLaunchMilliseconds is invalid");
    const performance = object(checks.performance);
    const performanceKeys = ["captureSeconds", "warmupFrames", "requiredSampleFrames", "observedSampleFrames", "droppedFrameThresholdMilliseconds", "startupMillisecondsMax", "p95FrameMillisecondsMax", "droppedFrameRatioMax", "p95FrameMilliseconds", "droppedFrameRatio", "budgetPassed"] as const;
    if (!performance) errors.push("$.automatedChecks.performance must be an object");
    else {
      exact(performance, performanceKeys, "$.automatedChecks.performance", errors);
      for (const key of performanceKeys.filter((key) => key !== "budgetPassed")) {
        if (!finite(performance[key])) errors.push(`$.automatedChecks.performance.${key} is invalid`);
      }
      if (typeof performance.budgetPassed !== "boolean") errors.push("$.automatedChecks.performance.budgetPassed must be boolean");
    }
  }

  const artifacts = object(root.artifacts);
  const artifactKeys = ["screenshotSha256", "capabilityReportSha256", "offlineReportSha256", "storageReportSha256", "controllerReportSha256", "lifecycleReportSha256", "performanceReportSha256"] as const;
  if (!artifacts) errors.push("$.artifacts must be an object");
  else {
    exact(artifacts, artifactKeys, "$.artifacts", errors);
    for (const key of artifactKeys) if (typeof artifacts[key] !== "string" || !hash.test(artifacts[key] as string)) errors.push(`$.artifacts.${key} is invalid`);
  }
  if (!(root.status === "passed" || root.status === "failed")) errors.push("$.status is invalid");
  if (errors.length === 0) {
    const report = value as LinuxHandheldSimulatorValidationV1;
    const expected = expectedLinuxHandheldSimulatorStatus(report);
    if (report.status !== expected) errors.push(`$.status must equal derived status ${expected}`);
  }
  return { ok: errors.length === 0, errors };
}
