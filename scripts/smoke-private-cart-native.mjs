import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  expandCleanSinglePlayerReplay,
  parseButtonUpdates,
} from "./lib/replay-button-stream.mjs";

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const arguments_ = argumentsMap(process.argv.slice(2));
const workspace = path.resolve(arguments_.get("workspace") ?? "");
const output = arguments_.get("out") ? path.resolve(arguments_.get("out")) : undefined;
const replayPath = arguments_.get("replay") ? path.resolve(arguments_.get("replay")) : undefined;
const observedNumberNames = (arguments_.get("observe-numbers") ?? "")
  .split(",")
  .filter(Boolean);
assert.ok(arguments_.get("workspace"), "--workspace is required");
assert.ok(replayPath || arguments_.get("button-updates"),
  "--replay or --button-updates is required");
assert.ok(observedNumberNames.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),
  "--observe-numbers must contain comma-separated Lua global names");

const rom = fs.readFileSync(path.join(workspace, "source.rom"));
const source = fs.readFileSync(path.join(workspace, "code.p8.lua"));
assert.equal(rom.length, 0x8000, "source.rom must be exactly 32 KiB");
assert.ok(source.length > 0, "code.p8.lua must not be empty");
const replay = replayPath ? JSON.parse(fs.readFileSync(replayPath, "utf8")) : undefined;
const buttons = replay
  ? expandCleanSinglePlayerReplay(replay)
  : Uint8Array.from(parseButtonUpdates(arguments_.get("button-updates")));
assert.ok(buttons.length > 0, "native smoke requires at least one logical update");

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binary = path.join(repository, "runtime/core/build/native_cart_smoke");
assert.ok(fs.statSync(binary, { throwIfNoEntry: false })?.isFile(),
  "Build the native cart smoke runner before executing private evidence");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-native-cart-smoke-"));
const buttonPath = path.join(temporary, "buttons.bin");
const nativeOutput = path.join(temporary, "native");
fs.writeFileSync(buttonPath, buttons);

const native = spawnSync(binary, [
  "--rom", path.join(workspace, "source.rom"),
  "--source", path.join(workspace, "code.p8.lua"),
  "--buttons", buttonPath,
  "--target-updates", String(buttons.length),
  "--out-directory", nativeOutput,
  "--observe-numbers", observedNumberNames.join(","),
], { cwd: repository, encoding: "utf8" });
const metadataPath = path.join(nativeOutput, "metadata.json");
const metadata = fs.statSync(metadataPath, { throwIfNoEntry: false })?.isFile()
  ? JSON.parse(fs.readFileSync(metadataPath, "utf8"))
  : {
      schemaVersion: "aico8.native-cart-smoke-metadata.v1",
      status: "failed",
      failure: native.stderr || `native runner exited ${native.status}`,
    };
const cartIdentity = {
  romSha256: sha256(rom),
  sourceSha256: sha256(source),
  combinedSha256: createHash("sha256").update(rom).update(source).digest("hex"),
};
const artifactHash = (name) => {
  const artifact = path.join(nativeOutput, name);
  return fs.statSync(artifact, { throwIfNoEntry: false })?.isFile()
    ? sha256(fs.readFileSync(artifact))
    : undefined;
};
const report = {
  schemaVersion: "aico8.private-cart-native-smoke.v1",
  backend: "native-cpp",
  cart: cartIdentity,
  input: {
    replayId: replay?.replayId,
    logicalUpdateMaskCount: buttons.length,
    sha256: sha256(buttons),
    cleanInitialState: replay ? replay.trace.initialState : { kind: "clean" },
  },
  observedNumberRaw16_16: metadata.observedNumberRaw16_16 ?? {},
  execution: {
    hostTickRate: 60,
    hostTicks: metadata.hostTicks ?? 0,
    initializationTicks: metadata.initializationTicks ?? 0,
    initializationCompleted: metadata.status === "passed",
    logicalUpdates: metadata.logicalUpdates ?? 0,
    maximumDrawCommandCount: metadata.maximumDrawCommandCount ?? 0,
    audioSampleCount: metadata.audioSampleCount ?? 0,
    audioPeakAbsolute: metadata.audioPeakAbsolute ?? 0,
    audioPcmSha256: artifactHash("audio.pcm16le"),
    framebufferSha256: artifactHash("framebuffer.bin"),
    persistenceSha256: artifactHash("persistence.bin"),
  },
  authority: "native-execution-evidence-not-official-conformance",
  status: metadata.status,
  ...(metadata.failure ? { failure: metadata.failure } : {}),
};
if (output) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
}
fs.rmSync(temporary, { recursive: true, force: true });
if (metadata.status !== "passed" || native.status !== 0) {
  throw new Error(report.failure ?? native.stderr ?? "native cart smoke failed");
}
process.stdout.write(`Native private cart smoke: PASS (${report.execution.logicalUpdates} logical updates, `
  + `${report.execution.maximumDrawCommandCount} max draw commands)\n`);
