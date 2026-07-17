# Aico 8 typography contract

## Purpose

The typography system makes remade games readable and visually standardized
without pretending that PICO-8 text is ordinary Unicode. It owns modern text
presentation policy. P8SCII execution and exact pixel output remain compatibility
core responsibilities.

This contract applies to in-game text, HUD values, dialogue, menus, diagnostics,
localization, and accessible mirrors. It does not authorize rewriting cart copy
or converting arbitrary pixel glyphs into guessed vector shapes.

## Non-negotiable invariants

1. The core receives and executes the original P8SCII bytes unchanged.
2. Original cursor position, foreground state, custom-font RAM, control effects,
   frame timing, and `print()` return value are computed before modernization.
3. Modern font metrics never write back into Lua, RAM, replay state, collision,
   update cadence, or the semantic command order.
4. Accepted HD scenes have complete modern text coverage and never composite an
   indexed glyph or run into the modern frame.
5. Release fonts are bundled, fixed-version, hashed, licensed assets; an OS font
   stack is not a deterministic production fallback.
6. Generated or inferred glyph shapes cannot silently replace cart-authored icons.
7. Every rendered string declares `source-authored`, `state-derived-accessibility`,
   or `supplemental-authorized` provenance. Supplemental copy requires hashed
   product-authorization evidence; polish alone cannot authorize new wording.

## Two-track model

### Compatibility text track

The C++ kernel parses the complete P8SCII stream. It resolves built-in or custom
glyph memory, cursor motion, foreground/background, padding, outline/underline,
wide/tall modes, repetition, termination, one-off glyphs, and effectful control
codes. It produces the authoritative indexed pixels and original rightmost-X
result, even when HD presentation is enabled.

Official-runtime captures are the oracle for ambiguous byte sequences. A
third-party font or Unicode conversion table is diagnostic only.

### Modern presentation track

After compatibility execution, the kernel exposes `DATA-TEXT-RUN-001`. The
TypeScript adapter may modernize only spans classified `safe-modern`. It selects
a role from `DATA-TYPOGRAPHY-001`, renders inside the declared anchor/layout box,
and preserves command ordering. `reference-only` and `review-required` are
authoring blockers: they may appear in whole-scene diagnostic reference mode but
cannot be composited into an accepted HD frame.

## Semantic text-run contract

The executable modernization companion is
`specs/schemas/text-inventory-v1.schema.json` plus
`packages/contracts/src/typography.ts`. It does not replace the kernel
text-run IR: it inventories every reachable run exactly once and binds its
P8SCII/Unicode evidence, provenance, routing class, and explicit mapping. A
review blocker is a mapping; a missing mapping is invalid evidence. Drafts may
retain blockers, while `complete-for-hd` rejects diagnostic/reference runs and
allows identity artwork only through a reviewed contour decision.
For identity artwork, `safe-modern` means a review-approved identity asset; it
never means that the artwork is eligible for substitution by an ordinary font.

The version-1 kernel wire contract is emitted by `runtime/core/src/text.cpp`,
exposed unchanged by the native/Wasm C ABI, decoded fail-closed by
`apps/web/src/runtime/text-run-ir.ts`, and projected by
`specs/schemas/text-run-v1.schema.json`. It uses explicit little-endian fields,
not compiler struct layout, and preserves:

- command/update identity and ordered span identity;
- original byte range and unmodified P8SCII bytes;
- decoded Unicode only when the mapping is lossless and declared;
- original logical anchor, cursor-in/cursor-out, rightmost X, and draw state;
- custom-font identity/revision and relevant memory range;
- visual attributes and explicit side-effect boundaries;
- semantic role, localization key when applicable, and source provenance;
- classification: `safe-modern`, `reference-only`, or `review-required`;
- reason codes and exact diagnostic correspondence region.

The kernel classifies only plain printable ASCII without control/custom/inline
ambiguity as `safe-modern`. Unsupported effectful controls are
`reference-only`; non-ASCII glyphs, custom fonts, inline glyphs, visual controls,
or ambiguous mappings are `review-required`. These are routing permissions, not
permission for the HD layer to replay cursor, color, RAM, timing, audio, clear,
or render-state effects. The ordered span ledger records those effects while the
compatibility executor remains their sole authority.

Inventory capture uses the exact 64-bit logical update halves, semantic run
sequence, and raw P8SCII bytes as its runtime locator. An authoring job may turn
a missing decision into an explicit review blocker, but it cannot guess a font
role. The HD presenter resolves each `print` against a source-hash-bound
`complete-for-hd` inventory; a stale source, missing locator, byte mismatch, or
unapproved run is blocked before drawing.

Effectful controls are never discarded from the compatibility stream. A modern
run may represent their visual result, but it may not execute or approximate the
side effect itself.

## Typography manifest

The versioned manifest maps semantic roles to deterministic presentation assets.
Its executable field contract is
`specs/schemas/typography-manifest-v1.schema.json` plus the same TypeScript
validator, which cross-checks all `safe-modern` characters against role and
bundled-asset coverage.
Each entry declares:

- role and intended use, such as `display`, `menu`, `dialogue`, `hud-number`,
  `symbol`, `diagnostic`, or `localized-body`;
- font family/version, bundled file path, content hash, source, and license;
- covered Unicode ranges and required glyph inventory;
- renderer, size, weight, tracking, line height, alignment, and color tokens;
- anchor and fit policy, including minimum size and overflow behavior;
- locale/script coverage and ordered bundled fallbacks;
- diagnostic reference policy and any author-approved icon mapping.

Font subsetting and atlas generation are reproducible Job outputs. Changing a
font file, subset, metrics, renderer, or fit policy changes the manifest version
and invalidates visual/layout evidence.

The public Latin WOFF2 path derives `aico8.glyph-metrics.v1` files directly from
the pinned font bytes. Each ordered covered code point binds a glyph ID, advance,
and font-unit bounds; the metrics file hash is part of the typography manifest.
The Web loader verifies font, metrics, provenance, and license bytes before
installing the face. Canvas/Pixi styles use only the manifest family name, with
font synthesis disabled and no comma-separated OS fallback. Layout uses the
generated unkerned advances as a conservative bound, preserves glyph aspect
ratio, and may reduce size only to the role minimum or wrap within its declared
line count; otherwise it fails closed.

## Rendering matrix

| Content | Default renderer | Reason |
| --- | --- | --- |
| Original/unknown P8SCII | Whole-scene diagnostic reference only | Exact inspection without mixed presentation |
| Curated Latin menu/HUD | Bundled MSDF/SDF bitmap text | Crisp, efficient scaling at 1024 |
| Large CJK/localized set | Bundled WOFF2 canvas text, cached | Avoid impractical all-glyph atlases |
| Cart-defined/inline glyph | Author-approved modern glyph/icon asset | Meaning cannot be safely inferred |
| Product shell/accessibility | Bundled web font plus semantic DOM/ARIA mirror | Readability and assistive technology |

The renderer choice is per role and script, not one global font technology.
MSDF is not required for text whose glyph inventory makes an atlas wasteful.
Identity wordmarks and source-drawn glyphs may become safe for HD only through a
reviewed identity-contour mapping. They never enter generic font coverage;
custom, inline, button, effectful, and ambiguous runs remain `review-required`.

## Layout and readability

- The original logical anchor is the stable point. Modern text fits a declared
  presentation box derived from the 1024 design space, not from Lua-visible width.
- Prefer reflow or a larger reviewed box for dialogue; never squeeze glyphs until
  their proportions become nonstandard or unreadable.
- HUD numbers use tabular figures when their role requires stable visual width.
- Minimum sizes, contrast, focus treatment, safe areas, and language expansion
  are validated at 1024 and each delivery profile.
- Each semantic role declares an `accessibilityMinCssPx` floor. Profile scaling
  may enlarge text but never reduce it below that CSS-pixel floor; a box that
  cannot fit at the floor fails closed instead of rendering smaller or blurred.
- Opaque sRGB foreground/background pairs use WCAG relative luminance: normal
  text requires 4.5:1, while qualified large text requires 3:1.
- An accessible text mirror may expose meaning to screen readers, but it does not
  become an input or timing authority for the compatibility core.

The first qualified locale scope is `en-US` / `Latn`, bound to the complete
printable-ASCII inventory. `Hans`, `Hant`, `Jpan`, and `Hang` remain explicitly
unsupported because no bundled coverage and human readability evidence exist;
the runtime fails closed rather than using an OS fallback. Adding a locale is a
new manifest/audit decision, not an inference from a system-installed font.

Assistive descriptions are structured `state-derived-accessibility` records
with a scene ID and source state/token evidence IDs. The DOM announcer accepts
only that evidence-bearing path. It never writes into compatibility state and
the complete HD-on/HD-off replay must report zero state mutations.

## Dust Bunny first mapping

The initial inventory includes title/menu words such as `begin` and `resume`,
level labels, completion copy such as `the end`, and any dynamic counters. Plain
Latin spans without effectful controls are candidates for `safe-modern` after
capture comparison. Decorative marks, one-off glyphs, custom-font output, or
ambiguous bytes remain authoring blockers until explicitly mapped and reviewed.

The first art-direction review selects Atkinson Hyperlegible Regular and Bold at
upstream commit `1cb311624b2ddf88e9e37873999d165a8cd28b46` for the Latin game UI
and product shell. The WOFF2 SHA-256 values are
`2df4ba17804bc7a36f123127966075d8427bff2df58d0d76820c1130bb1a4150`
(Regular) and
`da8fce41a04f8498fbf79076f92d304b12e70c76f71b143c5dcfb6536c93c075`
(Bold); both are bundled under SIL OFL 1.1. Generated metrics prove printable
ASCII coverage for both faces, and fixed layout goldens cover 1024-square, 720,
and responsive mobile scales. This closes the reusable Latin HD font delivery
path, but not per-game reachable-run completeness, broader P8SCII, CJK/localized
coverage, accessibility review, or licensed-official compatibility evidence.

## Acceptance

- Official P8SCII probes match pixels, cursor state, rightmost X, timing, memory,
  and audio side effects, including custom-font and inline-glyph cases.
- Native and Wasm text runs are byte-identical for the same replay.
- Every reachable run has an accepted modern mapping; HD replays contain zero
  reference-only/review-required runs and zero scene-atomic reference switches.
- The canonical replay plus named reachable-state probes produce a versioned
  text-completeness audit whose every frame consumes all source text runs, has
  zero blockers/mismatches/out-of-inventory runs, and rejects deleted-mapping,
  stale-source, and text-IR-mismatch mutations.
- Bundled fonts reproduce from declared inputs and contain all manifest glyphs.
- Golden layouts pass at 1024, 720, responsive mobile, and supported locales.
- HD typography on/off leaves compatibility checkpoints byte-identical.
- Automated accessibility checks and human readability review both pass.

The readability review is an immutable four-check decision rather than a free
form approval flag. It binds the exact pending audit and screenshot review
packet, records phone-title readability, cross-profile HUD crispness, complete
glyph rendering without OS fallback, and preserved visual hierarchy, and
derives approval only when all four checks pass. The final audit must reconstruct
exactly from the archived pending bytes and decision.

## Primary references

- [PICO-8 manual: `print`, P8SCII, and custom font memory](https://www.lexaloffle.com/dl/docs/pico-8_manual.html)
- [PixiJS text overview](https://pixijs.com/8.x/guides/components/scene-objects/text)
- [PixiJS BitmapText and MSDF/SDF guidance](https://pixijs.com/8.x/guides/components/scene-objects/text/bitmap)
- [PixiJS Canvas Text and bundled web fonts](https://pixijs.com/8.x/guides/components/scene-objects/text/canvas)
- [PixiJS Assets](https://pixijs.com/8.x/guides/components/assets)
