#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import {
  runBatch,
  validateBatch,
  type BatchExecutor,
  type BatchExecutorContext,
  type BatchV1,
} from "../packages/contracts/src/batch.ts";

const INPUT_METADATA_SCHEMA_VERSION = "aico8.batch-input.v1" as const;
const LEDGER_LOCK_SCHEMA_VERSION = "aico8.batch-ledger-lock.v1" as const;
const MAX_EXECUTOR_OUTPUT_BYTES = 1024 * 1024;
const EXECUTOR_TERMINATION_GRACE_MS = 100;
const USAGE = "Usage: pnpm exec tsx scripts/run-batch.ts --manifest <batch.json> --manifest-root <dir> --workspace-root <dir> --ledger <ledger.json> -- <executor> [args...]";
const EXECUTOR_ENVIRONMENT_ALLOWLIST = new Set([
  "PATH", "Path",
  "TMPDIR", "TMP", "TEMP",
  "LANG", "LANGUAGE",
  "LC_ALL", "LC_COLLATE", "LC_CTYPE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME",
  "TZ",
  "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
  "__CF_USER_TEXT_ENCODING",
]);

export interface RunBatchJobOptions {
  readonly manifestPath: string;
  readonly manifestRoot: string;
  readonly workspaceRoot: string;
  readonly ledgerPath: string;
  readonly executorArgv: readonly [string, ...string[]];
}

export interface MaterializedBatchInput {
  readonly workspaceDirectory: string;
  readonly authorizedCartFile: string;
  readonly inputMetadataFile: string;
}

export interface BatchProcessContext extends BatchExecutorContext {
  readonly attemptTimeoutMs: number;
  readonly processIsolation: "posix-process-group" | "direct-child-windows";
  readonly workspaceDirectory: string;
  readonly authorizedCartFile: string;
  readonly inputMetadataFile: string;
}

interface CliArguments {
  readonly manifestPath: string;
  readonly manifestRoot: string;
  readonly workspaceRoot: string;
  readonly ledgerPath: string;
  readonly executorArgv: readonly [string, ...string[]];
}

interface BatchLedgerLock {
  readonly path: string;
  readonly token: string;
  release(): Promise<void>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildExecutorEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && EXECUTOR_ENVIRONMENT_ALLOWLIST.has(key)) environment[key] = value;
  }
  return environment;
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

async function readJson(file: string, label: string): Promise<unknown> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(file);
  } catch (error) {
    throw new Error(`Unable to read ${label} ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requireValidBatch(value: unknown, label: string): BatchV1 {
  const validation = validateBatch(value);
  if (!validation.ok) throw new Error(`Invalid ${label}:\n${validation.errors.join("\n")}`);
  return structuredClone(value) as BatchV1;
}

function immutableBatchIdentity(batch: BatchV1): unknown {
  return {
    schemaVersion: batch.schemaVersion,
    batchId: batch.batchId,
    policy: batch.policy,
    games: batch.games.map((game) => ({
      gameId: game.gameId,
      cartSha256: game.cartSha256,
      input: game.input,
      request: game.request,
      workspaceId: game.workspaceId,
      priority: game.priority,
    })),
  };
}

function assertResumeIdentity(manifest: BatchV1, ledger: BatchV1): void {
  if (!isDeepStrictEqual(immutableBatchIdentity(manifest), immutableBatchIdentity(ledger))) {
    throw new Error("Ledger immutable batch/input/request identity does not match the manifest");
  }
}

function assertContained(root: string, candidate: string, label: string): void {
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} escapes its declared root: ${candidate}`);
  }
}

async function requireRealDirectory(directory: string, label: string): Promise<string> {
  const status = await fs.lstat(directory).catch((error: unknown) => {
    throw new Error(`Unable to inspect ${label} ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (status.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${directory}`);
  if (!status.isDirectory()) throw new Error(`${label} is not a directory: ${directory}`);
  const resolved = await fs.realpath(directory);
  const resolvedStatus = await fs.lstat(resolved);
  if (resolvedStatus.isSymbolicLink() || !resolvedStatus.isDirectory()) {
    throw new Error(`${label} does not resolve to a real directory: ${directory}`);
  }
  return resolved;
}

async function ensureContainedDirectory(root: string, directory: string, label: string): Promise<string> {
  const candidate = path.resolve(directory);
  assertContained(root, candidate, label);
  try {
    await fs.mkdir(candidate, { recursive: false });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  const resolved = await requireRealDirectory(candidate, label);
  assertContained(root, resolved, label);
  if (resolved !== candidate) throw new Error(`${label} must not traverse a symbolic link: ${candidate}`);
  return resolved;
}

async function writeAtomicFile(file: string, bytes: Uint8Array): Promise<void> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes, { flag: "wx" });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function writeBatchLedgerAtomic(file: string, batch: BatchV1): Promise<void> {
  await writeAtomicFile(path.resolve(file), jsonBytes(batch));
}

export function batchLedgerLockPath(ledgerPath: string): string {
  return `${path.resolve(ledgerPath)}.lock`;
}

export async function acquireBatchLedgerLock(ledgerPath: string): Promise<BatchLedgerLock> {
  const resolvedLedger = path.resolve(ledgerPath);
  const lockPath = batchLedgerLockPath(resolvedLedger);
  const token = randomUUID();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    let owner = "unreadable owner";
    try {
      const value = JSON.parse(await fs.readFile(lockPath, "utf8")) as { pid?: unknown; token?: unknown };
      owner = `pid ${String(value.pid ?? "unknown")}, token ${String(value.token ?? "unknown")}`;
    } catch {
      // A malformed or concurrently changing lock still fails closed.
    }
    throw new Error(`Batch ledger is already locked by another runner (${owner}): ${lockPath}`);
  }
  try {
    await handle.writeFile(jsonBytes({
      schemaVersion: LEDGER_LOCK_SCHEMA_VERSION,
      token,
      pid: process.pid,
      ledgerPath: resolvedLedger,
    }));
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true });
    throw error;
  }
  await handle.close();
  let released = false;
  return {
    path: lockPath,
    token,
    async release(): Promise<void> {
      if (released) return;
      let current: unknown;
      try {
        current = JSON.parse(await fs.readFile(lockPath, "utf8"));
      } catch (error) {
        throw new Error(`Cannot release batch ledger lock without verifying its owner: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (typeof current !== "object" || current === null || !("token" in current) || current.token !== token) {
        throw new Error(`Refusing to remove a batch ledger lock owned by another runner: ${lockPath}`);
      }
      await fs.unlink(lockPath);
      released = true;
    },
  };
}

async function readContainedRegularFile(root: string, file: string, label: string): Promise<Buffer | undefined> {
  assertContained(root, file, label);
  let status;
  try {
    status = await fs.lstat(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  if (status.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${file}`);
  if (!status.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
  let handle;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile()) throw new Error(`${label} is not a regular file: ${file}`);
    const resolved = await fs.realpath(file);
    assertContained(root, resolved, label);
    if (resolved !== file) throw new Error(`${label} must not traverse a symbolic link: ${file}`);
    return await handle.readFile();
  } finally {
    await handle?.close();
  }
}

async function ensureDeterministicFile(root: string, file: string, expected: Buffer, label: string): Promise<void> {
  const candidate = path.resolve(file);
  assertContained(root, candidate, label);
  const parent = path.dirname(candidate);
  const resolvedParent = await requireRealDirectory(parent, `${label} parent directory`);
  assertContained(root, resolvedParent, `${label} parent directory`);
  if (resolvedParent !== parent) throw new Error(`${label} parent directory must not traverse a symbolic link: ${parent}`);

  const existing = await readContainedRegularFile(root, candidate, label);
  if (existing !== undefined) {
    if (!existing.equals(expected)) throw new Error(`${label} differs from its deterministic materialization: ${candidate}`);
    return;
  }

  let handle;
  try {
    handle = await fs.open(
      candidate,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(expected);
    await handle.sync();
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      const concurrentlyCreated = await readContainedRegularFile(root, candidate, label);
      if (concurrentlyCreated?.equals(expected)) return;
    }
    throw error;
  } finally {
    await handle?.close();
  }
  const written = await readContainedRegularFile(root, candidate, label);
  if (!written?.equals(expected)) {
    throw new Error(`${label} differs after deterministic materialization: ${candidate}`);
  }
}

async function materializeInput(
  manifestRoot: string,
  workspaceRoot: string,
  batch: BatchV1,
  game: BatchV1["games"][number],
): Promise<MaterializedBatchInput> {
  const sourceCandidate = path.resolve(manifestRoot, game.input.cartPath);
  assertContained(manifestRoot, sourceCandidate, `Cart ${game.gameId}`);
  const sourceFile = await fs.realpath(sourceCandidate).catch((error: unknown) => {
    throw new Error(`Unable to resolve authorized cart ${game.input.cartPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  assertContained(manifestRoot, sourceFile, `Authorized cart ${game.gameId}`);
  const sourceBytes = await readContainedRegularFile(manifestRoot, sourceFile, `Authorized cart ${game.gameId}`);
  if (!sourceBytes) throw new Error(`Authorized cart is not a regular file: ${game.input.cartPath}`);
  const actualHash = sha256(sourceBytes);
  if (actualHash !== game.cartSha256) {
    throw new Error(`Cart SHA-256 mismatch for ${game.gameId}: expected ${game.cartSha256}, received ${actualHash}`);
  }

  const workspaceDirectory = await ensureContainedDirectory(
    workspaceRoot,
    path.resolve(workspaceRoot, game.workspaceId),
    `Workspace ${game.gameId}`,
  );
  const inputDirectory = await ensureContainedDirectory(
    workspaceRoot,
    path.join(workspaceDirectory, "input"),
    `Input directory ${game.gameId}`,
  );
  const copiedRelativePath = path.posix.join("input", path.basename(game.input.cartPath));
  const authorizedCartFile = path.join(workspaceDirectory, copiedRelativePath);
  const inputMetadataFile = path.join(inputDirectory, "authorized-input.json");
  await ensureDeterministicFile(workspaceRoot, authorizedCartFile, sourceBytes, `Authorized cart copy for ${game.gameId}`);
  const materializedCart = await readContainedRegularFile(
    workspaceRoot,
    authorizedCartFile,
    `Authorized cart copy for ${game.gameId}`,
  );
  if (!materializedCart || sha256(materializedCart) !== game.cartSha256) {
    throw new Error(`Materialized cart SHA-256 mismatch for ${game.gameId}`);
  }
  const metadata = {
    schemaVersion: INPUT_METADATA_SCHEMA_VERSION,
    batchId: batch.batchId,
    gameId: game.gameId,
    workspaceId: game.workspaceId,
    cart: {
      sourcePath: game.input.cartPath,
      workspacePath: copiedRelativePath,
      sha256: game.cartSha256,
      rightsProfile: game.input.rightsProfile,
    },
    request: game.request,
  };
  await ensureDeterministicFile(workspaceRoot, inputMetadataFile, jsonBytes(metadata), `Input metadata for ${game.gameId}`);
  return { workspaceDirectory, authorizedCartFile, inputMetadataFile };
}

function createProcessExecutor(
  executorArgv: readonly [string, ...string[]],
  materialized: ReadonlyMap<string, MaterializedBatchInput>,
  attemptTimeoutMs: number,
): BatchExecutor {
  return async (context) => {
    const input = materialized.get(context.gameId);
    if (!input) throw new Error(`Missing materialized workspace for ${context.gameId}`);
    const processIsolation = process.platform === "win32" ? "direct-child-windows" : "posix-process-group";
    const processContext: BatchProcessContext = { ...context, attemptTimeoutMs, processIsolation, ...input };
    const [executable, ...args] = executorArgv;
    return await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        cwd: input.workspaceDirectory,
        env: buildExecutorEnvironment(),
        detached: processIsolation === "posix-process-group",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let terminationReason: string | undefined;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const signalExecutor = (signal: NodeJS.Signals): void => {
        if (processIsolation === "posix-process-group" && child.pid !== undefined) {
          try {
            process.kill(-child.pid, signal);
          } catch (error) {
            if (errorCode(error) !== "ESRCH") child.kill(signal);
          }
          return;
        }
        child.kill(signal);
      };
      const terminate = (reason: string): void => {
        if (terminationReason) return;
        terminationReason = reason;
        signalExecutor("SIGTERM");
        killTimer = setTimeout(() => {
          if (processIsolation === "posix-process-group"
            || (child.exitCode === null && child.signalCode === null)) signalExecutor("SIGKILL");
        }, EXECUTOR_TERMINATION_GRACE_MS);
      };
      const timeoutTimer = setTimeout(() => {
        terminate(`Executor exceeded declared attemptTimeoutMs ${attemptTimeoutMs}`);
      }, attemptTimeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_EXECUTOR_OUTPUT_BYTES) {
          terminate(`Executor stdout exceeded ${MAX_EXECUTOR_OUTPUT_BYTES} bytes`);
        } else stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= MAX_EXECUTOR_OUTPUT_BYTES) stderr.push(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timeoutTimer);
        if (killTimer && !(terminationReason && processIsolation === "posix-process-group")) clearTimeout(killTimer);
        if (terminationReason) {
          reject(new Error(terminationReason));
          return;
        }
        const diagnostic = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0) {
          reject(new Error(`Executor exited with ${code ?? `signal ${signal ?? "unknown"}`}${diagnostic ? `: ${diagnostic}` : ""}`));
          return;
        }
        const serialized = Buffer.concat(stdout).toString("utf8").trim();
        if (!serialized) {
          reject(new Error("Executor stdout must contain exactly one JSON result"));
          return;
        }
        try {
          resolve(JSON.parse(serialized) as Awaited<ReturnType<BatchExecutor>>);
        } catch (error) {
          reject(new Error(`Executor stdout must contain exactly one JSON result: ${error instanceof Error ? error.message : String(error)}`));
        }
      });
      child.stdin.on("error", reject);
      child.stdin.end(`${JSON.stringify(processContext)}\n`);
    });
  };
}

async function existingLedger(file: string): Promise<BatchV1 | undefined> {
  try {
    await fs.access(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  return requireValidBatch(await readJson(file, "batch ledger"), "batch ledger");
}

export async function runBatchJob(options: RunBatchJobOptions): Promise<BatchV1> {
  if (options.executorArgv.length === 0 || options.executorArgv.some((argument) => argument.length === 0 || argument.includes("\0"))) {
    throw new Error("executorArgv must contain a non-empty executable and arguments without NUL bytes");
  }
  const manifestPath = path.resolve(options.manifestPath);
  const manifestRoot = await fs.realpath(path.resolve(options.manifestRoot));
  const manifestRootStat = await fs.stat(manifestRoot);
  if (!manifestRootStat.isDirectory()) throw new Error(`Manifest root is not a directory: ${manifestRoot}`);
  const requestedWorkspaceRoot = path.resolve(options.workspaceRoot);
  const ledgerPath = path.resolve(options.ledgerPath);
  if (ledgerPath === manifestPath) throw new Error("Ledger path must be different from the immutable manifest path");
  const lock = await acquireBatchLedgerLock(ledgerPath);
  try {
    const manifest = requireValidBatch(await readJson(manifestPath, "batch manifest"), "batch manifest");
    const ledger = await existingLedger(ledgerPath);
    if (ledger) assertResumeIdentity(manifest, ledger);
    const initial = ledger ?? manifest;

    await fs.mkdir(requestedWorkspaceRoot, { recursive: true });
    const workspaceRoot = await requireRealDirectory(requestedWorkspaceRoot, "Workspace root");
    const materialized = new Map<string, MaterializedBatchInput>();
    for (const game of manifest.games) {
      materialized.set(game.gameId, await materializeInput(manifestRoot, workspaceRoot, manifest, game));
    }

    await writeBatchLedgerAtomic(ledgerPath, initial);
    return await runBatch(initial, {
      executor: createProcessExecutor(options.executorArgv, materialized, initial.policy.attemptTimeoutMs),
      persist: async (snapshot) => writeBatchLedgerAtomic(ledgerPath, snapshot),
    });
  } finally {
    await lock.release();
  }
}

export function parseBatchCliArguments(argv: readonly string[]): CliArguments {
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error(`${USAGE}\nExecutor argv must follow a standalone -- separator`);
  }
  const optionArguments = argv.slice(0, separator);
  if (optionArguments.length % 2 !== 0) throw new Error("Batch runner options must be flag/value pairs");
  const values = new Map<string, string>();
  const allowed = new Set(["--manifest", "--manifest-root", "--workspace-root", "--ledger"]);
  for (let index = 0; index < optionArguments.length; index += 2) {
    const key = optionArguments[index]!;
    const value = optionArguments[index + 1]!;
    if (!allowed.has(key)) throw new Error(`Unsupported batch runner option: ${key}`);
    if (values.has(key)) throw new Error(`Duplicate batch runner option: ${key}`);
    if (!value) throw new Error(`Missing value for batch runner option: ${key}`);
    values.set(key, value);
  }
  const required = (key: string): string => {
    const value = values.get(key);
    if (!value) throw new Error(`Missing required batch runner option: ${key}`);
    return value;
  };
  const executorArgv = argv.slice(separator + 1);
  if (executorArgv.length === 0) throw new Error("Executor argv must not be empty");
  return {
    manifestPath: required("--manifest"),
    manifestRoot: required("--manifest-root"),
    workspaceRoot: required("--workspace-root"),
    ledgerPath: required("--ledger"),
    executorArgv: executorArgv as [string, ...string[]],
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  const result = await runBatchJob(parseBatchCliArguments(argv));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
