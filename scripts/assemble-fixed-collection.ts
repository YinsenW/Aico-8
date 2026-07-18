#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  planFixedCollectionAssembly,
  type FixedCollectionAssemblyPlanV1,
} from "../packages/contracts/src/assembly.ts";

export interface FixedCollectionModuleSource {
  readonly moduleId: string;
  readonly manifestPath: string;
  readonly moduleRoot: string;
}

export interface AssembleFixedCollectionOptions {
  readonly collectionManifestPath: string;
  readonly modules: readonly FixedCollectionModuleSource[];
  readonly targetProfilePath: string;
  readonly outputDirectory: string;
}

export interface FixedCollectionBuildEvidenceV1 {
  readonly schemaVersion: "aico8.fixed-collection-build.v1";
  readonly collectionId: string;
  readonly collectionManifestSha256: string;
  readonly targetProfileSha256: string;
  readonly assemblyPlanSha256: string;
  readonly moduleCount: number;
  readonly packagedArtifactBytes: number;
  readonly maxPackagedBytes: number;
  readonly declaredPersistentBytes: number;
  readonly maxPersistentBytes: number;
  readonly resetCompatibilityStateOnSwitch: true;
  readonly isolatedSaveNamespaces: true;
}

export interface AssembleFixedCollectionResult {
  readonly plan: FixedCollectionAssemblyPlanV1;
  readonly evidence: FixedCollectionBuildEvidenceV1;
  readonly outputDirectory: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
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
    for (const source of options.modules) {
      if (moduleIds.has(source.moduleId)) throw new Error(`Duplicate collection module input: ${source.moduleId}`);
      moduleIds.add(source.moduleId);
      moduleInputs.set(source.moduleId, { manifestBytes: await fs.readFile(path.resolve(source.manifestPath)) });
      moduleRoots.set(source.moduleId, await fs.realpath(path.resolve(source.moduleRoot)));
    }
    const [collectionBytes, targetProfileBytes] = await Promise.all([
      fs.readFile(path.resolve(options.collectionManifestPath)),
      fs.readFile(path.resolve(options.targetProfilePath)),
    ]);
    const collectionValue = JSON.parse(collectionBytes.toString("utf8"));
    const planned = planFixedCollectionAssembly(collectionValue, moduleInputs, targetProfileBytes);
    if (!planned.ok || !planned.plan) {
      throw new Error(`Fixed collection assembly contract rejected input:\n${planned.errors.join("\n")}`);
    }

    const artifactBytes = new Map<string, Buffer>();
    let packagedArtifactBytes = 0;
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
      artifactBytes.set(artifact.destination!, bytes);
      packagedArtifactBytes += bytes.byteLength;
    }
    if (packagedArtifactBytes > planned.plan.budgets.maxPackagedBytes) {
      throw new Error(`Collection packaged artifact bytes ${packagedArtifactBytes} exceed maxPackagedBytes ${planned.plan.budgets.maxPackagedBytes}`);
    }
    const assemblyPlanBytes = Buffer.from(`${JSON.stringify(planned.plan, null, 2)}\n`);
    const evidence: FixedCollectionBuildEvidenceV1 = {
      schemaVersion: "aico8.fixed-collection-build.v1",
      collectionId: planned.plan.collectionId,
      collectionManifestSha256: sha256(collectionBytes),
      targetProfileSha256: sha256(targetProfileBytes),
      assemblyPlanSha256: sha256(assemblyPlanBytes),
      moduleCount: planned.plan.launcher.orderedModuleIds.length,
      packagedArtifactBytes,
      maxPackagedBytes: planned.plan.budgets.maxPackagedBytes,
      declaredPersistentBytes: planned.plan.budgets.declaredPersistentBytes,
      maxPersistentBytes: planned.plan.budgets.maxPersistentBytes,
      resetCompatibilityStateOnSwitch: true,
      isolatedSaveNamespaces: true,
    };

    temporary = path.join(parent, `.${path.basename(outputDirectory)}.tmp-${randomUUID()}`);
    await fs.mkdir(temporary, { recursive: false });
    for (const [destination, bytes] of artifactBytes) {
      const output = resolveContained(temporary, destination);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, bytes);
    }
    await fs.writeFile(path.join(temporary, "collection.json"), collectionBytes);
    await fs.writeFile(path.join(temporary, "target-profile.json"), targetProfileBytes);
    await fs.writeFile(path.join(temporary, "assembly-plan.json"), assemblyPlanBytes);
    await fs.writeFile(path.join(temporary, "collection-build.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    await assertOutputAbsent(outputDirectory, "Collection assembly output appeared while reserved");
    await fs.rename(temporary, outputDirectory);
    temporary = undefined;
    return { plan: planned.plan, evidence, outputDirectory };
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
  if (argv.length !== 4) {
    throw new Error("Usage: pnpm exec tsx scripts/assemble-fixed-collection.ts <collection.json> <module-inputs.json> <target-profile.json> <output-directory>");
  }
  const [collectionManifestPath, moduleInputsPath, targetProfilePath, outputDirectory] = argv as [string, string, string, string];
  const moduleInputs = JSON.parse(await fs.readFile(path.resolve(moduleInputsPath), "utf8"));
  if (!Array.isArray(moduleInputs)) throw new Error("module-inputs.json must be an array");
  const result = await assembleFixedCollection({
    collectionManifestPath,
    modules: moduleInputs,
    targetProfilePath,
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
