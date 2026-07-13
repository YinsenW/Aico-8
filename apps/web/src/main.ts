import { Application, Graphics, Text } from "pixi.js";

import { REFERENCE_PROFILE } from "@aico8/contracts";

import { InputController } from "./runtime/input.js";
import { Aico8Kernel, loadGameManifest } from "./runtime/kernel.js";
import type { PrivatePresentationModule, PresentationRenderer } from "./runtime/presentation.js";
import { ReferenceRenderer } from "./runtime/reference-renderer.js";

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
  const manifest = await loadGameManifest(manifestUrl);
  title.textContent = manifest.title;
  credit.textContent = `Original by ${manifest.author}`
    + `${manifest.sourceLicense ? ` · ${manifest.sourceLicense}` : ""}`
    + " · Aico 8 private research and testing build";
  loadingTitle.textContent = `Opening ${manifest.title}`;
  loadingDetail.textContent = "Restoring game logic and saved progress…";

  runtime = await Aico8Kernel.create(import.meta.env.BASE_URL, manifestUrl, manifest);
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
  let accumulator = 0;
  const stepMilliseconds = 1000 / 60;
  app.ticker.add((ticker) => {
    if (paused || !runtime) return;
    accumulator = Math.min(accumulator + ticker.deltaMS, 250);
    while (accumulator >= stepMilliseconds) {
      accumulator -= stepMilliseconds;
      if (runtime.tick60(input.mask())) {
        input.commitLogicalUpdate();
        const commands = runtime.drawCommands();
        referenceRenderer.render(runtime.framebuffer(), commands);
        hdRenderer?.update(runtime, commands);
        const diagnostics = hdRenderer?.diagnostics?.();
        if (diagnostics) {
          frame.dataset.presentationScene = diagnostics.sceneId;
          frame.dataset.unmappedVisualTokens = String(diagnostics.unmappedSourceTokenIds.length);
          frame.dataset.mixedIndexedFragments = String(diagnostics.mixedIndexedFragments);
          frame.dataset.diagnosticReferenceSwitches = String(diagnostics.diagnosticReferenceSwitches);
        }
        const description = hdRenderer?.accessibleDescription?.();
        if (description && announcer.textContent !== description) announcer.textContent = description;
      }
    }
    hdRenderer?.animate(ticker.deltaMS);
  });
  document.addEventListener("visibilitychange", () => {
    accumulator = 0;
  });
  loadingCard.classList.add("hidden");
  pauseButton.disabled = false;
  status.textContent = manifest.researchOnly ? "Playing · research build" : "Playing";
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
