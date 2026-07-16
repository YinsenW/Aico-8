import { describe, expect, it } from "vitest";

import {
  captureOverlayErrors,
  settleCaptureReadiness,
  type CaptureOverlaySnapshot,
} from "./capture-readiness.js";

describe("browser visual-capture readiness", () => {
  it("waits for the transition and two consecutive ready frames before passing", async () => {
    const events: string[] = [];
    const result = await settleCaptureReadiness({
      waitForOverlayTransition: async () => { events.push("transition"); },
      waitForPresentedFrame: async () => { events.push("frame"); },
      readOverlay: () => {
        events.push("read");
        return { hiddenClass: true, opacity: 0, visibility: "hidden" };
      },
    });
    expect(events).toEqual(["transition", "read", "frame", "read", "frame", "read"]);
    expect(result).toEqual({ hiddenClass: true, opacity: 0, visibility: "hidden", presentedFrames: 2 });
  });

  it("survives a reload transition whose first presented frames are still fading", async () => {
    const snapshots: CaptureOverlaySnapshot[] = [
      { hiddenClass: true, opacity: 0.69, visibility: "visible" },
      { hiddenClass: true, opacity: 0.24, visibility: "visible" },
      { hiddenClass: true, opacity: 0, visibility: "hidden" },
      { hiddenClass: true, opacity: 0, visibility: "hidden" },
    ];
    let frame = -1;
    const result = await settleCaptureReadiness({
      waitForOverlayTransition: async () => undefined,
      waitForPresentedFrame: async () => { frame += 1; },
      readOverlay: () => snapshots[Math.max(0, frame)]!,
    });
    expect(result).toEqual({
      hiddenClass: true,
      opacity: 0,
      visibility: "hidden",
      presentedFrames: 4,
    });
  });

  it("restarts stabilization when the overlay becomes visible again", async () => {
    const snapshots: CaptureOverlaySnapshot[] = [
      { hiddenClass: true, opacity: 0, visibility: "hidden" },
      { hiddenClass: true, opacity: 0.1, visibility: "visible" },
      { hiddenClass: true, opacity: 0, visibility: "hidden" },
      { hiddenClass: true, opacity: 0, visibility: "hidden" },
    ];
    let frame = -1;
    const result = await settleCaptureReadiness({
      waitForOverlayTransition: async () => undefined,
      waitForPresentedFrame: async () => { frame += 1; },
      readOverlay: () => snapshots[Math.max(0, frame)]!,
    });
    expect(result.presentedFrames).toBe(4);
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
        maximumPresentedFrames: 2,
      })).rejects.toThrow(expected);
    },
  );
});
