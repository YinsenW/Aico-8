import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? "");
assert.ok(process.argv[2], "Usage: node scripts/verify-web-package.mjs <package-directory>");
assert.ok(fs.statSync(output, { throwIfNoEntry: false })?.isDirectory(), `Missing package: ${output}`);

function readJson(relative) {
  return JSON.parse(fs.readFileSync(path.join(output, relative), "utf8"));
}
function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      assert.equal(entry.isSymbolicLink(), false, `Package contains symlink: ${relative}`);
      return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relative) : [relative];
    });
}
function pngDimensions(relative) {
  const bytes = fs.readFileSync(path.join(output, relative));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${relative} PNG signature`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const requiredFiles = [
  "index.html", "asset-manifest.json", "manifest.webmanifest", "service-worker.js", "icon-192.png", "icon-512.png",
  "kernel/aico8-kernel.js", "kernel/aico8-kernel.wasm",
  "fonts/AtkinsonHyperlegible-Regular.woff2", "fonts/AtkinsonHyperlegible-Bold.woff2",
  "fonts/OFL-Atkinson-Hyperlegible.txt", "private/game.json", "PRIVATE-RESEARCH-ONLY.txt",
  "release-manifest.json",
];
for (const relative of requiredFiles) {
  assert.ok(fs.statSync(path.join(output, relative), { throwIfNoEntry: false })?.isFile(), `Missing ${relative}`);
}

const pwa = readJson("manifest.webmanifest");
assert.equal(pwa.display, "standalone");
assert.equal(pwa.start_url, "./");
assert.equal(pwa.scope, "./");
assert.deepEqual(pngDimensions("icon-192.png"), [192, 192]);
assert.deepEqual(pngDimensions("icon-512.png"), [512, 512]);
const assetManifest = readJson("asset-manifest.json");
const builtAssets = new Set(Object.values(assetManifest).flatMap((entry) => [
  entry.file,
  ...(entry.css ?? []),
  ...(entry.assets ?? []),
]).filter(Boolean));
for (const relative of builtAssets) {
  assert.ok(fs.statSync(path.join(output, relative), { throwIfNoEntry: false })?.isFile(),
    `Build asset manifest points to missing ${relative}`);
}

const game = readJson("private/game.json");
assert.equal(game.formatVersion, 1);
assert.equal(game.researchOnly, true);
assert.match(game.id, /^[a-z0-9][a-z0-9-]*$/);
assert.match(game.presentation, /^[a-z0-9][a-z0-9-]*$/);
assert.ok(game.sourceLicense && game.sourceUrl, "Private package needs source attribution and license");

const privateEntries = fs.readdirSync(path.join(output, "private"), { withFileTypes: true });
const moduleDirectories = privateEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.deepEqual(moduleDirectories, [game.id], "Package must contain exactly its selected private game module");
for (const relative of [game.rom, game.source]) {
  assert.ok(fs.statSync(path.join(output, "private", relative), { throwIfNoEntry: false })?.isFile(), `Missing game input ${relative}`);
}

const release = readJson("release-manifest.json");
assert.equal(release.schema_version, 1);
assert.equal(release.target, "web-pwa");
assert.equal(release.game.id, game.id);
assert.equal(release.presentation, game.presentation);
assert.equal(release.rights.sourceLicense, game.sourceLicense);
assert.equal(release.rights.sourceUrl, game.sourceUrl);

const actualFiles = listFiles(output)
  .filter((relative) => relative !== "release-manifest.json")
  .map((relative) => relative.split(path.sep).join("/"));
const declaredFiles = release.artifacts.map((artifact) => artifact.path).sort();
assert.deepEqual(declaredFiles, [...actualFiles].sort(), "Release manifest must enumerate every artifact exactly once");
for (const artifact of release.artifacts) {
  assert.ok(!artifact.path.startsWith("/") && !artifact.path.includes(".."), `Unsafe artifact path: ${artifact.path}`);
  const file = path.join(output, artifact.path);
  assert.equal(fs.statSync(file).size, artifact.bytes, `${artifact.path} byte count`);
  assert.equal(sha256(file), artifact.sha256, `${artifact.path} sha256`);
}

const bundledInputs = [
  path.join(output, "private", game.rom),
  path.join(output, "private", game.source),
];
for (let index = 0; index < release.inputs.length; index += 1) {
  assert.equal(fs.statSync(bundledInputs[index]).size, release.inputs[index].bytes, `${release.inputs[index].path} input bytes`);
  assert.equal(sha256(bundledInputs[index]), release.inputs[index].sha256, `${release.inputs[index].path} input sha256`);
}

const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(output, "service-worker.js"), "utf8");
const warning = fs.readFileSync(path.join(output, "PRIVATE-RESEARCH-ONLY.txt"), "utf8");
assert.match(html, /manifest\.webmanifest/);
assert.match(html, /id="app"/);
assert.match(serviceWorker, /private\/game\.json/);
assert.match(serviceWorker, /aico8-kernel\.wasm/);
assert.match(serviceWorker, /asset-manifest\.json/);
assert.ok(warning.includes(game.author) && warning.includes(game.sourceLicense) && warning.includes(game.sourceUrl));

for (const relative of actualFiles.filter((file) => /\.(?:html|js|css|json|txt|webmanifest)$/.test(file))) {
  const text = fs.readFileSync(path.join(output, relative), "utf8");
  assert.doesNotMatch(text, /\/(?:Users|home)\/|[A-Za-z]:\\Users\\|\/private\/tmp\//,
    `${relative} exposes a local absolute path`);
}

process.stdout.write(`Web/PWA package verified: ${release.game.title} (${actualFiles.length} artifacts, ${game.presentation})\n`);
