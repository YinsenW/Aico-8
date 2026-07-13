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
