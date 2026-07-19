#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { assertGameModule, gameModuleSaveNamespace, type GameModuleV1 } from "../packages/contracts/src/game-module.ts";
import { validateHdReviewDecision } from "../packages/contracts/src/hd-review-decision.ts";
import { assertHdIdentityMap } from "../packages/contracts/src/hd-identity-map.ts";
import { verifyStandaloneWebPackage } from "./lib/standalone-web-package.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
  args.set(key.slice(2), value);
}
const required = (name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
};
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const workspace = path.resolve(required("workspace"));
const packageRoot = path.resolve(required("standalone-package"));
const presentationPath = required("presentation-module");
const outputPath = path.resolve(args.get("out") ?? path.join(workspace, "module/game-module.json"));
const workspacePath = (relative: string): string => {
  const resolved = path.resolve(workspace, relative);
  assert.ok(resolved.startsWith(`${workspace}${path.sep}`), `${relative}: path escapes private workspace`);
  return resolved;
};
const readJson = async (file: string): Promise<any> => JSON.parse(await fs.readFile(file, "utf8"));
const reference = async (relative: string) => ({ path: relative, sha256: sha256(await fs.readFile(workspacePath(relative))) });

const standalone = await verifyStandaloneWebPackage(packageRoot);
const releaseManifest = await readJson(path.join(packageRoot, "release-manifest.json"));
const replayPath = "validation/canonical-replay-v1.json";
const identityMapPath = "validation/hd-identity-map.json";
const decisionPath = "evidence/identity-review-decision.json";
const replay = await readJson(workspacePath(replayPath));
const identityMap = await readJson(workspacePath(identityMapPath));
const decision = await readJson(workspacePath(decisionPath));
assertHdIdentityMap(identityMap);
assert.equal(identityMap.status, "accepted", "HD identity map must be accepted");
assert.equal(replay.result?.completed, true, "canonical replay must complete the game");
assert.equal(identityMap.gameId, replay.gameId, "identity map and replay game IDs differ");
assert.equal(decision.gameId, replay.gameId, "review decision and replay game IDs differ");
const reviewedPacketPath = workspacePath(decision.reviewedPacket.path);
const reviewedPacketBytes = await fs.readFile(reviewedPacketPath);
assert.equal(sha256(reviewedPacketBytes), decision.reviewedPacket.sha256, "review packet archive hash");
const decisionValidation = validateHdReviewDecision(decision, JSON.parse(reviewedPacketBytes.toString("utf8")));
assert.equal(decisionValidation.valid, true, decisionValidation.errors.join("\n"));
assert.equal(releaseManifest.identities.visual_runtime_sha256, decision.reviewedPacket.visualRuntimeSha256,
  "standalone package visual runtime was not human reviewed");
assert.equal(releaseManifest.identities.validation_replay_semantics_sha256, decision.reviewedPacket.replaySemanticsSha256,
  "standalone package canonical replay was not human reviewed");
assert.equal(standalone.game.title, required("title"));
assert.equal(standalone.game.author, required("author"));
assert.equal(standalone.rights.profile, required("rights-profile"));

const preflightPath = path.join(workspace, "evidence/standalone-module-preflight.json");
try {
  const preflight = await readJson(preflightPath);
  assert.equal(preflight.status, "validated-candidate", "latest standalone preflight is not validated");
  assert.equal(preflight.webPwa.treeSha256, standalone.treeSha256, "preflight package tree differs");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const moduleDirectory = path.dirname(outputPath);
assert.ok(moduleDirectory.startsWith(`${workspace}${path.sep}`), "module output must stay inside private workspace");
await fs.mkdir(moduleDirectory, { recursive: true });
const relativeModuleDirectory = path.relative(workspace, moduleDirectory).split(path.sep).join("/");
const generated = async (name: string, value: unknown): Promise<string> => {
  const relative = `${relativeModuleDirectory}/${name}`;
  await fs.writeFile(workspacePath(relative), `${JSON.stringify(value, null, 2)}\n`);
  return relative;
};
const artifacts = releaseManifest.artifacts as Array<{ path: string; sha256: string; bytes: number }>;
const assetPackPath = await generated("asset-pack.json", {
  schemaVersion: "aico8.private-module-asset-pack.v1",
  presentation: releaseManifest.presentation,
  visualRuntimeSha256: releaseManifest.identities.visual_runtime_sha256,
  artifacts: artifacts.filter(({ path: file }) => file.startsWith("assets/") || file.startsWith("icons/")),
});
const typographyPath = await generated("typography-manifest.json", {
  schemaVersion: "aico8.private-module-typography.v1",
  policy: "bundled-deterministic-fonts-and-source-relative-vector-lettering",
  artifacts: artifacts.filter(({ path: file }) => file.startsWith("fonts/")),
});
const audioPath = await generated("audio-manifest.json", {
  schemaVersion: "aico8.private-module-audio.v1",
  profile: releaseManifest.audio,
  policy: "source-compatible-kernel-audio-with-no-hd-remix",
});
const noticePath = `${relativeModuleDirectory}/NOTICE.txt`;
await fs.writeFile(workspacePath(noticePath), [
  `${standalone.game.title} — private research and testing only`,
  `Original author: ${standalone.game.author}`,
  `Source license: ${standalone.rights.sourceLicense}`,
  `Source URL: ${standalone.rights.sourceUrl}`,
  "This module record does not authorize formal distribution.",
  "",
].join("\n"));
let workspaceManifestPath = "manifest.json";
try {
  await fs.access(workspacePath(workspaceManifestPath));
} catch {
  workspaceManifestPath = await generated("workspace-provenance.json", {
    schemaVersion: "aico8.private-workspace-provenance.v1",
    gameId: replay.gameId,
    sourceRomSha256: sha256(await fs.readFile(workspacePath("source.rom"))),
    sourceCodeSha256: sha256(await fs.readFile(workspacePath("code.p8.lua"))),
  });
}

const kernelArtifact = artifacts.find(({ path: file }) => file === "kernel/aico8-kernel.wasm");
assert.ok(kernelArtifact, "standalone package is missing the Wasm kernel");
const manifest: GameModuleV1 = {
  schemaVersion: "aico8.game-module.v1",
  moduleId: standalone.game.id,
  status: "validated",
  metadata: { title: standalone.game.title, author: standalone.game.author },
  payload: {
    rom: await reference("source.rom"),
    sourceCode: await reference("code.p8.lua"),
    presentationModule: await reference(presentationPath),
  },
  mappings: {
    hdIdentityMap: await reference(identityMapPath),
    assetPack: await reference(assetPackPath),
    typographyManifest: await reference(typographyPath),
    audioManifest: await reference(audioPath),
  },
  save: { namespace: gameModuleSaveNamespace(standalone.game.id), persistentBytes: 256, resetCompatibilityStateOnActivate: true },
  provenance: {
    sourceCartSha256: replay.cartSha256,
    workspaceManifestSha256: sha256(await fs.readFile(workspacePath(workspaceManifestPath))),
    rightsProfile: standalone.rights.profile,
  },
  runtime: {
    dependencies: [
      { id: "aico8-web-runtime", version: "1.0.0", manifestSha256: standalone.releaseManifestSha256 },
      { id: "aico8-wasm-kernel", version: "1.0.0", manifestSha256: kernelArtifact.sha256 },
    ],
    targetBindings: [{ target: "web-pwa", targetProfileId: standalone.targetProfile.id, targetProfileSha256: standalone.targetProfile.sha256 }],
  },
  validation: {
    status: "passed",
    evidence: [
      { kind: "canonical-replay", ...(await reference(replayPath)) },
      { kind: "hd-review-decision", ...(await reference(decisionPath)) },
    ],
  },
};
assertGameModule(manifest);
await fs.writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Validated game module ${manifest.moduleId}: ${outputPath}; package tree ${standalone.treeSha256}\n`);
