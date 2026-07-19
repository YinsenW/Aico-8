#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  validateLinuxHandheldSimulatorValidation,
  validateTargetProfile,
  type LinuxHandheldSimulatorValidationV1,
} from "../packages/contracts/src/index.ts";
import { inventoryWebAssets, webAssetTreeSha256 } from "../apps/mobile/src/web-release-inventory.ts";

const values = process.argv.slice(2).filter((value) => value !== "--");
if (values.length !== 4) {
  throw new Error(
    "Usage: pnpm verify:linux-web-simulator -- "
      + "<linux-handheld-simulator.json> <web-release-directory> <linux-target-profile.json> <evidence-directory>",
  );
}
const [reportValue, productValue, targetValue, evidenceValue] = values as [string, string, string, string];
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const reportBytes = await fs.readFile(path.resolve(reportValue));
const reportUnknown: unknown = JSON.parse(reportBytes.toString("utf8"));
const validation = validateLinuxHandheldSimulatorValidation(reportUnknown);
if (!validation.ok) throw new Error(`Invalid Linux simulator report: ${validation.errors.join("; ")}`);
const report = reportUnknown as LinuxHandheldSimulatorValidationV1;
if (report.status !== "passed") throw new Error("Linux simulator report is not passed");

const productRoot = await fs.realpath(path.resolve(productValue));
const targetBytes = await fs.readFile(path.resolve(targetValue));
const targetUnknown: unknown = JSON.parse(targetBytes.toString("utf8"));
const targetValidation = validateTargetProfile(targetUnknown);
if (!targetValidation.ok || (targetUnknown as { target?: unknown }).target !== "linux-handheld-web") {
  throw new Error(`Invalid Linux target profile: ${targetValidation.errors.join("; ")}`);
}
if (report.subject.targetProfileSha256 !== sha256(targetBytes)) throw new Error("Target-profile bytes differ from the report");
if (report.subject.targetProfileId !== (targetUnknown as { id: string }).id) throw new Error("Target-profile id differs from the report");
const webFiles = await inventoryWebAssets(productRoot);
if (report.subject.webReleaseTreeSha256 !== webAssetTreeSha256(webFiles)) throw new Error("Web asset tree differs from the report");
const assetManifestBytes = await fs.readFile(path.join(productRoot, "asset-manifest.json"));
if (report.subject.assetManifestSha256 !== sha256(assetManifestBytes)) throw new Error("Asset manifest differs from the report");
const assetManifest = JSON.parse(assetManifestBytes.toString("utf8")) as Record<string, { file?: unknown; isEntry?: unknown }>;
const entry = assetManifest["index.html"];
if (!entry || entry.isEntry !== true || typeof entry.file !== "string") throw new Error("Asset manifest has no index entry");
if (report.subject.entryModuleSha256 !== sha256(await fs.readFile(path.join(productRoot, entry.file)))) {
  throw new Error("Entry module differs from the report");
}

const evidenceRoot = path.resolve(evidenceValue);
const artifactFiles: Record<keyof LinuxHandheldSimulatorValidationV1["artifacts"], string> = {
  screenshotSha256: "ready.png",
  capabilityReportSha256: "capabilities.json",
  offlineReportSha256: "offline.json",
  storageReportSha256: "storage.json",
  controllerReportSha256: "controller.json",
  lifecycleReportSha256: "lifecycle.json",
  performanceReportSha256: "performance.json",
};
for (const [field, filename] of Object.entries(artifactFiles) as [keyof typeof artifactFiles, string][]) {
  const actual = sha256(await fs.readFile(path.join(evidenceRoot, filename)));
  if (report.artifacts[field] !== actual) throw new Error(`${filename} differs from report artifact hash ${field}`);
}
const screenshot = await fs.readFile(path.join(evidenceRoot, "ready.png"));
if (screenshot.length < 24 || screenshot.toString("hex", 0, 8) !== "89504e470d0a1a0a"
  || screenshot.readUInt32BE(16) !== 1024 || screenshot.readUInt32BE(20) !== 1024) {
  throw new Error("Ready screenshot must be a 1024x1024 PNG");
}
const [capabilities, offline, storage, controller, lifecycle, performance] = await Promise.all(
  ["capabilities.json", "offline.json", "storage.json", "controller.json", "lifecycle.json", "performance.json"]
    .map(async (filename) => JSON.parse(await fs.readFile(path.join(evidenceRoot, filename), "utf8")) as any),
);
if (capabilities.innerWidth !== 1024 || capabilities.innerHeight !== 1024
  || capabilities.serviceWorkerControlled !== true || capabilities.fullscreenApiAvailable !== true
  || capabilities.audioUnlockPassed !== true || capabilities.wasmAvailable !== true
  || capabilities.displayMode !== "xvfb-windowed"
  || capabilities.webgl2Probe?.available !== true
  || capabilities.webgl2Probe?.innerWidth !== 1024 || capabilities.webgl2Probe?.innerHeight !== 1024
  || capabilities.webgl2Probe?.displayMode !== "xvfb-windowed"
  || capabilities.webgl2Probe?.browser !== capabilities.browser
  || capabilities.webgl2Probe?.renderer !== report.simulator.graphicsRenderer
  || !/swiftshader/i.test(capabilities.webgl2Probe?.renderer)) {
  throw new Error("Capability report does not prove the named Linux Xvfb boundary");
}
if (offline.passed !== true || storage.passed !== true || controller.passed !== true || lifecycle.passed !== true) {
  throw new Error("One or more retained Linux behavior reports did not pass");
}
if (JSON.stringify(performance) !== JSON.stringify({
  requestAnimationFrameCallbacks: performance.requestAnimationFrameCallbacks,
  ...report.automatedChecks.performance,
})) {
  throw new Error("Performance report differs from the bound report values");
}
process.stdout.write(
  `Linux 1024-square simulator evidence independently verified for ${report.simulator.browser.name}/`
    + `${report.simulator.browser.version}.\n`,
);
