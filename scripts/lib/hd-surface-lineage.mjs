import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { compileSemanticSvg } from "./semantic-svg.mjs";

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function exactKeys(value, required, label) {
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function workspaceFile(workspace, relative, label) {
  if (typeof relative !== "string" || path.isAbsolute(relative)) throw new Error(`${label} must be a relative path`);
  const resolved = path.resolve(workspace, relative);
  if (!resolved.startsWith(`${workspace}${path.sep}`) || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} must resolve to a workspace file`);
  }
  return resolved;
}

function sharedLayer(left, right, third) {
  return left.layerIds.some((id) => right.layerIds.includes(id) && third.layerIds.includes(id));
}

export function validateHdSurfaceLineage(workspacePath, value) {
  const workspace = path.resolve(workspacePath);
  const root = object(value, "HD surface lineage");
  exactKeys(root, ["schemaVersion", "target", "rendering", "surfaces"], "HD surface lineage");
  if (root.schemaVersion !== "aico8.hd-surface-lineage.v1") throw new Error("HD surface lineage schemaVersion");

  const target = object(root.target, "HD surface lineage target");
  exactKeys(target, ["path", "sha256"], "HD surface lineage target");
  const targetFile = workspaceFile(workspace, target.path, "HD surface lineage target.path");
  const targetBytes = fs.readFileSync(targetFile);
  if (!hashPattern.test(target.sha256) || sha256(targetBytes) !== target.sha256) {
    throw new Error("HD surface lineage target hash mismatch");
  }
  const asset = compileSemanticSvg(targetBytes.toString("utf8"), path.basename(target.path));
  const primitives = new Map(asset.primitives.map((primitive) => [primitive.id, primitive]));

  const rendering = object(root.rendering, "HD surface lineage rendering");
  exactKeys(rendering, ["targetPixelsPerSourcePixel", "edgeSupersampleFactor"], "HD surface lineage rendering");
  if (!Number.isFinite(rendering.targetPixelsPerSourcePixel) || rendering.targetPixelsPerSourcePixel < 4) {
    throw new Error("HD surface lineage requires at least four target pixels per source pixel");
  }
  if (!Number.isSafeInteger(rendering.edgeSupersampleFactor) || rendering.edgeSupersampleFactor < 2) {
    throw new Error("HD surface lineage requires deterministic edge supersampling");
  }

  if (!Array.isArray(root.surfaces) || root.surfaces.length === 0) throw new Error("HD surface lineage surfaces must not be empty");
  const ids = new Set();
  for (const [index, surfaceValue] of root.surfaces.entries()) {
    const surface = object(surfaceValue, `HD surface ${index}`);
    exactKeys(surface, [
      "id", "contourAlgorithm", "sourceCellCentersPreserved", "maximumContourDisplacementSourcePixels",
      "basePrimitiveId", "shadePrimitiveId", "highlightPrimitiveId", "protectedNegativeSpaceCount",
      "negativeSpacePrimitiveId",
    ], `HD surface ${index}`);
    if (!idPattern.test(surface.id) || ids.has(surface.id)) throw new Error(`HD surface id ${surface.id}`);
    ids.add(surface.id);
    if (surface.contourAlgorithm !== "topology-constrained-spline-v1") {
      throw new Error(`HD surface ${surface.id} must use topology-constrained splines`);
    }
    if (surface.sourceCellCentersPreserved !== true) throw new Error(`HD surface ${surface.id} changed a source cell centre`);
    if (!Number.isFinite(surface.maximumContourDisplacementSourcePixels)
      || surface.maximumContourDisplacementSourcePixels < 0.3
      || surface.maximumContourDisplacementSourcePixels >= 0.5) {
      throw new Error(`HD surface ${surface.id} smoothing must be visible and remain below half a source pixel`);
    }
    if (!Number.isSafeInteger(surface.protectedNegativeSpaceCount) || surface.protectedNegativeSpaceCount < 0) {
      throw new Error(`HD surface ${surface.id} protectedNegativeSpaceCount must be a non-negative integer`);
    }
    const primitiveIds = [surface.shadePrimitiveId, surface.basePrimitiveId, surface.highlightPrimitiveId];
    if (primitiveIds.some((id) => !idPattern.test(id)) || new Set(primitiveIds).size !== 3) {
      throw new Error(`HD surface ${surface.id} requires distinct shade, base, and highlight primitives`);
    }
    const [shade, base, highlight] = primitiveIds.map((id) => primitives.get(id));
    if (!shade || !base || !highlight) throw new Error(`HD surface ${surface.id} references a missing primitive`);
    if (!base.fill) throw new Error(`HD surface ${surface.id} base primitive must be filled`);
    if (!shade.stroke || !highlight.stroke) throw new Error(`HD surface ${surface.id} shade and highlight must be stroked`);
    if (!sharedLayer(shade, base, highlight)) throw new Error(`HD surface ${surface.id} primitives must share a semantic layer`);
    const curveCommands = base.commands.filter(({ op }) => op === "quadraticCurveTo" || op === "bezierCurveTo").length;
    if (curveCommands < 4 || base.commands.some(({ op }) => op === "lineTo")) {
      throw new Error(`HD surface ${surface.id} base must be a continuous curved contour, not a pixel staircase`);
    }
    if (shade.stroke.alpha <= 0 || highlight.stroke.alpha <= 0
      || shade.stroke.cap !== "round" || shade.stroke.join !== "round"
      || highlight.stroke.cap !== "round" || highlight.stroke.join !== "round") {
      throw new Error(`HD surface ${surface.id} edge treatments must be visible round strokes`);
    }
    const closedSubpaths = (primitive) => primitive.commands.filter(({ op }) => op === "closePath").length;
    const baseSubpaths = closedSubpaths(base);
    const shadeSubpaths = closedSubpaths(shade);
    const highlightSubpaths = closedSubpaths(highlight);
    if (baseSubpaths !== shadeSubpaths || baseSubpaths !== highlightSubpaths) {
      throw new Error(`HD surface ${surface.id} edge treatments occlude protected negative space`);
    }
    if (surface.protectedNegativeSpaceCount === 0) {
      if (surface.negativeSpacePrimitiveId !== null) {
        throw new Error(`HD surface ${surface.id} must not invent a negative-space primitive`);
      }
    } else {
      if (!idPattern.test(surface.negativeSpacePrimitiveId ?? "")) {
        throw new Error(`HD surface ${surface.id} requires a negative-space primitive`);
      }
      const negativeSpace = primitives.get(surface.negativeSpacePrimitiveId);
      if (!negativeSpace || negativeSpace.composite !== "cut" || negativeSpace.fill || negativeSpace.stroke) {
        throw new Error(`HD surface ${surface.id} negative-space primitive must be an unpainted cut composite`);
      }
      if (closedSubpaths(negativeSpace) !== surface.protectedNegativeSpaceCount
        || !negativeSpace.layerIds.some((id) => base.layerIds.includes(id))) {
        throw new Error(`HD surface ${surface.id} negative-space primitive does not match protected counters`);
      }
      const baseIndex = asset.primitives.indexOf(base);
      const cutIndex = asset.primitives.indexOf(negativeSpace);
      const highlightIndex = asset.primitives.indexOf(highlight);
      if (!(baseIndex < cutIndex && cutIndex < highlightIndex)) {
        throw new Error(`HD surface ${surface.id} negative-space cut must follow the base before highlights`);
      }
    }
  }
  return value;
}
