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
  checks: { manifest: true, checksums: true, notices: true, accessibility: true, packageBudgets: true, runtimeBudgets: true },
  status: "passed",
};

describe("release contracts", () => {
  it("accepts the canonical packaged Web target profile", () => {
    const canonicalProfile = JSON.parse(fs.readFileSync(
      new URL("../../../apps/web/public/target-profile.json", import.meta.url),
      "utf8",
    ));
    expect(validateTargetProfile(canonicalProfile)).toEqual({ ok: true, errors: [] });
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
