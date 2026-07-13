import { Application, Graphics, Text } from "pixi.js";

import {
  assertReplay,
  REFERENCE_PROFILE,
  validateTargetProfile,
  type ReplayV1,
  type WebTargetProfileV1,
} from "@aico8/contracts";

import { InputController } from "./runtime/input.js";
import { Aico8Kernel, loadGameManifest } from "./runtime/kernel.js";
import { sampleFrameIntervals, summarizeFrameIntervals } from "./runtime/performance.js";
import type { PrivatePresentationModule, PresentationRenderer } from "./runtime/presentation.js";
import { ReferenceRenderer } from "./runtime/reference-renderer.js";
import {
  advancePresentationTime,
  parseValidationInteger,
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
      <div class="touch-controls" id="touch-controls" aria-label="Touch game controls">
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
if (!surface || !frame || !loadingCard || !loadingTitle || !loadingDetail || !title || !credit
  || !status || !announcer || !pauseButton || !displayButton || !fullscreenButton || !touchControls) {
  throw new Error("Aico 8 player controls are incomplete");
}
const performanceFrame = frame;
const performanceLoadingCard = loadingCard;

const app = new Application();
await app.init({
  width: REFERENCE_PROFILE.outputWidth,
  height: REFERENCE_PROFILE.outputHeight,
  preference: "webgl",
  antialias: true,
  autoDensity: false,
  resolution: 1,
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
  manifestUrl: URL,
  relative: string,
): Promise<ReplayV1> {
  const response = await fetch(new URL(relative, manifestUrl));
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
let paused = false;
let runtime: Aico8Kernel | undefined;
const privatePresentations = import.meta.glob<PrivatePresentationModule>("./private/*.ts");

pauseButton.addEventListener("click", () => {
  paused = !paused;
  pauseButton.textContent = paused ? "Resume" : "Pause";
  status.textContent = paused ? "Paused" : "Playing";
});
fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await frame.requestFullscreen();
});

try {
  const manifestUrl = new URL(`${import.meta.env.BASE_URL}private/game.json`, window.location.origin);
  const targetProfileUrl = new URL(`${import.meta.env.BASE_URL}target-profile.json`, window.location.origin);
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
  const requestedPresentationMilliseconds = parseValidationInteger(
    validationParameters.get("validation-presentation-ms"),
    "validation-presentation-ms",
    60_000,
  ) ?? 0;
  if (requestedReplayMilestone && requestedReplayUpdate !== undefined) {
    throw new Error("Choose either validation-replay or validation-update, not both");
  }
  if (requestedPresentationMilliseconds > 0
    && !requestedReplayMilestone && requestedReplayUpdate === undefined) {
    throw new Error("validation-presentation-ms requires a validation replay boundary");
  }
  let validationReplay: ReplayV1 | undefined;
  if (requestedReplayMilestone || requestedReplayUpdate !== undefined) {
    if (!manifest.researchOnly || !manifest.validationReplay || !manifest.cartSha256) {
      throw new Error("This package does not expose research validation playback");
    }
    loadingDetail.textContent = requestedReplayMilestone
      ? `Executing ordinary replay input through ${requestedReplayMilestone}…`
      : `Executing ordinary replay input through update ${requestedReplayUpdate}…`;
    validationReplay = await loadValidationReplay(
      manifestUrl,
      manifest.validationReplay,
    );
  }

  const loadedRuntime = await Aico8Kernel.create(
    import.meta.env.BASE_URL,
    manifestUrl,
    manifest,
    validationReplay
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
  });
  const renderCurrentFrame = (): void => {
    const commands = loadedRuntime.drawCommands();
    referenceRenderer.render(loadedRuntime.framebuffer(), commands);
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

  let validationPlaybackStatus: string | undefined;
  if ((requestedReplayMilestone || requestedReplayUpdate !== undefined)
    && validationReplay && manifest.cartSha256) {
    const options = { expectedCartSha256: manifest.cartSha256, requireCleanInitialState: true };
    const playback = requestedReplayMilestone
      ? playReplayToMilestone(
          validationReplay,
          requestedReplayMilestone,
          (buttonMask) => loadedRuntime.tickLogicalUpdate(buttonMask),
          options,
        )
      : playReplayToUpdate(
          validationReplay,
          requestedReplayUpdate!,
          (buttonMask) => loadedRuntime.tickLogicalUpdate(buttonMask),
          options,
        );
    advancePresentationTime(requestedPresentationMilliseconds, (delta) => hdRenderer?.animate(delta));
    renderCurrentFrame();
    paused = true;
    pauseButton.textContent = "Resume";
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
    if (paused || !runtime) return;
    accumulator = Math.min(accumulator + ticker.deltaMS, 250);
    while (accumulator >= stepMilliseconds) {
      accumulator -= stepMilliseconds;
      if (loadedRuntime.tick60(input.mask())) {
        input.commitLogicalUpdate();
        renderCurrentFrame();
      }
    }
    hdRenderer?.animate(ticker.deltaMS);
  });
  document.addEventListener("visibilitychange", () => {
    accumulator = 0;
  });
  loadingCard.classList.add("hidden");
  pauseButton.disabled = false;
  status.textContent = validationPlaybackStatus
    ?? (manifest.researchOnly ? "Playing · research build" : "Playing");
  measureReleasePerformance(targetProfile);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("game manifest (404)")) {
    showEmptyPlayer();
    title.textContent = "Aico 8 Player";
    credit.textContent = "The public runtime is ready for a rights-cleared game module.";
    loadingCard.classList.add("hidden");
    status.textContent = "Player ready · no game bundled";
  } else {
    loadingTitle.textContent = "The game could not start";
    loadingDetail.textContent = message;
    loadingCard.classList.add("error");
    status.textContent = "Start failed";
  }
}

window.addEventListener("pagehide", () => {
  runtime?.destroy();
}, { once: true });

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const registerServiceWorker = (): void => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`, {
      scope: import.meta.env.BASE_URL,
    });
  };
  if (document.readyState === "complete") registerServiceWorker();
  else window.addEventListener("load", registerServiceWorker, { once: true });
}
