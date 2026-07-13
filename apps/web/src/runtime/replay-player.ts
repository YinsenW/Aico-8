import { assertReplay, type ReplayV1 } from "@aico8/contracts";

export interface ReplayPlaybackOptions {
  readonly expectedCartSha256: string;
  readonly requireCleanInitialState?: boolean;
}

export interface ReplayPlaybackResult {
  readonly replayId: string;
  readonly milestoneId: string;
  readonly updatesExecuted: number;
  readonly totalUpdates: number;
}

/**
 * Executes an accepted replay as ordinary logical button input.  It neither
 * skips updates nor writes compatibility state, and stops only at a declared
 * milestone boundary after that update count has executed.
 */
export function playReplayToMilestone(
  value: unknown,
  milestoneId: string,
  logicalUpdate: (buttonMask: number) => void,
  options: ReplayPlaybackOptions,
): ReplayPlaybackResult {
  assertReplay(value);
  const replay: ReplayV1 = value;
  if (replay.cartSha256 !== options.expectedCartSha256) {
    throw new TypeError("Validation replay cart hash does not match the packaged game");
  }
  if (options.requireCleanInitialState && replay.trace.initialState.kind !== "clean") {
    throw new TypeError("Validation replay must declare a clean initial state");
  }
  const milestone = replay.milestones.find(({ id }) => id === milestoneId);
  if (!milestone) throw new TypeError(`Validation replay has no milestone ${milestoneId}`);

  let update = 0;
  let spanIndex = 0;
  while (update < milestone.atUpdate) {
    const span = replay.trace.spans[spanIndex];
    if (!span || update < span.startUpdate || update >= span.endUpdateExclusive) {
      throw new TypeError(`Validation replay lost input coverage at update ${update}`);
    }
    logicalUpdate(span.players[0]);
    update += 1;
    if (update === span.endUpdateExclusive) spanIndex += 1;
  }
  return {
    replayId: replay.replayId,
    milestoneId,
    updatesExecuted: update,
    totalUpdates: replay.trace.totalUpdates,
  };
}
