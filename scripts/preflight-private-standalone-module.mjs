#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packageTreeSha256 } from "./lib/release-identities.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}

function required(argumentsMap, name) {
  const value = argumentsMap.get(name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed with status ${result.status}`);
}

function packageIdentity(directory) {
  const manifestBytes = fs.readFileSync(path.join(directory, "release-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  return {
    releaseManifestSha256: sha256(manifestBytes),
    treeSha256: packageTreeSha256(manifestBytes, manifest.artifacts),
    artifactCount: manifest.measurements.artifact_count,
    unpackedBytes: manifest.measurements.unpacked_bytes,
    visualRuntimeSha256: manifest.identities.visual_runtime_sha256,
    replaySemanticsSha256: manifest.identities.validation_replay_semantics_sha256,
    targetProfile: manifest.target_profile,
  };
}

const argumentsMap = parseArguments(process.argv.slice(2));
const workspace = path.resolve(required(argumentsMap, "workspace"));
const releaseOut = path.resolve(required(argumentsMap, "release-out"));
const id = required(argumentsMap, "id");
const reviewGameId = argumentsMap.get("review-game-id") ?? id;
const title = required(argumentsMap, "title");
const author = required(argumentsMap, "author");
const presentation = required(argumentsMap, "presentation");
const sourceLicense = required(argumentsMap, "source-license");
const sourceUrl = required(argumentsMap, "source-url");
const audio = required(argumentsMap, "audio");
const reportPath = path.resolve(argumentsMap.get("report") ?? path.join(workspace, "evidence/standalone-module-preflight.json"));

assert.ok(fs.statSync(workspace, { throwIfNoEntry: false })?.isDirectory(), "Private workspace is missing");
assert.equal(fs.existsSync(releaseOut), false, `Release output already exists: ${releaseOut}`);
assert.ok(reportPath.startsWith(`${workspace}${path.sep}`), "Report must stay inside the private workspace");

const packetPath = path.join(workspace, "evidence/identity-review-packet.json");
const identityMapPath = path.join(workspace, "validation/hd-identity-map.json");
const replayPath = path.join(workspace, "validation/canonical-replay-v1.json");
for (const input of [packetPath, identityMapPath, replayPath]) {
  assert.ok(fs.statSync(input, { throwIfNoEntry: false })?.isFile(), `Missing private evidence: ${input}`);
}

run("pnpm", ["exec", "tsx", "scripts/verify-private-hd-review-packet.ts", "--workspace", workspace]);
run("make", ["-C", "runtime/core", "wasm"]);
run(process.execPath, ["--experimental-strip-types", "scripts/validate-private-canonical-gameplay.ts"], {
  env: { ...process.env, AICO8_PRIVATE_WORKSPACE: workspace },
});

const buildArguments = [
  "scripts/build-private-web.mjs",
  "--workspace", workspace,
  "--id", id,
  "--title", title,
  "--author", author,
  "--presentation", presentation,
  "--source-license", sourceLicense,
  "--source-url", sourceUrl,
  "--audio", audio,
  "--validation-replay", "validation/canonical-replay-v1.json",
];
run(process.execPath, [...buildArguments, "--out", releaseOut]);
run(process.execPath, ["scripts/verify-web-package.mjs", releaseOut]);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-standalone-preflight-"));
const secondBuild = path.join(temporaryRoot, "package");
try {
  run(process.execPath, [...buildArguments, "--out", secondBuild]);
  run(process.execPath, ["scripts/verify-web-package.mjs", secondBuild]);
  const firstIdentity = packageIdentity(releaseOut);
  const secondIdentity = packageIdentity(secondBuild);
  assert.deepEqual(secondIdentity, firstIdentity, "Two clean builds produced different package identities");

  const packet = readJson(packetPath);
  const identityMap = readJson(identityMapPath);
  const replay = readJson(replayPath);
  assert.equal(packet.gameId, reviewGameId, "HD packet game id must equal the declared review game id");
  assert.equal(identityMap.gameId, reviewGameId, "HD identity-map game id must equal the declared review game id");
  assert.equal(replay.gameId, reviewGameId, "Canonical replay game id must equal the declared review game id");
  const reviewedRuntimeMatches = firstIdentity.visualRuntimeSha256 === packet.visualRuntimeSha256;
  const reviewedReplayMatches = firstIdentity.replaySemanticsSha256 === packet.replaySemanticsSha256;
  const humanAccepted = packet.status === "accepted" && identityMap.status === "accepted";
  const accepted = humanAccepted && reviewedRuntimeMatches && reviewedReplayMatches;
  const decisionPath = path.join(workspace, "evidence/identity-review-decision.json");
  assert.equal(fs.existsSync(decisionPath), humanAccepted,
    "An accepted standalone candidate must have exactly one immutable HD review decision");
  const report = {
    schemaVersion: "aico8.private-standalone-module-preflight.v1",
    packageId: id,
    reviewGameId,
    status: accepted ? "validated-candidate"
      : reviewedRuntimeMatches && reviewedReplayMatches
        ? "pending-human-hd-review" : "pending-reviewed-runtime-recapture",
    rightsScope: "Private research and testing only; this record does not authorize formal release.",
    canonicalGameplay: {
      replayId: replay.replayId,
      replaySha256: sha256(fs.readFileSync(replayPath)),
      replaySemanticsSha256: firstIdentity.replaySemanticsSha256,
      completed: replay.result.completed,
    },
    hdReview: {
      packetSha256: sha256(fs.readFileSync(packetPath)),
      documentSha256: packet.document.sha256,
      visualRuntimeSha256: packet.visualRuntimeSha256,
      acceptanceStatement: packet.acceptanceStatement,
      decisionSha256: humanAccepted ? sha256(fs.readFileSync(decisionPath)) : null,
      reviewedRuntimeMatches,
      reviewedReplayMatches,
    },
    webPwa: {
      ...firstIdentity,
      cleanBuildsCompared: 2,
      byteStable: true,
    },
    remainingGates: accepted ? [] : [
      ...(!reviewedRuntimeMatches || !reviewedReplayMatches
        ? ["recapture-hd-review-packet-for-current-package-and-replay"] : []),
      ...(!humanAccepted ? ["exact-human-hd-review-acceptance"] : []),
    ],
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `Standalone module preflight: ${id} ${report.status}; package tree ${firstIdentity.treeSha256}\n`,
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
