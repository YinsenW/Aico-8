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
rom[0x3200] = 33 | (3 << 6);
rom[0x3201] = 7 << 1;
rom[0x3240] = 1;
rom[0x3241] = 2;
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
  assert.equal(kernel._aico8_initialization_complete(runtime), 1);
  assert.equal(kernel._aico8_tick60(runtime, 1 << 1), 1);

  const framebuffer = kernel._aico8_framebuffer(runtime);
  const framebufferSize = kernel._aico8_framebuffer_size();
  assert.equal(framebufferSize, 128 * 128);
  assert.equal(kernel.HEAPU8[framebuffer], 9);
  assert.equal(kernel.HEAPU8[framebuffer + 1], 2);
  assert.equal(kernel.HEAPU8[framebuffer + 8 + 128], 0, "zero map cell must skip visible sprite 0");

  const mapPointer = kernel._malloc(256);
  const valuePointer = kernel._malloc(4);
  const xNamePointer = copyToHeap(new TextEncoder().encode("x\0"));
  const readyNamePointer = copyToHeap(new TextEncoder().encode("ready\0"));
  const modeNamePointer = copyToHeap(new TextEncoder().encode("mode\0"));
  const actorsNamePointer = copyToHeap(new TextEncoder().encode("actors\0"));
  const valuesNamePointer = copyToHeap(new TextEncoder().encode("values\0"));
  const xFieldPointer = copyToHeap(new TextEncoder().encode("x\0"));
  const rockFieldPointer = copyToHeap(new TextEncoder().encode("rock\0"));
  const stringPointer = kernel._malloc(16);
  const menuLabelPointer = kernel._malloc(17);
  try {
    assert.equal(kernel._aico8_copy_map_region(runtime, 0, 0, 16, 16, mapPointer, 256), 256);
    assert.equal(kernel.HEAPU8[mapPointer], 1);
    assert.equal(kernel._aico8_get_global_raw(runtime, xNamePointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 7 << 16);
    assert.equal(kernel._aico8_get_global_boolean(runtime, readyNamePointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 1);
    assert.equal(kernel._aico8_copy_global_string(runtime, modeNamePointer, stringPointer, 16), 7);
    assert.equal(kernel.UTF8ToString(stringPointer), "fixture");
    assert.equal(kernel._aico8_get_table_length(runtime, actorsNamePointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getUint32(valuePointer, true), 2);
    assert.equal(kernel._aico8_get_table_value_raw(runtime, valuesNamePointer, 2, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 9 << 16);
    assert.equal(kernel._aico8_get_table_value_raw(runtime, valuesNamePointer, 3, valuePointer), 0);
    assert.equal(kernel._aico8_get_table_entry_raw(runtime, actorsNamePointer, 1, xFieldPointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 3 << 16);
    assert.equal(kernel._aico8_get_table_entry_boolean(runtime, actorsNamePointer, 1, rockFieldPointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 1);
    assert.equal(kernel._aico8_get_table_entry_boolean(runtime, actorsNamePointer, 2, rockFieldPointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 0);
    assert.equal(kernel._aico8_copy_menu_item_label(runtime, 1, menuLabelPointer, 17), 14);
    assert.equal(kernel.UTF8ToString(menuLabelPointer), "fixture action");
    assert.equal(kernel._aico8_menu_item_filter(runtime, 1), 3);
    assert.equal(kernel._aico8_invoke_menu_item(runtime, 1, 7, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 1);
    assert.equal(kernel._aico8_copy_menu_item_label(runtime, 1, menuLabelPointer, 17), 9);
    assert.equal(kernel.UTF8ToString(menuLabelPointer), "stay open");
    const menuButtonsNamePointer = copyToHeap(new TextEncoder().encode("menu_buttons\0"));
    try {
      assert.equal(kernel._aico8_get_global_raw(runtime, menuButtonsNamePointer, valuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 4 << 16);
    } finally {
      kernel._free(menuButtonsNamePointer);
    }
  } finally {
    kernel._free(menuLabelPointer);
    kernel._free(stringPointer);
    kernel._free(rockFieldPointer);
    kernel._free(xFieldPointer);
    kernel._free(actorsNamePointer);
    kernel._free(valuesNamePointer);
    kernel._free(modeNamePointer);
    kernel._free(readyNamePointer);
    kernel._free(xNamePointer);
    kernel._free(valuePointer);
    kernel._free(mapPointer);
  }

  const commandCount = kernel._aico8_draw_command_count(runtime);
  const commands = kernel._aico8_draw_commands(runtime);
  const payload = kernel._aico8_draw_payload(runtime);
  const payloadSize = kernel._aico8_draw_payload_size(runtime);
  assert.equal(commandCount, 11);
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
    const audioCount = kernel._aico8_audio_available(runtime);
    const audioPointer = kernel._malloc(Math.max(2, audioCount * 2));
    try {
      assert.equal(kernel._aico8_read_audio(runtime, audioPointer, audioCount), audioCount);
      appendU32(checkpoint, audioCount);
      checkpoint.push(...kernel.HEAPU8.slice(audioPointer, audioPointer + audioCount * 2));
    } finally {
      kernel._free(audioPointer);
    }
    appendU32(checkpoint, kernel._aico8_audio_capabilities(runtime));
    const audioStatusPointer = kernel._malloc(20);
    const audioEventsPointer = kernel._malloc(16 * 32);
    try {
      assert.equal(kernel._aico8_get_audio_channel_status(runtime, 0, audioStatusPointer), 1);
      for (let offset = 0; offset < 20; offset += 4) {
        appendU32(checkpoint, view.getUint32(audioStatusPointer + offset, true));
      }
      const eventCount = kernel._aico8_copy_audio_events(runtime, audioEventsPointer, 16);
      appendU32(checkpoint, eventCount);
      for (let index = 0; index < eventCount; index += 1) {
        for (let offset = 0; offset < 32; offset += 4) {
          appendU32(checkpoint, view.getUint32(audioEventsPointer + index * 32 + offset, true));
        }
      }
    } finally {
      kernel._free(audioEventsPointer);
      kernel._free(audioStatusPointer);
    }
    checkpoint.push(...kernel.HEAPU8.slice(savedPointer, savedPointer + 256));
    wasmCheckpoint = Buffer.from(checkpoint).toString("hex");

    assert.equal(kernel._aico8_tick60(runtime, 0), 0);
    assert.equal(kernel._aico8_tick60(runtime, 0), 1);
    assert.equal(kernel._aico8_tick60(runtime, 1 << 4), 0);
    assert.equal(kernel._aico8_tick60(runtime, 1 << 4), 1);
    const restartNamePointer = copyToHeap(new TextEncoder().encode("x\0"));
    const restartValuePointer = kernel._malloc(4);
    try {
      assert.equal(kernel._aico8_get_global_raw(runtime, restartNamePointer, restartValuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(restartValuePointer, true), 7 << 16,
        "run() must restart the cart while preserving cartdata");
    } finally {
      kernel._free(restartValuePointer);
      kernel._free(restartNamePointer);
    }
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

const errorRuntime = kernel._aico8_create();
assert.notEqual(errorRuntime, 0);
const errorSource = new TextEncoder().encode("function _init() missing_shared_api() end\n");
const errorSourcePointer = copyToHeap(errorSource);
const errorRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(errorRuntime, errorRomPointer, 0x8000, errorSourcePointer, errorSource.length), 1);
  assert.equal(kernel._aico8_start(errorRuntime), 0, "A Lua runtime error must fail the ABI call without aborting Wasm");
  assert.match(kernel.UTF8ToString(kernel._aico8_last_error(errorRuntime)), /missing_shared_api/);
} finally {
  kernel._aico8_destroy(errorRuntime);
  kernel._free(errorRomPointer);
  kernel._free(errorSourcePointer);
}

const policyRuntime = kernel._aico8_create();
assert.notEqual(policyRuntime, 0);
const policySource = new TextEncoder().encode(
  "function _init() extcmd('rec') end\nfunction _update() missing_update_api() end\nfunction _draw() printh('must not draw') end\n",
);
const policySourcePointer = copyToHeap(policySource);
const policyRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(policyRuntime, policyRomPointer, 0x8000, policySourcePointer, policySource.length), 1);
  assert.equal(kernel._aico8_start(policyRuntime), 1);
  assert.match(kernel.UTF8ToString(kernel._aico8_diagnostic_output(policyRuntime)), /recording is unavailable/);
  assert.equal(kernel._aico8_tick60(policyRuntime, 0), -1, "an update error must survive the draw boundary");
  assert.match(kernel.UTF8ToString(kernel._aico8_last_error(policyRuntime)), /missing_update_api/);
  assert.doesNotMatch(kernel.UTF8ToString(kernel._aico8_diagnostic_output(policyRuntime)), /must not draw/);
} finally {
  kernel._aico8_destroy(policyRuntime);
  kernel._free(policyRomPointer);
  kernel._free(policySourcePointer);
}

const audioStatRuntime = kernel._aico8_create();
assert.notEqual(audioStatRuntime, 0);
const audioStatSource = new TextEncoder().encode(
  "function _init() before=stat(57) music(0) during=stat(57) music(-1) after=stat(57) end\n",
);
const audioStatSourcePointer = copyToHeap(audioStatSource);
const audioStatRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(audioStatRuntime, audioStatRomPointer, 0x8000,
    audioStatSourcePointer, audioStatSource.length), 1);
  assert.equal(kernel._aico8_start(audioStatRuntime), 1);
  const valuePointer = kernel._malloc(4);
  const beforePointer = copyToHeap(new TextEncoder().encode("before\0"));
  const duringPointer = copyToHeap(new TextEncoder().encode("during\0"));
  const afterPointer = copyToHeap(new TextEncoder().encode("after\0"));
  try {
    for (const [namePointer, expected] of [[beforePointer, 0], [duringPointer, 1], [afterPointer, 0]]) {
      assert.equal(kernel._aico8_get_global_boolean(audioStatRuntime, namePointer, valuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), expected);
    }
  } finally {
    kernel._free(afterPointer);
    kernel._free(duringPointer);
    kernel._free(beforePointer);
    kernel._free(valuePointer);
  }
} finally {
  kernel._aico8_destroy(audioStatRuntime);
  kernel._free(audioStatRomPointer);
  kernel._free(audioStatSourcePointer);
}

const tickHistoryRuntime = kernel._aico8_create();
assert.notEqual(tickHistoryRuntime, 0);
const tickHistorySource = new TextEncoder().encode("function _init() observed=stat(46) end\n");
const tickHistorySourcePointer = copyToHeap(tickHistorySource);
const tickHistoryRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(tickHistoryRuntime, tickHistoryRomPointer, 0x8000,
    tickHistorySourcePointer, tickHistorySource.length), 1);
  assert.equal(kernel._aico8_start(tickHistoryRuntime), 0,
    "unqualified stat(46..56) must remain fail-closed in Wasm");
  assert.match(kernel.UTF8ToString(kernel._aico8_last_error(tickHistoryRuntime)),
    /audio selector 46 is not conformance-qualified/);
} finally {
  kernel._aico8_destroy(tickHistoryRuntime);
  kernel._free(tickHistoryRomPointer);
  kernel._free(tickHistorySourcePointer);
}

const digest = createHash("sha256").update(Buffer.from(wasmCheckpoint, "hex")).digest("hex").slice(0, 12);
process.stdout.write(`p8 Wasm identity: ok (${wasmCheckpoint.length / 2} bytes, sha256 ${digest})\n`);
