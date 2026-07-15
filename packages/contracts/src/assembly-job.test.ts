import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assembleSingleGameModule } from "../../../scripts/assemble-game-module.ts";

const repository = path.resolve(import.meta.dirname, "../../..");
const moduleManifestPath = path.join(repository, "tests/contracts/game-module/valid-game-module.json");
const moduleRoot = path.join(repository, "tests/fixtures/game-module/synthetic-orbit");
const targetProfilePath = path.join(repository, "apps/web/public/target-profile.json");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-assembly-"));
  temporaryRoots.push(root);
  return root;
}

async function treeHashes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else result[path.relative(root, absolute)] = createHash("sha256").update(await fs.readFile(absolute)).digest("hex");
    }
  }
  await walk(root);
  return result;
}

describe("JOB-ASSEMBLE-001 single-game materializer", () => {
  it("materializes byte-identical staging trees from public synthetic input", async () => {
    const root = await temporaryRoot();
    const first = path.join(root, "first");
    const second = path.join(root, "second");
    await assembleSingleGameModule({ moduleManifestPath, moduleRoot, targetProfilePath, outputDirectory: first });
    await assembleSingleGameModule({ moduleManifestPath, moduleRoot, targetProfilePath, outputDirectory: second });
    expect(await treeHashes(first)).toEqual(await treeHashes(second));
    expect(Object.keys(await treeHashes(first))).toEqual(expect.arrayContaining([
      "assembly-plan.json", "target-profile.json", "module/payload/source.rom",
      "module/presentation/synthetic-orbit.ts", "module/audio/manifest.json",
    ]));
    expect(Object.keys(await treeHashes(first)).some((item) => item.includes("evidence"))).toBe(false);
  });

  it("fails closed before output when a bound artifact is changed", async () => {
    const root = await temporaryRoot();
    const copiedModule = path.join(root, "module");
    await fs.cp(moduleRoot, copiedModule, { recursive: true });
    await fs.appendFile(path.join(copiedModule, "payload/source.rom"), "tampered");
    const outputDirectory = path.join(root, "output");
    await expect(assembleSingleGameModule({ moduleManifestPath, moduleRoot: copiedModule, targetProfilePath, outputDirectory }))
      .rejects.toThrow(/artifact hash mismatch/);
    await expect(fs.access(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a hash-valid artifact symlink whose real path escapes moduleRoot", async ({ skip }) => {
    const root = await temporaryRoot();
    const copiedModule = path.join(root, "module");
    await fs.cp(moduleRoot, copiedModule, { recursive: true });
    const outsideArtifact = path.join(root, "outside-source.rom");
    await fs.copyFile(path.join(moduleRoot, "payload/source.rom"), outsideArtifact);
    const linkedArtifact = path.join(copiedModule, "payload/source.rom");
    await fs.rm(linkedArtifact);
    try {
      await fs.symlink(outsideArtifact, linkedArtifact, "file");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "EPERM" || code === "EACCES" || code === "ENOSYS") { skip(); return; }
      throw error;
    }
    const outputDirectory = path.join(root, "output");
    await expect(assembleSingleGameModule({ moduleManifestPath, moduleRoot: copiedModule, targetProfilePath, outputDirectory }))
      .rejects.toThrow(/real path escapes module root/);
    await expect(fs.access(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an existing output directory instead of overwriting it", async () => {
    const root = await temporaryRoot();
    const outputDirectory = path.join(root, "existing");
    await fs.mkdir(outputDirectory);
    await expect(assembleSingleGameModule({ moduleManifestPath, moduleRoot, targetProfilePath, outputDirectory }))
      .rejects.toThrow(/output already exists/);
  });

  it("admits only one writer racing to publish the same output", async () => {
    const root = await temporaryRoot();
    const outputDirectory = path.join(root, "contended");
    const options = { moduleManifestPath, moduleRoot, targetProfilePath, outputDirectory };
    const results = await Promise.allSettled([
      assembleSingleGameModule(options),
      assembleSingleGameModule(options),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/reserved by another writer|output already exists/);
    expect(await fs.readFile(path.join(outputDirectory, "assembly-plan.json"), "utf8"))
      .toContain('"moduleId": "synthetic-orbit"');
  });
});
