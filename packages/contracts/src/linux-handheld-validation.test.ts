import Ajv2020 from "ajv/dist/2020.js";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LINUX_HANDHELD_MANUAL_DECISION_SCHEMA_VERSION,
  LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION,
  expectedLinuxHandheldValidationStatus,
  validateLinuxHandheldManualDecision,
  validateLinuxHandheldValidation,
  type LinuxHandheldValidationV1,
} from "./linux-handheld-validation.js";

const hash = "a".repeat(64);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: false });
const validateReportSchema = ajv.compile(JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/linux-handheld-validation-v1.schema.json", import.meta.url),
  "utf8",
)));
const validateDecisionSchema = ajv.compile(JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/linux-handheld-manual-decision-v1.schema.json", import.meta.url),
  "utf8",
)));
const validateTargetSchema = ajv.compile(JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/target-profile-v1.schema.json", import.meta.url),
  "utf8",
)));

function report(): LinuxHandheldValidationV1 {
  return {
    schemaVersion: LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION,
    capturedAt: "2026-07-17T00:00:00.000Z",
    subject: {
      webReleaseTreeSha256: hash,
      releaseManifestSha256: hash,
      targetProfileId: "linux-handheld-web-private-research-v1",
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
      sessionType: "wayland",
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
    capabilityGaps: [],
    artifacts: {
      screenshotSha256: hash,
      capabilityReportSha256: hash,
      offlineReportSha256: hash,
      storageReportSha256: hash,
      controllerReportSha256: hash,
      lifecycleReportSha256: hash,
      performanceReportSha256: hash,
    },
    manualReview: {
      decisionSha256: null,
      reviewerId: null,
      reviewedAt: null,
      checks: {
        audioOutput: "pending",
        controllerGameplay: "pending",
        suspendResume: "pending",
        sustainedGameplayQuality: "pending",
      },
    },
    status: "pending-human",
  };
}

describe("Linux handheld Web validation", () => {
  it("accepts a byte-bound browser-first report but keeps it pending for human play", () => {
    const value = structuredClone(report()) as any;
    expect(expectedLinuxHandheldValidationStatus(value)).toBe("pending-human");
    expect(validateLinuxHandheldValidation(value)).toEqual({ ok: true, errors: [] });
    expect(validateReportSchema(value), JSON.stringify(validateReportSchema.errors)).toBe(true);
  });

  it("allows a thin-shell proposal only when every failed browser capability has evidence", () => {
    const value = structuredClone(report()) as any;
    value.automatedChecks.fullscreenAvailable = false;
    value.capabilityGaps = [{
      capability: "fullscreen",
      symptom: "Browser cannot enter borderless fullscreen on the named compositor.",
      evidenceSha256: hash,
      remediation: "thin-web-shell",
    }];
    value.status = "browser-gap";
    expect(validateLinuxHandheldValidation(value)).toEqual({ ok: true, errors: [] });

    value.capabilityGaps = [];
    expect(validateLinuxHandheldValidation(value).errors.join("\n"))
      .toMatch(/exactly cover failed required browser capabilities/);
  });

  it("rejects invented gaps and never turns a hard lineage failure into a shell request", () => {
    const invented = structuredClone(report()) as any;
    invented.capabilityGaps = [{
      capability: "controller",
      symptom: "Unmeasured",
      evidenceSha256: hash,
      remediation: "thin-web-shell",
    }];
    invented.status = "browser-gap";
    expect(validateLinuxHandheldValidation(invented).errors.join("\n"))
      .toMatch(/exactly cover failed required browser capabilities/);

    const drifted = structuredClone(report()) as any;
    drifted.automatedChecks.exactWebArtifact = false;
    drifted.status = "browser-gap";
    expect(expectedLinuxHandheldValidationStatus(drifted)).toBe("failed");
    expect(validateLinuxHandheldValidation(drifted).errors.join("\n"))
      .toMatch(/derived status failed/);
  });

  it("requires exact performance derivation and the full 60-second sample window", () => {
    const value = structuredClone(report()) as any;
    value.automatedChecks.performance.captureSeconds = 30;
    value.automatedChecks.performance.observedSampleFrames = 179;
    expect(validateLinuxHandheldValidation(value).errors.join("\n"))
      .toMatch(/captureSeconds|budgetPassed/);
  });

  it("accepts only a complete content-bound manual decision", () => {
    const decision = {
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
    };
    expect(validateLinuxHandheldManualDecision(decision)).toEqual({ ok: true, errors: [] });
    expect(validateDecisionSchema(decision), JSON.stringify(validateDecisionSchema.errors)).toBe(true);
    const target = JSON.parse(fs.readFileSync(
      new URL("../../../apps/mobile/target-profile.linux.json", import.meta.url),
      "utf8",
    ));
    expect(validateTargetSchema(target), JSON.stringify(validateTargetSchema.errors)).toBe(true);
    const invalid = structuredClone(decision);
    invalid.checks.audioOutput = "pending";
    expect(validateLinuxHandheldManualDecision(invalid).errors.join("\n"))
      .toMatch(/passed or failed/);
  });
});
