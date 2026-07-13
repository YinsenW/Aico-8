# z8lua adoption audit

## Decision

Adopt z8lua **conditionally** as the P8 Lua VM base. The clean `pico8` branch is
pinned at commit `8575dfbc524003c869c0aa05e109819302c576f9` and vendored for the
experimental compatibility-kernel bootstrap. It is not yet accepted as the general
production parser. The pin and local patch list are recorded in
`runtime/third_party/z8lua.lock.json`.

The VM is a strong fit for fixed-point arithmetic and a portable C++ core, but
it is not a complete PICO-8 runtime. Memory, graphics, input, audio, persistence,
table helpers, host services, and scheduling remain responsibilities of this
project.

## Reproducible results

The branch builds on Apple Clang without CMake:

```sh
make -j4 CC=clang++ MYCFLAGS= MYLDFLAGS= MYLIBS= all
```

`tools/audit_z8lua_semantics.py` compares VM-only probes against the official
expectation files. Host shims are deliberately supplied for APIs outside the VM
boundary, such as `add`, `del`, `all`, coroutine aliases, and `sub`.

| Probe group | Result | Meaning |
| --- | ---: | --- |
| Fixed-point numeric subset | 8/8 | Wrap, divide-by-zero saturation, trig, `sgn(0)`, and integer division match. |
| Language subset with host shims | 17/18 | Parser, strings, coercion, metatables, coroutines, and tested bit operators match. |
| Combined | 25/26 | One known `tonum` bit-pattern mismatch remains. |

The unmodified-upstream machine-readable synthetic result is
`research/z8lua_semantics_report.json`.

Unmodified upstream has this remaining mismatch:

```text
tonum("1234abcd", 0x3)
expected: 0x1234.abcd
actual:   0x1234.0000
```

`lpico8lib.c` treated the parsed integer as an ordinary number and lost the
fractional word. The vendored local copy now constructs the value from its raw
32 bits and also implements flag `0x4` conversion fallback. The patched build
passes all 26/26 current VM expectations; its machine-readable result is
`research/z8lua_local_semantics_report.json`.

## Whole-corpus syntax audit

`tools/audit_z8lua_corpus.py` compiled all 291 decoded carts inside an uncalled
function, so top-level game APIs were not executed.

| Result | Private corpus carts | Share |
| --- | ---: | ---: |
| Compiles | 273 | 93.8% |
| Fails | 18 | 6.2% |

The 18 first failures divide into three primary parser gaps:

- 12 carts use the undocumented multiline form `if condition do ... end`.
- 5 carts use `?` as an expression because PICO-8 `print()` returns the rendered width.
- 1 highly minified cart uses binary `~` as an operator; z8lua accepts PICO-8 `^^` but not this form.

Some affected carts contain more than one of these extensions. Exact cart
identities, hashes, failing lines, and machine-readable corpus reports stay in
the private research archive. The locally patched build has the same aggregate
273/291 result, confirming that the numeric fix does not conceal the separate
parser work. The first private trial compiles, but these gaps remain a release
gate for a general cart conversion pipeline.

## Zepto-8 cross-check

Zepto-8 was inspected at commit
`b2929a4fe31e5765ef66d7794edd11086b9638b4`. Its PEGTL grammar is useful as a
language reference and recognizes several PICO extensions for token counting
and AST experiments. It does not provide the missing production front end:

- `cart::preprocess_code()` only expands `#include` directives.
- The VM then sends that source directly to its modified z8lua.
- The grammar rule for `if (...) do` exists only inside a disabled `#if 0` block.
- The short-print grammar models `?` as a statement, not a value expression.
- The AST printer is documented as unfinished and does not emit normalized Lua.

Therefore adopting Zepto-8's parser wholesale would add PEGTL/lolengine
dependencies without closing the corpus failures. Its tests and grammar remain
research references, not the runtime oracle.

## Licensing boundary

The pinned clean branch contains two relevant license families:

- Lua-derived source carries the Lua MIT license notice.
- Sam Hocevar's fixed-point/PICO additions, including `fix32.h`, `lpico8lib.c`,
  and `trigtables.h`, carry WTFPL v2 notices.

The larger Zepto-8 branch also pulls in unrelated components and licenses. It is
not selected. Every vendored upstream header has been preserved and
`runtime/third_party/THIRD_PARTY_NOTICES.md` enumerates the pin and local patch.

This source-code license audit is separate from cart publication permission.

## Integration plan

1. Keep z8lua behind a narrow VM adapter; do not let it own platform or renderer state.
2. Implement PICO table/string/API helpers in the host and test their edge behavior independently.
3. Patch `tonum` bit-pattern conversion and add the official result to its regression test.
4. Add parser-level conformance carts for `if ... do`, print-as-expression, and binary `~`.
5. Prefer small, reviewed lexer/parser changes over regex source rewriting; the affected
   carts are often minified, nested, and dependent on line-sensitive shorthand rules.
6. Re-run the full 291-cart compile audit after every parser change. The acceptance target is 291/291.
7. Keep `^` power behavior provisional until official edge-case goldens pass; upstream
   explicitly does not claim complete bit-exactness there.

The pinned sources may continue to support the representative-cart prototype,
but the parser is not considered generally accepted until these gates close.
