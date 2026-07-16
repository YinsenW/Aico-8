const scopeRoot = new URL(self.registration.scope);
scopeRoot.search = "";
scopeRoot.hash = "";
if (!scopeRoot.pathname.endsWith("/")) scopeRoot.pathname += "/";
const scopeKey = encodeURIComponent(scopeRoot.pathname);
const CACHE_PREFIX = `aico8-web-${scopeKey}-`;
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const CORE_ASSETS = [
  "./",
  "./asset-manifest.json",
  "./target-profile.json",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./fonts/AtkinsonHyperlegible-Regular.woff2",
  "./fonts/AtkinsonHyperlegible-Bold.woff2",
  "./fonts/OFL-Atkinson-Hyperlegible.txt",
  "./kernel/aico8-kernel.js",
  "./kernel/aico8-kernel.wasm"
];

function resolveScopeAsset(relativePath, base = scopeRoot) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || relativePath.startsWith("/") || relativePath.startsWith("\\")
    || relativePath.includes("\\") || relativePath.includes("?") || relativePath.includes("#")) {
    throw new Error(`Scope asset paths must be relative: ${relativePath}`);
  }

  const pathForValidation = relativePath.startsWith("./") ? relativePath.slice(2) : relativePath;
  const rawPath = pathForValidation;
  if (rawPath.length === 0 && relativePath !== "./") {
    throw new Error(`Scope asset path contains unsafe segments: ${relativePath}`);
  }
  for (const segment of rawPath.length === 0 ? [] : rawPath.split("/")) {
    let decoded;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new Error(`Scope asset path contains invalid encoding: ${relativePath}`);
    }
    if (segment.length === 0 || decoded === "." || decoded === ".."
      || decoded.includes("/") || decoded.includes("\\")) {
      throw new Error(`Scope asset path contains unsafe segments: ${relativePath}`);
    }
  }

  const resolved = new URL(relativePath, base);
  if (resolved.origin !== scopeRoot.origin || !resolved.pathname.startsWith(scopeRoot.pathname)) {
    throw new Error(`Scope asset path escapes the registration scope: ${relativePath}`);
  }
  return resolved;
}

function isWithinScope(url) {
  return url.origin === scopeRoot.origin && url.pathname.startsWith(scopeRoot.pathname);
}

async function cacheBuiltShell(cache) {
  await cache.addAll(CORE_ASSETS.map((relative) => resolveScopeAsset(relative)));
  const manifestUrl = resolveScopeAsset("asset-manifest.json");
  const manifestResponse = await fetch(manifestUrl, { cache: "no-store" });
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
    const url = resolveScopeAsset(relative);
    const asset = await fetch(url, { cache: "no-store" });
    if (!asset.ok) throw new Error(`Unable to load Web build asset ${relative} (${asset.status})`);
    await cache.put(url, asset);
  }));
}

async function cachePrivateModule(cache) {
  const manifestUrl = resolveScopeAsset("private/game.json");
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Unable to load the private game manifest (${response.status})`);
  await cache.put(manifestUrl, response.clone());
  const manifest = await response.json();
  for (const relative of [
    manifest.rom,
    manifest.source,
    manifest.validationReplay,
    manifest.semanticVectors,
  ]) {
    if (typeof relative !== "string") continue;
    const url = resolveScopeAsset(relative, manifestUrl);
    const asset = await fetch(url, { cache: "no-store" });
    if (!asset.ok) throw new Error(`Unable to load private module asset ${relative} (${asset.status})`);
    await cache.put(url, asset);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cacheBuiltShell(cache);
    await cachePrivateModule(cache);
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
  if (!isWithinScope(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const relativePath = url.pathname.slice(scopeRoot.pathname.length);
    const kernelPath = url.pathname.includes("/kernel/") && relativePath.startsWith("kernel/");
    const mutablePath = event.request.mode === "navigate"
      || relativePath === "asset-manifest.json"
      || relativePath === "target-profile.json"
      || kernelPath
      || relativePath.startsWith("private/")
      || relativePath.startsWith("fonts/");
    if (mutablePath) {
      try {
        const response = await fetch(event.request, { cache: "no-store" });
        if (response.ok) await cache.put(event.request, response.clone());
        return response;
      } catch (error) {
        const fallback = await cache.match(event.request)
          ?? (event.request.mode === "navigate" ? await cache.match(scopeRoot) : undefined);
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
        const fallback = await cache.match(scopeRoot);
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
});
