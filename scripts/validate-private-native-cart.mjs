import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspace = path.resolve(process.env.AICO8_PRIVATE_WORKSPACE ?? "");
assert.ok(process.env.AICO8_PRIVATE_WORKSPACE, "AICO8_PRIVATE_WORKSPACE is required");
const replay = path.join(workspace, "validation/canonical-replay-v1.json");
for (const required of [
  path.join(workspace, "source.rom"),
  path.join(workspace, "code.p8.lua"),
  replay,
]) {
  assert.ok(fs.statSync(required, { throwIfNoEntry: false })?.isFile(), `Missing private input: ${required}`);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-private-native-validation-"));
const actualPath = path.join(temporary, "comparison.json");
execFileSync(process.execPath, [
  path.join(repository, "scripts/compare-private-cart-backends.mjs"),
  "--workspace", workspace,
  "--replay", replay,
  "--out", actualPath,
], { cwd: repository, stdio: "inherit" });
const expectedPath = path.join(repository, "governance/evidence/dust-bunny-native-wasm-replay.json");
const actual = fs.readFileSync(actualPath, "utf8");
const expected = fs.readFileSync(expectedPath, "utf8");
fs.rmSync(temporary, { recursive: true, force: true });
assert.equal(actual, expected,
  "Private native/Wasm replay evidence drifted; inspect the first mismatch before refreshing evidence");
process.stdout.write("Private native/Wasm cart replay evidence: PASS\n");
