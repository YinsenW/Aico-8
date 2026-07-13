# FAKE-08 differential findings

FAKE-08 was evaluated only as secondary evidence. It is **not** the PICO-8
behavioral oracle. The official manual, changelog, and traces captured from a
licensed official runtime remain authoritative.

Tested upstream revision: `814991a2571ad3970e386cef48f3b148aa1c27b9`.
The local executable used a temporary, uncommitted headless/input adapter under
`/tmp`; no FAKE-08 source was copied into this project.

## Results

| Probe | Result | Important finding |
| --- | ---: | --- |
| numeric and memory basics | pass | Fixed-point wrap, divide-by-zero, trig, little-endian reads, and GFX/MAP alias matched the documented cases. |
| 30/60 Hz scheduler basics | pass | The normal no-frame-drop callback sequence matched the small probes. |
| basic raster state | pass | Camera, clip, draw/display palettes, transparency, and map layers matched. |
| P8SCII static rendering | 14/14 | Inline glyphs, control colors, memory writes, custom fonts, outline, and underline matched. |
| advanced raster | 14/21 | Several current PICO-8 graphics features are absent or incomplete. |
| language | 16/18 | Most tested syntax/table/coroutine behavior matched; two current behaviors did not. |
| persistence | 20/20 | Four cartdata IDs, mapped memory, switching, and cross-process restore matched. |
| input | non-conformant | Repeat timing is advanced twice per logical update and 60 Hz delays are not doubled. |

## Confirmed gaps against documented v0.2.7 behavior

- Secondary palette application is missing for sprite and primitive fill patterns.
- Fill pattern/settings embedded in a color argument are not decoded.
- `tline(16)` pixel-coordinate precision mode is missing.
- GFX remapping affects `sget()` but does not make `peek(0)` observe the remapped screen block.
- `tonum("1234abcd", 0x3)` loses the fractional word.
- `sub(str, pos, non_number)` errors instead of returning one character.
- Input is sampled again inside `flip()`, so held-frame counters advance twice per logical update.
- Default `btnp` repeat is therefore observed far too early; the 60 Hz doubling rule is not implemented.
- The custom repeat interval path uses the initial-delay register instead of the interval register.

## Consequence for the remake project

FAKE-08 remains useful for fast smoke tests and for studying a working host
integration, but its renderer, input, audio, and language compatibility cannot
be reused as-is. Any borrowed component must independently pass this project's
official-runtime conformance suite.
