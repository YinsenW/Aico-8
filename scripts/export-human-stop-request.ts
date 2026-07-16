#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHumanStopRequest,
  type HumanStopRequestV1,
  type SupervisedTransferV1,
} from "../packages/contracts/src/index.ts";
import { runSupervisedTransferJob } from "./run-supervised-transfer.ts";

const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const USAGE = "Usage: pnpm exec tsx scripts/export-human-stop-request.ts --manifest <job.json> --root <dir> --ledger <ledger.json> --trust <trust.json> --out <relative-request.json>";

interface HumanStopRequestExportOptions {
  readonly manifestPath: string;
  readonly artifactRoot: string;
  readonly ledgerPath: string;
  readonly trustStorePath: string;
  readonly outputPath: string;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function readRegularFile(file: string): Promise<Buffer | undefined> {
  let handle;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const status = await handle.stat();
    if (!status.isFile()) throw new Error(`Human stop request is not a regular file: ${file}`);
    return await handle.readFile();
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeImmutable(file: string, bytes: Buffer): Promise<void> {
  const existing = await readRegularFile(file);
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`Human stop request already exists with different bytes: ${file}`);
    return;
  }
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await fs.link(temporary, file);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      const raced = await readRegularFile(file);
      if (!raced?.equals(bytes)) throw new Error(`Human stop request was concurrently replaced: ${file}`);
    }
    const directoryHandle = await fs.open(directory, "r").catch(() => undefined);
    await directoryHandle?.sync().catch(() => undefined);
    await directoryHandle?.close().catch(() => undefined);
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporary, { force: true });
  }
}

export async function exportHumanStopRequestArtifact(
  ledger: SupervisedTransferV1,
  artifactRoot: string,
  outputPath: string,
): Promise<HumanStopRequestV1> {
  if (!SAFE_RELATIVE_PATH.test(outputPath)) throw new Error("Human stop request output must be a safe relative path");
  const root = await fs.realpath(path.resolve(artifactRoot));
  if (!(await fs.stat(root)).isDirectory()) throw new Error(`Artifact root is not a directory: ${root}`);
  const candidate = path.resolve(root, outputPath);
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error("Human stop request output escapes the artifact root");
  const parent = path.dirname(candidate);
  await fs.mkdir(parent, { recursive: true });
  if (await fs.realpath(parent) !== parent) throw new Error(`Human stop request parent must not traverse a symbolic link: ${parent}`);
  const request = createHumanStopRequest(ledger);
  await writeImmutable(candidate, jsonBytes(request));
  return request;
}

export function parseHumanStopRequestExportArguments(argv: readonly string[]): HumanStopRequestExportOptions {
  if (argv.length % 2 !== 0) throw new Error(`${USAGE}\nOptions must be flag/value pairs`);
  const allowed = new Set(["--manifest", "--root", "--ledger", "--trust", "--out"]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    const value = argv[index + 1]!;
    if (!allowed.has(key)) throw new Error(`Unsupported human stop request option: ${key}`);
    if (values.has(key)) throw new Error(`Duplicate human stop request option: ${key}`);
    if (!value || value.includes("\0")) throw new Error(`Invalid human stop request option: ${key}`);
    values.set(key, value);
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing required human stop request option: ${key}`);
    return value;
  };
  return {
    manifestPath: required("--manifest"),
    artifactRoot: required("--root"),
    ledgerPath: required("--ledger"),
    trustStorePath: required("--trust"),
    outputPath: required("--out"),
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  const options = parseHumanStopRequestExportArguments(argv);
  const ledger = await runSupervisedTransferJob({
    action: "init",
    manifestPath: options.manifestPath,
    artifactRoot: options.artifactRoot,
    ledgerPath: options.ledgerPath,
    trustStorePath: options.trustStorePath,
  });
  const request = await exportHumanStopRequestArtifact(ledger, options.artifactRoot, options.outputPath);
  process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
