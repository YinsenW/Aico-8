import type { Application } from "pixi.js";

import type { SourceDerivedAccessibleDescriptionV1 } from "@aico8/contracts";

import type { Aico8Kernel, DrawCommand } from "./kernel.js";

export interface PresentationDiagnostics {
  readonly sceneId: string;
  readonly sourceTokenIds: readonly string[];
  readonly mappedElementIds: readonly string[];
  readonly unmappedSourceTokenIds: readonly string[];
  readonly mixedIndexedFragments: number;
  readonly diagnosticReferenceSwitches: number;
  readonly presentationMeasurements?: Readonly<Record<string, string | number>>;
}

export interface SourceAuthoredCopyContract {
  readonly id: string;
  readonly template: string;
  readonly sourceEvidence: string;
}

/**
 * Renders cart-authored copy without permitting an HD adapter to normalize its
 * case, punctuation, spacing, or number format. Typography may change; words do
 * not. The declared source evidence is retained for the review packet.
 */
export function sourceAuthoredCopy(
  contract: SourceAuthoredCopyContract,
  values: Readonly<Record<string, string | number>> = {},
): string {
  if (!contract.id.trim() || !contract.sourceEvidence.trim()) {
    throw new TypeError("Source-authored copy requires an ID and source evidence");
  }
  const placeholders = [...contract.template.matchAll(/\{([a-z][a-z0-9-]*)\}/g)]
    .map((match) => match[1]!);
  const required = new Set(placeholders);
  const provided = Object.keys(values);
  const missing = [...required].filter((name) => !(name in values));
  const unexpected = provided.filter((name) => !required.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new TypeError(
      `Source-authored copy binding mismatch for ${contract.id}`
      + `${missing.length > 0 ? `; missing ${missing.join(", ")}` : ""}`
      + `${unexpected.length > 0 ? `; unexpected ${unexpected.join(", ")}` : ""}`,
    );
  }
  return contract.template.replace(/\{([a-z][a-z0-9-]*)\}/g, (_match, name: string) => {
    const value = values[name]!;
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError(`Source-authored copy value ${name} must be finite`);
    }
    return String(value);
  });
}

/**
 * Keeps a modern visual tied to the source frame that authorizes it.  Callers
 * must pass tokens from the current logical update; scene membership or a token
 * observed in an earlier frame is not enough to reveal source-timed content.
 */
export function sourceTimedVisibility(
  currentSourceTokenIds: readonly string[],
  requiredSourceTokenIds: readonly string[],
): boolean {
  if (requiredSourceTokenIds.length === 0) {
    throw new TypeError("A source-timed visual must declare at least one source token");
  }
  if (new Set(requiredSourceTokenIds).size !== requiredSourceTokenIds.length) {
    throw new TypeError("A source-timed visual cannot declare duplicate source tokens");
  }
  const current = new Set(currentSourceTokenIds);
  return requiredSourceTokenIds.every((tokenId) => current.has(tokenId));
}

/**
 * Keeps a modern element tied to the source elements mapped for the current
 * logical update.  This is the coarse-grained companion to token visibility:
 * renderers use it to prevent whole actors, environments, UI, or effects from
 * leaking into a transition frame that only authorizes the scene itself.
 */
export function sourceTimedElementVisibility(
  currentMappedElementIds: readonly string[],
  requiredMappedElementIds: readonly string[],
): boolean {
  if (requiredMappedElementIds.length === 0) {
    throw new TypeError("A source-timed visual must declare at least one mapped element");
  }
  if (new Set(requiredMappedElementIds).size !== requiredMappedElementIds.length) {
    throw new TypeError("A source-timed visual cannot declare duplicate mapped elements");
  }
  const current = new Set(currentMappedElementIds);
  return requiredMappedElementIds.every((elementId) => current.has(elementId));
}

export interface PresentationRenderer {
  setVisible(visible: boolean): void;
  update(kernel: Aico8Kernel, commands: readonly DrawCommand[]): void;
  animate(deltaMilliseconds: number): void;
  diagnostics?(): PresentationDiagnostics | undefined;
  /** @deprecated Accepted builds use accessibleDescriptionEvidence instead. */
  accessibleDescription?(): string | undefined;
  accessibleDescriptionEvidence?(): SourceDerivedAccessibleDescriptionV1 | undefined;
  destroy?(): void;
}

export interface PrivatePresentationModule {
  createPresentation(app: Application): PresentationRenderer;
}
