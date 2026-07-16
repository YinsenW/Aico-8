# PICO-8 graphics semantics baseline

- Status: maintained implementation reference; edge-raster details require official probes
- Primary source: PICO-8 User Manual v0.2.7
- Last reviewed: 2026-07-16

## Why the compatibility image stays 128x128

PICO-8 defines a fixed 128x128, 16-colour display and a 128x128 sprite sheet.
Aico 8 therefore keeps one packed, indexed compatibility image as the
authoritative result of cart drawing. The 1024x1024 renderer is a separate
presentation layer. It can replace recognized objects with HD art, but it does
not change logical coordinates or the authoritative reference image. Accepted HD
frames require complete modern coverage rather than mixed indexed fragments.

## Draw-state rules captured from the manual

- Program reset restores camera, palettes, clipping, draw colour, and fill pattern.
- The current draw colour starts at 6. `color(col)` changes it and `color()`
  restores 6; primitives with an omitted `col` consume that state. A colour
  supplied to `print` also becomes current, while an explicit primitive colour
  is local to that call.
- `camera(x,y)` applies a screen offset of `-x,-y`; `camera()` resets it.
- `clip(x,y,w,h)` uses a pixel rectangle. Its optional fifth argument intersects
  the new rectangle with the previous one. `clip()` resets it.
- `cls(c)` clears the whole screen and resets clipping.
- The draw palette maps a source colour when new pixels are drawn. The display
  palette changes presentation without changing stored screen indices.
- `pget` and `sget` return stored screen and sprite-sheet indices. Their normal
  out-of-range result is zero; when `0x5f36` bit 4 is enabled, `sget`, `mget`,
  and `pget` instead return the bytes at `0x5f59`, `0x5f5a`, and `0x5f5b`.
- `palt` is observed by `spr`, `sspr`, `map`, and `tline`, not by primitive
  plotting. Its default is colour 0 transparent and all other colours opaque.
- Rectangle corners and line endpoints are inclusive. A negative circle radius
  produces no drawing.
- `fillp` is a 4x4, two-colour pattern observed by primitive drawing, with
  transparency, sprite, secondary-palette, and inversion modes.
- When `0x5f34` bit 0 and a colour argument's `0x1000.0000` marker are set,
  bits `0x0f00.ffff` replace the current pattern/modes for that call path;
  `0x0800.0000` requests one-call inversion for filled shapes. Persistent
  inversion through `0x5f34` bit 1 draws the complement of the filled shape
  inside the active clip.
- `pal(c0,c1,2)` stores a two-colour pair. With `fillp` flag `.01`, the pair is
  selected per screen-space pattern bit for `spr`, `sspr`, `map`, and `tline`;
  flag `.001` applies it globally after the ordinary draw palette. The shared
  native/Wasm raster owns this behavior; HD commands do not reinterpret
  secondary pairs as display-palette entries.

## Memory rules captured from the manual

- Graphics begin at `0x0000`; draw state at `0x5f00`; screen at `0x6000`.
- Screen and sprite pixels are packed two per byte, with the left/even pixel in
  the low nibble.
- `0x5f54` remaps GFX and `0x5f55` remaps the screen below memory/graphics APIs.
- The second half of the sprite sheet and lower half of the 128x64 map share memory.
- `reload(dest,source,len)` copies the immutable current-cart ROM data region
  `0x0000..0x42ff` into base RAM; the code section at `0x4300` and above is
  protected.
- `map()` normally treats cell value `0` as empty even when sprite `0` has
  visible pixels. `0x5f36` bit 3 makes sprite `0` drawable; palette
  transparency and layer filtering still apply on the ordinary sprite path.
- `tline()` samples map-backed sprite pixels along an inclusive screen line.
  Its default 13-bit coordinate mode advances one sprite pixel per `0.125`
  tile; `tline(16)` switches the sampling coordinates to pixel units. The
  masks at `0x5f38..0x5f39`, offsets at `0x5f3a..0x5f3b`, layer flags,
  sprite-zero override at `0x5f36`, draw palette, and `palt` are applied on the
  same indexed path.

## Implemented interpretation

`runtime/core/include/p8/raster.h` exposes stored-pixel access,
palette/transparency state, camera, clipping, clear, line, rectangle, circle,
and a flat 16,384-byte indexed-frame export. It only uses the core memory API,
so low-level screen and GFX remapping remains authoritative.

`runtime/core/src/vm_z8lua.cpp` owns the current-colour state used by PICO-8
API calls. Semantic draw commands always contain the resolved raw colour even
when the cart omitted the optional argument, so native rasterization and the HD
presentation bridge consume the same deterministic value. The indexed path
decodes embedded pattern arguments once through the shared raster API; explicit
primitive colours stay local, while `color(encoded)` retains the encoded current
colour for later omitted-colour calls.

Filled rectangle, circle, ellipse, and rounded-rectangle inversion share the
ordinary camera, clip, draw palette, secondary palette, transparency, and
screen-space pattern pipeline. Each filled primitive constructs the complement
from the same deterministic spans used by its ordinary fill, avoiding a second
geometry approximation. Ellipses use an integer bounding-box raster on native
and Wasm; rounded rectangles interpret width and height as pixel counts, reject
non-positive dimensions, and clamp radius to `0..min(width,height)/2`. Native,
VM, Wasm, and Web tests cover all four curved primitive APIs and their semantic
draw commands. Exact official edge pixels remain a golden-capture requirement.

The expectation probe records row 10 of `0xabcd` as `4,4,14,14`: `fillp` tiles
by absolute screen row, so row 10 consumes pattern row 2 rather than row 0.

`runtime/core/src/core.cpp` owns current-cart ROM reload so native and Wasm VM
calls share one copy path, dirty tracking, remapping behavior, and protected-code
range check. External-cart filenames are deliberately rejected until a host
resource contract can provide a declared cartridge rather than an implicit file.

`runtime/core/src/text.cpp` owns synchronous P8SCII execution and indexed text
rasterization. The manual-defined static baseline covers built-in and custom
font rows, inline glyphs, cursor/color/background controls, repeat/termination,
raw writes, outline, underline, and sizing modes. Delay and audio controls are
preflighted and rejected before mutation until their timing and synthesis paths
are qualified; semantic text-run emission remains a separate planned boundary.

The same source targets native, WebAssembly, and ESP-IDF builds. A TypeScript
host consumes the indexed frame; it does not duplicate compatibility raster rules.

The native, VM, and Wasm paths also retain the map sprite-zero override, the
three out-of-range read bytes, and display-palette targets `128..143`. The Web
reference renderer resolves indexed framebuffer pixels through the exported
display palette, while the HD vector presenter preserves the same extended
indices instead of truncating them to `0..15`. The RGB table is isolated in one
TypeScript module so official capture corrections cannot drift between the two
presenters.

## Deliberately unresolved

Authorized official runtime probes are still required for fixed-point edge rounding;
exact line/circle/ellipse and inverted-fill edge pixels; embedded colour-argument
state persistence; exact extended-palette RGB output and override edge behavior;
upper-memory mapping conflicts; and draw-state byte packing not specified by the
public manual.

Those captures become small golden fixtures. Independent emulators may locate
disagreements, but they are not the compatibility oracle.

## Next qualification slice

Capture authorized official-runtime goldens for ellipse and rounded-rectangle
edges, embedded-state persistence, fixed-point input, extended-colour output,
inverted fills, and other edge behavior. Apply any resulting corrections to the
single shared raster and keep indexed-frame tests and semantic-command output
paired so the HD presentation bridge never invents separate semantics.
