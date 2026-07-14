import { describe, expect, it } from "vitest";

import {
  captureOverlayErrors,
  settleCaptureReadiness,
  type CaptureOverlaySnapshot,
} from "./capture-readiness.js";

describe("browser visual-capture readiness", () => {
  it("waits for the transition and two newly presented frames before passing", async () => {
    const events: string[] = [];
    const result = await settleCaptureReadiness({
      waitForOverlayTransition: async () => { events.push("transition"); },
      waitForPresentedFrame: async () => { events.push("frame"); },
      readOverlay: () => {
        events.push("read");
        return { hiddenClass: true, opacity: 0, visibility: "hidden" };
      },
    });
    expect(events).toEqual(["transition", "frame", "frame", "read"]);
    expect(result).toEqual({ hiddenClass: true, opacity: 0, visibility: "hidden", presentedFrames: 2 });
  });

  it.each([
    [{ hiddenClass: false, opacity: 0, visibility: "hidden" }, /hidden class/],
    [{ hiddenClass: true, opacity: 0.2, visibility: "hidden" }, /opacity must be 0/],
    [{ hiddenClass: true, opacity: 0, visibility: "visible" }, /visibility must be hidden/],
  ] satisfies [CaptureOverlaySnapshot, RegExp][]) (
    "rejects a screenshot while the loading overlay is not fully excluded",
    async (snapshot, expected) => {
      expect(captureOverlayErrors(snapshot).join("; ")).toMatch(expected);
      await expect(settleCaptureReadiness({
        waitForOverlayTransition: async () => undefined,
        waitForPresentedFrame: async () => undefined,
        readOverlay: () => snapshot,
      })).rejects.toThrow(expected);
    },
  );
});
