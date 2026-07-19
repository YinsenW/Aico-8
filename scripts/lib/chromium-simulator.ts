import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

function mime(file: string): string {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json";
  if (file.endsWith(".wasm")) return "application/wasm";
  if (file.endsWith(".png")) return "image/png";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

export class CdpClient {
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

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed")), { once: true });
    });
    return new CdpClient(socket);
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

export interface StaticProductServer {
  readonly origin: string;
  close(): Promise<void>;
}

export async function startStaticProductServer(productRootValue: string): Promise<StaticProductServer> {
  const productRoot = await fs.realpath(path.resolve(productRootValue));
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
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

async function chromeExecutable(): Promise<string> {
  const candidates = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) if (fsSync.existsSync(candidate)) return candidate;
  throw new Error("A supported Google Chrome executable is required");
}

export interface ChromiumSimulatorSession {
  readonly cdp: CdpClient;
  readonly browserVersion: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly displayMode: "xvfb-windowed" | "windowed" | "headless";
  close(): Promise<void>;
}

export async function launchChromiumSimulator(options: {
  readonly evidenceRoot: string;
  readonly logName: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly graphicsBackend?: "system" | "swiftshader-webgl";
}): Promise<ChromiumSimulatorSession> {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), "aico8-chromium-simulator-"));
  const chromeLog = await fs.open(path.join(options.evidenceRoot, options.logName), "w");
  let chrome: ChildProcess | undefined;
  try {
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
      `--window-size=${options.viewport.width},${options.viewport.height}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${userData}`,
      "about:blank",
    ];
    if (options.graphicsBackend === "swiftshader-webgl") {
      chromeArguments.unshift(
        "--use-gl=angle",
        "--use-angle=swiftshader-webgl",
        "--enable-unsafe-swiftshader",
      );
    }
    const displayMode = process.env.AICO8_CHROME_HEADFUL !== "1"
      ? "headless"
      : process.platform === "linux" && Boolean(process.env.DISPLAY)
        ? "xvfb-windowed"
        : "windowed";
    if (displayMode === "headless") chromeArguments.unshift("--headless=new");
    chrome = spawn(await chromeExecutable(), chromeArguments, {
      stdio: ["ignore", chromeLog.fd, chromeLog.fd],
    });
    const activePortPath = path.join(userData, "DevToolsActivePort");
    let endpoint: string | undefined;
    let version: any;
    for (let attempt = 0; attempt < 600; attempt += 1) {
      if (chrome.exitCode !== null) throw new Error(`Chrome exited before CDP became ready (exit ${chrome.exitCode})`);
      try {
        const [port] = (await fs.readFile(activePortPath, "utf8")).trim().split("\n");
        if (!port || !/^\d+$/.test(port)) throw new Error("Chrome has not published a valid CDP port");
        endpoint = `http://127.0.0.1:${port}`;
        version = await (await fetch(`${endpoint}/json/version`)).json();
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(endpoint && version?.Browser, "Chrome CDP did not become ready within 60 seconds");
    const page = await (await fetch(`${endpoint}/json/new?${encodeURIComponent("about:blank")}`, {
      method: "PUT",
    })).json() as any;
    const cdp = await CdpClient.connect(page.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Page.bringToFront");
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await cdp.send("Emulation.setIdleOverride", { isUserActive: true, isScreenUnlocked: true });
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: options.viewport.width,
      height: options.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return {
      cdp,
      browserVersion: version.Browser,
      viewport: options.viewport,
      displayMode,
      async close() {
        cdp.socket.close();
        if (chrome && chrome.exitCode === null) {
          chrome.kill("SIGTERM");
          await Promise.race([
            new Promise<void>((resolve) => chrome!.once("exit", () => resolve())),
            new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
          ]);
        }
        await chromeLog.close();
        await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      },
    };
  } catch (error) {
    if (chrome && chrome.exitCode === null) chrome.kill("SIGTERM");
    await chromeLog.close();
    await fs.rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    throw error;
  }
}
