# Portable PICO-8 compatibility core (bootstrap)

This directory is the first executable slice of the proposed cross-platform
runtime. It is deliberately independent of PixiJS, browsers, mobile SDKs, and
ESP-IDF. The public boundary is the C ABI in `include/p8/core.h`.

Implemented and tested so far:

- 32 KiB cart ROM and 64 KiB base RAM;
- reset-time copy of ROM data `0x0000..0x42ff` into RAM;
- little-endian 8/16/32-bit memory access and wrapped addresses;
- GFX/screen low-level mapping through `0x5f54..0x5f55`;
- default, shared, custom-width, and upper-RAM map addressing through `0x5f56..0x5f57`;
- per-physical-byte dirty tracking for HD replacement safety;
- eight six-button controllers, combined two-player masks, and latched `btnp` repeat;
- fixed 30/60 Hz callbacks driven by a 60 Hz host clock;
- a stable semantic draw-command envelope for later graphics APIs;
- packed 4-bit screen/sprite pixels with GFX and screen remapping;
- draw palette, sprite transparency, camera, clipping, and `cls` state;
- reference `pset`, `line`, rectangle, and circle rasterization;
- an unpacked 128x128 indexed-frame export for native and WebAssembly hosts;
- an experimental pinned z8lua adapter behind a narrow VM boundary;
- byte payload storage for text-bearing semantic draw commands.

Run the native tests with:

```sh
make test
```

Cart-specific adapters and replays are retained in the private research archive.
The public test command uses only project-owned synthetic fixtures.

This is not yet a playable emulator. Pattern fills, sprites, maps, text, audio
synthesis, durable persistence, and host services are subsequent slices.
Input-repeat details, mapping conflicts, fixed-point conversion, and primitive
edge pixels remain provisional until the same probes are captured from a
licensed official PICO-8 runtime. The graphics baseline and open questions are
recorded in `../../docs/reference/pico8-graphics-semantics.md`.
