# PICO-8 graphics semantics baseline

- Status: maintained implementation reference; edge-raster details require official probes
- Primary source: PICO-8 User Manual v0.2.7
- Last reviewed: 2026-07-15

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
  out-of-range result is zero.
- `palt` is observed by `spr`, `sspr`, `map`, and `tline`, not by primitive
  plotting. Its default is colour 0 transparent and all other colours opaque.
- Rectangle corners and line endpoints are inclusive. A negative circle radius
  produces no drawing.
- `fillp` is a 4x4, two-colour pattern observed by primitive drawing, with
  transparency, sprite, secondary-palette, and inversion modes.

## Memory rules captured from the manual

- Graphics begin at `0x0000`; draw state at `0x5f00`; screen at `0x6000`.
- Screen and sprite pixels are packed two per byte, with the left/even pixel in
  the low nibble.
- `0x5f54` remaps GFX and `0x5f55` remaps the screen below memory/graphics APIs.
- The second half of the sprite sheet and lower half of the 128x64 map share memory.
- `reload(dest,source,len)` copies the immutable current-cart ROM data region
  `0x0000..0x42ff` into base RAM; the code section at `0x4300` and above is
  protected.
- `map()` treats cell value `0` as empty and skips it even when sprite `0` has
  visible pixels; layer filtering applies only to non-zero cells.

## Implemented interpretation

`runtime/core/include/p8/raster.h` exposes stored-pixel access,
palette/transparency state, camera, clipping, clear, line, rectangle, circle,
and a flat 16,384-byte indexed-frame export. It only uses the core memory API,
so low-level screen and GFX remapping remains authoritative.

`runtime/core/src/vm_z8lua.cpp` owns the current-colour state used by PICO-8
API calls. Semantic draw commands always contain the resolved raw colour even
when the cart omitted the optional argument, so native rasterization and the HD
presentation bridge consume the same deterministic value.

`runtime/core/src/core.cpp` owns current-cart ROM reload so native and Wasm VM
calls share one copy path, dirty tracking, remapping behavior, and protected-code
range check. External-cart filenames are deliberately rejected until a host
resource contract can provide a declared cartridge rather than an implicit file.

The same source targets native, WebAssembly, and ESP-IDF builds. A TypeScript
host consumes the indexed frame; it does not duplicate compatibility raster rules.

## Deliberately unresolved

Licensed official runtime probes are still required for fixed-point rounding;
exact line/circle/ellipse edge pixels; fill patterns, inversion and secondary
palettes; extended palettes and out-of-range overrides; upper-memory mapping
conflicts; and draw-state byte packing not specified by the public manual.

Those captures become small golden fixtures. Independent emulators may locate
disagreements, but they are not the compatibility oracle.

## Next implementation slice

Add `fillp`, `spr`, `sspr`, and `map` on the same pixel path, followed by `tline`,
text, and extended palette modes. Each operation needs indexed-frame tests and
semantic-command output for the HD presentation bridge.
