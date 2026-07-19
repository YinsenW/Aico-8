import {
  assertFixedCollectionLauncher,
  type FixedCollectionLauncherModuleV1,
  type FixedCollectionLauncherV1,
} from "@aico8/contracts";

export interface CollectionDocumentHost {
  readonly resetCount: number;
  replace(module: FixedCollectionLauncherModuleV1): Promise<void>;
  clear(): Promise<void>;
}

export class FixedCollectionLauncherController {
  readonly manifest: FixedCollectionLauncherV1;
  readonly #host: CollectionDocumentHost;
  #activeModuleId: string | undefined;
  #switchTail: Promise<void> = Promise.resolve();

  constructor(manifest: unknown, host: CollectionDocumentHost) {
    assertFixedCollectionLauncher(manifest);
    this.manifest = manifest;
    this.#host = host;
  }

  get activeModuleId(): string | undefined {
    return this.#activeModuleId;
  }

  activate(moduleId: string): Promise<void> {
    const module = this.manifest.modules.find((candidate) => candidate.moduleId === moduleId);
    if (!module) return Promise.reject(new Error(`Unknown fixed collection module: ${moduleId}`));
    const switchOperation = this.#switchTail.then(async () => {
      this.#activeModuleId = undefined;
      await this.#host.clear();
      try {
        await this.#host.replace(module);
        this.#activeModuleId = module.moduleId;
      } catch (error) {
        await this.#host.clear();
        throw error;
      }
    });
    this.#switchTail = switchOperation.catch(() => undefined);
    return switchOperation;
  }

  start(): Promise<void> {
    return this.activate(this.manifest.initialModuleId);
  }

  async destroy(): Promise<void> {
    await this.#switchTail;
    this.#activeModuleId = undefined;
    await this.#host.clear();
  }
}

export class IframeCollectionDocumentHost implements CollectionDocumentHost {
  readonly #mount: HTMLElement;
  #frame: HTMLIFrameElement | undefined;
  #resetCount = 0;

  constructor(mount: HTMLElement) {
    this.#mount = mount;
  }

  get resetCount(): number {
    return this.#resetCount;
  }

  get activeIdentity(): { documentIdentity: string; runtimeIdentity: string } | undefined {
    if (!this.#frame?.dataset.documentIdentity || !this.#frame.dataset.runtimeIdentity) return undefined;
    return {
      documentIdentity: this.#frame.dataset.documentIdentity,
      runtimeIdentity: this.#frame.dataset.runtimeIdentity,
    };
  }

  async clear(): Promise<void> {
    if (!this.#frame) return;
    const previous = this.#frame;
    this.#frame = undefined;
    const replaced = new Promise<void>((resolve, reject) => {
      previous.addEventListener("load", () => resolve(), { once: true });
      previous.addEventListener("error", () => reject(new Error("Unable to reset the prior game document")), { once: true });
    });
    previous.src = "about:blank";
    await replaced;
    previous.remove();
    this.#resetCount += 1;
  }

  replace(module: FixedCollectionLauncherModuleV1): Promise<void> {
    if (this.#frame) throw new Error("Collection host must clear the active document before replacement");
    const frame = document.createElement("iframe");
    frame.className = "collection-game-frame";
    frame.title = module.title;
    frame.allow = "autoplay; fullscreen; gamepad";
    frame.dataset.moduleId = module.moduleId;
    const launchUrl = new URL(module.launchPath, window.location.href);
    frame.src = launchUrl.href;
    this.#frame = frame;
    this.#mount.replaceChildren(frame);
    return new Promise((resolve, reject) => {
      let readinessPoll: number | undefined;
      const finish = (error?: Error): void => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timeout);
        if (readinessPoll !== undefined) clearTimeout(readinessPoll);
        if (error) reject(error); else resolve();
      };
      const onMessage = (event: MessageEvent): void => {
        const value = event.data as Record<string, unknown> | null;
        if (event.origin !== launchUrl.origin || event.source !== frame.contentWindow
          || !value || value.schemaVersion !== "aico8.collection-child-ready.v1"
          || value.moduleId !== module.moduleId
          || typeof value.documentIdentity !== "string"
          || typeof value.runtimeIdentity !== "string") return;
        frame.dataset.documentIdentity = value.documentIdentity;
        frame.dataset.runtimeIdentity = value.runtimeIdentity;
        finish();
      };
      const timeout = window.setTimeout(
        () => {
          const capture = frame.contentDocument?.querySelector<HTMLElement>("#game-frame");
          const detail = capture
            ? ` (capture ${capture.dataset.captureStatus ?? "unknown"}: ${capture.dataset.captureError ?? "no error"})`
            : ` (child ${frame.contentDocument?.body?.innerText.slice(0, 240) ?? "document unavailable"})`;
          finish(new Error(`Timed out waiting for ${module.title} runtime handshake${detail}`));
        },
        15_000,
      );
      window.addEventListener("message", onMessage);
      frame.addEventListener("load", () => {
        const pollChildReadiness = (): void => {
          try {
            const capture = frame.contentDocument?.querySelector<HTMLElement>("#game-frame");
            if (capture?.dataset.captureStatus === "failed") {
              finish(new Error(capture.dataset.captureError ?? `${module.title} runtime failed`));
              return;
            }
            if (capture?.dataset.captureStatus === "ready" && frame.contentWindow) {
              frame.dataset.documentIdentity = `document:${frame.contentWindow.crypto.randomUUID()}`;
              frame.dataset.runtimeIdentity = `runtime:${frame.contentWindow.crypto.randomUUID()}`;
              finish();
              return;
            }
          } catch {
            // A declared collection package must stay same-origin. The bounded
            // timeout below fails closed if the child cannot be inspected.
          }
          readinessPoll = window.setTimeout(pollChildReadiness, 16);
        };
        pollChildReadiness();
      }, { once: true });
      frame.addEventListener("error", () => finish(new Error(`Unable to open ${module.title}`)), { once: true });
    });
  }
}

export async function loadFixedCollectionLauncher(url: URL): Promise<FixedCollectionLauncherV1> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load fixed collection launcher (${response.status})`);
  const value: unknown = await response.json();
  assertFixedCollectionLauncher(value);
  return value;
}
