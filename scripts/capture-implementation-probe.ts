#!/usr/bin/env -S pnpm exec tsx
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
import { extractSourceOnlyProbe } from "./lib/source-only-probe.mjs";
import { expandButtonTraceHostMasks } from "./lib/button-trace.mjs";

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
assert.ok(arguments_.get("cart"), "--cart is required");
assert.ok(arguments_.get("output"), "--output is required");
assert.ok(Number.isSafeInteger(requestedHostTicks) && requestedHostTicks >= 0 && requestedHostTicks <= 1_000_000,
  "--host-ticks must be an integer from 0 through 1000000");
assert.ok(Number.isSafeInteger(buttonMask) && buttonMask >= 0 && buttonMask <= 0x3f,
  "--button-mask must be an integer from 0 through 63");
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
const persistenceInput = persistenceInputPath ? fs.readFileSync(persistenceInputPath) : undefined;
const persistenceInputPointer = persistenceInput ? copyToHeap(persistenceInput) : undefined;
const persistenceScratchPointer = persistenceOutputPath ? kernel._malloc(256) : undefined;
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
  }
  const diagnosticPointer = kernel._aico8_diagnostic_output(runtime);
  const events = parseProbeEvents(diagnosticPointer ? kernel.UTF8ToString(diagnosticPointer) : "");
  assert.ok(events.length > 0, "Probe emitted no diagnostic events");
  const capture = buildImplementationProbeCapture({
    probe: path.basename(cartPath, path.extname(cartPath)),
    cartSha256: sha256Bytes(cart),
    backend: "aico8-production-wasm",
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    runtimeSha256: sha256Bytes(fs.readFileSync(kernelWasm)),
    command: [process.execPath, ...process.argv.slice(1)],
    events,
    attachments: [],
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
  if (persistenceScratchPointer !== undefined) kernel._free(persistenceScratchPointer);
  if (persistenceInputPointer !== undefined) kernel._free(persistenceInputPointer);
  kernel._free(sourcePointer);
  kernel._free(romPointer);
  kernel._aico8_destroy(runtime);
  fs.rmSync(temporaryOutput, { force: true });
  if (temporaryPersistenceOutput) fs.rmSync(temporaryPersistenceOutput, { force: true });
}
