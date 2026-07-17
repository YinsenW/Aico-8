import { describe, expect, it, vi } from "vitest";
import {
  PlatformLifecycleCoordinator,
  installPlatformLifecycle,
  type NativeAppStateBridge,
} from "./platform-host.js";

describe("shared platform lifecycle host", () => {
  it("suspends once across overlapping reasons and resumes only after all clear", () => {
    const suspend = vi.fn();
    const resume = vi.fn();
    const coordinator = new PlatformLifecycleCoordinator({ suspend, resume });
    coordinator.setSuspended("app-state", true);
    coordinator.setSuspended("audio-focus", true);
    coordinator.setSuspended("app-state", false);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    expect(coordinator.reasons).toEqual(["audio-focus"]);
    coordinator.setSuspended("audio-focus", false);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("binds native app state, visibility, page lifecycle, and Android audio focus", async () => {
    const documentEvents = new EventTarget();
    const windowEvents = new EventTarget();
    let hidden = false;
    let appListener: ((state: { isActive: boolean }) => void) | undefined;
    const remove = vi.fn(async () => undefined);
    const nativeBridge: NativeAppStateBridge = {
      async addListener(_name, listener) {
        appListener = listener;
        return { remove };
      },
    };
    const fakeDocument = Object.assign(documentEvents, { get hidden() { return hidden; } }) as unknown as Document;
    const fakeWindow = windowEvents as unknown as Window;
    const suspend = vi.fn();
    const resume = vi.fn();
    const installation = await installPlatformLifecycle({
      document: fakeDocument,
      window: fakeWindow,
      nativeBridge,
      callbacks: { suspend, resume },
    });
    appListener?.({ isActive: false });
    windowEvents.dispatchEvent(new CustomEvent("aico8:audio-focus", { detail: { hasFocus: false } }));
    appListener?.({ isActive: true });
    expect(installation.coordinator.reasons).toEqual(["audio-focus"]);
    windowEvents.dispatchEvent(new CustomEvent("aico8:audio-focus", { detail: { hasFocus: true } }));
    expect(resume).toHaveBeenCalledTimes(1);
    hidden = true;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    windowEvents.dispatchEvent(new Event("pagehide"));
    hidden = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    expect(installation.coordinator.reasons).toEqual(["page-lifecycle"]);
    windowEvents.dispatchEvent(new Event("pageshow"));
    expect(resume).toHaveBeenCalledTimes(2);
    await installation.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
