import {
  sourceContourTopology,
  type SourceContourTopology,
} from "./source-contour.ts";

export interface SourceEdgeSignature {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}

export interface IndexedVisualLayer {
  readonly sourceValue: number;
  readonly mask: readonly (readonly boolean[])[];
  readonly topology: SourceContourTopology;
  readonly edges: SourceEdgeSignature;
}

export interface VisualStructureVariant {
  readonly id: string;
  readonly recipeId: string;
  readonly layers: readonly IndexedVisualLayer[];
}

function dimensions<T>(grid: readonly (readonly T[])[]): { width: number; height: number } {
  if (grid.length === 0 || grid[0]?.length === 0) throw new Error("visual structure grid must not be empty");
  const width = grid[0]!.length;
  if (grid.some((row) => row.length !== width)) throw new Error("visual structure grid rows must have equal width");
  return { width, height: grid.length };
}

function maskSignature(mask: readonly (readonly boolean[])[]): string {
  const { width, height } = dimensions(mask);
  return `${width}x${height}:${mask.map((row) => row.map((cell) => cell ? "1" : "0").join("")).join("/")}`;
}

export function sourceEdgeSignature(mask: readonly (readonly boolean[])[]): SourceEdgeSignature {
  const { width, height } = dimensions(mask);
  return {
    top: mask[0]!.map((cell) => cell ? "1" : "0").join(""),
    right: Array.from({ length: height }, (_, y) => mask[y]![width - 1] ? "1" : "0").join(""),
    bottom: mask[height - 1]!.map((cell) => cell ? "1" : "0").join(""),
    left: Array.from({ length: height }, (_, y) => mask[y]![0] ? "1" : "0").join(""),
  };
}

export function indexedVisualLayers(
  grid: readonly (readonly number[])[],
  transparentValues: readonly number[] = [0],
): IndexedVisualLayer[] {
  dimensions(grid);
  if (grid.some((row) => row.some((value) => !Number.isSafeInteger(value) || value < 0))) {
    throw new Error("visual structure values must be non-negative safe integers");
  }
  const transparent = new Set(transparentValues);
  const values = [...new Set(grid.flat())].filter((value) => !transparent.has(value)).sort((left, right) => left - right);
  return values.map((sourceValue) => {
    const mask = grid.map((row) => row.map((value) => value === sourceValue));
    return {
      sourceValue,
      mask,
      topology: sourceContourTopology(mask),
      edges: sourceEdgeSignature(mask),
    };
  });
}

export function visualStructureSignature(layers: readonly IndexedVisualLayer[]): string {
  if (layers.length === 0) return "empty";
  return [...layers]
    .sort((left, right) => left.sourceValue - right.sourceValue)
    .map((layer) => `${layer.sourceValue}:${maskSignature(layer.mask)}:${JSON.stringify(layer.edges)}`)
    .join("|");
}

export function visualStructureProjectionErrors(
  source: readonly IndexedVisualLayer[],
  target: readonly IndexedVisualLayer[],
): string[] {
  const errors: string[] = [];
  const sourceByValue = new Map(source.map((layer) => [layer.sourceValue, layer]));
  const targetByValue = new Map(target.map((layer) => [layer.sourceValue, layer]));
  const sourceValues = [...sourceByValue.keys()].sort((left, right) => left - right);
  const targetValues = [...targetByValue.keys()].sort((left, right) => left - right);
  if (sourceValues.join(",") !== targetValues.join(",")) {
    errors.push(`material layers changed from [${sourceValues.join(", ")}] to [${targetValues.join(", ")}]`);
  }
  for (const value of sourceValues) {
    const sourceLayer = sourceByValue.get(value)!;
    const targetLayer = targetByValue.get(value);
    if (!targetLayer) continue;
    if (maskSignature(sourceLayer.mask) !== maskSignature(targetLayer.mask)) {
      errors.push(`layer ${value} changed its occupied-cell contour`);
    }
    if (sourceLayer.topology.componentCount !== targetLayer.topology.componentCount
      || sourceLayer.topology.holeCount !== targetLayer.topology.holeCount) {
      errors.push(`layer ${value} changed component/hole topology`);
    }
    if (JSON.stringify(sourceLayer.edges) !== JSON.stringify(targetLayer.edges)) {
      errors.push(`layer ${value} changed adjacency edges`);
    }
  }
  return errors;
}

/** Different source structures may share code, but never one frozen recipe. */
export function visualVariantCollapseErrors(variants: readonly VisualStructureVariant[]): string[] {
  const errors: string[] = [];
  const signaturesByRecipe = new Map<string, Map<string, string[]>>();
  for (const variant of variants) {
    const bySignature = signaturesByRecipe.get(variant.recipeId) ?? new Map<string, string[]>();
    const signature = visualStructureSignature(variant.layers);
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), variant.id]);
    signaturesByRecipe.set(variant.recipeId, bySignature);
  }
  for (const [recipeId, bySignature] of signaturesByRecipe) {
    if (bySignature.size <= 1) continue;
    const ids = [...bySignature.values()].flat().sort();
    errors.push(`recipe ${recipeId} collapses structurally distinct variants: ${ids.join(", ")}`);
  }
  return errors;
}
