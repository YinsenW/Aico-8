import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const kernelUrl = new URL("../../../apps/web/public/kernel/aico8-kernel.js", import.meta.url);
const { default: createKernel } = await import(kernelUrl.href);
const kernel = await createKernel();

const source = new Uint8Array(await readFile(new URL("./fixtures/synthetic_cart.lua", import.meta.url)));
const rom = new Uint8Array(0x8000);
rom[4] = 0x21;
rom[0x2000] = 1;
const persistent = new Uint8Array(256);
persistent[2] = 5;

function copyToHeap(bytes) {
  const pointer = kernel._malloc(bytes.length);
  assert.notEqual(pointer, 0);
  kernel.HEAPU8.set(bytes, pointer);
  return pointer;
}

function appendByte(checkpoint, value) {
  checkpoint.push(value & 0xff);
}

function appendU16(checkpoint, value) {
  appendByte(checkpoint, value);
  appendByte(checkpoint, value >>> 8);
}

function appendU32(checkpoint, value) {
  for (let shift = 0; shift < 32; shift += 8) appendByte(checkpoint, value >>> shift);
}

const runtime = kernel._aico8_create();
assert.notEqual(runtime, 0);
const romPointer = copyToHeap(rom);
const sourcePointer = copyToHeap(source);
const persistentPointer = copyToHeap(persistent);

let wasmCheckpoint = "";
try {
  assert.equal(kernel._aico8_load_cart(runtime, romPointer, rom.length, sourcePointer, source.length), 1);
  assert.equal(kernel._aico8_load_persistent(runtime, persistentPointer, persistent.length), 1);
  assert.equal(kernel._aico8_start(runtime), 1);
  assert.equal(kernel._aico8_tick60(runtime, 1 << 1), 1);

  const framebuffer = kernel._aico8_framebuffer(runtime);
  const framebufferSize = kernel._aico8_framebuffer_size();
  assert.equal(framebufferSize, 128 * 128);
  assert.equal(kernel.HEAPU8[framebuffer], 9);
  assert.equal(kernel.HEAPU8[framebuffer + 1], 2);

  const commandCount = kernel._aico8_draw_command_count(runtime);
  const commands = kernel._aico8_draw_commands(runtime);
  const payload = kernel._aico8_draw_payload(runtime);
  const payloadSize = kernel._aico8_draw_payload_size(runtime);
  assert.equal(commandCount, 9);
  assert.equal(payloadSize, 2);
  assert.equal(new TextDecoder().decode(kernel.HEAPU8.slice(payload, payload + 2)), "ok");

  const savedPointer = kernel._malloc(256);
  assert.notEqual(savedPointer, 0);
  try {
    assert.equal(kernel._aico8_copy_persistent(runtime, savedPointer, 256), 256);
    assert.deepEqual([...kernel.HEAPU8.slice(savedPointer, savedPointer + 4)], [0, 0, 7, 0]);

    const checkpoint = [...kernel.HEAPU8.slice(framebuffer, framebuffer + framebufferSize)];
    appendU32(checkpoint, commandCount);
    const view = new DataView(kernel.HEAPU8.buffer);
    for (let index = 0; index < commandCount; index += 1) {
      const offset = commands + index * 68;
      appendU16(checkpoint, view.getUint16(offset, true));
      appendU16(checkpoint, view.getUint16(offset + 2, true));
      for (let argument = 0; argument < 12; argument += 1) {
        appendU32(checkpoint, view.getUint32(offset + 20 + argument * 4, true));
      }
    }
    appendU32(checkpoint, payloadSize);
    checkpoint.push(...kernel.HEAPU8.slice(payload, payload + payloadSize));
    checkpoint.push(...kernel.HEAPU8.slice(savedPointer, savedPointer + 256));
    wasmCheckpoint = Buffer.from(checkpoint).toString("hex");
  } finally {
    kernel._free(savedPointer);
  }
} finally {
  kernel._aico8_destroy(runtime);
  kernel._free(persistentPointer);
  kernel._free(sourcePointer);
  kernel._free(romPointer);
}

const nativeCheckpoint = execFileSync("./build/vm_tests", ["--checkpoint"], { encoding: "utf8" }).trim();
assert.match(nativeCheckpoint, /^[0-9a-f]+$/);
assert.equal(wasmCheckpoint, nativeCheckpoint, "native and Wasm checkpoints differ");
const digest = createHash("sha256").update(Buffer.from(wasmCheckpoint, "hex")).digest("hex").slice(0, 12);
process.stdout.write(`p8 Wasm identity: ok (${wasmCheckpoint.length / 2} bytes, sha256 ${digest})\n`);
