import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import {
  LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION,
  type LinuxHandheldTargetProfileV1,
  type LinuxHandheldValidationV1,
} from "@aico8/contracts";
import {
  applyLinuxHandheldManualDecision,
  buildPendingLinuxHandheldReport,
  evaluateLinuxHandheldPerformance,
  verifyLinuxHandheldManualDecisionBinding,
} from "./linux-handheld-capture.js";

const hash = "a".repeat(64);
const target: LinuxHandheldTargetProfileV1 = {
  schemaVersion: "aico8.target-profile.v1",
  id: "linux-handheld-web-private-research-v1",
  target: "linux-handheld-web",
  outputProfile: "hd-1024-square",
  measurementEnvironment: {
    class: "linux-handheld-browser",
    viewport: { width: 1280, height: 800 },
    warmupFrames: 1,
    sampleFrames: 3,
    droppedFrameThresholdMilliseconds: 25,
  },
  layoutProfiles: [
    { id: "square-handheld-1024x1024", class: "square-handheld", viewport: { width: 1024, height: 1024 }, minGameFrameCssPixels: 800, minTouchTargetCssPixels: 44 },
    { id: "linux-handheld-landscape-1280x800", class: "linux-handheld-landscape", viewport: { width: 1280, height: 800 }, minGameFrameCssPixels: 560, minTouchTargetCssPixels: 44 },
  ],
  budgets: {
    artifactCountMax: 60,
    unpackedBytesMax: 3_000_000,
    largestArtifactBytesMax: 750_000,
    startupMillisecondsMax: 4000,
    p95FrameMillisecondsMax: 25,
    droppedFrameRatioMax: 0.34,
  },
  linux: {
    deliveryMode: "browser-pwa",
    webArtifactPolicy: "byte-identical-web-release",
    shellPolicy: "measured-capability-gap-only",
    requiredCapabilities: ["audio-output", "controller", "fullscreen", "offline-assets", "persistent-storage", "wasm", "webgl2"],
  },
};

function input(performance: LinuxHandheldValidationV1["automatedChecks"]["performance"]) {
  return {
    capturedAt: "2026-07-17T00:00:00.000Z",
    subject: {
      webReleaseTreeSha256: hash,
      releaseManifestSha256: hash,
      targetProfileId: target.id,
      targetProfileSha256: hash,
      visualRuntimeSha256: hash,
    },
    device: {
      profileId: "named-linux-handheld",
      manufacturer: "Example",
      model: "Handheld",
      osName: "Example Linux",
      osVersion: "1",
      kernelVersion: "6.1",
      architecture: "aarch64",
      sessionType: "wayland" as const,
      physicalPixels: { width: 1024, height: 1024 },
      browser: { name: "Chromium", version: "124", engine: "Blink" },
      controllerName: "Named Controller",
    },
    automatedChecks: {
      singleAuthorizedDevice: true,
      exactWebArtifact: true,
      cleanInstall: true,
      offlineLaunch: true,
      serviceWorkerControlled: true,
      persistentStorageRoundTrip: true,
      controllerEnumerated: true,
      fullscreenAvailable: true,
      audioOutputAvailable: true,
      lifecycleResumePassed: true,
      wasmAvailable: true,
      webgl2Available: true,
      readyScreenshotCaptured: true,
      coldLaunchMilliseconds: 1200,
      performance,
    },
    capabilityGaps: [],
    artifactHashes: {
      screenshotSha256: hash,
      capabilityReportSha256: hash,
      offlineReportSha256: hash,
      storageReportSha256: hash,
      controllerReportSha256: hash,
      lifecycleReportSha256: hash,
      performanceReportSha256: hash,
    },
  };
}

describe("Linux handheld evidence builder", () => {
  it("derives bounded performance from the target profile", () => {
    expect(evaluateLinuxHandheldPerformance([99, 10, 20, 30], target, 60)).toEqual({
      captureSeconds: 60,
      warmupFrames: 1,
      requiredSampleFrames: 3,
      observedSampleFrames: 3,
      droppedFrameThresholdMilliseconds: 25,
      startupMillisecondsMax: 4000,
      p95FrameMillisecondsMax: 25,
      droppedFrameRatioMax: 0.34,
      p95FrameMilliseconds: 30,
      droppedFrameRatio: 0.333333,
      budgetPassed: false,
    });
  });

  it("evaluates every retained post-warmup frame instead of truncating at the minimum", () => {
    const result = evaluateLinuxHandheldPerformance([99, 10, 20, 20, 100], target, 60);
    expect(result.requiredSampleFrames).toBe(3);
    expect(result.observedSampleFrames).toBe(4);
    expect(result.p95FrameMilliseconds).toBe(100);
    expect(result.budgetPassed).toBe(false);
  });

  it("builds a pending-human report and applies a content-bound decision", () => {
    const performance = evaluateLinuxHandheldPerformance([99, 10, 20, 24], target, 60);
    const report = buildPendingLinuxHandheldReport(input(performance));
    expect(report.status).toBe("pending-human");
    const pendingBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    const pendingHash = createHash("sha256").update(pendingBytes).digest("hex");
    const decision = {
      schemaVersion: LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION,
      subjectReportSha256: pendingHash,
      reviewerId: "handheld-reviewer",
      reviewedAt: "2026-07-17T01:00:00.000Z",
      checks: {
        audioOutput: "passed",
        controllerGameplay: "passed",
        suspendResume: "passed",
        sustainedGameplayQuality: "passed",
      },
    } as const;
    const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
    const decisionHash = createHash("sha256").update(decisionBytes).digest("hex");
    const finalized = applyLinuxHandheldManualDecision(report, pendingHash, decision, decisionHash);
    expect(finalized.status).toBe("passed");
    expect(() => verifyLinuxHandheldManualDecisionBinding(
      finalized,
      pendingBytes,
      report,
      decisionBytes,
      decision,
    )).not.toThrow();
    expect(() => verifyLinuxHandheldManualDecisionBinding(
      { ...finalized, manualReview: { ...finalized.manualReview, reviewerId: "forged-reviewer" } },
      pendingBytes,
      report,
      decisionBytes,
      decision,
    )).toThrow(/does not exactly match/);
    expect(() => verifyLinuxHandheldManualDecisionBinding(
      finalized,
      pendingBytes,
      report,
      Buffer.from("tampered-decision"),
      decision,
    )).toThrow(/does not exactly match/);
    expect(() => applyLinuxHandheldManualDecision(report, "b".repeat(64), {
      schemaVersion: LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION,
      subjectReportSha256: hash,
      reviewerId: "handheld-reviewer",
      reviewedAt: "2026-07-17T01:00:00.000Z",
      checks: {
        audioOutput: "passed",
        controllerGameplay: "passed",
        suspendResume: "passed",
        sustainedGameplayQuality: "passed",
      },
    }, hash)).toThrow(/exact pending report bytes/);
  });
});
