# 1024×1024 display contract

## Invariants

- Authoritative simulation space: `128 × 128` logical units.
- Authoritative tile size: `8 × 8` logical units.
- Reference presentation surface: `1024 × 1024` output pixels.
- Logical-to-reference scale: exactly `8`.
- Reference tile unit: exactly `64 × 64` output pixels.
- Aspect ratio: square; presentation must never stretch X and Y differently.

Simulation values remain signed PICO 16:16 values. Presentation converts them
only after a logical update completes. Rendering at 1024 never changes collision,
timing, RNG, map addressing, or replay data.

## Native HD reference mode

Native HD mode fills the complete 1024×1024 surface. Semantic tiles, sprites,
entities, effects, and input all share the exact 8× transform. Integer logical
coordinates therefore land on integer output coordinates, while fixed-point
sub-pixel motion may still use floating presentation transforms.

Recommended authoring sizes:

- base 8×8 tile/sprite art: 64×64 at `@1`, or 128×128 at `@2`;
- larger actors: multiples of 64 output pixels, or resolution-independent vectors;
- UI/text: follow the bundled modern-font and reference-fallback rules in
  `specs/typography.md`;
- post-processing: 1024×1024 reference targets unless a platform profile reduces them.

## Compatibility mode

- Scale the 128×128 indexed framebuffer by exactly 8× to 1024×1024.
- Use nearest-neighbor sampling.
- There is no border, seam, or alternating source-pixel width.
- This mode is the raster oracle and automatic fallback for unrecognized drawing.

Native HD remains the product default. The compatibility framebuffer may be
shown as an overlay for regression diagnosis and author review.

## Derived delivery profiles

### 720×720 square

720 remains a supported output for existing displays and smaller downloads. It
is produced from the canonical 1024 presentation using a high-quality downsample.
Semantic layout still forms a 16×16 grid of 45×45 output-pixel tiles, but 720 is
not used as the compatibility oracle because individual logical pixels are 5.625
output pixels wide.

### Responsive hosts

Web and mobile hosts fit the completed square surface into available CSS/device
pixels while preserving aspect ratio. High-DPI devices may allocate a larger
backing target. Letterbox or safe-area regions are outside game input.

### Constrained embedded hosts

Embedded targets keep the 128×128 simulation and semantic command stream. They
may choose a panel-native delivery profile and render in strips or tiles. They
are not required to allocate a full 1024×1024 RGBA buffer (4 MiB, or 8 MiB when
double-buffered).

## Input mapping

Pointer/touch coordinates map from the displayed game rectangle back into
`0..128` logical space. Controller events are sampled per logical update and are
independent of display refresh.

## Acceptance tests

- `128 × 8 = 1024` for both axes.
- Sixteen 64-pixel tiles exactly cover each reference dimension.
- Every integer logical coordinate round-trips exactly through the reference transform.
- HD enabled/disabled produces identical update-state snapshots.
- Compatibility mode fills the 1024 surface with an exact nearest-neighbor 8× scale.
- Derived profiles preserve square aspect, safe areas, and input round-trip tolerance.
