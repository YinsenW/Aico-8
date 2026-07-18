#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  planFixedCollectionAssembly,
  type FixedCollectionAssemblyPlanV1,
} from "../packages/contracts/src/assembly.ts";
import { assertFixedCollectionLauncher, type FixedCollectionLauncherV1 } from "../packages/contracts/src/fixed-collection-launcher.ts";
import type { FixedCollectionV1 } from "../packages/contracts/src/fixed-collection.ts";
import type { GameModuleV1 } from "../packages/contracts/src/game-module.ts";
import { verifyStandaloneWebPackage, type VerifiedStandaloneWebPackage } from "./lib/standalone-web-package.ts";

export interface FixedCollectionModuleSource {
  readonly moduleId: string;
  readonly manifestPath: string;
  readonly moduleRoot: string;
  readonly standalonePackageRoot: string;
}

export interface AssembleFixedCollectionOptions {
  readonly collectionManifestPath: string;
  readonly modules: readonly FixedCollectionModuleSource[];
  readonly targetProfilePath: string;
  readonly collectionShellRoot: string;
  readonly outputDirectory: string;
}

export interface FixedCollectionBuildEvidenceV1 {
  readonly schemaVersion: "aico8.fixed-collection-build.v1";
  readonly collectionId: string;
  readonly collectionManifestSha256: string;
  readonly targetProfileSha256: string;
  readonly assemblyPlanSha256: string;
  readonly launcherManifestSha256: string;
  readonly collectionShellTreeSha256: string;
  readonly assembledProductTreeSha256: string;
  readonly moduleCount: number;
  readonly packagedArtifactBytes: number;
  readonly maxPackagedBytes: number;
  readonly declaredPersistentBytes: number;
  readonly maxPersistentBytes: number;
  readonly validatedEvidenceFiles: number;
  readonly validatedEvidenceBytes: number;
  readonly declaredResetCompatibilityStateOnSwitch: true;
  readonly declaredIsolatedSaveNamespaces: true;
  readonly modulePackages: readonly {
    readonly moduleId: string;
    readonly releaseManifestSha256: string;
    readonly treeSha256: string;
    readonly persistenceKey: string;
  }[];
}

export interface AssembleFixedCollectionResult {
  readonly plan: FixedCollectionAssemblyPlanV1;
  readonly launcher: FixedCollectionLauncherV1;
  readonly evidence: FixedCollectionBuildEvidenceV1;
  readonly outputDirectory: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalTreeSha256(files: ReadonlyMap<string, Uint8Array>): string {
  const entries = [...files].map(([relativePath, bytes]) => ({
    path: relativePath,
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  })).sort((left, right) => left.path.localeCompare(right.path));
  return sha256(Buffer.from(JSON.stringify({ schemaVersion: "aico8.file-tree-identity.v1", entries })));
}

function addProductFile(files: Map<string, Buffer>, relativePath: string, bytes: Buffer): void {
  if (files.has(relativePath)) throw new Error(`Collection product path collision: ${relativePath}`);
  resolveContained("/collection-product", relativePath);
  files.set(relativePath, bytes);
}

async function readRegularTree(root: string, label: string): Promise<ReadonlyMap<string, Buffer>> {
  const realRoot = await fs.realpath(path.resolve(root));
  if (!(await fs.stat(realRoot)).isDirectory()) throw new Error(`${label} must be a directory`);
  const files = new Map<string, Buffer>();
  async function walk(directory: string, prefix: string): Promise<void> {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains symlink: ${relative}`);
      if (entry.isDirectory()) await walk(absolute, relative);
      else if (entry.isFile()) files.set(relative, await fs.readFile(absolute));
      else throw new Error(`${label} contains unsupported entry: ${relative}`);
    }
  }
  await walk(realRoot, "");
  return files;
}

async function readCollectionShell(root: string): Promise<ReadonlyMap<string, Buffer>> {
  const files = await readRegularTree(root, "Collection shell");
  for (const required of ["index.html", "asset-manifest.json", "manifest.webmanifest", "service-worker.js"]) {
    if (!files.has(required)) throw new Error(`Collection shell is missing ${required}`);
  }
  for (const reserved of ["collection-runtime.json", "collection.json", "target-profile.json", "assembly-plan.json", "collection-build.json", "THIRD-PARTY-NOTICES.json"]) {
    if (files.has(reserved)) throw new Error(`Collection shell occupies reserved output path: ${reserved}`);
  }
  if ([...files.keys()].some((relative) => relative.startsWith("games/") || relative.startsWith("modules/"))) {
    throw new Error("Collection shell may not contain games/ or modules/ inputs");
  }
  const html = files.get("index.html")!.toString("utf8");
  const serviceWorker = files.get("service-worker.js")!.toString("utf8");
  const manifest = JSON.parse(files.get("manifest.webmanifest")!.toString("utf8"));
  if (!html.includes("collection-app") || !html.includes("manifest.webmanifest")) {
    throw new Error("Collection shell index must be the installable collection entry");
  }
  if (manifest.start_url !== "./" || manifest.scope !== "./" || manifest.display !== "standalone") {
    throw new Error("Collection shell manifest must define a scoped standalone PWA");
  }
  for (const required of ["collection-runtime.json", "games/"]) {
    if (!serviceWorker.includes(required)) throw new Error(`Collection service worker must bind ${required}`);
  }
  return files;
}

function resolveContained(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Collection module artifact escapes module root: ${relative}`);
  }
  return resolved;
}

async function resolveExistingContained(rootRealPath: string, relative: string): Promise<string> {
  const lexicalPath = resolveContained(rootRealPath, relative);
  const realPath = await fs.realpath(lexicalPath);
  if (realPath === rootRealPath || !realPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error(`Collection module artifact real path escapes module root: ${relative}`);
  }
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) throw new Error(`Collection module artifact must be a regular file: ${relative}`);
  return realPath;
}

async function reserveOutput(outputDirectory: string): Promise<{ parent: string; reservation: string }> {
  const parent = path.dirname(outputDirectory);
  await fs.mkdir(parent, { recursive: true });
  const reservation = path.join(parent, `.${path.basename(outputDirectory)}.collection-assembly-lock`);
  try {
    await fs.mkdir(reservation, { recursive: false });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Collection assembly output is reserved by another writer: ${outputDirectory}`);
    }
    throw error;
  }
  return { parent, reservation };
}

async function assertOutputAbsent(outputDirectory: string, message: string): Promise<void> {
  try {
    await fs.lstat(outputDirectory);
    throw new Error(`${message}: ${outputDirectory}`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
}

export async function assembleFixedCollection(
  options: AssembleFixedCollectionOptions,
): Promise<AssembleFixedCollectionResult> {
  const outputDirectory = path.resolve(options.outputDirectory);
  const { parent, reservation } = await reserveOutput(outputDirectory);
  let temporary: string | undefined;
  try {
    await assertOutputAbsent(outputDirectory, "Collection assembly output already exists");
    const moduleIds = new Set<string>();
    const moduleInputs = new Map<string, { manifestBytes: Buffer }>();
    const moduleRoots = new Map<string, string>();
    const moduleManifests = new Map<string, GameModuleV1>();
    const standalonePackages = new Map<string, VerifiedStandaloneWebPackage>();
    for (const source of options.modules) {
      if (moduleIds.has(source.moduleId)) throw new Error(`Duplicate collection module input: ${source.moduleId}`);
      moduleIds.add(source.moduleId);
      const manifestBytes = await fs.readFile(path.resolve(source.manifestPath));
      moduleInputs.set(source.moduleId, { manifestBytes });
      moduleManifests.set(source.moduleId, JSON.parse(manifestBytes.toString("utf8")) as GameModuleV1);
      moduleRoots.set(source.moduleId, await fs.realpath(path.resolve(source.moduleRoot)));
      standalonePackages.set(source.moduleId, await verifyStandaloneWebPackage(source.standalonePackageRoot));
    }
    const [collectionBytes, targetProfileBytes, collectionShell] = await Promise.all([
      fs.readFile(path.resolve(options.collectionManifestPath)),
      fs.readFile(path.resolve(options.targetProfilePath)),
      readCollectionShell(options.collectionShellRoot),
    ]);
    const collectionValue = JSON.parse(collectionBytes.toString("utf8"));
    const planned = planFixedCollectionAssembly(collectionValue, moduleInputs, targetProfileBytes);
    if (!planned.ok || !planned.plan) {
      throw new Error(`Fixed collection assembly contract rejected input:\n${planned.errors.join("\n")}`);
    }

    const collection = collectionValue as FixedCollectionV1;
    const releaseHashes = new Set<string>();
    const packageTreeHashes = new Set<string>();
    const persistenceKeys = new Set<string>();
    const launcher: FixedCollectionLauncherV1 = {
      schemaVersion: "aico8.fixed-collection-launcher.v1",
      collectionId: collection.collectionId,
      title: collection.metadata.title,
      targetProfile: collection.targetProfile,
      initialModuleId: collection.launcher.initialModuleId,
      resetMode: "document-replacement",
      modules: collection.modules.map((entry) => {
        const manifest = moduleManifests.get(entry.moduleId)!;
        const standalone = standalonePackages.get(entry.moduleId)!;
        if (standalone.game.id !== entry.moduleId) {
          throw new Error(`Standalone package game ID must match module ID: ${entry.moduleId}`);
        }
        if (standalone.game.title !== manifest.metadata.title || standalone.game.author !== manifest.metadata.author) {
          throw new Error(`Standalone package metadata must match module manifest: ${entry.moduleId}`);
        }
        if (standalone.rights.profile !== entry.rightsProfile) {
          throw new Error(`Standalone package rights profile must match collection entry: ${entry.moduleId}`);
        }
        if (standalone.targetProfile.id !== collection.targetProfile.id
          || standalone.targetProfile.sha256 !== collection.targetProfile.sha256) {
          throw new Error(`Standalone package target profile must match collection bytes: ${entry.moduleId}`);
        }
        if (releaseHashes.has(standalone.releaseManifestSha256)
          || packageTreeHashes.has(standalone.treeSha256)) {
          throw new Error(`Standalone package identities must be unique: ${entry.moduleId}`);
        }
        if (persistenceKeys.has(standalone.persistenceKey)) {
          throw new Error(`Standalone package persistence keys must be unique: ${entry.moduleId}`);
        }
        releaseHashes.add(standalone.releaseManifestSha256);
        packageTreeHashes.add(standalone.treeSha256);
        persistenceKeys.add(standalone.persistenceKey);
        return {
          moduleId: entry.moduleId,
          title: manifest.metadata.title,
          author: manifest.metadata.author,
          launchPath: `games/${entry.moduleId}/`,
          saveNamespace: entry.saveNamespace,
          persistenceKey: standalone.persistenceKey,
          rightsProfile: entry.rightsProfile,
          package: {
            releaseManifestSha256: standalone.releaseManifestSha256,
            treeSha256: standalone.treeSha256,
          },
        };
      }),
    };
    assertFixedCollectionLauncher(launcher);

    const productFiles = new Map<string, Buffer>();
    for (const [relative, bytes] of collectionShell) addProductFile(productFiles, relative, bytes);
    let validatedEvidenceFiles = 0;
    let validatedEvidenceBytes = 0;
    for (const artifact of planned.plan.artifacts) {
      let bytes: Buffer;
      if (artifact.source === "manifest") {
        bytes = moduleInputs.get(artifact.moduleId)!.manifestBytes;
      } else {
        const moduleRoot = moduleRoots.get(artifact.moduleId)!;
        const realPath = await resolveExistingContained(moduleRoot, artifact.path);
        bytes = await fs.readFile(realPath);
      }
      if (sha256(bytes) !== artifact.sha256) {
        throw new Error(`Collection module artifact hash mismatch: ${artifact.moduleId}/${artifact.path}`);
      }
      if (artifact.packaged) {
        if (!artifact.destination) throw new Error(`Packaged collection artifact has no destination: ${artifact.moduleId}/${artifact.path}`);
        addProductFile(productFiles, artifact.destination, bytes);
      } else {
        validatedEvidenceFiles += 1;
        validatedEvidenceBytes += bytes.byteLength;
      }
    }
    for (const module of launcher.modules) {
      const standalone = standalonePackages.get(module.moduleId)!;
      for (const file of standalone.files) {
        addProductFile(productFiles, `${module.launchPath}${file.path}`, await fs.readFile(file.absolutePath));
      }
    }
    const assemblyPlanBytes = Buffer.from(`${JSON.stringify(planned.plan, null, 2)}\n`);
    const launcherBytes = Buffer.from(`${JSON.stringify(launcher, null, 2)}\n`);
    const noticesBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "aico8.fixed-collection-notices.v1",
      collectionId: collection.collectionId,
      modules: collection.modules.map((entry) => {
        const standalone = standalonePackages.get(entry.moduleId)!;
        return {
          moduleId: entry.moduleId,
          title: standalone.game.title,
          author: standalone.game.author,
          rightsProfile: entry.rightsProfile,
          sourceLicense: standalone.rights.sourceLicense,
          sourceUrl: standalone.rights.sourceUrl,
          spdxExpression: entry.license.spdxExpression,
          notice: entry.license.notice,
          releaseManifestSha256: standalone.releaseManifestSha256,
          packageTreeSha256: standalone.treeSha256,
        };
      }),
    }, null, 2)}\n`);
    addProductFile(productFiles, "collection-runtime.json", launcherBytes);
    addProductFile(productFiles, "collection.json", collectionBytes);
    addProductFile(productFiles, "target-profile.json", targetProfileBytes);
    addProductFile(productFiles, "assembly-plan.json", assemblyPlanBytes);
    addProductFile(productFiles, "THIRD-PARTY-NOTICES.json", noticesBytes);
    const packagedArtifactBytes = [...productFiles.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    if (packagedArtifactBytes > planned.plan.budgets.maxPackagedBytes) {
      throw new Error(`Collection product bytes ${packagedArtifactBytes} exceed maxPackagedBytes ${planned.plan.budgets.maxPackagedBytes}`);
    }
    const evidence: FixedCollectionBuildEvidenceV1 = {
      schemaVersion: "aico8.fixed-collection-build.v1",
      collectionId: planned.plan.collectionId,
      collectionManifestSha256: sha256(collectionBytes),
      targetProfileSha256: sha256(targetProfileBytes),
      assemblyPlanSha256: sha256(assemblyPlanBytes),
      launcherManifestSha256: sha256(launcherBytes),
      collectionShellTreeSha256: canonicalTreeSha256(collectionShell),
      assembledProductTreeSha256: canonicalTreeSha256(productFiles),
      moduleCount: planned.plan.launcher.orderedModuleIds.length,
      packagedArtifactBytes,
      maxPackagedBytes: planned.plan.budgets.maxPackagedBytes,
      declaredPersistentBytes: planned.plan.budgets.declaredPersistentBytes,
      maxPersistentBytes: planned.plan.budgets.maxPersistentBytes,
      validatedEvidenceFiles,
      validatedEvidenceBytes,
      declaredResetCompatibilityStateOnSwitch: true,
      declaredIsolatedSaveNamespaces: true,
      modulePackages: launcher.modules.map((module) => ({
        moduleId: module.moduleId,
        releaseManifestSha256: module.package.releaseManifestSha256,
        treeSha256: module.package.treeSha256,
        persistenceKey: module.persistenceKey,
      })),
    };

    temporary = path.join(parent, `.${path.basename(outputDirectory)}.tmp-${randomUUID()}`);
    await fs.mkdir(temporary, { recursive: false });
    for (const [destination, bytes] of productFiles) {
      const output = resolveContained(temporary, destination);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, bytes);
    }
    await fs.writeFile(path.join(temporary, "collection-build.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await assertOutputAbsent(outputDirectory, "Collection assembly output appeared while reserved");
    await fs.rename(temporary, outputDirectory);
    temporary = undefined;
    return { plan: planned.plan, launcher, evidence, outputDirectory };
  } catch (error) {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  } finally {
    try {
      await fs.rmdir(reservation);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.length !== 5) {
    throw new Error("Usage: pnpm exec tsx scripts/assemble-fixed-collection.ts <collection.json> <module-inputs.json> <target-profile.json> <collection-shell-directory> <output-directory>");
  }
  const [collectionManifestPath, moduleInputsPath, targetProfilePath, collectionShellRoot, outputDirectory] = argv as [string, string, string, string, string];
  const moduleInputs = JSON.parse(await fs.readFile(path.resolve(moduleInputsPath), "utf8"));
  if (!Array.isArray(moduleInputs)) throw new Error("module-inputs.json must be an array");
  const result = await assembleFixedCollection({
    collectionManifestPath,
    modules: moduleInputs,
    targetProfilePath,
    collectionShellRoot,
    outputDirectory,
  });
  process.stdout.write(`Assembled ${result.plan.collectionId} (${result.evidence.moduleCount} modules) at ${result.outputDirectory}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
