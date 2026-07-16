import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "dist", "build"]);
const rustFiles = [];
const cargoManifests = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && entry.name.endsWith(".rs")) rustFiles.push(path.relative(root, absolute));
    else if (entry.isFile() && entry.name === "Cargo.toml") cargoManifests.push(path.relative(root, absolute));
  }
}

walk(root);
for (const file of rustFiles) {
  assert.ok(file.startsWith("runtime/kernel-rs/"), `${file}: Rust is allowed only in the disposable kernel proof boundary`);
}
for (const file of cargoManifests) {
  assert.ok(file === "Cargo.toml" || file.startsWith("runtime/kernel-rs/"),
    `${file}: Cargo manifests are allowed only for the root proof workspace or its isolated member`);
}
if (cargoManifests.includes("Cargo.toml")) {
  const workspace = fs.readFileSync(path.join(root, "Cargo.toml"), "utf8");
  assert.match(workspace, /members\s*=\s*\["runtime\/kernel-rs"\]/,
    "root Cargo workspace may contain only runtime/kernel-rs");
}

const adr = fs.readFileSync(path.join(root, "docs/decisions/0002-rust-kernel-spike.md"), "utf8");
assert.match(adr, /Status: proposed; ADR 0001 remains authoritative until the proof gates pass/);
assert.match(adr, /same Rust\+C revision builds to browser Wasm/);
assert.match(adr, /Native and Wasm checkpoint bytes are identical/);
assert.match(adr, /ESP32-P4/);

const proofRoot = path.join(root, "runtime/kernel-rs");
if (!fs.existsSync(proofRoot)) {
  assert.deepEqual(rustFiles, []);
  assert.deepEqual(cargoManifests, []);
  process.stdout.write("Rust boundary: PASS (ADR 0002 remains proposed; no Rust proof or production sources exist)\n");
} else {
  assert.ok(cargoManifests.includes("runtime/kernel-rs/Cargo.toml"),
    "runtime/kernel-rs exists without its proof Cargo.toml");
  process.stdout.write(`Rust boundary: PASS (${rustFiles.length} proof source files; ADR remains proposed)\n`);
}
