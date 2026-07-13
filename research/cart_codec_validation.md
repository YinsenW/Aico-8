# Cartridge codec validation

Status: 291/291 corpus carts pass the current full semantic round trip.

## Toolchain

- `tools/p8_workbench.py`: original cart to editable workspace and back.
- `tools/extract_p8_resources.py`: code, sprites, label, map/shared alias,
  flags, SFX, and music extraction.
- `tools/rebuild_p8_from_resources.py`: conflict-aware resource reconstruction.
- Shrinko8 v1.2.6h, pinned in `tools/requirements.txt` to commit
  `5bf57274b35f0533413cd03b12204c8765d14372`.

Shrinko8 is a format codec in this workflow, not the behavioral oracle. Runtime
semantics still come from official PICO-8 documentation and official-runtime
goldens.

## What “lossless” means

Two different boundaries are checked because text carts and PNG carts have
different canonicalization behavior.

### Decoded `.p8` boundary

`source.p8 -> workspace -> rebuilt.p8` must preserve:

- exact decoded 32 KiB ROM;
- hashes for Lua, GFX pixels, shared map/GFX bytes, primary map, sprite flags,
  SFX records, music patterns, and label pixels;
- which text sections exist and their order.

An absent `__music__` or `__sfx__` section stays absent unless the extracted
resource is deliberately edited. Existing SFX/music sections retain only the
record range present in the source instead of being padded to 64 text rows.

### Encoded `.p8.png` boundary

`original.p8.png -> workspace -> rebuilt.p8 -> repacked.p8.png -> decoded.p8`
must preserve:

- exact decoded ROM;
- every resource hash listed above, including label pixels.

PNG byte identity is not required: carrier pixels, PNG compression, and
ancillary metadata can be encoded differently while representing the same cart.
The PNG codec may also omit an entirely empty text section such as `__label__`
when decoding. Section presence/order is therefore not compared at this outer
boundary; any non-empty resource loss still fails its content hash.

## Defects found by strengthening the test

1. The first SFX header byte had been named `editor_mode`, which hid newer
   filter/property bits. The schema now exposes the exact four-byte
   `properties_raw` header and a separate decoded view. Rebuilding always gives
   the raw bytes authority.
2. The original rebuilder emitted 64 empty SFX and music rows even when those
   sections were absent. ROM comparison could not see the difference. Strict
   resource/section validation caught it, and the rebuilder now preserves
   absence and source record extent.
3. Some carts contain an empty label section that the PNG codec legally
   canonicalizes away. The outer validation now distinguishes harmless empty
   section normalization from actual label-pixel loss.

## Corpus result

On 2026-07-13, all 291 user-provided `.p8.png` carts completed both workbench
operations:

1. unpack, rebuild, and internal ROM/resource/section validation;
2. repack to `.p8.png`, decode again, and ROM/resource validation.

Result: `total=291 ok=291 failed=0`.

This validates the current corpus, not every historical/future PICO-8 container
variant. Future fixtures should still add old compression modes, deliberately
short/missing sections, unusual Unicode/P8SCII source, and future-version carts
as independent regression cases.
