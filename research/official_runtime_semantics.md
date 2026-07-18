# PICO-8 official runtime semantics baseline

This document is the normative baseline for the remake pipeline. It summarizes the
[PICO-8 v0.2.7 manual](https://www.lexaloffle.com/dl/docs/pico-8_manual.html) and
[official changelog](https://www.lexaloffle.com/dl/docs/pico-8_changelog.txt). Third-party
tools and emulators are useful cross-checks, but they do not override official behavior.

## Source priority

1. Current official manual and changelog.
2. Behavior observed in an official PICO-8 runtime of the cart's version or a compatible newer runtime.
3. Original cart code, ROM data, and captured input/output traces.
4. Independent implementations such as Shrinko8, Zepto8, and FAKE-08.
5. Heuristics and inferred intent, always marked as inference.

## Machine contract

- Display: 128×128 logical pixels with a fixed 16-color base palette.
- Controllers: eight players, six logical buttons each; `btn()` with no arguments exposes a two-player bitfield.
- Cart ROM: 32 KiB. Data occupies `0x0000..0x42ff`; compressed or plain code occupies `0x4300..0x7fff`.
- Base RAM: 64 KiB. Lua RAM is a separate 2 MiB environment for compiled code and variables.
- Code limits: 8,192 tokens, 65,535 source characters, and 15,360 compressed bytes in PNG/ROM carts.
- Virtual CPU: nominal 8 MHz; Lua VM instructions usually cost about two cycles and built-ins also consume budget.
- Audio: four channels, 64 SFX definitions, 64 music patterns, and 32 notes per SFX.

These limits are behavioral, not merely historical. Timing-sensitive carts may rely on CPU fallback,
fixed-point overflow, memory aliasing, and small-address wrapping.

## Execution and frame scheduling

- All code tabs are concatenated and executed in order.
- `_init()` runs once after the program is loaded.
- `_update()` and `_draw()` normally run at 30 Hz.
- Defining `_update60()` instead of `_update()` requests 60 Hz for update and draw, with half the CPU budget per frame.
- If drawing misses its deadline, the runtime can draw at 15/30 Hz while invoking update multiple times so simulation time catches up.
- `time()`/`t()` is derived from update calls, not wall-clock time. Repeated reads during one update return the same value.
- `flip()` controls presentation in a custom main loop. A runtime may also present automatically at frame end.
- `#include` is flattened when a cart is saved as PNG/ROM or exported; it is not a runtime module system.

Remake implication: run simulation on a fixed step and render independently. Never multiply motion by a
variable browser delta unless the original code explicitly models elapsed time.

## P8 Lua numerical semantics

- Every number is signed 16:16 fixed point: approximately `-32768` through `32767.99998`.
- Decimal literals are rounded to the closest representable fixed-point value.
- Arithmetic overflow and underflow are part of behavior. A frame counter incremented once per frame eventually wraps.
- Positive and negative division by zero saturate to the positive or negative fixed-point extrema.
- Integer division uses `\` and behaves like floor division.
- Bitwise operations operate on the complete 32-bit fixed-point representation.
- `cos()` and `sin()` use turns (`0..1`), not radians. `sin()` is inverted for screen coordinates.
- `atan2(dx,dy)` uses the PICO-8 argument order and returns turns in screen-space orientation.
- `sgn(0)` returns `1`.
- The RNG is runtime-defined and seeded automatically; deterministic comparison requires controlled `srand()` state.

Remake implication: JavaScript `number` and ordinary Rust/C floating point are not sufficient for a faithful
logic port. A compatibility path must provide explicit 16:16 operations and conversion boundaries.

## P8 Lua language and data behavior

- Lua tables are mixed key/value maps; array helpers assume contiguous one-based integer indexes.
- `add`, `del`, `deli`, `count`, `all`, `foreach`, and `pairs` have PICO-specific edge behavior.
- Strings are byte strings in P8SCII. String indexing, `sub`, `ord`, `chr`, `split`, and number coercion must remain byte-oriented.
- In v0.2.7, a non-numeric third argument to `sub(value, first, last)` behaves like an omitted end position; it does not request a one-character range.
- PICO shorthand includes single-line `if`/`while`, compound assignments, `!=`, `?` print, binary literals, and custom bit operators.
- Metatables, varargs, and coroutines are supported. Errors inside `coresume()` are returned rather than automatically stopping the cart.
- Most API names are local bindings in current PICO-8 unless `-global_api 1` is used.

## Memory model and aliases

| Address | Meaning |
| --- | --- |
| `0x0000` | Sprite/GFX bytes |
| `0x1000` | GFX bank 2 or map rows 32–63; same physical bytes |
| `0x2000` | Primary map, 128×32 bytes |
| `0x3000` | 256 sprite flag bytes |
| `0x3100` | 64 music patterns, four bytes each |
| `0x3200` | 64 SFX records, 68 bytes each |
| `0x4300` | General user RAM |
| `0x5600` | Optional 2 KiB custom font |
| `0x5e00` | 256 bytes of mapped persistent cart data |
| `0x5f00` | Draw-state registers |
| `0x5f40` | Hardware-state registers |
| `0x5f80` | 128 GPIO bytes |
| `0x6000` | 8 KiB screen framebuffer |
| `0x8000` | Additional user RAM |

- GFX and screen memory store two pixels per byte; the left pixel is the low nibble.
- Map memory stores one byte per cell.
- ROM data is copied to base RAM on load, run, and editor exit unless disabled through a register.
- `peek/poke`, 16/32-bit variants, `memcpy`, `memset`, `reload`, and `cstore` expose the address space directly.
- Multi-byte accesses are little-endian and need not be aligned.
- GFX, screen, and map bases can be remapped through `0x5f54..0x5f57`, including into upper RAM.
- The normal map region is an 8 KiB ring: map pages `0x30..0x3f` mean
  `0x10..0x1f`. Consequently the default `0x20` base reaches the shared
  GFX/map bytes at `0x1000` after the primary map ends at `0x2fff`.
- GFX/screen remapping changes what low-level memory functions address, not only what drawing calls see.
- The code area at and above `0x4300` in cart ROM is protected from `reload`/`cstore` access.

Remake implication: preserve a 64 KiB compatibility memory image even when higher-level objects are also built.
Static asset extraction alone cannot model carts that mutate or remap these regions.

## Draw state and raster semantics

Draw state persists across calls and includes:

- Camera offset.
- Clip rectangle.
- Current color and cursor position.
- Draw palette, display palette, and secondary palette.
- Per-color transparency.
- Fill pattern and related sprite/global/inversion flags.
- Line continuation state and multiple text attributes.

Important behavior:

- `reset()` restores registers `0x5f00..0x5f7f`; `cls()` clears the screen and resets clipping, not every draw-state field.
- Draw-palette mapping occurs as pixels are drawn; display-palette mapping affects the completed framebuffer at presentation.
- `palt()` affects sprite, map, `sspr`, and `tline` transparency.
- `fillp()` is a 4×4 two-color pattern. It may apply to primitives, sprites, or both via secondary-palette mappings.
- Color arguments can embed pattern, transparency, secondary-palette, and inverted-draw control bits.
- `spr` addresses 256 8×8 tiles and supports multi-tile blits and flips.
- `sspr` scales a source rectangle to an independently sized destination rectangle.
- `map()` can filter tiles using sprite-flag masks; tile zero is normally skipped.
- `tline()` samples map/sprite pixels along a line and is affected by precision, mask, offset, palette, transparency, and map-base registers.
- Pixel and map reads outside bounds normally return zero, but registers can select a custom return value.

Remake implication: create two rendering paths. Semantic replacement maps known sprites, tiles, UI, and effects
to modern assets. A compatibility raster path remains available for direct framebuffer writes, dynamic sprites,
fill patterns, palette tricks, and `tline` effects.

## Input semantics

- `btn()` is held state.
- `btnp()` is an edge on the first frame, then repeats after 15 frames every four frames at 30 Hz; delays double at 60 Hz.
- Repeat delays can be overridden through `0x5f5c..0x5f5d`.
- `btnp()` edge state is reset at the start of each update callback.
- Mouse and keyboard require devkit mode at `0x5f2d`; pointer lock and mouse-to-button mapping are register-controlled.
- Mouse position, buttons, wheel, relative movement, and typed characters are exposed through `stat(30..39)`.
- Pause-menu callbacks have their own filtered input bitfield.

Remake implication: record inputs per logical update tick, not per rendered frame or DOM event timestamp.

## Audio semantics

- `sfx()` plays one of 64 SFX on four channels, supports auto-selection, explicit reservation, stop, release,
  note offset, and note length.
- Each SFX contains 32 notes with pitch, one of eight base or eight custom instruments, volume, and an effect.
- Effects: slide, vibrato, drop, fade in/out, and fast/slow four-note arpeggios.
- SFX-level state includes speed, loop/length, white/brown noise, buzz, two detune modes, two reverb modes,
  and two dampening levels. Newer carts encode filter state in high bits of raw SFX property bytes.
- Custom SFX instruments and custom 64-byte waveform instruments use SFX slots 0–7.
- `music()` starts at a pattern, supports fade time and a reserved-channel mask.
- Music flow has loop-start, loop-back, and stop flags. Pattern duration follows the leftmost non-looping channel.
- Audio status from `stat(46..57)` is tick-history based and more precise than legacy mixer queries.
- P8SCII printing can synthesize temporary SFX or play an existing SFX.

Remake policy: do not replace audio by default. Preserve raw SFX/music data and either run a compatible synth in
real time or offline-render WAV/OGG from the same synth. Prefer official PICO-8 audio export as the reference oracle
when a licensed local runtime is available.

## Text, P8SCII, and custom fonts

- Text is not ordinary Unicode UI. P8SCII contains glyphs and control bytes `0..15`.
- Control codes can terminate, repeat, reposition, recolor, draw backgrounds, delay across frames, play audio,
  switch fonts, decorate prior characters, and alter rendering modes.
- Special commands can clear the screen, set wrapping/home/tab dimensions, underline, outline, scale, stripe,
  invert, draw one-off glyphs, and write raw bytes to memory.
- A custom 256-character font can live at `0x5600`; the header controls metrics and per-character adjustments.

Remake implication: inspect strings for control bytes before treating them as localization text. Compatibility text
needs a parser, while semantically identified UI may be re-laid out with modern typography.

## Persistence, multi-cart, and host integration

- `cartdata()` maps a named persistent slot to `0x5e00..0x5eff`; `dget/dset` expose 64 fixed-point values.
- Current v0.2.7 can switch among up to four cartdata IDs per session; older documentation described one.
- `cstore/reload` can use additional carts as mutable data stores.
- `load()` can transfer to another cart with breadcrumb and parameter string; `run()` resets the current cart.
- `menuitem()` adds up to five pause-menu actions and can mask button triggers.
- GPIO and `serial()` expose physical pins, host byte streams, and dropped files/images, with platform restrictions.
- `extcmd()` requests host actions such as pause, reset, screenshots, frame-accurate recording, audio recording,
  title changes, and shutdown.

Remake implication: classify host-dependent carts before porting. Replace persistence and multi-cart transitions with
explicit platform services; hardware/GPIO projects require a separate adaptation contract.

## Export and distribution behavior

- Official export targets include HTML/JavaScript, optional WebAssembly, desktop binaries, Raspberry Pi, image,
  map, source image, WAV, and multi-cart bundles.
- HTML and native exports may bundle extra carts, but exported carts cannot dynamically download BBS carts.
- PNG and ROM carts require compressed code to fit the 15,360-byte code region.
- Distribution requires permission from the cart author and all contributors.
- The official `p8rt_ios.wasm` is not a general remake runtime: its license limits it to non-commercial,
  free, ad-free iOS player apps, prohibits modification and authoring uses, and independently requires cart permission.

Remake implication: legal/attribution status is a release gate. Technical extractability is not publication permission.
Do not embed `p8rt_ios` in the cross-platform remake engine; use a separately implemented compatibility core.

## Version-sensitive behavior represented in this corpus

The corpus spans raw cart versions 8 through 43. Relevant official changes include:

- v0.2.7: rounded rectangles, text outlines/underline, `sfx()` channel return, updated cartdata switching.
- v0.2.6: custom waveform instruments, inverted drawing, upper-RAM video mapping.
- v0.2.5: variable-width fonts, string indexing, larger multi-value peek/poke, `tline(bits)` precision control.
- v0.2.4: standard 64 KiB RAM, remappable map/video memory, precise audio status, ROM carts.
- v0.2.3: P8SCII behavior and audio/filter fixes, parameter and numeric conversion changes.
- v0.2.2: SFX filters, custom fonts, sprite-aware fill patterns, pointer lock, multi-value memory functions.

Store raw bytes and cart version even when a higher-level decoder exists. Compatibility tests should run against the
current official runtime and, when a discrepancy appears, consult the changelog before normalizing old data.

## Required conformance tests

Official probes use one of two provenance-bound channels and write only into the
ignored `captures/official/` tree. The licensed desktop channel records the
executable/cart hashes, version, host, ordered events, command, and exit status:

```sh
pnpm capture:official-probe -- \
  --licensed-official-runtime \
  --runtime /path/to/pico8 \
  --runtime-version 0.2.7 \
  --cart tests/conformance/probes/curved_raster.p8 \
  --output captures/official/0.2.7/curved_raster.json \
  --artifact curved_raster.png
```

The runner uses the manual-defined `-x` headless switch. Independent emulator
output is never accepted as an official golden, and capture files remain private.
The cart runs from an isolated temporary working directory. Every explicitly
declared PNG/WAV/CSV output is copied into an immutable sibling artifact bundle with
its media type, byte count, and SHA-256 recorded in capture schema v3; schema v2
licensed-desktop records remain readable. Missing,
duplicated, unsupported, symlinked, traversing, overwritten, or later-tampered
attachments fail validation. A probe that emits only stdout declares no
`--artifact` arguments and still records an explicit empty attachment list.

For Web-supported 0.2.7 raster/state probes, the preferred channel is the
provider-authorized, accountless PICO-8 Education Edition at
`https://www.pico-8-edu.com/`. Browser security intentionally keeps local cart
selection human-controlled. The operator selects the exact hashed cart once,
lets the official page produce the declared artifacts/event log, and attests
that the staged files came from that run. The importer then hashes the official
runtime asset, cart, browser identity, event log, and immutable artifacts:

```sh
pnpm import:official-education-probe -- \
  --authorized-official-education-runtime \
  --operator-artifact-declaration \
  --runtime-version 0.2.7 \
  --runtime-asset /private/staging/pico8_edu_0207.js \
  --runtime-asset-url https://www.pico-8-edu.com/play/pico8_edu_0207.js \
  --browser-name Chromium \
  --browser-version current-browser-version \
  --cart tests/conformance/probes/curved_raster.p8 \
  --source-dir /private/staging/curved-raster \
  --event-log events.txt \
  --output captures/official/0.2.7-education/curved_raster.json \
  --artifact curved_raster.png
```

The importer refuses non-official origins, absent declarations, unbounded or
symlinked paths, missing artifacts, and mutable output. Education Edition does
not substitute for desktop-only PCM/export or historical-version evidence; those
probes remain on the licensed desktop channel. Neither channel authorizes
publication of the captured cart or generated remake.
The curved-raster matrix entry declares its exact command and a raw 128x128 PNG;
that image is the oracle for display-palette RGB that `pget()` cannot observe.
After the licensed capture exists, generate the source-bound production-Wasm
candidate and compare both records with the matrix-owned commands:

```sh
pnpm capture:implementation-curved-raster -- \
  --cart tests/conformance/probes/curved_raster.p8 \
  --output captures/official/0.2.7/curved_raster-candidate.json
pnpm compare:official-probe -- \
  --official captures/official/0.2.7/curved_raster.json \
  --candidate captures/official/0.2.7/curved_raster-candidate.json \
  --output captures/official/0.2.7/curved_raster-comparison.json
```

Candidate records explicitly deny official authority and bind the source-cart
hash, production Wasm hash, Git revision, command, ordered events, and artifact
hashes. The comparator validates both records and their on-disk attachments,
then compares decoded RGBA pixels rather than PNG compression bytes, integer PCM
samples rather than WAV container metadata, and normalized CSV cells rather than
line endings. Version 1 permits no tolerance. Matched reports remain private and
immutable, and do not verify an exit until their authorized official provenance and
coverage are recorded in governance.

The authorized Education 0.2.7 channel has also qualified the emitted static
subsets of `numeric_memory`, `language`, `raster_state`, and
`advanced_raster`: all 59 events match the production-Wasm candidates. The
language comparison first exposed an implementation defect in non-numeric
`sub()` end handling; the shared compatibility prelude was corrected and the
same source-bound probe then matched 18/18. The sanitized hashes and bounded
claims are retained in
`governance/evidence/official-education-static-compatibility-differential.json`.
This batch does not qualify scheduler timing, un-emitted state, input,
persistence, or audio.

The next authorized Education 0.2.7 capture qualified a bounded persistence
path. A public write cart selected the named slot from `_init()`, observed a
clean `cartdata()` result, wrote signed 16:16 values at indices 0 and 63, and
confirmed the first value through `0x5e00`. After reloading the official page in
the same browser profile, a separate public read cart observed `cartdata()` as
loaded and recovered both values plus the mapped-memory value. The production
Wasm host initially restored the 256 bytes but incorrectly returned `false`
from `cartdata()`; the shared VM/host restoration contract was corrected and
the two candidates now match all 6 write and 4 read events. The source-bound
goldens and bounded hashes are retained in
`governance/evidence/official-education-persistence-differential.json`.
This evidence does not qualify four-slot switching, `cstore/reload` external
cart mutation, multi-cart parameters, pause-menu callbacks, serial/GPIO,
historical versions, or publication rights.

### Scheduler

- 30 Hz and 60 Hz callbacks.
- Multiple updates per draw during simulated frame drops.
- `time()` progression and repeated reads in a tick.
- `flip()` custom loops and coroutine frame suspension.

### Numeric and language

- Decimal rounding, overflow, underflow, and divide-by-zero saturation.
- Turn-based inverted trig, `atan2` order, `sgn(0)`, integer division, and all bit operators.
- One-based table helpers, deletion during `all()`, coercions, P8SCII string indexes, non-numeric `sub()` end handling, metatables, and coroutines.

### Memory

- ROM-to-RAM initialization.
- GFX/map aliasing, screen/GFX swap, custom map bases and widths.
- Unaligned little-endian access, overlapping `memcpy`, `reload`, `cstore`, custom-font memory, and persistent RAM.

### Graphics

- Camera, nested clipping, line continuation, and off-screen reads.
- Draw/display/secondary palettes and transparency.
- Primitive and sprite fill patterns, embedded color flags, inversion, flips, scaling, map layers, and `tline` precision.
- P8SCII controls, inline glyphs, delayed printing, audio controls, outlines, and custom fonts.

### Input and menus

- Held, edge, and repeat behavior at both update rates.
- Input sampling across multiple updates per draw.
- Pause-menu callbacks, mouse/keyboard devkit modes, pointer lock, and controller-player mapping.

### Audio

- Every base waveform, custom instruments, custom waveforms, every note effect, filters, looping/release, and fades.
- Music flow flags, unequal SFX speeds, channel reservation, dynamic RAM mutation, P8SCII-created sound, and status queries.

### Packaging

- `.p8.png → workspace → .p8 → .p8.png` decoded ROM and resource identity,
  including label pixels; empty text-section canonicalization is tracked separately.
- Old/new code compression, labels, metadata, Unicode/P8SCII, absent sections, raw music flags, and filter property bits.
- Web, mobile, desktop, and embedded save/input lifecycle behavior.
