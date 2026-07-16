import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateBatch, type BatchV1 } from "./batch.js";
import { acquireBatchLedgerLock } from "../../../scripts/run-batch.ts";

const repository = path.resolve(import.meta.dirname, "../../..");
const fixtureRoot = path.join(repository, "tests/fixtures/batch-runner");
const manifestPath = path.join(fixtureRoot, "batch.json");
const executorPath = path.join(fixtureRoot, "executor.mjs");
const holdExecutorPath = path.join(fixtureRoot, "hold-executor.mjs");
const timeoutExecutorPath = path.join(fixtureRoot, "timeout-executor.mjs");
const cliPath = path.join(repository, "scripts/run-batch.ts");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-batch-job-"));
  temporaryRoots.push(root);
  return root;
}

interface ProcessResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function executeCli(
  manifest: string,
  manifestRoot: string,
  workspaceRoot: string,
  ledgerPath: string,
  executor = executorPath,
  executorArguments: readonly string[] = ["--literal", "value with spaces;not-a-shell-command"],
): Promise<ProcessResult> {
  return await startCli(manifest, manifestRoot, workspaceRoot, ledgerPath, executor, executorArguments);
}

function startCli(
  manifest: string,
  manifestRoot: string,
  workspaceRoot: string,
  ledgerPath: string,
  executor = executorPath,
  executorArguments: readonly string[] = ["--literal", "value with spaces;not-a-shell-command"],
): Promise<ProcessResult> {
  const argv = [
    "--import", "tsx", cliPath,
    "--manifest", manifest,
    "--manifest-root", manifestRoot,
    "--workspace-root", workspaceRoot,
    "--ledger", ledgerPath,
    "--", process.execPath, executor,
    ...executorArguments,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, argv, {
      cwd: repository,
      env: {
        ...process.env,
        AICO8_SENTINEL_SECRET: "must-not-reach-executor",
        AICO8_SENTINEL_TOKEN: "must-not-reach-executor",
        AICO8_SENTINEL_KEY: "must-not-reach-executor",
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(file);
      return;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${file}`);
}

async function readBatch(file: string): Promise<BatchV1> {
  return JSON.parse(await fs.readFile(file, "utf8")) as BatchV1;
}

describe("JOB-BATCH-001 filesystem runner", () => {
  it("runs a public three-game mixed fixture with isolated workspaces and a durable retry ledger", async () => {
    const root = await temporaryRoot();
    const workspaceRoot = path.join(root, "workspaces");
    const ledgerPath = path.join(root, "state", "ledger.json");
    const result = await executeCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath);
    expect(result.code, result.stderr).toBe(0);
    const stdoutBatch = JSON.parse(result.stdout) as BatchV1;
    const ledger = await readBatch(ledgerPath);
    expect(stdoutBatch).toEqual(ledger);
    expect(validateBatch(ledger)).toEqual({ ok: true, errors: [] });
    expect(ledger.status).toBe("partial");

    const byId = new Map(ledger.games.map((game) => [game.gameId, game]));
    expect(byId.get("game-accept")?.state).toBe("accepted");
    expect(byId.get("game-blocked")?.state).toBe("blocked");
    expect(byId.get("game-retry")?.state).toBe("accepted");
    expect(byId.get("game-retry")?.attempts.map(({ outcome }) => outcome)).toEqual(["failed", "accepted"]);
    expect(byId.get("game-retry")?.attempts[0]).toMatchObject({
      failureClass: "executor-error",
      stage: "ingest",
    });

    for (const game of ledger.games) {
      const workspace = await fs.realpath(path.join(workspaceRoot, game.workspaceId));
      const metadata = JSON.parse(await fs.readFile(path.join(workspace, "input/authorized-input.json"), "utf8"));
      expect(metadata).toMatchObject({
        schemaVersion: "aico8.batch-input.v1",
        batchId: ledger.batchId,
        gameId: game.gameId,
        workspaceId: game.workspaceId,
        cart: {
          sourcePath: game.input.cartPath,
          sha256: game.cartSha256,
          rightsProfile: game.input.rightsProfile,
        },
        request: game.request,
      });
      const attemptOne = JSON.parse(await fs.readFile(path.join(workspace, "executor-attempt-1.json"), "utf8"));
      expect(attemptOne.workspaceDirectory).toBe(workspace);
      expect(attemptOne.authorizedCartFile.startsWith(`${workspace}${path.sep}`)).toBe(true);
      expect(attemptOne.inputMetadataFile).toBe(path.join(workspace, "input/authorized-input.json"));
      const executorEnvironment = JSON.parse(await fs.readFile(path.join(workspace, "executor-environment.json"), "utf8"));
      expect(executorEnvironment.forbiddenVisible).toEqual([]);
      expect(executorEnvironment.pathAvailable).toBe(true);
      expect(executorEnvironment.visibleKeys).not.toEqual(expect.arrayContaining([
        "HOME", "NODE_OPTIONS", "AICO8_SENTINEL_SECRET", "AICO8_SENTINEL_TOKEN", "AICO8_SENTINEL_KEY",
      ]));
      const allowedEnvironment = new Set([
        "PATH", "Path", "TMPDIR", "TMP", "TEMP", "LANG", "LANGUAGE", "LC_ALL", "LC_COLLATE", "LC_CTYPE",
        "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME", "TZ", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
        "__CF_USER_TEXT_ENCODING",
      ]);
      expect(executorEnvironment.visibleKeys.every((key: string) => allowedEnvironment.has(key))).toBe(true);
    }
    const workspaceEntries = await fs.readdir(workspaceRoot);
    expect(workspaceEntries.sort()).toEqual(ledger.games.map(({ workspaceId }) => workspaceId).sort());
    expect((await fs.readdir(path.dirname(ledgerPath))).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("resumes a terminal ledger without re-executing games and rejects immutable manifest drift", async () => {
    const root = await temporaryRoot();
    const workspaceRoot = path.join(root, "workspaces");
    const ledgerPath = path.join(root, "ledger.json");
    const first = await executeCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath);
    expect(first.code, first.stderr).toBe(0);
    const before = await readBatch(ledgerPath);
    const second = await executeCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath);
    expect(second.code, second.stderr).toBe(0);
    expect(await readBatch(ledgerPath)).toEqual(before);
    for (const game of before.games) {
      const attempts = (await fs.readdir(path.join(workspaceRoot, game.workspaceId)))
        .filter((entry) => entry.startsWith("executor-attempt-"));
      expect(attempts).toHaveLength(game.attempts.length);
    }

    const driftedManifest = path.join(root, "drifted-batch.json");
    const drifted = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    drifted.games[0].request.targetProfileSha256 = "e".repeat(64);
    await fs.writeFile(driftedManifest, `${JSON.stringify(drifted, null, 2)}\n`);
    const rejected = await executeCli(driftedManifest, fixtureRoot, workspaceRoot, ledgerPath);
    expect(rejected.code).toBe(1);
    expect(rejected.stderr).toMatch(/immutable batch\/input\/request identity/);
    expect(await readBatch(ledgerPath)).toEqual(before);

    const policyDriftManifest = path.join(root, "policy-drift-batch.json");
    const policyDrift = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    policyDrift.policy.attemptTimeoutMs += 1;
    await fs.writeFile(policyDriftManifest, `${JSON.stringify(policyDrift, null, 2)}\n`);
    const policyRejected = await executeCli(policyDriftManifest, fixtureRoot, workspaceRoot, ledgerPath);
    expect(policyRejected.code).toBe(1);
    expect(policyRejected.stderr).toMatch(/immutable batch\/input\/request identity/);
    expect(await readBatch(ledgerPath)).toEqual(before);
  });

  it("resumes an atomically persisted running attempt without duplicating its attempt number", async () => {
    const root = await temporaryRoot();
    const workspaceRoot = path.join(root, "workspaces");
    const ledgerPath = path.join(root, "ledger.json");
    const running = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    running.status = "running";
    running.games[0].state = "running";
    running.games[0].attempt = 1;
    await fs.writeFile(ledgerPath, `${JSON.stringify(running, null, 2)}\n`);

    const result = await executeCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath);
    expect(result.code, result.stderr).toBe(0);
    const ledger = await readBatch(ledgerPath);
    expect(ledger.status).toBe("partial");
    const accepted = ledger.games.find(({ gameId }) => gameId === "game-accept")!;
    expect(accepted.attempt).toBe(1);
    expect(accepted.attempts.map(({ attempt, outcome }) => ({ attempt, outcome }))).toEqual([
      { attempt: 1, outcome: "accepted" },
    ]);
  });

  it("rejects a concurrent second runner and never removes a lock with another owner token", async () => {
    const root = await temporaryRoot();
    const workspaceRoot = path.join(root, "workspaces");
    const ledgerPath = path.join(root, "ledger.json");
    const first = startCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath, holdExecutorPath, []);
    await waitForFile(`${ledgerPath}.lock`);
    const second = await executeCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath, holdExecutorPath, []);
    expect(second.code).toBe(1);
    expect(second.stderr).toMatch(/already locked by another runner/);
    const firstResult = await first;
    expect(firstResult.code, firstResult.stderr).toBe(0);
    await expect(fs.access(`${ledgerPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });

    const owned = await acquireBatchLedgerLock(ledgerPath);
    const other = JSON.parse(await fs.readFile(owned.path, "utf8"));
    other.token = "another-runner-token";
    await fs.writeFile(owned.path, `${JSON.stringify(other, null, 2)}\n`);
    await expect(owned.release()).rejects.toThrow(/owned by another runner/);
    await expect(fs.access(owned.path)).resolves.toBeUndefined();
  });

  it("enforces the declared attempt timeout with TERM then KILL while sibling lanes continue", async () => {
    const root = await temporaryRoot();
    const copiedFixture = path.join(root, "fixture");
    await fs.cp(fixtureRoot, copiedFixture, { recursive: true });
    const timeoutManifest = path.join(copiedFixture, "batch.json");
    const manifest = JSON.parse(await fs.readFile(timeoutManifest, "utf8"));
    manifest.policy.attemptTimeoutMs = 100;
    await fs.writeFile(timeoutManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    const workspaceRoot = path.join(root, "workspaces");
    const ledgerPath = path.join(root, "ledger.json");
    const result = await executeCli(
      timeoutManifest,
      copiedFixture,
      workspaceRoot,
      ledgerPath,
      path.join(copiedFixture, "timeout-executor.mjs"),
      [],
    );
    expect(result.code, result.stderr).toBe(0);
    const ledger = await readBatch(ledgerPath);
    expect(ledger.status).toBe("partial");
    const byId = new Map(ledger.games.map((game) => [game.gameId, game]));
    expect(byId.get("game-accept")?.state).toBe("accepted");
    expect(byId.get("game-blocked")?.state).toBe("blocked");
    expect(byId.get("game-retry")?.attempts.map(({ outcome }) => outcome)).toEqual(["failed", "failed"]);
    expect(byId.get("game-retry")?.attempts.every((attempt) =>
      attempt.outcome === "failed" && attempt.failureClass === "executor-error")).toBe(true);
    const retryWorkspace = path.join(workspaceRoot, byId.get("game-retry")!.workspaceId);
    await expect(fs.access(path.join(retryWorkspace, "sigterm-1"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(retryWorkspace, "sigterm-2"))).resolves.toBeUndefined();
    if (process.platform !== "win32") {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await expect(fs.access(path.join(retryWorkspace, "grandchild-late-write-1"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(path.join(retryWorkspace, "grandchild-late-write-2"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    await expect(fs.access(`${ledgerPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails before creating a ledger when an authorized cart hash does not match", async () => {
    const root = await temporaryRoot();
    const copiedFixture = path.join(root, "fixture");
    await fs.cp(fixtureRoot, copiedFixture, { recursive: true });
    await fs.appendFile(path.join(copiedFixture, "carts/accept.p8"), "tampered\n");
    const workspaceRoot = path.join(root, "workspaces");
    const ledgerPath = path.join(root, "ledger.json");
    const result = await executeCli(path.join(copiedFixture, "batch.json"), copiedFixture, workspaceRoot, ledgerPath);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Cart SHA-256 mismatch for game-accept/);
    await expect(fs.access(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(`${ledgerPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects an authorized cart symlink even when the external bytes match its declared hash",
    async () => {
      const root = await temporaryRoot();
      const copiedFixture = path.join(root, "fixture");
      await fs.cp(fixtureRoot, copiedFixture, { recursive: true });
      const cart = path.join(copiedFixture, "carts/accept.p8");
      const outsideCart = path.join(root, "outside-accept.p8");
      await fs.copyFile(cart, outsideCart);
      await fs.unlink(cart);
      await fs.symlink(outsideCart, cart, "file");
      const ledgerPath = path.join(root, "ledger.json");
      const result = await executeCli(
        path.join(copiedFixture, "batch.json"),
        copiedFixture,
        path.join(root, "workspaces"),
        ledgerPath,
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/escapes its declared root/);
      await expect(fs.access(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.access(`${ledgerPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails closed when pre-existing workspace destinations use symbolic links",
    async () => {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as BatchV1;
      const game = manifest.games[0]!;
      const cartName = path.basename(game.input.cartPath);
      const scenarios = [
        "workspace-root",
        "workspace-directory",
        "input-directory",
        "authorized-cart-file",
        "input-metadata-file",
      ] as const;

      for (const scenario of scenarios) {
        const root = await temporaryRoot();
        const workspaceRoot = path.join(root, "workspaces");
        const outside = path.join(root, "outside");
        const outsideSentinel = path.join(outside, "sentinel.txt");
        const ledgerPath = path.join(root, "ledger.json");
        await fs.mkdir(outside, { recursive: true });
        await fs.writeFile(outsideSentinel, "must remain outside\n");

        if (scenario === "workspace-root") {
          await fs.symlink(outside, workspaceRoot, "dir");
        } else {
          await fs.mkdir(workspaceRoot, { recursive: true });
          const workspace = path.join(workspaceRoot, game.workspaceId);
          if (scenario === "workspace-directory") {
            await fs.symlink(outside, workspace, "dir");
          } else {
            await fs.mkdir(workspace);
            const input = path.join(workspace, "input");
            if (scenario === "input-directory") {
              await fs.symlink(outside, input, "dir");
            } else {
              await fs.mkdir(input);
              const destination = scenario === "authorized-cart-file"
                ? path.join(input, cartName)
                : path.join(input, "authorized-input.json");
              await fs.symlink(outsideSentinel, destination, "file");
            }
          }
        }

        const result = await executeCli(manifestPath, fixtureRoot, workspaceRoot, ledgerPath);
        expect(result.code, `${scenario}: ${result.stderr}`).toBe(1);
        expect(result.stderr).toMatch(/symbolic link/);
        expect(await fs.readFile(outsideSentinel, "utf8")).toBe("must remain outside\n");
        expect((await fs.readdir(outside)).sort()).toEqual(["sentinel.txt"]);
        await expect(fs.access(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
        await expect(fs.access(`${ledgerPath}.lock`)).rejects.toMatchObject({ code: "ENOENT" });
      }
    },
  );
});
