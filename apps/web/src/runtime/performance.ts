export interface FramePerformanceSummary {
  readonly sampleFrames: number;
  readonly p95FrameMilliseconds: number;
  readonly maxFrameMilliseconds: number;
  readonly droppedFrameRatio: number;
}

export type FrameScheduler = (callback: FrameRequestCallback) => number;

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function summarizeFrameIntervals(
  intervals: readonly number[],
  droppedFrameThresholdMilliseconds: number,
): FramePerformanceSummary {
  if (intervals.length === 0) throw new TypeError("Performance sampling requires at least one frame interval");
  if (!Number.isFinite(droppedFrameThresholdMilliseconds) || droppedFrameThresholdMilliseconds <= 0) {
    throw new TypeError("Performance sampling requires a finite positive drop threshold");
  }
  if (intervals.some((interval) => !Number.isFinite(interval) || interval <= 0)) {
    throw new TypeError("Frame intervals must contain only finite positive values");
  }
  const sorted = [...intervals].sort((left, right) => left - right);
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const droppedFrames = intervals.filter((interval) => interval > droppedFrameThresholdMilliseconds).length;
  return {
    sampleFrames: intervals.length,
    p95FrameMilliseconds: rounded(sorted[p95Index]!),
    maxFrameMilliseconds: rounded(sorted.at(-1)!),
    droppedFrameRatio: rounded(droppedFrames / intervals.length),
  };
}

export function sampleFrameIntervals(
  sampleFrames: number,
  warmupFrames: number,
  schedule: FrameScheduler = requestAnimationFrame,
): Promise<number[]> {
  if (!Number.isSafeInteger(sampleFrames) || sampleFrames <= 0) {
    throw new TypeError("sampleFrames must be a positive integer");
  }
  if (!Number.isSafeInteger(warmupFrames) || warmupFrames < 0) {
    throw new TypeError("warmupFrames must be a non-negative integer");
  }
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let previous: number | undefined;
    let warmupRemaining = warmupFrames;
    const observe = (timestamp: number): void => {
      if (previous !== undefined) {
        const interval = timestamp - previous;
        if (warmupRemaining > 0) warmupRemaining -= 1;
        else intervals.push(interval);
      }
      previous = timestamp;
      if (intervals.length === sampleFrames) resolve(intervals);
      else schedule(observe);
    };
    schedule(observe);
  });
}
