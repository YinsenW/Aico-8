# Aico 8 architecture

## Product boundary

Aico 8 is a monorepo for the complete remake lifecycle, not a source translator or single emulator. It preserves an authoritative compatibility path and
adds a separate HD presentation path that can be enabled incrementally.

The product is TypeScript-first. C++ is restricted to a small deterministic
kernel compiled both natively and to WebAssembly. The reasoning and proof gates
are recorded in `docs/decisions/0001-language-boundary.md`.

Delivery is internally modular and externally standalone. ADR 0003 owns the
decision to ship a statically bound single game first, add fixed collections
after multi-game proof, and defer a public external-cart Player and `.aico8`.

The future Skill is intentionally outside the trust boundary of simulation. It
may select carts, run analysis, propose mappings, generate assets, and launch
tests, but only versioned tools and deterministic runtime code decide whether a
remake is compatible.

## Delivery topology

- An internal game module contains one remake's compatible payload, HD mapping,
  assets, typography/audio manifests, save namespace, provenance, and evidence.
- A single-game build statically binds one validated module to the shared runtime.
- A fixed collection binds several validated modules plus a launcher; switching
  games resets runtime state and saves remain isolated by module and schema version.
- Internal modules are build inputs, not a promised public cartridge format.
- Multi-cart requests create an immutable batch manifest and isolated per-game
  Job graphs. Assembly consumes only modules whose required exits pass.
- Browser Web/PWA is the release-critical host. Android and Linux handhelds reuse
  that TypeScript host and Wasm kernel; ESP32 remains a separate future native
  host behind the same contracts. None can delay the first complete Web remake.

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
dynamic memory, and palette tricks remain inspectable in the separate
compatibility/reference mode and block HD acceptance until explicitly modeled.

HD replacement is presentation-only: it cannot mutate Lua state, compatibility
RAM, collision, RNG, cartdata, or update cadence.

Each game owns a declarative identity map from original tile/sprite/text/effect
evidence to semantic role; invariant silhouette, anatomy/key parts, proportions,
face/expression, color hierarchy, footprint, motion, and gameplay cues; allowed
modernization dimensions; replacement asset; animation; layer; and diagnostic
reference correspondence. A compact shared renderer interprets this data; new
games do not earn arbitrary simulation branches in the HD layer. Generated art is accepted only as an authoring candidate, then reviewed, normalized, hashed, and frozen in the asset pack. No model is called at runtime, and changing model quality cannot change an accepted build.
The pipeline enforces the product's ordered gates: identity/replay evidence protects Spirit fidelity, surface lineage proves Quality leap, and the frozen visual grammar plus human whole-frame review bounds Aesthetic evolution; a later gate cannot waive an earlier failure.

The source-relative semantic redraw standard uses hashed renderer-independent recipes for identity-bearing vectors; constrained SVG is build-only, requires stable IDs/layers/origins, and rejects scripts, links, external resources, transforms, inherited styles, and unsupported paths. It has two mandatory layers: an identity scaffold and an HD surface. Distinctive wordmarks and hand-drawn glyphs bind exact downsampled masks, component/hole topology, and sub-half-source-pixel displacement; topology-constrained splines then remove source-cell stair steps without changing any source cell centre. Indexed tile/sprite variants preserve each palette/material layer and boundary edge, while structurally distinct variants receive distinct frozen recipes. The HD surface lineage binds the real target primitives and requires continuous curve commands, visible shade/base/highlight treatment, and deterministic 2x edge supersampling. Passing the scaffold alone never qualifies enlarged pixel geometry as a remake.
Web compiles recipes to shared Pixi contexts; protected negative spaces use explicit cut primitives, and the compiler assigns each cut to its containing component when one fill has disconnected shapes instead of relying on renderer winding defaults. Repeated actors share one geometry template with explicit layers and palette tokens, while future hosts may produce native geometry or raster atlases.
Regular geometry/effects stay procedural, text uses the typography path, and texture-rich art may use frozen raster atlases.
Identity traits are evidence-derived per element, not a global style checklist; validation rejects source-relative drift without preferring any universal face, anatomy, or design vocabulary.

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
and effectful controls require an author-approved modern mapping that preserves
meaning; otherwise the scene is diagnostic-only and the game cannot pass HD.
Every rendered copy string additionally declares source-authored, state-derived
accessibility, or supplemental-authorized provenance; visual polish alone cannot
authorize new marketing, narrative, instruction, or celebration copy.
The complete policy is owned by
`specs/typography.md`.

### 6. Audio preservation

- The kernel remains the reference four-channel synth and handles dynamic pitch,
  speed, waveform, pattern, and memory changes.
- Static music/SFX may be pre-rendered, preloaded, and substituted only after
  waveform, onset, loop, and duration validation against the reference path.
- Web assets prefer compact delivery codecs while validation retains lossless
  evidence. Embedded profiles may select synth or compressed samples by budget.

### 7. 1024×1024 reference presentation

- Native 1024×1024 output, using 64×64 pixels per logical 8×8 tile.
- TypeScript/PixiJS implementation; WebGL baseline and optional WebGPU.
- Vector/responsive UI, modern animation, particles, lighting, accessibility,
  touch input, localization, and diagnostic overlays.
- A versioned visual grammar fixes palette relationships, materials, silhouette,
  line/shape language, depth, motion curves, effect intensity, and UI hierarchy.
- Acceptance combines semantic coverage, deterministic scene goldens, static
  source/HD identity anchors, exact-update temporal source/HD sequences,
  thumbnail/silhouette recognition, and full-replay legibility; a model judgment
  alone cannot pass fidelity, motion, timing, completeness, or aesthetics.
- Human review consumes a generated packet that hashes its identity map, browser
  record, visual-runtime identity, every displayed screenshot, and review HTML;
  stale or cross-state review material cannot promote an accepted build.
- Review capture is readiness-driven: `captureStatus=ready` requires the rendered boundary, class-hidden/zero-opacity/hidden-visibility loading overlay, two newly presented frames, and a retained exact mode/scene/boundary/viewport record.
- Acceptance is a separate immutable decision over the exact pending packet and
  required statement. The pipeline archives what the human saw, deterministically
  rebuilds the reviewed draft, promotes all element checks atomically, and then
  regenerates the accepted completeness/invariance audit; editing status fields
  or partially passing elements cannot create an accepted build.
- Reference framebuffer available as an explicit diagnostic comparison. An
  unforeseen mapping fault may switch the whole scene atomically to reference
  mode, never individual elements; any such event fails release acceptance.
- Completeness observes scene-contextual tile, sprite, text, command, effect,
  and modern-UI tokens before renderer dispatch. Unknown combinations remain
  explicit failures. Canonical replay may add named reachable-state probes;
  HD-off/on runs compare compatibility hashes after every observed update, and
  deleting an observed mapping must make the audit fail.
- 720×720 and device-native outputs are delivery profiles derived from the
  canonical 1024 design space; they never alter simulation coordinates.

The detailed mapping is defined in `specs/display-1024.md` and
`specs/display-profiles.json`.

### 8. Assembly, packaging, and platform hosts

- Assembly statically binds one game module or a fixed collection to a target profile.
- Browser Web/PWA first: Emscripten WebAssembly kernel, TypeScript presentation,
  portable single-HTML convenience build, and installable/offline PWA release.
- Android next: a Capacitor/WebView shell packages the unchanged Web build as
  APK/AAB and adds only lifecycle, storage, controller, audio-focus, and store adapters.
- Linux handhelds later: use the same browser/PWA artifact first; add a thin Web
  shell only for a measured device gap. Windows, macOS, and iOS are not targets.
- ESP32-P4 is future independent work: ESP-IDF host, native core, fixed-memory
  derived assets, and board adapters, with no browser or JavaScript requirement.

### 9. Validation and release

- Canonical replays execute every original logical update on unchanged cart
  bytes, accept only PICO-8 button masks, and forbid test hooks, state writes,
  level skips, or synthetic completion; wall-clock acceleration may not skip an
  update. Instrumented reachability remains a diagnostic evidence grade.
- The research-only Web validation player may accelerate an accepted replay to
  a declared milestone or exact logical update for source/HD capture only after
  cart and clean initial-persistence hashes match. It is visibly labeled,
  executes every intervening logical input, isolates external persistence writes,
  and may advance deterministic presentation-only time without advancing
  compatibility state. Source/HD pairs bind the same update and presentation-
  time boundary and do not replace the independent completion audit.
- Browser evidence binds two fail-closed identities: the visual-runtime identity
  covers every packaged artifact except the replay payload, while the replay-
  semantics identity covers cart, runtime kind, canonicality, input, milestones,
  checkpoints, and result but excludes producer/source revision metadata. Thus a
  provenance-only replay regeneration does not invalidate unchanged pixels, and
  any visual, cart, input, or completion drift still fails qualification.
- State diffs for every logical update in representative canonical replays.
- Host-input qualification projects the complete canonical one-player trace
  through production keyboard mappings and latch behavior, standard gamepad
  sampling, and visible touch-button mappings. Every surface must emit one
  identical six-bit mask at the original update rate for every logical update;
  a real browser touch path independently proves the visible controls are wired.
- Search-only shadow models are untrusted accelerators. Their transition order
  and state must be differentially checked against the unchanged cart for every
  candidate step before capture; mismatch handling fixes the semantic class and
  adds invariant, regression, and mutation evidence rather than a level branch.
- Raster checkpoint diffs and semantic-command diffs.
- Audio status and rendered waveform comparisons.
- HD-on/HD-off invariance checks for simulation state.
- Qualification keeps per-game replay/evidence isolation and counts a game only
  after every required level, ending, and progression boundary passes. At least
  ten materially different games must cover the declared risk matrix before the
  Jobs or final Skill are treated as stable.
- Batch qualification uses bounded isolated cart/workspace lanes; blocked siblings
  cannot enter assembly, and aggregate status is derived from per-game evidence.
- Fresh-clone builds are required for every supported platform profile; Web release validation binds the target-profile hash, complete artifact manifest,
  visual-runtime identity, real-browser environment, package size, startup time,
  settled frame samples, and an active-browser measurement/screenshot for every target-profile layout class in one fail-closed report; 1024x1024 square handheld
  is a required class, not an inference from a wide viewport.
  Layout qualification rejects viewport overflow, clipped text, controls outside
  the game frame, unloaded bundled fonts, undersized touch targets, or a missing
  safe-area contract. Android and Linux profiles must extend this lineage rather
  than redefine Web gameplay.
- Per-module save isolation, runtime reset, license completeness, and failure containment before any fixed collection passes.
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
- batch, internal game-module, fixed-collection, display, and target profiles;
- target profile, technical validation report, and release manifest.

These contracts make it possible to improve the AI orchestration without
silently changing game behavior.

Native and WebAssembly kernels must run the same replay suite and produce
byte-identical compatibility checkpoints. Web availability is a CI-tested
artifact, not an assumption based on C++ portability.

## Repository policy

User carts and extracted assets live under ignored `private/`, `pico8_carts/`,
or `workspaces/` directories. Public fixtures must be original synthetic carts,
officially redistributable samples, or content with explicit repository permission.
