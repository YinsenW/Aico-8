import {
  ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION,
  expectedAndroidDeviceValidationStatus,
  type AndroidDeviceManualDecisionV1,
  type AndroidPhysicalDeviceValidationV2,
  type AndroidTargetProfileV1,
  type AndroidWebLineageV1,
} from "@aico8/contracts";
import crypto from "node:crypto";

export interface ConnectedAndroidDevice {
  readonly serial: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export function sha256(value: string | Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export const ANDROID_DEVICE_ARTIFACT_FILES = {
  screenshotSha256: "physical-host.png",
  instrumentationSha256: "instrumentation.txt",
  orientationSha256: "physical-orientation.json",
  logcatSha256: "logcat.txt",
  inputDevicesSha256: "input-devices.txt",
  gfxInfoSha256: "gfxinfo-framestats.txt",
} as const satisfies Record<keyof AndroidPhysicalDeviceValidationV2["artifacts"], string>;

export function verifyAndroidDeviceEvidenceBindings(
  report: AndroidPhysicalDeviceValidationV2,
  apkBytes: Uint8Array,
  lineageBytes: Uint8Array,
  lineage: AndroidWebLineageV1,
  targetProfileBytes: Uint8Array,
  targetProfile: AndroidTargetProfileV1,
  artifactBytes: Readonly<Record<keyof AndroidPhysicalDeviceValidationV2["artifacts"], Uint8Array>>,
): void {
  if (targetProfile.target !== "android-webview") {
    throw new Error("Android device evidence requires an android-webview target profile");
  }
  const exactBindings = [
    [sha256(apkBytes), report.subject.apkSha256, "APK bytes"],
    [sha256(lineageBytes), report.subject.androidWebLineageSha256, "Android Web lineage bytes"],
    [sha256(targetProfileBytes), report.subject.targetProfileSha256, "Android target-profile bytes"],
    [lineage.host.applicationId, report.subject.applicationId, "lineage application ID"],
    [lineage.targetProfile.id, report.subject.targetProfileId, "lineage target-profile ID"],
    [lineage.targetProfile.sha256, report.subject.targetProfileSha256, "lineage target-profile hash"],
    [targetProfile.id, report.subject.targetProfileId, "target-profile ID"],
    [targetProfile.android.applicationId, report.subject.applicationId, "target-profile application ID"],
  ] as const;
  for (const [actual, expected, label] of exactBindings) {
    if (actual !== expected) throw new Error(`${label} does not match the device report`);
  }
  for (const field of Object.keys(ANDROID_DEVICE_ARTIFACT_FILES) as (keyof typeof ANDROID_DEVICE_ARTIFACT_FILES)[]) {
    if (sha256(artifactBytes[field]) !== report.artifacts[field]) {
      throw new Error(`${ANDROID_DEVICE_ARTIFACT_FILES[field]} does not match device report artifact hash ${field}`);
    }
  }
}

export function parseConnectedAndroidDevices(output: string): readonly ConnectedAndroidDevice[] {
  return output
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.includes("\tdevice"))
    .map((line) => {
      const [identity = "", ...tokens] = line.split(/\s+/u);
      const serial = identity.split("\t", 1)[0] ?? "";
      const attributes: Record<string, string> = {};
      for (const token of tokens) {
        const separator = token.indexOf(":");
        if (separator > 0) attributes[token.slice(0, separator)] = token.slice(separator + 1);
      }
      return { serial, attributes };
    })
    .filter((device) => device.serial.length > 0);
}

export function parsePhysicalPixels(output: string): { width: number; height: number } {
  const match = output.match(/Physical size:\s*(\d+)x(\d+)/u);
  if (!match) throw new Error("adb wm size did not report a physical display size");
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function parsePhysicalDensity(output: string): number {
  const match = output.match(/Physical density:\s*(\d+)/u);
  if (!match) throw new Error("adb wm density did not report a physical display density");
  return Number(match[1]);
}

export function parsePackageVersion(output: string): { versionName: string; versionCode: string } {
  const versionName = output.match(/^\s*versionName=(\S+)/mu)?.[1];
  const versionCode = output.match(/^\s*versionCode=(\S+)/mu)?.[1];
  if (!versionName || !versionCode) throw new Error("Unable to identify the active WebView version");
  return { versionName, versionCode };
}

export function parseColdLaunchMilliseconds(output: string): number {
  const value = output.match(/^TotalTime:\s*(\d+(?:\.\d+)?)$/mu)?.[1];
  if (!value) throw new Error("adb am start did not report TotalTime");
  return Number(value);
}

export function instrumentationPassed(output: string, processStatus: number | null): boolean {
  return processStatus === 0
    && /^OK \([1-9][0-9]* tests?\)$/mu.test(output)
    && !/^FAILURES!!!$/mu.test(output);
}

export function orientationEvidencePassed(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const evidence = parsed as Record<string, unknown>;
    return Object.keys(evidence).sort().join(",")
        === "hostStatePreserved,requestedLandscape,requestedPortrait,schemaVersion"
      && evidence.schemaVersion === "aico8.android-orientation-evidence.v1"
      && evidence.requestedLandscape === true
      && evidence.requestedPortrait === true
      && evidence.hostStatePreserved === true;
  } catch {
    return false;
  }
}

export function pngDimensions(value: Uint8Array): { width: number; height: number } | undefined {
  const bytes = Buffer.from(value);
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function parseGfxFrameDurationsMilliseconds(output: string): readonly number[] {
  const durations: number[] = [];
  for (const block of output.split("---PROFILEDATA---")) {
    const lines = block.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const headerIndex = lines.findIndex((line) => line.includes("IntendedVsync") && line.includes("FrameCompleted"));
    if (headerIndex < 0) continue;
    const header = lines[headerIndex]!.split(",");
    const intendedVsyncIndex = header.indexOf("IntendedVsync");
    const frameCompletedIndex = header.indexOf("FrameCompleted");
    for (const line of lines.slice(headerIndex + 1)) {
      if (!/^\d+(?:,\d+)+$/u.test(line)) break;
      const values = line.split(",");
      const intendedVsync = Number(values[intendedVsyncIndex]);
      const frameCompleted = Number(values[frameCompletedIndex]);
      const duration = (frameCompleted - intendedVsync) / 1_000_000;
      if (Number.isFinite(duration) && duration >= 0) durations.push(duration);
    }
  }
  return durations;
}

export function evaluateAndroidPerformance(
  frameDurationsMilliseconds: readonly number[],
  target: AndroidTargetProfileV1,
  captureSeconds: number,
): AndroidPhysicalDeviceValidationV2["automatedChecks"]["performance"] {
  const { warmupFrames, sampleFrames, droppedFrameThresholdMilliseconds } = target.measurementEnvironment;
  const sample = frameDurationsMilliseconds.slice(warmupFrames, warmupFrames + sampleFrames);
  const sorted = [...sample].sort((left, right) => left - right);
  const p95 = sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
  const dropped = sample.filter((duration) => duration > droppedFrameThresholdMilliseconds).length;
  const droppedRatio = sample.length === 0 ? 1 : dropped / sample.length;
  const observedSampleFrames = sample.length;
  return {
    captureSeconds,
    warmupFrames,
    requiredSampleFrames: sampleFrames,
    observedSampleFrames,
    droppedFrameThresholdMilliseconds,
    startupMillisecondsMax: target.budgets.startupMillisecondsMax,
    p95FrameMillisecondsMax: target.budgets.p95FrameMillisecondsMax,
    droppedFrameRatioMax: target.budgets.droppedFrameRatioMax,
    p95FrameMilliseconds: Number(p95.toFixed(3)),
    droppedFrameRatio: Number(droppedRatio.toFixed(6)),
    budgetPassed: observedSampleFrames >= sampleFrames
      && p95 <= target.budgets.p95FrameMillisecondsMax
      && droppedRatio <= target.budgets.droppedFrameRatioMax,
  };
}

export interface AndroidDeviceReportInput {
  readonly capturedAt: string;
  readonly lineage: AndroidWebLineageV1;
  readonly lineageSha256: string;
  readonly apkSha256: string;
  readonly profileId: string;
  readonly serial: string;
  readonly manufacturer: string;
  readonly model: string;
  readonly product: string;
  readonly buildFingerprint: string;
  readonly apiLevel: number;
  readonly abi: string;
  readonly emulator: boolean;
  readonly physicalPixels: { readonly width: number; readonly height: number };
  readonly densityDpi: number;
  readonly webView: { readonly packageName: string; readonly versionName: string; readonly versionCode: string };
  readonly controllerName: string;
  readonly automatedChecks: AndroidPhysicalDeviceValidationV2["automatedChecks"];
  readonly artifactHashes: AndroidPhysicalDeviceValidationV2["artifacts"];
}

export function buildPendingAndroidDeviceReport(input: AndroidDeviceReportInput): AndroidPhysicalDeviceValidationV2 {
  const base = {
    schemaVersion: ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    subject: {
      applicationId: input.lineage.host.applicationId,
      apkSha256: input.apkSha256,
      androidWebLineageSha256: input.lineageSha256,
      targetProfileId: input.lineage.targetProfile.id,
      targetProfileSha256: input.lineage.targetProfile.sha256,
    },
    device: {
      profileId: input.profileId,
      serialSha256: sha256(input.serial),
      manufacturer: input.manufacturer,
      model: input.model,
      product: input.product,
      buildFingerprint: input.buildFingerprint,
      apiLevel: input.apiLevel,
      abi: input.abi,
      emulator: input.emulator,
      physicalPixels: input.physicalPixels,
      densityDpi: input.densityDpi,
      webView: input.webView,
      controllerName: input.controllerName,
    },
    automatedChecks: input.automatedChecks,
    artifacts: input.artifactHashes,
    manualReview: {
      decisionSha256: null,
      reviewerId: null,
      reviewedAt: null,
      checks: {
        audioFocusInterruptionRecovery: "pending",
        controllerGameplay: "pending",
        vendorWebViewGameplay: "pending",
        sustainedGameplayPerformance: "pending",
      },
    },
  } as const;
  return { ...base, status: expectedAndroidDeviceValidationStatus(base) };
}

export function applyAndroidDeviceManualDecision(
  report: AndroidPhysicalDeviceValidationV2,
  reportSha256: string,
  decision: AndroidDeviceManualDecisionV1,
  decisionSha256: string,
): AndroidPhysicalDeviceValidationV2 {
  if (report.status !== "pending-human" || report.manualReview.decisionSha256 !== null) {
    throw new Error("Manual review may only finalize an unreviewed pending-human report");
  }
  if (decision.subjectReportSha256 !== reportSha256) {
    throw new Error("Manual decision does not bind the exact pending report bytes");
  }
  const updated = {
    ...report,
    manualReview: {
      decisionSha256,
      reviewerId: decision.reviewerId,
      reviewedAt: decision.reviewedAt,
      checks: decision.checks,
    },
  } as const;
  return { ...updated, status: expectedAndroidDeviceValidationStatus(updated) };
}
