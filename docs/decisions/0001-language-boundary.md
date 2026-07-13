# ADR 0001: TypeScript product layer with a portable compatibility kernel

- Status: accepted, with proof gates
- Date: 2026-07-13
- Scope: runtime, browser, mobile, embedded, tools, and future Skill

## Context

Aico 8 must feel native in browsers and mobile applications, preserve PICO-8
behavior exactly enough for differential replay, and remain capable of running
on constrained ESP32-class hardware. No single language is the best fit for all
three environments.

TypeScript has the strongest fit for the user-facing product: browser APIs,
PixiJS/WebGL/WebGPU, PWA and Capacitor integration, asset tooling, live reload,
accessibility, localization, and the future orchestration CLI. TypeScript is a
static type checker for JavaScript, so its runtime remains JavaScript and an
embedded target would still require a JavaScript engine.

C++ has the strongest fit for the small deterministic kernel already integrating
the pinned z8lua VM. ESP-IDF officially supports C++, and Emscripten compiles the
same C/C++ sources to WebAssembly with a JavaScript call boundary.

Rust was considered for memory safety and WebAssembly support. It is not selected
for the first kernel because it would add a Rust/C++ VM boundary, a second embedded
toolchain, and a kernel rewrite before the compatibility behavior is understood.
The public C ABI intentionally keeps a later Rust replacement possible.

## Decision

Aico 8 is a **TypeScript-first product with a small C++ compatibility kernel**.
C++ is not the application framework and does not own the HD presentation.

| Layer | Selected technology | Responsibility |
| --- | --- | --- |
| Web and PWA | TypeScript + PixiJS | 1024 presentation, assets, input, UI, accessibility, diagnostics |
| Mobile | TypeScript web app + Capacitor | iOS/Android packaging, lifecycle, native plugins, stores |
| Product CLI | Node.js + TypeScript | ingest orchestration, manifests, analysis, validation, packaging |
| Compatibility kernel | freestanding-friendly C++ with a C ABI | P8 Lua, RAM, fixed-step timing, reference raster, audio synthesis, replay |
| Browser kernel artifact | WebAssembly via Emscripten | exact same kernel behavior callable from TypeScript |
| Embedded host | ESP-IDF C/C++ | LCD/audio/input/storage adapters around the native kernel |
| Research scripts | Python, transitional | experiments that migrate behind versioned TypeScript CLI commands |
| Future Skill | thin declarative orchestration | invoke the tested CLI; never replace runtime behavior with prompts |

The 1024 renderer consumes semantic commands and state snapshots from the kernel.
It may interpolate presentation transforms, but cannot mutate authoritative game
state. Unknown or highly dynamic drawing falls back to the kernel's 128×128
indexed framebuffer, uploaded as a texture and scaled exactly 8×.

The browser starts with single-threaded WebAssembly called synchronously from a
fixed-step TypeScript scheduler. This minimizes input latency and avoids requiring
cross-origin isolation. Moving the kernel to a Worker is a measured optimization,
not an architectural assumption.

## Boundary rules

1. The kernel exposes only a versioned C ABI and flat byte buffers. It has no DOM,
   PixiJS, Capacitor, filesystem UI, store SDK, or generated-asset dependency.
2. TypeScript never reimplements PICO fixed-point arithmetic, VM state, collision,
   input repeat, reference raster rules, or audio synthesis.
3. C++ never decides how a recognized sprite/entity should look in the HD remake.
4. The TypeScript scheduler requests 30/60 Hz logical updates; display refresh and
   PixiJS interpolation do not change the number or order of kernel updates.
5. Native and WebAssembly builds consume the same replay fixtures and must produce
   byte-identical state, framebuffer, audio, and semantic-command checkpoints.
6. Python tools are prototypes until their behavior is covered by manifests and
   exposed through the TypeScript product CLI.

## Proof gates

This decision remains provisional until all gates pass:

- Build the kernel natively and with Emscripten from the same source revision.
- Run the public conformance suite in both builds and compare checkpoint hashes.
- Boot the authorized representative cart in the browser without translated game logic.
- Render the compatibility framebuffer and 1024 semantic layer in one PixiJS scene.
- Measure update, render, memory, startup, and input-to-photon latency on desktop
  and mid-range mobile hardware before choosing Worker or threading options.
- Build the native kernel as an ESP-IDF component before committing to a board SKU.

If the WebAssembly boundary cannot meet these gates, first reduce boundary traffic
and batch commands. Reconsider Rust only if memory-safety defects, C++ portability,
or maintenance cost remains material after the ABI is stable.

## Consequences

- Browser and mobile development remain idiomatic TypeScript.
- The exact PICO behavior is implemented once rather than separately in JS and firmware.
- WebAssembly becomes a tested deliverable, not a claim of portability.
- The project accepts a narrow two-language boundary and must continuously test it.
- Product CLI migration is explicit; existing Python research is not mistaken for
  the final public toolchain.

## Primary references

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Emscripten: Building to WebAssembly](https://emscripten.org/docs/compiling/WebAssembly.html)
- [Emscripten: Connecting C++ and JavaScript](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/index.html)
- [PixiJS v8 introduction](https://pixijs.com/8.x/guides/getting-started/intro)
- [Capacitor documentation](https://capacitorjs.com/docs)
- [ESP-IDF C++ support for ESP32-P4](https://docs.espressif.com/projects/esp-idf/en/stable/esp32p4/api-guides/cplusplus.html)
