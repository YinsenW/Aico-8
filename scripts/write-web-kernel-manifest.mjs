#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kernelRoot = path.join(root, "apps", "web", "public", "kernel");
const files = ["aico8-kernel.js", "aico8-kernel.wasm"];

const artifacts = {};
for (const name of files) {
  const bytes = await readFile(path.join(kernelRoot, name));
  artifacts[name] = {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

await writeFile(path.join(kernelRoot, "manifest.json"), `${JSON.stringify({
  schemaVersion: "aico8.web-kernel.v1",
  artifacts,
}, null, 2)}\n`);
