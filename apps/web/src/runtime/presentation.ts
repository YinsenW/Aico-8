import type { Application } from "pixi.js";

import type { Aico8Kernel, DrawCommand } from "./kernel.js";

export interface PresentationDiagnostics {
  readonly sceneId: string;
  readonly sourceTokenIds: readonly string[];
  readonly mappedElementIds: readonly string[];
  readonly unmappedSourceTokenIds: readonly string[];
  readonly mixedIndexedFragments: number;
  readonly diagnosticReferenceSwitches: number;
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
  accessibleDescription?(): string | undefined;
  destroy?(): void;
}

export interface PrivatePresentationModule {
  createPresentation(app: Application): PresentationRenderer;
}
