import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(root, "scripts", "agent", "aico8-agent.mjs");

function run(args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" }));
}

test("intake copies one authorized cart into private state without retaining its source path", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aico8-agent-intake-"));
  const cart = path.join(directory, "sample.p8");
  const state = path.join(directory, "state");
  writeFileSync(cart, "pico-8 cartridge // http://www.pico-8.com\nversion 42\n");
  const result = run(["intake", "--cart", cart, "--target", "web", "--state-root", state, "--authorized-private-research"]);
  assert.equal(result.status, "intake-ready");
  const manifest = JSON.parse(readFileSync(result.sessionManifest, "utf8"));
  assert.equal(manifest.target, "web");
  assert.equal(manifest.authorization.privateResearch, true);
  assert.equal(JSON.stringify(manifest).includes(directory), false);
  assert.equal(readFileSync(result.cart, "utf8"), readFileSync(cart, "utf8"));
});

test("intake rejects unsupported files and missing authority", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aico8-agent-reject-"));
  const cart = path.join(directory, "sample.txt");
  writeFileSync(cart, "not a cart");
  const missingAuthority = spawnSync(process.execPath, [cli, "intake", "--cart", cart], { encoding: "utf8" });
  assert.notEqual(missingAuthority.status, 0);
  assert.match(missingAuthority.stderr, /authorization/);
  const wrongExtension = spawnSync(process.execPath, [cli, "intake", "--cart", cart, "--authorized-private-research"], { encoding: "utf8" });
  assert.notEqual(wrongExtension.status, 0);
  assert.match(wrongExtension.stderr, /\.p8/);
});

test("handoff returns only the artifacts selected by the session", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aico8-agent-handoff-"));
  const cart = path.join(directory, "sample.p8.png");
  const state = path.join(directory, "state");
  writeFileSync(cart, "synthetic cart bytes");
  const intake = run(["intake", "--cart", cart, "--target", "both", "--state-root", state, "--authorized-private-research"]);
  const web = path.join(directory, "web");
  mkdirSync(web);
  writeFileSync(path.join(web, "index.html"), "<!doctype html><title>Aico 8</title>");
  const apk = path.join(directory, "game.apk");
  writeFileSync(apk, "synthetic apk");
  const result = run(["handoff", "--session", intake.sessionManifest, "--web", web, "--apk", apk]);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.artifacts.map(({ type }) => type), ["web", "android"]);
  assert.equal(result.artifacts[0].files[0].file, "index.html");
  assert.match(result.artifacts[1].sha256, /^[a-f0-9]{64}$/);
});

test("bootstrap produces a reusable isolated engine without private input", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "aico8-agent-bootstrap-"));
  const engine = path.join(directory, "engine");
  const first = run(["bootstrap", "--engine-root", engine, "--skip-dependencies"]);
  assert.equal(first.status, "ready");
  assert.equal(first.reused, false);
  assert.equal(readFileSync(path.join(engine, "plugins", "aico8", ".codex-plugin", "plugin.json"), "utf8").includes('"name": "aico8"'), true);
  assert.equal(spawnSync("test", ["-e", path.join(engine, "private")]).status, 1);
  const second = run(["bootstrap", "--engine-root", engine, "--skip-dependencies"]);
  assert.equal(second.reused, true);
});
