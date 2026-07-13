# Aico 8 web host

TypeScript/PixiJS application for the default 1024×1024 reference profile:

- versioned Emscripten/WASM C-ABI bridge to the portable compatibility kernel;
- fixed-step simulation independent of the visual ticker;
- semantic command consumption and HD asset mapping;
- compatibility framebuffer overlay and automatic fallback;
- keyboard, controller, touch, responsive square layout, accessibility, and PWA lifecycle.

The web host is the first presentation and release target after the reference
rasterizer is complete. Game logic, fixed-point arithmetic, and compatibility
raster rules are not reimplemented in TypeScript.

The current system-font CSS is bootstrap-only. A release must load the audited
font assets and policies declared by `specs/typography.md`; unavailable, unsafe,
or custom P8SCII text falls back to the indexed compatibility renderer.

The current bootstrap renders the canonical 1024 surface and verifies the exact
128→1024 coordinate contract:

```sh
pnpm install
pnpm --filter @aico8/web dev
```

The Web package keeps strict checking for Aico 8 source but currently enables
`skipLibCheck` for dependencies because PixiJS 8.19's bitmap-font declaration
is not compatible with `exactOptionalPropertyTypes`. The shared contracts package
does not skip library checks; removing this exception is an explicit dependency
upgrade gate.
