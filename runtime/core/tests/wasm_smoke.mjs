import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const kernelUrl = new URL("../../../apps/web/public/kernel/aico8-kernel.js", import.meta.url);
const { default: createKernel } = await import(kernelUrl.href);
const kernel = await createKernel();

const source = new Uint8Array(await readFile(new URL("./fixtures/synthetic_cart.lua", import.meta.url)));
const customAudioSource = new Uint8Array(await readFile(
  new URL("./fixtures/custom_audio_cart.lua", import.meta.url),
));
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
  const playerNamePointer = copyToHeap(new TextEncoder().encode("player\0"));
  const valuesNamePointer = copyToHeap(new TextEncoder().encode("values\0"));
  const restoredNamePointer = copyToHeap(new TextEncoder().encode("restored\0"));
  const xFieldPointer = copyToHeap(new TextEncoder().encode("x\0"));
  const activeFieldPointer = copyToHeap(new TextEncoder().encode("active\0"));
  const rockFieldPointer = copyToHeap(new TextEncoder().encode("rock\0"));
  const stringPointer = kernel._malloc(16);
  const menuLabelPointer = kernel._malloc(17);
  try {
    assert.equal(kernel._aico8_copy_map_region(runtime, 0, 0, 16, 16, mapPointer, 256), 256);
    const spritePointer = kernel._malloc(64);
    assert.ok(spritePointer);
    assert.equal(kernel._aico8_copy_sprite_region(runtime, 0, 0, 8, 8, spritePointer, 64), 64);
    assert.equal(kernel._aico8_copy_sprite_region(runtime, 127, 127, 2, 2, spritePointer, 64), 0);
    kernel._free(spritePointer);
    const flagPointer = kernel._malloc(256);
    assert.ok(flagPointer);
    assert.equal(kernel._aico8_copy_sprite_flags(runtime, 0, 256, flagPointer, 256), 256);
    assert.equal(kernel._aico8_copy_sprite_flags(runtime, 255, 2, flagPointer, 256), 0);
    kernel._free(flagPointer);
    const palettePointer = kernel._malloc(32);
    assert.ok(palettePointer);
    assert.equal(kernel._aico8_copy_palette_state(runtime, palettePointer, 32), 32);
    kernel._free(palettePointer);
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
    assert.equal(kernel._aico8_get_global_raw(runtime, restoredNamePointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 1 << 16);
    assert.equal(kernel._aico8_get_table_field_raw(runtime, playerNamePointer, xFieldPointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 11 << 16);
    assert.equal(kernel._aico8_get_table_field_raw(runtime, playerNamePointer, activeFieldPointer, valuePointer), 0);
    assert.equal(kernel._aico8_get_table_field_boolean(runtime, playerNamePointer, activeFieldPointer, valuePointer), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), 1);
    assert.equal(kernel._aico8_get_table_field_boolean(runtime, playerNamePointer, xFieldPointer, valuePointer), 0);
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
    kernel._free(activeFieldPointer);
    kernel._free(xFieldPointer);
    kernel._free(playerNamePointer);
    kernel._free(actorsNamePointer);
    kernel._free(valuesNamePointer);
    kernel._free(restoredNamePointer);
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
    appendU32(checkpoint, kernel._aico8_audio_diagnostic_flags(runtime));
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

const blockedCustomRuntime = kernel._aico8_create();
assert.notEqual(blockedCustomRuntime, 0);
const blockedCustomRomPointer = copyToHeap(new Uint8Array(0x8000));
const blockedCustomSourcePointer = copyToHeap(customAudioSource);
try {
  assert.equal(kernel._aico8_load_cart(blockedCustomRuntime, blockedCustomRomPointer, 0x8000,
    blockedCustomSourcePointer, customAudioSource.length), 1);
  assert.equal(kernel._aico8_start(blockedCustomRuntime), 0,
    "custom audio must remain fail-closed without explicit diagnostic opt-in");
  assert.match(kernel.UTF8ToString(kernel._aico8_last_error(blockedCustomRuntime)),
    /diagnostic opt-in/);
  assert.equal(kernel._aico8_audio_diagnostic_flags(blockedCustomRuntime), 0);
} finally {
  kernel._aico8_destroy(blockedCustomRuntime);
  kernel._free(blockedCustomSourcePointer);
  kernel._free(blockedCustomRomPointer);
}

const customRuntime = kernel._aico8_create();
assert.notEqual(customRuntime, 0);
const customRomPointer = copyToHeap(new Uint8Array(0x8000));
const customSourcePointer = copyToHeap(customAudioSource);
try {
  assert.equal(kernel._aico8_load_cart(customRuntime, customRomPointer, 0x8000,
    customSourcePointer, customAudioSource.length), 1);
  assert.equal(kernel._aico8_set_audio_diagnostic_mask(customRuntime, 4), 0,
    "Wasm must reject unknown diagnostic bits");
  assert.equal(kernel._aico8_set_audio_diagnostic_mask(customRuntime, 1), 1);
  assert.equal(kernel._aico8_start(customRuntime), 1);
  assert.equal(kernel._aico8_set_audio_diagnostic_mask(customRuntime, 0), 0,
    "Wasm diagnostic policy is immutable after execution starts");
  assert.equal(kernel._aico8_tick60(customRuntime, 0), 1);
  const customCheckpoint = [];
  const customAudioCount = kernel._aico8_audio_available(customRuntime);
  const customAudioPointer = kernel._malloc(Math.max(2, customAudioCount * 2));
  const customEventsPointer = kernel._malloc(8 * 32);
  try {
    assert.equal(customAudioCount, 367);
    assert.equal(kernel._aico8_read_audio(customRuntime, customAudioPointer, customAudioCount),
      customAudioCount);
    appendU32(customCheckpoint, customAudioCount);
    customCheckpoint.push(...kernel.HEAPU8.slice(customAudioPointer,
      customAudioPointer + customAudioCount * 2));
    appendU32(customCheckpoint, kernel._aico8_audio_capabilities(customRuntime));
    appendU32(customCheckpoint, kernel._aico8_audio_diagnostic_flags(customRuntime));
    const customEventCount = kernel._aico8_copy_audio_events(customRuntime, customEventsPointer, 8);
    appendU32(customCheckpoint, customEventCount);
    customCheckpoint.push(...kernel.HEAPU8.slice(customEventsPointer,
      customEventsPointer + customEventCount * 32));
    assert.equal(kernel._aico8_audio_diagnostic_flags(customRuntime), 1);
    assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(customEventsPointer + 12, true), 7,
      "the first event must make diagnostic custom-audio use durable");
  } finally {
    kernel._free(customEventsPointer);
    kernel._free(customAudioPointer);
  }
  const nativeCustomCheckpoint = execFileSync("./build/vm_tests", ["--custom-audio-checkpoint"], {
    encoding: "utf8",
  }).trim();
  assert.equal(Buffer.from(customCheckpoint).toString("hex"), nativeCustomCheckpoint,
    "native and Wasm custom-audio diagnostic checkpoints differ");
  const firstRestartTick = kernel._aico8_tick60(customRuntime, 1 << 4);
  const secondRestartTick = kernel._aico8_tick60(customRuntime, 1 << 4);
  assert.notEqual(firstRestartTick, -1);
  assert.notEqual(secondRestartTick, -1,
    "run() must preserve the explicit diagnostic policy across the same loaded cart");
  assert.equal(kernel._aico8_audio_diagnostic_flags(customRuntime), 1,
    "diagnostic use remains sticky across run() restart");
} finally {
  kernel._aico8_destroy(customRuntime);
  kernel._free(customSourcePointer);
  kernel._free(customRomPointer);
}

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

const tlineRuntime = kernel._aico8_create();
assert.notEqual(tlineRuntime, 0);
const tlineSource = new TextEncoder().encode(
  "function _init() tline(0,30,7,30,0,0) tline(16) tline(0,31,7,31,0,0,1,0) end\n",
);
const tlineSourcePointer = copyToHeap(tlineSource);
const tlineRom = new Uint8Array(0x8000);
tlineRom.set([0x21, 0x43, 0x65, 0x87], 4);
tlineRom[0x2000] = 1;
const tlineRomPointer = copyToHeap(tlineRom);
try {
  assert.equal(kernel._aico8_load_cart(tlineRuntime, tlineRomPointer, tlineRom.length,
    tlineSourcePointer, tlineSource.length), 1);
  assert.equal(kernel._aico8_start(tlineRuntime), 1);
  const tlineFrame = kernel._aico8_framebuffer(tlineRuntime);
  for (let pixel = 0; pixel < 8; pixel += 1) {
    assert.equal(kernel.HEAPU8[tlineFrame + 30 * 128 + pixel], pixel + 1,
      "default 13-bit tline sampling must advance one sprite pixel");
    assert.equal(kernel.HEAPU8[tlineFrame + 31 * 128 + pixel], pixel + 1,
      "16-bit tline sampling must interpret coordinates in pixels");
  }
  assert.equal(kernel._aico8_draw_command_count(tlineRuntime), 3,
    "Wasm must preserve precision-state and raster tline commands");
} finally {
  kernel._aico8_destroy(tlineRuntime);
  kernel._free(tlineRomPointer);
  kernel._free(tlineSourcePointer);
}

const textRuntime = kernel._aico8_create();
assert.notEqual(textRuntime, 0);
const textSource = new TextEncoder().encode(
  "function _init() local s=chr(6) local g=s..':ff818181818181ff' "
  + "print(g,0,0,7) poke(0x5600,8,8,8,0,0,0,4,0) "
  + "poke(0x5680,1,2,4,8,16,32,64,128) print(chr(14)..chr(16)..chr(15),30,0,6) end\n",
);
const textSourcePointer = copyToHeap(textSource);
const textRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(textRuntime, textRomPointer, 0x8000,
    textSourcePointer, textSource.length), 1);
  assert.equal(kernel._aico8_start(textRuntime), 1);
  const textFrame = kernel._aico8_framebuffer(textRuntime);
  assert.equal(kernel.HEAPU8[textFrame], 7, "Wasm must rasterize inline P8SCII pixels");
  assert.equal(kernel.HEAPU8[textFrame + 1 + 128], 0,
    "Wasm inline glyph background must remain transparent by default");
  assert.equal(kernel.HEAPU8[textFrame + 30], 6,
    "Wasm must read custom glyph rows from 0x5600 memory");
  assert.equal(kernel.HEAPU8[textFrame + 37 + 7 * 128], 6,
    "Wasm custom font raster must preserve the eighth row and column");
  assert.equal(kernel._aico8_draw_command_count(textRuntime), 2,
    "Wasm must retain semantic print commands beside indexed pixels");
} finally {
  kernel._aico8_destroy(textRuntime);
  kernel._free(textRomPointer);
  kernel._free(textSourcePointer);
}

const secondaryPaletteRuntime = kernel._aico8_create();
assert.notEqual(secondaryPaletteRuntime, 0);
const secondaryPaletteSource = new TextEncoder().encode(
  "function _init() cls(0) fillp() pal() palt() "
  + "for i=0,15 do pal(i,i+i*16,2) end pal(12,0x87,2) "
  + "sset(0,0,12) sset(1,0,12) fillp(32768.25) spr(0,12,0) "
  + "fillp(32768.125) rectfill(20,0,21,0,12) pal(3,12) rectfill(24,0,25,0,3) end\n",
);
const secondaryPaletteSourcePointer = copyToHeap(secondaryPaletteSource);
const secondaryPaletteRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(secondaryPaletteRuntime,
    secondaryPaletteRomPointer, 0x8000, secondaryPaletteSourcePointer,
    secondaryPaletteSource.length), 1);
  assert.equal(kernel._aico8_start(secondaryPaletteRuntime), 1);
  const secondaryFrame = kernel._aico8_framebuffer(secondaryPaletteRuntime);
  assert.deepEqual(Array.from(kernel.HEAPU8.slice(secondaryFrame + 12, secondaryFrame + 14)),
    [8, 7], "Wasm sprite raster must apply the secondary palette after the draw palette");
  assert.deepEqual(Array.from(kernel.HEAPU8.slice(secondaryFrame + 20, secondaryFrame + 22)),
    [8, 7], "Wasm global fill mode must apply the secondary palette to primitives");
  assert.deepEqual(Array.from(kernel.HEAPU8.slice(secondaryFrame + 24, secondaryFrame + 26)),
    [8, 7], "Wasm must apply the regular draw palette before the secondary palette");
} finally {
  kernel._aico8_destroy(secondaryPaletteRuntime);
  kernel._free(secondaryPaletteRomPointer);
  kernel._free(secondaryPaletteSourcePointer);
}

const embeddedFillRuntime = kernel._aico8_create();
assert.notEqual(embeddedFillRuntime, 0);
const embeddedFillSource = new TextEncoder().encode(
  "function _init() pal() fillp() cls(0) poke(0x5f34,1) "
  + "rectfill(0,10,3,13,0x104e.abcd) fillp() cls(1) "
  + "clip(0,20,8,8) poke(0x5f34,2) circfill(3,23,1,0x1808.0000) "
  + "clip() poke(0x5f34,1) rectfill(0,10,3,13,0x104e.abcd) end\n",
);
const embeddedFillSourcePointer = copyToHeap(embeddedFillSource);
const embeddedFillRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(embeddedFillRuntime, embeddedFillRomPointer, 0x8000,
    embeddedFillSourcePointer, embeddedFillSource.length), 1);
  assert.equal(kernel._aico8_start(embeddedFillRuntime), 1);
  const embeddedFrame = kernel._aico8_framebuffer(embeddedFillRuntime);
  assert.deepEqual(Array.from(kernel.HEAPU8.slice(
    embeddedFrame + 10 * 128, embeddedFrame + 10 * 128 + 4)), [4, 4, 14, 14],
    "Wasm must install and rasterize an embedded colour-argument fill pattern");
  assert.equal(kernel.HEAPU8[embeddedFrame + 20 * 128], 8,
    "Wasm inverted fills must draw the clipped complement");
  assert.equal(kernel.HEAPU8[embeddedFrame + 23 * 128 + 3], 1,
    "Wasm inverted fills must preserve the circle interior");
  assert.equal(kernel.HEAPU8[embeddedFrame + 20 * 128 + 8], 1,
    "Wasm inverted fills must not escape the clip");
} finally {
  kernel._aico8_destroy(embeddedFillRuntime);
  kernel._free(embeddedFillRomPointer);
  kernel._free(embeddedFillSourcePointer);
}

const rasterRegisterRuntime = kernel._aico8_create();
assert.notEqual(rasterRegisterRuntime, 0);
const rasterRegisterSource = new TextEncoder().encode(`
function _init()
 sset(0,0,7) mset(0,0,0) cls(6)
 map(0,0,0,0,1,1) skipped=pget(0,0)
 poke(0x5f36,8) map(0,0,0,0,1,1) drawn=pget(0,0)
 poke(0x5f59,9) poke(0x5f5a,10) poke(0x5f5b,11) poke(0x5f36,0x18)
 sget_oob=sget(-1,0) mget_oob=mget(-1,0) pget_oob=pget(-1,0)
 pal(7,143,1)
end
`);
const rasterRegisterSourcePointer = copyToHeap(rasterRegisterSource);
const rasterRegisterRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(rasterRegisterRuntime, rasterRegisterRomPointer, 0x8000,
    rasterRegisterSourcePointer, rasterRegisterSource.length), 1);
  assert.equal(kernel._aico8_start(rasterRegisterRuntime), 1);
  const valuePointer = kernel._malloc(4);
  const palettePointer = kernel._malloc(32);
  const names = Object.fromEntries(["skipped", "drawn", "sget_oob", "mget_oob", "pget_oob"]
    .map((name) => [name, copyToHeap(new TextEncoder().encode(`${name}\0`))]));
  try {
    for (const [name, expected] of Object.entries({
      skipped: 6,
      drawn: 7,
      sget_oob: 9,
      mget_oob: 10,
      pget_oob: 11,
    })) {
      assert.equal(kernel._aico8_get_global_raw(rasterRegisterRuntime, names[name], valuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), expected << 16);
    }
    assert.equal(kernel._aico8_copy_palette_state(rasterRegisterRuntime, palettePointer, 32), 32);
    assert.equal(kernel.HEAPU8[palettePointer + 16 + 7], 143,
      "Wasm hosts must preserve extended display-palette indices");
  } finally {
    for (const pointer of Object.values(names)) kernel._free(pointer);
    kernel._free(palettePointer);
    kernel._free(valuePointer);
  }
} finally {
  kernel._aico8_destroy(rasterRegisterRuntime);
  kernel._free(rasterRegisterRomPointer);
  kernel._free(rasterRegisterSourcePointer);
}

const curvedPrimitiveRuntime = kernel._aico8_create();
assert.notEqual(curvedPrimitiveRuntime, 0);
const curvedPrimitiveSource = new TextEncoder().encode(`
function _init()
 cls(0)
 oval(10,10,14,12,8) oval_top=pget(12,10)
 ovalfill(20,20,26,24,9) oval_center=pget(23,22)
 rrectfill(30,30,6,4,2,10) rounded_corner=pget(30,30) rounded_top=pget(31,30)
 rrect(40,30,6,4,99,11) outline_side=pget(40,31) outline_center=pget(42,31)
 poke(0x5f34,3) cls(1) clip(0,0,8,8)
 ovalfill(2,2,5,5,0x1808.0000)
 inverted_inside=pget(3,3) inverted_outside=pget(0,0)
end
`);
const curvedPrimitiveSourcePointer = copyToHeap(curvedPrimitiveSource);
const curvedPrimitiveRomPointer = copyToHeap(new Uint8Array(0x8000));
try {
  assert.equal(kernel._aico8_load_cart(curvedPrimitiveRuntime, curvedPrimitiveRomPointer, 0x8000,
    curvedPrimitiveSourcePointer, curvedPrimitiveSource.length), 1);
  assert.equal(kernel._aico8_start(curvedPrimitiveRuntime), 1);
  const valuePointer = kernel._malloc(4);
  const expectedGlobals = {
    oval_top: 8,
    oval_center: 9,
    rounded_corner: 0,
    rounded_top: 10,
    outline_side: 11,
    outline_center: 0,
    inverted_inside: 1,
    inverted_outside: 8,
  };
  const names = Object.fromEntries(Object.keys(expectedGlobals)
    .map((name) => [name, copyToHeap(new TextEncoder().encode(`${name}\0`))]));
  try {
    for (const [name, expected] of Object.entries(expectedGlobals)) {
      assert.equal(kernel._aico8_get_global_raw(curvedPrimitiveRuntime, names[name], valuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), expected << 16);
    }
  } finally {
    for (const pointer of Object.values(names)) kernel._free(pointer);
    kernel._free(valuePointer);
  }
} finally {
  kernel._aico8_destroy(curvedPrimitiveRuntime);
  kernel._free(curvedPrimitiveRomPointer);
  kernel._free(curvedPrimitiveSourcePointer);
}

const audioStatRuntime = kernel._aico8_create();
assert.notEqual(audioStatRuntime, 0);
const audioStatSource = new TextEncoder().encode(
  "function _init() pattern_before=stat(24) before=stat(57) music(0) "
  + "pattern_legacy=stat(24) pattern_current=stat(54) during=stat(57) "
  + "music(-1) pattern_after=stat(54) after=stat(57) end\n",
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
  const patternBeforePointer = copyToHeap(new TextEncoder().encode("pattern_before\0"));
  const patternLegacyPointer = copyToHeap(new TextEncoder().encode("pattern_legacy\0"));
  const patternCurrentPointer = copyToHeap(new TextEncoder().encode("pattern_current\0"));
  const patternAfterPointer = copyToHeap(new TextEncoder().encode("pattern_after\0"));
  try {
    for (const [namePointer, expected] of [[beforePointer, 0], [duringPointer, 1], [afterPointer, 0]]) {
      assert.equal(kernel._aico8_get_global_boolean(audioStatRuntime, namePointer, valuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), expected);
    }
    for (const [namePointer, expected] of [
      [patternBeforePointer, -65536],
      [patternLegacyPointer, 0],
      [patternCurrentPointer, 0],
      [patternAfterPointer, -65536],
    ]) {
      assert.equal(kernel._aico8_get_global_raw(audioStatRuntime, namePointer, valuePointer), 1);
      assert.equal(new DataView(kernel.HEAPU8.buffer).getInt32(valuePointer, true), expected);
    }
  } finally {
    kernel._free(patternAfterPointer);
    kernel._free(patternCurrentPointer);
    kernel._free(patternLegacyPointer);
    kernel._free(patternBeforePointer);
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
    "unqualified tick-history selectors must remain fail-closed in Wasm");
  assert.match(kernel.UTF8ToString(kernel._aico8_last_error(tickHistoryRuntime)),
    /audio selector 46 is not conformance-qualified/);
} finally {
  kernel._aico8_destroy(tickHistoryRuntime);
  kernel._free(tickHistoryRomPointer);
  kernel._free(tickHistorySourcePointer);
}

const digest = createHash("sha256").update(Buffer.from(wasmCheckpoint, "hex")).digest("hex").slice(0, 12);
process.stdout.write(`p8 Wasm identity: ok (${wasmCheckpoint.length / 2} bytes, sha256 ${digest})\n`);
