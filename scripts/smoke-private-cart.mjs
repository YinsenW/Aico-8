import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const hostTicks = Number(arguments_.get("host-ticks") ?? "120");
const output = arguments_.get("out") ? path.resolve(arguments_.get("out")) : undefined;
const observedNumberNames = (arguments_.get("observe-numbers") ?? "")
  .split(",")
  .filter((value) => value.length > 0);
const buttonUpdates = (arguments_.get("button-updates") ?? "")
  .split(",")
  .filter((value) => value.length > 0)
  .flatMap((token) => {
    const [maskText, repeatText, extra] = token.split("*");
    assert.equal(extra, undefined, "--button-updates tokens use mask or mask*repeat");
    const mask = Number(maskText);
    const repeat = repeatText === undefined ? 1 : Number(repeatText);
    assert.ok(Number.isSafeInteger(repeat) && repeat >= 1 && repeat <= 36_000,
      "--button-updates repeat counts must be integers from 1 through 36000");
    return Array.from({ length: repeat }, () => mask);
  });
assert.ok(arguments_.get("workspace"), "--workspace is required");
assert.ok(Number.isSafeInteger(hostTicks) && hostTicks > 0 && hostTicks <= 36_000, "--host-ticks must be an integer from 1 to 36000");
assert.ok(buttonUpdates.every((mask) => Number.isSafeInteger(mask) && mask >= 0 && mask <= 63),
  "--button-updates must be comma-separated PICO-8 button masks from 0 through 63");
assert.ok(observedNumberNames.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)),
  "--observe-numbers must contain comma-separated Lua global names");

const romPath = path.join(workspace, "source.rom");
const sourcePath = path.join(workspace, "code.p8.lua");
const rom = fs.readFileSync(romPath);
const source = fs.readFileSync(sourcePath);
assert.equal(rom.length, 0x8000, "source.rom must be exactly 32 KiB");
assert.ok(source.length > 0, "code.p8.lua must not be empty");

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kernelPath = path.join(repository, "apps/web/public/kernel/aico8-kernel.js");
assert.ok(fs.statSync(kernelPath, { throwIfNoEntry: false })?.isFile(), "Build the Wasm kernel before running private cart smoke");
const { default: createKernel } = await import(pathToFileURL(kernelPath).href);
const kernel = await createKernel();

function copyToHeap(bytes) {
  const pointer = kernel._malloc(bytes.length);
  assert.notEqual(pointer, 0, "Wasm allocation failed");
  kernel.HEAPU8.set(bytes, pointer);
  return pointer;
}

function lastError(runtime) {
  const pointer = kernel._aico8_last_error(runtime);
  return pointer ? kernel.UTF8ToString(pointer) : "unknown kernel error";
}

function readGlobalNumbers(runtime) {
  const result = {};
  for (const name of observedNumberNames) {
    const encoded = new TextEncoder().encode(`${name}\0`);
    const namePointer = copyToHeap(encoded);
    const valuePointer = kernel._malloc(4);
    assert.notEqual(valuePointer, 0, "Wasm global-value allocation failed");
    try {
      if (kernel._aico8_get_global_raw(runtime, namePointer, valuePointer) === 1) {
        result[name] = new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true);
      }
    } finally {
      kernel._free(valuePointer);
      kernel._free(namePointer);
    }
  }
  return result;
}

const runtime = kernel._aico8_create();
assert.notEqual(runtime, 0, "Wasm runtime creation failed");
const romPointer = copyToHeap(rom);
const sourcePointer = copyToHeap(source);
const persistence = new Uint8Array(256);
const persistencePointer = copyToHeap(persistence);
const audioScratchCapacity = 2048;
const audioScratchPointer = kernel._malloc(audioScratchCapacity * 2);
assert.notEqual(audioScratchPointer, 0, "Wasm audio scratch allocation failed");
const cartIdentity = {
  romSha256: sha256(rom),
  sourceSha256: sha256(source),
  combinedSha256: createHash("sha256").update(rom).update(source).digest("hex"),
};
const diagnosticInput = {
  logicalUpdateMaskCount: buttonUpdates.length,
  sha256: sha256(Uint8Array.from(buttonUpdates)),
};
let logicalUpdates = 0;
let initializationTicks = 0;
let hostTicksAttempted = 0;
let maximumDrawCommandCount = 0;
let audioSampleCount = 0;
let audioPeakAbsolute = 0;
const audioHash = createHash("sha256");

function drainAudio() {
  while (kernel._aico8_audio_available(runtime) > 0) {
    const count = kernel._aico8_read_audio(runtime, audioScratchPointer, audioScratchCapacity);
    assert.ok(count > 0 && count <= audioScratchCapacity, "Kernel audio queue did not drain");
    const bytes = kernel.HEAPU8.slice(audioScratchPointer, audioScratchPointer + count * 2);
    audioHash.update(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < count; index += 1) {
      audioPeakAbsolute = Math.max(audioPeakAbsolute, Math.abs(view.getInt16(index * 2, true)));
    }
    audioSampleCount += count;
  }
}
try {
  assert.equal(kernel._aico8_load_cart(runtime, romPointer, rom.length, sourcePointer, source.length), 1, lastError(runtime));
  assert.equal(kernel._aico8_load_persistent(runtime, persistencePointer, persistence.length), 1, lastError(runtime));
  assert.equal(kernel._aico8_start(runtime), 1, lastError(runtime));
  maximumDrawCommandCount = kernel._aico8_draw_command_count(runtime);
  for (let tick = 0; tick < hostTicks; tick += 1) {
    hostTicksAttempted = tick + 1;
    const initializedBeforeTick = kernel._aico8_initialization_complete(runtime) === 1;
    const buttons = initializedBeforeTick ? (buttonUpdates[logicalUpdates] ?? 0) : 0;
    const result = kernel._aico8_tick60(runtime, buttons);
    assert.notEqual(result, -1, `host tick ${tick}: ${lastError(runtime)}`);
    drainAudio();
    if (result === 1 && initializedBeforeTick) logicalUpdates += 1;
    if (!initializedBeforeTick) initializationTicks += 1;
    maximumDrawCommandCount = Math.max(maximumDrawCommandCount, kernel._aico8_draw_command_count(runtime));
  }
  assert.equal(kernel._aico8_initialization_complete(runtime), 1,
    `Initialization is still suspended after ${hostTicks} host ticks`);
  assert.ok(logicalUpdates > 0, "Cart did not execute a logical update");
  const framebufferPointer = kernel._aico8_framebuffer(runtime);
  const framebufferSize = kernel._aico8_framebuffer_size();
  const persistentResultPointer = kernel._malloc(256);
  assert.notEqual(persistentResultPointer, 0);
  try {
    assert.equal(kernel._aico8_copy_persistent(runtime, persistentResultPointer, 256), 256);
    const report = {
      schemaVersion: "aico8.private-cart-smoke.v1",
      cart: cartIdentity,
      diagnosticInput,
      observedNumberRaw16_16: readGlobalNumbers(runtime),
      execution: {
        hostTickRate: 60,
        hostTicks,
        initializationTicks,
        initializationCompleted: true,
        logicalUpdates,
        maximumDrawCommandCount,
        audioSampleCount,
        audioPeakAbsolute,
        audioPcmSha256: audioHash.copy().digest("hex"),
        framebufferSha256: sha256(kernel.HEAPU8.slice(framebufferPointer, framebufferPointer + framebufferSize)),
        persistenceSha256: sha256(kernel.HEAPU8.slice(persistentResultPointer, persistentResultPointer + 256)),
      },
      authority: "diagnostic-boot-only-not-canonical-completion",
      status: "passed",
    };
    if (output) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    }
    process.stdout.write(`Private cart smoke: PASS (${logicalUpdates} logical updates, ${maximumDrawCommandCount} max draw commands)\n`);
  } finally {
    kernel._free(persistentResultPointer);
  }
} catch (error) {
  if (output) {
    const report = {
      schemaVersion: "aico8.private-cart-smoke.v1",
      cart: cartIdentity,
      diagnosticInput,
      observedNumberRaw16_16: readGlobalNumbers(runtime),
      execution: {
        hostTickRate: 60,
        requestedHostTicks: hostTicks,
        hostTicksAttempted,
        initializationTicks,
        initializationCompleted: kernel._aico8_initialization_complete(runtime) === 1,
        logicalUpdates,
        maximumDrawCommandCount,
        audioSampleCount,
        audioPeakAbsolute,
        audioPcmSha256: audioHash.copy().digest("hex"),
      },
      authority: "diagnostic-boot-only-not-canonical-completion",
      status: "failed",
      failure: error instanceof Error ? error.message : String(error),
    };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  throw error;
} finally {
  kernel._aico8_destroy(runtime);
  kernel._free(audioScratchPointer);
  kernel._free(persistencePointer);
  kernel._free(sourcePointer);
  kernel._free(romPointer);
}
