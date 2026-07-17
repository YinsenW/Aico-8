import { validateAndroidWebLineage } from "@aico8/contracts";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleAndroidWebAssets,
  inventoryWebAssets,
  verifyAndroidWebLineage,
  webAssetTreeSha256,
} from "./android-lineage.js";

const temporaryRoots: string[] = [];
const repository = path.resolve(import.meta.dirname, "../../..");

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-android-lineage-"));
  temporaryRoots.push(root);
  return root;
}

async function createValidatedWebPackage(root: string): Promise<string> {
  const output = path.join(root, "web");
  await fs.mkdir(output, { recursive: true });
  const targetBytes = await fs.readFile(path.join(repository, "apps/web/public/target-profile.json"));
  const indexBytes = Buffer.from("<!doctype html><title>Aico 8</title>\n");
  await fs.writeFile(path.join(output, "index.html"), indexBytes);
  await fs.writeFile(path.join(output, "target-profile.json"), targetBytes);
  const artifacts = [
    { path: "index.html", sha256: sha256(indexBytes), bytes: indexBytes.length },
    { path: "target-profile.json", sha256: sha256(targetBytes), bytes: targetBytes.length },
  ];
  const target = JSON.parse(targetBytes.toString("utf8")) as { id: string };
  const release = {
    schema_version: 1,
    game: { id: "synthetic-private-research", title: "Synthetic", author: "Aico 8" },
    target: "web-pwa",
    presentation: "synthetic-hd",
    output_profile: "hd-1024-square",
    target_profile: { id: target.id, sha256: sha256(targetBytes) },
    rights: { profile: "private-research-only", sourceLicense: "Apache-2.0", sourceUrl: "https://example.invalid" },
    audio: "synthetic-silent",
    identities: { visual_runtime_schema: "aico8.visual-runtime-identity.v1", visual_runtime_sha256: "a".repeat(64) },
    measurements: { artifact_count: 3, unpacked_bytes: 0, largest_artifact_bytes: 0, release_manifest_bytes: 0 },
    inputs: [{ path: "source.rom", sha256: "b".repeat(64), bytes: 32768 }],
    artifacts,
  };
  let previousLength = -1;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const bytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
    release.measurements.release_manifest_bytes = bytes.length;
    release.measurements.unpacked_bytes = artifacts.reduce((sum, artifact) => sum + artifact.bytes, bytes.length);
    release.measurements.largest_artifact_bytes = Math.max(bytes.length, ...artifacts.map((artifact) => artifact.bytes));
    if (bytes.length === previousLength) break;
    previousLength = bytes.length;
  }
  await fs.writeFile(path.join(output, "release-manifest.json"), `${JSON.stringify(release, null, 2)}\n`);
  return output;
}

async function addNestedArtifact(output: string): Promise<void> {
  const releasePath = path.join(output, "release-manifest.json");
  const release = JSON.parse(await fs.readFile(releasePath, "utf8")) as {
    artifacts: Array<{ path: string; sha256: string; bytes: number }>;
    measurements: { artifact_count: number; unpacked_bytes: number; largest_artifact_bytes: number; release_manifest_bytes: number };
  };
  const nestedBytes = Buffer.from("nested\n");
  await fs.mkdir(path.join(output, "assets"));
  await fs.writeFile(path.join(output, "assets", "z.js"), nestedBytes);
  release.artifacts.push({ path: "assets/z.js", sha256: sha256(nestedBytes), bytes: nestedBytes.length });
  release.artifacts.sort((left, right) => left.path.localeCompare(right.path));
  let previousLength = -1;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const bytes = Buffer.from(`${JSON.stringify(release, null, 2)}\n`);
    release.measurements.release_manifest_bytes = bytes.length;
    release.measurements.artifact_count = release.artifacts.length + 1;
    release.measurements.unpacked_bytes = release.artifacts.reduce((sum, artifact) => sum + artifact.bytes, bytes.length);
    release.measurements.largest_artifact_bytes = Math.max(bytes.length, ...release.artifacts.map((artifact) => artifact.bytes));
    if (bytes.length === previousLength) break;
    previousLength = bytes.length;
  }
  await fs.writeFile(releasePath, `${JSON.stringify(release, null, 2)}\n`);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Android Web artifact lineage", () => {
  it("assembles and verifies a byte-identical Web package", async () => {
    const root = await temporaryRoot();
    const sourcePackage = await createValidatedWebPackage(root);
    await addNestedArtifact(sourcePackage);
    const stagedDirectory = path.join(root, "www");
    const lineageFile = path.join(root, "lineage.json");
    const androidTargetProfile = path.join(repository, "apps/mobile/target-profile.json");
    const lineage = await assembleAndroidWebAssets({
      sourcePackage,
      androidTargetProfile,
      outputDirectory: stagedDirectory,
      lineageFile,
    });
    expect(validateAndroidWebLineage(lineage)).toEqual({ ok: true, errors: [] });
    expect(lineage.webAssets.treeSha256).toBe(webAssetTreeSha256(await inventoryWebAssets(sourcePackage)));
    await expect(verifyAndroidWebLineage({ sourcePackage, androidTargetProfile, stagedDirectory, lineageFile }))
      .resolves.toEqual(lineage);
  });

  it("rejects source drift, staging drift, undeclared native assets, and symlinks", async () => {
    const root = await temporaryRoot();
    const sourcePackage = await createValidatedWebPackage(root);
    const stagedDirectory = path.join(root, "www");
    const lineageFile = path.join(root, "lineage.json");
    const androidTargetProfile = path.join(root, "android-target-profile.json");
    await fs.copyFile(path.join(repository, "apps/mobile/target-profile.json"), androidTargetProfile);
    await assembleAndroidWebAssets({
      sourcePackage,
      androidTargetProfile,
      outputDirectory: stagedDirectory,
      lineageFile,
    });

    await fs.writeFile(path.join(stagedDirectory, "index.html"), "drift");
    const verifyOptions = { sourcePackage, androidTargetProfile, stagedDirectory, lineageFile };
    await expect(verifyAndroidWebLineage(verifyOptions)).rejects.toThrow(/Staged Web assets differs/);
    await fs.copyFile(path.join(sourcePackage, "index.html"), path.join(stagedDirectory, "index.html"));

    const androidAssetsDirectory = path.join(root, "android-assets");
    await fs.cp(stagedDirectory, androidAssetsDirectory, { recursive: true });
    await fs.writeFile(path.join(androidAssetsDirectory, "cordova.js"), "// generated\n");
    await fs.writeFile(path.join(androidAssetsDirectory, "cordova_plugins.js"), "// generated\n");
    await expect(verifyAndroidWebLineage({ ...verifyOptions, androidAssetsDirectory })).resolves.toBeDefined();
    await fs.writeFile(path.join(androidAssetsDirectory, "injected.js"), "bad");
    await expect(verifyAndroidWebLineage({ ...verifyOptions, androidAssetsDirectory })).rejects.toThrow(/differs|undeclared/);

    await fs.writeFile(path.join(sourcePackage, "index.html"), "source drift");
    await expect(verifyAndroidWebLineage(verifyOptions)).rejects.toThrow(/Source Web package differs/);

    const target = JSON.parse(await fs.readFile(androidTargetProfile, "utf8")) as { id: string };
    target.id = "android-target-drift";
    await fs.writeFile(androidTargetProfile, `${JSON.stringify(target, null, 2)}\n`);
    await expect(verifyAndroidWebLineage(verifyOptions)).rejects.toThrow(/target profile identity differs/);

    const symlinkRoot = path.join(root, "symlink-web");
    await fs.mkdir(symlinkRoot);
    await fs.symlink(path.join(sourcePackage, "index.html"), path.join(symlinkRoot, "index.html"));
    await expect(inventoryWebAssets(symlinkRoot)).rejects.toThrow(/symlink/);
  });
});
