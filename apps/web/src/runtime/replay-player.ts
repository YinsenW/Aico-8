import { assertReplay, type ReplayHostAction, type ReplayV1 } from "@aico8/contracts";

export interface ReplayPlaybackOptions {
  readonly expectedCartSha256: string;
  readonly requireCleanInitialState?: boolean;
  readonly executeHostAction?: (action: ReplayHostAction) => void;
}

export interface ReplayPlaybackResult {
  readonly replayId: string;
  readonly milestoneId: string;
  readonly updatesExecuted: number;
  readonly totalUpdates: number;
}

export interface ReplayUpdatePlaybackResult {
  readonly replayId: string;
  readonly targetUpdate: number;
  readonly updatesExecuted: number;
  readonly totalUpdates: number;
}

export interface InitializationCaptureKernel {
  initializationComplete(): boolean;
  tick60(buttonMask: number): void;
  readAudio(): Int16Array;
}

export interface InitializationCaptureResult {
  readonly hostTicksExecuted: number;
  readonly discardedAudioSamples: number;
}

export interface NeutralInputProbeResult {
  readonly updatesExecuted: number;
}

export function parseValidationInteger(
  value: string | null,
  label: string,
  maximum: number,
): number | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new TypeError(`${label} must be a canonical non-negative integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new TypeError(`${label} must not exceed ${maximum}`);
  }
  return parsed;
}

/** Advances a deterministic presentation clock in renderer-safe slices. */
export function advancePresentationTime(
  milliseconds: number,
  animate: (deltaMilliseconds: number) => void,
): void {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new TypeError("Presentation sample time must be a non-negative integer");
  }
  let remaining = milliseconds;
  while (remaining > 0) {
    const delta = Math.min(remaining, 50);
    animate(delta);
    remaining -= delta;
  }
}

/**
 * Advances `_init()`/`flip()` presentation to one exact host tick without
 * crossing into ordinary logical updates. This makes source-authored startup
 * animation review reproducible even though logical replay starts afterwards.
 */
export function playInitializationToHostTick(
  kernel: InitializationCaptureKernel,
  targetHostTick: number,
  maximumHostTicks = 36_000,
): InitializationCaptureResult {
  if (!Number.isSafeInteger(targetHostTick) || targetHostTick < 0 || targetHostTick > maximumHostTicks) {
    throw new TypeError(`Initialization host tick must be an integer from 0 to ${maximumHostTicks}`);
  }
  if (kernel.initializationComplete()) {
    throw new TypeError("Initialization capture requires a kernel still executing startup code");
  }
  let discardedAudioSamples = 0;
  for (let hostTick = 0; hostTick < targetHostTick; hostTick += 1) {
    if (kernel.initializationComplete()) {
      throw new TypeError(`Initialization completed before requested host tick ${targetHostTick}`);
    }
    kernel.tick60(0);
    discardedAudioSamples += kernel.readAudio().length;
  }
  if (kernel.initializationComplete()) {
    throw new TypeError(`Requested host tick ${targetHostTick} is not inside initialization`);
  }
  return { hostTicksExecuted: targetHostTick, discardedAudioSamples };
}

/** Executes a bounded named reachability probe through ordinary neutral input. */
export function playNeutralInputProbe(
  updates: number,
  logicalUpdate: (buttonMask: number) => void,
  maximumUpdates = 3_600,
): NeutralInputProbeResult {
  if (!Number.isSafeInteger(updates) || updates < 1 || updates > maximumUpdates) {
    throw new TypeError(`Neutral input probe must execute from 1 through ${maximumUpdates} logical updates`);
  }
  for (let update = 0; update < updates; update += 1) logicalUpdate(0);
  return { updatesExecuted: updates };
}

function validatedReplay(value: unknown, options: ReplayPlaybackOptions): ReplayV1 {
  assertReplay(value);
  const replay: ReplayV1 = value;
  if (replay.cartSha256 !== options.expectedCartSha256) {
    throw new TypeError("Validation replay cart hash does not match the packaged game");
  }
  if (options.requireCleanInitialState && replay.trace.initialState.kind !== "clean") {
    throw new TypeError("Validation replay must declare a clean initial state");
  }
  return replay;
}

function executeReplayUpdates(
  replay: ReplayV1,
  targetUpdate: number,
  logicalUpdate: (buttonMask: number) => void,
  executeHostAction: ((action: ReplayHostAction) => void) | undefined,
): void {
  let update = 0;
  let spanIndex = 0;
  let hostActionIndex = 0;
  while (update < targetUpdate) {
    while (replay.hostActions?.[hostActionIndex]?.atUpdate === update) {
      if (!executeHostAction) {
        throw new TypeError("Validation replay declares host actions but no host executor was provided");
      }
      executeHostAction(replay.hostActions[hostActionIndex]!);
      hostActionIndex += 1;
    }
    const span = replay.trace.spans[spanIndex];
    if (!span || update < span.startUpdate || update >= span.endUpdateExclusive) {
      throw new TypeError(`Validation replay lost input coverage at update ${update}`);
    }
    logicalUpdate(span.players[0]);
    update += 1;
    if (update === span.endUpdateExclusive) spanIndex += 1;
  }
}

/** Executes ordinary replay input to an exact logical-update boundary. */
export function playReplayToUpdate(
  value: unknown,
  targetUpdate: number,
  logicalUpdate: (buttonMask: number) => void,
  options: ReplayPlaybackOptions,
): ReplayUpdatePlaybackResult {
  const replay = validatedReplay(value, options);
  if (!Number.isSafeInteger(targetUpdate) || targetUpdate < 0 || targetUpdate > replay.trace.totalUpdates) {
    throw new TypeError(`Validation replay target update must be an integer from 0 to ${replay.trace.totalUpdates}`);
  }
  executeReplayUpdates(replay, targetUpdate, logicalUpdate, options.executeHostAction);
  return {
    replayId: replay.replayId,
    targetUpdate,
    updatesExecuted: targetUpdate,
    totalUpdates: replay.trace.totalUpdates,
  };
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
  const replay = validatedReplay(value, options);
  const milestone = replay.milestones.find(({ id }) => id === milestoneId);
  if (!milestone) throw new TypeError(`Validation replay has no milestone ${milestoneId}`);
  executeReplayUpdates(replay, milestone.atUpdate, logicalUpdate, options.executeHostAction);
  return {
    replayId: replay.replayId,
    milestoneId,
    updatesExecuted: milestone.atUpdate,
    totalUpdates: replay.trace.totalUpdates,
  };
}
