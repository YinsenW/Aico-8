export interface DisplayProfile {
  readonly id: string;
  readonly logicalWidth: number;
  readonly logicalHeight: number;
  readonly logicalTileSize: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly logicalScale: number;
  readonly outputTileSize: number;
  readonly aspect: "square";
}

export const REFERENCE_PROFILE = Object.freeze({
  id: "hd-1024-square",
  logicalWidth: 128,
  logicalHeight: 128,
  logicalTileSize: 8,
  outputWidth: 1024,
  outputHeight: 1024,
  logicalScale: 8,
  outputTileSize: 64,
  aspect: "square",
} satisfies DisplayProfile);

export interface FittedSquare {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly scale: number;
}

export function logicalToReference(value: number): number {
  return value * REFERENCE_PROFILE.logicalScale;
}

export function referenceToLogical(value: number): number {
  return value / REFERENCE_PROFILE.logicalScale;
}

export function fitReferenceSquare(width: number, height: number): FittedSquare {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    throw new RangeError("viewport dimensions must be finite and non-negative");
  }

  const size = Math.min(width, height);
  return Object.freeze({
    x: (width - size) / 2,
    y: (height - size) / 2,
    size,
    scale: size / REFERENCE_PROFILE.outputWidth,
  });
}
