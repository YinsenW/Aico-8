export const PICO8_BASE_COLORS = [
  0x000000, 0x1d2b53, 0x7e2553, 0x008751,
  0xab5236, 0x5f574f, 0xc2c3c7, 0xfff1e8,
  0xff004d, 0xffa300, 0xffec27, 0x00e436,
  0x29adff, 0x83769c, 0xff77a8, 0xffccaa,
] as const;

// PICO-8's display palette addresses the sixteen secondary colours as
// 128..143. These RGB values are the documented community reference values;
// licensed official captures remain the compatibility oracle for release
// evidence and are tracked separately by governance.
export const PICO8_EXTENDED_COLORS = [
  0x291814, 0x111d35, 0x422136, 0x125359,
  0x742f29, 0x49333b, 0xa28879, 0xf3ef7d,
  0xbe1250, 0xff6c24, 0xa8e72e, 0x00b543,
  0x065ab5, 0x754665, 0xff6e59, 0xff9d81,
] as const;

export function normalizePico8DisplayIndex(value: number): number {
  return Math.trunc(value) & 0x8f;
}

export function pico8ColorForDisplayIndex(
  displayIndex: number,
  basePalette: readonly number[] = PICO8_BASE_COLORS,
  extendedPalette: readonly number[] = PICO8_EXTENDED_COLORS,
): number {
  const normalized = normalizePico8DisplayIndex(displayIndex);
  return normalized >= 128
    ? extendedPalette[normalized - 128] ?? 0
    : basePalette[normalized] ?? 0;
}

export function pico8FramebufferColor(
  framebufferIndex: number,
  displayPalette: Uint8Array | readonly number[],
  basePalette: readonly number[] = PICO8_BASE_COLORS,
  extendedPalette: readonly number[] = PICO8_EXTENDED_COLORS,
): number {
  const source = Math.trunc(framebufferIndex) & 0x0f;
  return pico8ColorForDisplayIndex(
    displayPalette[source] ?? source,
    basePalette,
    extendedPalette,
  );
}
