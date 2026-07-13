# Third-party notices

## z8lua

- Repository: <https://github.com/samhocevar/z8lua>
- Branch: `pico8`
- Upstream commit: `8575dfbc524003c869c0aa05e109819302c576f9`
- Local status: experimental, conditionally adopted

The Lua-derived files retain the Lua MIT license notice found at the end of
`z8lua/lua.h`. The copyright and permission notice must remain with copies or
substantial portions of that software.

Sam Hocevar's PICO-8/fixed-point additions retain their WTFPL version 2 headers,
including `z8lua/fix32.h`, `z8lua/lpico8lib.c`, and `z8lua/trigtables.h`.

One local compatibility patch is currently applied to `lpico8lib.c`: `tonum`
flags `0x3` preserve the parsed 32-bit word as raw 16:16 bits, flags `0x4`
return zero on conversion failure, and hexadecimal input is bounded to eight
characters. This is covered by the official-manual expectation probe.

No license from this runtime grants permission to redistribute any cartridge,
art, music, or other game content.
