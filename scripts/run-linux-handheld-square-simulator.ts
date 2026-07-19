#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION,
  expectedLinuxHandheldSimulatorStatus,
  validateLinuxHandheldSimulatorValidation,
  validateTargetProfile,
  type LinuxHandheldSimulatorValidationV1,
  type LinuxHandheldTargetProfileV1,
} from "../packages/contracts/src/index.ts";
import { evaluateLinuxHandheldPerformance } from "../apps/mobile/src/linux-handheld-capture.ts";
import { inventoryWebAssets, webAssetTreeSha256 } from "../apps/mobile/src/web-release-inventory.ts";
import { launchChromiumSimulator, startStaticProductServer } from "./lib/chromium-simulator.ts";

const CAPTURE_SECONDS = 60;
const VIEWPORT = { width: 1024, height: 1024 } as const;
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
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const productRoot = await fs.realpath(path.resolve(required("product")));
const targetPath = path.resolve(required("target"));
const evidenceRoot = path.resolve(required("evidence"));
await fs.mkdir(evidenceRoot, { recursive: true });
const targetBytes = await fs.readFile(targetPath);
const targetUnknown: unknown = JSON.parse(targetBytes.toString("utf8"));
const targetValidation = validateTargetProfile(targetUnknown);
if (!targetValidation.ok || (targetUnknown as { target?: unknown }).target !== "linux-handheld-web") {
  throw new Error(`Invalid Linux target profile: ${targetValidation.errors.join("; ")}`);
}
const target = targetUnknown as LinuxHandheldTargetProfileV1;
const squareProfile = target.layoutProfiles.find((profile) => profile.id === "square-handheld-1024x1024");
if (!squareProfile || squareProfile.viewport.width !== VIEWPORT.width || squareProfile.viewport.height !== VIEWPORT.height) {
  throw new Error("Linux target must retain the canonical 1024-square handheld layout profile");
}
const assetManifestBytes = await fs.readFile(path.join(productRoot, "asset-manifest.json"));
const assetManifest = JSON.parse(assetManifestBytes.toString("utf8")) as Record<string, {
  readonly file?: unknown;
  readonly isEntry?: unknown;
  readonly src?: unknown;
}>;
const entry = assetManifest["index.html"];
if (!entry || entry.isEntry !== true || typeof entry.file !== "string") {
  throw new Error("Web asset manifest does not identify the index.html entry module");
}
const entryModuleBytes = await fs.readFile(path.join(productRoot, entry.file));

const server = await startStaticProductServer(productRoot);
const session = await launchChromiumSimulator({
  evidenceRoot,
  logName: "linux-square-chrome.log",
  viewport: VIEWPORT,
});
const { cdp } = session;
let serverClosed = false;
try {
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const buttons = Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 }));
      const gamepad = {
        id: 'Aico 8 CI Standard Gamepad', index: 0, connected: true,
        mapping: 'standard', timestamp: 1, axes: [0, 0, 0, 0], buttons,
        vibrationActuator: null,
      };
      Object.defineProperty(window, '__aico8VirtualGamepad', { value: gamepad });
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [gamepad] });
    })();`,
  });
  const navigationStarted = performance.now();
  await cdp.send("Page.navigate", { url: `${server.origin}/?platform-validation=1` });
  let ready = false;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ready = await cdp.evaluate<boolean>(
      "document.querySelector('.player-shell') !== null && window.__aico8PlatformValidation?.inputMask instanceof Function",
    ).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!ready) throw new Error("Linux shared Web host did not become ready");
  const coldLaunchMilliseconds = Number((performance.now() - navigationStarted).toFixed(3));

  const serviceWorkerReady = await cdp.evaluate<boolean>(`Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 10000)),
  ])`);
  if (!serviceWorkerReady) throw new Error("Service worker did not install within 10 seconds");
  await cdp.send("Page.navigate", { url: `${server.origin}/?platform-validation=1&controlled=1` });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ready = await cdp.evaluate<boolean>(
      "document.querySelector('.player-shell') !== null && navigator.serviceWorker.controller !== null "
        + "&& window.__aico8PlatformValidation?.inputMask instanceof Function",
    ).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!ready) {
    const diagnosis = await cdp.evaluate<any>(`Promise.all([
      navigator.serviceWorker.getRegistrations().then(items => items.map(item => ({
        scope: item.scope,
        active: item.active?.state ?? null,
        waiting: item.waiting?.state ?? null,
        installing: item.installing?.state ?? null,
      }))),
      caches.keys(),
    ]).then(([registrations, cacheKeys]) => ({
      url: location.href,
      controller: navigator.serviceWorker.controller?.scriptURL ?? null,
      registrations,
      cacheKeys,
    }))`);
    throw new Error(`Reloaded Web host is not service-worker controlled: ${JSON.stringify(diagnosis)}`);
  }

  const storageKey = "aico8-linux-square-simulator";
  const storageValue = `roundtrip-${Date.now()}`;
  await cdp.evaluate<void>(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(storageValue)})`);
  await cdp.send("Page.navigate", { url: `${server.origin}/?platform-validation=1&controlled=1&storage=1` });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    ready = await cdp.evaluate<boolean>(
      "document.querySelector('.player-shell') !== null && window.__aico8PlatformValidation?.inputMask instanceof Function",
    ).catch(() => false);
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!ready) throw new Error("Storage-reload Web host did not become ready");
  const stored = await cdp.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(storageKey)})`);
  const storageReport = { key: storageKey, expected: storageValue, observed: stored, passed: stored === storageValue };

  const controllerReport = await cdp.evaluate<any>(`(() => {
    const gamepad = window.__aico8VirtualGamepad;
    const probe = window.__aico8PlatformValidation;
    if (!gamepad || !probe) return {
      passed: false,
      reason: 'fixture-or-product-probe-missing',
      fixturePresent: Boolean(gamepad),
      productProbePresent: Boolean(probe),
      url: location.href,
    };
    const set = (...pressed) => gamepad.buttons.forEach((button, index) => {
      button.pressed = pressed.includes(index); button.touched = button.pressed; button.value = button.pressed ? 1 : 0;
    });
    set(14, 0); const leftAndO = probe.inputMask();
    set(15, 1); const rightAndX = probe.inputMask();
    set(); const released = probe.inputMask();
    return {
      fixtureId: gamepad.id, mapping: gamepad.mapping,
      leftAndO, rightAndX, released,
      passed: leftAndO === 17 && rightAndX === 34 && released === 0,
    };
  })()`);
  if (controllerReport.passed !== true) {
    throw new Error(`Linux simulated controller path failed: ${JSON.stringify(controllerReport)}`);
  }

  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 512, y: 512, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 512, y: 512, button: "left", clickCount: 1 });
  let audioGraphAvailable = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    audioGraphAvailable = await cdp.evaluate<boolean>(`(() => {
      const frame = document.querySelector('.game-frame');
      return Boolean(window.AudioContext || window.webkitAudioContext)
        && frame?.dataset.audioUnlockStatus === 'running';
    })()`).catch(() => false);
    if (audioGraphAvailable) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const capabilities = await cdp.evaluate<any>(`(() => ({
      innerWidth, innerHeight,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      serviceWorkerControlled: navigator.serviceWorker.controller !== null,
      fullscreenApiAvailable: document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function',
      audioGraphAvailable: Boolean(window.AudioContext || window.webkitAudioContext),
      wasmAvailable: typeof WebAssembly === 'object',
      userAgent: navigator.userAgent,
    }))()`);

  await cdp.evaluate<void>(`(() => {
    window.__aico8LifecycleFrames = 0;
    const loop = () => { window.__aico8LifecycleFrames += 1; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const framesBeforeFreeze = await cdp.evaluate<number>("window.__aico8LifecycleFrames");
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await cdp.send("Page.bringToFront");
  await new Promise((resolve) => setTimeout(resolve, 250));
  const framesAfterResume = await cdp.evaluate<number>("window.__aico8LifecycleFrames");
  const lifecycleReport = {
    method: "cdp-page-frozen-active",
    framesBeforeFreeze,
    framesAfterResume,
    passed: framesBeforeFreeze > 0 && framesAfterResume > framesBeforeFreeze,
  };

  const measurement = await cdp.evaluate<{ callbacks: number; intervals: number[] }>(`new Promise(resolve => {
    const marker = document.createElement('span');
    marker.id = 'aico8-linux-performance-marker';
    marker.style.cssText = 'position:fixed;left:8px;top:8px;width:8px;height:8px;background:#ff5d9e;opacity:.25;z-index:2147483647;will-change:transform';
    document.body.appendChild(marker);
    const intervals = []; let callbacks = 0; let previous; const started = performance.now();
    const sample = now => {
      callbacks += 1; if (previous !== undefined) intervals.push(now - previous); previous = now;
      marker.style.transform = 'translateX(' + String(callbacks % 48) + 'px)';
      if (now - started >= ${CAPTURE_SECONDS * 1_000}) resolve({ callbacks, intervals });
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  })`);
  const performanceResult = evaluateLinuxHandheldPerformance(measurement.intervals, target, CAPTURE_SECONDS);
  const screenshotResult = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const screenshot = Buffer.from(screenshotResult.data, "base64");
  await fs.writeFile(path.join(evidenceRoot, "ready.png"), screenshot);

  // WebGL capability is collected in a separate fresh browser. SwiftShader is
  // deterministic in hosted CI but can make the compositor itself software
  // rendered; sharing that process would measure the probe rather than the
  // unchanged product path. The performance session above therefore retains
  // the system backend and its complete 60-second frame series.
  const graphicsSession = await launchChromiumSimulator({
    evidenceRoot,
    logName: "linux-square-webgl-chrome.log",
    viewport: VIEWPORT,
    graphicsBackend: "swiftshader-webgl",
  });
  let webgl2Probe: any;
  try {
    await graphicsSession.cdp.send("Page.navigate", { url: `${server.origin}/?platform-validation=1&webgl-probe=1` });
    let graphicsReady = false;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      graphicsReady = await graphicsSession.cdp.evaluate<boolean>(
        "document.querySelector('.player-shell') !== null",
      ).catch(() => false);
      if (graphicsReady) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!graphicsReady) throw new Error("Linux WebGL capability session did not load the product host");
    webgl2Probe = await graphicsSession.cdp.evaluate<any>(`(() => {
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl2');
      const rendererInfo = context?.getExtension('WEBGL_debug_renderer_info');
      const renderer = rendererInfo ? context.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : null;
      context?.getExtension('WEBGL_lose_context')?.loseContext();
      return {
        available: Boolean(context),
        renderer,
        innerWidth,
        innerHeight,
        userAgent: navigator.userAgent,
      };
    })()`);
    webgl2Probe.browser = graphicsSession.browserVersion;
    webgl2Probe.displayMode = graphicsSession.displayMode;
  } finally {
    await graphicsSession.close();
  }

  const capabilityReport = {
    ...capabilities,
    browser: session.browserVersion,
    displayMode: session.displayMode,
    audioUnlockPassed: audioGraphAvailable,
    webgl2Probe,
  };
  const performanceReport = { requestAnimationFrameCallbacks: measurement.callbacks, ...performanceResult };
  const reports = {
    "capabilities.json": capabilityReport,
    "storage.json": storageReport,
    "controller.json": controllerReport,
    "lifecycle.json": lifecycleReport,
    "performance.json": performanceReport,
  } as const;
  for (const [filename, value] of Object.entries(reports)) {
    await fs.writeFile(path.join(evidenceRoot, filename), jsonBytes(value));
  }

  await server.close();
  serverClosed = true;
  await cdp.send("Page.navigate", { url: `${server.origin}/?platform-validation=1&controlled=1&storage=1&offline=1` });
  let offlineReload = false;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    offlineReload = await cdp.evaluate<boolean>(
      "document.querySelector('.player-shell') !== null && navigator.serviceWorker.controller !== null",
    ).catch(() => false);
    if (offlineReload) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const offlineReport = {
    serverStopped: true,
    serviceWorkerControlled: offlineReload,
    playerShellReady: offlineReload,
    passed: offlineReload,
  };
  await fs.writeFile(path.join(evidenceRoot, "offline.json"), jsonBytes(offlineReport));

  const webFiles = await inventoryWebAssets(productRoot);
  const artifactFiles = {
    screenshotSha256: "ready.png",
    capabilityReportSha256: "capabilities.json",
    offlineReportSha256: "offline.json",
    storageReportSha256: "storage.json",
    controllerReportSha256: "controller.json",
    lifecycleReportSha256: "lifecycle.json",
    performanceReportSha256: "performance.json",
  } as const;
  const artifacts = Object.fromEntries(await Promise.all(Object.entries(artifactFiles).map(async ([field, filename]) => [
    field,
    sha256(await fs.readFile(path.join(evidenceRoot, filename))),
  ]))) as unknown as LinuxHandheldSimulatorValidationV1["artifacts"];
  const [browserName = "Chrome", browserVersion = "unknown"] = session.browserVersion.split("/");
  const reportBase = {
    schemaVersion: LINUX_HANDHELD_SIMULATOR_VALIDATION_SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    subject: {
      webReleaseTreeSha256: webAssetTreeSha256(webFiles),
      assetManifestSha256: sha256(assetManifestBytes),
      targetProfileId: target.id,
      targetProfileSha256: sha256(targetBytes),
      entryModuleSha256: sha256(entryModuleBytes),
    },
    simulator: {
      profileId: "linux-chromium-1024-square-v1",
      environmentClass: "linux-chromium-square-simulator" as const,
      osName: os.type(), osVersion: os.version(), kernelVersion: os.release(), architecture: os.arch(),
      sessionType: "x11" as const,
      viewport: VIEWPORT,
      browser: { name: browserName, version: browserVersion, engine: "Blink" as const },
      graphicsRenderer: webgl2Probe.renderer ?? "unavailable",
      controllerFixture: "pre-navigation-standard-gamepad" as const,
    },
    automatedChecks: {
      freshBrowserProfile: true,
      exactWebArtifact: true,
      squareViewport: capabilities.innerWidth === 1024 && capabilities.innerHeight === 1024,
      offlineReload,
      serviceWorkerControlled: capabilities.serviceWorkerControlled === true,
      persistentStorageRoundTrip: storageReport.passed,
      simulatedControllerInputPassed: controllerReport.passed === true,
      fullscreenApiAvailable: capabilities.fullscreenApiAvailable === true,
      audioGraphAvailable,
      lifecycleFreezeResumePassed: lifecycleReport.passed,
      wasmAvailable: capabilities.wasmAvailable === true,
      webgl2Available: webgl2Probe.available === true,
      readyScreenshotCaptured: screenshot.byteLength > 0,
      coldLaunchMilliseconds,
      performance: performanceResult,
    },
    artifacts,
  };
  const report: LinuxHandheldSimulatorValidationV1 = {
    ...reportBase,
    status: expectedLinuxHandheldSimulatorStatus(reportBase),
  };
  const validation = validateLinuxHandheldSimulatorValidation(report);
  if (!validation.ok) throw new Error(`Generated invalid Linux simulator report: ${validation.errors.join("; ")}`);
  await fs.writeFile(path.join(evidenceRoot, "linux-handheld-simulator.json"), jsonBytes(report));
  if (report.status !== "passed") throw new Error(`Linux square simulator failed: ${JSON.stringify(report.automatedChecks)}`);
  process.stdout.write(
    `Linux square simulator passed ${performanceResult.observedSampleFrames} frames at `
      + `${performanceResult.p95FrameMilliseconds} ms p95; ${evidenceRoot}\n`,
  );
} finally {
  if (!serverClosed) await server.close();
  await session.close();
}
