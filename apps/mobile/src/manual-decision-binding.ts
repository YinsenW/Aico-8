import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export function sha256Bytes(value: Uint8Array): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function verifyFinalizedManualDecisionBinding<TReport, TDecision>(
  finalReport: TReport,
  pendingReportBytes: Uint8Array,
  pendingReport: TReport,
  decisionBytes: Uint8Array,
  decision: TDecision,
  applyDecision: (
    report: TReport,
    reportSha256: string,
    decision: TDecision,
    decisionSha256: string,
  ) => TReport,
  label: string,
): void {
  const expected = applyDecision(
    pendingReport,
    sha256Bytes(pendingReportBytes),
    decision,
    sha256Bytes(decisionBytes),
  );
  if (!isDeepStrictEqual(finalReport, expected)) {
    throw new Error(`${label} final report does not exactly match its pending report and manual decision bytes`);
  }
}
