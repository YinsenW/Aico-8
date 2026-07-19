import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = fs.readFileSync(
  new URL("./public/service-worker.js", import.meta.url),
  "utf8",
);

function requestUrl(input) {
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return input;
  return input.url;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function defaultFetch(scope) {
  return async (input) => {
    const url = requestUrl(input);
    if (url === `${scope}asset-manifest.json`) {
      return jsonResponse({
        app: {
          file: "assets/app.js",
          css: ["assets/app.css"],
          assets: ["assets/logo.png"],
        },
      });
    }
    if (url === `${scope}private/game.json`) return new Response(null, { status: 404 });
    if (url === `${scope}collection-runtime.json`) return new Response(null, { status: 404 });
    return new Response(url === scope ? "cached shell" : `asset:${url}`, { status: 200 });
  };
}

function createHarness({
  scope = "https://example.test/catalog/games/orbit/",
  fetchImpl = defaultFetch(scope),
} = {}) {
  const listeners = new Map();
  const cacheStores = new Map();
  const deletedCaches = [];
  const fetchedUrls = [];
  let currentFetch = fetchImpl;
  let skippedWaiting = false;
  let claimedClients = false;

  const runFetch = async (input, init) => {
    fetchedUrls.push(requestUrl(input));
    return currentFetch(input, init);
  };

  class MockCache {
    constructor() {
      this.responses = new Map();
    }

    async addAll(urls) {
      for (const url of urls) {
        const response = await runFetch(url);
        if (!response.ok) throw new Error(`addAll failed for ${requestUrl(url)}`);
        await this.put(url, response);
      }
    }

    async put(input, response) {
      this.responses.set(requestUrl(input), response.clone());
    }

    async match(input) {
      return this.responses.get(requestUrl(input))?.clone();
    }
  }

  const caches = {
    async open(name) {
      if (!cacheStores.has(name)) cacheStores.set(name, new MockCache());
      return cacheStores.get(name);
    },
    async keys() {
      return [...cacheStores.keys()];
    },
    async delete(name) {
      deletedCaches.push(name);
      return cacheStores.delete(name);
    },
  };

  const self = {
    registration: { scope },
    location: new URL(scope),
    clients: {
      async claim() {
        claimedClients = true;
      },
    },
    async skipWaiting() {
      skippedWaiting = true;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };

  vm.runInNewContext(serviceWorkerSource, {
    URL,
    Response,
    caches,
    console,
    decodeURIComponent,
    encodeURIComponent,
    fetch: runFetch,
    self,
  }, { filename: "service-worker.js" });

  async function dispatchLifetime(type) {
    let completion;
    listeners.get(type)({
      waitUntil(promise) {
        completion = promise;
      },
    });
    assert.ok(completion, `${type} must call waitUntil`);
    await completion;
  }

  async function dispatchFetch(request) {
    let response;
    listeners.get("fetch")({
      request,
      respondWith(promise) {
        response = promise;
      },
    });
    assert.ok(response, "in-scope GET must call respondWith");
    return response;
  }

  return {
    caches,
    cacheStores,
    deletedCaches,
    fetchedUrls,
    get claimedClients() { return claimedClients; },
    get skippedWaiting() { return skippedWaiting; },
    install: () => dispatchLifetime("install"),
    activate: () => dispatchLifetime("activate"),
    dispatchFetch,
    setFetch(nextFetch) {
      currentFetch = nextFetch;
    },
  };
}

test("installs every shell and manifest resource inside a nested registration scope", async () => {
  const scope = "https://example.test/catalog/games/orbit/";
  const harness = createHarness({ scope });

  await harness.install();

  assert.equal(harness.skippedWaiting, true);
  assert.ok(harness.fetchedUrls.length > 0);
  assert.ok(harness.fetchedUrls.every((url) => url.startsWith(scope)));
  for (const cache of harness.cacheStores.values()) {
    assert.ok([...cache.responses.keys()].every((url) => url.startsWith(scope)));
  }
});

test("uses the scope shell as the offline fallback for nested navigation", async () => {
  const scope = "https://example.test/catalog/games/orbit/";
  const harness = createHarness({ scope });
  await harness.install();
  harness.setFetch(async () => {
    throw new Error("offline");
  });

  const response = await harness.dispatchFetch({
    method: "GET",
    mode: "navigate",
    url: `${scope}levels/one`,
  });

  assert.equal(await response.text(), "cached shell");
});

test("activate removes only obsolete caches belonging to its exact scope", async () => {
  const scope = "https://example.test/catalog/games/orbit/";
  const harness = createHarness({ scope });
  await harness.install();
  const ownPrefix = `aico8-web-${encodeURIComponent("/catalog/games/orbit/")}-`;
  const siblingPrefix = `aico8-web-${encodeURIComponent("/catalog/games/sibling/")}-`;
  const obsoleteOwnCache = `${ownPrefix}v2`;
  const siblingCache = `${siblingPrefix}v2`;
  await harness.caches.open(obsoleteOwnCache);
  await harness.caches.open(siblingCache);

  await harness.activate();

  assert.equal(harness.claimedClients, true);
  assert.ok(harness.deletedCaches.includes(obsoleteOwnCache));
  assert.ok(!harness.deletedCaches.includes(siblingCache));
  assert.ok((await harness.caches.keys()).includes(siblingCache));
});

test("allows only an explicit private manifest 404 to omit the private module", async (t) => {
  await t.test("explicit 404 succeeds", async () => {
    await createHarness().install();
  });

  await t.test("private manifest parse failure rejects install", async () => {
    const scope = "https://example.test/catalog/games/orbit/";
    const fallback = defaultFetch(scope);
    const harness = createHarness({
      scope,
      fetchImpl: async (input, init) => requestUrl(input) === `${scope}private/game.json`
        ? new Response("{", { status: 200, headers: { "content-type": "application/json" } })
        : fallback(input, init),
    });
    await assert.rejects(harness.install(), SyntaxError);
  });

  await t.test("private manifest network failure rejects install", async () => {
    const scope = "https://example.test/catalog/games/orbit/";
    const fallback = defaultFetch(scope);
    const harness = createHarness({
      scope,
      fetchImpl: async (input, init) => {
        if (requestUrl(input) === `${scope}private/game.json`) throw new Error("private network failed");
        return fallback(input, init);
      },
    });
    await assert.rejects(harness.install(), /private network failed/);
  });

  await t.test("private dependency failure rejects install", async () => {
    const scope = "https://example.test/catalog/games/orbit/";
    const fallback = defaultFetch(scope);
    const harness = createHarness({
      scope,
      fetchImpl: async (input, init) => {
        const url = requestUrl(input);
        if (url === `${scope}private/game.json`) return jsonResponse({ rom: "orbit/game.rom" });
        if (url === `${scope}private/orbit/game.rom`) return new Response(null, { status: 503 });
        return fallback(input, init);
      },
    });
    await assert.rejects(harness.install(), /private module asset orbit\/game\.rom \(503\)/);
  });
});

test("installs every declared fixed-collection game package", async () => {
  const scope = "https://example.test/catalog/collection/";
  const fallback = defaultFetch(scope);
  const harness = createHarness({
    scope,
    fetchImpl: async (input, init) => {
      const url = requestUrl(input);
      if (url === `${scope}collection-runtime.json`) return jsonResponse({
        modules: [{ launchPath: "games/orbit/" }, { launchPath: "games/steps/" }],
      });
      for (const moduleId of ["orbit", "steps"]) {
        if (url === `${scope}games/${moduleId}/release-manifest.json`) {
          return jsonResponse({ artifacts: [{ path: "assets/game.js" }, { path: "private/game.json" }] });
        }
      }
      return fallback(input, init);
    },
  });
  await harness.install();
  for (const moduleId of ["orbit", "steps"]) {
    assert.ok(harness.fetchedUrls.includes(`${scope}games/${moduleId}/index.html`));
    assert.ok(harness.fetchedUrls.includes(`${scope}games/${moduleId}/assets/game.js`));
    assert.ok(harness.fetchedUrls.includes(`${scope}games/${moduleId}/private/game.json`));
  }
});

test("rejects traversal and absolute asset-manifest paths", async (t) => {
  for (const unsafePath of [
    "../escape.js", "/absolute.js", "https://cdn.invalid/app.js", "assets/%2e%2e/escape.js",
    "assets/app.js?version=1", "assets/app.js#fragment",
  ]) {
    await t.test(unsafePath, async () => {
      const scope = "https://example.test/catalog/games/orbit/";
      const fallback = defaultFetch(scope);
      const harness = createHarness({
        scope,
        fetchImpl: async (input, init) => requestUrl(input) === `${scope}asset-manifest.json`
          ? jsonResponse({ app: { file: unsafePath } })
          : fallback(input, init),
      });
      await assert.rejects(harness.install(), /Scope asset path/);
    });
  }
});
