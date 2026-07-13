# Aico 8 architecture

## Product boundary

Aico 8 is a monorepo for the complete remake lifecycle, not a source translator
and not a single emulator. It preserves an authoritative compatibility path and
adds a separate HD presentation path that can be enabled incrementally.

The product is TypeScript-first. C++ is restricted to a small deterministic
kernel compiled both natively and to WebAssembly. The reasoning and proof gates
are recorded in `docs/decisions/0001-language-boundary.md`.

The future Skill is intentionally outside the trust boundary of simulation. It
may select carts, run analysis, propose mappings, generate assets, and launch
tests, but only versioned tools and deterministic runtime code decide whether a
remake is compatible.

## Layers

### 1. Ingest and provenance

- Accept `.p8`, `.p8.png`, and raw ROM inputs; later add official export bundles.
- Decode code, GFX, shared GFX/map aliases, flags, SFX, music, label, metadata,
  raw version, and hashes without normalization loss.
- Record authorship, source URL, declared license, contributors, and release permission.
- Refuse publishing operations when provenance is incomplete.

Output: a private, versioned cart workspace with a lossless rebuild manifest.

### 2. Static and dynamic analysis

- Parse P8 Lua and inventory APIs, memory access, callbacks, host integration,
  direct raster writes, palette effects, audio mutation, and persistence.
- Classify gameplay state, entities, tiles, collision, UI, particles, and audio cues.
- Generate deterministic input replays and state serializers.
- Use official PICO-8 captures as the primary behavioral oracle; independent
  runtimes are secondary diagnostics only.

Output: a compatibility report, semantic model, replay suite, and remake risk map.

### 3. Portable compatibility core

- C++17 implementation exposed through a small C ABI.
- 64 KiB RAM, 32 KiB ROM, aliases, remapping, dirty tracking, and P8 Lua VM.
- Fixed 30/60 Hz simulation, original input repeat, persistence, and host contracts.
- Reference 128×128 indexed rasterizer and four-channel PICO audio synth.
- No DOM/browser API, platform UI, store SDK, asset-generation policy, or
  presentation-specific gameplay logic.

The current graphics semantics baseline and its explicit compatibility gaps are
recorded in `docs/reference/pico8-graphics-semantics.md`.

The same core targets native platforms, WebAssembly, and ESP-IDF.

### 4. Semantic bridge

Every graphics/audio/host call is recorded with original fixed-point arguments,
payloads, and the relevant state revision. A game adapter can recognize stable
roles such as player, wall, collectible, UI label, or particle. Unknown calls,
dynamic memory, and palette tricks remain visible through the compatibility path.

HD replacement is presentation-only: it cannot mutate Lua state, compatibility
RAM, collision, RNG, cartdata, or update cadence.

### 5. Text and typography

Text has two deliberately separate paths:

- The C++ compatibility core parses raw P8SCII bytes, applies cursor and draw
  state, executes control-code side effects, reads built-in/custom font memory,
  computes the original `print()` result, and can rasterize the exact fallback.
- The TypeScript presentation consumes a versioned semantic text run. It may map
  only safe visual spans to Unicode, a semantic role, and a typography manifest
  entry; it never feeds modern font measurements back to the core.

Release builds bundle fixed, hashed, licensed fonts instead of depending on OS
font stacks. Curated Latin/game UI uses MSDF/SDF bitmap atlases where practical;
large CJK/localization coverage uses bundled WOFF2 canvas text with deterministic
layout constraints. Inline P8SCII glyphs, cart-defined fonts, ambiguous symbols,
and effectful controls use reference raster fallback unless an author-approved
mapping preserves meaning. The complete policy is owned by
`specs/typography.md`.

### 6. 1024×1024 reference presentation

- Native 1024×1024 output, using 64×64 pixels per logical 8×8 tile.
- TypeScript/PixiJS implementation; WebGL baseline and optional WebGPU.
- Vector/responsive UI, modern animation, particles, lighting, accessibility,
  touch input, localization, and diagnostic overlays.
- Reference framebuffer available as an overlay and automatic fallback.
- 720×720 and device-native outputs are delivery profiles derived from the
  canonical 1024 design space; they never alter simulation coordinates.

The detailed mapping is defined in `specs/display-1024.md` and
`specs/display-profiles.json`.

### 7. Packaging and platform hosts

- Web/PWA: Emscripten WebAssembly kernel plus TypeScript presentation and product shell.
- iOS/Android: Capacitor shell using the same WASM/core and responsive profiles.
- Desktop: web shell initially, with a native host only when platform needs justify it.
- ESP32-P4: ESP-IDF C++ host, native core, fixed-memory asset packs, LCD/audio/input adapters.

### 8. Validation and release

- State diffs for every logical update in representative replays.
- Raster checkpoint diffs and semantic-command diffs.
- Audio status and rendered waveform comparisons.
- HD-on/HD-off invariance checks for simulation state.
- Fresh-clone builds for every supported platform profile.
- Permission, attribution, notices, privacy, accessibility, and store-policy gates.

## Stable contracts

The core, presentation, pipeline, and future Skill communicate through versioned
contracts rather than shared implementation details:

- cart workspace manifest;
- compatibility/risk report;
- replay and state-snapshot format;
- semantic draw/audio command schema;
- semantic text-run and typography-manifest schemas;
- HD mapping manifest and asset pack;
- display and platform profiles;
- validation report and release manifest.

These contracts make it possible to improve the AI orchestration without
silently changing game behavior.

Native and WebAssembly kernels must run the same replay suite and produce
byte-identical compatibility checkpoints. Web availability is a CI-tested
artifact, not an assumption based on C++ portability.

## Repository policy

User carts and extracted assets live under ignored `private/`, `pico8_carts/`,
or `workspaces/` directories. Public fixtures must be original synthetic carts,
officially redistributable samples, or content with explicit repository permission.
