import {
  ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION,
  expectedAndroidDeviceValidationStatus,
  type AndroidDeviceManualDecisionV1,
  type AndroidPhysicalDeviceValidationV1,
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

export function pngDimensions(value: Uint8Array): { width: number; height: number } | undefined {
  const bytes = Buffer.from(value);
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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
  readonly automatedChecks: AndroidPhysicalDeviceValidationV1["automatedChecks"];
  readonly artifactHashes: AndroidPhysicalDeviceValidationV1["artifacts"];
}

export function buildPendingAndroidDeviceReport(input: AndroidDeviceReportInput): AndroidPhysicalDeviceValidationV1 {
  const base = {
    schemaVersion: ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    subject: {
      applicationId: input.lineage.host.applicationId,
      apkSha256: input.apkSha256,
      androidWebLineageSha256: input.lineageSha256,
      targetProfileId: input.lineage.targetProfile.id,
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
  report: AndroidPhysicalDeviceValidationV1,
  reportSha256: string,
  decision: AndroidDeviceManualDecisionV1,
  decisionSha256: string,
): AndroidPhysicalDeviceValidationV1 {
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
