import { createHash } from "node:crypto";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { FIXED_COLLECTION_SCHEMA_VERSION, validateFixedCollection } from "./fixed-collection.js";

const schema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/fixed-collection-v1.schema.json", import.meta.url), "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

function fixture(): any {
  return {
    schemaVersion: FIXED_COLLECTION_SCHEMA_VERSION,
    collectionId: "synthetic-trilogy",
    metadata: { title: "Synthetic Trilogy" },
    targetProfile: { id: "web-square", sha256: hash("profile") },
    launcher: { initialModuleId: "module-one" },
    isolation: { resetCompatibilityStateOnSwitch: true, isolatedSaveNamespaces: true },
    budgets: { maxPackagedBytes: 10_000_000, maxPersistentBytes: 768 },
    modules: ["one", "two", "three"].map((suffix) => ({
      moduleId: `module-${suffix}`,
      manifestSha256: hash(`manifest-${suffix}`),
      saveNamespace: `module-${suffix}:aico8.game-module.v1`,
      rightsProfile: "synthetic-public-fixture",
      license: { spdxExpression: "Apache-2.0", notice: { path: "LICENSE.txt", sha256: hash("license") } },
    })),
  };
}

describe("DATA-COLLECTION-001 fixed collection", () => {
  it("accepts one ordered, budgeted, isolated collection with complete per-module license bindings", () => {
    const value = fixture();
    expect(validateSchema(value), JSON.stringify(validateSchema.errors)).toBe(true);
    expect(validateFixedCollection(value)).toEqual({ ok: true, errors: [] });
  });

  it("rejects fewer than three modules and incomplete isolation or license declarations", () => {
    const tooSmall = fixture();
    tooSmall.modules.pop();
    expect(validateFixedCollection(tooSmall).errors.join("\n")).toMatch(/at least three/);

    const noReset = fixture();
    noReset.isolation.resetCompatibilityStateOnSwitch = false;
    expect(validateFixedCollection(noReset).errors.join("\n")).toMatch(/resetCompatibilityStateOnSwitch/);

    const noLicense = fixture();
    delete noLicense.modules[1].license.notice;
    expect(validateFixedCollection(noLicense).errors.join("\n")).toMatch(/license\.notice/);
  });

  it("rejects duplicate module, manifest, and save identities plus an unknown launcher target", () => {
    for (const [mutate, pattern] of [
      [(value: any) => { value.modules[1].moduleId = value.modules[0].moduleId; }, /moduleId must be unique/],
      [(value: any) => { value.modules[1].manifestSha256 = value.modules[0].manifestSha256; }, /manifestSha256 must be unique/],
      [(value: any) => { value.modules[1].saveNamespace = value.modules[0].saveNamespace; }, /saveNamespace must be unique/],
      [(value: any) => { value.launcher.initialModuleId = "missing"; }, /must identify one declared module/],
    ] as const) {
      const value = fixture();
      mutate(value);
      expect(validateFixedCollection(value).errors.join("\n")).toMatch(pattern);
    }
  });

  it("keeps JSON Schema and executable validation aligned for schema-expressible mutations", () => {
    for (const mutate of [
      (value: any) => { value.schemaVersion = "wrong"; },
      (value: any) => { value.modules = value.modules.slice(0, 2); },
      (value: any) => { value.modules[0].license.spdxExpression = ""; },
      (value: any) => { value.budgets.maxPackagedBytes = 0; },
      (value: any) => { value.modules[0].license.notice.path = "../LICENSE"; },
    ]) {
      const value = fixture();
      mutate(value);
      expect(validateSchema(value)).toBe(false);
      expect(validateFixedCollection(value).ok).toBe(false);
    }
  });
});
