import {
  validateAndroidPhysicalDeviceValidation,
  validateAndroidWebLineage,
  validateTargetProfile,
  type AndroidPhysicalDeviceValidationV2,
  type AndroidTargetProfileV1,
  type AndroidWebLineageV1,
} from "@aico8/contracts";
import fs from "node:fs";
import path from "node:path";

import {
  ANDROID_DEVICE_ARTIFACT_FILES,
  verifyAndroidDeviceEvidenceBindings,
} from "./android-device-capture.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 5) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile verify:device -- "
      + "<android-device-validation.json> <debug-apk> <android-web-lineage.json> "
      + "<target-profile.json> <evidence-directory>",
  );
}
const [reportValue, apkValue, lineageValue, targetProfileValue, evidenceValue]
  = args as [string, string, string, string, string];
const reportBytes = fs.readFileSync(path.resolve(reportValue));
const reportUnknown: unknown = JSON.parse(reportBytes.toString("utf8"));
const reportValidation = validateAndroidPhysicalDeviceValidation(reportUnknown);
if (!reportValidation.ok) throw new Error(`Invalid Android device report: ${reportValidation.errors.join("; ")}`);

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
  reportUnknown as AndroidPhysicalDeviceValidationV2,
  fs.readFileSync(path.resolve(apkValue)),
  lineageBytes,
  lineageUnknown as AndroidWebLineageV1,
  targetProfileBytes,
  targetProfileUnknown as AndroidTargetProfileV1,
  artifactBytes,
);
console.log(`Android physical-device evidence verified for ${(reportUnknown as AndroidPhysicalDeviceValidationV2).device.profileId}; status ${(reportUnknown as AndroidPhysicalDeviceValidationV2).status}.`);
