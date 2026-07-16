import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;

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

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileSha256 = (file) => sha256(fs.readFileSync(file));
const structureSha256 = (layers) => sha256(JSON.stringify(layers.map((layer) => ({
  sourceValue: layer.sourceValue,
  sourceMaskSha256: layer.sourceMaskSha256,
  edges: layer.edges.source,
}))));

export function validateSourceVisualStructureLineage(workspacePath, value) {
  const workspace = path.resolve(workspacePath);
  const root = object(value, "source visual structure lineage");
  exactKeys(root, ["schemaVersion", "source", "target", "variants"], "source visual structure lineage");
  if (root.schemaVersion !== "aico8.source-visual-structure-lineage.v1") throw new Error("source visual structure lineage schemaVersion");
  for (const name of ["source", "target"]) {
    const record = object(root[name], `source visual structure lineage.${name}`);
    exactKeys(record, ["path", "sha256"], `source visual structure lineage.${name}`);
    const file = workspaceFile(workspace, record.path, `source visual structure lineage.${name}.path`);
    if (!hashPattern.test(record.sha256) || fileSha256(file) !== record.sha256) {
      throw new Error(`source visual structure lineage ${name} hash mismatch`);
    }
  }
  if (!Array.isArray(root.variants) || root.variants.length === 0) throw new Error("source visual structure variants must not be empty");
  const variantIds = new Set();
  const structuresByRecipe = new Map();
  for (const [variantIndex, variantValue] of root.variants.entries()) {
    const variant = object(variantValue, `source visual structure variants[${variantIndex}]`);
    exactKeys(variant, ["id", "recipeId", "structureSha256", "layers"], `source visual structure variant ${variantIndex}`);
    if (!idPattern.test(variant.id) || variantIds.has(variant.id)) throw new Error(`source visual structure variant id ${variant.id}`);
    variantIds.add(variant.id);
    if (!idPattern.test(variant.recipeId)) throw new Error(`source visual structure recipe id ${variant.recipeId}`);
    if (!Array.isArray(variant.layers) || variant.layers.length === 0) throw new Error(`source visual structure variant ${variant.id} layers`);
    const sourceValues = new Set();
    for (const [layerIndex, layerValue] of variant.layers.entries()) {
      const layer = object(layerValue, `source visual structure variant ${variant.id} layer ${layerIndex}`);
      exactKeys(layer, [
        "sourceValue", "sourceMaskSha256", "targetDownsampledMaskSha256",
        "sourceComponentCount", "targetComponentCount", "sourceHoleCount", "targetHoleCount", "edges",
      ], `source visual structure variant ${variant.id} layer ${layerIndex}`);
      if (!Number.isSafeInteger(layer.sourceValue) || layer.sourceValue < 0 || sourceValues.has(layer.sourceValue)) {
        throw new Error(`source visual structure variant ${variant.id} sourceValue`);
      }
      sourceValues.add(layer.sourceValue);
      if (!hashPattern.test(layer.sourceMaskSha256) || layer.sourceMaskSha256 !== layer.targetDownsampledMaskSha256) {
        throw new Error(`source visual structure variant ${variant.id} layer ${layer.sourceValue} changed contour`);
      }
      for (const key of ["sourceComponentCount", "targetComponentCount"]) {
        if (!Number.isSafeInteger(layer[key]) || layer[key] < 1) throw new Error(`source visual structure ${variant.id} ${key}`);
      }
      for (const key of ["sourceHoleCount", "targetHoleCount"]) {
        if (!Number.isSafeInteger(layer[key]) || layer[key] < 0) throw new Error(`source visual structure ${variant.id} ${key}`);
      }
      if (layer.sourceComponentCount !== layer.targetComponentCount || layer.sourceHoleCount !== layer.targetHoleCount) {
        throw new Error(`source visual structure variant ${variant.id} layer ${layer.sourceValue} changed topology`);
      }
      const edges = object(layer.edges, `source visual structure variant ${variant.id} edges`);
      exactKeys(edges, ["source", "target"], `source visual structure variant ${variant.id} edges`);
      for (const edgeSet of [edges.source, edges.target]) {
        exactKeys(object(edgeSet, "source visual structure edge set"), ["top", "right", "bottom", "left"], "source visual structure edge set");
        if (Object.values(edgeSet).some((edge) => typeof edge !== "string" || !/^[01]+$/.test(edge))) {
          throw new Error(`source visual structure variant ${variant.id} has invalid edges`);
        }
      }
      if (JSON.stringify(edges.source) !== JSON.stringify(edges.target)) {
        throw new Error(`source visual structure variant ${variant.id} layer ${layer.sourceValue} changed adjacency edges`);
      }
    }
    const computed = structureSha256(variant.layers);
    if (variant.structureSha256 !== computed) throw new Error(`source visual structure variant ${variant.id} structure hash mismatch`);
    const structures = structuresByRecipe.get(variant.recipeId) ?? new Set();
    structures.add(computed);
    structuresByRecipe.set(variant.recipeId, structures);
  }
  for (const [recipeId, structures] of structuresByRecipe) {
    if (structures.size > 1) throw new Error(`source visual structure recipe ${recipeId} collapses distinct variants`);
  }
  return value;
}
