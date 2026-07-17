import {
  validateAndroidDeviceManualDecision,
  validateAndroidPhysicalDeviceValidation,
  validateAndroidWebLineage,
  validateTargetProfile,
  type AndroidDeviceManualDecisionV1,
  type AndroidPhysicalDeviceValidationV2,
  type AndroidTargetProfileV1,
  type AndroidWebLineageV1,
} from "@aico8/contracts";
import fs from "node:fs";
import path from "node:path";

import {
  ANDROID_DEVICE_ARTIFACT_FILES,
  verifyAndroidDeviceEvidenceBindings,
  verifyAndroidDeviceManualDecisionBinding,
} from "./android-device-capture.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 5 && args.length !== 7) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile verify:device -- "
      + "<android-device-validation.json> <debug-apk> <android-web-lineage.json> "
      + "<target-profile.json> <evidence-directory> "
      + "[<pending-report.json> <manual-decision.json>]",
  );
}
const [reportValue, apkValue, lineageValue, targetProfileValue, evidenceValue, pendingValue, decisionValue]
  = args as [string, string, string, string, string, string | undefined, string | undefined];
const reportBytes = fs.readFileSync(path.resolve(reportValue));
const reportUnknown: unknown = JSON.parse(reportBytes.toString("utf8"));
const reportValidation = validateAndroidPhysicalDeviceValidation(reportUnknown);
if (!reportValidation.ok) throw new Error(`Invalid Android device report: ${reportValidation.errors.join("; ")}`);
const report = reportUnknown as AndroidPhysicalDeviceValidationV2;

if (report.manualReview.decisionSha256 === null) {
  if (pendingValue !== undefined || decisionValue !== undefined) {
    throw new Error("An unreviewed Android report must not include manual-decision verification inputs");
  }
} else {
  if (pendingValue === undefined || decisionValue === undefined) {
    throw new Error("A reviewed Android report requires its exact pending report and manual decision bytes");
  }
  const pendingBytes = fs.readFileSync(path.resolve(pendingValue));
  const pendingUnknown: unknown = JSON.parse(pendingBytes.toString("utf8"));
  const pendingValidation = validateAndroidPhysicalDeviceValidation(pendingUnknown);
  if (!pendingValidation.ok) throw new Error(`Invalid pending Android device report: ${pendingValidation.errors.join("; ")}`);
  const decisionBytes = fs.readFileSync(path.resolve(decisionValue));
  const decisionUnknown: unknown = JSON.parse(decisionBytes.toString("utf8"));
  const decisionValidation = validateAndroidDeviceManualDecision(decisionUnknown);
  if (!decisionValidation.ok) throw new Error(`Invalid Android device manual decision: ${decisionValidation.errors.join("; ")}`);
  verifyAndroidDeviceManualDecisionBinding(
    report,
    pendingBytes,
    pendingUnknown as AndroidPhysicalDeviceValidationV2,
    decisionBytes,
    decisionUnknown as AndroidDeviceManualDecisionV1,
  );
}

const lineageBytes = fs.readFileSync(path.resolve(lineageValue));
const lineageUnknown: unknown = JSON.parse(lineageBytes.toString("utf8"));
const lineageValidation = validateAndroidWebLineage(lineageUnknown);
if (!lineageValidation.ok) throw new Error(`Invalid Android Web lineage: ${lineageValidation.errors.join("; ")}`);

const targetProfileBytes = fs.readFileSync(path.resolve(targetProfileValue));
const targetProfileUnknown: unknown = JSON.parse(targetProfileBytes.toString("utf8"));
const targetProfileValidation = validateTargetProfile(targetProfileUnknown);
if (!targetProfileValidation.ok) {
  throw new Error(`Invalid Android target profile: ${targetProfileValidation.errors.join("; ")}`);
}

const evidenceDirectory = path.resolve(evidenceValue);
const artifactBytes = Object.fromEntries(
  Object.entries(ANDROID_DEVICE_ARTIFACT_FILES).map(([field, filename]) => [
    field,
    fs.readFileSync(path.join(evidenceDirectory, filename)),
  ]),
) as unknown as Record<keyof AndroidPhysicalDeviceValidationV2["artifacts"], Uint8Array>;

verifyAndroidDeviceEvidenceBindings(
  report,
  fs.readFileSync(path.resolve(apkValue)),
  lineageBytes,
  lineageUnknown as AndroidWebLineageV1,
  targetProfileBytes,
  targetProfileUnknown as AndroidTargetProfileV1,
  artifactBytes,
);
console.log(`Android physical-device evidence verified for ${report.device.profileId}; status ${report.status}.`);
