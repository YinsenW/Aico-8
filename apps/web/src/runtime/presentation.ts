import type { Application } from "pixi.js";

import type { Aico8Kernel, DrawCommand } from "./kernel.js";

export interface PresentationRenderer {
  setVisible(visible: boolean): void;
  update(kernel: Aico8Kernel, commands: readonly DrawCommand[]): void;
  animate(deltaMilliseconds: number): void;
  accessibleDescription?(): string | undefined;
  destroy?(): void;
}

export interface PrivatePresentationModule {
  createPresentation(app: Application): PresentationRenderer;
}
