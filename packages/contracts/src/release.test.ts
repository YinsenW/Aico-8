import { describe, expect, it } from "vitest";
import fs from "node:fs";

import {
  RELEASE_MANIFEST_SCHEMA_VERSION,
  RELEASE_VALIDATION_SCHEMA_VERSION,
  TARGET_PROFILE_SCHEMA_VERSION,
  validateReleaseManifest,
  validateReleaseValidation,
  validateTargetProfile,
} from "./release.js";

const hash = "a".repeat(64);
const targetProfile = {
  schemaVersion: TARGET_PROFILE_SCHEMA_VERSION,
  id: "web-pwa-private-research-v1",
  target: "web-pwa",
  outputProfile: "hd-1024-square",
  measurementEnvironment: {
    class: "local-http-active-browser",
    viewport: { width: 1280, height: 720 },
    warmupFrames: 30,
    sampleFrames: 180,
    droppedFrameThresholdMilliseconds: 25,
  },
  layoutProfiles: [
    { id: "phone-portrait-390x844", class: "phone-portrait", viewport: { width: 390, height: 844 }, minGameFrameCssPixels: 360, minTouchTargetCssPixels: 44 },
    { id: "square-handheld-1024x1024", class: "square-handheld", viewport: { width: 1024, height: 1024 }, minGameFrameCssPixels: 800, minTouchTargetCssPixels: 44 },
    { id: "android-handheld-landscape-1280x720", class: "android-handheld-landscape", viewport: { width: 1280, height: 720 }, minGameFrameCssPixels: 500, minTouchTargetCssPixels: 44 },
    { id: "wide-web-1440x900", class: "wide-web", viewport: { width: 1440, height: 900 }, minGameFrameCssPixels: 680, minTouchTargetCssPixels: 44 },
  ],
  budgets: {
    artifactCountMax: 60,
    unpackedBytesMax: 3_000_000,
    largestArtifactBytesMax: 750_000,
    startupMillisecondsMax: 4_000,
    p95FrameMillisecondsMax: 25,
    droppedFrameRatioMax: 0.02,
  },
};

const releaseManifest = {
  schema_version: RELEASE_MANIFEST_SCHEMA_VERSION,
  game: { id: "dust-bunny-private-research", title: "Dust Bunny", author: "Adam Atomic" },
  target: "web-pwa",
  presentation: "dust-bunny-hd",
  output_profile: "hd-1024-square",
  target_profile: { id: targetProfile.id, sha256: hash },
  rights: { profile: "private-research-and-testing-only", sourceLicense: "CC-BY-NC-SA-4.0", sourceUrl: "https://example.test" },
  audio: "original-silent-cart",
  identities: { visual_runtime_schema: "aico8.visual-runtime-identity.v1", visual_runtime_sha256: hash },
  measurements: { artifact_count: 2, unpacked_bytes: 112, largest_artifact_bytes: 100, release_manifest_bytes: 100 },
  inputs: [{ path: "source.rom", sha256: hash, bytes: 12 }],
  artifacts: [{ path: "index.html", sha256: hash, bytes: 12 }],
};

const releaseValidation = {
  schemaVersion: RELEASE_VALIDATION_SCHEMA_VERSION,
  subject: { gameId: releaseManifest.game.id, target: "web-pwa", visualRuntimeSha256: hash },
  targetProfile: { id: targetProfile.id, sha256: hash },
  environment: { class: "local-http-active-browser", userAgentFamily: "Chromium", viewport: { width: 1280, height: 720 } },
  package: { artifactCount: 2, unpackedBytes: 112, largestArtifactBytes: 100 },
  runtime: { startupMilliseconds: 300, sampleFrames: 180, p95FrameMilliseconds: 17, maxFrameMilliseconds: 22, droppedFrameRatio: 0 },
  layouts: targetProfile.layoutProfiles.map((profile) => ({
    id: profile.id,
    class: profile.class,
    viewport: profile.viewport,
    document: { scrollWidth: profile.viewport.width, scrollHeight: profile.viewport.height },
    gameFrame: { width: profile.minGameFrameCssPixels, height: profile.minGameFrameCssPixels },
    minimumTouchTarget: { width: profile.minTouchTargetCssPixels, height: profile.minTouchTargetCssPixels },
    checks: {
      horizontalOverflowAbsent: true,
      verticalOverflowAbsent: true,
      textClippingAbsent: true,
      controlsInsideGameFrame: true,
      fontsLoaded: true,
      safeAreaContract: true,
    },
    screenshotSha256: hash,
  })),
  checks: { manifest: true, checksums: true, notices: true, accessibility: true, packageBudgets: true, runtimeBudgets: true, layoutProfiles: true },
  status: "passed",
};

const androidTargetProfile = {
  ...structuredClone(targetProfile),
  id: "android-webview-private-research-v1",
  target: "android-webview",
  measurementEnvironment: {
    ...targetProfile.measurementEnvironment,
    class: "android-instrumented-device",
    viewport: { width: 1024, height: 1024 },
  },
  layoutProfiles: structuredClone(targetProfile.layoutProfiles.slice(0, 3)),
  android: {
    applicationId: "dev.aico8.research",
    capacitorVersion: "8.4.2",
    minSdk: 24,
    targetSdk: 36,
    compileSdk: 36,
    orientationPolicy: "user",
    webArtifactPolicy: "byte-identical-recursive-copy",
    signingPolicy: "external-release-key",
    requiredCapabilities: [
      "audio-focus", "controller", "lifecycle", "offline-assets",
      "orientation", "persistent-storage", "touch",
    ],
  },
};

const linuxTargetProfile = {
  schemaVersion: TARGET_PROFILE_SCHEMA_VERSION,
  id: "linux-handheld-web-private-research-v1",
  target: "linux-handheld-web",
  outputProfile: "hd-1024-square",
  measurementEnvironment: {
    class: "linux-handheld-browser",
    viewport: { width: 1280, height: 800 },
    warmupFrames: 30,
    sampleFrames: 180,
    droppedFrameThresholdMilliseconds: 25,
  },
  layoutProfiles: [
    { id: "square-handheld-1024x1024", class: "square-handheld", viewport: { width: 1024, height: 1024 }, minGameFrameCssPixels: 800, minTouchTargetCssPixels: 44 },
    { id: "linux-handheld-landscape-1280x800", class: "linux-handheld-landscape", viewport: { width: 1280, height: 800 }, minGameFrameCssPixels: 560, minTouchTargetCssPixels: 44 },
  ],
  budgets: structuredClone(targetProfile.budgets),
  linux: {
    deliveryMode: "browser-pwa",
    webArtifactPolicy: "byte-identical-web-release",
    shellPolicy: "measured-capability-gap-only",
    requiredCapabilities: [
      "audio-output", "controller", "fullscreen", "offline-assets",
      "persistent-storage", "wasm", "webgl2",
    ],
  },
};

describe("release contracts", () => {
  it("accepts the canonical packaged Web target profile", () => {
    const canonicalProfile = JSON.parse(fs.readFileSync(
      new URL("../../../apps/web/public/target-profile.json", import.meta.url),
      "utf8",
    ));
    expect(validateTargetProfile(canonicalProfile)).toEqual({ ok: true, errors: [] });
  });

  it("accepts the canonical Android WebView profile but keeps browser validation target-specific", () => {
    const canonicalProfile = JSON.parse(fs.readFileSync(
      new URL("../../../apps/mobile/target-profile.json", import.meta.url),
      "utf8",
    ));
    expect(validateTargetProfile(canonicalProfile)).toEqual({ ok: true, errors: [] });
    expect(validateTargetProfile(androidTargetProfile)).toEqual({ ok: true, errors: [] });
    expect(validateReleaseValidation(releaseValidation, androidTargetProfile).errors.join("\n"))
      .toMatch(/browser release validation requires a web-pwa/);
  });

  it("accepts the canonical Linux browser-first profile without creating a second Web artifact", () => {
    const canonicalProfile = JSON.parse(fs.readFileSync(
      new URL("../../../apps/mobile/target-profile.linux.json", import.meta.url),
      "utf8",
    ));
    expect(validateTargetProfile(canonicalProfile)).toEqual({ ok: true, errors: [] });
    expect(validateTargetProfile(linuxTargetProfile)).toEqual({ ok: true, errors: [] });
    expect(validateReleaseValidation(releaseValidation, linuxTargetProfile).errors.join("\n"))
      .toMatch(/browser release validation requires a web-pwa/);
  });

  it("rejects Linux profiles that rewrite the Web release or pre-authorize a shell", () => {
    const mutated = structuredClone(linuxTargetProfile);
    mutated.linux.webArtifactPolicy = "linux-rebundle";
    mutated.linux.shellPolicy = "shell-first";
    mutated.linux.requiredCapabilities.splice(0, 1);
    const result = validateTargetProfile(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/byte-identical-web-release/);
    expect(result.errors.join("\n")).toMatch(/measured-capability-gap-only/);
    expect(result.errors.join("\n")).toMatch(/audio-output/);
  });

  it("rejects Android profiles that weaken byte lineage, platform support, or host capabilities", () => {
    const mutated = structuredClone(androidTargetProfile);
    mutated.android.minSdk = 23;
    mutated.android.webArtifactPolicy = "rewrite-assets";
    mutated.android.requiredCapabilities.splice(0, 1);
    const result = validateTargetProfile(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/minSdk/);
    expect(result.errors.join("\n")).toMatch(/byte-identical-recursive-copy/);
    expect(result.errors.join("\n")).toMatch(/audio-focus/);
  });

  it("accepts a bounded Web target, release manifest, and technical validation report", () => {
    expect(validateTargetProfile(targetProfile)).toEqual({ ok: true, errors: [] });
    expect(validateReleaseManifest(releaseManifest)).toEqual({ ok: true, errors: [] });
    expect(validateReleaseValidation(releaseValidation, targetProfile)).toEqual({ ok: true, errors: [] });
  });

  it("rejects a passed report that exceeds a target budget", () => {
    const mutated = structuredClone(releaseValidation);
    mutated.runtime.p95FrameMilliseconds = 26;
    const result = validateReleaseValidation(mutated, targetProfile);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/p95FrameMilliseconds.*budget/);
  });

  it("rejects missing layout classes, overflow, undersized game frames, and failed safe areas", () => {
    const invalidProfile = structuredClone(targetProfile);
    invalidProfile.layoutProfiles[1]!.class = "phone-portrait";
    expect(validateTargetProfile(invalidProfile).errors.join("\n")).toMatch(/duplicates|include square-handheld/);

    const mutated = structuredClone(releaseValidation);
    mutated.layouts[2]!.document.scrollHeight = 721;
    mutated.layouts[2]!.gameFrame.width = 499;
    mutated.layouts[2]!.checks.safeAreaContract = false;
    const result = validateReleaseValidation(mutated, targetProfile);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/vertical overflow/);
    expect(result.errors.join("\n")).toMatch(/gameFrame.width.*minimum/);
    expect(result.errors.join("\n")).toMatch(/safeAreaContract must pass/);
  });

  it.each([
    { width: 900, height: 900 },
    { width: 1024, height: 900 },
  ])("rejects a non-1024 square-handheld viewport: $width x $height", (viewport) => {
    const mutated = structuredClone(targetProfile);
    mutated.layoutProfiles[1]!.viewport = viewport;
    expect(validateTargetProfile(mutated).errors.join("\n"))
      .toMatch(/viewport must equal 1024x1024 for square-handheld/);
  });

  it("rejects inconsistent release measurements and unsafe artifacts", () => {
    const mutated = structuredClone(releaseManifest);
    mutated.measurements.unpacked_bytes = 111;
    mutated.artifacts[0]!.path = "../index.html";
    const result = validateReleaseManifest(mutated);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/artifact path|unpacked_bytes/);
  });

  it("fails closed for an invalid target profile instead of dereferencing it", () => {
    expect(validateReleaseValidation(releaseValidation, {})).toEqual({
      ok: false,
      errors: expect.arrayContaining([expect.stringMatching(/schemaVersion.*required/)]),
    });
  });
});
