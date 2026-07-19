#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  assertFixedCollectionRuntimeValidation,
  deriveFixedCollectionRuntimeBudget,
  type FixedCollectionRuntimeModuleValidationV1,
} from "../packages/contracts/src/collection-runtime-validation.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  args.set(key.slice(2), value);
}
const required = (name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};
const productRoot = await fs.realpath(path.resolve(required("product")));
const outputPath = path.resolve(required("out"));
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file: string): Promise<any> => JSON.parse(await fs.readFile(file, "utf8"));
const mime = (file: string): string => file.endsWith(".html") ? "text/html; charset=utf-8"
  : file.endsWith(".js") ? "text/javascript; charset=utf-8"
    : file.endsWith(".css") ? "text/css; charset=utf-8"
      : file.endsWith(".json") ? "application/json" : "application/octet-stream";

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const file = path.resolve(productRoot, relative);
    if (!file.startsWith(`${productRoot}${path.sep}`)) throw new Error("unsafe request path");
    const bytes = await fs.readFile(file);
    response.writeHead(200, { "content-type": mime(file), "cache-control": "no-store" });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const serverAddress = server.address();
assert.ok(serverAddress && typeof serverAddress !== "string");
const origin = `http://127.0.0.1:${serverAddress.port}`;

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

class Cdp {
  readonly socket: WebSocket;
  #id = 0;
  #pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed")), { once: true });
    });
    return new Cdp(socket);
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate<T>(expression: string, awaitPromise = true): Promise<T> {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
    return result.result.value as T;
  }
}

let chrome: ChildProcess | undefined;
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-collection-chrome-"));
try {
  const cdpPort = await freePort();
  chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--enable-precise-memory-info", `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userData}`, "about:blank",
  ], { stdio: "ignore" });
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  let version: any;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { version = await (await fetch(`${endpoint}/json/version`)).json(); break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.ok(version?.Browser, "Chrome CDP did not become ready");
  const page = await (await fetch(`${endpoint}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" })).json() as any;
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const launcher = await readJson(path.join(productRoot, "collection-runtime.json"));
  const build = await readJson(path.join(productRoot, "collection-build.json"));
  const modules = launcher.modules as Array<{ moduleId: string; persistenceKey: string; saveNamespace: string }>;
  async function navigate(initialModuleId: string): Promise<any> {
    const url = `${origin}/?validation-collection=1&validation-initial-module=${encodeURIComponent(initialModuleId)}&run=${randomUUID()}`;
    await cdp.send("Page.navigate", { url });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const snapshot = await cdp.evaluate<any>("window.__aico8CollectionValidation?.snapshot?.() ?? null").catch(() => null);
      if (snapshot?.activeModuleId === initialModuleId && snapshot.identity) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const diagnostic = await cdp.evaluate<any>(`({
      title: document.title,
      status: document.querySelector("#collection-status")?.textContent,
      stageStatus: document.querySelector("#collection-stage")?.dataset.collectionStatus ?? null,
      frameCount: document.querySelectorAll("iframe").length,
      frameSource: document.querySelector("iframe")?.getAttribute("src") ?? null,
      childCaptureStatus: document.querySelector("iframe")?.contentDocument?.querySelector("#game-frame")?.dataset.captureStatus ?? null,
      childError: document.querySelector("iframe")?.contentDocument?.querySelector("#game-frame")?.dataset.captureError ?? null,
      body: document.body.innerText.slice(0, 1000),
    })`).catch((error) => ({ evaluationError: String(error) }));
    throw new Error(`Timed out starting ${initialModuleId}: ${JSON.stringify(diagnostic)}`);
  }
  async function heapBytes(): Promise<number> {
    const value = await cdp.evaluate<number>("Math.max(1, Math.trunc(performance.memory?.usedJSHeapSize ?? 1))");
    assert.ok(Number.isSafeInteger(value) && value > 0);
    return value;
  }

  const measurements: FixedCollectionRuntimeModuleValidationV1[] = [];
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index]!;
    const from = modules[(index + modules.length - 1) % modules.length]!;
    const startup = await navigate(module.moduleId);
    const startupHeap = await heapBytes();
    await navigate(from.moduleId);
    const switched = await cdp.evaluate<any>(`(async () => {
      const validation = window.__aico8CollectionValidation;
      const started = performance.now();
      await validation.activate(${JSON.stringify(module.moduleId)});
      return { ...validation.snapshot(), milliseconds: performance.now() - started };
    })()`);
    const switchHeap = await heapBytes();
    const writtenValue = `isolation:${module.moduleId}:${randomUUID()}`;
    const validationStorageKey = `aico8.collection.validation:${module.saveNamespace}:progress`;
    await cdp.evaluate(`localStorage.setItem(${JSON.stringify(validationStorageKey)}, ${JSON.stringify(writtenValue)})`);
    await cdp.evaluate(`window.__aico8CollectionValidation.activate(${JSON.stringify(from.moduleId)})`);
    await cdp.evaluate(`window.__aico8CollectionValidation.activate(${JSON.stringify(module.moduleId)})`);
    const restoredValue = await cdp.evaluate<string>(`localStorage.getItem(${JSON.stringify(validationStorageKey)})`);
    measurements.push({
      moduleId: module.moduleId,
      startup: {
        documentIdentity: startup.identity.documentIdentity,
        runtimeIdentity: startup.identity.runtimeIdentity,
        milliseconds: startup.startupMilliseconds,
        jsHeapBytes: startupHeap,
      },
      switch: {
        fromModuleId: from.moduleId,
        documentIdentity: switched.identity.documentIdentity,
        runtimeIdentity: switched.identity.runtimeIdentity,
        milliseconds: switched.milliseconds,
        jsHeapBytes: switchHeap,
      },
      save: {
        logicalKey: "progress",
        namespace: module.saveNamespace,
        writtenValue,
        restoredValue,
      },
    });
  }

  const failureFrom = modules[0]!;
  const failureTarget = modules[1]!;
  await navigate(failureFrom.moduleId);
  const failedSwitch = await cdp.evaluate<any>(`(async () => {
    const validation = window.__aico8CollectionValidation;
    const target = validation.manifest.modules.find((entry) => entry.moduleId === ${JSON.stringify(failureTarget.moduleId)});
    const original = target.launchPath;
    target.launchPath = "games/intentionally-missing/";
    const started = performance.now();
    let errorCode = "missing-error";
    try { await validation.activate(target.moduleId); }
    catch (error) { errorCode = String(error?.message ?? error).includes("Timed out") ? "runtime-handshake-timeout" : "runtime-launch-failed"; }
    target.launchPath = original;
    return { ...validation.snapshot(), milliseconds: performance.now() - started, errorCode };
  })()`);
  assert.equal(failedSwitch.activeModuleId, null, "failed switch retained active module");
  assert.equal(failedSwitch.identity, null, "failed switch retained child identity");

  const limits = { startupMillisecondsMax: 10_000, switchMillisecondsMax: 10_000, jsHeapBytesMax: 268_435_456 };
  const budgets = deriveFixedCollectionRuntimeBudget(measurements, limits);
  const evidence = {
    schemaVersion: "aico8.fixed-collection-runtime-validation.v1",
    subject: {
      collectionId: build.collectionId,
      collectionManifestSha256: build.collectionManifestSha256,
      collectionLauncherSha256: build.launcherManifestSha256,
      targetProfileSha256: build.targetProfileSha256,
      assembledTreeSha256: build.assembledProductTreeSha256,
    },
    browser: { name: "Google Chrome", version: String(version.Browser).replace(/^.*\//, "") },
    measurementMethod: {
      timing: "performance.now",
      heap: "performance.memory.usedJSHeapSize",
      identity: "child-handshake-token",
      storage: "namespaced-local-storage-round-trip",
    },
    modules: measurements,
    failedSwitches: [{
      fromModuleId: failureFrom.moduleId,
      toModuleId: failureTarget.moduleId,
      errorCode: failedSwitch.errorCode,
      milliseconds: failedSwitch.milliseconds,
      activeModuleIdAfterFailure: null,
      activeDocumentIdentityAfterFailure: null,
      activeRuntimeIdentityAfterFailure: null,
    }],
    budgets,
    status: budgets.passed ? "passed" : "failed",
  };
  assertFixedCollectionRuntimeValidation(evidence);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`Collection runtime validation ${evidence.status}: ${measurements.length} modules; ${outputPath}\n`);
} finally {
  if (chrome && chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => chrome!.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
