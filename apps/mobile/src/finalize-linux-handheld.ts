import {
  validateLinuxHandheldManualDecision,
  validateLinuxHandheldValidation,
  type LinuxHandheldManualDecisionV1,
  type LinuxHandheldValidationV1,
} from "@aico8/contracts";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { applyLinuxHandheldManualDecision } from "./linux-handheld-capture.js";

function sha256(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args.length !== 3) {
  throw new Error(
    "Usage: pnpm --filter @aico8/mobile finalize:linux -- "
      + "<pending-linux-validation.json> <manual-decision.json> <final-report.json>",
  );
}
const [reportValue, decisionValue, outputValue] = args as [string, string, string];
const reportBytes = fs.readFileSync(path.resolve(reportValue));
const decisionBytes = fs.readFileSync(path.resolve(decisionValue));
const reportUnknown: unknown = JSON.parse(reportBytes.toString("utf8"));
const decisionUnknown: unknown = JSON.parse(decisionBytes.toString("utf8"));
const reportValidation = validateLinuxHandheldValidation(reportUnknown);
if (!reportValidation.ok) throw new Error(`Invalid pending Linux report: ${reportValidation.errors.join("; ")}`);
const decisionValidation = validateLinuxHandheldManualDecision(decisionUnknown);
if (!decisionValidation.ok) throw new Error(`Invalid Linux manual decision: ${decisionValidation.errors.join("; ")}`);
const finalized = applyLinuxHandheldManualDecision(
  reportUnknown as LinuxHandheldValidationV1,
  sha256(reportBytes),
  decisionUnknown as LinuxHandheldManualDecisionV1,
  sha256(decisionBytes),
);
const finalValidation = validateLinuxHandheldValidation(finalized);
if (!finalValidation.ok) throw new Error(`Generated invalid final Linux report: ${finalValidation.errors.join("; ")}`);
const output = path.resolve(outputValue);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
console.log(`Linux handheld manual review finalized with status ${finalized.status}.`);
