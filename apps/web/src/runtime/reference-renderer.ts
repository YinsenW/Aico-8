import { Application, Container, Sprite, Text, Texture } from "pixi.js";

import { REFERENCE_PROFILE } from "@aico8/contracts";

import type { DrawCommand } from "./kernel.js";
import { pico8FramebufferColor } from "./pico8-palette.js";

const PRINT_OPCODE = 14;

export class ReferenceRenderer {
  readonly #root = new Container();
  readonly #canvas = document.createElement("canvas");
  readonly #context: CanvasRenderingContext2D;
  readonly #image: ImageData;
  readonly #texture: Texture;
  readonly #textLayer = new Container();

  constructor(app: Application) {
    this.#canvas.width = REFERENCE_PROFILE.logicalWidth;
    this.#canvas.height = REFERENCE_PROFILE.logicalHeight;
    const context = this.#canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is not available");
    this.#context = context;
    this.#image = context.createImageData(REFERENCE_PROFILE.logicalWidth, REFERENCE_PROFILE.logicalHeight);
    this.#texture = Texture.from(this.#canvas);
    this.#texture.source.scaleMode = "nearest";

    const sprite = new Sprite(this.#texture);
    sprite.width = REFERENCE_PROFILE.outputWidth;
    sprite.height = REFERENCE_PROFILE.outputHeight;
    this.#root.addChild(sprite, this.#textLayer);
    app.stage.addChild(this.#root);
  }

  setVisible(visible: boolean): void {
    this.#root.visible = visible;
  }

  render(
    framebuffer: Uint8Array,
    displayPalette: Uint8Array,
    commands: readonly DrawCommand[],
  ): void {
    const rgba = this.#image.data;
    for (let pixel = 0; pixel < framebuffer.length; pixel += 1) {
      const color = pico8FramebufferColor(framebuffer[pixel] ?? 0, displayPalette);
      const offset = pixel * 4;
      rgba[offset] = color >> 16;
      rgba[offset + 1] = (color >> 8) & 0xff;
      rgba[offset + 2] = color & 0xff;
      rgba[offset + 3] = 0xff;
    }
    this.#context.putImageData(this.#image, 0, 0);
    this.#texture.source.update();

    this.#textLayer.removeChildren().forEach((child) => child.destroy());
    const decoder = new TextDecoder();
    for (const command of commands) {
      if (command.opcode !== PRINT_OPCODE || command.payload.length === 0) continue;
      const label = new Text({
        text: decoder.decode(command.payload),
        style: {
          fill: pico8FramebufferColor(command.args[2] ?? 6, displayPalette),
          fontFamily: "Aico Sans, ui-rounded, system-ui, sans-serif",
          fontSize: 30,
          fontWeight: "700",
          letterSpacing: 0.5,
        },
      });
      label.position.set((command.args[0] ?? 0) * 8, (command.args[1] ?? 0) * 8 - 4);
      this.#textLayer.addChild(label);
    }
  }
}
