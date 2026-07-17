#!/usr/bin/env -S pnpm exec tsx
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  pico8FramebufferColor,
} from "../apps/web/src/runtime/pico8-palette.ts";
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
import { encodePngRgba } from "./lib/png-rgba.mjs";

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

function extractSourceOnlyProbe(cart: Buffer): Buffer {
  const text = cart.toString("utf8");
  const lua = /^__lua__\r?$/m.exec(text);
  if (!lua || lua.index === undefined) throw new Error("Probe cart has no __lua__ section");
  const start = lua.index + lua[0].length;
  const remainder = text.slice(start).replace(/^\r?\n/, "");
  const section = /^__([a-z0-9_]+)__\r?$/m.exec(remainder);
  const source = section?.index === undefined ? remainder : remainder.slice(0, section.index);
  const resources = section?.index === undefined ? "" : remainder.slice(section.index + section[0].length);
  if (section && (section[1] !== "gfx" || resources.trim() !== "")) {
    throw new Error("Curved-raster candidate capture accepts source-only probes or an empty __gfx__ terminator");
  }
  if (source.trim() === "") throw new Error("Probe Lua source is empty");
  return Buffer.from(source, "utf8");
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawArguments = process.argv.slice(2);
const visualOnly = rawArguments.includes("--visual-only");
const arguments_ = argumentsMap(rawArguments.filter((argument) => argument !== "--visual-only"));
const cartPath = path.resolve(arguments_.get("cart") ?? "");
const outputPath = path.resolve(arguments_.get("output") ?? "");
assert.ok(arguments_.get("cart"), "--cart is required");
assert.ok(arguments_.get("output"), "--output is required");
assert.ok(isPrivateOfficialCapturePath(repository, outputPath),
  "Implementation candidate captures must stay below ignored captures/official");
assert.ok(!fs.existsSync(outputPath), "Implementation candidate capture already exists; captures are immutable");
const artifactRoot = path.join(
  path.dirname(outputPath),
  `${path.basename(outputPath, path.extname(outputPath))}.artifacts`,
);
assert.ok(!fs.existsSync(artifactRoot), "Implementation candidate artifact bundle already exists; captures are immutable");

const cart = fs.readFileSync(cartPath);
const source = extractSourceOnlyProbe(cart);
const rom = Buffer.alloc(0x8000);
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
const palettePointer = kernel._malloc(32);
assert.notEqual(palettePointer, 0, "Wasm palette allocation failed");
let captureCommitted = false;
const temporaryOutput = `${outputPath}.tmp-${process.pid}`;
try {
  assert.equal(kernel._aico8_load_cart(runtime, romPointer, rom.length, sourcePointer, source.length),
    1, lastError(runtime));
  assert.equal(kernel._aico8_start(runtime), 1, lastError(runtime));
  assert.equal(kernel._aico8_initialization_complete(runtime), 1,
    "Curved-raster probe unexpectedly suspended during initialization");
  const diagnosticPointer = kernel._aico8_diagnostic_output(runtime);
  const diagnosticEvents = parseProbeEvents(diagnosticPointer ? kernel.UTF8ToString(diagnosticPointer) : "");
  assert.ok(diagnosticEvents.length > 0, "Curved-raster probe emitted no capture-ready event");
  const events = visualOnly ? [] : diagnosticEvents;
  const framebufferPointer = kernel._aico8_framebuffer(runtime);
  const framebufferSize = kernel._aico8_framebuffer_size();
  assert.equal(framebufferSize, 128 * 128, "Candidate framebuffer dimensions changed");
  assert.equal(kernel._aico8_copy_palette_state(runtime, palettePointer, 32), 32,
    "Candidate display palette could not be copied");
  const framebuffer = kernel.HEAPU8.slice(framebufferPointer, framebufferPointer + framebufferSize);
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
  const artifactPath = path.join(artifactRoot, "curved_raster.png");
  fs.writeFileSync(artifactPath, png);
  const attachment = {
    sourceRelativePath: "curved_raster.png",
    relativePath: path.posix.join(path.basename(artifactRoot), "curved_raster.png"),
    mediaType: "image/png",
    bytes: png.length,
    sha256: sha256Bytes(png),
  };
  const capture = buildImplementationProbeCapture({
    probe: path.basename(cartPath, path.extname(cartPath)),
    cartSha256: sha256Bytes(cart),
    backend: "aico8-production-wasm",
    revision: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim(),
    runtimeSha256: sha256Bytes(fs.readFileSync(kernelWasm)),
    command: [process.execPath, ...process.argv.slice(1)],
    events,
    attachments: [attachment],
  });
  const errors = [
    ...validateImplementationProbeCapture(capture),
    ...validateOfficialProbeArtifactFiles(capture, outputPath),
  ];
  assert.deepEqual(errors, [], errors.join("\n"));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(temporaryOutput, `${JSON.stringify(capture, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporaryOutput, outputPath);
  captureCommitted = true;
  process.stdout.write(`Aico 8 curved-raster candidate captured: ${events.length} events\n`);
} finally {
  kernel._free(palettePointer);
  kernel._free(sourcePointer);
  kernel._free(romPointer);
  kernel._aico8_destroy(runtime);
  fs.rmSync(temporaryOutput, { force: true });
  if (!captureCommitted) fs.rmSync(artifactRoot, { recursive: true, force: true });
}
