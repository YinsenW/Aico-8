import { describe, expect, it } from "vitest";

import {
  resolvePackageAssetUrl,
  resolvePackageBaseUrl,
  resolvePackageChildAssetUrl,
} from "./package-url.js";

describe("package URL resolution", () => {
  it("keeps every packaged resource inside a nested deployment", () => {
    const base = resolvePackageBaseUrl(
      "./",
      "https://example.test/games/steps/index.html?validation-update=16#capture",
    );
    expect(base.href).toBe("https://example.test/games/steps/");
    expect(resolvePackageAssetUrl(base, "private/game.json").href)
      .toBe("https://example.test/games/steps/private/game.json");
    expect(resolvePackageAssetUrl(base, "kernel/aico8-kernel.js").href)
      .toBe("https://example.test/games/steps/kernel/aico8-kernel.js");
  });

  it("retains a configured nested base and rejects root-absolute package paths", () => {
    const base = resolvePackageBaseUrl("/catalog/steps/", "https://example.test/host/index.html");
    expect(base.href).toBe("https://example.test/catalog/steps/");
    expect(() => resolvePackageAssetUrl(base, "/private/game.json")).toThrow(/must be relative/);
  });

  it("rejects cross-origin package bases", () => {
    expect(() => resolvePackageBaseUrl(
      "https://cdn.invalid/steps/",
      "https://example.test/games/steps/index.html",
    )).toThrow(/share the document origin/);
  });

  it("resolves manifest children inside the package while rejecting an escaping child", () => {
    const base = resolvePackageBaseUrl("./", "https://example.test/games/steps/index.html");
    const manifest = resolvePackageAssetUrl(base, "private/game.json");
    expect(resolvePackageChildAssetUrl(base, manifest, "steps/source.rom").href)
      .toBe("https://example.test/games/steps/private/steps/source.rom");
    expect(() => resolvePackageChildAssetUrl(base, manifest, "../../escape.rom"))
      .toThrow(/Package asset path/);
  });

  it.each([
    "../escape.js",
    "private/../../escape.js",
    "https://cdn.invalid/escape.js",
    "//cdn.invalid/escape.js",
    "private/%2e%2e/escape.js",
    "private/%2Fescape.js",
    "private/%5cescape.js",
    "private//escape.js",
    "private/game.json?version=1",
    "private/game.json#fragment",
  ])("rejects an unsafe or escaping package asset path: %s", (relativePath) => {
    const base = resolvePackageBaseUrl("./", "https://example.test/games/steps/index.html");
    expect(() => resolvePackageAssetUrl(base, relativePath)).toThrow(/Package asset path/);
  });
});
