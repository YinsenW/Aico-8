import { describe, expect, it } from "vitest";

import { resolvePackageAssetUrl, resolvePackageBaseUrl } from "./package-url.js";

describe("package URL resolution", () => {
  it("keeps every packaged resource inside a nested deployment", () => {
    const base = resolvePackageBaseUrl("./", "https://example.test/games/steps/index.html");
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
});
