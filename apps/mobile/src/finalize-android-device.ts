import {
  validateAndroidDeviceManualDecision,
  validateAndroidPhysicalDeviceValidation,
  type AndroidDeviceManualDecisionV1,
  type AndroidPhysicalDeviceValidationV1,
} from "@aico8/contracts";
import fs from "node:fs";
import path from "node:path";
import { applyAndroidDeviceManualDecision, sha256 } from "./android-device-capture.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 3) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile finalize:device -- "
      + "<pending-android-device-validation.json> <manual-decision.json> <final-report.json>",
  );
}
const [reportValue, decisionValue, outputValue] = args as [string, string, string];
const reportPath = path.resolve(reportValue);
const decisionPath = path.resolve(decisionValue);
const outputPath = path.resolve(outputValue);
const reportBytes = fs.readFileSync(reportPath);
const decisionBytes = fs.readFileSync(decisionPath);
const reportUnknown: unknown = JSON.parse(reportBytes.toString("utf8"));
const decisionUnknown: unknown = JSON.parse(decisionBytes.toString("utf8"));
const reportValidation = validateAndroidPhysicalDeviceValidation(reportUnknown);
if (!reportValidation.ok) throw new Error(`Invalid pending device report: ${reportValidation.errors.join("; ")}`);
const decisionValidation = validateAndroidDeviceManualDecision(decisionUnknown);
if (!decisionValidation.ok) throw new Error(`Invalid device manual decision: ${decisionValidation.errors.join("; ")}`);

const finalized = applyAndroidDeviceManualDecision(
  reportUnknown as AndroidPhysicalDeviceValidationV1,
  sha256(reportBytes),
  decisionUnknown as AndroidDeviceManualDecisionV1,
  sha256(decisionBytes),
);
const finalValidation = validateAndroidPhysicalDeviceValidation(finalized);
if (!finalValidation.ok) throw new Error(`Generated invalid final device report: ${finalValidation.errors.join("; ")}`);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
console.log(`Android physical-device manual review finalized with status ${finalized.status}.`);
