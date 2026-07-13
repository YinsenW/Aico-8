import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  validationReplaySemanticsSha256,
  visualRuntimeSha256,
} from "./lib/release-identities.mjs";

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
  "target-profile.json", "release-manifest.json",
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
assert.match(game.cartSha256, /^[a-f0-9]{64}$/);
assert.ok(game.sourceLicense && game.sourceUrl, "Private package needs source attribution and license");

const privateEntries = fs.readdirSync(path.join(output, "private"), { withFileTypes: true });
const moduleDirectories = privateEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
assert.deepEqual(moduleDirectories, [game.id], "Package must contain exactly its selected private game module");
for (const relative of [game.rom, game.source, game.validationReplay].filter(Boolean)) {
  assert.ok(fs.statSync(path.join(output, "private", relative), { throwIfNoEntry: false })?.isFile(), `Missing game input ${relative}`);
}

const targetProfile = readJson("target-profile.json");
assert.equal(targetProfile.schemaVersion, "aico8.target-profile.v1");
assert.equal(targetProfile.target, "web-pwa");
assert.equal(targetProfile.outputProfile, "hd-1024-square");
assert.equal(targetProfile.measurementEnvironment.class, "local-http-active-browser");
assert.ok(targetProfile.measurementEnvironment.warmupFrames >= 0);
assert.ok(targetProfile.measurementEnvironment.sampleFrames >= 120);
assert.ok(targetProfile.measurementEnvironment.droppedFrameThresholdMilliseconds > 0);

const release = readJson("release-manifest.json");
assert.equal(release.schema_version, 1);
assert.equal(release.target, "web-pwa");
assert.equal(release.game.id, game.id);
assert.equal(release.presentation, game.presentation);
assert.equal(release.rights.sourceLicense, game.sourceLicense);
assert.equal(release.rights.sourceUrl, game.sourceUrl);
assert.equal(release.target_profile.id, targetProfile.id);
assert.equal(release.target_profile.sha256, sha256(path.join(output, "target-profile.json")));

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
const releaseManifestBytes = fs.statSync(path.join(output, "release-manifest.json")).size;
const unpackedBytes = release.artifacts.reduce((sum, artifact) => sum + artifact.bytes, releaseManifestBytes);
const largestArtifactBytes = Math.max(releaseManifestBytes, ...release.artifacts.map(({ bytes }) => bytes));
assert.equal(release.measurements.artifact_count, release.artifacts.length + 1);
assert.equal(release.measurements.release_manifest_bytes, releaseManifestBytes);
assert.equal(release.measurements.unpacked_bytes, unpackedBytes);
assert.equal(release.measurements.largest_artifact_bytes, largestArtifactBytes);
assert.ok(release.measurements.artifact_count <= targetProfile.budgets.artifactCountMax,
  "Release artifact count exceeds target budget");
assert.ok(release.measurements.unpacked_bytes <= targetProfile.budgets.unpackedBytesMax,
  "Release unpacked bytes exceed target budget");
assert.ok(release.measurements.largest_artifact_bytes <= targetProfile.budgets.largestArtifactBytesMax,
  "Release largest artifact exceeds target budget");
const validationReplayArtifactPath = game.validationReplay ? `private/${game.validationReplay}` : undefined;
assert.equal(release.identities.visual_runtime_schema, "aico8.visual-runtime-identity.v1");
assert.equal(
  release.identities.visual_runtime_sha256,
  visualRuntimeSha256(release.artifacts, validationReplayArtifactPath),
  "Visual runtime identity must bind every packaged artifact except validation replay provenance",
);

const bundledInputs = [
  ["source.rom", path.join(output, "private", game.rom)],
  ["code.p8.lua", path.join(output, "private", game.source)],
  ...(game.validationReplay ? [["validation-replay.json", path.join(output, "private", game.validationReplay)]] : []),
];
const bundledInputsByName = new Map(bundledInputs);
assert.deepEqual(release.inputs.map(({ path: inputPath }) => inputPath).sort(), [...bundledInputsByName.keys()].sort(),
  "Release inputs must enumerate every packaged build input");
for (const input of release.inputs) {
  const bundledInput = bundledInputsByName.get(input.path);
  assert.ok(bundledInput, `Unknown release input ${input.path}`);
  assert.equal(fs.statSync(bundledInput).size, input.bytes, `${input.path} input bytes`);
  assert.equal(sha256(bundledInput), input.sha256, `${input.path} input sha256`);
}

if (game.validationReplay) {
  const replay = readJson(path.join("private", game.validationReplay));
  assert.equal(replay.schemaVersion, "aico8.replay.v1");
  assert.equal(replay.cartSha256, game.cartSha256, "Validation replay must bind the packaged cart");
  assert.equal(replay.canonicality?.testHooks, false);
  assert.equal(replay.canonicality?.compatibilityStateMutation, "none");
  assert.equal(replay.canonicality?.logicalUpdatePolicy, "execute-all");
  assert.equal(release.identities.validation_replay_sha256, sha256(path.join(output, "private", game.validationReplay)));
  assert.equal(release.identities.validation_replay_semantics_schema, "aico8.validation-replay-semantics.v1");
  assert.equal(
    release.identities.validation_replay_semantics_sha256,
    validationReplaySemanticsSha256(replay),
    "Replay semantic identity must bind cart, input, milestones, checkpoints, and result",
  );
} else {
  assert.equal("validation_replay_sha256" in release.identities, false);
  assert.equal("validation_replay_semantics_sha256" in release.identities, false);
}

const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
const serviceWorker = fs.readFileSync(path.join(output, "service-worker.js"), "utf8");
const warning = fs.readFileSync(path.join(output, "PRIVATE-RESEARCH-ONLY.txt"), "utf8");
assert.match(html, /manifest\.webmanifest/);
assert.match(html, /id="app"/);
assert.match(serviceWorker, /private\/game\.json/);
assert.match(serviceWorker, /aico8-kernel\.wasm/);
assert.match(serviceWorker, /asset-manifest\.json/);
assert.match(serviceWorker, /target-profile\.json/,
  "PWA must retain the release target profile for offline validation");
assert.match(serviceWorker, /event\.request\.mode === "navigate"/,
  "PWA navigation must refresh mutable builds before falling back offline");
assert.match(serviceWorker, /url\.pathname\.includes\("\/kernel\/"\)/,
  "Unhashed kernel artifacts must refresh before using their offline fallback");
assert.ok(warning.includes(game.author) && warning.includes(game.sourceLicense) && warning.includes(game.sourceUrl));

for (const relative of actualFiles.filter((file) => /\.(?:html|js|css|json|txt|webmanifest)$/.test(file))) {
  const text = fs.readFileSync(path.join(output, relative), "utf8");
  assert.doesNotMatch(text, /\/(?:Users|home)\/|[A-Za-z]:\\Users\\|\/private\/tmp\//,
    `${relative} exposes a local absolute path`);
}

process.stdout.write(`Web/PWA package verified: ${release.game.title} (${release.measurements.artifact_count} package files, ${actualFiles.length} checksummed artifacts, ${game.presentation})\n`);
