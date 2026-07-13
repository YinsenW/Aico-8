const CACHE_PREFIX = "aico8-web-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const CORE_ASSETS = [
  "./",
  "./asset-manifest.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./fonts/AtkinsonHyperlegible-Regular.woff2",
  "./fonts/AtkinsonHyperlegible-Bold.woff2",
  "./fonts/OFL-Atkinson-Hyperlegible.txt",
  "./kernel/aico8-kernel.js",
  "./kernel/aico8-kernel.wasm"
];

async function cacheBuiltShell(cache) {
  await cache.addAll(CORE_ASSETS);
  const manifestResponse = await fetch("./asset-manifest.json", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("Unable to load the Web build asset manifest");
  const manifest = await manifestResponse.json();
  const relativeAssets = new Set();
  for (const entry of Object.values(manifest)) {
    if (typeof entry.file === "string") relativeAssets.add(entry.file);
    for (const group of [entry.css, entry.assets]) {
      if (Array.isArray(group)) for (const asset of group) relativeAssets.add(asset);
    }
  }
  await Promise.all([...relativeAssets].map(async (relative) => {
    const url = new URL(relative, self.registration.scope);
    const asset = await fetch(url);
    if (asset.ok) await cache.put(url, asset);
  }));
}

async function cachePrivateModule(cache) {
  const manifestUrl = new URL("private/game.json", self.registration.scope);
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) return;
  await cache.put(manifestUrl, response.clone());
  const manifest = await response.json();
  for (const relative of [manifest.rom, manifest.source]) {
    if (typeof relative !== "string") continue;
    const url = new URL(relative, manifestUrl);
    const asset = await fetch(url, { cache: "no-store" });
    if (asset.ok) await cache.put(url, asset);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cacheBuiltShell(cache);
    try { await cachePrivateModule(cache); } catch { /* Public builds intentionally have no private module. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const mutablePath = event.request.mode === "navigate"
      || url.pathname.endsWith("/asset-manifest.json")
      || url.pathname.includes("/kernel/")
      || url.pathname.includes("/private/")
      || url.pathname.includes("/fonts/");
    if (mutablePath) {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const fallback = await cache.match(event.request)
          ?? (event.request.mode === "navigate" ? await cache.match("./") : undefined);
        if (fallback) return fallback;
        throw error;
      }
    }
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === "navigate") {
        const fallback = await cache.match("./");
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
