#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { validateTargetProfile, type AndroidTargetProfileV1 } from "../packages/contracts/src/release.ts";
import { evaluateAndroidPerformance } from "../apps/mobile/src/android-device-capture.ts";
import { inventoryWebAssets, webAssetTreeSha256 } from "../apps/mobile/src/web-release-inventory.ts";

const CAPTURE_SECONDS = 60;
const VIEWPORT_EDGE = 1024;
const args = new Map<string, string>();
const values = process.argv.slice(2).filter((value) => value !== "--");
for (let index = 0; index < values.length; index += 2) {
  const key = values[index];
  const value = values[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  args.set(key.slice(2), value);
}
function required(name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

const productRoot = await fs.realpath(path.resolve(required("product")));
const targetPath = path.resolve(required("target"));
const evidenceRoot = path.resolve(required("evidence"));
await fs.mkdir(evidenceRoot, { recursive: true });
const targetBytes = await fs.readFile(targetPath);
const targetUnknown: unknown = JSON.parse(targetBytes.toString("utf8"));
const targetValidation = validateTargetProfile(targetUnknown);
if (!targetValidation.ok || (targetUnknown as { target?: unknown }).target !== "android-webview") {
  throw new Error(`Invalid Android target profile: ${targetValidation.errors.join("; ")}`);
}
const target = targetUnknown as AndroidTargetProfileV1;
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function mime(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

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
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
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
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "Browser evaluation failed");
    }
    return result.result.value as T;
  }
}

async function chromeExecutable(): Promise<string> {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  throw new Error("A supported Google Chrome executable is required");
}

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const userData = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-android-web-simulator-"));
const chromeLog = await fs.open(path.join(evidenceRoot, "web-performance-chrome.log"), "w");
let chrome: ChildProcess | undefined;

try {
  const cdpPort = await freePort();
  const chromeArguments = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    `--window-size=${VIEWPORT_EDGE},${VIEWPORT_EDGE}`,
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userData}`,
    "about:blank",
  ];
  if (process.env.AICO8_CHROME_HEADFUL !== "1") chromeArguments.unshift("--headless=new");
  chrome = spawn(await chromeExecutable(), chromeArguments, {
    stdio: ["ignore", chromeLog.fd, chromeLog.fd],
  });
  const endpoint = `http://127.0.0.1:${cdpPort}`;
  let version: any;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      version = await (await fetch(`${endpoint}/json/version`)).json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  assert.ok(version?.Browser, "Chrome CDP did not become ready");
  const page = await (await fetch(`${endpoint}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  })).json() as any;
  const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.bringToFront");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.send("Emulation.setIdleOverride", { isUserActive: true, isScreenUnlocked: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: VIEWPORT_EDGE,
    height: VIEWPORT_EDGE,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const navigationStarted = performance.now();
  await cdp.send("Page.navigate", { url: `${origin}/` });
  let ready = false;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ready = await cdp.evaluate<boolean>("document.querySelector('.player-shell') !== null").catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(ready, "Shared Web host did not become ready in the simulator");
  await cdp.send("Page.bringToFront");
  const foreground = await cdp.evaluate<{ visibilityState: string; hasFocus: boolean }>(`({
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
  })`);
  assert.deepEqual(
    foreground,
    { visibilityState: "visible", hasFocus: true },
    "Shared Web performance simulation requires an active foreground page",
  );
  const coldLaunchMilliseconds = Number((performance.now() - navigationStarted).toFixed(3));
  const measurement = await cdp.evaluate<{ callbacks: number; intervals: number[] }>(`new Promise(resolve => {
    const marker = document.createElement('span');
    marker.id = 'aico8-shared-web-performance-marker';
    marker.style.cssText = 'position:fixed;left:8px;top:8px;width:8px;height:8px;background:#ff5d9e;opacity:.25;z-index:2147483647;will-change:transform';
    document.body.appendChild(marker);
    const intervals = [];
    let callbacks = 0;
    let previous;
    const started = performance.now();
    const sample = now => {
      callbacks += 1;
      if (previous !== undefined) intervals.push(now - previous);
      previous = now;
      marker.style.transform = 'translateX(' + String(callbacks % 48) + 'px)';
      if (now - started >= ${CAPTURE_SECONDS * 1_000}) resolve({ callbacks, intervals });
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })`);
  const performanceResult = evaluateAndroidPerformance(measurement.intervals, target, CAPTURE_SECONDS);
  const screenshotResult = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const screenshot = Buffer.from(screenshotResult.data, "base64");
  await fs.writeFile(path.join(evidenceRoot, "web-performance-simulator.png"), screenshot);
  await fs.writeFile(
    path.join(evidenceRoot, "web-performance-frame-durations.csv"),
    `duration_milliseconds\n${measurement.intervals.join("\n")}\n`,
  );
  const browserEnvironment = await cdp.evaluate<any>(`(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const debug = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unavailable',
      serviceWorkerAvailable: 'serviceWorker' in navigator,
      wasmAvailable: typeof WebAssembly === 'object',
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
    };
  })()`);
  const files = await inventoryWebAssets(productRoot);
  const result = {
    schemaVersion: "aico8.android-web-performance-simulator.v1",
    simulatorProfileId: "linux-chromium-1024-square-shared-web-v1",
    subject: {
      webAssetTreeSha256: webAssetTreeSha256(files),
      targetProfileId: target.id,
      targetProfileSha256: sha256(targetBytes),
    },
    environment: {
      class: "linux-chromium-shared-web-simulator",
      displayMode: process.env.AICO8_CHROME_HEADFUL === "1" ? "xvfb-windowed" : "headless",
      browser: version.Browser,
      viewport: { width: VIEWPORT_EDGE, height: VIEWPORT_EDGE },
      ...browserEnvironment,
    },
    coldLaunchMilliseconds,
    startupMeasurementScope: "diagnostic-only-android-emulator-owns-host-startup-budget",
    requestAnimationFrameCallbacks: measurement.callbacks,
    performance: performanceResult,
    artifacts: {
      screenshotSha256: sha256(screenshot),
      frameDurationsSha256: sha256(Buffer.from(`duration_milliseconds\n${measurement.intervals.join("\n")}\n`)),
    },
    status: performanceResult.budgetPassed ? "passed" : "failed",
  } as const;
  await fs.writeFile(
    path.join(evidenceRoot, "web-performance-simulator.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (result.status !== "passed") {
    throw new Error(`Shared Web simulator performance failed: ${JSON.stringify(performanceResult)}`);
  }
  process.stdout.write(
    `Shared Web simulator passed ${performanceResult.observedSampleFrames} frames at `
      + `${performanceResult.p95FrameMilliseconds} ms p95; ${evidenceRoot}\n`,
  );
} finally {
  if (chrome && chrome.exitCode === null) {
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise<void>((resolve) => chrome!.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await chromeLog.close();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
