export interface CaptureOverlaySnapshot {
  readonly hiddenClass: boolean;
  readonly opacity: number;
  readonly visibility: string;
}

export interface CaptureReadinessResult extends CaptureOverlaySnapshot {
  readonly presentedFrames: 2;
}

export interface CaptureReadinessHooks {
  readonly waitForOverlayTransition: () => Promise<void>;
  readonly waitForPresentedFrame: () => Promise<void>;
  readonly readOverlay: () => CaptureOverlaySnapshot;
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
 * A screenshot may be taken only after the loading transition finishes and two
 * additional browser frames have presented the requested game state.
 */
export async function settleCaptureReadiness(
  hooks: CaptureReadinessHooks,
): Promise<CaptureReadinessResult> {
  await hooks.waitForOverlayTransition();
  await hooks.waitForPresentedFrame();
  await hooks.waitForPresentedFrame();
  const snapshot = hooks.readOverlay();
  const errors = captureOverlayErrors(snapshot);
  if (errors.length > 0) throw new Error(`Visual capture is not ready: ${errors.join("; ")}`);
  return { ...snapshot, presentedFrames: 2 };
}
