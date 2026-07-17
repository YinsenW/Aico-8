import { describe, expect, it } from "vitest";
import {
  ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION,
  ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION,
  expectedAndroidDeviceValidationStatus,
  validateAndroidDeviceManualDecision,
  validateAndroidPhysicalDeviceValidation,
  type AndroidPhysicalDeviceValidationV1,
} from "./android-device-validation.js";

const hash = "a".repeat(64);

function report(): AndroidPhysicalDeviceValidationV1 {
  return {
    schemaVersion: ANDROID_DEVICE_VALIDATION_SCHEMA_VERSION,
    capturedAt: "2026-07-17T00:00:00.000Z",
    subject: {
      applicationId: "dev.aico8.research",
      apkSha256: hash,
      androidWebLineageSha256: hash,
      targetProfileId: "android-webview-private-research-v1",
    },
    device: {
      profileId: "retroid-pocket-test",
      serialSha256: hash,
      manufacturer: "Example",
      model: "Handheld",
      product: "handheld",
      buildFingerprint: "example/handheld/build:15/id:user/release-keys",
      apiLevel: 35,
      abi: "arm64-v8a",
      emulator: false,
      physicalPixels: { width: 1024, height: 1024 },
      densityDpi: 320,
      webView: { packageName: "com.google.android.webview", versionName: "124.0", versionCode: "1" },
      controllerName: "Example Gamepad",
    },
    automatedChecks: {
      singleAuthorizedDevice: true,
      physicalDevice: true,
      apkInstalled: true,
      offlineMode: true,
      instrumentationPassed: true,
      readyScreenshotCaptured: true,
      controllerEnumerated: true,
      coldLaunchMilliseconds: 1200,
    },
    artifacts: {
      screenshotSha256: hash,
      instrumentationSha256: hash,
      logcatSha256: hash,
      inputDevicesSha256: hash,
      gfxInfoSha256: hash,
    },
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
    status: "pending-human",
  };
}

describe("Android physical-device validation", () => {
  it("requires a complete immutable manual decision", () => {
    expect(validateAndroidDeviceManualDecision({
      schemaVersion: ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION,
      subjectReportSha256: hash,
      reviewerId: "human-reviewer",
      reviewedAt: "2026-07-17T01:00:00.000Z",
      checks: {
        audioFocusInterruptionRecovery: "passed",
        controllerGameplay: "passed",
        vendorWebViewGameplay: "passed",
        sustainedGameplayPerformance: "passed",
      },
    })).toEqual({ ok: true, errors: [] });
    expect(validateAndroidDeviceManualDecision({
      schemaVersion: ANDROID_DEVICE_MANUAL_DECISION_SCHEMA_VERSION,
      subjectReportSha256: hash,
      reviewerId: "human-reviewer",
      reviewedAt: "2026-07-17T01:00:00.000Z",
      checks: {
        audioFocusInterruptionRecovery: "pending",
        controllerGameplay: "passed",
        vendorWebViewGameplay: "passed",
        sustainedGameplayPerformance: "passed",
      },
    }).errors).toContain("$.checks.audioFocusInterruptionRecovery must be passed or failed");
  });

  it("accepts machine evidence while keeping human checks pending", () => {
    const value = report();
    expect(expectedAndroidDeviceValidationStatus(value)).toBe("pending-human");
    expect(validateAndroidPhysicalDeviceValidation(value)).toEqual({ ok: true, errors: [] });
  });

  it("accepts completion only after every manual check passes", () => {
    const value: AndroidPhysicalDeviceValidationV1 = {
      ...report(),
      manualReview: {
        decisionSha256: hash,
        reviewerId: "human-reviewer",
        reviewedAt: "2026-07-17T01:00:00.000Z",
        checks: {
          audioFocusInterruptionRecovery: "passed",
          controllerGameplay: "passed",
          vendorWebViewGameplay: "passed",
          sustainedGameplayPerformance: "passed",
        },
      },
      status: "passed",
    };
    expect(validateAndroidPhysicalDeviceValidation(value)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a passed claim with pending human work", () => {
    const value: AndroidPhysicalDeviceValidationV1 = { ...report(), status: "passed" };
    expect(validateAndroidPhysicalDeviceValidation(value).errors).toContain(
      "$.status must equal derived status pending-human",
    );
  });

  it("rejects emulators and failed machine checks as physical acceptance", () => {
    const base = report();
    const value: AndroidPhysicalDeviceValidationV1 = {
      ...base,
      device: { ...base.device, emulator: true },
    };
    expect(expectedAndroidDeviceValidationStatus(value)).toBe("failed");
    expect(validateAndroidPhysicalDeviceValidation(value).errors).toContain(
      "$.status must equal derived status failed",
    );
  });
});
