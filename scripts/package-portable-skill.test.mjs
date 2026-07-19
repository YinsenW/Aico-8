import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("portable Skill packages one host-neutral ZIP", () => {
  const output = mkdtempSync(path.join(tmpdir(), "aico8-portable-skill-"));
  const result = JSON.parse(execFileSync(process.execPath, [path.join(root, "scripts", "package-portable-skill.mjs"), "--out", output], { cwd: root, encoding: "utf8" }));
  assert.equal(result.status, "passed");
  assert.equal(result.version, "0.1.3");
  assert.equal(path.basename(result.archive), "aico8-remake.zip");
  const engine = JSON.parse(readFileSync(path.join(result.directory, "engine.json"), "utf8"));
  assert.equal(engine.ref, "v0.1.3");
  const entries = execFileSync("unzip", ["-Z1", result.archive], { encoding: "utf8" });
  assert.match(entries, /aico8-remake\/SKILL\.md/);
  assert.match(entries, /aico8-remake\/scripts\/bootstrap\.mjs/);

  const engineRoot = path.join(output, "engine");
  const bootstrap = JSON.parse(execFileSync(process.execPath, [
    path.join(result.directory, "scripts", "bootstrap.mjs"),
    "--source", root,
    "--engine-root", engineRoot,
    "--skip-dependencies",
  ], { cwd: root, encoding: "utf8" }));
  assert.equal(bootstrap.status, "ready");
  assert.equal(bootstrap.skillVersion, "0.1.3");
  assert.equal(bootstrap.engineRef, "v0.1.3");
});
