import { describe, expect, it } from "vitest";
import {
  ANDROID_DEVICE_ARTIFACT_FILES,
  androidNetworkRestoreCommands,
  androidNetworkStateIsOffline,
  applyAndroidDeviceManualDecision,
  buildPendingAndroidDeviceReport,
  evaluateAndroidPerformance,
  instrumentationPassed,
  orientationEvidencePassed,
  parseAndroidFrameDurationCsv,
  parseColdLaunchMilliseconds,
  parseAndroidNetworkState,
  parseConnectedAndroidDevices,
  parsePackageVersion,
  parseGfxFrameDurationsMilliseconds,
  parsePhysicalDensity,
  parsePhysicalPixels,
  pngDimensions,
  sha256,
  verifyAndroidDeviceEvidenceBindings,
  verifyAndroidApkWebAssets,
  verifyAndroidDeviceManualDecisionBinding,
} from "./android-device-capture.js";
import type {
  AndroidPhysicalDeviceValidationV2,
  AndroidTargetProfileV1,
  AndroidWebLineageV1,
} from "@aico8/contracts";

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

function storedZip(files: Readonly<Record<string, Uint8Array>>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const bytes = Buffer.from(value);
    const local = Buffer.alloc(30 + nameBytes.length + bytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    bytes.copy(local, 30 + nameBytes.length);
    locals.push(local);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(localOffset, 42);
    nameBytes.copy(central, 46);
    centrals.push(central);
    localOffset += local.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

describe("Android physical-device capture helpers", () => {
  it("requires one explicitly connected adb device", () => {
    const devices = parseConnectedAndroidDevices(
      "List of devices attached\nABC123\tdevice product:odin model:Handheld transport_id:1\noffline\toffline\n",
    );
    expect(devices).toEqual([{ serial: "ABC123", attributes: { product: "odin", model: "Handheld", transport_id: "1" } }]);
  });

  it("requires a proven offline triad and restores the exact initial network state", () => {
    const initial = parseAndroidNetworkState({ airplaneMode: "0\n", wifi: "1\n", mobileData: "0\n" });
    expect(androidNetworkStateIsOffline(initial)).toBe(false);
    expect(androidNetworkStateIsOffline({ airplaneMode: 1, wifi: 0, mobileData: 0 })).toBe(true);
    expect(androidNetworkRestoreCommands(initial)).toEqual([
      ["shell", "cmd", "connectivity", "airplane-mode", "disable"],
      ["shell", "svc", "wifi", "enable"],
      ["shell", "svc", "data", "disable"],
    ]);
    expect(() => parseAndroidNetworkState({ airplaneMode: "null", wifi: "1", mobileData: "0" }))
      .toThrow(/airplane mode/);
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

  it("parses retained emulator frame-duration CSV fail-closed", () => {
    expect(parseAndroidFrameDurationCsv("duration_milliseconds\n16.7\n18\n")).toEqual([16.7, 18]);
    expect(() => parseAndroidFrameDurationCsv("wrong_header\n16.7\n")).toThrow(/header/);
    expect(() => parseAndroidFrameDurationCsv("duration_milliseconds\nNaN\n")).toThrow(/duration/);
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

    const pendingBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    const reportHash = sha256(pendingBytes);
    const decision = {
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
    } as const;
    const decisionBytes = Buffer.from(`${JSON.stringify(decision, null, 2)}\n`);
    const finalized = applyAndroidDeviceManualDecision(
      report,
      reportHash,
      decision,
      sha256(decisionBytes),
    );
    expect(finalized.status).toBe("passed");
    expect(finalized.manualReview.decisionSha256).toBe(sha256(decisionBytes));
    expect(() => verifyAndroidDeviceManualDecisionBinding(
      finalized,
      pendingBytes,
      report,
      decisionBytes,
      decision,
    )).not.toThrow();
    expect(() => verifyAndroidDeviceManualDecisionBinding(
      { ...finalized, manualReview: { ...finalized.manualReview, reviewerId: "forged-reviewer" } },
      pendingBytes,
      report,
      decisionBytes,
      decision,
    )).toThrow(/does not exactly match/);
    expect(() => verifyAndroidDeviceManualDecisionBinding(
      finalized,
      pendingBytes,
      report,
      Buffer.from("tampered-decision"),
      decision,
    )).toThrow(/does not exactly match/);
  });

  it("recomputes APK, lineage, target-profile, and retained artifact bindings offline", () => {
    const targetBytes = Buffer.from(`${JSON.stringify(targetProfile, null, 2)}\n`);
    const indexBytes = Buffer.from("<!doctype html><title>lineage-bound</title>");
    const boundLineage = {
      ...lineage,
      targetProfile: { id: targetProfile.id, sha256: sha256(targetBytes) },
      webAssets: {
        ...lineage.webAssets,
        artifactCount: 1,
        unpackedBytes: indexBytes.length,
        files: [{ path: "index.html", bytes: indexBytes.length, sha256: sha256(indexBytes) }],
      },
    };
    const lineageBytes = Buffer.from(`${JSON.stringify(boundLineage, null, 2)}\n`);
    const apkBytes = storedZip({
      "assets/public/index.html": indexBytes,
      "assets/public/cordova.js": Buffer.from("generated shim"),
      "AndroidManifest.xml": Buffer.from("binary manifest placeholder"),
    });
    const artifactBytes = Object.fromEntries(
      Object.keys(ANDROID_DEVICE_ARTIFACT_FILES).map((field) => [field, Buffer.from(`evidence:${field}`)]),
    ) as unknown as Record<keyof typeof ANDROID_DEVICE_ARTIFACT_FILES, Uint8Array>;
    const report = buildPendingAndroidDeviceReport({
      capturedAt: "2026-07-17T00:00:00.000Z",
      lineage: boundLineage,
      lineageSha256: sha256(lineageBytes),
      apkSha256: sha256(apkBytes),
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
      artifactHashes: Object.fromEntries(
        Object.entries(artifactBytes).map(([field, bytes]) => [field, sha256(bytes)]),
      ) as AndroidPhysicalDeviceValidationV2["artifacts"],
    });
    const verify = (apk: Uint8Array, artifacts = artifactBytes) => verifyAndroidDeviceEvidenceBindings(
      report,
      apk,
      lineageBytes,
      boundLineage,
      targetBytes,
      targetProfile,
      artifacts,
    );
    expect(() => verify(apkBytes)).not.toThrow();
    const unrelatedApk = storedZip({ "assets/public/index.html": Buffer.from("unrelated") });
    expect(() => verify(unrelatedApk)).toThrow(/APK bytes/);
    expect(() => verifyAndroidApkWebAssets(unrelatedApk, boundLineage)).toThrow(/index\.html/);
    expect(() => verifyAndroidApkWebAssets(
      storedZip({
        "assets/public/index.html": indexBytes,
        "assets/public/undeclared.js": Buffer.from("surprise"),
      }),
      boundLineage,
    )).toThrow(/count|undeclared/);
    expect(() => verifyAndroidDeviceEvidenceBindings(
      report,
      apkBytes,
      Buffer.from("different-lineage"),
      boundLineage,
      targetBytes,
      targetProfile,
      artifactBytes,
    )).toThrow(/lineage bytes/);
    expect(() => verifyAndroidDeviceEvidenceBindings(
      report,
      apkBytes,
      lineageBytes,
      boundLineage,
      Buffer.from("different-target-profile"),
      targetProfile,
      artifactBytes,
    )).toThrow(/target-profile bytes/);
    expect(() => verify(apkBytes, { ...artifactBytes, logcatSha256: Buffer.from("tampered-logcat") }))
      .toThrow(/logcat\.txt/);
  });
});
