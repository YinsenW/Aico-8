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
