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
  collectionShellRoot: string;
  modules: FixedCollectionModuleSource[];
}> {
  const baseManifest = JSON.parse(await fs.readFile(fixtureManifest, "utf8"));
  const targetBytes = await fs.readFile(targetProfilePath);
  const targetProfile = JSON.parse(targetBytes.toString("utf8"));
  const licenseBytes = await fs.readFile(path.join(fixtureRoot, "LICENSE.txt"));
  const modules: FixedCollectionModuleSource[] = [];
  const entries: any[] = [];
  const collectionShellRoot = path.join(root, "collection-shell");
  await fs.mkdir(collectionShellRoot, { recursive: true });
  await fs.writeFile(path.join(collectionShellRoot, "index.html"),
    '<!doctype html><link rel="manifest" href="./manifest.webmanifest"><div id="collection-app"></div>\n');
  await fs.writeFile(path.join(collectionShellRoot, "asset-manifest.json"), "{}\n");
  await fs.writeFile(path.join(collectionShellRoot, "manifest.webmanifest"),
    `${JSON.stringify({ name: "Synthetic Trilogy", start_url: "./", scope: "./", display: "standalone" })}\n`);
  await fs.writeFile(path.join(collectionShellRoot, "service-worker.js"),
    'const launcher = "collection-runtime.json"; const games = "games/";\n');
  for (const [index, suffix] of ["one", "two", "three"].entries()) {
    const moduleId = `synthetic-${suffix}`;
    const moduleRoot = path.join(root, moduleId);
    await fs.cp(fixtureRoot, moduleRoot, { recursive: true });
    const manifest = structuredClone(baseManifest);
    manifest.moduleId = moduleId;
    manifest.metadata.title = `Synthetic ${suffix}`;
    manifest.metadata.author = `Author ${suffix}`;
    manifest.save.namespace = gameModuleSaveNamespace(moduleId);
    manifest.provenance.sourceCartSha256 = String(index + 1).repeat(64);
    for (const [evidenceIndex, evidence] of manifest.validation.evidence.entries()) {
      const evidencePath = path.join(moduleRoot, evidence.path);
      await fs.writeFile(evidencePath, `${JSON.stringify({ moduleId, kind: evidence.kind, index: evidenceIndex })}\n`);
      evidence.sha256 = sha256(await fs.readFile(evidencePath));
    }
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const manifestPath = path.join(root, `${moduleId}.json`);
    await fs.writeFile(manifestPath, manifestBytes);
    const standalonePackageRoot = path.join(root, `${moduleId}-web`);
    await fs.mkdir(path.join(standalonePackageRoot, "private"), { recursive: true });
    const packageFiles = new Map<string, Buffer>([
      ["index.html", Buffer.from(`<!doctype html><title>${moduleId}</title><main data-module-id="${moduleId}"></main>\n`)],
      ["private/game.json", Buffer.from(`${JSON.stringify({
        formatVersion: 1,
        researchOnly: true,
        id: moduleId,
        persistenceKey: `aico8.synthetic.${moduleId}.progress.v1`,
      })}\n`)],
      ["target-profile.json", targetBytes],
    ]);
    for (const [relative, bytes] of packageFiles) {
      const output = path.join(standalonePackageRoot, relative);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, bytes);
    }
    const artifacts = [...packageFiles].map(([relative, bytes]) => ({
      path: relative,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
    })).sort((left, right) => left.path.localeCompare(right.path));
    const release: any = {
      schema_version: 1,
      game: { id: moduleId, title: manifest.metadata.title, author: manifest.metadata.author },
      target: "web-pwa",
      presentation: "synthetic",
      output_profile: targetProfile.outputProfile,
      target_profile: { id: targetProfile.id, sha256: sha256(targetBytes) },
      rights: { profile: manifest.provenance.rightsProfile, sourceLicense: "Apache-2.0", sourceUrl: "https://example.test/synthetic" },
      audio: "original",
      identities: { visual_runtime_schema: "aico8.visual-runtime-identity.v1", visual_runtime_sha256: String(index + 4).repeat(64) },
      measurements: { artifact_count: artifacts.length + 1, unpacked_bytes: 0, largest_artifact_bytes: 0, release_manifest_bytes: 1 },
      inputs: [{ path: "source.rom", sha256: String(index + 7).repeat(64), bytes: 1 }],
      artifacts,
    };
    let releaseBytes = Buffer.alloc(0);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
      const next = {
        artifact_count: artifacts.length + 1,
        unpacked_bytes: releaseBytes.byteLength + artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0),
        largest_artifact_bytes: Math.max(releaseBytes.byteLength, ...artifacts.map(({ bytes }) => bytes)),
        release_manifest_bytes: releaseBytes.byteLength,
      };
      if (JSON.stringify(next) === JSON.stringify(release.measurements)) break;
      release.measurements = next;
    }
    releaseBytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
    await fs.writeFile(path.join(standalonePackageRoot, "release-manifest.json"), releaseBytes);
    modules.push({ moduleId, manifestPath, moduleRoot, standalonePackageRoot });
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
  return { collectionManifestPath, collectionShellRoot, modules };
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
      declaredResetCompatibilityStateOnSwitch: true,
      declaredIsolatedSaveNamespaces: true,
    });
    expect(firstResult.evidence.validatedEvidenceBytes).toBeGreaterThan(0);
    const files = Object.keys(await treeHashes(first));
    for (const suffix of ["one", "two", "three"]) {
      expect(files).toContain(`modules/synthetic-${suffix}/module.json`);
      expect(files).toContain(`modules/synthetic-${suffix}/license/LICENSE.txt`);
      expect(files).toContain(`modules/synthetic-${suffix}/module/payload/source.rom`);
      expect(files).toContain(`games/synthetic-${suffix}/index.html`);
    }
    expect(files).toContain("index.html");
    expect(files).toContain("collection-runtime.json");
    expect(files).toContain("THIRD-PARTY-NOTICES.json");
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

  it("recomputes standalone package identities and rejects package or persistence-key reuse", async () => {
    const root = await temporaryRoot();
    const prepared = await inputs(root);
    await fs.appendFile(path.join(prepared.modules[0]!.standalonePackageRoot, "index.html"), "tampered");
    await expect(assembleFixedCollection({ ...prepared, targetProfilePath, outputDirectory: path.join(root, "tampered-package") }))
      .rejects.toThrow(/artifact byte mismatch|artifact hash mismatch/);

    const repeated = await inputs(path.join(root, "repeated"));
    const firstGame = JSON.parse(await fs.readFile(path.join(repeated.modules[0]!.standalonePackageRoot, "private/game.json"), "utf8"));
    const secondGamePath = path.join(repeated.modules[1]!.standalonePackageRoot, "private/game.json");
    const secondGame = JSON.parse(await fs.readFile(secondGamePath, "utf8"));
    secondGame.persistenceKey = firstGame.persistenceKey;
    await fs.writeFile(secondGamePath, `${JSON.stringify(secondGame)}\n`);
    await expect(assembleFixedCollection({ ...repeated, targetProfilePath, outputDirectory: path.join(root, "repeated-key") }))
      .rejects.toThrow(/artifact byte mismatch|artifact hash mismatch|persistence keys must be unique/);
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
