#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { access, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targets = new Set(["web", "android", "both"]);

async function pluginManifest(root) {
  const candidates = [
    path.join(root, ".codex-plugin", "plugin.json"),
    path.join(root, "plugins", "aico8", ".codex-plugin", "plugin.json"),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  return candidates[1];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function parse(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index];
    if (!item.startsWith("--")) throw new Error(`unexpected argument: ${item}`);
    const key = item.slice(2);
    if (["authorized-private-research", "skip-dependencies", "force"].includes(key)) {
      options[key] = true;
    } else {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return { command, options };
}

async function exists(file) {
  try {
    await access(file, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function executable(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10_000 });
  return {
    command,
    available: !result.error && result.status === 0,
    version: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n")[0] ?? "",
  };
}

function assertTarget(value = "web") {
  if (!targets.has(value)) throw new Error("target must be web, android, or both");
  return value;
}

function stateRoot(options) {
  return path.resolve(options["state-root"] ?? path.join(homedir(), ".aico8", "private"));
}

async function doctor(options) {
  const target = assertTarget(options.target);
  const root = path.resolve(options["engine-root"] ?? repositoryRoot);
  const node = process.versions.node.split(".").map(Number);
  const checks = [
    { id: "node", required: true, passed: node[0] > 22 || (node[0] === 22 && node[1] >= 12), detail: process.versions.node },
    { id: "plugin-manifest", required: true, passed: await exists(await pluginManifest(root)), detail: "plugins/aico8/.codex-plugin/plugin.json" },
    { id: "governance", required: true, passed: await exists(path.join(root, "governance", "project.json")), detail: "governance/project.json" },
    { id: "lockfile", required: true, passed: await exists(path.join(root, "pnpm-lock.yaml")), detail: "pnpm-lock.yaml" },
  ];
  for (const [id, command] of [["pnpm", "pnpm"], ["make", "make"], ["cxx", "c++"], ["emscripten", "em++"]]) {
    const result = executable(command);
    checks.push({ id, required: true, passed: result.available, detail: result.version || command });
  }
  const java = executable("java", ["-version"]);
  const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(homedir(), "Library", "Android", "sdk");
  const needsAndroid = target !== "web";
  checks.push({ id: "java", required: needsAndroid, passed: java.available, detail: java.version || "java" });
  checks.push({ id: "android-sdk", required: needsAndroid, passed: await exists(androidHome), detail: androidHome });
  const blockers = checks.filter((check) => check.required && !check.passed).map((check) => check.id);
  const report = { schemaVersion: "aico8.agent-doctor.v1", target, engineRoot: root, status: blockers.length === 0 ? "passed" : "blocked", blockers, checks };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (blockers.length > 0) process.exitCode = 2;
}

const excludedNames = new Set([".git", "node_modules", "dist", "coverage", "target", "workspaces", "private", "pico8_carts", ".aico8-engine.json"]);
function copyFilter(source) {
  const relative = path.relative(repositoryRoot, source);
  if (!relative) return true;
  const parts = relative.split(path.sep);
  if (parts.some((part) => excludedNames.has(part))) return false;
  if (relative === path.join("captures", "official")) return false;
  if (relative === path.join("runtime", "core", "build")) return false;
  if (relative === path.join("apps", "web", "public", "kernel")) return false;
  return true;
}

async function bootstrap(options) {
  const manifest = await json(await pluginManifest(repositoryRoot));
  const destination = path.resolve(options["engine-root"] ?? path.join(homedir(), ".aico8", "engines", manifest.version));
  const marker = path.join(destination, ".aico8-engine.json");
  if (await exists(marker)) {
    const installed = await json(marker);
    if (installed.version === manifest.version && !options.force) {
      process.stdout.write(`${JSON.stringify({ status: "ready", engineRoot: destination, reused: true }, null, 2)}\n`);
      return;
    }
  }
  if (await exists(destination)) {
    if (!options.force) throw new Error(`engine destination already exists: ${destination}`);
    await rm(destination, { recursive: true, force: true });
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const stage = `${destination}.install-${process.pid}-${randomBytes(4).toString("hex")}`;
  await rm(stage, { recursive: true, force: true });
  try {
    await cp(repositoryRoot, stage, { recursive: true, filter: copyFilter, errorOnExist: true });
    if (!options["skip-dependencies"]) {
      // The Agent CLI is a JSON protocol. Dependency-manager progress must not
      // leak into stdout, because the lightweight plugin parses this command's
      // complete stdout as one JSON document.
      const install = spawnSync("pnpm", ["install", "--frozen-lockfile"], { cwd: stage, encoding: "utf8" });
      if (install.error || install.status !== 0) {
        const detail = (install.stderr || install.stdout || install.error?.message || "unknown error").trim();
        throw new Error(`dependency installation failed: ${detail}`);
      }
    }
    await writeJson(path.join(stage, ".aico8-engine.json"), {
      schemaVersion: "aico8.engine-install.v1",
      version: manifest.version,
      dependenciesInstalled: !options["skip-dependencies"],
    });
    await rename(stage, destination);
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ status: "ready", engineRoot: destination, reused: false }, null, 2)}\n`);
}

async function intake(options) {
  if (!options["authorized-private-research"]) throw new Error("private research authorization must be explicit");
  if (!options.cart) throw new Error("--cart is required");
  const target = assertTarget(options.target);
  const cart = path.resolve(options.cart);
  const cartStat = await stat(cart);
  if (!cartStat.isFile()) throw new Error("cart must be a regular file");
  const lower = cart.toLowerCase();
  if (!lower.endsWith(".p8") && !lower.endsWith(".p8.png")) throw new Error("cart must end in .p8 or .p8.png");
  const identity = await sha256File(cart);
  const sessionId = `${Date.now().toString(36)}-${identity.sha256.slice(0, 12)}-${randomBytes(3).toString("hex")}`;
  const directory = path.join(stateRoot(options), "sessions", sessionId);
  const inputDirectory = path.join(directory, "input");
  await mkdir(inputDirectory, { recursive: true, mode: 0o700 });
  const cartName = path.basename(cart);
  const destination = path.join(inputDirectory, cartName);
  await cp(cart, destination, { errorOnExist: true });
  const manifest = {
    schemaVersion: "aico8.agent-session.v1",
    sessionId,
    target,
    authorization: { privateResearch: true, publication: false },
    cart: { file: path.posix.join("input", cartName), ...identity },
    status: "intake-ready",
  };
  const manifestPath = path.join(directory, "session.json");
  await writeJson(manifestPath, manifest);
  process.stdout.write(`${JSON.stringify({ status: "intake-ready", sessionId, sessionManifest: manifestPath, cart: destination, target }, null, 2)}\n`);
}

async function inventory(directory, root = directory) {
  const entries = [];
  const names = (await import("node:fs/promises")).readdir(directory, { withFileTypes: true });
  for (const entry of await names) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) entries.push(...await inventory(file, root));
    else if (entry.isFile()) entries.push({ file: path.relative(root, file).split(path.sep).join("/"), ...await sha256File(file) });
    else throw new Error(`unsupported artifact entry: ${file}`);
  }
  return entries.sort((left, right) => left.file.localeCompare(right.file));
}

async function handoff(options) {
  if (!options.session) throw new Error("--session is required");
  const sessionPath = path.resolve(options.session);
  const session = await json(sessionPath);
  if (session.schemaVersion !== "aico8.agent-session.v1") throw new Error("unsupported session manifest");
  const directory = path.dirname(sessionPath);
  const deliverables = path.join(directory, "deliverables");
  await mkdir(deliverables, { recursive: true, mode: 0o700 });
  const artifacts = [];
  if (session.target === "web" || session.target === "both") {
    if (!options.web) throw new Error("--web is required by the selected target");
    const source = path.resolve(options.web);
    if (!(await stat(source)).isDirectory()) throw new Error("Web artifact must be a directory");
    const destination = path.join(deliverables, "web");
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: true, errorOnExist: true });
    artifacts.push({ type: "web", path: destination, files: await inventory(destination) });
  }
  if (session.target === "android" || session.target === "both") {
    if (!options.apk) throw new Error("--apk is required by the selected target");
    const source = path.resolve(options.apk);
    if (!(await stat(source)).isFile() || !source.toLowerCase().endsWith(".apk")) throw new Error("Android artifact must be an APK file");
    const destination = path.join(deliverables, "aico8-remake.apk");
    await cp(source, destination, { force: true });
    artifacts.push({ type: "android", path: destination, ...await sha256File(destination) });
  }
  const report = { schemaVersion: "aico8.agent-handoff.v1", sessionId: session.sessionId, target: session.target, status: "ready", artifacts };
  const reportPath = path.join(deliverables, "handoff.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ...report, report: reportPath }, null, 2)}\n`);
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (command === "doctor") return doctor(options);
  if (command === "bootstrap") return bootstrap(options);
  if (command === "intake") return intake(options);
  if (command === "handoff") return handoff(options);
  throw new Error("usage: aico8-agent.mjs <doctor|bootstrap|intake|handoff> [options]");
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
