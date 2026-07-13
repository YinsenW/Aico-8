# Provisional technical selection (superseded)

Status: historical research. The accepted current boundary is owned by
`docs/decisions/0001-language-boundary.md`; this file preserves prior evidence
and must not be used as current project status.

This is a test-driven draft, not the final lock-in. It becomes final only after
official-runtime goldens and at least one representative cart have completed an
end-to-end remake and release trial.

## Decision

Use a **portable C++ compatibility core with a C ABI**, compile that core to
WebAssembly for web/mobile, and use TypeScript plus PixiJS for the modern
presentation layer. Package the web application for iOS and Android with
Capacitor. Provide a separate ESP-IDF presentation/host adapter for ESP32-P4,
while sharing the exact same simulation, memory, Lua, input, and audio core.

TypeScript is therefore important, but it is not the canonical simulation
language. A TypeScript-only core would create a second implementation when the
embedded target arrives, which would make feel and timing drift likely.

## Why this shape fits the evidence

| Criterion | TS-only | Rust core + TS | C++ core + TS | C++ all-native |
| --- | ---: | ---: | ---: | ---: |
| PICO numeric/Lua fidelity | 2/5 | 5/5 | 5/5 | 5/5 |
| Web/mobile portability | 4/5 | 4/5 | 5/5 | 4/5 |
| ESP32-P4 path | 1/5 | 2/5 | 5/5 | 5/5 |
| Modern 2D presentation | 5/5 | 5/5 | 5/5 | 3/5 |
| Early iteration speed | 5/5 | 3/5 | 3/5 | 2/5 |

The ESP32-P4 choice materially changes the answer. ESP-IDF is the official
framework and supports C++ directly, while current Espressif Rust documentation
does not yet list the P-series among the supported `esp-rs` SoC families. A
portable C/C++ codebase can also be compiled to WebAssembly with Emscripten and
called from JavaScript. Relevant primary documentation:

- [ESP-IDF C++ support for ESP32-P4](https://docs.espressif.com/projects/esp-idf/en/stable/esp32p4/api-guides/cplusplus.html)
- [ESP32-P4 ESP-IDF guide](https://docs.espressif.com/projects/esp-idf/en/stable/esp32p4/index.html)
- [Rust on ESP hardware overview](https://docs.espressif.com/projects/rust/book/introduction/hardware-overview.html)
- [Emscripten C++/JavaScript integration](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/index.html)
- [Capacitor cross-platform runtime](https://capacitorjs.com/docs)
- [PixiJS v8 application/renderers](https://pixijs.com/8.x/guides/components/application)

## Runtime boundaries

### 1. Deterministic compatibility core (C/C++)

- P8 Lua parser/VM with signed 16:16 numbers and PICO syntax.
- 64 KiB compatibility RAM, 32 KiB cart ROM, aliases, remapping, and dirty tracking.
- Fixed 30/60 Hz scheduler; input recorded per logical update.
- Complete draw state and a reference 128×128 indexed rasterizer.
- One four-channel PICO audio synth used both in real time and for offline WAV/OGG rendering.
- Cartdata, multi-cart, and host service interfaces behind a small C ABI.
- No platform UI, store SDK, filesystem policy, or high-resolution asset knowledge in this layer.

`z8lua` is the leading VM starting candidate because it implements PICO syntax,
fixed-point arithmetic, and embedded targets. It is not accepted wholesale: its
own README excludes stateful PICO APIs and notes a non-bit-exact power operator.
It must be pinned, licensed component-by-component, and pass every language and
numeric golden before adoption.

Current audit status: the clean `pico8` branch is pinned and vendored
experimentally. Unmodified upstream passes 8/8 numeric and 17/18 language
checks with host API shims; the local `tonum` correction raises that set to
26/26. It still compiles only 273/291 corpus carts, so three parser-extension
families remain general-release blockers. Details are in
`z8lua_adoption_audit.md`.

The first native core bootstrap now exists under `runtime/core`. Its tests cover
ROM/RAM initialization, GFX/screen/map remapping, shared map aliasing, dirty
tracking, controller repeat, 30/60 Hz scheduling, and a semantic draw-command
envelope with text payloads. A private representative-cart replay has exercised
unchanged Lua boot, shared-map access, state transitions, and deterministic input;
the cart-specific evidence remains in the private research archive.

### 2. Semantic render stream

Every PICO draw call produces a compact command containing its original
arguments and the relevant draw-state snapshot. The compatibility rasterizer
still executes it, while a game-specific presentation adapter may replace a
recognized sprite, tile, character, particle, or UI element with a modern asset.

Direct `poke`, dynamic sprites, palette tricks, and `tline` cannot safely be
converted to static art. Memory dirty tracking therefore decides when the HD
adapter is allowed to replace a command and when it must show the authoritative
compatibility raster or a generated texture.

### 3. Web/mobile presentation (TypeScript)

- PixiJS v8, preferring WebGL initially; WebGPU remains an optional later path.
- Fixed-step simulation driven by the WASM core, independent of Pixi's visual ticker.
- Asset atlases, skeletal/particle effects, camera, accessibility, touch mapping,
  responsive UI, localization, and platform services.
- Capacitor v8 wrappers for iOS and Android; the browser/PWA build remains the
  fastest test and distribution target.

### 4. Embedded presentation (ESP-IDF/C++)

- Same core library, cart workspace, semantic command schema, and packed asset metadata.
- ESP-IDF LCD, audio, storage, controller, and lifecycle adapters.
- Direct atlas/blit renderer sized to the selected panel and PSRAM budget; no JS VM.
- ESP32-P4 is the realistic first hardware baseline because official support
  includes display interfaces and boards with external/in-package memory options.
  Classic ESP32 remains a later constrained profile, not the feature baseline.

## Audio policy

Do not redesign the soundtrack by default. Preserve raw notes, instruments,
effects, filters, loops, and music-flow bytes. Use one compatible synth in all
targets; an offline exporter calls the same synth to produce WAV/OGG when a
platform benefits from streamed audio. Official PICO-8 `EXPORT FOO%D.WAV` and
frame-accurate audio recordings become the reference goldens once the licensed
runtime is available.

## Rejected shortcuts

- Mechanical Lua-to-TypeScript translation as the primary path: it loses
  fixed-point, memory aliasing, coroutine, and draw-state behavior.
- Static sprite/map extraction as the whole renderer: 204 of 291 carts write
  memory and many mutate map/GFX data dynamically.
- Reusing `p8rt_ios.wasm`: its license and iOS-only restrictions do not fit this product.
- Treating any third-party emulator as the oracle: current differential tests
  already demonstrate material gaps.

## Final lock-in gates

1. Official PICO-8 passes or supplies approved goldens for numeric, language,
   advanced raster, input, P8SCII, audio, and persistence probes.
2. The C++/WASM core reproduces those traces.
3. One normal cart and one memory-heavy cart pass recorded-input state/frame diffs.
4. One cart ships as web/PWA and a Capacitor device build.
5. The same core boots a representative cart on an ESP32-P4 development board.

Only after these gates and several remake iterations should the workflow be
compressed into the final Codex Skill.
