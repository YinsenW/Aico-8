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

## FAKE-08 / tac08 compatibility font table

- FAKE-08 repository: <https://github.com/jtothebell/fake-08>
- Evaluated FAKE-08 commit: `814991a2571ad3970e386cef48f3b148aa1c27b9`
- Upstream table attribution: tac08 <https://github.com/0xcafed00d/tac08>
- License: MIT

`runtime/core/src/text.cpp` stores the 2 KiB compatibility font byte table as
hex and uses an independently implemented parser/raster path. The upstream MIT
permission and warranty disclaimer apply to that table.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Atkinson Hyperlegible

- Repository: <https://github.com/googlefonts/atkinson-hyperlegible>
- Upstream commit: `1cb311624b2ddf88e9e37873999d165a8cd28b46`
- Assets: regular and bold WOFF2 Web fonts
- License: SIL Open Font License 1.1

The unmodified font files and full OFL text are distributed under
`apps/web/public/fonts/`. Aico 8 uses the family name `Aico Sans` only as a CSS
alias; the font remains Atkinson Hyperlegible under its own name and license.
