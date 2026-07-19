#!/usr/bin/env -S pnpm exec tsx
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { pico8FramebufferColor } from "../apps/web/src/runtime/pico8-palette.ts";
import {
  isPrivateOfficialCapturePath,
  parseProbeEvents,
  validateOfficialProbeArtifactFiles,
} from "./lib/official-probe-capture.mjs";
import {
  buildImplementationProbeCapture,
  sha256Bytes,
  validateImplementationProbeCapture,
} from "./lib/official-probe-comparison.mjs";
import { expandButtonTraceHostMasks } from "./lib/button-trace.mjs";
import { extractP8ProbeCart } from "./lib/p8-probe-cart.mjs";
import { encodePngRgba } from "./lib/png-rgba.mjs";
import { encodeWavePcm16 } from "./lib/wav-pcm.mjs";

function argumentsMap(values: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = argumentsMap(process.argv.slice(2).filter((argument) => argument !== "--"));
const cartPath = path.resolve(arguments_.get("cart") ?? "");
const outputPath = path.resolve(arguments_.get("output") ?? "");
const persistenceInputPath = arguments_.get("persistence")
  ? path.resolve(arguments_.get("persistence")!) : undefined;
const persistenceOutputPath = arguments_.get("persistence-output")
  ? path.resolve(arguments_.get("persistence-output")!) : undefined;
const requestedHostTicks = Number(arguments_.get("host-ticks") ?? "0");
const buttonMask = Number(arguments_.get("button-mask") ?? "0");
const buttonTracePath = arguments_.get("button-trace")
  ? path.resolve(arguments_.get("button-trace")!) : undefined;
const framebufferArtifact = arguments_.get("framebuffer-artifact");
const audioArtifact = arguments_.get("audio-artifact");
assert.ok(arguments_.get("cart"), "--cart is required");
assert.ok(arguments_.get("output"), "--output is required");
assert.ok(Number.isSafeInteger(requestedHostTicks) && requestedHostTicks >= 0 && requestedHostTicks <= 1_000_000,
  "--host-ticks must be an integer from 0 through 1000000");
assert.ok(Number.isSafeInteger(buttonMask) && buttonMask >= 0 && buttonMask <= 0x3f,
  "--button-mask must be an integer from 0 through 63");
if (framebufferArtifact) {
  assert.match(framebufferArtifact, /^[a-z0-9][a-z0-9_-]*\.png$/,
    "--framebuffer-artifact must be a safe lowercase PNG filename");
}
if (audioArtifact) {
  assert.match(audioArtifact, /^[a-z0-9][a-z0-9_-]*\.wav$/,
    "--audio-artifact must be a safe lowercase WAV filename");
}
if (buttonTracePath) {
  assert.ok(!arguments_.has("host-ticks") && !arguments_.has("button-mask"),
    "--button-trace cannot be combined with --host-ticks or --button-mask");
}
assert.ok(isPrivateOfficialCapturePath(repository, outputPath),
  "Implementation candidate captures must stay below ignored captures/official");
assert.ok(!fs.existsSync(outputPath), "Implementation candidate capture already exists; captures are immutable");
for (const persistencePath of [persistenceInputPath, persistenceOutputPath]) {
  if (!persistencePath) continue;
  assert.ok(isPrivateOfficialCapturePath(repository, persistencePath),
    "Implementation persistence bytes must stay below ignored captures/official");
}
if (persistenceOutputPath) {
  assert.ok(!fs.existsSync(persistenceOutputPath),
    "Implementation persistence output already exists; captures are immutable");
}

const cart = fs.readFileSync(cartPath);
const hostButtonMasks: readonly number[] = buttonTracePath
  ? expandButtonTraceHostMasks(JSON.parse(fs.readFileSync(buttonTracePath, "utf8")))
  : Array(requestedHostTicks).fill(buttonMask);
const { source, rom } = extractP8ProbeCart(cart);
const kernelJs = path.join(repository, "apps/web/public/kernel/aico8-kernel.js");
const kernelWasm = path.join(repository, "apps/web/public/kernel/aico8-kernel.wasm");
assert.ok(fs.statSync(kernelJs, { throwIfNoEntry: false })?.isFile(),
  "Build the production Wasm kernel before candidate capture");
assert.ok(fs.statSync(kernelWasm, { throwIfNoEntry: false })?.isFile(),
  "Production Wasm payload is missing");
const { default: createKernel } = await import(pathToFileURL(kernelJs).href);
const kernel = await createKernel();

function copyToHeap(bytes: Uint8Array): number {
  const pointer = kernel._malloc(bytes.length);
  assert.notEqual(pointer, 0, "Wasm allocation failed");
  kernel.HEAPU8.set(bytes, pointer);
  return pointer;
}

function lastError(runtime: number): string {
  const pointer = kernel._aico8_last_error(runtime);
  return pointer ? kernel.UTF8ToString(pointer) : "unknown kernel error";
}

const runtime = kernel._aico8_create();
assert.notEqual(runtime, 0, "Wasm runtime creation failed");
const romPointer = copyToHeap(rom);
const sourcePointer = copyToHeap(source);
const persistenceInput = persistenceInputPath ? fs.readFileSync(persistenceInputPath) : undefined;
const persistenceInputPointer = persistenceInput ? copyToHeap(persistenceInput) : undefined;
const persistenceScratchPointer = persistenceOutputPath ? kernel._malloc(256) : undefined;
const palettePointer = framebufferArtifact ? kernel._malloc(32) : undefined;
if (framebufferArtifact) assert.notEqual(palettePointer, 0, "Wasm palette allocation failed");
const audioScratchCapacity = 2048;
const audioScratchPointer = audioArtifact ? kernel._malloc(audioScratchCapacity * 2) : undefined;
if (audioArtifact) assert.notEqual(audioScratchPointer, 0, "Wasm audio allocation failed");
const audioSamples: number[] = [];
const artifactRoot = path.join(
  path.dirname(outputPath),
  `${path.basename(outputPath, path.extname(outputPath))}.artifacts`,
);
if (framebufferArtifact || audioArtifact) {
  assert.ok(!fs.existsSync(artifactRoot),
    "Implementation candidate artifact bundle already exists; captures are immutable");
}
const temporaryOutput = `${outputPath}.tmp-${process.pid}`;
const temporaryPersistenceOutput = persistenceOutputPath
  ? `${persistenceOutputPath}.tmp-${process.pid}` : undefined;
try {
  assert.equal(kernel._aico8_load_cart(runtime, romPointer, rom.length, sourcePointer, source.length),
    1, lastError(runtime));
  if (persistenceInput && persistenceInputPointer !== undefined) {
    assert.equal(kernel._aico8_load_persistent(runtime, persistenceInputPointer,
      persistenceInput.length), 1, lastError(runtime));
  }
  assert.equal(kernel._aico8_start(runtime), 1, lastError(runtime));
  assert.equal(kernel._aico8_initialization_complete(runtime), 1,
    "Probe unexpectedly suspended during initialization");
  for (const hostButtonMask of hostButtonMasks) {
    assert.notEqual(kernel._aico8_tick60(runtime, hostButtonMask), -1, lastError(runtime));
    if (audioArtifact && audioScratchPointer !== undefined) {
      while (kernel._aico8_audio_available(runtime) > 0) {
        const count = kernel._aico8_read_audio(
          runtime, audioScratchPointer, audioScratchCapacity);
        assert.ok(count > 0 && count <= audioScratchCapacity, "Unable to drain candidate PCM");
        const view = new Int16Array(kernel.HEAPU8.buffer, audioScratchPointer, count);
        for (const sample of view) audioSamples.push(sample);
      }
    }
  }
  const diagnosticPointer = kernel._aico8_diagnostic_output(runtime);
  const events = parseProbeEvents(diagnosticPointer ? kernel.UTF8ToString(diagnosticPointer) : "");
  assert.ok(events.length > 0, "Probe emitted no diagnostic events");
  const attachments = [];
  if (framebufferArtifact && palettePointer !== undefined) {
    const framebufferPointer = kernel._aico8_framebuffer(runtime);
    const framebufferSize = kernel._aico8_framebuffer_size();
    assert.equal(framebufferSize, 128 * 128, "Candidate framebuffer dimensions changed");
    assert.equal(kernel._aico8_copy_palette_state(runtime, palettePointer, 32), 32,
      "Candidate display palette could not be copied");
    const framebuffer = kernel.HEAPU8.slice(
      framebufferPointer, framebufferPointer + framebufferSize);
    const paletteState = kernel.HEAPU8.slice(palettePointer, palettePointer + 32);
    const displayPalette = paletteState.slice(16, 32);
    const rgba = Buffer.alloc(framebuffer.length * 4);
    for (let pixel = 0; pixel < framebuffer.length; pixel += 1) {
      const rgb = pico8FramebufferColor(framebuffer[pixel] ?? 0, displayPalette);
      const offset = pixel * 4;
      rgba[offset] = (rgb >>> 16) & 0xff;
      rgba[offset + 1] = (rgb >>> 8) & 0xff;
      rgba[offset + 2] = rgb & 0xff;
      rgba[offset + 3] = 255;
    }
    const png = encodePngRgba(128, 128, rgba);
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, framebufferArtifact), png, { flag: "wx" });
    attachments.push({
      sourceRelativePath: framebufferArtifact,
      relativePath: path.posix.join(path.basename(artifactRoot), framebufferArtifact),
      mediaType: "image/png",
      bytes: png.length,
      sha256: sha256Bytes(png),
    });
  }
  if (audioArtifact) {
    const wav = encodeWavePcm16(22050, Int16Array.from(audioSamples));
    fs.mkdirSync(artifactRoot, { recursive: true });
    fs.writeFileSync(path.join(artifactRoot, audioArtifact), wav, { flag: "wx" });
    attachments.push({
      sourceRelativePath: audioArtifact,
      relativePath: path.posix.join(path.basename(artifactRoot), audioArtifact),
      mediaType: "audio/wav",
      bytes: wav.length,
      sha256: sha256Bytes(wav),
    });
  }
  const capture = buildImplementationProbeCapture({
    probe: path.basename(cartPath, path.extname(cartPath)),
    cartSha256: sha256Bytes(cart),
    backend: "aico8-production-wasm",
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    runtimeSha256: sha256Bytes(fs.readFileSync(kernelWasm)),
    command: [process.execPath, ...process.argv.slice(1)],
    events,
    attachments,
  });
  const errors = [
    ...validateImplementationProbeCapture(capture),
    ...validateOfficialProbeArtifactFiles(capture, outputPath),
  ];
  assert.deepEqual(errors, [], errors.join("\n"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(temporaryOutput, `${JSON.stringify(capture, null, 2)}\n`, { flag: "wx" });
  if (persistenceOutputPath && persistenceScratchPointer !== undefined
      && temporaryPersistenceOutput) {
    assert.equal(kernel._aico8_copy_persistent(runtime, persistenceScratchPointer, 256), 256,
      "Unable to copy implementation persistence bytes");
    fs.mkdirSync(path.dirname(persistenceOutputPath), { recursive: true });
    fs.writeFileSync(temporaryPersistenceOutput,
      kernel.HEAPU8.slice(persistenceScratchPointer, persistenceScratchPointer + 256),
      { flag: "wx" });
    fs.renameSync(temporaryPersistenceOutput, persistenceOutputPath);
  }
  fs.renameSync(temporaryOutput, outputPath);
  process.stdout.write(`Aico 8 implementation probe captured: ${events.length} events\n`);
} finally {
  if (audioScratchPointer !== undefined) kernel._free(audioScratchPointer);
  if (palettePointer !== undefined) kernel._free(palettePointer);
  if (persistenceScratchPointer !== undefined) kernel._free(persistenceScratchPointer);
  if (persistenceInputPointer !== undefined) kernel._free(persistenceInputPointer);
  kernel._free(sourcePointer);
  kernel._free(romPointer);
  kernel._aico8_destroy(runtime);
  fs.rmSync(temporaryOutput, { force: true });
  if (temporaryPersistenceOutput) fs.rmSync(temporaryPersistenceOutput, { force: true });
  if (!fs.existsSync(outputPath) && (framebufferArtifact || audioArtifact)) {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
}
