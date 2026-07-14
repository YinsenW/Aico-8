import { Graphics, GraphicsContext } from "pixi.js";

export type SemanticVectorCommand = {
  readonly op: "moveTo" | "lineTo" | "bezierCurveTo" | "quadraticCurveTo" | "closePath"
    | "rect" | "roundRect" | "circle" | "ellipse";
  readonly values: readonly number[];
};

export type SemanticVectorPaint = {
  readonly color?: number;
  readonly token?: string;
  readonly alpha: number;
};

export type SemanticVectorStroke = SemanticVectorPaint & {
  readonly width: number;
  readonly cap: "butt" | "round" | "square";
  readonly join: "bevel" | "miter" | "round";
};

export interface SemanticVectorPrimitive {
  readonly id: string;
  readonly layerIds: readonly string[];
  readonly commands: readonly SemanticVectorCommand[];
  readonly fill?: SemanticVectorPaint;
  readonly stroke?: SemanticVectorStroke;
  readonly composite?: "cut";
}

export interface SemanticVectorAsset {
  readonly schemaVersion: "aico8.semantic-vector-source.v1";
  readonly id: string;
  readonly sourceSha256: string;
  readonly sourceBytes: number;
  readonly recipeSha256: string;
  readonly viewBox: readonly [number, number, number, number];
  readonly origin: readonly [number, number];
  readonly requiredLayerIds: readonly string[];
  readonly elementIds: readonly string[];
  readonly primitives: readonly SemanticVectorPrimitive[];
}

export interface SemanticVectorRenderOptions {
  readonly includeLayerIds?: readonly string[];
  readonly excludeLayerIds?: readonly string[];
  readonly palette?: Readonly<Record<string, number>>;
}

function resolvedPaint(paint: SemanticVectorPaint, palette: Readonly<Record<string, number>>) {
  const color = paint.token ? palette[paint.token] : paint.color;
  if (color === undefined) throw new Error(`Semantic vector paint token is unresolved: ${paint.token ?? "unknown"}`);
  return { color, alpha: paint.alpha };
}

function invoke(graphics: Graphics | GraphicsContext, command: SemanticVectorCommand): void {
  const values = command.values as number[];
  switch (command.op) {
    case "moveTo": graphics.moveTo(values[0]!, values[1]!); break;
    case "lineTo": graphics.lineTo(values[0]!, values[1]!); break;
    case "bezierCurveTo": graphics.bezierCurveTo(values[0]!, values[1]!, values[2]!, values[3]!, values[4]!, values[5]!); break;
    case "quadraticCurveTo": graphics.quadraticCurveTo(values[0]!, values[1]!, values[2]!, values[3]!); break;
    case "closePath": graphics.closePath(); break;
    case "rect": graphics.rect(values[0]!, values[1]!, values[2]!, values[3]!); break;
    case "roundRect": graphics.roundRect(values[0]!, values[1]!, values[2]!, values[3]!, values[4]!); break;
    case "circle": graphics.circle(values[0]!, values[1]!, values[2]!); break;
    case "ellipse": graphics.ellipse(values[0]!, values[1]!, values[2]!, values[3]!); break;
  }
}

type InternalShape = {
  readonly points?: readonly number[];
  readonly x?: number;
  readonly y?: number;
  contains(x: number, y: number): boolean;
};

type InternalShapePrimitive = {
  readonly shape: InternalShape;
  holes?: InternalShapePrimitive[];
};

type InternalInstruction = {
  readonly action: string;
  readonly data: {
    path?: { readonly shapePath: { readonly shapePrimitives: readonly InternalShapePrimitive[] } };
    hole?: { readonly shapePath: { readonly shapePrimitives: readonly InternalShapePrimitive[] } };
  };
};

/**
 * Pixi assigns a cut path to the last subpath of a compound fill. Semantic
 * vectors may contain several disconnected source components, so distribute
 * every protected counter to the component that actually contains it. This
 * avoids renderer-dependent SVG winding behaviour and keeps facial details or
 * glyph counters open even when one primitive contains many components.
 */
function cutSemanticVector(graphics: Graphics | GraphicsContext): void {
  graphics.cut();
  const context = (graphics instanceof Graphics ? graphics.context : graphics) as unknown as {
    readonly instructions: InternalInstruction[];
  };
  const affected = context.instructions.slice(-2).filter(({ data }) => data.hole);
  const fill = [...affected].reverse().find(({ action }) => action === "fill");
  const holes = fill?.data.hole?.shapePath.shapePrimitives;
  const components = fill?.data.path?.shapePath.shapePrimitives;
  for (const instruction of affected) delete instruction.data.hole;
  if (!fill || !holes || !components) throw new Error("Semantic vector cut must immediately follow a filled primitive");
  for (const hole of holes) {
    const points = hole.shape.points ?? [];
    const probes = [
      ...(hole.shape.x !== undefined && hole.shape.y !== undefined
        ? [{ x: hole.shape.x, y: hole.shape.y }]
        : []),
      ...Array.from({ length: Math.floor(points.length / 2) }, (_, index) => ({
        x: points[index * 2]!, y: points[index * 2 + 1]!,
      })),
    ];
    const component = components.find(({ shape }) => probes.some(({ x, y }) => shape.contains(x, y)));
    if (!component) throw new Error("Semantic vector cut is not contained by its preceding fill");
    component.holes = [...(component.holes ?? []), hole];
  }
}

export function drawSemanticVector(
  graphics: Graphics | GraphicsContext,
  asset: SemanticVectorAsset,
  options: SemanticVectorRenderOptions = {},
): void {
  const include = new Set(options.includeLayerIds ?? []);
  const exclude = new Set(options.excludeLayerIds ?? []);
  const palette = options.palette ?? {};
  for (const primitive of asset.primitives) {
    if (include.size > 0 && !primitive.layerIds.some((id) => include.has(id))) continue;
    if (primitive.layerIds.some((id) => exclude.has(id))) continue;
    graphics.beginPath();
    for (const command of primitive.commands) invoke(graphics, command);
    if (primitive.composite === "cut") {
      cutSemanticVector(graphics);
      continue;
    }
    if (primitive.fill) graphics.fill(resolvedPaint(primitive.fill, palette));
    if (primitive.stroke) {
      graphics.stroke({
        ...resolvedPaint(primitive.stroke, palette),
        width: primitive.stroke.width,
        cap: primitive.stroke.cap,
        join: primitive.stroke.join,
      });
    }
  }
}

export function createSemanticVectorContext(
  asset: SemanticVectorAsset,
  options: SemanticVectorRenderOptions = {},
): GraphicsContext {
  const context = new GraphicsContext();
  drawSemanticVector(context, asset, options);
  return context;
}
