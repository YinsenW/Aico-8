import type { PresentationRenderer } from "./presentation.js";

export interface VisibilityTarget {
  setVisible(visible: boolean): void;
}

/**
 * Makes the first presentation frame an atomic visibility boundary.
 *
 * Private renderers may allocate display objects that are visible by default.
 * The player must therefore keep both surfaces hidden until it can synchronously
 * render the current compatibility state. If that render fails, neither stale
 * constructor content nor a partially updated frame is allowed to remain
 * visible.
 */
export function activateInitialPresentationFrame(
  referenceRenderer: VisibilityTarget,
  hdRenderer: PresentationRenderer | undefined,
  showHd: boolean,
  renderCurrentFrame: () => void,
): void {
  referenceRenderer.setVisible(false);
  hdRenderer?.setVisible(false);

  try {
    referenceRenderer.setVisible(!showHd);
    hdRenderer?.setVisible(showHd);
    renderCurrentFrame();
  } catch (error) {
    referenceRenderer.setVisible(false);
    hdRenderer?.setVisible(false);
    throw error;
  }
}

/**
 * A yielding `_init` may expose incomplete draw data before the first authored
 * frame. That provisional state stays behind the loading surface. The same
 * renderer error becomes terminal as soon as cartridge initialization ends.
 */
export function attemptInitialPresentationFrame(
  initializationComplete: boolean,
  commit: () => void,
): boolean {
  try {
    commit();
    return true;
  } catch (error) {
    if (initializationComplete) throw error;
    return false;
  }
}
