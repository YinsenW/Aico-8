import { describe, expect, it } from "vitest";
import {
  applyAndroidDeviceManualDecision,
  buildPendingAndroidDeviceReport,
  evaluateAndroidPerformance,
  instrumentationPassed,
  orientationEvidencePassed,
  parseColdLaunchMilliseconds,
  parseConnectedAndroidDevices,
  parsePackageVersion,
  parseGfxFrameDurationsMilliseconds,
  parsePhysicalDensity,
  parsePhysicalPixels,
  pngDimensions,
  sha256,
} from "./android-device-capture.js";
import type { AndroidTargetProfileV1, AndroidWebLineageV1 } from "@aico8/contracts";

const hash = "a".repeat(64);
const lineage = {
  schemaVersion: "aico8.android-web-lineage.v1",
  generatedBy: "aico8-mobile-assembler-v1",
  targetProfile: { id: "android-webview-private-research-v1", sha256: hash },
  webRelease: {
    releaseManifestSha256: hash,
    visualRuntimeSha256: hash,
    sourceTargetProfileId: "web-pwa-private-research-v1",
    sourceTargetProfileSha256: hash,
  },
  webAssets: { policy: "byte-identical-recursive-copy", treeSha256: hash, artifactCount: 1, unpackedBytes: 1, files: [] },
  host: {
    applicationId: "dev.aico8.research",
    capacitorVersion: "8.4.2",
    minSdk: 24,
    targetSdk: 36,
    compileSdk: 36,
    signingPolicy: "external-release-key",
    allowedGeneratedAssetPaths: ["cordova.js", "cordova_plugins.js"],
  },
} as AndroidWebLineageV1;
const targetProfile = {
  schemaVersion: "aico8.target-profile.v1",
  id: "android-webview-private-research-v1",
  target: "android-webview",
  outputProfile: "hd-1024-square",
  measurementEnvironment: {
    class: "android-instrumented-device",
    viewport: { width: 1024, height: 1024 },
    warmupFrames: 1,
    sampleFrames: 3,
    droppedFrameThresholdMilliseconds: 25,
  },
  layoutProfiles: [
    { id: "square-handheld-1024x1024", class: "square-handheld", viewport: { width: 1024, height: 1024 }, minGameFrameCssPixels: 800, minTouchTargetCssPixels: 44 },
  ],
  budgets: {
    artifactCountMax: 200,
    unpackedBytesMax: 30_000_000,
    largestArtifactBytesMax: 20_000_000,
    startupMillisecondsMax: 4_000,
    p95FrameMillisecondsMax: 25,
    droppedFrameRatioMax: 0.34,
  },
  android: {
    applicationId: "dev.aico8.research",
    capacitorVersion: "8.4.2",
    minSdk: 24,
    targetSdk: 36,
    compileSdk: 36,
    orientationPolicy: "user",
    webArtifactPolicy: "byte-identical-recursive-copy",
    signingPolicy: "external-release-key",
    requiredCapabilities: ["audio-focus", "controller", "lifecycle", "offline-assets", "orientation", "persistent-storage", "touch"],
  },
} as AndroidTargetProfileV1;

describe("Android physical-device capture helpers", () => {
  it("requires one explicitly connected adb device", () => {
    const devices = parseConnectedAndroidDevices(
      "List of devices attached\nABC123\tdevice product:odin model:Handheld transport_id:1\noffline\toffline\n",
    );
    expect(devices).toEqual([{ serial: "ABC123", attributes: { product: "odin", model: "Handheld", transport_id: "1" } }]);
  });

  it("parses physical display, WebView, launch, instrumentation, and PNG evidence", () => {
    expect(parsePhysicalPixels("Physical size: 1024x1024\nOverride size: 800x800")).toEqual({ width: 1024, height: 1024 });
    expect(parsePhysicalDensity("Physical density: 320\nOverride density: 240")).toBe(320);
    expect(parsePackageVersion(" versionCode=636721900\n versionName=124.0.6367.219\n")).toEqual({ versionName: "124.0.6367.219", versionCode: "636721900" });
    expect(parseColdLaunchMilliseconds("Status: ok\nTotalTime: 1894\n")).toBe(1894);
    expect(instrumentationPassed("Time: 1\nOK (1 test)\n", 0)).toBe(true);
    expect(orientationEvidencePassed(
      '{"schemaVersion":"aico8.android-orientation-evidence.v1","requestedLandscape":true,"requestedPortrait":true,"hostStatePreserved":true}\n',
    )).toBe(true);
    const png = Buffer.alloc(24);
    Buffer.from("89504e470d0a1a0a", "hex").copy(png);
    png.writeUInt32BE(1024, 16);
    png.writeUInt32BE(720, 20);
    expect(pngDimensions(png)).toEqual({ width: 1024, height: 720 });
  });

  it("parses gfxinfo frame rows and enforces the target performance budget", () => {
    const milliseconds = [10, 12, 20, 30];
    const rows = milliseconds.map((duration, index) => {
      const intended = 1_000_000_000 + index * 40_000_000;
      return `0,${intended},${intended + duration * 1_000_000}`;
    });
    const gfxInfo = [
      "---PROFILEDATA---",
      "Flags,IntendedVsync,FrameCompleted",
      ...rows,
      "---PROFILEDATA---",
    ].join("\n");
    expect(parseGfxFrameDurationsMilliseconds(gfxInfo)).toEqual(milliseconds);
    expect(evaluateAndroidPerformance(milliseconds, targetProfile, 60)).toEqual({
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

  it("builds pending-human evidence and hashes the private serial", () => {
    const report = buildPendingAndroidDeviceReport({
      capturedAt: "2026-07-17T00:00:00.000Z",
      lineage,
      lineageSha256: hash,
      apkSha256: hash,
      profileId: "named-handheld",
      serial: "private-serial",
      manufacturer: "Example",
      model: "Handheld",
      product: "handheld",
      buildFingerprint: "example/build",
      apiLevel: 35,
      abi: "arm64-v8a",
      emulator: false,
      physicalPixels: { width: 1024, height: 1024 },
      densityDpi: 320,
      webView: { packageName: "com.google.android.webview", versionName: "124", versionCode: "1" },
      controllerName: "Named Controller",
      automatedChecks: {
        singleAuthorizedDevice: true,
        physicalDevice: true,
        apkInstalled: true,
        offlineMode: true,
        instrumentationPassed: true,
        orientationChangePassed: true,
        readyScreenshotCaptured: true,
        controllerEnumerated: true,
        coldLaunchMilliseconds: 1000,
        performance: {
          captureSeconds: 60,
          warmupFrames: 30,
          requiredSampleFrames: 180,
          observedSampleFrames: 180,
          droppedFrameThresholdMilliseconds: 25,
          startupMillisecondsMax: 4000,
          p95FrameMillisecondsMax: 25,
          droppedFrameRatioMax: 0.02,
          p95FrameMilliseconds: 16.7,
          droppedFrameRatio: 0.01,
          budgetPassed: true,
        },
      },
      artifactHashes: {
        screenshotSha256: hash,
        instrumentationSha256: hash,
        orientationSha256: hash,
        logcatSha256: hash,
        inputDevicesSha256: hash,
        gfxInfoSha256: hash,
      },
    });
    expect(report.status).toBe("pending-human");
    expect(report.device.serialSha256).toBe(sha256("private-serial"));
    expect(JSON.stringify(report)).not.toContain("private-serial");

    const reportHash = sha256(`${JSON.stringify(report, null, 2)}\n`);
    const finalized = applyAndroidDeviceManualDecision(
      report,
      reportHash,
      {
        schemaVersion: "aico8.android-device-manual-decision.v1",
        subjectReportSha256: reportHash,
        reviewerId: "human-reviewer",
        reviewedAt: "2026-07-17T01:00:00.000Z",
        checks: {
          audioFocusInterruptionRecovery: "passed",
          controllerGameplay: "passed",
          vendorWebViewGameplay: "passed",
          sustainedGameplayPerformance: "passed",
        },
      },
      hash,
    );
    expect(finalized.status).toBe("passed");
    expect(finalized.manualReview.decisionSha256).toBe(hash);
  });
});
