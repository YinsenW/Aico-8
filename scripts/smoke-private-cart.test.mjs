import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repository, "scripts/smoke-private-cart.mjs");

test("boots an unchanged cart through the production Wasm lifecycle without claiming completion", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-cart-smoke-"));
  fs.writeFileSync(path.join(workspace, "source.rom"), Buffer.alloc(0x8000));
  fs.copyFileSync(path.join(repository, "runtime/core/tests/fixtures/synthetic_cart.lua"), path.join(workspace, "code.p8.lua"));
  const output = path.join(workspace, "smoke.json");
  const stdout = execFileSync(process.execPath, [script, "--workspace", workspace, "--host-ticks", "4", "--observe-numbers", "x", "--out", output], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.match(stdout, /Private cart smoke: PASS/);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.status, "passed");
  assert.equal(report.execution.hostTicks, 4);
  assert.equal(report.execution.initializationCompleted, true);
  assert.equal(report.execution.initializationTicks, 0);
  assert.equal(report.execution.logicalUpdates, 2);
  assert.equal(report.diagnosticInput.logicalUpdateMaskCount, 0);
  assert.match(report.diagnosticInput.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.observedNumberRaw16_16.x, 0);
  assert.equal(report.execution.audioSampleCount, 1470);
  assert.match(report.execution.audioPcmSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.authority, "diagnostic-boot-only-not-canonical-completion");
});

test("overwrites stale success evidence with a bounded failure report", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-cart-smoke-failure-"));
  fs.writeFileSync(path.join(workspace, "source.rom"), Buffer.alloc(0x8000));
  fs.writeFileSync(path.join(workspace, "code.p8.lua"), "function _init() while true do flip() end end\n");
  const output = path.join(workspace, "smoke.json");
  fs.writeFileSync(output, '{"status":"passed"}\n');
  const result = spawnSync(process.execPath, [script, "--workspace", workspace, "--host-ticks", "3", "--out", output], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(report.status, "failed");
  assert.equal(report.execution.initializationCompleted, false);
  assert.match(report.failure, /Initialization is still suspended/);
});
