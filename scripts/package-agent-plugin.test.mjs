import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("agent plugin packages the public engine under the manifest name", () => {
  const output = mkdtempSync(path.join(tmpdir(), "aico8-plugin-package-"));
  const result = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts", "package-agent-plugin.mjs"), "--out", output], { cwd: root, encoding: "utf8" }));
  assert.equal(result.status, "passed");
  assert.equal(path.basename(result.plugin), "aico8");
  const manifest = JSON.parse(readFileSync(path.join(result.plugin, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.name, "aico8");
  assert.equal(manifest.skills, "./skills/");
});
