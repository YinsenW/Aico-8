import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";

export type PlatformSuspensionReason = "app-state" | "audio-focus" | "document-visibility" | "page-lifecycle";

export interface PlatformLifecycleCallbacks {
  readonly suspend: (reason: PlatformSuspensionReason) => void | Promise<void>;
  readonly resume: () => void | Promise<void>;
}

export interface NativeAppStateBridge {
  addListener(
    eventName: "appStateChange",
    listener: (state: { readonly isActive: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

export class PlatformLifecycleCoordinator {
  readonly #callbacks: PlatformLifecycleCallbacks;
  readonly #reasons = new Set<PlatformSuspensionReason>();

  constructor(callbacks: PlatformLifecycleCallbacks) {
    this.#callbacks = callbacks;
  }

  get suspended(): boolean {
    return this.#reasons.size > 0;
  }

  get reasons(): readonly PlatformSuspensionReason[] {
    return [...this.#reasons].sort();
  }

  setSuspended(reason: PlatformSuspensionReason, suspended: boolean): void {
    const wasSuspended = this.suspended;
    if (suspended) this.#reasons.add(reason);
    else this.#reasons.delete(reason);
    if (!wasSuspended && this.suspended) void this.#callbacks.suspend(reason);
    else if (wasSuspended && !this.suspended) void this.#callbacks.resume();
  }
}

export interface PlatformLifecycleInstallation {
  readonly coordinator: PlatformLifecycleCoordinator;
  remove(): Promise<void>;
}

export interface InstallPlatformLifecycleOptions {
  readonly document: Document;
  readonly window: Window;
  readonly callbacks: PlatformLifecycleCallbacks;
  readonly nativeBridge?: NativeAppStateBridge;
}

export async function installPlatformLifecycle(
  options: InstallPlatformLifecycleOptions,
): Promise<PlatformLifecycleInstallation> {
  const coordinator = new PlatformLifecycleCoordinator(options.callbacks);
  const onVisibility = (): void => coordinator.setSuspended("document-visibility", options.document.hidden);
  const onPageHide = (): void => coordinator.setSuspended("page-lifecycle", true);
  const onPageShow = (): void => coordinator.setSuspended("page-lifecycle", false);
  const onAudioFocus = (event: Event): void => {
    const hasFocus = event instanceof CustomEvent
      && typeof event.detail === "object"
      && event.detail !== null
      && (event.detail as { hasFocus?: unknown }).hasFocus === true;
    coordinator.setSuspended("audio-focus", !hasFocus);
  };
  options.document.addEventListener("visibilitychange", onVisibility);
  options.window.addEventListener("pagehide", onPageHide);
  options.window.addEventListener("pageshow", onPageShow);
  options.window.addEventListener("aico8:audio-focus", onAudioFocus);
  onVisibility();
  const bridge = options.nativeBridge ?? (Capacitor.isNativePlatform() ? App : undefined);
  const appHandle = bridge
    ? await bridge.addListener("appStateChange", ({ isActive }) => coordinator.setSuspended("app-state", !isActive))
    : undefined;
  return {
    coordinator,
    async remove() {
      options.document.removeEventListener("visibilitychange", onVisibility);
      options.window.removeEventListener("pagehide", onPageHide);
      options.window.removeEventListener("pageshow", onPageShow);
      options.window.removeEventListener("aico8:audio-focus", onAudioFocus);
      await appHandle?.remove();
    },
  };
}
