import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assembleFixedCollection, type FixedCollectionModuleSource } from "../../../scripts/assemble-fixed-collection.ts";
import { gameModuleSaveNamespace } from "./game-module.js";

const repository = path.resolve(import.meta.dirname, "../../..");
const fixtureRoot = path.join(repository, "tests/fixtures/game-module/synthetic-orbit");
const fixtureManifest = path.join(repository, "tests/contracts/game-module/valid-game-module.json");
const targetProfilePath = path.join(repository, "apps/web/public/target-profile.json");
const temporaryRoots: string[] = [];
const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-fixed-collection-"));
  temporaryRoots.push(root);
  return root;
}

async function treeHashes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else result[path.relative(root, absolute)] = sha256(await fs.readFile(absolute));
    }
  }
  await walk(root);
  return result;
}

async function inputs(root: string): Promise<{
  collectionManifestPath: string;
  modules: FixedCollectionModuleSource[];
}> {
  const baseManifest = JSON.parse(await fs.readFile(fixtureManifest, "utf8"));
  const targetBytes = await fs.readFile(targetProfilePath);
  const targetProfile = JSON.parse(targetBytes.toString("utf8"));
  const licenseBytes = await fs.readFile(path.join(fixtureRoot, "LICENSE.txt"));
  const modules: FixedCollectionModuleSource[] = [];
  const entries: any[] = [];
  for (const [index, suffix] of ["one", "two", "three"].entries()) {
    const moduleId = `synthetic-${suffix}`;
    const moduleRoot = path.join(root, moduleId);
    await fs.cp(fixtureRoot, moduleRoot, { recursive: true });
    const manifest = structuredClone(baseManifest);
    manifest.moduleId = moduleId;
    manifest.save.namespace = gameModuleSaveNamespace(moduleId);
    manifest.provenance.sourceCartSha256 = String(index + 1).repeat(64);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestPath = path.join(root, `${moduleId}.json`);
    await fs.writeFile(manifestPath, manifestBytes);
    modules.push({ moduleId, manifestPath, moduleRoot });
    entries.push({
      moduleId,
      manifestSha256: sha256(manifestBytes),
      saveNamespace: manifest.save.namespace,
      rightsProfile: manifest.provenance.rightsProfile,
      license: { spdxExpression: "Apache-2.0", notice: { path: "LICENSE.txt", sha256: sha256(licenseBytes) } },
    });
  }
  const collection = {
    schemaVersion: "aico8.fixed-collection.v1",
    collectionId: "synthetic-trilogy",
    metadata: { title: "Synthetic Trilogy" },
    targetProfile: { id: targetProfile.id, sha256: sha256(targetBytes) },
    launcher: { initialModuleId: entries[0].moduleId },
    isolation: { resetCompatibilityStateOnSwitch: true, isolatedSaveNamespaces: true },
    budgets: { maxPackagedBytes: 10_000_000, maxPersistentBytes: 768 },
    modules: entries,
  };
  const collectionManifestPath = path.join(root, "collection.json");
  await fs.writeFile(collectionManifestPath, `${JSON.stringify(collection, null, 2)}\n`);
  return { collectionManifestPath, modules };
}

describe("JOB-ASSEMBLE-001 fixed-collection materializer", () => {
  it("materializes deterministic, namespaced module and license trees with bounded evidence", async () => {
    const root = await temporaryRoot();
    const prepared = await inputs(root);
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    const firstResult = await assembleFixedCollection({ ...prepared, targetProfilePath, outputDirectory: first });
    await assembleFixedCollection({ ...prepared, targetProfilePath, outputDirectory: second });
    expect(await treeHashes(first)).toEqual(await treeHashes(second));
    expect(firstResult.evidence).toMatchObject({
      moduleCount: 3,
      declaredPersistentBytes: 768,
      maxPersistentBytes: 768,
      validatedEvidenceFiles: 6,
      resetCompatibilityStateOnSwitch: true,
      isolatedSaveNamespaces: true,
    });
    expect(firstResult.evidence.validatedEvidenceBytes).toBeGreaterThan(0);
    const files = Object.keys(await treeHashes(first));
    for (const suffix of ["one", "two", "three"]) {
      expect(files).toContain(`modules/synthetic-${suffix}/module.json`);
      expect(files).toContain(`modules/synthetic-${suffix}/license/LICENSE.txt`);
      expect(files).toContain(`modules/synthetic-${suffix}/module/payload/source.rom`);
    }
    expect(files.some((file) => file.includes("/evidence/"))).toBe(false);
  });

  it("hash-verifies non-packaged replay and human-review evidence before publishing output", async () => {
    const root = await temporaryRoot();
    const prepared = await inputs(root);
    await fs.appendFile(
      path.join(prepared.modules[1]!.moduleRoot, "evidence/hd-review-decision.json"),
      "tampered",
    );
    const outputDirectory = path.join(root, "tampered-evidence-output");
    await expect(assembleFixedCollection({ ...prepared, targetProfilePath, outputDirectory }))
      .rejects.toThrow(/artifact hash mismatch: synthetic-two\/evidence\/hd-review-decision\.json/);
    await expect(fs.access(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects package-budget overflow and a changed license before publishing output", async () => {
    const root = await temporaryRoot();
    const prepared = await inputs(root);
    const collection = JSON.parse(await fs.readFile(prepared.collectionManifestPath, "utf8"));
    collection.budgets.maxPackagedBytes = 1;
    await fs.writeFile(prepared.collectionManifestPath, `${JSON.stringify(collection, null, 2)}\n`);
    const budgetOutput = path.join(root, "budget-output");
    await expect(assembleFixedCollection({ ...prepared, targetProfilePath, outputDirectory: budgetOutput }))
      .rejects.toThrow(/exceed maxPackagedBytes/);
    await expect(fs.access(budgetOutput)).rejects.toMatchObject({ code: "ENOENT" });

    const changed = await inputs(path.join(root, "changed"));
    await fs.appendFile(path.join(changed.modules[1]!.moduleRoot, "LICENSE.txt"), "tampered");
    const licenseOutput = path.join(root, "license-output");
    await expect(assembleFixedCollection({ ...changed, targetProfilePath, outputDirectory: licenseOutput }))
      .rejects.toThrow(/artifact hash mismatch/);
    await expect(fs.access(licenseOutput)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("admits only one writer for the same collection output", async () => {
    const root = await temporaryRoot();
    const prepared = await inputs(root);
    const outputDirectory = path.join(root, "contended");
    const options = { ...prepared, targetProfilePath, outputDirectory };
    const results = await Promise.allSettled([assembleFixedCollection(options), assembleFixedCollection(options)]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(String((results.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason))
      .toMatch(/reserved by another writer|already exists/);
  });
});
