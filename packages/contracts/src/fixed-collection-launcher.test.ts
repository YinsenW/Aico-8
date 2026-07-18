import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateFixedCollectionLauncher } from "./fixed-collection-launcher.js";

const schema = JSON.parse(readFileSync(
  new URL("../../../specs/schemas/fixed-collection-launcher-v1.schema.json", import.meta.url), "utf8",
));
const schemaValidate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function launcher(): Record<string, any> {
  return {
    schemaVersion: "aico8.fixed-collection-launcher.v1",
    collectionId: "private-trilogy",
    title: "Private Trilogy",
    targetProfile: { id: "web-hd", sha256: "a".repeat(64) },
    initialModuleId: "module-a",
    resetMode: "document-replacement",
    modules: ["a", "b", "c"].map((suffix, index) => ({
      moduleId: `module-${suffix}`,
      title: `Module ${suffix.toUpperCase()}`,
      author: `Author ${suffix.toUpperCase()}`,
      launchPath: `games/module-${suffix}/`,
      saveNamespace: `module-${suffix}:aico8.game-module.v1`,
      rightsProfile: "private-research",
      package: {
        releaseManifestSha256: String(index + 1).repeat(64),
        treeSha256: String(index + 4).repeat(64),
      },
    })),
  };
}

describe("fixed collection launcher contract", () => {
  it("accepts one content-bound three-game document-replacement launcher", () => {
    const value = launcher();
    expect(validateFixedCollectionLauncher(value)).toEqual({ ok: true, errors: [] });
    expect(schemaValidate(value), JSON.stringify(schemaValidate.errors)).toBe(true);
  });

  it.each([
    ["too few modules", true, (value: any) => { value.modules.pop(); }],
    ["unknown initial module", false, (value: any) => { value.initialModuleId = "missing"; }],
    ["shared save namespace", false, (value: any) => { value.modules[1].saveNamespace = value.modules[0].saveNamespace; }],
    ["shared package tree", false, (value: any) => { value.modules[1].package.treeSha256 = value.modules[0].package.treeSha256; }],
    ["unsafe launch path", true, (value: any) => { value.modules[0].launchPath = "../outside/"; }],
    ["non-resetting switch", true, (value: any) => { value.resetMode = "reuse-runtime"; }],
  ])("rejects %s", (_name, schemaRejects, mutate) => {
    const value = launcher();
    mutate(value);
    expect(validateFixedCollectionLauncher(value).ok).toBe(false);
    expect(schemaValidate(value)).toBe(!schemaRejects);
  });
});
