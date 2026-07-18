import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FixedCollectionLauncherController,
  IframeCollectionDocumentHost,
  type CollectionDocumentHost,
} from "./collection-launcher.js";

afterEach(() => vi.unstubAllGlobals());

function manifest(): any {
  return {
    schemaVersion: "aico8.fixed-collection-launcher.v1",
    collectionId: "private-trilogy",
    title: "Private Trilogy",
    targetProfile: { id: "web-hd", sha256: "a".repeat(64) },
    initialModuleId: "module-a",
    resetMode: "document-replacement",
    modules: ["a", "b", "c"].map((suffix, index) => ({
      moduleId: `module-${suffix}`,
      title: `Module ${suffix}`,
      author: `Author ${suffix}`,
      launchPath: `games/module-${suffix}/`,
      saveNamespace: `module-${suffix}:aico8.game-module.v1`,
      persistenceKey: `aico8.synthetic.module-${suffix}.progress.v1`,
      rightsProfile: "private-research",
      package: {
        releaseManifestSha256: String(index + 1).repeat(64),
        treeSha256: String(index + 4).repeat(64),
      },
    })),
  };
}

class RecordingHost implements CollectionDocumentHost {
  readonly events: string[] = [];
  resetCount = 0;
  failModuleId: string | undefined;

  async clear(): Promise<void> {
    this.events.push("clear");
    this.resetCount += 1;
  }

  async replace(module: { moduleId: string }): Promise<void> {
    this.events.push(`replace:${module.moduleId}`);
    if (module.moduleId === this.failModuleId) throw new Error("replacement failed");
  }
}

describe("fixed collection launcher controller", () => {
  it("starts the declared game and destroys the prior document before every switch", async () => {
    const host = new RecordingHost();
    const controller = new FixedCollectionLauncherController(manifest(), host);
    await controller.start();
    await controller.activate("module-b");
    expect(controller.activeModuleId).toBe("module-b");
    expect(host.events).toEqual([
      "clear", "replace:module-a",
      "clear", "replace:module-b",
    ]);
  });

  it("serializes rapid switches without reusing a compatibility runtime", async () => {
    const host = new RecordingHost();
    const controller = new FixedCollectionLauncherController(manifest(), host);
    await Promise.all([controller.activate("module-b"), controller.activate("module-c")]);
    expect(controller.activeModuleId).toBe("module-c");
    expect(host.events).toEqual([
      "clear", "replace:module-b",
      "clear", "replace:module-c",
    ]);
  });

  it("fails closed with no active game when document replacement fails", async () => {
    const host = new RecordingHost();
    host.failModuleId = "module-b";
    const controller = new FixedCollectionLauncherController(manifest(), host);
    await expect(controller.activate("module-b")).rejects.toThrow("replacement failed");
    expect(controller.activeModuleId).toBeUndefined();
    expect(host.events).toEqual(["clear", "replace:module-b", "clear"]);
  });

  it("rejects undeclared modules before touching the active document", async () => {
    const host = new RecordingHost();
    const controller = new FixedCollectionLauncherController(manifest(), host);
    await expect(controller.activate("module-z")).rejects.toThrow("Unknown fixed collection module");
    expect(host.events).toEqual([]);
  });

  it("navigates the old iframe to an empty document before removing and replacing it", async () => {
    const events: string[] = [];
    class FakeFrame {
      className = "";
      title = "";
      allow = "";
      dataset: Record<string, string> = {};
      #listeners = new Map<string, () => void>();
      set src(value: string) {
        events.push(`src:${value}`);
        queueMicrotask(() => this.#listeners.get("load")?.());
      }
      addEventListener(type: string, listener: () => void): void { this.#listeners.set(type, listener); }
      remove(): void { events.push("remove"); }
    }
    vi.stubGlobal("window", { location: { href: "https://example.test/collection/" } });
    vi.stubGlobal("document", { createElement: () => new FakeFrame() });
    const mount = { replaceChildren: () => events.push("mount") } as unknown as HTMLElement;
    const host = new IframeCollectionDocumentHost(mount);
    const moduleA = manifest().modules[0];
    const moduleB = manifest().modules[1];
    await host.replace(moduleA);
    await host.clear();
    await host.replace(moduleB);
    expect(events).toEqual([
      "src:https://example.test/collection/games/module-a/", "mount",
      "src:about:blank", "remove",
      "src:https://example.test/collection/games/module-b/", "mount",
    ]);
    expect(host.resetCount).toBe(1);
  });
});
