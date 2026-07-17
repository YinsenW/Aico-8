import {
  validateLinuxHandheldValidation,
  validateReleaseManifest,
  validateTargetProfile,
  type LinuxHandheldTargetProfileV1,
  type LinuxHandheldValidationV1,
} from "@aico8/contracts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { inventoryWebAssets, webAssetTreeSha256 } from "./web-release-inventory.js";

function sha256(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 4) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile verify:linux -- "
      + "<linux-validation.json> <web-release-directory> <linux-target-profile.json> <evidence-directory>",
  );
}
const [reportValue, webReleaseValue, targetValue, evidenceValue] = args as [string, string, string, string];
const reportBytes = fs.readFileSync(path.resolve(reportValue));
const reportUnknown: unknown = JSON.parse(reportBytes.toString("utf8"));
const reportValidation = validateLinuxHandheldValidation(reportUnknown);
if (!reportValidation.ok) throw new Error(`Invalid Linux handheld report: ${reportValidation.errors.join("; ")}`);
const report = reportUnknown as LinuxHandheldValidationV1;

const targetBytes = fs.readFileSync(path.resolve(targetValue));
const targetUnknown: unknown = JSON.parse(targetBytes.toString("utf8"));
const targetValidation = validateTargetProfile(targetUnknown);
if (!targetValidation.ok || (targetUnknown as { target?: unknown }).target !== "linux-handheld-web") {
  throw new Error(`Invalid Linux handheld target profile: ${targetValidation.errors.join("; ")}`);
}
const target = targetUnknown as LinuxHandheldTargetProfileV1;
if (report.subject.targetProfileId !== target.id || report.subject.targetProfileSha256 !== sha256(targetBytes)) {
  throw new Error("Linux report does not bind the exact target-profile bytes");
}

const webRelease = path.resolve(webReleaseValue);
const releaseManifestBytes = fs.readFileSync(path.join(webRelease, "release-manifest.json"));
const releaseUnknown: unknown = JSON.parse(releaseManifestBytes.toString("utf8"));
const releaseValidation = validateReleaseManifest(releaseUnknown);
if (!releaseValidation.ok) throw new Error(`Invalid Web release manifest: ${releaseValidation.errors.join("; ")}`);
const release = releaseUnknown as {
  target: string;
  identities: { visual_runtime_sha256: string };
};
if (release.target !== "web-pwa") throw new Error("Linux handheld input must be the browser Web/PWA release");
if (report.subject.releaseManifestSha256 !== sha256(releaseManifestBytes)) {
  throw new Error("Linux report does not bind the exact Web release manifest bytes");
}
if (report.subject.visualRuntimeSha256 !== release.identities.visual_runtime_sha256) {
  throw new Error("Linux report visual runtime identity differs from the Web release");
}
const webFiles = await inventoryWebAssets(webRelease);
if (report.subject.webReleaseTreeSha256 !== webAssetTreeSha256(webFiles)) {
  throw new Error("Linux report does not bind the exact Web release tree");
}

const evidenceDirectory = path.resolve(evidenceValue);
const artifactFiles: Record<keyof LinuxHandheldValidationV1["artifacts"], string> = {
  screenshotSha256: "ready.png",
  capabilityReportSha256: "capabilities.json",
  offlineReportSha256: "offline.json",
  storageReportSha256: "storage.json",
  controllerReportSha256: "controller.json",
  lifecycleReportSha256: "lifecycle.json",
  performanceReportSha256: "performance.json",
};
for (const [field, filename] of Object.entries(artifactFiles) as [keyof typeof artifactFiles, string][]) {
  const actual = sha256(fs.readFileSync(path.join(evidenceDirectory, filename)));
  if (report.artifacts[field] !== actual) throw new Error(`${filename} does not match report artifact hash ${field}`);
}

console.log(`Linux handheld Web evidence verified for ${report.device.profileId}; status ${report.status}.`);
