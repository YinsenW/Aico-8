export interface CaptureOverlaySnapshot {
  readonly hiddenClass: boolean;
  readonly opacity: number;
  readonly visibility: string;
}

export interface CaptureReadinessResult extends CaptureOverlaySnapshot {
  readonly presentedFrames: number;
}

export interface CaptureReadinessHooks {
  readonly waitForOverlayTransition: () => Promise<void>;
  readonly waitForPresentedFrame: () => Promise<void>;
  readonly readOverlay: () => CaptureOverlaySnapshot;
  readonly maximumPresentedFrames?: number;
}

export function captureOverlayErrors(snapshot: CaptureOverlaySnapshot): string[] {
  const errors: string[] = [];
  if (!snapshot.hiddenClass) errors.push("loading overlay is missing the hidden class");
  if (!Number.isFinite(snapshot.opacity) || snapshot.opacity !== 0) {
    errors.push(`loading overlay opacity must be 0, received ${snapshot.opacity}`);
  }
  if (snapshot.visibility !== "hidden") {
    errors.push(`loading overlay visibility must be hidden, received ${snapshot.visibility}`);
  }
  return errors;
}

/**
 * A screenshot may be taken only after the loading transition finishes and the
 * overlay has remained fully excluded for two consecutive presented frames.
 * Browsers may defer the first transition paint until after a busy replay or a
 * reload, so a single post-transition sample is not a stable readiness signal.
 */
export async function settleCaptureReadiness(
  hooks: CaptureReadinessHooks,
): Promise<CaptureReadinessResult> {
  await hooks.waitForOverlayTransition();
  const maximumPresentedFrames = hooks.maximumPresentedFrames ?? 120;
  if (!Number.isSafeInteger(maximumPresentedFrames) || maximumPresentedFrames < 2) {
    throw new Error("maximumPresentedFrames must be an integer of at least 2");
  }

  let consecutiveReadyFrames = 0;
  let snapshot = hooks.readOverlay();
  for (let presentedFrames = 1; presentedFrames <= maximumPresentedFrames; presentedFrames += 1) {
    await hooks.waitForPresentedFrame();
    snapshot = hooks.readOverlay();
    if (captureOverlayErrors(snapshot).length === 0) consecutiveReadyFrames += 1;
    else consecutiveReadyFrames = 0;
    if (consecutiveReadyFrames === 2) return { ...snapshot, presentedFrames };
  }

  const errors = captureOverlayErrors(snapshot);
  throw new Error(`Visual capture is not ready after ${maximumPresentedFrames} presented frames: ${errors.join("; ")}`);
}
