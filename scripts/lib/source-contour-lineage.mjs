import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9][a-z0-9._-]{1,127}$/;

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertExactKeys(value, required, label) {
  const keys = Object.keys(value).sort();
  const expected = [...required].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function resolvedWorkspaceFile(workspace, relative, label) {
  if (typeof relative !== "string" || path.isAbsolute(relative)) throw new Error(`${label} must be a relative workspace path`);
  const resolved = path.resolve(workspace, relative);
  if (!resolved.startsWith(`${workspace}${path.sep}`) || !fs.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} must resolve to a workspace file`);
  }
  return resolved;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function validateSourceContourLineage(workspacePath, value) {
  const workspace = path.resolve(workspacePath);
  const root = assertObject(value, "source contour lineage");
  assertExactKeys(root, ["schemaVersion", "source", "target", "transform", "masks"], "source contour lineage");
  if (root.schemaVersion !== "aico8.source-contour-lineage.v1") throw new Error("source contour lineage schemaVersion");

  const source = assertObject(root.source, "source contour lineage.source");
  assertExactKeys(source, ["path", "sha256", "crop"], "source contour lineage.source");
  const sourceFile = resolvedWorkspaceFile(workspace, source.path, "source contour lineage.source.path");
  if (!hashPattern.test(source.sha256) || sha256(sourceFile) !== source.sha256) throw new Error("source contour lineage source hash mismatch");
  const crop = assertObject(source.crop, "source contour lineage.source.crop");
  assertExactKeys(crop, ["x", "y", "width", "height"], "source contour lineage.source.crop");
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isInteger)
    || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) throw new Error("source contour lineage crop");

  const target = assertObject(root.target, "source contour lineage.target");
  assertExactKeys(target, ["path", "sha256"], "source contour lineage.target");
  const targetFile = resolvedWorkspaceFile(workspace, target.path, "source contour lineage.target.path");
  if (!hashPattern.test(target.sha256) || sha256(targetFile) !== target.sha256) throw new Error("source contour lineage target hash mismatch");

  const transform = assertObject(root.transform, "source contour lineage.transform");
  assertExactKeys(transform, ["scale", "cornerRadiusTargetPixels", "maximumContourDisplacementSourcePixels"], "source contour lineage.transform");
  if (!Number.isFinite(transform.scale) || transform.scale <= 0
    || !Number.isFinite(transform.cornerRadiusTargetPixels) || transform.cornerRadiusTargetPixels < 0
    || !Number.isFinite(transform.maximumContourDisplacementSourcePixels)
    || transform.maximumContourDisplacementSourcePixels < 0
    || transform.maximumContourDisplacementSourcePixels >= 0.5
    || Math.abs(transform.cornerRadiusTargetPixels / transform.scale - transform.maximumContourDisplacementSourcePixels) > 1e-9) {
    throw new Error("source contour lineage transform must preserve source-cell centers");
  }

  if (!Array.isArray(root.masks) || root.masks.length === 0) throw new Error("source contour lineage masks must not be empty");
  const ids = new Set();
  for (const [index, entryValue] of root.masks.entries()) {
    const entry = assertObject(entryValue, `source contour lineage.masks[${index}]`);
    assertExactKeys(entry, [
      "id", "sourceMaskSha256", "targetDownsampledMaskSha256",
      "sourceComponentCount", "targetComponentCount", "sourceHoleCount", "targetHoleCount",
      "filledCells", "bounds",
    ], `source contour lineage.masks[${index}]`);
    if (!idPattern.test(entry.id) || ids.has(entry.id)) throw new Error(`source contour lineage mask id ${entry.id}`);
    ids.add(entry.id);
    if (!hashPattern.test(entry.sourceMaskSha256) || entry.sourceMaskSha256 !== entry.targetDownsampledMaskSha256) {
      throw new Error(`source contour lineage mask ${entry.id} changed its source-cell projection`);
    }
    for (const key of ["sourceComponentCount", "targetComponentCount", "filledCells"]) {
      if (!Number.isInteger(entry[key]) || entry[key] < 1) throw new Error(`source contour lineage mask ${entry.id} ${key}`);
    }
    for (const key of ["sourceHoleCount", "targetHoleCount"]) {
      if (!Number.isInteger(entry[key]) || entry[key] < 0) throw new Error(`source contour lineage mask ${entry.id} ${key}`);
    }
    if (entry.sourceComponentCount !== entry.targetComponentCount || entry.sourceHoleCount !== entry.targetHoleCount) {
      throw new Error(`source contour lineage mask ${entry.id} changed topology`);
    }
    const bounds = assertObject(entry.bounds, `source contour lineage mask ${entry.id} bounds`);
    assertExactKeys(bounds, ["x", "y", "width", "height"], `source contour lineage mask ${entry.id} bounds`);
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger)
      || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
      || bounds.x + bounds.width > crop.width || bounds.y + bounds.height > crop.height) {
      throw new Error(`source contour lineage mask ${entry.id} bounds escape source crop`);
    }
  }
  return value;
}
