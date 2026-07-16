#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { planSingleGameAssembly, type SingleGameAssemblyPlanV1 } from "../packages/contracts/src/assembly.ts";

export interface AssembleSingleGameModuleOptions {
  readonly moduleManifestPath: string;
  readonly moduleRoot: string;
  readonly targetProfilePath: string;
  readonly outputDirectory: string;
}

export interface AssembleSingleGameModuleResult {
  readonly plan: SingleGameAssemblyPlanV1;
  readonly outputDirectory: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function resolveContained(root: string, relative: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Module artifact escapes module root: ${relative}`);
  }
  return resolved;
}

async function resolveExistingContained(rootRealPath: string, relative: string): Promise<string> {
  const lexicalPath = resolveContained(rootRealPath, relative);
  const realPath = await fs.realpath(lexicalPath);
  if (realPath === rootRealPath || !realPath.startsWith(`${rootRealPath}${path.sep}`)) {
    throw new Error(`Module artifact real path escapes module root: ${relative}`);
  }
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) throw new Error(`Module artifact must be a regular file: ${relative}`);
  return realPath;
}

async function readJson(file: string): Promise<{ readonly bytes: Buffer; readonly value: unknown }> {
  const bytes = await fs.readFile(file);
  return { bytes, value: JSON.parse(bytes.toString("utf8")) };
}

export async function assembleSingleGameModule(
  options: AssembleSingleGameModuleOptions,
): Promise<AssembleSingleGameModuleResult> {
  const outputDirectory = path.resolve(options.outputDirectory);
  const parent = path.dirname(outputDirectory);
  await fs.mkdir(parent, { recursive: true });
  const reservation = path.join(parent, `.${path.basename(outputDirectory)}.assembly-lock`);
  try {
    await fs.mkdir(reservation, { recursive: false });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new Error(`Assembly output is reserved by another writer: ${outputDirectory}`);
    }
    throw error;
  }

  let temporary: string | undefined;
  try {
    try {
      await fs.lstat(outputDirectory);
      throw new Error(`Assembly output already exists: ${outputDirectory}`);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }

    const [{ value: moduleValue }, targetProfile] = await Promise.all([
      readJson(path.resolve(options.moduleManifestPath)),
      readJson(path.resolve(options.targetProfilePath)),
    ]);
    const planned = planSingleGameAssembly(moduleValue, targetProfile.bytes);
    if (!planned.ok || !planned.plan) throw new Error(`Assembly contract rejected input:\n${planned.errors.join("\n")}`);

    const moduleRootRealPath = await fs.realpath(path.resolve(options.moduleRoot));
    const artifactBytes = new Map<string, Buffer>();
    for (const artifact of planned.plan.artifacts) {
      const artifactRealPath = await resolveExistingContained(moduleRootRealPath, artifact.path);
      const bytes = await fs.readFile(artifactRealPath);
      const actual = sha256(bytes);
      if (actual !== artifact.sha256) throw new Error(`Module artifact hash mismatch: ${artifact.path}`);
      artifactBytes.set(artifact.path, bytes);
    }

    temporary = path.join(parent, `.${path.basename(outputDirectory)}.tmp-${randomUUID()}`);
    await fs.mkdir(temporary, { recursive: false });
    for (const artifact of planned.plan.artifacts) {
      if (!artifact.packaged || !artifact.destination) continue;
      const destination = resolveContained(temporary, artifact.destination);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, artifactBytes.get(artifact.path)!);
    }
    await fs.writeFile(path.join(temporary, "target-profile.json"), targetProfile.bytes);
    await fs.writeFile(path.join(temporary, "assembly-plan.json"), `${JSON.stringify(planned.plan, null, 2)}\n`);
    try {
      await fs.lstat(outputDirectory);
      throw new Error(`Assembly output appeared while reserved: ${outputDirectory}`);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await fs.rename(temporary, outputDirectory);
    temporary = undefined;
    return { plan: planned.plan, outputDirectory };
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
    throw new Error("Usage: pnpm exec tsx scripts/assemble-game-module.ts <module.json> <module-root> <target-profile.json> <output-directory>");
  }
  const [moduleManifestPath, moduleRoot, targetProfilePath, outputDirectory] = argv as [string, string, string, string];
  const result = await assembleSingleGameModule({ moduleManifestPath, moduleRoot, targetProfilePath, outputDirectory });
  process.stdout.write(`Assembled ${result.plan.moduleId} for ${result.plan.targetProfile.id} at ${result.outputDirectory}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
