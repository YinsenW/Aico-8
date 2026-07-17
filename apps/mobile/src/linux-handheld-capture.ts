import {
  LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION,
  expectedLinuxHandheldValidationStatus,
  validateTargetProfile,
  type LinuxHandheldManualDecisionV1,
  type LinuxHandheldTargetProfileV1,
  type LinuxHandheldValidationV1,
} from "@aico8/contracts";

export function evaluateLinuxHandheldPerformance(
  frameDurationsMilliseconds: readonly number[],
  targetValue: unknown,
  captureSeconds: number,
): LinuxHandheldValidationV1["automatedChecks"]["performance"] {
  const validation = validateTargetProfile(targetValue);
  if (!validation.ok) throw new Error(`Invalid Linux target profile: ${validation.errors.join("; ")}`);
  const target = targetValue as LinuxHandheldTargetProfileV1;
  if (target.target !== "linux-handheld-web") throw new Error("Linux capture requires a linux-handheld-web target profile");
  const { warmupFrames, sampleFrames, droppedFrameThresholdMilliseconds } = target.measurementEnvironment;
  const sample = frameDurationsMilliseconds.slice(warmupFrames, warmupFrames + sampleFrames);
  const sorted = [...sample].sort((left, right) => left - right);
  const p95 = sorted.length === 0 ? 0 : sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]!;
  const droppedRatio = sample.length === 0
    ? 1
    : sample.filter((duration) => duration > droppedFrameThresholdMilliseconds).length / sample.length;
  return {
    captureSeconds,
    warmupFrames,
    requiredSampleFrames: sampleFrames,
    observedSampleFrames: sample.length,
    droppedFrameThresholdMilliseconds,
    startupMillisecondsMax: target.budgets.startupMillisecondsMax,
    p95FrameMillisecondsMax: target.budgets.p95FrameMillisecondsMax,
    droppedFrameRatioMax: target.budgets.droppedFrameRatioMax,
    p95FrameMilliseconds: Number(p95.toFixed(3)),
    droppedFrameRatio: Number(droppedRatio.toFixed(6)),
    budgetPassed: sample.length >= sampleFrames
      && p95 <= target.budgets.p95FrameMillisecondsMax
      && droppedRatio <= target.budgets.droppedFrameRatioMax,
  };
}

export interface LinuxHandheldReportInput {
  readonly capturedAt: string;
  readonly subject: LinuxHandheldValidationV1["subject"];
  readonly device: LinuxHandheldValidationV1["device"];
  readonly automatedChecks: LinuxHandheldValidationV1["automatedChecks"];
  readonly capabilityGaps: LinuxHandheldValidationV1["capabilityGaps"];
  readonly artifactHashes: LinuxHandheldValidationV1["artifacts"];
}

export function buildPendingLinuxHandheldReport(input: LinuxHandheldReportInput): LinuxHandheldValidationV1 {
  const base = {
    schemaVersion: LINUX_HANDHELD_VALIDATION_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    subject: input.subject,
    device: input.device,
    automatedChecks: input.automatedChecks,
    capabilityGaps: input.capabilityGaps,
    artifacts: input.artifactHashes,
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
  } as const;
  return { ...base, status: expectedLinuxHandheldValidationStatus(base) };
}

export function applyLinuxHandheldManualDecision(
  report: LinuxHandheldValidationV1,
  reportSha256: string,
  decision: LinuxHandheldManualDecisionV1,
  decisionSha256: string,
): LinuxHandheldValidationV1 {
  if (report.status !== "pending-human" || report.manualReview.decisionSha256 !== null) {
    throw new Error("Manual review may only finalize an unreviewed pending-human Linux report");
  }
  if (decision.subjectReportSha256 !== reportSha256) {
    throw new Error("Linux manual decision does not bind the exact pending report bytes");
  }
  const updated = {
    ...report,
    manualReview: {
      decisionSha256,
      reviewerId: decision.reviewerId,
      reviewedAt: decision.reviewedAt,
      checks: decision.checks,
    },
  } as const;
  return { ...updated, status: expectedLinuxHandheldValidationStatus(updated) };
}
