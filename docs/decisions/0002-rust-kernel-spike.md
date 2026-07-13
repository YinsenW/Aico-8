# ADR 0002: Evaluate a Rust compatibility kernel before C++ expansion

- Status: proposed; ADR 0001 remains authoritative until the proof gates pass
- Date: 2026-07-13
- Scope: compatibility kernel, z8lua boundary, WebAssembly, and ESP32-P4

## Trigger

The default GitHub branch currently reports mostly Python and C++ because the
TypeScript product PR is not merged and is still small. The intended long-term
maintenance languages are TypeScript and, if its cross-platform proof succeeds,
Rust. Language percentages are byte counts, not an architecture decision, but
they exposed a real risk: transitional Python tools and the early C++ kernel
could become permanent through inertia.

## Current evidence

- TypeScript remains the best fit for Web/PWA, PixiJS, mobile, product Jobs,
  manifests, asset tooling, accessibility, and the future orchestration CLI.
- Rust provides memory safety, deterministic data ownership, a browser Wasm
  target, and `no_std`/embedded options. The official `esp-hal` supports ESP32-P4.
- The current PICO Lua path uses pinned z8lua C sources. Rust's simplest browser
  target, `wasm32-unknown-unknown`, does not provide a normal C/C++ toolchain;
  official Rust guidance recommends Emscripten or WASI for mixed-language builds.
- Replacing z8lua before its PICO fixed-point and syntax behavior is understood
  would combine a VM rewrite with a kernel rewrite and erase useful evidence.

## Candidate boundary

The candidate is TypeScript for every product/tool layer, Rust for memory,
scheduler, input, raster, audio, replay, and the stable C ABI, with z8lua retained
temporarily as a pinned C dependency behind one narrow adapter. Python remains
research-only and migrates Job-by-Job after schemas and parity tests exist.

Pure TypeScript is not a kernel candidate because ESP32-class targets would need
a JavaScript engine and the browser/embedded paths would no longer execute the
same runtime. A Rust port is accepted only if it keeps one compatibility truth,
not parallel Rust and C++ implementations.

## Required spike

Before accepting this ADR, one disposable branch must prove all of the following:

1. A Rust-owned 64 KiB state and fixed-point checkpoint pass the native replay.
2. The pinned z8lua C library links through a small Rust adapter natively.
3. The same Rust+C revision builds to browser Wasm and boots the public synthetic cart.
4. Native and Wasm checkpoint bytes are identical.
5. The kernel builds for ESP32-P4 using either `no_std` plus C support or the
   supported ESP-IDF Rust target, without a second runtime implementation.
6. Binary size, build time, boundary-copy cost, sanitizer/Miri coverage, and
   maintenance complexity are recorded against the current C++/Emscripten path.

If any target needs a different simulation implementation, or mixed Rust+C Wasm
linking materially delays the first playable release, ADR 0001 remains selected.
If every gate passes, a new accepted ADR will supersede 0001 and the C++ kernel
will be replaced in bounded replay-preserving slices.

## Interim rules

- New product and pipeline production code is TypeScript.
- New Python is limited to `tools/` research/migration utilities and test harnesses.
- C++ remains limited to `runtime/core/`; it cannot spread into product or tooling.
- Vendored sources are marked as vendored for GitHub language statistics.
- No language migration may invalidate existing replay/checkpoint evidence.

## Primary references

- [Rust `wasm32-unknown-unknown` support and C interop guidance](https://doc.rust-lang.org/stable/rustc/platform-support/wasm32-unknown-unknown.html)
- [esp-hal supported devices, including ESP32-P4](https://github.com/esp-rs/esp-hal)
- [Rust platform support](https://doc.rust-lang.org/nightly/rustc/platform-support.html)
