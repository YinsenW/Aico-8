# Rust compatibility-kernel proof record

## Scope

This is executable evidence for proposed ADR 0002, not a language-selection
decision. The proof uses Rust 1.97.0, one public synthetic input trace, the pinned
z8lua sources, browser-loadable `wasm32-unknown-unknown`, and the generic
`riscv32imafc-unknown-none-elf` target relevant to ESP32-P4 CPU code.

## Passing evidence

- Rust owns a fixed 64 KiB state, update step, observable RAM registers, and
  deterministic 32-byte checkpoint.
- Two native runs of the public trace produce checkpoint
  `db36fa0801caf75b382e62f1f57293a5a9da98c4510a72f94e958a86f41810c9`.
- A narrow C++ bridge links Rust to the existing C++-compiled z8lua pin; Rust
  creates a VM, evaluates the synthetic expression `6*7`, observes 42, and closes it.
- The Rust library builds as browser Wasm with no JavaScript runtime dependency;
  Node instantiates it and produces the exact native checkpoint bytes.
- The state kernel builds as `no_std` RISC-V code for
  `riscv32imafc-unknown-none-elf` without a second implementation.

`TEST-RUST-SPIKE` reproduces these statements in public CI.

## Unmet gates

- z8lua is not yet linked into the browser Wasm artifact. Official Rust guidance
  confirms that `wasm32-unknown-unknown` has no normal C/C++ toolchain, so the
  mixed VM path needs Emscripten/WASI or a separately justified replacement.
- The RISC-V build proves portable `no_std` Rust only; it does not yet link z8lua,
  ESP-IDF, or `esp-hal`, boot on ESP32-P4 hardware, or exercise LCD/audio/input.
- The Wasm proof does not yet boot a synthetic P8 cart, render a frame, or compare
  the existing C++ compatibility checkpoint.
- Binary size, build time, boundary-copy cost, sanitizers/Miri, and maintenance
  cost have not yet been compared with C++/Emscripten.

Therefore ADR 0001 remains authoritative and no production kernel migration is authorized.
