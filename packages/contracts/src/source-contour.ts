export interface MaskPoint {
  readonly x: number;
  readonly y: number;
}

export interface SourceContourTopology {
  readonly filledCells: number;
  readonly componentCount: number;
  readonly holeCount: number;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface RoundedSourceContour {
  readonly path: string;
  readonly topology: SourceContourTopology;
  readonly maximumContourDisplacementSourcePixels: number;
}

type Edge = { readonly from: MaskPoint; readonly to: MaskPoint; readonly direction: number };

function pointKey(point: MaskPoint): string {
  return `${point.x},${point.y}`;
}

function samePoint(left: MaskPoint, right: MaskPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

function validateMask(mask: readonly (readonly boolean[])[]): { width: number; height: number } {
  if (mask.length === 0 || mask[0]?.length === 0) throw new Error("source contour mask must not be empty");
  const width = mask[0]!.length;
  if (mask.some((row) => row.length !== width)) throw new Error("source contour mask rows must have equal width");
  if (!mask.some((row) => row.some(Boolean))) throw new Error("source contour mask must contain a filled cell");
  return { width, height: mask.length };
}

function boundaryEdges(mask: readonly (readonly boolean[])[]): Edge[] {
  const { width, height } = validateMask(mask);
  const filled = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && mask[y]![x]!;
  const edges: Edge[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) edges.push({ from: { x, y }, to: { x: x + 1, y }, direction: 0 });
      if (!filled(x + 1, y)) edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 }, direction: 1 });
      if (!filled(x, y + 1)) edges.push({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 }, direction: 2 });
      if (!filled(x - 1, y)) edges.push({ from: { x, y: y + 1 }, to: { x, y }, direction: 3 });
    }
  }
  return edges;
}

function simplifiedLoop(points: readonly MaskPoint[]): MaskPoint[] {
  const result = [...points];
  let changed = true;
  while (changed && result.length > 4) {
    changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const previous = result[(index - 1 + result.length) % result.length]!;
      const current = result[index]!;
      const next = result[(index + 1) % result.length]!;
      if ((previous.x === current.x && current.x === next.x)
        || (previous.y === current.y && current.y === next.y)) {
        result.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

export function traceSourceMaskContours(mask: readonly (readonly boolean[])[]): MaskPoint[][] {
  const edges = boundaryEdges(mask);
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    const key = pointKey(edge.from);
    outgoing.set(key, [...(outgoing.get(key) ?? []), index]);
  });
  const used = new Set<number>();
  const loops: MaskPoint[][] = [];
  for (let initialIndex = 0; initialIndex < edges.length; initialIndex += 1) {
    if (used.has(initialIndex)) continue;
    const initial = edges[initialIndex]!;
    const points: MaskPoint[] = [initial.from];
    let edgeIndex = initialIndex;
    while (true) {
      if (used.has(edgeIndex)) throw new Error("source contour boundary contains a premature cycle");
      used.add(edgeIndex);
      const edge = edges[edgeIndex]!;
      if (samePoint(edge.to, initial.from)) break;
      points.push(edge.to);
      const candidates = (outgoing.get(pointKey(edge.to)) ?? []).filter((index) => !used.has(index));
      if (candidates.length === 0) throw new Error("source contour boundary is open");
      const preference = [
        (edge.direction + 1) % 4,
        edge.direction,
        (edge.direction + 3) % 4,
        (edge.direction + 2) % 4,
      ];
      edgeIndex = candidates.sort((left, right) =>
        preference.indexOf(edges[left]!.direction) - preference.indexOf(edges[right]!.direction))[0]!;
    }
    loops.push(simplifiedLoop(points));
  }
  return loops;
}

function signedArea(points: readonly MaskPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function format(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function roundedLoopPath(
  points: readonly MaskPoint[],
  scale: number,
  radius: number,
  offsetX: number,
  offsetY: number,
): string {
  const corners = points.map((point, index) => {
    const previous = points[(index - 1 + points.length) % points.length]!;
    const next = points[(index + 1) % points.length]!;
    const incomingLength = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const outgoingLength = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const localRadius = Math.min(radius, incomingLength * scale / 2, outgoingLength * scale / 2);
    const incoming = { x: Math.sign(point.x - previous.x), y: Math.sign(point.y - previous.y) };
    const outgoing = { x: Math.sign(next.x - point.x), y: Math.sign(next.y - point.y) };
    const vertex = { x: offsetX + point.x * scale, y: offsetY + point.y * scale };
    return {
      entry: { x: vertex.x - incoming.x * localRadius, y: vertex.y - incoming.y * localRadius },
      vertex,
      exit: { x: vertex.x + outgoing.x * localRadius, y: vertex.y + outgoing.y * localRadius },
    };
  });
  const first = corners[0]!;
  const commands = [`M ${format(first.entry.x)} ${format(first.entry.y)}`];
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]!;
    const next = corners[(index + 1) % corners.length]!;
    commands.push(`Q ${format(corner.vertex.x)} ${format(corner.vertex.y)} ${format(corner.exit.x)} ${format(corner.exit.y)}`);
    commands.push(`L ${format(next.entry.x)} ${format(next.entry.y)}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

export function sourceContourTopology(mask: readonly (readonly boolean[])[]): SourceContourTopology {
  const { width, height } = validateMask(mask);
  const loops = traceSourceMaskContours(mask);
  let minimumX = width;
  let minimumY = height;
  let maximumX = 0;
  let maximumY = 0;
  let filledCells = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y]![x]) continue;
      filledCells += 1;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x + 1);
      maximumY = Math.max(maximumY, y + 1);
    }
  }
  return {
    filledCells,
    componentCount: loops.filter((loop) => signedArea(loop) > 0).length,
    holeCount: loops.filter((loop) => signedArea(loop) < 0).length,
    bounds: { x: minimumX, y: minimumY, width: maximumX - minimumX, height: maximumY - minimumY },
  };
}

export function roundedSourceContour(
  mask: readonly (readonly boolean[])[],
  options: { readonly scale: number; readonly radius: number; readonly offsetX?: number; readonly offsetY?: number },
): RoundedSourceContour {
  if (!Number.isFinite(options.scale) || options.scale <= 0) throw new Error("source contour scale must be positive");
  if (!Number.isFinite(options.radius) || options.radius < 0 || options.radius >= options.scale / 2) {
    throw new Error("source contour radius must be non-negative and smaller than half a source pixel");
  }
  const loops = traceSourceMaskContours(mask);
  return {
    path: loops.map((loop) => roundedLoopPath(
      loop,
      options.scale,
      options.radius,
      options.offsetX ?? 0,
      options.offsetY ?? 0,
    )).join(" "),
    topology: sourceContourTopology(mask),
    maximumContourDisplacementSourcePixels: options.radius / options.scale,
  };
}
