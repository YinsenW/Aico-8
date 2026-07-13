import { Application, Graphics, Text } from "pixi.js";

import { REFERENCE_PROFILE } from "@aico8/contracts";

import "./style.css";

const mount = document.querySelector<HTMLElement>("#app");
if (!mount) {
  throw new Error("Aico 8 mount element is missing");
}

const app = new Application();
await app.init({
  width: REFERENCE_PROFILE.outputWidth,
  height: REFERENCE_PROFILE.outputHeight,
  preference: "webgl",
  antialias: true,
  autoDensity: false,
  resolution: 1,
  background: "#080b12",
});

app.canvas.setAttribute("aria-label", "Aico 8 1024 by 1024 rendering surface");
mount.append(app.canvas);

const surface = new Graphics()
  .roundRect(48, 48, 928, 928, 36)
  .fill({ color: 0x101725 })
  .stroke({ color: 0x26354f, width: 2 });
app.stage.addChild(surface);

const grid = new Graphics();
for (let coordinate = 0; coordinate <= REFERENCE_PROFILE.outputWidth; coordinate += REFERENCE_PROFILE.outputTileSize) {
  const weight = coordinate % (REFERENCE_PROFILE.outputTileSize * 4) === 0 ? 2 : 1;
  const alpha = weight === 2 ? 0.22 : 0.1;
  grid.moveTo(coordinate, 0).lineTo(coordinate, REFERENCE_PROFILE.outputHeight);
  grid.moveTo(0, coordinate).lineTo(REFERENCE_PROFILE.outputWidth, coordinate);
  grid.stroke({ color: 0x73a6ff, width: weight, alpha });
}
app.stage.addChild(grid);

const title = new Text({
  text: "AICO 8",
  style: {
    fill: 0xf2f6ff,
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: 68,
    fontWeight: "700",
    letterSpacing: 8,
  },
});
title.position.set(104, 112);
app.stage.addChild(title);

const subtitle = new Text({
  text: "TYPESCRIPT PRESENTATION  /  PORTABLE KERNEL",
  style: {
    fill: 0x73a6ff,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 22,
    letterSpacing: 2,
  },
});
subtitle.position.set(108, 202);
app.stage.addChild(subtitle);

const contract = new Text({
  text: [
    "REFERENCE SURFACE     1024 × 1024",
    "LOGICAL SIMULATION    128 × 128",
    "INTEGER SCALE         8×",
    "SEMANTIC TILE         64 × 64",
    "KERNEL ARTIFACT       NATIVE + WASM",
  ].join("\n"),
  style: {
    fill: 0xc6d2e8,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 27,
    lineHeight: 50,
  },
});
contract.position.set(108, 602);
app.stage.addChild(contract);
