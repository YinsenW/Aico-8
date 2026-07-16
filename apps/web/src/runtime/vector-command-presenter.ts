import { Graphics, GraphicsPath } from "pixi.js";

import type { Aico8Kernel, DrawCommand } from "./kernel.js";

const OPCODE = {
  cls: 1,
  pset: 2,
  line: 3,
  rect: 4,
  rectfill: 5,
  circ: 6,
  circfill: 7,
  oval: 8,
  ovalfill: 9,
  spr: 10,
  sspr: 11,
  map: 12,
  print: 14,
  pal: 15,
  fillp: 16,
  palt: 18,
  camera: 19,
  clip: 20,
} as const;

type Point = { x: number; y: number };
type Loop = readonly Point[];
type SpriteSurface = { readonly color: number; readonly loops: readonly Loop[] };

export interface VectorCommandTheme {
  readonly scale: number;
  readonly palette: readonly number[];
  readonly backgroundColor?: number;
  readonly contourRounding?: number;
  readonly surfaceShadow?: { readonly color: number; readonly alpha: number; readonly offset: number };
  readonly surfaceHighlight?: { readonly color: number; readonly alpha: number; readonly width: number };
  readonly drawSemanticTile?: (context: VectorSemanticTileContext) => boolean;
}

export interface VectorSemanticTileContext {
  readonly graphics: Graphics;
  readonly tile: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly color: (sourceColor: number) => number;
}

export interface VectorCommandText {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly color: number;
}

export interface VectorCommandMeasurements {
  readonly sourcePrimitiveCount: number;
  readonly continuousPrimitiveCount: number;
  readonly spriteSurfaceCount: number;
  readonly textCount: number;
  readonly indexedCellQuadCount: 0;
}

function integer(value: number | undefined, fallback = 0): number {
  return Math.trunc(value ?? fallback);
}

function edgeKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function traceMask(mask: Uint8Array, width: number, height: number): Loop[] {
  const edges = new Map<string, Point[]>();
  const filled = (x: number, y: number): boolean => x >= 0 && x < width && y >= 0 && y < height
    && mask[y * width + x] === 1;
  const add = (from: Point, to: Point): void => {
    const key = edgeKey(from);
    const targets = edges.get(key) ?? [];
    targets.push(to);
    edges.set(key, targets);
  };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!filled(x, y)) continue;
    if (!filled(x, y - 1)) add({ x, y }, { x: x + 1, y });
    if (!filled(x + 1, y)) add({ x: x + 1, y }, { x: x + 1, y: y + 1 });
    if (!filled(x, y + 1)) add({ x: x + 1, y: y + 1 }, { x, y: y + 1 });
    if (!filled(x - 1, y)) add({ x, y: y + 1 }, { x, y });
  }
  const loops: Point[][] = [];
  while (edges.size > 0) {
    const first = edges.entries().next().value as [string, Point[]] | undefined;
    if (!first) break;
    const [startKey, firstTargets] = first;
    const [startX, startY] = startKey.split(",").map(Number);
    const loop: Point[] = [{ x: startX!, y: startY! }];
    let currentKey = startKey;
    let guard = 0;
    while (guard < width * height * 8) {
      guard += 1;
      const targets = edges.get(currentKey);
      const next = targets?.shift();
      if (!next) break;
      if (targets!.length === 0) edges.delete(currentKey);
      if (edgeKey(next) === startKey) break;
      loop.push(next);
      currentKey = edgeKey(next);
    }
    if (loop.length >= 3) {
      const simplified = loop.filter((point, index) => {
        const previous = loop[(index + loop.length - 1) % loop.length]!;
        const next = loop[(index + 1) % loop.length]!;
        return (point.x - previous.x) * (next.y - point.y)
          !== (point.y - previous.y) * (next.x - point.x);
      });
      if (simplified.length >= 3) loops.push(simplified);
    }
  }
  return loops;
}

function surfacesFor(
  pixels: Uint8Array,
  width: number,
  height: number,
  transparent: ReadonlySet<number>,
  visible: (x: number, y: number) => boolean = () => true,
): SpriteSurface[] {
  const colors = [...new Set(pixels)].filter((color) => !transparent.has(color)).sort((a, b) => a - b);
  return colors.map((color) => {
    const mask = Uint8Array.from(pixels, (pixel, index) =>
      pixel === color && visible(index % width, Math.floor(index / width)) ? 1 : 0);
    return { color, loops: traceMask(mask, width, height) };
  }).filter(({ loops }) => loops.length > 0);
}

function curvedPath(
  loops: readonly Loop[],
  destinationX: number,
  destinationY: number,
  scaleX: number,
  scaleY: number,
  flipX: boolean,
  flipY: boolean,
  sourceWidth: number,
  sourceHeight: number,
  rounding: number,
): GraphicsPath {
  const path = new GraphicsPath();
  const transform = (point: Point): Point => ({
    x: destinationX + (flipX ? sourceWidth - point.x : point.x) * scaleX,
    y: destinationY + (flipY ? sourceHeight - point.y : point.y) * scaleY,
  });
  const mix = (from: Point, to: Point, amount: number): Point => ({
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
  });
  for (const rawLoop of loops) {
    const loop = rawLoop.map(transform);
    const first = loop[0]!;
    const previous = loop[loop.length - 1]!;
    const start = mix(first, previous, rounding);
    path.moveTo(start.x, start.y);
    for (let index = 0; index < loop.length; index += 1) {
      const point = loop[index]!;
      const next = loop[(index + 1) % loop.length]!;
      const before = mix(point, loop[(index + loop.length - 1) % loop.length]!, rounding);
      const after = mix(point, next, rounding);
      path.lineTo(before.x, before.y);
      path.quadraticCurveTo(point.x, point.y, after.x, after.y);
    }
    path.closePath();
  }
  return path;
}

export class VectorCommandPresenter {
  readonly #theme: Required<Pick<VectorCommandTheme, "scale" | "palette">> & VectorCommandTheme;
  readonly #decoder = new TextDecoder();
  #cameraX = 0;
  #cameraY = 0;
  #drawPalette = Array.from({ length: 16 }, (_, color) => color);
  #displayPalette = Array.from({ length: 16 }, (_, color) => color);
  #transparent = new Set<number>([0]);
  #clip = { left: 0, top: 0, right: 128, bottom: 128 };
  #measurements: VectorCommandMeasurements = {
    sourcePrimitiveCount: 0,
    continuousPrimitiveCount: 0,
    spriteSurfaceCount: 0,
    textCount: 0,
    indexedCellQuadCount: 0,
  };

  constructor(theme: VectorCommandTheme) {
    if (theme.scale <= 0 || theme.palette.length < 16) throw new Error("Vector command theme needs a positive scale and 16 colors");
    this.#theme = theme;
  }

  measurements(): VectorCommandMeasurements {
    return this.#measurements;
  }

  render(
    graphics: Graphics,
    kernel: Aico8Kernel,
    commands: readonly DrawCommand[],
    drawText: (copy: VectorCommandText) => void,
  ): void {
    graphics.clear();
    this.#cameraX = 0;
    this.#cameraY = 0;
    const paletteState = kernel.paletteState();
    this.#drawPalette = Array.from(paletteState.draw, (entry) => entry & 15);
    this.#displayPalette = Array.from(paletteState.display, (entry) => entry & 15);
    this.#transparent = new Set(Array.from(paletteState.draw, (entry, color) => ({ entry, color }))
      .filter(({ entry }) => (entry & 0x10) !== 0).map(({ color }) => color));
    this.#clip = { left: 0, top: 0, right: 128, bottom: 128 };
    let sourcePrimitiveCount = 0;
    let continuousPrimitiveCount = 0;
    let spriteSurfaceCount = 0;
    let textCount = 0;
    const scale = this.#theme.scale;
    const colorFor = (index: number): number => {
      const draw = this.#drawPalette[index & 15] ?? (index & 15);
      const display = this.#displayPalette[draw & 15] ?? (draw & 15);
      return this.#theme.palette[display] ?? 0xffffff;
    };
    const x = (value: number | undefined): number => ((value ?? 0) - this.#cameraX) * scale;
    const y = (value: number | undefined): number => ((value ?? 0) - this.#cameraY) * scale;
    const drawSprite = (
      sourceX: number, sourceY: number, sourceWidth: number, sourceHeight: number,
      destinationX: number, destinationY: number, destinationWidth: number, destinationHeight: number,
      flipX: boolean, flipY: boolean, semanticTile?: number,
    ): void => {
      const logicalDestinationX = destinationX - this.#cameraX;
      const logicalDestinationY = destinationY - this.#cameraY;
      const semanticTileFullyVisible = logicalDestinationX >= this.#clip.left
        && logicalDestinationY >= this.#clip.top
        && logicalDestinationX + destinationWidth <= this.#clip.right
        && logicalDestinationY + destinationHeight <= this.#clip.bottom;
      if (semanticTile !== undefined && semanticTileFullyVisible && this.#theme.drawSemanticTile?.({
        graphics,
        tile: semanticTile,
        x: x(destinationX),
        y: y(destinationY),
        width: destinationWidth * scale,
        height: destinationHeight * scale,
        color: colorFor,
      })) {
        spriteSurfaceCount += 1;
        continuousPrimitiveCount += 1;
        return;
      }
      const pixels = kernel.spriteRegion(sourceX, sourceY, sourceWidth, sourceHeight);
      const pixelScaleX = destinationWidth / sourceWidth;
      const pixelScaleY = destinationHeight / sourceHeight;
      const visible = (sourcePixelX: number, sourcePixelY: number): boolean => {
        const logicalX = destinationX - this.#cameraX
          + (flipX ? sourceWidth - sourcePixelX - 1 : sourcePixelX) * pixelScaleX;
        const logicalY = destinationY - this.#cameraY
          + (flipY ? sourceHeight - sourcePixelY - 1 : sourcePixelY) * pixelScaleY;
        return logicalX + pixelScaleX > this.#clip.left && logicalX < this.#clip.right
          && logicalY + pixelScaleY > this.#clip.top && logicalY < this.#clip.bottom;
      };
      const surfaces = surfacesFor(pixels, sourceWidth, sourceHeight, this.#transparent, visible);
      for (const surface of surfaces) {
        const path = curvedPath(
          surface.loops, x(destinationX), y(destinationY),
          destinationWidth * scale / sourceWidth, destinationHeight * scale / sourceHeight,
          flipX, flipY, sourceWidth, sourceHeight, this.#theme.contourRounding ?? 0.18,
        );
        const shadow = this.#theme.surfaceShadow;
        if (shadow) {
          const shadowPath = curvedPath(
            surface.loops, x(destinationX) + shadow.offset, y(destinationY) + shadow.offset,
            destinationWidth * scale / sourceWidth, destinationHeight * scale / sourceHeight,
            flipX, flipY, sourceWidth, sourceHeight, this.#theme.contourRounding ?? 0.18,
          );
          graphics.path(shadowPath).fill({ color: shadow.color, alpha: shadow.alpha });
        }
        graphics.path(path).fill({ color: colorFor(surface.color) });
        const highlight = this.#theme.surfaceHighlight;
        if (highlight) graphics.path(path).stroke({ color: highlight.color, alpha: highlight.alpha, width: highlight.width, join: "round" });
        spriteSurfaceCount += 1;
        continuousPrimitiveCount += 1;
      }
    };
    const spriteFlags = kernel.spriteFlags();

    graphics.rect(0, 0, 128 * scale, 128 * scale).fill({ color: this.#theme.backgroundColor ?? colorFor(0) });
    for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
      const command = commands[commandIndex]!;
      const args = command.args;
      if (command.opcode === OPCODE.camera) {
        this.#cameraX = args[0] ?? 0;
        this.#cameraY = args[1] ?? 0;
        continue;
      }
      if (command.opcode === OPCODE.clip) {
        if (command.flags === 0) this.#clip = { left: 0, top: 0, right: 128, bottom: 128 };
        else {
          const left = args[0] ?? 0;
          const top = args[1] ?? 0;
          const width = Math.max(0, args[2] ?? 0);
          const height = Math.max(0, args[3] ?? 0);
          this.#clip = (args[4] ?? 0) !== 0
            ? {
                left: Math.max(this.#clip.left, left),
                top: Math.max(this.#clip.top, top),
                right: Math.min(this.#clip.right, left + width),
                bottom: Math.min(this.#clip.bottom, top + height),
              }
            : { left, top, right: left + width, bottom: top + height };
        }
        continue;
      }
      if (command.opcode === OPCODE.pal) {
        if (command.flags === 0) {
          this.#drawPalette = Array.from({ length: 16 }, (_, color) => color);
          this.#displayPalette = Array.from({ length: 16 }, (_, color) => color);
          this.#transparent = new Set<number>([0]);
        } else if (command.flags === 1) {
          const paletteIndex = integer(args[0]);
          if (paletteIndex === 0) this.#drawPalette = Array.from({ length: 16 }, (_, color) => color);
          else if (paletteIndex === 1) this.#displayPalette = Array.from({ length: 16 }, (_, color) => color);
        } else if (command.flags >= 2) {
          const paletteIndex = integer(args[2]);
          if (paletteIndex === 0) this.#drawPalette[integer(args[0]) & 15] = integer(args[1]) & 15;
          else if (paletteIndex === 1) this.#displayPalette[integer(args[0]) & 15] = integer(args[1]) & 15;
          // Palette 2 drives fillp's compatibility raster. Until the HD
          // presenter has an explicit patterned-surface contract, it must not
          // reinterpret those byte pairs as display-palette entries.
        }
        continue;
      }
      if (command.opcode === OPCODE.palt) {
        if (command.flags === 0) this.#transparent = new Set<number>([0]);
        else if (command.flags === 1) {
          const mask = integer(args[0]) & 0xffff;
          this.#transparent = new Set(Array.from({ length: 16 }, (_, color) => color)
            .filter((color) => (mask & (1 << (15 - color))) !== 0));
        } else {
          const color = integer(args[0]) & 15;
          if ((args[1] ?? 1) !== 0) this.#transparent.add(color);
          else this.#transparent.delete(color);
        }
        continue;
      }
      if (command.opcode === OPCODE.cls) {
        graphics.clear();
        graphics.rect(0, 0, 128 * scale, 128 * scale).fill({ color: colorFor(integer(args[0])) });
        sourcePrimitiveCount += 1;
        continuousPrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.pset) {
        let batchEnd = commandIndex + 1;
        while (batchEnd < commands.length && commands[batchEnd]!.opcode === OPCODE.pset) batchEnd += 1;
        if (batchEnd - commandIndex >= 64) {
          const touched = new Set<string>();
          let left = 128;
          let top = 128;
          let right = -1;
          let bottom = -1;
          for (let index = commandIndex; index < batchEnd; index += 1) {
            const point = commands[index]!;
            const logicalX = integer(point.args[0]) - this.#cameraX;
            const logicalY = integer(point.args[1]) - this.#cameraY;
            if (logicalX < this.#clip.left || logicalX >= this.#clip.right
              || logicalY < this.#clip.top || logicalY >= this.#clip.bottom
              || logicalX < 0 || logicalX >= 128 || logicalY < 0 || logicalY >= 128) continue;
            touched.add(`${logicalX},${logicalY}`);
            left = Math.min(left, logicalX);
            top = Math.min(top, logicalY);
            right = Math.max(right, logicalX);
            bottom = Math.max(bottom, logicalY);
          }
          if (right >= left && bottom >= top) {
            const width = right - left + 1;
            const height = bottom - top + 1;
            const framebuffer = kernel.framebuffer();
            const pixels = Uint8Array.from({ length: width * height }, (_, offset) => {
              const logicalX = left + offset % width;
              const logicalY = top + Math.floor(offset / width);
              return framebuffer[logicalY * 128 + logicalX] ?? 0;
            });
            const surfaces = surfacesFor(
              pixels,
              width,
              height,
              new Set<number>(),
              (localX, localY) => touched.has(`${left + localX},${top + localY}`),
            );
            for (const surface of surfaces) {
              const path = curvedPath(surface.loops, left * scale, top * scale, scale, scale,
                false, false, width, height, this.#theme.contourRounding ?? 0.18);
              graphics.path(path).fill({ color: colorFor(surface.color) });
              continuousPrimitiveCount += 1;
            }
          }
          sourcePrimitiveCount += batchEnd - commandIndex;
          commandIndex = batchEnd - 1;
          continue;
        }
        graphics.circle(x(args[0]) + scale / 2, y(args[1]) + scale / 2, scale / 2).fill({ color: colorFor(integer(args[2], 6)) });
        sourcePrimitiveCount += 1;
        continuousPrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.line) {
        graphics.moveTo(x(args[0]) + scale / 2, y(args[1]) + scale / 2)
          .lineTo(x(args[2]) + scale / 2, y(args[3]) + scale / 2)
          .stroke({ color: colorFor(integer(args[4], 6)), width: scale, cap: "round", join: "round" });
        sourcePrimitiveCount += 1;
        continuousPrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.rect || command.opcode === OPCODE.rectfill) {
        const left = x(Math.min(args[0] ?? 0, args[2] ?? 0));
        const top = y(Math.min(args[1] ?? 0, args[3] ?? 0));
        const width = (Math.abs((args[2] ?? 0) - (args[0] ?? 0)) + 1) * scale;
        const height = (Math.abs((args[3] ?? 0) - (args[1] ?? 0)) + 1) * scale;
        if (command.opcode === OPCODE.rectfill) graphics.roundRect(left, top, width, height, Math.min(5, scale * 0.35)).fill({ color: colorFor(integer(args[4], 6)) });
        else graphics.roundRect(left + scale / 2, top + scale / 2, Math.max(0, width - scale), Math.max(0, height - scale), Math.min(5, scale * 0.35))
          .stroke({ color: colorFor(integer(args[4], 6)), width: scale, join: "round" });
        sourcePrimitiveCount += 1;
        continuousPrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.circ || command.opcode === OPCODE.circfill) {
        const radius = Math.max(0, args[2] ?? 0) * scale + scale / 2;
        const circle = graphics.circle(x(args[0]) + scale / 2, y(args[1]) + scale / 2, radius);
        if (command.opcode === OPCODE.circfill) circle.fill({ color: colorFor(integer(args[3], 6)) });
        else circle.stroke({ color: colorFor(integer(args[3], 6)), width: scale });
        sourcePrimitiveCount += 1;
        continuousPrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.oval || command.opcode === OPCODE.ovalfill) {
        const left = x(Math.min(args[0] ?? 0, args[2] ?? 0));
        const top = y(Math.min(args[1] ?? 0, args[3] ?? 0));
        const width = (Math.abs((args[2] ?? 0) - (args[0] ?? 0)) + 1) * scale;
        const height = (Math.abs((args[3] ?? 0) - (args[1] ?? 0)) + 1) * scale;
        const oval = graphics.ellipse(left + width / 2, top + height / 2, width / 2, height / 2);
        if (command.opcode === OPCODE.ovalfill) oval.fill({ color: colorFor(integer(args[4], 6)) });
        else oval.stroke({ color: colorFor(integer(args[4], 6)), width: scale });
        sourcePrimitiveCount += 1;
        continuousPrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.spr) {
        const first = integer(args[0]);
        const widthTiles = Math.max(1, integer(args[3], 1));
        const heightTiles = Math.max(1, integer(args[4], 1));
        drawSprite((first % 16) * 8, Math.floor(first / 16) * 8, widthTiles * 8, heightTiles * 8,
          args[1] ?? 0, args[2] ?? 0, widthTiles * 8, heightTiles * 8, (args[5] ?? 0) !== 0, (args[6] ?? 0) !== 0,
          widthTiles === 1 && heightTiles === 1 ? first : undefined);
        sourcePrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.sspr) {
        drawSprite(integer(args[0]), integer(args[1]), Math.max(1, integer(args[2], 1)), Math.max(1, integer(args[3], 1)),
          args[4] ?? 0, args[5] ?? 0, args[6] ?? args[2] ?? 1, args[7] ?? args[3] ?? 1,
          (args[8] ?? 0) !== 0, (args[9] ?? 0) !== 0,
          integer(args[0]) % 8 === 0 && integer(args[1]) % 8 === 0
            && integer(args[2], 1) === 8 && integer(args[3], 1) === 8
            ? Math.floor(integer(args[1]) / 8) * 16 + Math.floor(integer(args[0]) / 8) : undefined);
        sourcePrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.map) {
        const mapX = integer(args[0]);
        const mapY = integer(args[1]);
        const destinationX = args[2] ?? 0;
        const destinationY = args[3] ?? 0;
        const width = Math.max(0, integer(args[4]));
        const height = Math.max(0, integer(args[5]));
        const layer = integer(args[6]);
        const tiles = kernel.mapRegion(mapX, mapY, width, height);
        for (let tileY = 0; tileY < height; tileY += 1) for (let tileX = 0; tileX < width; tileX += 1) {
          const tile = tiles[tileY * width + tileX]!;
          if (tile === 0 || (layer !== 0 && (spriteFlags[tile]! & layer) === 0)) continue;
          drawSprite((tile % 16) * 8, Math.floor(tile / 16) * 8, 8, 8,
            destinationX + tileX * 8, destinationY + tileY * 8, 8, 8, false, false, tile);
        }
        sourcePrimitiveCount += 1;
        continue;
      }
      if (command.opcode === OPCODE.print && command.payload.length > 0) {
        const index = integer(args[2], 7) & 15;
        drawText({ text: this.#decoder.decode(command.payload).replaceAll("\0", ""), x: x(args[0]), y: y(args[1]), color: colorFor(index) });
        textCount += 1;
        sourcePrimitiveCount += 1;
      }
    }
    this.#measurements = { sourcePrimitiveCount, continuousPrimitiveCount, spriteSurfaceCount, textCount, indexedCellQuadCount: 0 };
  }
}
