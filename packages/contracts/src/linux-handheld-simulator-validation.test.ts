import Ajv2020 from "ajv/dist/2020.js";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION,
  expectedLinuxHandheldSimulatorStatus,
  validateLinuxHandheldSimulatorValidation,
  type LinuxHandheldSimulatorValidationV1,
} from "./linux-handheld-simulator-validation.js";

const hash = "a".repeat(64);
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: false });
const validateSchema = ajv.compile(JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/linux-handheld-simulator-validation-v1.schema.json", import.meta.url),
  "utf8",
)));

function report(): LinuxHandheldSimulatorValidationV1 {
  return {
    schemaVersion: LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION,
    capturedAt: "2026-07-19T00:00:00.000Z",
    subject: {
      webReleaseTreeSha256: hash,
      assetManifestSha256: hash,
      targetProfileId: "linux-handheld-web-private-research-v1",
      targetProfileSha256: hash,
      entryModuleSha256: hash,
    },
    simulator: {
      profileId: "linux-chromium-1024-square-v1",
      environmentClass: "linux-chromium-square-simulator",
      osName: "Linux",
      osVersion: "24.04",
      kernelVersion: "6.11",
      architecture: "x64",
      sessionType: "x11",
      viewport: { width: 1024, height: 1024 },
      browser: { name: "Chrome", version: "150", engine: "Blink" },
      graphicsRenderer: "ANGLE (Google, Vulkan SwiftShader Device)",
      controllerFixture: "pre-navigation-standard-gamepad",
    },
    automatedChecks: {
      freshBrowserProfile: true,
      exactWebArtifact: true,
      squareViewport: true,
      offlineReload: true,
      serviceWorkerControlled: true,
      persistentStorageRoundTrip: true,
      simulatedControllerInputPassed: true,
      fullscreenApiAvailable: true,
      audioGraphAvailable: true,
      lifecycleFreezeResumePassed: true,
      wasmAvailable: true,
      webgl2Available: true,
      readyScreenshotCaptured: true,
      coldLaunchMilliseconds: 700,
      performance: {
        captureSeconds: 60,
        warmupFrames: 30,
        requiredSampleFrames: 180,
        observedSampleFrames: 3550,
        droppedFrameThresholdMilliseconds: 25,
        startupMillisecondsMax: 4000,
        p95FrameMillisecondsMax: 25,
        droppedFrameRatioMax: 0.02,
        p95FrameMilliseconds: 16.7,
        droppedFrameRatio: 0,
        budgetPassed: true,
      },
    },
    artifacts: {
      screenshotSha256: hash,
      capabilityReportSha256: hash,
      offlineReportSha256: hash,
      storageReportSha256: hash,
      controllerReportSha256: hash,
      lifecycleReportSha256: hash,
      performanceReportSha256: hash,
    },
    status: "passed",
  };
}

describe("Linux square Chromium simulator validation", () => {
  it("derives passed only from the complete automated boundary", () => {
    const value = report();
    expect(expectedLinuxHandheldSimulatorStatus(value)).toBe("passed");
    expect(validateLinuxHandheldSimulatorValidation(value)).toEqual({ ok: true, errors: [] });
    expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
  });

  it("fails closed for missing controller integration, weak performance, or slow startup", () => {
    const controller = structuredClone(report()) as any;
    controller.automatedChecks.simulatedControllerInputPassed = false;
    expect(expectedLinuxHandheldSimulatorStatus(controller)).toBe("failed");
    expect(validateLinuxHandheldSimulatorValidation(controller).errors.join("\n")).toMatch(/derived status failed/);

    const performance = structuredClone(report()) as any;
    performance.automatedChecks.performance.observedSampleFrames = 179;
    performance.automatedChecks.performance.budgetPassed = false;
    performance.status = "failed";
    expect(validateLinuxHandheldSimulatorValidation(performance)).toEqual({ ok: true, errors: [] });

    const startup = structuredClone(report()) as any;
    startup.automatedChecks.coldLaunchMilliseconds = 4001;
    startup.status = "failed";
    expect(validateLinuxHandheldSimulatorValidation(startup)).toEqual({ ok: true, errors: [] });
  });

  it("rejects non-square or mislabeled simulator evidence", () => {
    const value = structuredClone(report()) as any;
    value.simulator.viewport.width = 1280;
    value.simulator.graphicsRenderer = "hardware-renderer";
    value.simulator.controllerFixture = "physical-controller";
    expect(validateLinuxHandheldSimulatorValidation(value).errors.join("\n"))
      .toMatch(/1024x1024|controllerFixture/);
    value.simulator.viewport.width = 1024;
    value.simulator.controllerFixture = "pre-navigation-standard-gamepad";
    value.status = "failed";
    expect(validateLinuxHandheldSimulatorValidation(value)).toEqual({ ok: true, errors: [] });
  });
});
