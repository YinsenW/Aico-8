import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  GAME_MODULE_SCHEMA_VERSION,
  assertGameModule,
  gameModuleSaveNamespace,
  validateGameModule,
} from "./game-module.js";

const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(
  new URL(`../../../tests/contracts/game-module/${name}`, import.meta.url),
  "utf8",
));
const schema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/game-module-v1.schema.json", import.meta.url),
  "utf8",
));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

function mutated(change: (value: Record<string, any>) => void): unknown {
  const value = structuredClone(fixture("valid-game-module.json")) as Record<string, any>;
  change(value);
  return value;
}

describe("game module contract", () => {
  it("executes JSON Schema and TS validation over the same expressible mutation corpus", () => {
    const draft = mutated((value) => {
      value.status = "draft";
      value.validation = { status: "pending", evidence: [] };
    });
    const corpus: readonly { readonly name: string; readonly value: unknown; readonly accepted: boolean }[] = [
      { name: "validated fixture", value: fixture("valid-game-module.json"), accepted: true },
      { name: "draft fixture", value: draft, accepted: true },
      { name: "closed root", value: mutated((value) => { value.unexpected = true; }), accepted: false },
      { name: "safe path", value: mutated((value) => { value.payload.rom.path = "../escape.rom"; }), accepted: false },
      { name: "Web-only target", value: mutated((value) => { value.runtime.targetBindings[0].target = "android"; }), accepted: false },
      { name: "evidence kind", value: mutated((value) => { value.validation.evidence[0].kind = "release-validation"; }), accepted: false },
      { name: "evidence count", value: mutated((value) => { value.validation.evidence.pop(); }), accepted: false },
      { name: "validated status condition", value: mutated((value) => { value.validation.status = "pending"; }), accepted: false },
      { name: "draft status condition", value: mutated((value) => {
        value.status = "draft";
        value.validation.status = "passed";
      }), accepted: false },
      { name: "hash format", value: mutated((value) => { value.provenance.sourceCartSha256 = "not-a-hash"; }), accepted: false },
    ];
    for (const item of corpus) {
      const schemaAccepted = validateSchema(item.value);
      expect(schemaAccepted, `${item.name}: ${JSON.stringify(validateSchema.errors)}`).toBe(item.accepted);
      expect(validateGameModule(item.value).ok, item.name).toBe(item.accepted);
    }
  });

  it("keeps cross-field namespace and uniqueness rules as explicit TS-only checks", () => {
    const corpus: readonly { readonly name: string; readonly value: unknown; readonly error: RegExp }[] = [
      {
        name: "save namespace binds moduleId",
        value: mutated((value) => { value.save.namespace = "other:aico8.game-module.v1"; }),
        error: /save\.namespace must equal/,
      },
      {
        name: "artifact paths are globally unique",
        value: mutated((value) => { value.mappings.assetPack.path = value.payload.rom.path; }),
        error: /assetPack\.path must be unique/,
      },
      {
        name: "dependency ids are unique",
        value: mutated((value) => {
          value.runtime.dependencies[1].id = value.runtime.dependencies[0].id;
        }),
        error: /dependencies\[1\]\.id must be unique/,
      },
      {
        name: "evidence hashes are unique",
        value: mutated((value) => {
          value.validation.evidence[1].sha256 = value.validation.evidence[0].sha256;
        }),
        error: /evidence\[1\]\.sha256 must be unique/,
      },
    ];
    for (const item of corpus) {
      expect(validateSchema(item.value), `${item.name}: schema should not claim this cross-field rule`).toBe(true);
      const tsResult = validateGameModule(item.value);
      expect(tsResult.ok, item.name).toBe(false);
      expect(tsResult.errors.join("\n")).toMatch(item.error);
    }
  });

  it("round-trips the public validated synthetic fixture", () => {
    const value = fixture("valid-game-module.json");
    expect(validateGameModule(value)).toEqual({ ok: true, errors: [] });
    expect(validateGameModule(JSON.parse(JSON.stringify(value)))).toEqual({ ok: true, errors: [] });
    expect(() => assertGameModule(value)).not.toThrow();
    expect(gameModuleSaveNamespace("synthetic-orbit")).toBe(`synthetic-orbit:${GAME_MODULE_SCHEMA_VERSION}`);
  });

  it("rejects unsafe paths, extra keys, save collisions, non-Web targets, and bad dependency/evidence hashes", () => {
    const result = validateGameModule(fixture("invalid-game-module.json"));
    expect(result.ok).toBe(false);
    const errors = result.errors.join("\n");
    expect(errors).toMatch(/unexpected is not allowed/);
    expect(errors).toMatch(/rom\.path must be a safe relative path/);
    expect(errors).toMatch(/rom\.sha256 must be a sha256/);
    expect(errors).toMatch(/save\.namespace must equal moduleId plus schemaVersion/);
    expect(errors).toMatch(/target.*must equal web-pwa/);
    expect(errors).toMatch(/dependencies\[1\]\.id must be unique/);
    expect(errors).toMatch(/manifestSha256 must be a sha256/);
    expect(errors).toMatch(/evidence\[0\]\.sha256 must be a sha256/);
    expect(errors).toMatch(/must include hd-review-decision/);
  });

  it("keeps draft modules pending and evidence-free", () => {
    const draft = structuredClone(fixture("valid-game-module.json")) as Record<string, any>;
    draft.status = "draft";
    draft.validation = { status: "pending", evidence: [] };
    expect(validateGameModule(draft)).toEqual({ ok: true, errors: [] });
    draft.validation.evidence.push({ kind: "canonical-replay", path: "evidence/replay.json", sha256: "a".repeat(64) });
    expect(validateGameModule(draft).errors.join("\n")).toMatch(/must be empty for a draft module/);
  });

  it("binds a validated module to both independent pre-assembly evidence kinds", () => {
    const value = structuredClone(fixture("valid-game-module.json")) as Record<string, any>;
    value.validation.evidence.pop();
    const errors = validateGameModule(value).errors.join("\n");
    expect(errors).toMatch(/must include hd-review-decision/);
    expect(errors).toMatch(/exactly 2 required records/);
  });

  it("rejects aliased module paths, dependency manifests, and evidence artifacts", () => {
    const value = structuredClone(fixture("valid-game-module.json")) as Record<string, any>;
    value.mappings.assetPack.path = value.payload.rom.path;
    value.runtime.dependencies[1].manifestSha256 = value.runtime.dependencies[0].manifestSha256;
    value.validation.evidence[1].sha256 = value.validation.evidence[0].sha256;
    value.validation.evidence[1].path = value.mappings.audioManifest.path;
    const errors = validateGameModule(value).errors.join("\n");
    expect(errors).toMatch(/assetPack\.path must be unique/);
    expect(errors).toMatch(/dependencies\[1\]\.manifestSha256 must be unique/);
    expect(errors).toMatch(/evidence\[1\]\.sha256 must be unique/);
    expect(errors).toMatch(/evidence\[1\]\.path must be unique/);
  });
});
