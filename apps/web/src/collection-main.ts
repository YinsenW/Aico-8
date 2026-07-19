import {
  FixedCollectionLauncherController,
  IframeCollectionDocumentHost,
  loadFixedCollectionLauncher,
} from "./runtime/collection-launcher.js";

import "./collection-style.css";

const collectionStartupStartedAt = performance.now();

const mount = document.querySelector<HTMLElement>("#collection-app");
if (!mount) throw new Error("Aico 8 collection mount is missing");

mount.innerHTML = `
  <main class="collection-shell">
    <header class="collection-header">
      <div>
        <p class="collection-eyebrow">AICO 8 · FIXED COLLECTION</p>
        <h1 id="collection-title">Opening collection…</h1>
        <p id="collection-status" role="status" aria-live="polite">Validating statically bound games</p>
      </div>
      <nav id="collection-games" class="collection-games" aria-label="Games"></nav>
    </header>
    <section id="collection-stage" class="collection-stage" aria-label="Selected game"></section>
  </main>
`;

const title = document.querySelector<HTMLElement>("#collection-title");
const status = document.querySelector<HTMLElement>("#collection-status");
const games = document.querySelector<HTMLElement>("#collection-games");
const stage = document.querySelector<HTMLElement>("#collection-stage");
if (!title || !status || !games || !stage) throw new Error("Aico 8 collection controls are incomplete");

try {
  const manifest = await loadFixedCollectionLauncher(new URL("./collection-runtime.json", window.location.href));
  const host = new IframeCollectionDocumentHost(stage);
  const controller = new FixedCollectionLauncherController(manifest, host);
  title.textContent = manifest.title;
  document.title = `${manifest.title} · Aico 8`;
  const buttons = new Map<string, HTMLButtonElement>();
  const activate = async (moduleId: string): Promise<void> => {
    for (const button of buttons.values()) button.disabled = true;
    const module = manifest.modules.find((candidate) => candidate.moduleId === moduleId)!;
    status.textContent = `Resetting runtime · opening ${module.title}`;
    try {
      await controller.activate(moduleId);
      for (const [id, button] of buttons) button.setAttribute("aria-current", id === moduleId ? "page" : "false");
      status.textContent = `${module.title} · isolated save · runtime reset ${host.resetCount}`;
    } finally {
      for (const button of buttons.values()) button.disabled = false;
    }
  };
  const validationUrl = new URL(window.location.href);
  const validationMode = validationUrl.searchParams.get("validation-collection") === "1";
  if (validationMode) {
    Object.assign(window, {
      __aico8CollectionValidation: {
        activate,
        manifest,
        snapshot: () => ({
          activeModuleId: controller.activeModuleId ?? null,
          resetCount: host.resetCount,
          identity: host.activeIdentity ?? null,
          startupMilliseconds: performance.now() - collectionStartupStartedAt,
        }),
      },
    });
  }
  for (const module of manifest.modules) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = module.title;
    button.addEventListener("click", () => void activate(module.moduleId));
    buttons.set(module.moduleId, button);
    games.append(button);
  }
  const requestedInitialModule = validationMode
    ? validationUrl.searchParams.get("validation-initial-module")
    : null;
  await activate(requestedInitialModule && manifest.modules.some(({ moduleId }) => moduleId === requestedInitialModule)
    ? requestedInitialModule
    : manifest.initialModuleId);
  window.addEventListener("pagehide", () => void controller.destroy(), { once: true });
} catch (error) {
  title.textContent = "Collection unavailable";
  status.textContent = error instanceof Error ? error.message : String(error);
  stage.dataset.collectionStatus = "failed";
}
