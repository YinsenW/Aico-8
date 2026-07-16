import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  CART_INPUT_SCHEMA_VERSION,
  CART_WORKSPACE_SCHEMA_VERSION,
  assertCartInput,
  assertCartWorkspace,
  type CartInputV1,
  validateCartInput,
  validateCartWorkspace,
} from "./ingest.js";

const fixtureRoot = new URL("../../../tests/fixtures/ingest/synthetic-alias/", import.meta.url);
const readJson = (name: string): any => JSON.parse(fs.readFileSync(new URL(name, fixtureRoot), "utf8"));
const inputSchema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/cart-input-v1.schema.json", import.meta.url), "utf8",
));
const workspaceSchema = JSON.parse(fs.readFileSync(
  new URL("../../../specs/schemas/cart-workspace-v1.schema.json", import.meta.url), "utf8",
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateInputSchema = ajv.compile(inputSchema);
const validateWorkspaceSchema = ajv.compile(workspaceSchema);

function mutated<T>(name: string, change: (value: any) => void): T {
  const value = structuredClone(readJson(name));
  change(value);
  return value as T;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("ingest manifests", () => {
  it("executes JSON Schema and TS validation over the same cart-input mutation corpus", () => {
    const corpus = [
      { name: "valid public synthetic input", value: readJson("cart-input.json"), accepted: true },
      { name: "closed root", value: mutated("cart-input.json", (v) => { v.unexpected = true; }), accepted: false },
      { name: "safe source path", value: mutated("cart-input.json", (v) => { v.source.path = "../source.p8"; }), accepted: false },
      { name: "source hash", value: mutated("cart-input.json", (v) => { v.source.sha256 = "bad"; }), accepted: false },
      { name: "license evidence", value: mutated("cart-input.json", (v) => { v.provenance.declaredLicense.evidence = []; }), accepted: false },
      { name: "public permission", value: mutated("cart-input.json", (v) => { v.provenance.releasePermission.status = "unknown"; }), accepted: false },
      { name: "granted evidence", value: mutated("cart-input.json", (v) => { v.provenance.releasePermission.evidence = []; }), accepted: false },
    ];
    for (const item of corpus) {
      expect(validateInputSchema(item.value), `${item.name}: ${JSON.stringify(validateInputSchema.errors)}`).toBe(item.accepted);
      expect(validateCartInput(item.value).ok, item.name).toBe(item.accepted);
    }
  });

  it("executes JSON Schema and TS validation over the same workspace mutation corpus", () => {
    const input = readJson("cart-input.json") as CartInputV1;
    const corpus = [
      { name: "valid workspace", value: readJson("workspace.json"), accepted: true },
      { name: "unknown section preserved", value: mutated("workspace.json", (v) => {
        v.pico8.sections.push("meta");
        v.pico8.sectionOrder.push("meta");
      }), accepted: true },
      { name: "closed root", value: mutated("workspace.json", (v) => { v.unexpected = true; }), accepted: false },
      { name: "complete resource set", value: mutated("workspace.json", (v) => { v.resources.pop(); }), accepted: false },
      { name: "resource identity", value: mutated("workspace.json", (v) => { v.resources[0].id = "other"; }), accepted: false },
      { name: "resource section", value: mutated("workspace.json", (v) => { v.resources[1].sourceSection = "map"; }), accepted: false },
      { name: "fixed alias geometry", value: mutated("workspace.json", (v) => { v.aliases[0].offset = 0; }), accepted: false },
      { name: "fixed conflict policy", value: mutated("workspace.json", (v) => { v.aliases[0].conflictPolicy = "last-write-wins"; }), accepted: false },
      { name: "codec revision", value: mutated("workspace.json", (v) => { v.codec.revisionSha256 = "floating"; }), accepted: false },
      { name: "rebuild equality", value: mutated("workspace.json", (v) => { v.rebuild.sourceEquivalent = false; }), accepted: false },
      { name: "rights evidence", value: mutated("workspace.json", (v) => { v.provenance.rightsEvidenceSha256 = []; }), accepted: false },
    ];
    for (const item of corpus) {
      expect(validateWorkspaceSchema(item.value), `${item.name}: ${JSON.stringify(validateWorkspaceSchema.errors)}`).toBe(item.accepted);
      expect(validateCartWorkspace(item.value, input).ok, item.name).toBe(item.accepted);
    }
  });

  it("enforces cross-field source, section, alias, path, and rights bindings", () => {
    const input = readJson("cart-input.json") as CartInputV1;
    const corpus: readonly { name: string; value: unknown; error: RegExp }[] = [
      { name: "workspace identity", value: mutated("workspace.json", (v) => { v.workspaceId = "other"; }), error: /workspaceId must equal/ },
      { name: "source binding", value: mutated("workspace.json", (v) => { v.provenance.sourceSha256 = "a".repeat(64); }), error: /sourceSha256 must bind/ },
      { name: "manifest binding", value: mutated("workspace.json", (v) => { v.provenance.cartInputManifestSha256 = "a".repeat(64); }), error: /cartInputManifestSha256 must bind/ },
      { name: "section presence", value: mutated("workspace.json", (v) => { v.pico8.sectionOrder.pop(); }), error: /sectionOrder must contain exactly/ },
      { name: "artifact collision", value: mutated("workspace.json", (v) => { v.resources[1].artifact.path = v.resources[0].artifact.path; }), error: /artifact\.path must be unique/ },
      { name: "alias baseline", value: mutated("workspace.json", (v) => { v.aliases[0].baselineSemanticSha256 = "a".repeat(64); }), error: /must bind the shared-map-alias/ },
      { name: "permission lineage", value: mutated("workspace.json", (v) => { v.provenance.rightsEvidenceSha256[0] = "a".repeat(64); }), error: /must exactly bind cart input/ },
    ];
    for (const item of corpus) {
      const result = validateCartWorkspace(item.value, input);
      expect(result.ok, item.name).toBe(false);
      expect(result.errors.join("\n"), item.name).toMatch(item.error);
    }
  });

  it("round-trips the public synthetic manifests and verifies every declared artifact", () => {
    const input = readJson("cart-input.json") as CartInputV1;
    const workspace = readJson("workspace.json");
    expect(input.schemaVersion).toBe(CART_INPUT_SCHEMA_VERSION);
    expect(workspace.schemaVersion).toBe(CART_WORKSPACE_SCHEMA_VERSION);
    expect(() => assertCartInput(input)).not.toThrow();
    expect(() => assertCartWorkspace(workspace, input)).not.toThrow();
    expect(validateCartInput(JSON.parse(JSON.stringify(input))).ok).toBe(true);
    expect(validateCartWorkspace(JSON.parse(JSON.stringify(workspace)), input).ok).toBe(true);

    const references = [
      input.source,
      ...input.provenance.declaredLicense.evidence,
      ...input.provenance.releasePermission.evidence,
      workspace.input.manifest,
      ...workspace.resources.map((resource: any) => resource.artifact),
      workspace.rebuild.rebuiltCart,
      workspace.rebuild.decodedRomHex,
    ];
    for (const reference of references) {
      const bytes = fs.readFileSync(path.join(fileURLToPath(fixtureRoot), reference.path));
      expect(bytes.length, reference.path).toBe(reference.byteLength);
      expect(sha256(bytes), reference.path).toBe(reference.sha256);
    }
    expect(fs.readFileSync(new URL(input.source.path, fixtureRoot))).toEqual(
      fs.readFileSync(new URL(workspace.rebuild.rebuiltCart.path, fixtureRoot)),
    );
  });
});
