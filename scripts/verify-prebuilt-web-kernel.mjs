#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const kernelRoot = path.join(root, "apps", "web", "public", "kernel");
const manifest = JSON.parse(await readFile(path.join(kernelRoot, "manifest.json"), "utf8"));
if (manifest.schemaVersion !== "aico8.web-kernel.v1") throw new Error("unsupported Web kernel manifest");

for (const name of ["aico8-kernel.js", "aico8-kernel.wasm"]) {
  const bytes = await readFile(path.join(kernelRoot, name));
  const expected = manifest.artifacts?.[name];
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (!expected || expected.bytes !== bytes.byteLength || expected.sha256 !== sha256) {
    throw new Error(`${name} does not match its release identity`);
  }
}

process.stdout.write("Aico 8 prebuilt Web/Wasm kernel: PASS\n");
