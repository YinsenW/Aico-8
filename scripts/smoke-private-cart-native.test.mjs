import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeScript = path.join(repository, "scripts/smoke-private-cart-native.mjs");
const comparisonScript = path.join(repository, "scripts/compare-private-cart-backends.mjs");

function syntheticWorkspace(prefix) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(workspace, "source.rom"), Buffer.alloc(0x8000));
  fs.copyFileSync(
    path.join(repository, "runtime/core/tests/fixtures/synthetic_cart.lua"),
    path.join(workspace, "code.p8.lua"),
  );
  return workspace;
}

test("native and Wasm hosts produce identical unchanged-cart replay artifacts", () => {
  execFileSync("make", ["-C", "runtime/core", "native-cart-smoke", "wasm"], {
    cwd: repository,
    stdio: "pipe",
  });
  const workspace = syntheticWorkspace("aico8-native-parity-");
  const replayPath = path.join(workspace, "replay.json");
  fs.writeFileSync(replayPath, `${JSON.stringify({
    schemaVersion: "aico8.replay.v1",
    replayId: "synthetic-native-parity",
    trace: {
      schemaVersion: "aico8.input-trace.v1",
      updateHz: 30,
      totalUpdates: 2,
      initialState: { kind: "clean", persistenceSha256: "unused-by-smoke" },
      spans: [{ startUpdate: 0, endUpdateExclusive: 2, players: [0] }],
    },
  }, null, 2)}\n`);
  const comparisonOutput = path.join(workspace, "comparison.json");
  execFileSync(process.execPath, [
    comparisonScript,
    "--workspace", workspace,
    "--replay", replayPath,
    "--observe-numbers", "x",
    "--out", comparisonOutput,
  ], { cwd: repository, encoding: "utf8" });
  const comparison = JSON.parse(fs.readFileSync(comparisonOutput, "utf8"));
  assert.equal(comparison.status, "passed");
  assert.equal(comparison.replay.logicalUpdates, 2);
  assert.deepEqual(comparison.mismatches, []);
  assert.equal(comparison.backends.native.logicalUpdates, 2);
  assert.deepEqual(comparison.backends.native, comparison.backends.wasm);
});

test("native runner replaces stale success evidence with a bounded failure", () => {
  execFileSync("make", ["-C", "runtime/core", "native-cart-smoke"], {
    cwd: repository,
    stdio: "pipe",
  });
  const workspace = syntheticWorkspace("aico8-native-failure-");
  fs.writeFileSync(path.join(workspace, "code.p8.lua"), "function _init(\n");
  const output = path.join(workspace, "native.json");
  fs.writeFileSync(output, '{"status":"passed"}\n');
  const result = spawnSync(process.execPath, [
    nativeScript,
    "--workspace", workspace,
    "--button-updates", "0",
    "--out", output,
  ], { cwd: repository, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.backend, "native-cpp");
  assert.match(report.failure, /syntax|expected|near/i);
});
