import { Application, Graphics, Text } from "pixi.js";

import {
  assertReplay,
  REFERENCE_PROFILE,
  validateTargetProfile,
  type ReplayHostAction,
  type ReplayV1,
  type WebTargetProfileV1,
} from "@aico8/contracts";

import { InputController } from "./runtime/input.js";
import { settleCaptureReadiness } from "./runtime/capture-readiness.js";
import { Aico8Kernel, loadGameManifest, prepareKernelForLogicalReplay } from "./runtime/kernel.js";
import {
  resolvePackageAssetUrl,
  resolvePackageBaseUrl,
  resolvePackageChildAssetUrl,
} from "./runtime/package-url.js";
import { KernelAudioOutput } from "./runtime/audio-output.js";
import { sampleFrameIntervals, summarizeFrameIntervals } from "./runtime/performance.js";
import type { PrivatePresentationModule, PresentationRenderer } from "./runtime/presentation.js";
import { HD_RENDER_QUALITY } from "./runtime/render-quality.js";
import { ReferenceRenderer } from "./runtime/reference-renderer.js";
import {
  advancePresentationTime,
  parseValidationInteger,
  playInitializationToHostTick,
  playNeutralInputProbe,
  playReplayToMilestone,
  playReplayToUpdate,
} from "./runtime/replay-player.js";

import "./style.css";

const mount = document.querySelector<HTMLElement>("#app");
if (!mount) throw new Error("Aico 8 mount element is missing");

mount.innerHTML = `
  <section class="player-shell" aria-live="polite">
    <header class="player-header">
      <div>
        <p class="eyebrow">AICO 8 · PRIVATE RESEARCH BUILD</p>
        <h1 id="game-title">Preparing game…</h1>
        <p id="game-credit" class="credit">Compatibility-first HD remake</p>
      </div>
      <div class="header-actions">
        <button id="display-button" type="button" disabled>HD view</button>
        <button id="pause-button" type="button" disabled>Pause</button>
        <button id="fullscreen-button" type="button">Full screen</button>
      </div>
    </header>
    <div class="game-frame" id="game-frame">
      <div id="game-surface" class="game-surface"></div>
      <div id="loading-card" class="loading-card">
        <span class="loading-dot" aria-hidden="true"></span>
        <strong id="loading-title">Loading the shared game kernel</strong>
        <span id="loading-detail">The first launch can take a moment.</span>
      </div>
      <div id="system-menu" class="system-menu hidden" role="dialog" aria-modal="true" aria-labelledby="system-menu-title" aria-hidden="true">
        <section class="system-menu-panel">
          <p class="eyebrow">PICO-8 MENU</p>
          <h2 id="system-menu-title">Game paused</h2>
          <div id="system-menu-actions" class="system-menu-actions"></div>
        </section>
      </div>
      <div class="touch-controls" id="touch-controls" aria-label="Touch game controls">
        <button class="touch menu-trigger" data-p8-menu aria-label="Game menu">☰</button>
        <div class="dpad">
          <button class="touch up" data-p8-button="2" aria-label="Up">↑</button>
          <button class="touch left" data-p8-button="0" aria-label="Left">←</button>
          <button class="touch right" data-p8-button="1" aria-label="Right">→</button>
          <button class="touch down" data-p8-button="3" aria-label="Down">↓</button>
        </div>
        <div class="action-pad">
          <button class="touch action secondary" data-p8-button="5" aria-label="Secondary action">X</button>
          <button class="touch action primary" data-p8-button="4" aria-label="Primary action">O</button>
        </div>
      </div>
    </div>
    <footer class="player-footer">
      <span id="player-status">Starting…</span>
      <span class="control-hint">Arrows / WASD · Z / X · controller · touch</span>
    </footer>
    <p id="game-announcer" class="visually-hidden" role="status" aria-live="polite"></p>
  </section>
`;

const surface = document.querySelector<HTMLElement>("#game-surface");
const frame = document.querySelector<HTMLElement>("#game-frame");
const loadingCard = document.querySelector<HTMLElement>("#loading-card");
const loadingTitle = document.querySelector<HTMLElement>("#loading-title");
const loadingDetail = document.querySelector<HTMLElement>("#loading-detail");
const title = document.querySelector<HTMLElement>("#game-title");
const credit = document.querySelector<HTMLElement>("#game-credit");
const status = document.querySelector<HTMLElement>("#player-status");
const announcer = document.querySelector<HTMLElement>("#game-announcer");
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-button");
const displayButton = document.querySelector<HTMLButtonElement>("#display-button");
const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen-button");
const touchControls = document.querySelector<HTMLElement>("#touch-controls");
const systemMenu = document.querySelector<HTMLElement>("#system-menu");
const systemMenuActions = document.querySelector<HTMLElement>("#system-menu-actions");
if (!surface || !frame || !loadingCard || !loadingTitle || !loadingDetail || !title || !credit
  || !status || !announcer || !pauseButton || !displayButton || !fullscreenButton || !touchControls
  || !systemMenu || !systemMenuActions) {
  throw new Error("Aico 8 player controls are incomplete");
}
const systemMenuElement = systemMenu;
const systemMenuActionsElement = systemMenuActions;
const systemMenuFrame = frame;
const systemMenuToggle = pauseButton;
const systemMenuStatus = status;
const performanceFrame = frame;
const performanceLoadingCard = loadingCard;
const captureFrame = frame;
const captureLoadingCard = loadingCard;
captureFrame.dataset.captureStatus = "initializing";

function waitForPresentedFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function waitForLoadingOverlayTransition(): Promise<void> {
  const style = getComputedStyle(captureLoadingCard);
  if (captureLoadingCard.classList.contains("hidden") && style.opacity === "0" && style.visibility === "hidden") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let finished = false;
    const finish = (): void => {
      if (finished) return;
      finished = true;
      captureLoadingCard.removeEventListener("transitionend", onTransitionEnd);
      resolve();
    };
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === captureLoadingCard && event.propertyName === "opacity") finish();
    };
    captureLoadingCard.addEventListener("transitionend", onTransitionEnd);
    window.setTimeout(finish, 320);
  });
}

let captureReadinessGeneration = 0;
function beginCaptureReadiness(): void {
  const generation = ++captureReadinessGeneration;
  delete captureFrame.dataset.captureLoadingHidden;
  delete captureFrame.dataset.captureLoadingOpacity;
  delete captureFrame.dataset.captureLoadingVisibility;
  delete captureFrame.dataset.capturePresentedFrames;
  delete captureFrame.dataset.captureError;
  captureFrame.dataset.captureStatus = "settling";
  void settleCaptureReadiness({
    waitForOverlayTransition: waitForLoadingOverlayTransition,
    waitForPresentedFrame,
    readOverlay: () => {
      const style = getComputedStyle(captureLoadingCard);
      return {
        hiddenClass: captureLoadingCard.classList.contains("hidden"),
        opacity: Number(style.opacity),
        visibility: style.visibility,
      };
    },
  }).then((readiness) => {
    if (generation !== captureReadinessGeneration) return;
    captureFrame.dataset.captureLoadingHidden = String(readiness.hiddenClass);
    captureFrame.dataset.captureLoadingOpacity = String(readiness.opacity);
    captureFrame.dataset.captureLoadingVisibility = readiness.visibility;
    captureFrame.dataset.capturePresentedFrames = String(readiness.presentedFrames);
    captureFrame.dataset.captureStatus = "ready";
  }).catch((error: unknown) => {
    if (generation !== captureReadinessGeneration) return;
    captureFrame.dataset.captureStatus = "failed";
    captureFrame.dataset.captureError = error instanceof Error ? error.message : String(error);
  });
}

const app = new Application();
await app.init({
  width: REFERENCE_PROFILE.outputWidth,
  height: REFERENCE_PROFILE.outputHeight,
  preference: "webgl",
  antialias: HD_RENDER_QUALITY.antialias,
  autoDensity: HD_RENDER_QUALITY.autoDensity,
  resolution: HD_RENDER_QUALITY.edgeSupersampleFactor,
  background: "#090b12",
});
await document.fonts.load("700 48px Aico Sans");
app.canvas.setAttribute("aria-label", "Aico 8 game surface, 1024 by 1024 pixels");
surface.append(app.canvas);

function showEmptyPlayer(): void {
  const background = new Graphics()
    .rect(0, 0, 1024, 1024)
    .fill({ color: 0x090b12 });
  const halo = new Graphics()
    .circle(512, 430, 250)
    .fill({ color: 0xff77a8, alpha: 0.08 });
  const mark = new Text({
    text: "AICO 8",
    style: {
      fill: 0xfff1e8,
      fontFamily: "Aico Sans, ui-rounded, system-ui, sans-serif",
      fontSize: 108,
      fontWeight: "800",
      letterSpacing: 12,
    },
    anchor: 0.5,
  });
  mark.position.set(512, 430);
  const message = new Text({
    text: "No private research game is bundled in this public build.",
    style: {
      fill: 0xc2c3c7,
      fontFamily: "Aico Sans, system-ui, sans-serif",
      fontSize: 30,
    },
    anchor: 0.5,
  });
  message.position.set(512, 560);
  app.stage.addChild(background, halo, mark, message);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadValidationReplay(
  packageBaseUrl: URL,
  manifestUrl: URL,
  relative: string,
): Promise<ReplayV1> {
  const response = await fetch(resolvePackageChildAssetUrl(packageBaseUrl, manifestUrl, relative));
  if (!response.ok) throw new Error(`Unable to load validation replay (${response.status})`);
  const replay: unknown = await response.json();
  assertReplay(replay);
  if (replay.trace.initialState.kind !== "clean") {
    throw new Error("Browser validation playback requires a clean replay initial state");
  }
  const cleanPersistence = new Uint8Array(256);
  if (await sha256Hex(cleanPersistence) !== replay.trace.initialState.persistenceSha256) {
    throw new Error("Validation replay clean-persistence lineage does not match the host contract");
  }
  return replay;
}

async function loadTargetProfile(url: URL): Promise<WebTargetProfileV1> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load Web target profile (${response.status})`);
  const profile: unknown = await response.json();
  const validation = validateTargetProfile(profile);
  if (!validation.ok) throw new Error(`Invalid Web target profile: ${validation.errors.join("; ")}`);
  return profile as WebTargetProfileV1;
}

function roundedMeasurement(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function measureReleasePerformance(profile: WebTargetProfileV1): void {
  if (performanceFrame.dataset.releasePerformanceStatus) return;
  let settled = false;
  const begin = (): void => {
    if (settled) return;
    settled = true;
    performanceFrame.dataset.releasePerformanceStatus = "sampling";
    const startupMilliseconds = roundedMeasurement(performance.now());
    performanceFrame.dataset.releaseStartupMilliseconds = String(startupMilliseconds);
    const environment = profile.measurementEnvironment;
    void sampleFrameIntervals(environment.sampleFrames, environment.warmupFrames)
      .then((intervals) => {
        const summary = summarizeFrameIntervals(intervals, environment.droppedFrameThresholdMilliseconds);
        performanceFrame.dataset.releaseFrameSampleCount = String(summary.sampleFrames);
        performanceFrame.dataset.releaseP95FrameMilliseconds = String(summary.p95FrameMilliseconds);
        performanceFrame.dataset.releaseMaxFrameMilliseconds = String(summary.maxFrameMilliseconds);
        performanceFrame.dataset.releaseDroppedFrameRatio = String(summary.droppedFrameRatio);
        performanceFrame.dataset.releaseRuntimeBudgetPassed = String(
          startupMilliseconds <= profile.budgets.startupMillisecondsMax
          && summary.p95FrameMilliseconds <= profile.budgets.p95FrameMillisecondsMax
          && summary.droppedFrameRatio <= profile.budgets.droppedFrameRatioMax,
        );
        performanceFrame.dataset.releasePerformanceStatus = "complete";
      })
      .catch((error: unknown) => {
        performanceFrame.dataset.releasePerformanceStatus = "failed";
        performanceFrame.dataset.releasePerformanceError = error instanceof Error ? error.message : String(error);
      });
  };
  performanceLoadingCard.addEventListener("transitionend", begin, { once: true });
  window.setTimeout(begin, 300);
}

const input = new InputController();
input.bindTouchControls(touchControls);
const audioOutput = new KernelAudioOutput();
const audioFrame = frame;
function syncAudioDiagnostics(): void {
  const diagnostics = audioOutput.diagnostics();
  audioFrame.dataset.audioContextState = diagnostics.contextState;
  audioFrame.dataset.audioUnlocked = String(diagnostics.unlocked);
  audioFrame.dataset.audioSampleRate = String(diagnostics.sampleRate);
  audioFrame.dataset.audioPendingSamples = String(diagnostics.pendingSamples);
  audioFrame.dataset.audioDroppedPendingSamples = String(diagnostics.droppedPendingSamples);
  audioFrame.dataset.audioScheduledSamples = String(diagnostics.scheduledSamples);
  audioFrame.dataset.audioScheduledChunks = String(diagnostics.scheduledChunks);
  audioFrame.dataset.audioUnderrunCount = String(diagnostics.underrunCount);
  audioFrame.dataset.audioUnderrunMilliseconds = String(
    roundedMeasurement(diagnostics.underrunSeconds * 1000),
  );
  audioFrame.dataset.audioLeadResyncCount = String(diagnostics.leadResyncCount);
  audioFrame.dataset.audioBufferedLeadMilliseconds = String(
    roundedMeasurement(diagnostics.bufferedLeadSeconds * 1000),
  );
  audioFrame.dataset.audioMaximumBufferedLeadMilliseconds = String(
    roundedMeasurement(diagnostics.maximumBufferedLeadSeconds * 1000),
  );
  audioFrame.dataset.audioBaseLatencyMilliseconds = diagnostics.baseLatencySeconds === null
    ? "unavailable"
    : String(roundedMeasurement(diagnostics.baseLatencySeconds * 1000));
  audioFrame.dataset.audioOutputLatencyMilliseconds = diagnostics.outputLatencySeconds === null
    ? "unavailable"
    : String(roundedMeasurement(diagnostics.outputLatencySeconds * 1000));
}
syncAudioDiagnostics();
const unlockAudio = (): void => {
  audioFrame.dataset.audioUnlockStatus = "pending";
  const unlocking = audioOutput.unlock();
  syncAudioDiagnostics();
  void unlocking
    .then(() => {
      audioFrame.dataset.audioUnlockStatus = "running";
      delete audioFrame.dataset.audioUnlockError;
      syncAudioDiagnostics();
    })
    .catch((error: unknown) => {
      audioFrame.dataset.audioUnlockStatus = "failed";
      audioFrame.dataset.audioUnlockError = error instanceof Error ? error.message : String(error);
      syncAudioDiagnostics();
    });
};
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);
let paused = false;
let runtime: Aico8Kernel | undefined;
let validationPlaybackStatus: string | undefined;
let systemMenuOpen = false;
let priorSystemMenuMask = 0;
let systemMenuButtons: HTMLButtonElement[] = [];
const systemMenuInvocations = new WeakMap<HTMLButtonElement, (buttons: number) => void>();
const privatePresentations = import.meta.glob<PrivatePresentationModule>("./private/*.ts");

function closeSystemMenu(): void {
  if (!systemMenuOpen) return;
  systemMenuOpen = false;
  paused = false;
  systemMenuElement.classList.add("hidden");
  systemMenuElement.setAttribute("aria-hidden", "true");
  systemMenuFrame.dataset.systemMenuOpen = "false";
  systemMenuToggle.textContent = "Menu";
  systemMenuStatus.textContent = validationPlaybackStatus ?? "Playing";
  input.resetAfterMenu();
  beginCaptureReadiness();
}

function addSystemMenuButton(label: string, invoke: (buttons: number) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => invoke(0));
  systemMenuInvocations.set(button, invoke);
  systemMenuActionsElement.append(button);
  systemMenuButtons.push(button);
  return button;
}

function refreshSystemMenu(): void {
  systemMenuActionsElement.replaceChildren();
  systemMenuButtons = [];
  addSystemMenuButton("Continue", () => closeSystemMenu());
  for (const item of runtime?.menuItems() ?? []) {
    const button = addSystemMenuButton(item.label, (buttons) => {
      if (!runtime) return;
      const keepOpen = runtime.invokeMenuItem(item.index, buttons);
      if (keepOpen) {
        refreshSystemMenu();
        systemMenuButtons[0]?.focus();
      } else {
        closeSystemMenu();
      }
    });
    button.dataset.cartMenuItem = String(item.index);
    button.dataset.buttonFilter = String(item.filter);
  }
  addSystemMenuButton("Restart game", () => window.location.reload());
}

function openSystemMenu(): void {
  if (systemMenuOpen || !runtime) return;
  systemMenuOpen = true;
  paused = true;
  refreshSystemMenu();
  systemMenuElement.classList.remove("hidden");
  systemMenuElement.setAttribute("aria-hidden", "false");
  systemMenuFrame.dataset.systemMenuOpen = "true";
  systemMenuToggle.textContent = "Resume";
  systemMenuStatus.textContent = "Paused · game menu";
  priorSystemMenuMask = input.mask();
  input.commitLogicalUpdate();
  systemMenuButtons[0]?.focus();
  beginCaptureReadiness();
}

function toggleSystemMenu(): void {
  if (systemMenuOpen) closeSystemMenu();
  else openSystemMenu();
}

function moveSystemMenuFocus(direction: -1 | 1): void {
  if (systemMenuButtons.length === 0) return;
  const active = document.activeElement;
  const current = active instanceof HTMLButtonElement ? systemMenuButtons.indexOf(active) : -1;
  const next = (Math.max(0, current) + direction + systemMenuButtons.length) % systemMenuButtons.length;
  systemMenuButtons[next]?.focus();
}

function processSystemMenuInput(): void {
  const current = input.mask();
  const pressed = current & ~priorSystemMenuMask;
  priorSystemMenuMask = current;
  input.commitLogicalUpdate();
  if (pressed & (1 << 2)) moveSystemMenuFocus(-1);
  else if (pressed & (1 << 3)) moveSystemMenuFocus(1);
  else if (pressed & ((1 << 0) | (1 << 1) | (1 << 4) | (1 << 5))) {
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement)) return;
    const isCartItem = active.dataset.cartMenuItem !== undefined;
    if (isCartItem || (pressed & ((1 << 4) | (1 << 5)))) {
      systemMenuInvocations.get(active)?.(pressed);
    }
  }
}

pauseButton.textContent = "Menu";
pauseButton.addEventListener("click", toggleSystemMenu);
document.addEventListener("keydown", (event) => {
  if (!systemMenuOpen) return;
  if (event.code === "Escape" || event.code === "KeyP") {
    event.preventDefault();
    event.stopPropagation();
    closeSystemMenu();
  } else if (event.code === "Enter") {
    event.stopPropagation();
  }
}, { passive: false });
fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await frame.requestFullscreen();
});

const packageBaseUrl = resolvePackageBaseUrl(import.meta.env.BASE_URL);

try {
  const manifestUrl = resolvePackageAssetUrl(packageBaseUrl, "private/game.json");
  const targetProfileUrl = resolvePackageAssetUrl(packageBaseUrl, "target-profile.json");
  const [manifest, targetProfile] = await Promise.all([
    loadGameManifest(manifestUrl),
    loadTargetProfile(targetProfileUrl),
  ]);
  frame.dataset.targetProfileId = targetProfile.id;
  title.textContent = manifest.title;
  credit.textContent = `Original by ${manifest.author}`
    + `${manifest.sourceLicense ? ` · ${manifest.sourceLicense}` : ""}`
    + " · Aico 8 private research and testing build";
  loadingTitle.textContent = `Opening ${manifest.title}`;
  loadingDetail.textContent = "Restoring game logic and saved progress…";

  const validationParameters = new URL(window.location.href).searchParams;
  const requestedReplayMilestone = validationParameters.get("validation-replay");
  const requestedReplayUpdate = parseValidationInteger(
    validationParameters.get("validation-update"),
    "validation-update",
    10_000_000,
  );
  const requestedInitializationHostTick = parseValidationInteger(
    validationParameters.get("validation-host-tick"),
    "validation-host-tick",
    36_000,
  );
  const requestedNeutralUpdates = parseValidationInteger(
    validationParameters.get("validation-neutral-updates"),
    "validation-neutral-updates",
    3_600,
  );
  const requestedPresentationMilliseconds = parseValidationInteger(
    validationParameters.get("validation-presentation-ms"),
    "validation-presentation-ms",
    60_000,
  ) ?? 0;
  const requestedBoundaryCount = Number(Boolean(requestedReplayMilestone))
    + Number(requestedReplayUpdate !== undefined)
    + Number(requestedInitializationHostTick !== undefined)
    + Number(requestedNeutralUpdates !== undefined);
  if (requestedBoundaryCount > 1) {
    throw new Error(
      "Choose one of validation-replay, validation-update, validation-host-tick, or validation-neutral-updates",
    );
  }
  if (requestedPresentationMilliseconds > 0
    && requestedBoundaryCount === 0) {
    throw new Error("validation-presentation-ms requires a validation boundary");
  }
  let validationReplay: ReplayV1 | undefined;
  const validationCaptureRequested = requestedBoundaryCount === 1;
  if (validationCaptureRequested) {
    if (!manifest.researchOnly || !manifest.validationReplay || !manifest.cartSha256) {
      throw new Error("This package does not expose research validation playback");
    }
    if (requestedInitializationHostTick !== undefined) {
      loadingDetail.textContent = `Executing source initialization through host tick ${requestedInitializationHostTick}…`;
    } else if (requestedNeutralUpdates !== undefined) {
      loadingDetail.textContent = `Executing ${requestedNeutralUpdates} ordinary neutral-input update(s)…`;
    } else {
      loadingDetail.textContent = requestedReplayMilestone
        ? `Executing ordinary replay input through ${requestedReplayMilestone}…`
        : `Executing ordinary replay input through update ${requestedReplayUpdate}…`;
      validationReplay = await loadValidationReplay(
        packageBaseUrl,
        manifestUrl,
        manifest.validationReplay,
      );
    }
  }

  const loadedRuntime = await Aico8Kernel.create(
    packageBaseUrl,
    manifestUrl,
    manifest,
    validationCaptureRequested
      ? { initialPersistence: new Uint8Array(256), persistenceWrites: false }
      : undefined,
  );
  runtime = loadedRuntime;
  const referenceRenderer = new ReferenceRenderer(app);
  let hdRenderer: PresentationRenderer | undefined;
  if (manifest.presentation !== "reference") {
    const loadPresentation = privatePresentations[`./private/${manifest.presentation}.ts`];
    if (!loadPresentation) throw new Error(`Private presentation adapter is unavailable: ${manifest.presentation}`);
    hdRenderer = (await loadPresentation()).createPresentation(app);
  }
  let showHd = Boolean(hdRenderer);
  referenceRenderer.setVisible(!showHd);
  hdRenderer?.setVisible(showHd);
  frame.dataset.presentationMode = showHd ? "hd" : "reference";
  displayButton.disabled = !hdRenderer;
  displayButton.textContent = showHd ? "Original view" : "HD view";
  displayButton.addEventListener("click", () => {
    showHd = !showHd;
    referenceRenderer.setVisible(!showHd);
    hdRenderer?.setVisible(showHd);
    frame.dataset.presentationMode = showHd ? "hd" : "reference";
    displayButton.textContent = showHd ? "Original view" : "HD view";
    beginCaptureReadiness();
  });
  const renderCurrentFrame = (): void => {
    const commands = loadedRuntime.drawCommands();
    referenceRenderer.render(
      loadedRuntime.framebuffer(),
      loadedRuntime.paletteState().display,
      commands,
    );
    hdRenderer?.update(loadedRuntime, commands);
    const diagnostics = hdRenderer?.diagnostics?.();
    if (diagnostics) {
      frame.dataset.presentationScene = diagnostics.sceneId;
      frame.dataset.unmappedVisualTokens = String(diagnostics.unmappedSourceTokenIds.length);
      frame.dataset.mixedIndexedFragments = String(diagnostics.mixedIndexedFragments);
      frame.dataset.diagnosticReferenceSwitches = String(diagnostics.diagnosticReferenceSwitches);
    }
    const description = hdRenderer?.accessibleDescription?.();
    if (description && announcer.textContent !== description) announcer.textContent = description;
  };

  if (requestedInitializationHostTick !== undefined) {
    const playback = playInitializationToHostTick(loadedRuntime, requestedInitializationHostTick);
    advancePresentationTime(requestedPresentationMilliseconds, (delta) => hdRenderer?.animate(delta));
    renderCurrentFrame();
    paused = true;
    frame.dataset.validationInitializationHostTick = String(playback.hostTicksExecuted);
    frame.dataset.validationInitializationAudioSamples = String(playback.discardedAudioSamples);
    frame.dataset.validationPresentationMilliseconds = String(requestedPresentationMilliseconds);
    validationPlaybackStatus = `Validation initialization · host tick ${playback.hostTicksExecuted}`
      + (requestedPresentationMilliseconds > 0
        ? ` · ${requestedPresentationMilliseconds.toLocaleString("en-US")} ms presentation sample`
        : "");
  } else if (requestedNeutralUpdates !== undefined) {
    const initialization = prepareKernelForLogicalReplay(loadedRuntime);
    const playback = playNeutralInputProbe(requestedNeutralUpdates, (buttonMask) => {
      loadedRuntime.tickLogicalUpdate(buttonMask);
      loadedRuntime.readAudio();
    });
    advancePresentationTime(requestedPresentationMilliseconds, (delta) => hdRenderer?.animate(delta));
    renderCurrentFrame();
    paused = true;
    frame.dataset.validationInitializationHostTicks = String(initialization.hostTicks);
    frame.dataset.validationInitializationAudioSamples = String(initialization.discardedAudioSamples);
    frame.dataset.validationNeutralUpdates = String(playback.updatesExecuted);
    frame.dataset.validationPresentationMilliseconds = String(requestedPresentationMilliseconds);
    validationPlaybackStatus = `Validation neutral-input probe · ${playback.updatesExecuted} logical update(s)`
      + (requestedPresentationMilliseconds > 0
        ? ` · ${requestedPresentationMilliseconds.toLocaleString("en-US")} ms presentation sample`
        : "");
  } else if ((requestedReplayMilestone || requestedReplayUpdate !== undefined)
    && validationReplay && manifest.cartSha256) {
    const initialization = prepareKernelForLogicalReplay(loadedRuntime);
    frame.dataset.validationInitializationHostTicks = String(initialization.hostTicks);
    frame.dataset.validationInitializationAudioSamples = String(initialization.discardedAudioSamples);
    const options = {
      expectedCartSha256: manifest.cartSha256,
      requireCleanInitialState: true,
      executeHostAction: (action: ReplayHostAction): void => {
        const registered = loadedRuntime.menuItems().find(({ index }) => index === action.index);
        if (!registered || registered.label !== action.label) {
          throw new Error(`Validation replay host action does not match live menu item ${action.index}: ${action.label}`);
        }
        if (registered.filter !== action.filter) {
          throw new Error(`Validation replay host action filter does not match live menu item ${action.index}`);
        }
        const keepOpen = loadedRuntime.invokeMenuItem(action.index, action.buttons);
        if (keepOpen !== action.keepOpen) {
          throw new Error(`Validation replay host action keep-open result drifted at update ${action.atUpdate}`);
        }
      },
    };
    const playback = requestedReplayMilestone
      ? playReplayToMilestone(
          validationReplay,
          requestedReplayMilestone,
          (buttonMask) => {
            loadedRuntime.tickLogicalUpdate(buttonMask);
            loadedRuntime.readAudio();
          },
          options,
        )
      : playReplayToUpdate(
          validationReplay,
          requestedReplayUpdate!,
          (buttonMask) => {
            loadedRuntime.tickLogicalUpdate(buttonMask);
            loadedRuntime.readAudio();
          },
          options,
        );
    advancePresentationTime(requestedPresentationMilliseconds, (delta) => hdRenderer?.animate(delta));
    renderCurrentFrame();
    paused = true;
    frame.dataset.validationReplayId = playback.replayId;
    if ("milestoneId" in playback) frame.dataset.validationReplayMilestone = playback.milestoneId;
    else frame.dataset.validationReplayUpdate = String(playback.targetUpdate);
    frame.dataset.validationReplayUpdates = String(playback.updatesExecuted);
    frame.dataset.validationPresentationMilliseconds = String(requestedPresentationMilliseconds);
    const boundary = "milestoneId" in playback ? playback.milestoneId : `update ${playback.targetUpdate}`;
    validationPlaybackStatus = `Validation replay · ${boundary} · ${playback.updatesExecuted.toLocaleString("en-US")} logical updates`
      + (requestedPresentationMilliseconds > 0
        ? ` · ${requestedPresentationMilliseconds.toLocaleString("en-US")} ms presentation sample`
        : "");
  }
  let accumulator = 0;
  const stepMilliseconds = 1000 / 60;
  app.ticker.add((ticker) => {
    if (input.consumeMenuRequest()) toggleSystemMenu();
    if (systemMenuOpen) {
      processSystemMenuInput();
      return;
    }
    if (paused || !runtime) return;
    accumulator = Math.min(accumulator + ticker.deltaMS, 250);
    while (accumulator >= stepMilliseconds) {
      accumulator -= stepMilliseconds;
      const updated = loadedRuntime.tick60(input.mask());
      audioOutput.enqueue(loadedRuntime.readAudio());
      syncAudioDiagnostics();
      if (updated) {
        input.commitLogicalUpdate();
        renderCurrentFrame();
      }
    }
    hdRenderer?.animate(ticker.deltaMS);
  });
  document.addEventListener("visibilitychange", () => {
    accumulator = 0;
    syncAudioDiagnostics();
  });
  loadingCard.classList.add("hidden");
  loadingCard.setAttribute("aria-hidden", "true");
  pauseButton.disabled = false;
  status.textContent = validationPlaybackStatus
    ?? (manifest.researchOnly ? "Playing · research build" : "Playing");
  measureReleasePerformance(targetProfile);
  beginCaptureReadiness();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("game manifest (404)")) {
    showEmptyPlayer();
    title.textContent = "Aico 8 Player";
    credit.textContent = "The public runtime is ready for a rights-cleared game module.";
    loadingCard.classList.add("hidden");
    loadingCard.setAttribute("aria-hidden", "true");
    status.textContent = "Player ready · no game bundled";
    beginCaptureReadiness();
  } else {
    loadingTitle.textContent = "The game could not start";
    loadingDetail.textContent = message;
    loadingCard.classList.add("error");
    status.textContent = "Start failed";
    captureFrame.dataset.captureStatus = "failed";
    captureFrame.dataset.captureError = message;
  }
}

window.addEventListener("pagehide", () => {
  runtime?.destroy();
  void audioOutput.destroy();
}, { once: true });

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const registerServiceWorker = (): void => {
    void navigator.serviceWorker.register(resolvePackageAssetUrl(packageBaseUrl, "service-worker.js"), {
      scope: packageBaseUrl.href,
    });
  };
  if (document.readyState === "complete") registerServiceWorker();
  else window.addEventListener("load", registerServiceWorker, { once: true });
}
