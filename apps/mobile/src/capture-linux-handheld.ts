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

import { buildPendingLinuxHandheldReport, evaluateLinuxHandheldPerformance } from "./linux-handheld-capture.js";
import { inventoryWebAssets, webAssetTreeSha256 } from "./web-release-inventory.js";

function sha256(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

type AutomatedInput = Omit<LinuxHandheldValidationV1["automatedChecks"], "performance">;
interface MachineCaptureInput {
  readonly capturedAt: string;
  readonly device: LinuxHandheldValidationV1["device"];
  readonly automatedChecks: AutomatedInput;
  readonly capabilityGaps: LinuxHandheldValidationV1["capabilityGaps"];
  readonly performanceCaptureSeconds: number;
  readonly frameDurationsMilliseconds: readonly number[];
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 5) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile capture:linux -- "
      + "<machine-capture.json> <web-release-directory> <linux-target-profile.json> "
      + "<evidence-directory> <pending-report.json>",
  );
}
const [captureValue, webReleaseValue, targetValue, evidenceValue, outputValue] = args as [string, string, string, string, string];
const capture = JSON.parse(fs.readFileSync(path.resolve(captureValue), "utf8")) as MachineCaptureInput;
if (!Array.isArray(capture.frameDurationsMilliseconds)) throw new Error("Machine capture must contain frameDurationsMilliseconds");

const targetBytes = fs.readFileSync(path.resolve(targetValue));
const targetUnknown: unknown = JSON.parse(targetBytes.toString("utf8"));
const targetValidation = validateTargetProfile(targetUnknown);
if (!targetValidation.ok || (targetUnknown as { target?: unknown }).target !== "linux-handheld-web") {
  throw new Error(`Invalid Linux handheld target profile: ${targetValidation.errors.join("; ")}`);
}
const target = targetUnknown as LinuxHandheldTargetProfileV1;

const webRelease = path.resolve(webReleaseValue);
const releaseManifestBytes = fs.readFileSync(path.join(webRelease, "release-manifest.json"));
const releaseUnknown: unknown = JSON.parse(releaseManifestBytes.toString("utf8"));
const releaseValidation = validateReleaseManifest(releaseUnknown);
if (!releaseValidation.ok) throw new Error(`Invalid Web release manifest: ${releaseValidation.errors.join("; ")}`);
const release = releaseUnknown as { target: string; identities: { visual_runtime_sha256: string } };
if (release.target !== "web-pwa") throw new Error("Linux handheld capture requires the browser Web/PWA release");
const webFiles = await inventoryWebAssets(webRelease);

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
const artifactHashes = Object.fromEntries(Object.entries(artifactFiles).map(([field, filename]) => [
  field,
  sha256(fs.readFileSync(path.join(evidenceDirectory, filename))),
])) as unknown as LinuxHandheldValidationV1["artifacts"];

const report = buildPendingLinuxHandheldReport({
  capturedAt: capture.capturedAt,
  subject: {
    webReleaseTreeSha256: webAssetTreeSha256(webFiles),
    releaseManifestSha256: sha256(releaseManifestBytes),
    targetProfileId: target.id,
    targetProfileSha256: sha256(targetBytes),
    visualRuntimeSha256: release.identities.visual_runtime_sha256,
  },
  device: capture.device,
  automatedChecks: {
    ...capture.automatedChecks,
    performance: evaluateLinuxHandheldPerformance(
      capture.frameDurationsMilliseconds,
      target,
      capture.performanceCaptureSeconds,
    ),
  },
  capabilityGaps: capture.capabilityGaps,
  artifactHashes,
});
const reportValidation = validateLinuxHandheldValidation(report);
if (!reportValidation.ok) throw new Error(`Generated invalid Linux handheld report: ${reportValidation.errors.join("; ")}`);
const output = path.resolve(outputValue);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (report.status === "failed") throw new Error("Linux handheld automated capture failed; inspect retained evidence");
console.log(`Linux handheld evidence captured for ${report.device.profileId}; status ${report.status}.`);
