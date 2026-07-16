import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function argumentsMap(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Expected --name value pairs");
    result.set(key.slice(2), value);
  }
  return result;
}

const arguments_ = argumentsMap(process.argv.slice(2));
const workspace = path.resolve(arguments_.get("workspace") ?? "");
const replayPath = path.resolve(arguments_.get("replay") ?? "");
const output = path.resolve(arguments_.get("out") ?? "");
const observeNumbers = arguments_.get("observe-numbers") ?? "";
assert.ok(arguments_.get("workspace"), "--workspace is required");
assert.ok(arguments_.get("replay"), "--replay is required");
assert.ok(arguments_.get("out"), "--out is required");
assert.ok(fs.statSync(replayPath, { throwIfNoEntry: false })?.isFile(), "--replay must be a file");

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aico8-backend-comparison-"));
const nativePath = path.join(temporary, "native.json");
const wasmPath = path.join(temporary, "wasm.json");
const common = [
  "--workspace", workspace,
  "--replay", replayPath,
  "--observe-numbers", observeNumbers,
];
const native = spawnSync(process.execPath, [
  path.join(repository, "scripts/smoke-private-cart-native.mjs"),
  ...common,
  "--out", nativePath,
], { cwd: repository, encoding: "utf8" });
const wasm = spawnSync(process.execPath, [
  path.join(repository, "scripts/smoke-private-cart.mjs"),
  ...common,
  "--out", wasmPath,
], { cwd: repository, encoding: "utf8" });
const readReport = (reportPath, execution, backend) => fs.statSync(reportPath, { throwIfNoEntry: false })?.isFile()
  ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
  : { backend, status: "failed", failure: execution.stderr || `runner exited ${execution.status}` };
const nativeReport = readReport(nativePath, native, "native-cpp");
const wasmReport = readReport(wasmPath, wasm, "wasm");
const comparisons = [
  ["cart.combinedSha256", nativeReport.cart?.combinedSha256, wasmReport.cart?.combinedSha256],
  ["input.sha256", nativeReport.input?.sha256, wasmReport.diagnosticInput?.sha256],
  ["execution.logicalUpdates", nativeReport.execution?.logicalUpdates, wasmReport.execution?.logicalUpdates],
  ["execution.maximumDrawCommandCount", nativeReport.execution?.maximumDrawCommandCount,
    wasmReport.execution?.maximumDrawCommandCount],
  ["execution.audioSampleCount", nativeReport.execution?.audioSampleCount,
    wasmReport.execution?.audioSampleCount],
  ["execution.audioPeakAbsolute", nativeReport.execution?.audioPeakAbsolute,
    wasmReport.execution?.audioPeakAbsolute],
  ["execution.audioPcmSha256", nativeReport.execution?.audioPcmSha256,
    wasmReport.execution?.audioPcmSha256],
  ["execution.framebufferSha256", nativeReport.execution?.framebufferSha256,
    wasmReport.execution?.framebufferSha256],
  ["execution.persistenceSha256", nativeReport.execution?.persistenceSha256,
    wasmReport.execution?.persistenceSha256],
  ["observedNumberRaw16_16", nativeReport.observedNumberRaw16_16,
    wasmReport.observedNumberRaw16_16],
];
const mismatches = comparisons
  .filter(([, left, right]) => JSON.stringify(left) !== JSON.stringify(right))
  .map(([field, nativeValue, wasmValue]) => ({ field, native: nativeValue, wasm: wasmValue }));
const replay = JSON.parse(fs.readFileSync(replayPath, "utf8"));
const passed = native.status === 0 && wasm.status === 0
  && nativeReport.status === "passed" && wasmReport.status === "passed"
  && mismatches.length === 0;
const report = {
  schemaVersion: "aico8.private-cart-backend-comparison.v1",
  cart: nativeReport.cart ?? wasmReport.cart,
  replay: {
    replayId: replay.replayId,
    logicalUpdates: replay.trace?.totalUpdates,
    cleanInitialState: replay.trace?.initialState,
  },
  backends: {
    native: nativeReport.execution,
    wasm: wasmReport.execution,
  },
  comparedFields: comparisons.map(([field]) => field),
  mismatches,
  authority: "native-wasm-identity-not-official-conformance",
  status: passed ? "passed" : "failed",
  ...(nativeReport.failure ? { nativeFailure: nativeReport.failure } : {}),
  ...(wasmReport.failure ? { wasmFailure: wasmReport.failure } : {}),
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
fs.rmSync(temporary, { recursive: true, force: true });
if (!passed) throw new Error(`Native/Wasm cart comparison failed with ${mismatches.length} mismatch(es)`);
process.stdout.write(`Private cart backend comparison: PASS (${replay.trace.totalUpdates} logical updates)\n`);
